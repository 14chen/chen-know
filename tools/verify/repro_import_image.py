# -*- coding: utf-8 -*-
"""复现「导入的 md 图片显示不出来」。

造一个 ZIP：notes/a.md（引用 notes/images/pic.png）+ notes/images/pic.png
导入后检查：① 笔记正文里的图片引用是什么 ② 图能不能取到
"""
import http.cookiejar
import io
import json
import struct
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
import zlib

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8080"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


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
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return exc.code, {"_raw": raw[:200].decode("utf-8", "replace")}


def make_png(w=8, h=8, rgb=(80, 120, 200)):
    """不依赖 Pillow 的最小 PNG"""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def multipart(fields, files):
    boundary = "----kb" + uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f"--{boundary}\r\n".encode())
        out.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        out.write(v.encode("utf-8") + b"\r\n")
    for name, filename, mime, content in files:
        out.write(f"--{boundary}\r\n".encode())
        out.write(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"))
        out.write(f"Content-Type: {mime}\r\n\r\n".encode())
        out.write(content + b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def main():
    tag = uuid.uuid4().hex[:6]
    png = make_png()
    md = f"""# 导入图片测试 {tag}

下面是一张相对路径引用的图：

![我的图片](images/pic.png)

还有一张同目录的：

![同级图](same.png)

以及一张网络图（对照）：

![网络图](https://example.com/nonexistent.png)
""".encode("utf-8")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"notes/图片测试{tag}.md", md)
        z.writestr("notes/images/pic.png", png)
        z.writestr("notes/same.png", png)

    st, _ = call("POST", "/api/auth/login", {"username": "demo", "password": "DemoPass123!"})
    print(f"登录: {st}")

    print("\n=== 导入前：附件数 ===")
    st, stats = call("GET", "/api/stats")
    print(f"  attachmentCount = {stats.get('attachmentCount')}")

    print("\n=== 导入 ZIP ===")
    body, ct = multipart({}, [("file", f"images-{tag}.zip", "application/zip", buf.getvalue())])
    req = urllib.request.Request(BASE + "/api/import/markdown", data=body, method="POST",
                                 headers={"Content-Type": ct})
    with opener.open(req, timeout=60) as r:
        result = json.loads(r.read().decode())
    print(f"  结果: {json.dumps(result, ensure_ascii=False)}")

    print("\n=== 导入后：找那篇笔记 ===")
    st, lst = call("GET", "/api/notes?size=200")
    note = next((n for n in lst.get("items", []) if f"图片测试{tag}" in n["title"]), None)
    if not note:
        print("  ❌ 没找到导入的笔记")
        return 1
    st, d = call("GET", f"/api/notes/{note['id']}")
    content = d.get("content", "")
    print(f"  笔记 id={note['id']}  标题={note['title']}")
    print("  正文里的图片引用：")
    for line in content.splitlines():
        if "![" in line:
            print(f"    {line}")

    print("\n=== 导入后：附件数 ===")
    st, stats2 = call("GET", "/api/stats")
    print(f"  attachmentCount = {stats2.get('attachmentCount')}（导入前 {stats.get('attachmentCount')}）")

    print("\n=== 逐条尝试取图 ===")
    import re
    for m in re.finditer(r"!\[([^\]]*)\]\(([^)]+)\)", content):
        alt, src = m.group(1), m.group(2)
        if src.startswith("http"):
            print(f"  「{alt}」→ {src}  （外部地址，本机不可达属正常）")
            continue
        url = BASE + "/" + src.lstrip("./")
        try:
            with opener.open(urllib.request.Request(url), timeout=10) as r:
                print(f"  「{alt}」→ {src}  → HTTP {r.status} {len(r.read())} B")
        except urllib.error.HTTPError as e:
            print(f"  「{alt}」→ {src}  → ❌ HTTP {e.code}")
        except Exception as e:
            print(f"  「{alt}」→ {src}  → ❌ {e}")

    # 清理
    call("DELETE", f"/api/notes/{note['id']}")
    call("DELETE", f"/api/trash/notes/{note['id']}")
    print(f"\n（已清理测试笔记）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
