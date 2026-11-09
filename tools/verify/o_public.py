# -*- coding: utf-8 -*-
"""O 节：从公网地址（Cloudflare 隧道）验证端到端可用性与防护仍然生效。

用法：python o_public.py <https://xxx.trycloudflare.com> <admin_user> <admin_pass>
"""
import http.cookiejar
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

base = sys.argv[1].rstrip("/")
user, pwd = sys.argv[2], sys.argv[3]

results, fails = [], []


def check(name, ok, detail=""):
    results.append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  :: {detail}" if detail else ""))
    if not ok:
        fails.append(name)


def new_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def call(opener, method, path, payload=None, raw=False):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=45) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data.decode("utf-8") or "{}")), dict(
                (k.lower(), v) for k, v in r.getheaders())
    except urllib.error.HTTPError as exc:
        data = exc.read()
        try:
            return exc.code, (data if raw else json.loads(data.decode("utf-8") or "{}")), dict(
                (k.lower(), v) for k, v in exc.headers.items())
        except Exception:
            return exc.code, (data if raw else {"_raw": data[:200].decode("utf-8", "replace")}), {}


print("=" * 72)
print(f"O. 公网访问验收（{base}）")
print("=" * 72)

op, _ = new_opener()

# 等隧道就绪（Cloudflare 边缘路由需要几秒）
home = None
for attempt in range(10):
    try:
        st, data, hdr = call(op, "GET", "/", raw=True)
        if st == 200:
            home = data
            break
    except Exception:
        pass
    time.sleep(3)

check("O2 公网地址可取到登录页", home is not None and b"<html" in (home or b"").lower(),
      f"bytes={len(home) if home else 0}")

op, _ = new_opener()
st, health, _ = call(op, "GET", "/api/health")
check("O2b 公网 /api/health → 200 db=ok",
      st == 200 and health.get("db") == "ok", f"HTTP {st} {health}")

# 本地静态资源也经隧道可取（前端零构建，全部本地托管）
op, _ = new_opener()
st, js, hdr = call(op, "GET", "/assets/vendor/marked.min.js", raw=True)
check("O2c 公网可取到本地托管的 marked.js（无 CDN 依赖）",
      st == 200 and len(js) > 10000, f"HTTP {st} bytes={len(js)}")

# 登录 + 建笔记（写操作经隧道）
op, jar = new_opener()
st, me, hdr = call(op, "POST", "/api/auth/login", {"username": user, "password": pwd})
check("O3 经公网登录成功", st == 200 and me.get("role") == "admin", f"HTTP {st}")
check("O3b 公网下 Set-Cookie 仍带 HttpOnly + SameSite=Lax",
      "httponly" in hdr.get("set-cookie", "").lower() and
      "samesite=lax" in hdr.get("set-cookie", "").lower().replace(" ", ""),
      hdr.get("set-cookie", "")[:110])

tag = uuid.uuid4().hex[:6]
st, note, _ = call(op, "POST", "/api/notes",
                   {"folderId": None, "title": f"公网创建-{tag}",
                    "content": f"经 Cloudflare 隧道创建的笔记 公网验证词{tag}"})
nid = note.get("id")
check("O3c 经公网创建笔记 → 201", st == 201, f"HTTP {st} id={nid}")

st, sr, _ = call(op, "GET", f"/api/search?q=" + urllib.request.quote(f"公网验证词{tag}"))
check("O3d 经公网搜索命中刚创建的笔记（中文 2 字以上）",
      st == 200 and any(i.get("noteId") == nid for i in sr.get("items", [])),
      f"HTTP {st} total={sr.get('total')}")

st, fetched, _ = call(op, "GET", f"/api/notes/{nid}")
check("O3e 经公网读回该笔记", st == 200 and tag in fetched.get("title", ""),
      f"HTTP {st} title={fetched.get('title')}")

# 未登录保护在隧道后依然生效
op2, _ = new_opener()
st, body, _ = call(op2, "GET", "/api/notes")
check("O4 公网未登录访问受保护端点 → 401",
      st == 401, f"HTTP {st}")

# 登录限流在隧道后依然生效。
# 注意：限流是**按用户名**计数的，所以 6 次必须用同一个用户名；
# 每次换用户名测不出限流（第一版脚本在这里误判过）。
op3, _ = new_opener()
probe_user = "nosuchuser_" + uuid.uuid4().hex[:8]
codes = []
for _ in range(6):
    st, _, _ = call(op3, "POST", "/api/auth/login",
                    {"username": probe_user, "password": "WrongPass123"})
    codes.append(st)
check("O5 公网登录限流生效（同一用户名连续失败后 429）", codes[-1] == 429, f"codes={codes}")

# 巨型请求体防护经隧道仍生效
op4, _ = new_opener()
st, _, _ = call(op4, "POST", "/api/notes", {"title": "big", "content": "x" * (9 * 1024 * 1024)})
check("O6 经公网 9MB 请求体 → 413（DoS 防护在隧道后仍生效）", st == 413, f"HTTP {st}")

print()
print(f"结果：PASS {len(results) - len(fails)}   FAIL {len(fails)}")
for f in fails:
    print(f"  - {f}")
sys.exit(1 if fails else 0)
