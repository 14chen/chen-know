# -*- coding: utf-8 -*-
"""内容签名复核：对 manifest.csv 里 no-validator 的文件做「内容是否与扩展名匹配」的判定。

不看文件名/大小，只看内容特征 —— 因为这次损坏就是「内容张冠李戴」。
"""
import csv, io, json, os, re, sys

ROOT = r"D:\deepseekhums\work\知识库"
MANIFEST = os.path.join(ROOT, "manifest.csv")

# 各类型应有的内容特征
def looks_like(ext, head, text):
    e = ext.lower()
    t = text
    if e == ".java":
        return bool(re.search(r"(?m)^\s*(package\s+[\w.]+;|import\s+[\w.*]+;|/\*|//|@)", t[:4000]))
    if e in (".ts", ".tsx"):
        return bool(re.search(r"(?m)^\s*(import\s|export\s|//|/\*|type\s|interface\s|const\s|function\s)", t[:4000]))
    if e == ".json":
        try:
            json.loads(t); return True
        except Exception:
            return bool(re.match(r"^\s*[\[{]", t)) and False
    if e == ".css":
        return bool(re.search(r"[.#@:][\w-]+\s*[\{,]|@media|:root", t[:4000]))
    if e == ".properties":
        return bool(re.search(r"(?m)^\s*[\w.-]+\s*=", t[:4000]))
    if e == ".xml":
        return t.lstrip().startswith("<")
    if e == ".html":
        return bool(re.search(r"<(!doctype|html|head|body|div)", t[:2000], re.I))
    if e == ".md":
        return bool(re.search(r"(?m)^(#{1,6}\s|[-*+]\s|\|.*\||>|\w)", t[:2000]))
    if e == ".cmd":
        return bool(re.search(r"(?m)^\s*@?(echo|rem|set|if|goto|call)", t[:2000], re.I))
    if e == ".ps1":
        return bool(re.search(r"(?i)(function |param\(|\$\w+\s*=|Write-)", t[:4000]))
    if e == ".py":
        return bool(re.search(r"(?m)^\s*(import\s|from\s|def\s|#)", t[:3000]))
    if e == ".mjs" or e == ".js":
        return bool(re.search(r"(?m)^\s*(import\s|export\s|const\s|let\s|var\s|function\s|//|/\*|\(\))", t[:4000]))
    if e == ".sh":
        return t.lstrip().startswith("#!")
    if e == ".yml" or e == ".yaml":
        return bool(re.search(r"(?m)^\s*[\w.-]+\s*:", t[:2000]))
    if e == ".xml" or e == ".toml":
        return bool(re.search(r"=", t[:2000]))
    if e in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        b = head
        return (b[:8] == b"\x89PNG\r\n\x1a\n") or b[:2] == b"\xff\xd8" or b[:4] == b"GIF8" or (b[:4] == b"RIFF" and b[8:12] == b"WEBP")
    if e == ".jar" or e == ".zip":
        return head[:2] == b"PK"
    if e == ".sql":
        return bool(re.search(r"(?i)^\s*(--|create|insert|select|drop|alter|pragma)", t[:3000]))
    return None  # 未知类型 → 不强判

# 明显的「张冠李戴」指纹：某类内容出现在不该出现的扩展名里
CROSS = [
    ("pandas 源码", re.compile(r"inferred_dtype|pandas_dtype_func|NUMPY_FLOAT_TO_DTYPE")),
    ("webpack 打包产物", re.compile(r'webpackChunk|__webpack_require__|"use strict";\(self\["webpack')),
    ("TypeScript 声明文件", re.compile(r"//#region src/.*\.d\.cts|^type \w+<T =", re.M)),
    ("Windows PE 二进制特征", re.compile(r"VS_VERSION_INFO|QiYouDaemon|\\u0000")),
]

def main():
    rows = list(csv.DictReader(io.open(MANIFEST, encoding="utf-8-sig", newline="")))
    targets = [r for r in rows if r.get("content_status") == "no-validator"]
    print("manifest 总行数: %d   no-validator: %d" % (len(rows), len(targets)))

    buckets = {}
    bad = []
    for r in targets:
        rel = (r.get("rel_path") or "").replace("/", "\\")
        p = os.path.join(ROOT, rel)
        ext = os.path.splitext(p)[1]
        buckets[ext] = buckets.get(ext, 0) + 1
        if not os.path.exists(p):
            continue
        try:
            with open(p, "rb") as f:
                head = f.read(16)
                f.seek(0)
                raw = f.read()
        except Exception:
            continue
        if len(raw) > 3_000_000:
            raw = raw[:3_000_000]
        try:
            text = raw.decode("utf-8", "ignore")
        except Exception:
            text = ""
        ok = looks_like(ext, head, text)
        hits = [name for name, rx in CROSS if rx.search(text[:20000])]
        if ok is False or hits:
            bad.append((rel, ext, ok, hits))

    print("\n按扩展名分布（前 18）:")
    for ext, n in sorted(buckets.items(), key=lambda x: -x[1])[:18]:
        print("  %-12s %d" % (ext or "(无扩展名)", n))

    print("\n=== 判定为可疑的文件: %d 个 ===" % len(bad))
    for rel, ext, ok, hits in bad[:80]:
        print("  %s  (签名%s%s)" % (rel, "不匹配" if ok is False else "", (", " + "/".join(hits)) if hits else ""))
    if len(bad) > 80:
        print("  ... 还有 %d 个" % (len(bad) - 80))

    with open(os.path.join(os.environ.get("TEMP", "."), "audit-bad.json"), "w", encoding="utf-8") as f:
        json.dump([{"file": b[0], "ext": b[1], "sig_ok": b[2], "fingerprints": b[3]} for b in bad], f, ensure_ascii=False, indent=1)
    print("\n明细已写入 %TEMP%\\audit-bad.json")

main()
