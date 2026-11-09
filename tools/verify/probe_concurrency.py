# -*- coding: utf-8 -*-
"""复现并诊断「并发写 notes 返回 500」。

用法：python probe_concurrency.py <base_url> [并发数]
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

base = sys.argv[1].rstrip("/")
N = int(sys.argv[2]) if len(sys.argv) > 2 else 20

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def login():
    req = urllib.request.Request(
        base + "/api/auth/login",
        data=json.dumps({"username": "demo", "password": "DemoPass123!"}).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with opener.open(req, timeout=30) as r:
        return json.loads(r.read().decode())


def post_one(i: int):
    body = json.dumps({"folderId": None, "title": f"并发探针-{i}", "content": f"内容 {i}"}).encode()
    req = urllib.request.Request(
        base + "/api/notes", data=body, method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with opener.open(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, raw[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]
    except Exception as e:
        return -1, str(e)[:200]


def cleanup():
    """清掉探针笔记。

    ⚠️ 这里必须用带 cookie 的 opener —— 用裸 urllib.request.urlopen 会 401，
    再被 except 吞掉，结果「报告清理了 N 篇、实际一篇没删」（本脚本第一版就是这个 bug）。
    清理后必须回读复验，不能只凭调用没抛异常就认为成功。
    """
    req = urllib.request.Request(base + "/api/notes?size=200", method="GET")
    with opener.open(req, timeout=30) as r:
        lst = json.loads(r.read().decode())
    mine = [it for it in lst.get("items", []) if it["title"].startswith("并发探针-")]
    for it in mine:
        for m, p in (("DELETE", f"/api/notes/{it['id']}"),
                     ("DELETE", f"/api/trash/notes/{it['id']}")):
            try:
                with opener.open(urllib.request.Request(base + p, method=m), timeout=30):
                    pass
            except urllib.error.HTTPError as e:
                print(f"    [清理告警] {m} {p} -> HTTP {e.code}")
            except Exception as e:
                print(f"    [清理告警] {m} {p} -> {e}")

    # 回读复验：不能只凭「没抛异常」就判定清理成功
    with opener.open(urllib.request.Request(base + "/api/notes?size=200", method="GET"), timeout=30) as r:
        after = json.loads(r.read().decode())
    left = [it for it in after.get("items", []) if it["title"].startswith("并发探针-")]
    if left:
        print(f"    [清理失败] 仍有 {len(left)} 篇探针笔记残留！")
    return len(mine) - len(left)


print(f"登录：{login().get('username')}")

print(f"\n=== 并发 {N} 个 POST /api/notes ===")
with ThreadPoolExecutor(max_workers=N) as ex:
    results = list(ex.map(post_one, range(N)))

from collections import Counter
codes = Counter(c for c, _ in results)
print(f"状态码分布：{dict(codes)}")

failed = [(c, body) for c, body in results if c != 201]
if failed:
    print(f"\n失败样例（最多 3 条）：")
    seen = set()
    for c, body in failed:
        key = body[:120]
        if key in seen:
            continue
        seen.add(key)
        print(f"  HTTP {c}: {body}")
        if len(seen) >= 3:
            break

print(f"\n=== 串行 {N} 个对照 ===")
serial = [post_one(1000 + i)[0] for i in range(N)]
print(f"状态码分布：{dict(Counter(serial))}")

removed = cleanup()
print(f"\n已清理探针笔记 {removed} 篇")
