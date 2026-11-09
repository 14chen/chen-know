# -*- coding: utf-8 -*-
"""Lead 的独立验收：导入图片 + 导出往返 + **外部 Markdown 工具可渲染性**。

不重跑实现者的脚本，独立取证。核心断言：
  导出 ZIP 解压后，用「Markdown 渲染器的解析规则」（相对该 .md 所在目录）
  解析每一条图片引用，必须落到磁盘上真实存在的文件 —— 这就是 Typora/Obsidian 的行为。

用法：python verify_import_images_lead.py <base_url>
"""
import http.cookiejar
import io
import json
import os
import posixpath
import re
import shutil
import struct
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
import zipfile
import zlib

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8090"
USER, PASS = "demo", "DemoPass123!"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

PASS_N = 0
FAIL_N = 0
FAILS = []


def check(name, ok, detail=""):
    global PASS_N, FAIL_N
    if ok:
        PASS_N += 1
    else:
        FAIL_N += 1
        FAILS.append(f"{name} :: {detail}")
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  :: {detail}" if detail else ""))


def call(method, path, payload=None, raw=None, content_type=None):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    elif raw is not None:
        body = raw
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=120) as r:
            data = r.read()
            return r.status, (json.loads(data.decode("utf-8")) if data[:1] in (b"{", b"[") else data)
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data.decode("utf-8") or "{}")
        except Exception:
            return e.code, data


def png(w=10, h=10, rgb=(200, 60, 60)):
    def ch(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))


def multipart(files):
    """files: [(relative_path, bytes)]  —— filename 直接携带相对路径"""
    b = "----kb" + uuid.uuid4().hex
    out = io.BytesIO()
    for rel, content in files:
        out.write(f"--{b}\r\n".encode())
        out.write(f'Content-Disposition: form-data; name="file"; filename="{rel}"\r\n'.encode("utf-8"))
        out.write(b"Content-Type: application/octet-stream\r\n\r\n")
        out.write(content + b"\r\n")
    out.write(f"--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"


IMG_REF = re.compile(r"!\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+\"[^\"]*\")?\s*\)|<img[^>]+src=[\"']([^\"']+)[\"']")


def image_refs(md_text):
    out = []
    for m in IMG_REF.finditer(md_text):
        out.append(m.group(1) or m.group(2))
    return out


def resolve_like_markdown(md_path, ref):
    """完全按 Markdown 渲染器的规则：相对该 .md 文件所在目录解析。"""
    if re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I) or ref.startswith("//"):
        return None  # 外部地址，不参与本地解析
    base = posixpath.dirname(md_path)
    return posixpath.normpath(posixpath.join(base, ref)).lstrip("/")


def main():
    st, _ = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
    if st != 200:
        print(f"登录失败 HTTP {st}")
        return 1
    tag = uuid.uuid4().hex[:6]
    print(f"=== Lead 独立验收（tag={tag}）===")

    created = []
    extract_dir = None
    # 快照运行前的笔记 id —— 收尾时删掉本次新增的全部笔记（比按标题匹配可靠）
    st, snap = call("GET", "/api/notes?size=200")
    ids_before = {n["id"] for n in snap.get("items", [])}
    st, tree_before = call("GET", "/api/folders?tree=true")

    def flat_ids(nodes, acc=None):
        acc = acc if acc is not None else set()
        for x in nodes or []:
            acc.add(x["id"])
            flat_ids(x.get("children"), acc)
        return acc

    folder_ids_before = flat_ids(tree_before)
    try:
        # ---------- A. 在嵌套目录里建一篇带附件的笔记（走真实上传） ----------
        print("\n--- A. 造真实附件并插入引用 ---")
        st, folder = call("POST", "/api/folders", {"parentId": None, "name": f"L验收{tag}"})
        parent = folder["id"]
        st, sub = call("POST", "/api/folders", {"parentId": parent, "name": "子目录"})
        sub_id = sub["id"]

        st, note = call("POST", "/api/notes", {"folderId": sub_id, "title": f"L往返{tag}", "content": "占位"})
        nid = note["id"]
        created.append(nid)

        png_a = png(rgb=(200, 60, 60))
        body, ct = multipart([("a.png", png_a)])
        # 附件上传走附件接口（multipart 字段名 file）
        req = urllib.request.Request(BASE + "/api/attachments", data=body, method="POST",
                                     headers={"Content-Type": ct})
        with opener.open(req, timeout=60) as r:
            att_status = r.status          # 必须在 with 内取，出了块响应已关闭
            att = json.loads(r.read().decode())
        # API.md §7：POST /api/attachments 规定返回 201（创建资源）
        check("A1 附件上传成功（契约规定 201）",
              att_status == 201 and att.get("url", "").startswith("/api/attachments/"),
              f"HTTP {att_status} url={att.get('url')}")

        st, _ = call("PATCH", f"/api/notes/{nid}",
                     {"content": f"# 往返测试\n\n渲染器按 md 所在目录找图：\n\n![图A]({att['url']})\n\n还要覆盖 HTML 形式：\n\n<img src=\"{att['url']}\">\n"})

        # ---------- B. 导出 ZIP ----------
        print("\n--- B. 导出 ZIP 并检查包内结构 ---")
        req = urllib.request.Request(BASE + "/api/export/all")
        with opener.open(req, timeout=180) as r:
            zip_bytes = r.read()
        check("B1 导出返回 ZIP", zip_bytes[:2] == b"PK", f"{len(zip_bytes)} B")

        extract_dir = tempfile.mkdtemp(prefix=f"kb-lead-verify-{tag}-")
        zpath = os.path.join(extract_dir, "export.zip")
        with open(zpath, "wb") as f:
            f.write(zip_bytes)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            names = z.namelist()
            z.extractall(os.path.join(extract_dir, "unpacked"))

        att_entries = [n for n in names if n.startswith("attachments/")]
        check("B2 ZIP 内有 attachments/ 条目", len(att_entries) >= 1, f"{att_entries}")
        md_entries = [n for n in names if n.startswith("notes/") and n.endswith(".md")]
        mine = [n for n in md_entries if f"L往返{tag}" in n]
        check("B3 那篇笔记在嵌套路径下", len(mine) == 1, f"{mine}")
        if not mine:
            return 1
        note_entry = mine[0]
        # dir_levels = 该 md 所在目录的层数 = 路径里的斜杠数
        #   notes/x.md              → 1 → ../
        #   notes/技术/x.md          → 2 → ../../
        #   notes/技术/前端/x.md      → 3 → ../../../
        dir_levels = note_entry.count("/")
        expected_prefix = "../" * dir_levels
        check("B4 笔记位于嵌套目录（用于验证 ../ 层级）", dir_levels >= 3,
              f"{note_entry} 目录层数={dir_levels}")

        # ---------- C. 关键：按 Markdown 渲染器规则解析引用 ----------
        print("\n--- C. 外部 Markdown 工具可渲染性（本项最有价值）---")
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            md_text = z.read(note_entry).decode("utf-8")

        refs = image_refs(md_text)
        print(f"    正文里的图片引用：{refs}")
        check("C1 引用已被重写（不再是 /api/attachments/）",
              all("/api/attachments/" not in x for x in refs) and len(refs) >= 2,
              f"{refs}")
        check("C2 引用带正确的 ../ 层级",
              all(x.startswith(expected_prefix + "attachments/") for x in refs),
              f"期望前缀 {expected_prefix}attachments/，实际 {refs}")

        unpacked_root = os.path.join(extract_dir, "unpacked")
        all_ok = True
        for ref in refs:
            resolved = resolve_like_markdown(note_entry, ref)
            disk = os.path.join(unpacked_root, resolved.replace("/", os.sep))
            exists = os.path.exists(disk)
            if not exists:
                all_ok = False
            print(f"      {ref}\n        → 解析为 {resolved} → {'存在' if exists else '❌ 不存在'}")
        check("C3 每条引用按渲染器规则都能落到真实文件", all_ok, f"{len(refs)} 条")

        # 字节一致性
        if refs:
            resolved = resolve_like_markdown(note_entry, refs[0])
            with open(os.path.join(unpacked_root, resolved.replace("/", os.sep)), "rb") as f:
                check("C4 解出的图与原图字节一致", f.read() == png_a, f"期望 {len(png_a)} B")

        # ---------- D. 导出 → 再导入（用最小包，避免把全库笔记重复导入） ----------
        print("\n--- D. 导出包重新导入（往返自证）---")
        # 只取「我那篇笔记 + attachments/」，打成一个小 ZIP 再导入 ——
        # 直接导回整包会把库里 24 篇演示笔记和目录全部复制一份，属于测试污染。
        mini = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z, \
             zipfile.ZipFile(mini, "w", zipfile.ZIP_DEFLATED) as out:
            out.writestr(note_entry, z.read(note_entry))
            for n in att_entries:
                out.writestr(n, z.read(n))
        mini_bytes = mini.getvalue()
        print(f"    最小包：{note_entry} + {len(att_entries)} 个附件（{len(mini_bytes)} B）")

        st, stats_before = call("GET", "/api/stats")

        body, ct = multipart([("roundtrip.zip", mini_bytes)])
        req = urllib.request.Request(BASE + "/api/import/markdown", data=body, method="POST",
                                     headers={"Content-Type": ct})
        with opener.open(req, timeout=300) as r:
            res = json.loads(r.read().decode())
        print(f"    {json.dumps(res, ensure_ascii=False)[:300]}")
        check("D1 重新导入有图片被挂上", res.get("imagesImported", 0) >= 1,
              f"imagesImported={res.get('imagesImported')}")
        check("D2 只建了 1 篇（最小包）", res.get("imported", 0) == 1, f"imported={res.get('imported')}")

        # 校验重建出来的那篇：引用已改回 /api/attachments/ 且取得到
        st, lst2 = call("GET", "/api/notes?size=200")
        copies = [n for n in lst2.get("items", []) if f"L往返{tag}" in n["title"]]
        # 取 id 最大的一篇（最可能是重建的）
        copies.sort(key=lambda x: x["id"])
        rebuilt = copies[-1] if copies else None
        check("D3 找到重建的笔记", rebuilt is not None, f"{[c['id'] for c in copies]}")
        if rebuilt:
            st, d = call("GET", f"/api/notes/{rebuilt['id']}")
            refs2 = image_refs(d.get("content", ""))
            print(f"      重建后引用：{refs2}")
            check("D4 重建后引用指向本库附件", all(x.startswith("/api/attachments/") for x in refs2) and len(refs2) >= 2,
                  f"{refs2}")
            ok_fetch = True
            for ref in refs2:
                if ref.startswith("/api/"):
                    st, data = call("GET", ref)
                    if st != 200 or not isinstance(data, bytes) or data[:4] != b"\x89PNG":
                        ok_fetch = False
            check("D5 重建后的图都能取到且是真 PNG", ok_fetch)
            created.append(rebuilt["id"])

        st, stats_after = call("GET", "/api/stats")
        check("D6 附件总数确实增加了", stats_after.get("attachmentCount", 0) > stats_before.get("attachmentCount", 0),
              f"{stats_before.get('attachmentCount')} → {stats_after.get('attachmentCount')}")

        # ---------- E. 缺图报告 ----------
        print("\n--- E. 缺图与非法路径 ---")
        md_missing = f"# 缺图{tag}\n\n第一行\n![缺](images/never-exists-{tag}.png)\n".encode()
        body, ct = multipart([(f"缺图{tag}.md", md_missing)])
        req = urllib.request.Request(BASE + "/api/import/preview", data=body, method="POST",
                                     headers={"Content-Type": ct})
        with opener.open(req, timeout=120) as r:
            prev = json.loads(r.read().decode())
        miss = prev.get("missingImages", [])
        check("E1 preview 报出缺图", any(f"never-exists-{tag}" in m.get("target", "") for m in miss),
              f"{json.dumps(miss, ensure_ascii=False)[:200]}")
        if miss:
            m = [x for x in miss if f"never-exists-{tag}" in x.get("target", "")][0]
            check("E2 缺图条目含行号与原因", isinstance(m.get("line"), int) and bool(m.get("reason")),
                  f"line={m.get('line')} reason={m.get('reason')}")

        st, stats_p = call("GET", "/api/stats")
        check("E3 preview 不写库（附件数不变）", stats_p.get("attachmentCount") == stats_after.get("attachmentCount"),
              f"{stats_after.get('attachmentCount')} → {stats_p.get('attachmentCount')}")

        # 非法路径
        body, ct = multipart([("../../evil.md", b"# evil\n")])
        req = urllib.request.Request(BASE + "/api/import/markdown", data=body, method="POST",
                                     headers={"Content-Type": ct})
        with opener.open(req, timeout=60) as r:
            res_evil = json.loads(r.read().decode())
        check("E4 路径穿越被拒且不建笔记", res_evil.get("imported", 0) == 0 and len(res_evil.get("errors", [])) >= 1,
              f"{json.dumps(res_evil, ensure_ascii=False)[:200]}")

    finally:
        # 清理：删掉本次运行**新增**的所有笔记与目录（按 id 差集，比按标题匹配可靠）
        print("\n--- 清理 ---")
        st, lst = call("GET", "/api/notes?size=200")
        removed = 0
        for n in lst.get("items", []):
            if n["id"] not in ids_before:
                call("DELETE", f"/api/notes/{n['id']}")
                call("DELETE", f"/api/trash/notes/{n['id']}")
                removed += 1
        print(f"    删除新增笔记 {removed} 篇")

        st, tree = call("GET", "/api/folders?tree=true")
        new_folders = flat_ids(tree) - folder_ids_before
        # 先删深的（子目录），再删浅的 —— 删除目录会级联带走子孙，顺序错会出现「已不存在」
        def depth_of(nodes, d=1):
            out = {}
            for x in nodes or []:
                out[x["id"]] = d
                out.update(depth_of(x.get("children"), d + 1))
            return out

        depths = depth_of(tree)
        for fid in sorted(new_folders, key=lambda i: -depths.get(i, 1)):
            call("DELETE", f"/api/folders/{fid}")
            call("DELETE", f"/api/trash/folders/{fid}")
        print(f"    删除新增目录 {len(new_folders)} 个")

        st, lst2 = call("GET", "/api/notes?size=200")
        print(f"    收尾核对：库中笔记 {lst2.get('total')} 篇（运行前 {len(ids_before)} 篇）")
        if extract_dir and os.path.isdir(extract_dir):
            shutil.rmtree(extract_dir, ignore_errors=True)
        print("    完成")

    print("\n" + "=" * 64)
    print(f"Lead 独立验收：PASS {PASS_N}   FAIL {FAIL_N}")
    for f in FAILS:
        print("  - " + f)
    print("=" * 64)
    return 1 if FAIL_N else 0


if __name__ == "__main__":
    sys.exit(main())
