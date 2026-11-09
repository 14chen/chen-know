# -*- coding: utf-8 -*-
"""Lead 独立验收：每日 AI 简报（契约 docs/BRIEFING.md §9）。

不重跑实现者的脚本，独立取证。用法：
    python verify_briefing.py <base_url> [--db <sqlite_path>]
"""
import http.cookiejar
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8090"
DB = None
if "--db" in sys.argv:
    DB = sys.argv[sys.argv.index("--db") + 1]

USER, PASS = "demo", "DemoPass123!"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

P = F = 0
FAILS = []


def check(name, ok, detail=""):
    global P, F
    if ok:
        P += 1
    else:
        F += 1
        FAILS.append(name + (" :: " + str(detail) if detail else ""))
    print(("  [PASS] " if ok else "  [FAIL] ") + name + ("  :: " + str(detail) if detail else ""))


def call(method, path, payload=None, timeout=240):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode("utf-8")) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return e.code, {"_raw": raw[:200].decode("utf-8", "replace")}


LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def main():
    st, _ = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
    if st != 200:
        print("登录失败 HTTP %s" % st)
        return 1
    print("=== 每日 AI 简报验收（%s）===" % BASE)

    # ---- 1. 源清单接口 ----
    print("\n--- 1. 源清单 ---")
    st, sources = call("GET", "/api/briefing/sources")
    items = sources.get("items") if isinstance(sources, dict) else None
    check("1.1 GET /api/briefing/sources 返回 200", st == 200, "HTTP %s" % st)
    check("1.2 源清单非空且 >= 6 个", bool(items) and len(items) >= 6, "count=%s" % (len(items) if items else 0))
    if items:
        kinds = sorted(set(i.get("kind", "?") for i in items))
        print("      源: " + ", ".join("%s(%s)" % (i.get("name"), i.get("kind")) for i in items))
        check("1.3 每个源都有 name/url/kind", all(i.get("name") and i.get("url") and i.get("kind") for i in items))
        check("1.4 源 URL 都是 https 绝对地址", all(str(i.get("url", "")).startswith("http") for i in items))

    # ---- 2. 真实生成 ----
    print("\n--- 2. 真实生成简报（联网）---")
    t0 = time.time()
    st, run = call("POST", "/api/briefing/run")
    elapsed = time.time() - t0
    check("2.1 POST /api/briefing/run 返回 200", st == 200, "HTTP %s" % st)
    print("      耗时 %.1fs  status=%s total=%s new=%s noteId=%s"
          % (elapsed, run.get("status"), run.get("totalItems"), run.get("newItems"), run.get("noteId")))
    check("2.2 抓取耗时 < 60s（并发抓取生效）", elapsed < 60, "%.1fs" % elapsed)
    check("2.3 抓到了内容 totalItems > 0", (run.get("totalItems") or 0) > 0, run.get("totalItems"))
    check("2.4 生成了笔记 noteId 非空", run.get("noteId"), run.get("noteId"))
    sr = run.get("sourceReport") or []
    ok_sources = [s for s in sr if s.get("ok")]
    print("      源明细: " + ", ".join("%s=%s" % (s.get("source"), s.get("count")) for s in sr))
    check("2.5 至少 5 个源成功取到内容", len([s for s in ok_sources if (s.get("count") or 0) > 0]) >= 5,
          "ok=%s" % len(ok_sources))

    note_id = run.get("noteId")
    if not note_id:
        print("\n（没有生成笔记，后续检查跳过）")
        return 1 if F else 0

    # ---- 3. 笔记正文 ----
    print("\n--- 3. 生成的笔记正文 ---")
    st, note = call("GET", "/api/notes/%s" % note_id)
    content = note.get("content") or ""
    title = note.get("title") or ""
    print("      标题: %s   正文 %d 字" % (title, len(content)))
    check("3.1 笔记可取回", st == 200, "HTTP %s" % st)
    check("3.2 标题含日期或「简报」", ("简报" in title) or bool(re.search(r"\d{4}-\d{2}-\d{2}", title)), title)
    links = LINK.findall(content)
    check("3.3 正文条目 >= 20 条", len(links) >= 20, "%d 条链接" % len(links))
    check("3.4 每条都有绝对 http(s) 链接", all(u.startswith("http") for _, u in links))
    check("3.5 正文不含未转义 HTML 标签",
          not re.search(r"<(?!br|/?mark|/?u|/?span)[a-zA-Z][^>]{0,60}>", content),
          re.findall(r"<[a-zA-Z][^>]{0,40}>", content)[:5])
    if links:
        print("      样例: " + " | ".join("%s -> %s" % (t[:22], u[:60]) for t, u in links[:3]))

    # ---- 4. 链接可达性抽样 ----
    print("\n--- 4. 抽样验证链接可达（5 条）---")
    sample = links[:5]
    reachable = 0
    for text, url in sample:
        try:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception:
            code = 0
        okk = 200 <= code < 400
        reachable += 1 if okk else 0
        print("      %s %s" % (code, url[:80]))
    check("4.1 抽样 5 条里至少 4 条可达", reachable >= 4, "%d/5" % reachable)

    # ---- 5. 去重 ----
    print("\n--- 5. 去重（连续第二次 run）---")
    st2, run2 = call("POST", "/api/briefing/run")
    print("      第二次 status=%s total=%s new=%s" % (run2.get("status"), run2.get("totalItems"), run2.get("newItems")))
    check("5.1 第二次 run 成功", st2 == 200, "HTTP %s" % st2)
    new2 = run2.get("newItems")
    first_new = run.get("newItems") or 0
    check("5.2 第二次新内容显著减少（去重生效）",
          new2 is not None and (new2 == 0 or (first_new > 0 and new2 <= max(3, first_new * 0.3))),
          "first=%s second=%s" % (first_new, new2))

    # ---- 6. 运行历史 ----
    print("\n--- 6. 运行历史 ---")
    st, runs = call("GET", "/api/briefing/runs?limit=10")
    ritems = runs.get("items") if isinstance(runs, dict) else None
    check("6.1 GET /api/briefing/runs 返回 200", st == 200, "HTTP %s" % st)
    check("6.2 历史里能看到刚才的 run", bool(ritems) and len(ritems) >= 2, "count=%s" % (len(ritems) if ritems else 0))
    if ritems:
        sts = [r.get("status") for r in ritems]
        check("6.3 状态字段取值合法", all(s in ("success", "partial", "failed", "running") for s in sts), sts)

    # ---- 7. 并发保护 ----
    print("\n--- 7. 并发保护 ---")
    with ThreadPoolExecutor(max_workers=2) as ex:
        codes = list(ex.map(lambda _: call("POST", "/api/briefing/run", timeout=240)[0], range(2)))
    print("      两个并发 POST 的返回码: %s" % codes)
    check("7.1 并发时至少一个是 409（另一个 200）", 409 in codes and 200 in codes, codes)

    # ---- 8. 库层核对 ----
    if DB:
        print("\n--- 8. 数据库层核对 ---")
        try:
            con = sqlite3.connect(DB)
            for t in ("briefing_runs", "briefing_seen"):
                n = con.execute("select count(*) from %s" % t).fetchone()[0]
                check("8.x 表 %s 存在且有数据" % t, n > 0, "%d 行" % n)
            dup = con.execute(
                "select url, count(*) c from briefing_seen group by space_id, url having c > 1").fetchall()
            check("8.3 briefing_seen 无重复 url", len(dup) == 0, dup[:3])
            con.close()
        except Exception as e:
            check("8.x 数据库核对", False, str(e))

    print("\n" + "=" * 60)
    print("结果：PASS %d   FAIL %d" % (P, F))
    for x in FAILS:
        print("  - " + x)
    print("=" * 60)
    return 1 if F else 0


if __name__ == "__main__":
    sys.exit(main())
