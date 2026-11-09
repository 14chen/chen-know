# -*- coding: utf-8 -*-
"""N 节：重启后经真实 API 验证数据仍在、搜索仍可用。

用法：python n_api.py <base_url> <admin_user> <admin_pass>
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

base = sys.argv[1].rstrip("/")
user, pwd = sys.argv[2], sys.argv[3]

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None):
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, {"_raw": raw[:200]}


results = []
fails = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  :: {detail}" if detail else ""))
    if not ok:
        fails.append(name)


print("=" * 72)
print("N. 重启后持久化验证（真实 API）")
print("=" * 72)

st, health = call("GET", "/api/health")
check("N1 重启后 /api/health 返回 200 且 db=ok",
      st == 200 and health.get("db") == "ok", f"HTTP {st} {health}")

st, me = call("POST", "/api/auth/login", {"username": user, "password": pwd})
check("N2 重启后旧账号仍可登录（会话数据持久化）",
      st == 200 and me.get("role") == "admin", f"HTTP {st} role={me.get('role')}")

st, lst = call("GET", "/api/notes?size=200")
total = lst.get("total") if isinstance(lst, dict) else None
check("N3 重启后笔记总数与重启前一致（23）", total == 23, f"total={total}")

st, vers = call("GET", "/api/notes/2/versions")
check("N4 历史版本仍在（note_versions 持久化）",
      isinstance(vers, list) and len(vers) >= 1, f"versions={len(vers) if isinstance(vers, list) else vers}")

# 中文搜索在重启后仍可用（FTS 索引随库持久化）
hits_total = None
for q in ("版本笔记", "链B", "标签笔记"):
    st, sr = call("GET", "/api/search?" + urllib.parse.urlencode({"q": q, "size": 50}))
    n = sr.get("total") if isinstance(sr, dict) else None
    check(f"N5 重启后搜「{q}」仍命中（FTS 索引未坏）", st == 200 and (n or 0) >= 1,
          f"HTTP {st} total={n}")
    if q == "版本笔记":
        hits_total = n

st, tr = call("GET", "/api/trash")
check("N6 回收站可访问且状态一致", st == 200 and isinstance(tr, dict),
      f"notes={len(tr.get('notes', []))} folders={len(tr.get('folders', []))}")

st, stats = call("GET", "/api/stats")
check("N7 /api/stats 计数与库一致（23 篇）",
      st == 200 and stats.get("noteCount") == 23,
      f"noteCount={stats.get('noteCount')} folderCount={stats.get('folderCount')}")

# 附件文件在磁盘上真实存在（注意：这是二进制响应，不能按 JSON 解）
req = urllib.request.Request(base + "/api/attachments/1", method="GET")
try:
    with opener.open(req, timeout=30) as r:
        blob = r.read()
        st = r.status
except urllib.error.HTTPError as exc:
    blob, st = exc.read(), exc.code
check("N8 重启后附件仍可取回（磁盘文件持久化）",
      st == 200 and len(blob) > 0, f"HTTP {st} bytes={len(blob)}")

print()
print(f"结果：PASS {len(results) - len(fails)}   FAIL {len(fails)}")
if fails:
    for f in fails:
        print(f"  - {f}")
sys.exit(1 if fails else 0)
