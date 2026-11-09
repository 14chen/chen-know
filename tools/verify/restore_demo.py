# -*- coding: utf-8 -*-
"""把演示笔记恢复成 seed_demo.py 里的原始内容（清除所有测试残留）。

用法：python restore_demo.py <base_url> [--user demo] [--pass DemoPass123!] [--check]

--check 只审计不写入，逐篇报告是否有残留标记。
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from seed_demo import NOTES  # noqa: E402

base = sys.argv[1].rstrip("/")
user = "demo"
pwd = "DemoPass123!"
if "--user" in sys.argv:
    user = sys.argv[sys.argv.index("--user") + 1]
if "--pass" in sys.argv:
    pwd = sys.argv[sys.argv.index("--pass") + 1]
CHECK_ONLY = "--check" in sys.argv

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode("utf-8")) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return exc.code, {"_raw": raw[:200].decode("utf-8", "replace")}


MARKERS = ["【冒烟测试】", "【Lead独立验收中文】", "冒烟测试", "Lead独立验收"]


def main() -> int:
    st, _ = call("POST", "/api/auth/login", {"username": user, "password": pwd})
    if st != 200:
        print(f"[失败] 登录 HTTP {st}")
        return 1
    st, lst = call("GET", "/api/notes?size=200")
    by_title = {it["title"]: it["id"] for it in lst.get("items", [])}

    # 与种子内容做全等比对，而不是扫描已知标记 ——
    # 标记扫描会漏掉「用了新标记的测试」，全等比对才是 ground truth。
    expected_by_title = dict(NOTES)
    dirty = []
    for title, expected in NOTES:
        nid = by_title.get(title)
        if nid is None:
            print(f"  [缺失] {title}")
            continue
        st, d = call("GET", f"/api/notes/{nid}")
        content = d.get("content", "")
        if content == expected:
            print(f"  [一致] #{nid} {title}  ({len(content)} 字符)")
            continue
        # 找出第一个不同处，便于人工核对到底被动过哪里
        n = min(len(content), len(expected))
        pos = next((i for i in range(n) if content[i] != expected[i]), n)
        dirty.append((title, nid, content, expected))
        print(f"  [不一致] #{nid} {title}: 实际 {len(content)} 字符 / 期望 {len(expected)} 字符"
              f"；首个差异位置 {pos}")
        print(f"           实际: …{content[max(0,pos-12):pos+20]!r}…")
        print(f"           期望: …{expected[max(0,pos-12):pos+20]!r}…")

    if CHECK_ONLY:
        print(f"\n审计完成：{len(dirty)} 篇与种子不一致")
        return 0

    if not dirty:
        print("\n无需修复（全部与种子一致）")
        return 0

    print()
    for title, nid, _actual, expected in dirty:
        st, _ = call("PATCH", f"/api/notes/{nid}", {"content": expected})
        st2, d2 = call("GET", f"/api/notes/{nid}")
        ok = d2.get("content", "") == expected
        print(f"  {'[已恢复]' if ok else '[失败!]'} #{nid} {title}  HTTP {st}  回读一致={ok}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
