# -*- coding: utf-8 -*-
"""全仓内容复核 v2：直接扫磁盘上的项目文件，按内容签名判定。

不依赖 manifest —— 因为已验证 manifest 的 verified-ok 也不可信
（SchemaMigrationTest.java 就是被标 ok 却装着 pandas 源码）。
"""
import json, os, re, sys

ROOT = r"D:\deepseekhums\work\知识库"
SCAN_DIRS = ["backend/src", "frontend/src", "scripts", "tools", "docs"]

# 已知的「张冠李戴」指纹
CROSS = [
    ("pandas源码", re.compile(r"inferred_dtype|pandas_dtype_func|NUMPY_FLOAT_TO_DTYPE")),
    ("webpack产物", re.compile(r"webpackChunk|__webpack_require__")),
    ("TS声明文件", re.compile(r"//#region src/[\w.\/-]+\.d\.(c|m)?ts|^type \w+<T =", re.M)),
    ("PE二进制", re.compile(r"VS_VERSION_INFO|QiYouDaemon")),
    ("其他项目", re.compile(r"安全管理生产系统|企业综合管理系统")),
]

SIGS = {
    ".java":  [(r"(?m)^\s*(package\s+[\w.]+;|import\s+[\w.*]+;|/\*|//|@)", True)],
    ".ts":    [(r"(?m)^\s*(import\s|export\s|//|/\*|type\s|interface\s|const\s|declare\s)", True)],
    ".tsx":   [(r"(?m)^\s*(import\s|export\s|//|/\*|type\s|interface\s|const\s|function\s)", True)],
    ".css":   [(r"[.#@:][\w-]+\s*[\{,]|@media|:root|--[\w-]+:", True)],
    ".json":  [(r"^\s*[\[{]", True)],
    ".md":    [(r"(?m)^(#{1,6}\s|[-*+]\s|\||>|\S)", True)],
    ".cmd":   [(r"(?im)^\s*@?(echo|rem|set|if|goto|call)", True)],
    ".ps1":   [(r"(?i)(function |param\(|\$\w+\s*=|Write-)", True)],
    ".py":    [(r"(?m)^\s*(import\s|from\s|def\s|#|\"\"\")", True)],
    ".mjs":   [(r"(?m)^\s*(import\s|export\s|const\s|let\s|var\s|function\s|//|/\*|\(\))", True)],
    ".js":    [(r"(?m)^\s*(import\s|export\s|const\s|let\s|var\s|function\s|//|/\*|\(\))", True)],
    ".sql":   [(r"(?im)^\s*(--|create|insert|select|drop|alter|pragma)", True)],
    ".properties": [(r"(?m)^\s*[\w.-]+\s*=", True)],
    ".xml":   [(r"^\s*<", True)],
    ".html":  [(r"(?i)<(!doctype|html|head|body|div)", True)],
    ".yml":   [(r"(?m)^\s*[\w.-]+\s*:", True)],
    ".yaml":  [(r"(?m)^\s*[\w.-]+\s*:", True)],
}
BINARY = {".png": [b"\x89PNG"], ".jpg": [b"\xff\xd8"], ".jpeg": [b"\xff\xd8"],
          ".gif": [b"GIF8"], ".webp": [b"RIFF"], ".jar": [b"PK"], ".zip": [b"PK"],
          ".ico": [b"\x00\x00\x01\x00"]}

bad, checked, skipped = [], 0, 0
for d in SCAN_DIRS:
    base = os.path.join(ROOT, d.replace("/", os.sep))
    if not os.path.isdir(base):
        continue
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [x for x in dirnames if x not in ("node_modules", "target", ".git", "shots", "lab")]
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            ext = os.path.splitext(fn)[1].lower()
            try:
                size = os.path.getsize(p)
            except Exception:
                continue
            if size > 5_000_000:
                skipped += 1
                continue
            try:
                with open(p, "rb") as f:
                    raw = f.read()
            except Exception:
                continue
            checked += 1

            if ext in BINARY:
                if not any(raw.startswith(m) for m in BINARY[ext]):
                    bad.append((rel, "二进制魔数不匹配", ""))
                continue

            text = raw.decode("utf-8", "ignore")

            hits = [n for n, rx in CROSS if rx.search(text[:30000])]
            if hits:
                bad.append((rel, "内容疑似来自别的文件", "/".join(hits)))
                continue

            if ext in SIGS:
                pat = SIGS[ext][0][0]
                if not re.search(pat, text[:6000]):
                    head = text[:70].replace("\n", " ").replace("\r", " ")
                    bad.append((rel, "内容签名不匹配", head))
            else:
                skipped += 1

print("扫描目录: %s" % ", ".join(SCAN_DIRS))
print("已检查文件: %d   跳过(未知类型/过大): %d" % (checked, skipped))
print("\n=== 可疑文件: %d ===" % len(bad))
for rel, why, detail in bad:
    print("  [%s] %s" % (why, rel))
    if detail:
        print("        %s" % detail[:110])
out = os.path.join(os.environ.get("TEMP", "."), "audit-v2.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump([{"file": a, "why": b, "detail": c} for a, b, c in bad], f, ensure_ascii=False, indent=1)
print("\n明细: %s" % out)
