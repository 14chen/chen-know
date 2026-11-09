# -*- coding: utf-8 -*-
"""Probe: which SQLite FTS5 strategy actually works for mixed Chinese/English substring search.

Hypothesis: index a normalized text where every CJK char is space-separated,
using tokenize='unicode61'. Then a query "天气" normalized to the phrase "天 气"
matches contiguously -> true substring search for 1+ CJK chars.
"""
import re
import sqlite3
import sys

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002ffff]")


def normalize(text: str) -> str:
    """Split every CJK char into its own token; leave Latin/digits intact."""
    out = []
    for ch in text:
        if CJK.match(ch):
            out.append(" ")
            out.append(ch)
            out.append(" ")
        else:
            out.append(ch)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def to_match_query(user_query: str) -> str:
    """Build an FTS5 MATCH expression: each CJK run becomes a quoted char phrase."""
    parts = normalize(user_query).split(" ")
    cjk_parts, latin, phrases = [], [], []
    for p in parts:
        if not p:
            continue
        if CJK.match(p[0]):
            cjk_parts.append(p)
        else:
            if cjk_parts:
                phrases.append('"' + " ".join(cjk_parts) + '"')
                cjk_parts = []
            phrases.append(p)
    if cjk_parts:
        phrases.append('"' + " ".join(cjk_parts) + '"')
    return " ".join(phrases)


def main() -> int:
    print("sqlite:", sqlite3.sqlite_version)
    db = sqlite3.connect(":memory:")
    db.execute("CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='unicode61')")

    docs = [
        "今天天气很好，适合出去散步",
        "Spring Boot 学习笔记与自动配置原理",
        "SQLite 全文检索实践：FTS5 分词器选择",
        "知识库设计方案 v2 与全文搜索",
        "FTS5 trigram tokenizer for Chinese substring search",
    ]
    for i, d in enumerate(docs, start=1):
        db.execute(
            "INSERT INTO notes_fts(rowid, title, body) VALUES (?,?,?)",
            (i, d, normalize(d)),
        )

    cases = [
        ("天气", [1]),
        ("今天", [1]),
        ("散步", [1]),
        ("气很", [1]),
        ("笔记", [2]),
        ("Boot", [2]),
        ("spring", [2]),
        ("分词器", [3]),
        ("FTS5", [3, 5]),
        ("知识库", [4]),
        ("trigram", [5]),
        ("不存在的词", []),
    ]
    failures = 0
    for q, expected in cases:
        expr = to_match_query(q)
        got = [r[0] for r in db.execute("SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?", (expr,))]
        ok = got == expected
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  query={q!r:14} expr={expr!r:24} got={got} expected={expected}")

    print()
    print("trigram availability:", end=" ")
    try:
        db.execute("CREATE VIRTUAL TABLE tg USING fts5(b, tokenize='trigram')")
        print("available")
    except Exception as exc:  # noqa: BLE001
        print("unavailable ->", exc)

    print("RESULT:", "ALL PASS" if failures == 0 else f"{failures} FAILURES")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
