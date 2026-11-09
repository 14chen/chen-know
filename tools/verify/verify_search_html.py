# -*- coding: utf-8 -*-
"""Lead 独立验收：search_blob 是否剥离了内联 HTML（本轮契约 §8）。

用法：python verify_search_html.py <base_url> <db_path>
"""
import http.cookiejar
import json
import sqlite3
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8090"
DB = sys.argv[2] if len(sys.argv) > 2 else None

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

PASS_N = FAIL_N = 0
FAILS = []


def check(name, ok, detail=""):
    global PASS_N, FAIL_N
    if ok:
        PASS_N += 1
    else:
        FAIL_N += 1
        FAILS.append(f"{name} :: {detail}")
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  :: {detail}" if detail else ""))


def call(method, path, payload=None):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode("utf-8")) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return e.code, {"_raw": raw[:200].decode("utf-8", "replace")}


def main():
    st, _ = call("POST", "/api/auth/login", {"username": "demo", "password": "DemoPass123!"})
    if st != 200:
        print(f"登录失败 HTTP {st}")
        return 1
    print(f"=== search_blob 剥离内联 HTML 验收（{BASE}）===")

    marker = "HTML剥离探针"
    content = (
        f"# {marker}\n\n"
        '这里有 <mark>高亮词</mark> 与 <u>下划线词</u> 与 '
        '<span style="color:#e11d48">红字词</span>。\n\n'
        "天气很好。\n"
    )
    st, note = call("POST", "/api/notes", {"folderId": None, "title": marker, "content": content})
    if st != 201:
        print(f"建笔记失败 HTTP {st}")
        return 1
    nid = note["id"]
    print(f"  测试笔记 id={nid}")

    try:
        # ① 搜正文文字 → 应命中
        for word, should in [("高亮词", True), ("下划线词", True), ("红字词", True),
                             ("天气", True), ("天", True),
                             ("color", False), ("span", False), ("style", False),
                             ("mark", False), ("rgb", False)]:
            st, res = call("GET", f"/api/search?q={urllib.request.quote(word)}")
            hits = [h for h in (res.get("items") or []) if h.get("title") == marker]
            got = len(hits) > 0
            check(f"搜「{word}」{'应命中' if should else '不应命中'}", got == should,
                  f"HTTP {st} 命中={got}")

        # ② 直接查库看 search_blob
        if DB:
            con = sqlite3.connect(DB)
            row = con.execute("select search_blob from notes where id = ?", (nid,)).fetchone()
            blob = row[0] if row else ""
            print(f"  search_blob 长度={len(blob)}")
            for bad in ["<mark>", "</mark>", "<u>", "</u>", "<span", "style=", "color:"]:
                check(f"search_blob 不含 {bad!r}", bad not in blob, blob[:120])
            check("search_blob 仍含正文文字", "高亮词" in blob.replace(" ", ""), blob[:120])
            con.close()
    finally:
        call("DELETE", f"/api/notes/{nid}")
        call("DELETE", f"/api/trash/notes/{nid}")
        print("  （测试笔记已清理）")

    print(f"\n结果：PASS {PASS_N}   FAIL {FAIL_N}")
    for f in FAILS:
        print("  - " + f)
    return 1 if FAIL_N else 0


if __name__ == "__main__":
    sys.exit(main())
