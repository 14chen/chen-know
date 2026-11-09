# -*- coding: utf-8 -*-
"""Lead 独立验收：单篇导出 ZIP + 往返完整性六项（契约 docs/API.md §10.0）。

六项：①正文 ②图片字节 ③标签 ④目录 ⑤双链文本 ⑥front matter 元数据

用法：python verify_export_roundtrip.py <base_url>
"""
import http.cookiejar
import io
import json
import posixpath
import re
import struct
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
import zlib

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8090"
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


def call(method, path, payload=None, raw=None, ctype=None):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    elif raw is not None:
        body, headers["Content-Type"] = raw, ctype
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=120) as r:
            data = r.read()
            ct = r.headers.get("Content-Type", "")
            if "json" in ct or data[:1] in (b"{", b"["):
                return r.status, json.loads(data.decode("utf-8")) if data else {}
            return r.status, data
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data.decode("utf-8") or "{}")
        except Exception:
            return e.code, data[:200]


def png(w=10, h=10, rgb=(200, 60, 60)):
    def ch(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    rawpx = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + ch(b"IDAT", zlib.compress(rawpx)) + ch(b"IEND", b""))


def multipart(files):
    bd = "----kb" + uuid.uuid4().hex
    out = io.BytesIO()
    for rel, content in files:
        out.write(f"--{bd}\r\n".encode())
        out.write(f'Content-Disposition: form-data; name="file"; filename="{rel}"\r\n'.encode("utf-8"))
        out.write(b"Content-Type: application/octet-stream\r\n\r\n" + content + b"\r\n")
    out.write(f"--{bd}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={bd}"


IMG_REF = re.compile(r"!\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+\"[^\"]*\")?\s*\)|<img[^>]+src=[\"']([^\"']+)[\"']")


def refs_in(md):
    return [m.group(1) or m.group(2) for m in IMG_REF.finditer(md)]


def resolve(md_path, ref):
    if re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I) or ref.startswith("//"):
        return None
    return posixpath.normpath(posixpath.join(posixpath.dirname(md_path), ref)).lstrip("/")


def main():
    st, _ = call("POST", "/api/auth/login", {"username": "demo", "password": "DemoPass123!"})
    if st != 200:
        print(f"登录失败 HTTP {st}")
        return 1
    tag = uuid.uuid4().hex[:6]
    print(f"=== 单篇导出 ZIP 往返完整性（tag={tag}）===")

    ids_before = {n["id"] for n in (call("GET", "/api/notes?size=200")[1].get("items") or [])}
    folder_ids_before = set()

    def flat(nodes, acc):
        for x in nodes or []:
            acc.add(x["id"]); flat(x.get("children"), acc)
    flat(call("GET", "/api/folders?tree=true")[1], folder_ids_before)

    NID = None
    try:
        # ---------- 造一篇「六项齐全」的笔记 ----------
        print("\n--- 造测试数据 ---")
        st, p1 = call("POST", "/api/folders", {"parentId": None, "name": f"RT-T{tag}"})
        st2, p2 = call("POST", "/api/folders", {"parentId": p1["id"], "name": f"RT-Sub{tag}"})
        st3, other = call("POST", "/api/notes", {"folderId": None, "title": f"RT双链目标{tag}", "content": "# 目标\n"})

        st, note = call("POST", "/api/notes", {
            "folderId": p2["id"], "title": f"RT往返{tag}",
            "content": f"# RT往返{tag}\n\n第一段。引用 [[RT双链目标{tag}]] 一次。\n\n图片A：\n\n图片B：\n",
        })
        if st != 201:
            print(f"建笔记失败 HTTP {st}")
            return 1
        NID = note["id"]

        # 传两张图（noteId 关联）
        urls = []
        for i, rgb in enumerate([(200, 60, 60), (60, 120, 200)]):
            body, ct = multipart([(f"rt-{i}.png", png(rgb=rgb))])
            req = urllib.request.Request(BASE + f"/api/attachments", data=body, method="POST", headers={"Content-Type": ct})
            with opener.open(req, timeout=60) as r:
                a = json.loads(r.read().decode())
            urls.append(a["url"])
        # 再传一张**不写进正文**的图（验证「只打包引用到的」）
        body, ct = multipart([("unref.png", png(rgb=(10, 200, 10)))])
        req = urllib.request.Request(BASE + "/api/attachments", data=body, method="POST", headers={"Content-Type": ct})
        with opener.open(req, timeout=60) as r:
            unref = json.loads(r.read().decode())["url"]

        st, _ = call("PATCH", f"/api/notes/{NID}", {
            "content": f"# RT往返{tag}\n\n第一段。引用 [[RT双链目标{tag}]] 一次。\n\n图片A：\n\n![图A]({urls[0]})\n\n图片B：\n\n![图B]({urls[1]})\n",
        })
        call("POST", "/api/tags", {"name": f"RT标签{tag}", "color": "#16a34a"})
        call("PUT", f"/api/notes/{NID}/tags", {"tagNames": [f"RT标签{tag}"]})
        st, original = call("GET", f"/api/notes/{NID}")
        print(f"  原笔记 id={NID} 目录={p2['id']} 标签={[t['name'] for t in original.get('tags', [])]}")

        # ---------- 导出 ----------
        print("\n--- 导出单篇 ZIP ---")
        st, zbytes = call("GET", f"/api/export/notes/{NID}.zip")
        check("1.1 导出返回 ZIP", st == 200 and isinstance(zbytes, (bytes, bytearray)) and zbytes[:2] == b"PK",
              f"HTTP {st} {len(zbytes) if isinstance(zbytes,(bytes,bytearray)) else '?'} B")
        if not (isinstance(zbytes, (bytes, bytearray)) and zbytes[:2] == b"PK"):
            return 1

        zf = zipfile.ZipFile(io.BytesIO(zbytes))
        names = zf.namelist()
        print(f"  包内条目：{names}")
        mds = [n for n in names if n.endswith(".md")]
        atts = [n for n in names if n.startswith("attachments/")]
        check("1.2 包内有且只有 1 个 .md 且在包根", len(mds) == 1 and "/" not in mds[0], f"{mds}")
        check("1.3 包内有 2 个附件（正文引用到的）", len(atts) == 2, f"{atts}")
        check("1.4 包内含 manifest.json", "manifest.json" in names, f"{names}")
        check("1.5 未被引用的附件**没有**被打包", not any("unref" in a for a in atts), f"{atts}")

        md_path = mds[0]
        md_text = zf.read(md_path).decode("utf-8")
        refs = refs_in(md_text)
        print(f"  md 内图片引用：{refs}")
        check("1.6 md 引用前缀是 attachments/（无 ../）",
              len(refs) >= 2 and all(r.startswith("attachments/") for r in refs), f"{refs}")
        resolve_ok = all(resolve(md_path, r) in names for r in refs)
        check("1.7 每条引用按渲染器规则都能在包内找到", resolve_ok,
              str([(r, resolve(md_path, r)) for r in refs]))

        # ---------- 往返 ----------
        print("\n--- 重新导入这个 ZIP ---")
        body, ct = multipart([(f"rt-{tag}.zip", zbytes)])
        req = urllib.request.Request(BASE + "/api/import/markdown", data=body, method="POST", headers={"Content-Type": ct})
        with opener.open(req, timeout=180) as r:
            res = json.loads(r.read().decode())
        print(f"  {json.dumps(res, ensure_ascii=False)[:260]}")
        check("2.1 导入成功且图片挂上", res.get("imported", 0) == 1 and res.get("imagesImported", 0) >= 2,
              f"imported={res.get('imported')} images={res.get('imagesImported')}")

        st, lst = call("GET", "/api/notes?size=200")
        cands = [n for n in lst.get("items", []) if n["id"] not in ids_before and n["title"] == f"RT往返{tag}"]
        check("2.2 找到重建的笔记", len(cands) >= 1, f"{[c['id'] for c in cands]}")
        if not cands:
            return 1
        new_id = cands[0]["id"]
        st, rebuilt = call("GET", f"/api/notes/{new_id}")

        # 六项对照
        print("\n--- 往返完整性六项 ---")
        # ① 正文（图片引用会被改写成本库地址，所以比对时把引用归一化）
        norm = lambda s: re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"![\1](IMG)", s or "")
        check("六-1 正文一致（图片引用归一化后逐字相等）",
              norm(rebuilt.get("content")) == norm(original.get("content")),
              f"新={norm(rebuilt.get('content'))[:60]!r} 旧={norm(original.get('content'))[:60]!r}")
        # ② 图片字节
        new_refs = refs_in(rebuilt.get("content", ""))
        local = [r for r in new_refs if r.startswith("/api/")]
        bytes_ok = True
        got = []
        for r in local:
            st2, data = call("GET", r)
            if st2 != 200 or not isinstance(data, (bytes, bytearray)) or data[:4] != b"\x89PNG":
                bytes_ok = False
            got.append(len(data) if isinstance(data, (bytes, bytearray)) else -1)
        check("六-2 图片可取回且是 PNG", bytes_ok and len(local) == 2, f"{local} sizes={got}")
        # ③ 标签
        check("六-3 标签一致", [t["name"] for t in rebuilt.get("tags", [])] == [f"RT标签{tag}"],
              f"{[t['name'] for t in rebuilt.get('tags', [])]}")
        # ④ 目录 —— 注意 NoteDetail/NoteListItem **没有 folderName** 字段（只有 folderId，
        #    folderName 仅存在于回收站响应）。所以按 folderId 比对，再从目录树解析路径核对。
        def folder_path(tree, target_id):
            def walk(nodes, prefix):
                for x in nodes or []:
                    path = f"{prefix}{x['name']}"
                    if x["id"] == target_id:
                        return path
                    r = walk(x.get("children"), path + "/")
                    if r:
                        return r
                return None
            return walk(tree, "")

        _, tree_now = call("GET", "/api/folders?tree=true")
        want_path = f"RT-T{tag}/RT-Sub{tag}"
        got_path = folder_path(tree_now, rebuilt.get("folderId"))
        orig_path = folder_path(tree_now, original.get("folderId"))
        check("六-4 目录一致（folderId 相同且树中路径为 RT-T/RT-Sub）",
              rebuilt.get("folderId") == original.get("folderId") and got_path == want_path,
              f"folderId 新={rebuilt.get('folderId')} 旧={original.get('folderId')} 路径={got_path} 期望={want_path} 原路径={orig_path}")
        # ⑤ 双链文本
        check("六-5 双链文本保留", f"[[RT双链目标{tag}]]" in (rebuilt.get("content") or ""),
              (rebuilt.get("content") or "")[:80])
        # ⑥ front matter 元数据 -> 导出包里应有 title/tags/folder
        fm_ok = (f'title: "RT往返{tag}"' in md_text and f"RT标签{tag}" in md_text
                 and f"RT-T{tag}" in md_text)
        check("六-6 front matter 含 title/tags/folder", fm_ok,
              " | ".join(md_text.split("\n")[:8]))

        # 清理
        for nid in [NID, new_id, other["id"]]:
            call("DELETE", f"/api/notes/{nid}")
            call("DELETE", f"/api/trash/notes/{nid}")
    finally:
        print("\n--- 清理 ---")
        st, lst = call("GET", "/api/notes?size=200")
        removed = 0
        for n in lst.get("items", []):
            if n["id"] not in ids_before:
                call("DELETE", f"/api/notes/{n['id']}")
                call("DELETE", f"/api/trash/notes/{n['id']}")
                removed += 1
        print(f"  删除新增笔记 {removed} 篇")
        st, tree = call("GET", "/api/folders?tree=true")

        def depth_of(nodes, d=1, acc=None):
            acc = acc if acc is not None else {}
            for x in nodes or []:
                acc[x["id"]] = d; depth_of(x.get("children"), d + 1, acc)
            return acc
        depths = depth_of(tree)
        newf = [i for i in set(depths) - folder_ids_before]
        for fid in sorted(newf, key=lambda i: -depths.get(i, 1)):
            call("DELETE", f"/api/folders/{fid}")
            call("DELETE", f"/api/trash/folders/{fid}")
        print(f"  删除新增目录 {len(newf)} 个")
        st, tags = call("GET", "/api/tags")
        for t in tags if isinstance(tags, list) else []:
            if t["name"].startswith("RT标签"):
                call("DELETE", f"/api/tags/{t['id']}")
        print(f"  收尾：笔记 {(call('GET', '/api/notes?size=1')[1] or {}).get('total')} 篇")

    print(f"\n结果：PASS {PASS_N}   FAIL {FAIL_N}")
    for f in FAILS:
        print("  - " + f)
    return 1 if FAIL_N else 0


if __name__ == "__main__":
    sys.exit(main())
