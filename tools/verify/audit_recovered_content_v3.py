# -*- coding: utf-8 -*-
"""全仓内容复核 v3（修正误报）：
- 排除第三方目录（浏览器 profile / node_modules / target / 构建产物 static/assets）
- 放宽 JS/CSS 签名（压缩产物的 import{ 无空格、注释开头的 CSS）
- 排除本脚本自身（含指纹字面量）
"""
import json, os, re

ROOT = r"D:\deepseekhums\work\知识库"
SCAN = ["backend/src/main/java", "backend/src/test/java", "backend/src/main/resources",
        "frontend/src", "scripts", "tools/verify", "docs"]
EXCLUDE_PARTS = ("node_modules", "target", os.sep + "static" + os.sep + "assets",
                 "edge-profile", "__pycache__", "shots")
SELF = {"audit_recovered_content.py", "audit_recovered_content_v2.py", "audit_recovered_content_v3.py"}

CROSS = [
    ("pandas源码", re.compile(r"inferred_dtype|pandas_dtype_func|NUMPY_FLOAT_TO_DTYPE")),
    ("webpack产物", re.compile(r"webpackChunk|__webpack_require__")),
    ("TS声明文件", re.compile(r"//#region src/[\w.\/-]+\.d\.(c|m)?ts|^type \w+<T =", re.M)),
    ("PE二进制", re.compile(r"VS_VERSION_INFO|QiYouDaemon")),
    ("其他项目内容", re.compile(r"安全管理生产系统|企业综合管理系统")),
]

SIG = {
    ".java": r"(?m)^\s*(package\s+[\w.]+;|import\s+[\w.*]+;|/\*|//|@)",
    ".ts":   r"(?m)^\s*(import[\s{]|export[\s{]|//|/\*|type\s|interface\s|const\s|declare\s)",
    ".tsx":  r"(?m)^\s*(import[\s{]|export[\s{]|//|/\*|type\s|interface\s|const\s|function\s)",
    ".css":  r"(/\*|@import|[.#@:][\w-]+\s*[\{,]|--[\w-]+\s*:)",
    ".json": r"^\s*[\[{]",
    ".md":   r"(?m)^(#{1,6}\s|[-*+]\s|\||>|\S)",
    ".cmd":  r"(?im)^\s*@?(echo|rem|set|if|goto|call)",
    ".ps1":  r"(?i)(function |param\(|\$\w+\s*=|Write-|#)",
    ".py":   r"(?m)^\s*(import\s|from\s|def\s|#|\"\"\")",
    ".mjs":  r"(?m)^\s*(import[\s{]|export[\s{]|const\s|let\s|var\s|function\s|//|/\*|\(\))",
    ".js":   r"(?m)^\s*(import[\s{]|export[\s{]}|const\s|let\s|var\s|function\s|//|/\*|\(\))",
    ".sql":  r"(?im)^\s*(--|create|insert|select|drop|alter|pragma|\.)",
    ".properties": r"(?m)^\s*[\w.-]+\s*=",
    ".xml":  r"^\s*<",
    ".html": r"(?i)<(!doctype|html|head|body|div|script)",
}
BIN = {".png": b"\x89PNG", ".jpg": b"\xff\xd8", ".jpeg": b"\xff\xd8",
       ".gif": b"GIF8", ".webp": b"RIFF", ".ico": b"\x00\x00\x01\x00", ".jar": b"PK"}

bad, checked, unknown = [], 0, 0
for d in SCAN:
    base = os.path.join(ROOT, d.replace("/", os.sep))
    if not os.path.isdir(base):
        continue
    for dirpath, dirnames, files in os.walk(base):
        dirnames[:] = [x for x in dirnames if not any(p.strip(os.sep) == x for p in EXCLUDE_PARTS)]
        if any(p in dirpath for p in EXCLUDE_PARTS):
            continue
        for fn in files:
            if fn in SELF:
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            ext = os.path.splitext(fn)[1].lower()
            try:
                if os.path.getsize(p) > 5_000_000:
                    continue
                raw = open(p, "rb").read()
            except Exception:
                continue
            checked += 1
            if ext in BIN:
                if not raw.startswith(BIN[ext]):
                    bad.append((rel, "二进制魔数不匹配", raw[:8].hex()))
                continue
            text = raw.decode("utf-8", "ignore")
            hits = [n for n, rx in CROSS if rx.search(text[:30000])]
            if hits:
                bad.append((rel, "内容疑似来自别的文件", "/".join(hits)))
                continue
            if ext in SIG:
                if not re.search(SIG[ext], text[:8000]):
                    bad.append((rel, "内容签名不匹配", text[:70].replace("\n", " ")))
            else:
                unknown += 1

print("扫描: %s" % "  ".join(SCAN))
print("已检查: %d 个文件   未判类型: %d" % (checked, unknown))
print("\n=== 可疑: %d ===" % len(bad))
for rel, why, det in bad:
    print("  [%s] %s" % (why, rel))
    if det:
        print("        %s" % det[:110])
if not bad:
    print("  （无）")
open(os.path.join(os.environ.get("TEMP", "."), "audit-v3.json"), "w", encoding="utf-8").write(
    json.dumps([{"file": a, "why": b, "detail": c} for a, b, c in bad], ensure_ascii=False, indent=1))
