#!/usr/bin/env python3
"""验收：单篇导出 / 整库导出都是**合法 ZIP**，且包内 md + attachments + manifest 齐全、
正文引用的是包内真实存在的相对路径（解压后图片能直接显示）。

用法： python verify-export-zip.py [--base http://127.0.0.1:8091] [--user verify] [--pass VerifyPass123!]
只依赖标准库（urllib + zipfile + json + uuid）。
"""
import argparse
import io
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
import zipfile

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005"
    "0001ffabce36890000000049454e44ae426082"
)

results = []


def check(name, ok, extra=""):
    results.append((name, bool(ok), str(extra)[:300]))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "   >> " + str(extra)[:300]))


class Client:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.cookies = {}

    def _opener(self):
        import http.cookiejar

        jar = http.cookiejar.CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar

    def request(self, method, path, data=None, json_body=None, headers=None, raw=False):
        url = self.base + path
        hdrs = dict(headers or {})
        body = data
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        if self.cookies:
            hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                payload = resp.read()
                for header in resp.headers.get_all("Set-Cookie") or []:
                    kv = header.split(";")[0]
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        self.cookies[k.strip()] = v.strip()
                if raw:
                    return resp.status, payload
                try:
                    return resp.status, json.loads(payload.decode("utf-8"))
                except Exception:
                    return resp.status, payload
        except urllib.error.HTTPError as err:
            return err.code, err.read()

    def multipart(self, path, filename, content, mime):
        boundary = "----kb" + uuid.uuid4().hex
        lines = []
        lines.append(("--" + boundary).encode())
        lines.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode("utf-8"))
        lines.append(f"Content-Type: {mime}".encode())
        lines.append(b"")
        lines.append(content)
        lines.append(("--" + boundary + "--").encode())
        lines.append(b"")
        body = b"\r\n".join(lines)
        return self.request("POST", path, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8091")
    ap.add_argument("--user", default="verify")
    ap.add_argument("--pass", dest="password", default="VerifyPass123!")
    args = ap.parse_args()

    c = Client(args.base)
    status, _ = c.request("POST", "/api/auth/register", json_body={"username": args.user, "password": args.password, "displayName": "验收账号"})
    check("注册/确认验收账号", status in (200, 201, 400, 409), f"register status={status}")
    status, me = c.request("POST", "/api/auth/login", json_body={"username": args.user, "password": args.password})
    check("登录验收实例", status == 200, f"status={status} body={me}")

    # 1) 造一篇带图片的笔记
    mark = uuid.uuid4().hex[:6]
    title = f"QA-图片导出-{mark}"
    status, att = c.multipart("/api/attachments", f"qa-{mark}.png", PNG, "image/png")
    check("上传附件", status in (200, 201) and isinstance(att, dict) and att.get("id"), f"status={status} body={att}")
    att_id = att.get("id") if isinstance(att, dict) else None
    att_url = (att.get("url") if isinstance(att, dict) else None) or f"/api/attachments/{att_id}"

    status, note = c.request("POST", "/api/notes", json_body={"title": title, "content": f"# {title}\n\n![图]({att_url})\n"})
    check("创建笔记", status in (200, 201) and isinstance(note, dict) and note.get("id"), f"status={status} body={note}")
    note_id = note.get("id")

    # 2) 单篇导出 ZIP
    status, payload = c.request("GET", f"/api/export/notes/{note_id}.zip", raw=True)
    check("单篇导出返回 200", status == 200, f"status={status} body={payload[:200]!r}")
    check("单篇导出前两字节是 PK（合法 ZIP）", payload[:2] == b"PK", f"head={payload[:8]!r}")
    if payload[:2] != b"PK":
        print("\nRESULT passed %d/%d" % (sum(1 for r in results if r[1]), len(results)))
        return 1

    names = []
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = zf.namelist()
        md_names = [n for n in names if n.lower().endswith(".md")]
        check("包内有 1 个 .md", len(md_names) == 1, names)
        check("包内有 manifest.json", any(n.endswith("manifest.json") for n in names), names)
        att_entries = [n for n in names if n.startswith("attachments/")]
        check("包内有 attachments/", len(att_entries) >= 1, names)
        if md_names:
            text = zf.read(md_names[0]).decode("utf-8", "replace")
            check("正文不再引用 /api/attachments（改为包内相对路径）", "/api/attachments/" not in text, text[:200])
            import re

            refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text)
            check("正文有 1 条图片引用", len(refs) == 1, refs)
            if refs:
                ref = refs[0].lstrip("./")
                md_dir = os.path.dirname(md_names[0])
                resolved = os.path.normpath(os.path.join(md_dir, ref)).replace("\\", "/")
                check("引用路径在包内真实存在（解压后图能显示）", resolved in names, f"ref={ref} resolved={resolved} names={names}")
                check("该路径确实是刚上传的图片", resolved in att_entries, f"resolved={resolved} att={att_entries}")

    # 3) 整库导出
    status, payload_all = c.request("GET", "/api/export/all", raw=True)
    check("整库导出返回 200", status == 200, f"status={status}")
    check("整库导出前两字节是 PK", payload_all[:2] == b"PK", f"head={payload_all[:8]!r}")
    if payload_all[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(payload_all)) as zf:
            all_names = zf.namelist()
        check("整库包内含刚建的笔记", any(title in n for n in all_names), all_names[:8])
        check("整库包内有 attachments/", any(n.startswith("attachments/") for n in all_names), all_names[:8])

    # 4) 旧 .md 端点
    status, payload_md = c.request("GET", f"/api/export/notes/{note_id}.md", raw=True)
    check("旧的单篇 .md 端点仍在（向后兼容）", status == 200 and payload_md[:1] != b"P", f"status={status} head={payload_md[:20]!r}")

    # 5) 清理
    c.request("DELETE", f"/api/notes/{note_id}")
    c.request("DELETE", f"/api/trash/notes/{note_id}")
    if att_id:
        c.request("DELETE", f"/api/attachments/{att_id}")
    status, listing = c.request("GET", "/api/notes?size=200&sort=updated")
    left = [n for n in (listing.get("items") or []) if n.get("title", "").startswith("QA")] if isinstance(listing, dict) else []
    check("收尾：QA 夹具已清理", len(left) == 0, left)

    passed = sum(1 for r in results if r[1])
    print("\nRESULT passed %d/%d" % (passed, len(results)))
    if passed != len(results):
        print("FAILED:")
        for name, ok, extra in results:
            if not ok:
                print(f"  - {name} >> {extra}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
