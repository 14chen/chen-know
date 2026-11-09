#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端验收工具 —— 按 docs/VERIFY.md 的 A~O 节逐项验证真实后端。

用 Python 而非 PowerShell 的原因：本机是 PowerShell 5.1，向 curl.exe 传中文参数会走
ANSI 代码页被吃掉（三个实现者都踩过这个坑）。urllib 是标准库，无额外依赖。

用法：
    python tools/verify/e2e-acceptance.py http://127.0.0.1:8080 [--fresh]

--fresh  表示目标是一个全新的空库（会走「首个用户免邀请码成为 admin」的分支并断言）。
         不加 --fresh 时跳过 B1 与 B2 的限流测试（它们会污染账号状态）。
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import io

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8080"
FRESH = "--fresh" in sys.argv

PASS, FAIL, SKIP = [], [], []


def check(name: str, ok: bool, detail: str = "") -> bool:
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  :: {detail}" if detail else ""))
    return ok


def skip(name: str, why: str) -> None:
    SKIP.append(name)
    print(f"  [SKIP] {name}  :: {why}")


class Client:
    """每个实例一个独立会话（cookie jar）。"""

    def __init__(self, base: str = BASE) -> None:
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            NoRedirect(),
        )
        self.last_headers: dict[str, str] = {}

    def raw(self, method: str, path: str, body: bytes | None = None,
            headers: dict[str, str] | None = None) -> tuple[int, bytes, dict[str, str]]:
        url = path if path.startswith("http") else self.base + path
        req = urllib.request.Request(url, data=body, method=method)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with self.opener.open(req, timeout=60) as resp:
                data = resp.read()
                hdrs = {k.lower(): v for k, v in resp.getheaders()}
                self.last_headers = hdrs
                return resp.status, data, hdrs
        except urllib.error.HTTPError as exc:
            data = exc.read()
            hdrs = {k.lower(): v for k, v in exc.headers.items()}
            self.last_headers = hdrs
            return exc.code, data, hdrs

    def json(self, method: str, path: str, payload=None,
             headers: dict[str, str] | None = None) -> tuple[int, dict]:
        body = None
        hdrs = dict(headers or {})
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json; charset=utf-8")
        status, data, _ = self.raw(method, path, body, hdrs)
        try:
            return status, json.loads(data.decode("utf-8"))
        except Exception:
            return status, {"_raw": data[:400].decode("utf-8", "replace")}

    def cookie_names(self) -> list[str]:
        return [c.name for c in self.jar]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


# ---------------------------------------------------------------- 工具

def multipart(fields: dict[str, str], files: list[tuple[str, str, str, bytes]]) -> tuple[bytes, str]:
    """files: [(field_name, filename, mime, content)]"""
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


def err_code(body: dict) -> str:
    return (body.get("error") or {}).get("code", "")


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


# ---------------------------------------------------------------- B 认证

def section_b() -> dict:
    section("B. 认证与授权（API.md §1 §2）")
    out: dict = {}
    admin = Client()

    if FRESH:
        u = "adm_" + uuid.uuid4().hex[:8]
        st, body = admin.json("POST", "/api/auth/register",
                              {"username": u, "displayName": "管理员", "password": "AdminPass123!"})
        check("B1 空库首个注册 → 201 且 role=admin", st == 201 and body.get("role") == "admin",
              f"HTTP {st} role={body.get('role')}")
        st, _ = admin.json("POST", "/api/auth/login", {"username": u, "password": "AdminPass123!"})
        check("B1b 登录成功", st == 200, f"HTTP {st}")
        out["admin_user"], out["admin_pass"] = u, "AdminPass123!"
    else:
        out["admin_user"] = os.environ.get("KB_ADMIN_USER", "alice")
        out["admin_pass"] = os.environ.get("KB_ADMIN_PASS", "adminPass123")
        skip("B1 首个注册即 admin", "非空库模式（需 --fresh）")

    # B3 Cookie 属性
    admin = Client()
    st, _ = admin.json("POST", "/api/auth/login",
                       {"username": out["admin_user"], "password": out["admin_pass"]})
    sc = admin.last_headers.get("set-cookie", "")
    check("B3 登录 → 200 且下发 KB_SESSION", st == 200 and "KB_SESSION" in sc,
          f"HTTP {st}; Set-Cookie={sc[:120]}")
    check("B3b Cookie 带 HttpOnly", "httponly" in sc.lower(), sc[:120])
    check("B3c Cookie 带 SameSite=Lax", "samesite=lax" in sc.lower().replace(" ", ""), sc[:120])

    st, body = admin.json("GET", "/api/auth/me")
    check("B4 带 Cookie 访问 /api/auth/me → 200", st == 200, f"HTTP {st}")

    anon = Client()
    st, body = anon.json("GET", "/api/notes")
    check("B5 无 Cookie 访问 /api/notes → 401 UNAUTHORIZED",
          st == 401 and err_code(body) == "UNAUTHORIZED", f"HTTP {st} code={err_code(body)}")

    # 成员账号：注册（需要邀请码）或复用
    member = Client()
    mname = "mem_" + uuid.uuid4().hex[:8]
    st, inv = admin.json("POST", "/api/admin/invites", {"expiresInHours": 24})
    if st == 201:
        st2, mbody = member.json("POST", "/api/auth/register",
                                 {"username": mname, "displayName": "成员", "password": "MemberPass123!",
                                  "inviteCode": inv.get("code")})
        check("B6 凭邀请码注册成员 → 201", st2 == 201, f"HTTP {st2} {mbody}")
        if st2 == 201:
            member.json("POST", "/api/auth/login", {"username": mname, "password": "MemberPass123!"})
    else:
        skip("B6 邀请码注册成员", f"发邀请码失败 HTTP {st}")

    st, body = member.json("GET", "/api/admin/users")
    check("B6b 成员访问 /api/admin/** → 403 FORBIDDEN",
          st == 403 and err_code(body) == "FORBIDDEN", f"HTTP {st} code={err_code(body)}")

    if FRESH:
        rate = Client()
        rname = "rate_" + uuid.uuid4().hex[:8]
        rate.json("POST", "/api/auth/register",
                  {"username": rname, "displayName": "限流", "password": "RatePass123!",
                   "inviteCode": (admin.json("POST", "/api/admin/invites", {})[1] or {}).get("code")})
        codes = []
        for _ in range(6):
            st, _ = rate.json("POST", "/api/auth/login", {"username": rname, "password": "WrongPass999"})
            codes.append(st)
        check("B2 连续 5 次错密码后第 6 次 → 429", codes[-1] == 429, f"codes={codes}")

    tmp = Client()
    tmp.json("POST", "/api/auth/login", {"username": out["admin_user"], "password": out["admin_pass"]})
    st, _ = tmp.json("POST", "/api/auth/logout")
    st2, body = tmp.json("GET", "/api/auth/me")
    check("B7 登出后 /api/auth/me → 401", st2 == 401, f"logout HTTP {st}; me HTTP {st2}")

    out["admin"] = admin
    out["member"] = member
    return out


# ---------------------------------------------------------------- C 目录

def section_c(ctx: dict) -> dict:
    section("C. 目录树（API.md §3）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]
    ids: dict[str, int] = {}

    st, b = a.json("POST", "/api/folders", {"parentId": None, "name": f"技术-{tag}"})
    ids["tech"] = b.get("id")
    check("C1 建根目录「技术」→ 201", st == 201, f"HTTP {st} id={b.get('id')}")

    st, b = a.json("POST", "/api/folders", {"parentId": None, "name": f"生活-{tag}"})
    ids["life"] = b.get("id")
    check("C1b 建根目录「生活」→ 201", st == 201, f"HTTP {st} id={b.get('id')}")

    st, b = a.json("POST", "/api/folders", {"parentId": ids["tech"], "name": f"Java-{tag}"})
    ids["java"] = b.get("id")
    check("C2 建子目录「Java」→ 201", st == 201, f"HTTP {st} id={b.get('id')}")

    st, tree = a.json("GET", "/api/folders?tree=true")
    tech = next((n for n in tree if n.get("id") == ids["tech"]), None) if isinstance(tree, list) else None
    nested = tech and any(c.get("id") == ids["java"] for c in tech.get("children", []))
    check("C2b 树里「技术」的 children 含「Java」", bool(nested),
          f"children={[c.get('name') for c in (tech or {}).get('children', [])]}")

    st, _ = a.json("PATCH", f"/api/folders/{ids['life']}", {"name": f"日常-{tag}"})
    st2, tree2 = a.json("GET", "/api/folders?tree=true")
    renamed = any(n.get("name") == f"日常-{tag}" for n in tree2) if isinstance(tree2, list) else False
    check("C3 重命名「生活」→「日常」生效", st == 200 and renamed, f"HTTP {st} renamed={renamed}")

    st, body = a.json("PATCH", f"/api/folders/{ids['tech']}", {"parentId": ids["java"]})
    check("C4 把目录移进自己的子孙 → 400", st == 400, f"HTTP {st} code={err_code(body)}")

    st, _ = a.json("PATCH", f"/api/folders/{ids['tech']}", {"parentId": ids["tech"]})
    check("C4b 把目录移到自己下面 → 400", st == 400, f"HTTP {st}")

    st, _ = a.json("POST", "/api/notes", {"folderId": ids["java"], "title": f"C5子目录笔记-{tag}",
                                          "content": "在子目录里"})
    note_in_java = _
    st2, tr = a.json("GET", "/api/trash")
    st3, _ = a.json("DELETE", f"/api/folders/{ids['tech']}")
    st4, tr2 = a.json("GET", "/api/trash")
    fids = {f["id"] for f in tr2.get("folders", [])}
    nids = {n["id"] for n in tr2.get("notes", [])}
    subtree_gone = ids["tech"] in fids and ids["java"] in fids
    note_gone = note_in_java.get("id") in nids
    check("C5 删「技术」→ 目录+子目录+其中笔记一起进回收站",
          st3 == 204 and subtree_gone and note_gone,
          f"folders={sorted(fids)} notes={sorted(nids)}")

    ctx["c_note_in_java"] = note_in_java.get("id")
    return ids


# ---------------------------------------------------------------- D 笔记

def section_d(ctx: dict) -> dict:
    section("D. 笔记 CRUD 与版本（API.md §4）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]
    d: dict = {}

    st, n = a.json("POST", "/api/notes", {"folderId": None, "title": f"版本笔记-{tag}",
                                          "content": "# 第一版\n\n这是第一版正文。"})
    nid = n.get("id")
    d["note"] = nid
    check("D1 新建笔记 → 201 且 version=1", st == 201 and n.get("version") == 1,
          f"HTTP {st} version={n.get('version')}")

    st, n2 = a.json("PATCH", f"/api/notes/{nid}", {"content": "第二版正文内容"})
    check("D2 改正文 → version 自增为 2", st == 200 and n2.get("version") == 2,
          f"HTTP {st} version={n2.get('version')}")

    st, vers = a.json("GET", f"/api/notes/{nid}/versions")
    v1 = next((v for v in vers if v.get("version") == 1), None) if isinstance(vers, list) else None
    check("D2b 版本列表含 v1", bool(v1), f"versions={[v.get('version') for v in (vers or [])]}")

    old = ""
    if v1:
        st, detail = a.json("GET", f"/api/notes/{nid}/versions/1")
        old = detail.get("content", "")
    check("D2c v1 存的是**旧**内容（第一版正文）", "第一版" in old, f"content={old[:60]!r}")

    st, rolled = a.json("POST", f"/api/notes/{nid}/versions/1/restore")
    st2, cur = a.json("GET", f"/api/notes/{nid}")
    check("D3 回滚到 v1 → 正文变回 v1", st in (200, 204) and "第一版" in cur.get("content", ""),
          f"HTTP {st} content={cur.get('content', '')[:40]!r}")
    st3, vers3 = a.json("GET", f"/api/notes/{nid}/versions")
    check("D3b 回滚**不丢数据**（当前内容被存为新版本）",
          isinstance(vers3, list) and len(vers3) >= 2,
          f"版本数={len(vers3) if isinstance(vers3, list) else '?'}")

    ver_before = cur.get("version")
    st, fav = a.json("PATCH", f"/api/notes/{nid}", {"isFavorite": True})
    check("D4 仅改收藏 → version **不变**",
          st == 200 and fav.get("version") == ver_before,
          f"before={ver_before} after={fav.get('version')}")

    check("D5 excerpt 自动生成且非空", bool(cur.get("excerpt")), f"excerpt={cur.get('excerpt', '')[:50]!r}")

    st, lst = a.json("GET", "/api/notes?size=5")
    items = lst.get("items", []) if isinstance(lst, dict) else []
    no_content = all("content" not in it for it in items)
    check("D6 列表不返回 content 字段", no_content and len(items) > 0, f"items={len(items)}")

    # is_pinned 置顶效果
    st, p1 = a.json("POST", "/api/notes", {"folderId": None, "title": f"A不置顶-{tag}", "content": "a"})
    st, p2 = a.json("POST", "/api/notes", {"folderId": None, "title": f"B置顶-{tag}", "content": "b"})
    a.json("PATCH", f"/api/notes/{p1.get('id')}", {"content": "a2"})  # 让 A 更新更晚
    a.json("PATCH", f"/api/notes/{p2.get('id')}", {"isPinned": True})
    st, lst2 = a.json("GET", "/api/notes?size=50&sort=updated")
    order = [it.get("id") for it in lst2.get("items", [])]
    check("D7 is_pinned 生效：置顶笔记排在首位（sort=updated）",
          bool(order) and order[0] == p2.get("id"),
          f"首位={order[0] if order else None} 置顶id={p2.get('id')}")
    for s in ("created", "title"):
        st, l3 = a.json("GET", f"/api/notes?size=50&sort={s}")
        o3 = [it.get("id") for it in l3.get("items", [])]
        check(f"D7b is_pinned 在 sort={s} 下同样生效", bool(o3) and o3[0] == p2.get("id"),
              f"首位={o3[0] if o3 else None}")

    st, body = a.json("PATCH", f"/api/notes/{nid}", {})
    check("D8 空 PATCH {} → 400", st == 400, f"HTTP {st} code={err_code(body)}")

    ctx["D"] = d
    return d


# ---------------------------------------------------------------- E 搜索

def section_e(ctx: dict) -> None:
    section("E. 中文全文搜索（核心技术点）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]
    ghost = "幽灵词" + tag

    st, n = a.json("POST", "/api/notes", {"folderId": None, "title": f"天气笔记-{tag}",
                                          "content": f"今天天气很好，适合出去散步。Spring Boot 自动配置。{ghost}"})
    nid = n.get("id")
    check("E0 建测试笔记", st == 201, f"HTTP {st} id={nid}")

    def search(q: str) -> dict:
        st, body = a.json("GET", "/api/search?" + urllib.parse.urlencode({"q": q, "size": 50}))
        return body if isinstance(body, dict) else {}

    def hits(q: str) -> list[int]:
        return [it.get("noteId") for it in search(q).get("items", [])]

    check("E1 搜「天气」（2 字）命中", nid in hits("天气"), f"hits={hits('天气')[:6]}")
    check("E2 搜「散步」命中", nid in hits("散步"), f"hits={hits('散步')[:6]}")
    check("E3 搜「气很」（跨字相邻）命中", nid in hits("气很"), f"hits={hits('气很')[:6]}")
    check("E4 搜「今天天气」命中", nid in hits("今天天气"), f"hits={hits('今天天气')[:6]}")
    check("E5 搜「Boot」命中（中文笔记里的英文）", nid in hits("Boot"), f"hits={hits('Boot')[:6]}")
    check("E5b 搜「boot」大小写不敏感", nid in hits("boot"), f"hits={hits('boot')[:6]}")
    check("E6 搜不存在的词 → 0 条且不报错", hits("zzz不存在zzz" + tag) == [],
          f"hits={hits('zzz不存在zzz' + tag)}")

    hostile = ['天气"', "天气*", "天气) OR (1=1", "NEAR", "AND", "^天气", '天气"; DROP TABLE notes;--']
    bad = []
    for q in hostile:
        st, body = a.json("GET", "/api/search?" + urllib.parse.urlencode({"q": q}))
        if st != 200:
            bad.append((q, st))
    check("E7 敌意输入不产生 5xx（FTS5 语法注入被转义）", not bad, f"bad={bad}")
    check("E7b 敌意输入后索引仍可用", nid in hits("天气"), f"hits={hits('天气')[:6]}")

    res = search("天气")
    hl = ""
    for it in res.get("items", []):
        if it.get("noteId") == nid:
            hl = it.get("highlight", "") + " " + it.get("title", "")
    has_em = "<em>" in hl
    # 汉字之间不应有多余空格（证明没用 snippet() 输出归一化后的 blob）
    squeezed = re.search(r"[\u4e00-\u9fff]\s+[\u4e00-\u9fff]", hl) is not None
    check("E10 highlight 含 <em> 标记", has_em, f"highlight={hl[:80]!r}")
    check("E10b highlight 是原始中文（汉字间无多余空格，未用 snippet）", not squeezed,
          f"has_extra_space={squeezed}")

    # 更新后旧词消失、新词命中
    # 注意：必须同时改掉标题 —— FTS 索引的是 title+content，标题里的「天气」会让旧词继续命中，
    # 那是正确行为而不是缺陷（第一版脚本在这里误判过）。
    newword = "新词" + tag
    a.json("PATCH", f"/api/notes/{nid}",
           {"title": f"搜索测试-{tag}", "content": f"完全换掉的内容 {newword}"})
    check("E8 改标题+正文后搜**旧词**「天气」不再命中", nid not in hits("天气"), f"hits={hits('天气')[:6]}")
    check("E9 搜**新词**命中", nid in hits(newword), f"hits={hits(newword)}")

    # 软删后不命中
    a.json("DELETE", f"/api/notes/{nid}")
    check("E11 软删后搜该词 → 不再命中", nid not in hits(newword), f"hits={hits(newword)}")
    a.json("POST", f"/api/trash/notes/{nid}/restore")
    check("E11b 恢复后重新命中", nid in hits(newword), f"hits={hits(newword)}")

    ctx["E"] = {"note": nid, "word": newword}


# ---------------------------------------------------------------- F 标签

def section_f(ctx: dict) -> None:
    section("F. 标签（API.md §6）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]
    n1 = tag + "甲"

    st, t = a.json("POST", "/api/tags", {"name": n1, "color": "#2563eb"})
    check("F1 建标签 → 201", st == 201, f"HTTP {st} {t}")

    st, dup = a.json("POST", "/api/tags", {"name": n1})
    check("F2 同名标签重复创建 → 409", st == 409, f"HTTP {st} code={err_code(dup)}")

    st, note = a.json("POST", "/api/notes", {"folderId": None, "title": f"标签笔记-{tag}", "content": "t"})
    nid = note.get("id")
    n2 = tag + "新标签"
    st, _ = a.json("PUT", f"/api/notes/{nid}/tags", {"tagNames": [n1, n2]})
    st2, tags = a.json("GET", "/api/tags")
    names = {t["name"] for t in tags} if isinstance(tags, list) else set()
    check("F3 覆盖式设置标签，「新标签」自动创建",
          st == 200 and n1 in names and n2 in names, f"HTTP {st} names={sorted(names)[:8]}")
    check("F3b GET /api/tags 是裸数组（非分页信封）", isinstance(tags, list),
          f"type={type(tags).__name__}")

    cnt = next((t.get("count") for t in tags if t.get("name") == n1), None) if isinstance(tags, list) else None
    check("F4 标签 count 正确反映未删除笔记数", cnt == 1, f"count={cnt}")

    st, filt = a.json("GET", "/api/search?" + urllib.parse.urlencode({"tag": n1, "size": 50}))
    fids = [it.get("noteId") for it in filt.get("items", [])]
    check("F5 按标签筛选命中该笔记", nid in fids, f"hits={fids[:8]}")

    tid = next((t.get("id") for t in tags if t.get("name") == n2), None)
    st, _ = a.json("DELETE", f"/api/tags/{tid}")
    st2, still = a.json("GET", f"/api/notes/{nid}")
    check("F6 删标签 → 关联解除但笔记仍在", st == 204 and st2 == 200,
          f"HTTP {st} noteHTTP={st2}")

    ctx["F"] = {"note": nid, "tag": n1}


# ---------------------------------------------------------------- G 附件

def section_g(ctx: dict) -> None:
    section("G. 附件上传与安全（API.md §7，公网重点）")
    a = ctx["admin"]
    m = ctx["member"]

    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
        "00000049454e44ae426082")

    body, ct = multipart({}, [("file", "架构 图测试.png", "image/png", png)])
    st, data, _ = a.raw("POST", "/api/attachments", body, {"Content-Type": ct})
    att = json.loads(data.decode()) if st == 201 else {}
    aid = att.get("id")
    check("G1 上传 PNG → 201", st == 201, f"HTTP {st} {att}")

    if aid:
        st2, got, hdr = a.raw("GET", f"/api/attachments/{aid}")
        same = got == png
        check("G1b 取回字节与上传一致", st2 == 200 and same, f"HTTP {st2} in={len(png)}B out={len(got)}B")
        cd = hdr.get("content-disposition", "")
        check("G1c 中文文件名用 RFC5987 编码（不乱码）",
              "filename*=utf-8''" in cd.lower(), cd[:120])

    big = b"x" * (25 * 1024 * 1024)
    body, ct = multipart({}, [("file", "big.png", "image/png", big)])
    st, data, _ = a.raw("POST", "/api/attachments", body, {"Content-Type": ct})
    try:
        bjson = json.loads(data.decode())
    except Exception:
        bjson = {}
    check("G2 上传 25MB → 413", st == 413, f"HTTP {st} code={err_code(bjson)}")

    body, ct = multipart({}, [("file", "virus.exe", "application/octet-stream", b"MZ\x90\x00")])
    st, data, _ = a.raw("POST", "/api/attachments", body, {"Content-Type": ct})
    try:
        ejson = json.loads(data.decode())
    except Exception:
        ejson = {}
    check("G3 上传 .exe → 415", st == 415, f"HTTP {st} code={err_code(ejson)}")

    body, ct = multipart({}, [("file", "../../evil.png", "image/png", png)])
    st, data, _ = a.raw("POST", "/api/attachments", body, {"Content-Type": ct})
    try:
        evil = json.loads(data.decode())
    except Exception:
        evil = {}
    check("G4 文件名 ../../evil.png 不越界（服务端改名）",
          st == 201 and ".." not in (evil.get("url") or ""),
          f"HTTP {st} url={evil.get('url')}")

    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    body, ct = multipart({}, [("file", "evil.svg", "image/svg+xml", svg)])
    st, data, _ = a.raw("POST", "/api/attachments", body, {"Content-Type": ct})
    try:
        sjson = json.loads(data.decode())
    except Exception:
        sjson = {}
    if st == 201 and sjson.get("id"):
        st2, _, hdr = a.raw("GET", f"/api/attachments/{sjson['id']}")
        cd = hdr.get("content-disposition", "").lower()
        check("G5 SVG 强制 Content-Disposition: attachment（防内嵌脚本 XSS）",
              cd.startswith("attachment"), f"cd={cd[:90]}")
    else:
        check("G5 SVG 强制 attachment", False, f"上传失败 HTTP {st}")

    if aid:
        st, data, _ = m.raw("GET", f"/api/attachments/{aid}")
        check("G6 跨空间取他人附件 → 404（不得返回字节）",
              st == 404, f"HTTP {st} bytes={len(data)}")

    ctx["G"] = {"att": aid}


# ---------------------------------------------------------------- H 双链

def section_h(ctx: dict) -> None:
    section("H. 双向链接与反链（API.md §4.1）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]
    tb = "目标笔记" + tag

    st, target = a.json("POST", "/api/notes", {"folderId": None, "title": tb, "content": "我是目标"})
    st, source = a.json("POST", "/api/notes", {"folderId": None, "title": f"来源-{tag}",
                                               "content": f"见 [[{tb}]] 与 [[还不存在的{tag}]]"})
    tid, sid = target.get("id"), source.get("id")

    st, links = a.json("GET", f"/api/notes/{sid}/links")
    resolved = links.get("resolved", []) if isinstance(links, dict) else []
    dangling = links.get("dangling", []) if isinstance(links, dict) else []
    check("H1 出链 resolved 含目标笔记（含 noteId）",
          any(r.get("noteId") == tid for r in resolved),
          f"resolved={resolved}")
    check("H2 未创建的链接出现在 dangling（纯字符串数组）",
          f"还不存在的{tag}" in dangling and all(isinstance(x, str) for x in dangling),
          f"dangling={dangling}")

    st, back = a.json("GET", f"/api/notes/{tid}/backlinks")
    bitems = back.get("items", []) if isinstance(back, dict) else []
    check("H3 目标笔记的反链含来源", any(b.get("noteId") == sid for b in bitems),
          f"backlinks={[b.get('noteId') for b in bitems]}")

    # 代码块里的 [[ ]] 不应产生链接
    st, cb = a.json("POST", "/api/notes", {"folderId": None, "title": f"代码块-{tag}",
                                           "content": f"```\n[[{tb}]]\n```\n\n行内 `[[{tb}]]` 也不算"})
    st, cbl = a.json("GET", f"/api/notes/{cb.get('id')}/links")
    cres = cbl.get("resolved", []) if isinstance(cbl, dict) else []
    check("H4 代码块/行内代码里的 [[ ]] 不产生链接", len(cres) == 0, f"resolved={cres}")

    a.json("PATCH", f"/api/notes/{sid}", {"content": "链接都删掉了"})
    st, bl2 = a.json("GET", f"/api/notes/{tid}/backlinks")
    b2 = bl2.get("items", []) if isinstance(bl2, dict) else []
    check("H5 删除正文里的链接后反链消失", not any(b.get("noteId") == sid for b in b2),
          f"backlinks={[b.get('noteId') for b in b2]}")

    # 重命名目标 → 反链转移
    tb2 = "目标改名" + tag
    a.json("PATCH", f"/api/notes/{target.get('id')}", {"title": tb2})
    st, src2 = a.json("POST", "/api/notes", {"folderId": None, "title": f"来源2-{tag}",
                                             "content": f"新链接 [[{tb2}]]"})
    st, bl3 = a.json("GET", f"/api/notes/{tid}/backlinks")
    b3 = bl3.get("items", []) if isinstance(bl3, dict) else []
    check("H6 重命名后新链接指向同一笔记（反链可达）",
          any(b.get("noteId") == src2.get("id") for b in b3),
          f"backlinks={[b.get('noteId') for b in b3]}")


# ---------------------------------------------------------------- I 回收站

def section_i(ctx: dict) -> None:
    section("I. 回收站（API.md §8）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]
    word = "回收站独有词" + tag

    st, n = a.json("POST", "/api/notes", {"folderId": None, "title": f"待删-{tag}",
                                          "content": f"内容 {word}"})
    nid = n.get("id")
    st, t = a.json("POST", "/api/tags", {"name": "回收标签" + tag})
    a.json("PUT", f"/api/notes/{nid}/tags", {"tagNames": ["回收标签" + tag]})

    st, _ = a.json("DELETE", f"/api/notes/{nid}")
    st2, tr = a.json("GET", "/api/trash")
    in_trash = any(x.get("id") == nid for x in tr.get("notes", []))
    check("I1 软删 → 出现在回收站", st == 204 and in_trash, f"HTTP {st} in_trash={in_trash}")

    st3, lst = a.json("GET", "/api/notes?size=200")
    gone = all(it.get("id") != nid for it in lst.get("items", []))
    st4, srch = a.json("GET", "/api/search?" + urllib.parse.urlencode({"q": word}))
    gone2 = all(it.get("noteId") != nid for it in srch.get("items", []))
    check("I1b 软删后列表与搜索里都消失", gone and gone2, f"list_gone={gone} search_gone={gone2}")

    st, _ = a.json("POST", f"/api/trash/notes/{nid}/restore")
    st2, back = a.json("GET", f"/api/notes/{nid}")
    tags_kept = [t.get("name") for t in back.get("tags", [])]
    check("I2 恢复 → 回来且标签仍在",
          st in (200, 204) and st2 == 200 and ("回收标签" + tag) in tags_kept,
          f"tags={tags_kept}")
    st3, srch2 = a.json("GET", "/api/search?" + urllib.parse.urlencode({"q": word}))
    check("I2b 恢复后可被搜索命中（FTS 索引未坏）",
          any(it.get("noteId") == nid for it in srch2.get("items", [])), "")

    a.json("DELETE", f"/api/notes/{nid}")
    st, _ = a.json("DELETE", f"/api/trash/notes/{nid}")
    st2, tr2 = a.json("GET", "/api/trash")
    purged = all(x.get("id") != nid for x in tr2.get("notes", []))
    check("I3 彻底删除 → 从回收站消失", st == 204 and purged, f"HTTP {st} purged={purged}")

    # 目录级：删父目录 → 恢复 → 子树一起回来
    tag2 = uuid.uuid4().hex[:6]
    st, p = a.json("POST", "/api/folders", {"parentId": None, "name": f"父-{tag2}"})
    st, c = a.json("POST", "/api/folders", {"parentId": p.get("id"), "name": f"子-{tag2}"})
    st, nn = a.json("POST", "/api/notes", {"folderId": c.get("id"), "title": f"子目录笔记-{tag2}",
                                           "content": "x"})
    a.json("DELETE", f"/api/folders/{p.get('id')}")
    st, _ = a.json("POST", f"/api/trash/folders/{p.get('id')}/restore")
    st2, tree = a.json("GET", "/api/folders?tree=true")
    def find(nodes, fid):
        for n in nodes or []:
            if n.get("id") == fid:
                return n
            r = find(n.get("children"), fid)
            if r:
                return r
        return None
    parent = find(tree, p.get("id"))
    child_back = bool(parent) and any(x.get("id") == c.get("id") for x in parent.get("children", []))
    st3, nn2 = a.json("GET", f"/api/notes/{nn.get('id')}")
    check("I4 恢复父目录 → 子目录与其中笔记一并回来",
          st in (200, 204) and child_back and st3 == 200,
          f"child_back={child_back} noteHTTP={st3}")

    st, res = a.json("POST", "/api/trash/empty")
    check("I5 清空回收站 → 返回计数", st in (200, 204), f"HTTP {st} {res}")


# ---------------------------------------------------------------- J 导入导出

def section_j(ctx: dict) -> None:
    section("J. 导入导出（API.md §10）")
    a = ctx["admin"]
    tag = uuid.uuid4().hex[:6]

    st, n = a.json("POST", "/api/notes", {"folderId": None, "title": f"导出测试-中文*A?B-{tag}",
                                          "content": "# 标题\n\n正文内容 ABC"})
    nid = n.get("id")

    st, data, hdr = a.raw("GET", f"/api/export/notes/{nid}.md")
    cd = hdr.get("content-disposition", "")
    check("J1 单篇导出 → 200 Markdown，中文名 RFC5987 编码",
          st == 200 and "filename*=utf-8''" in cd.lower(), f"HTTP {st} cd={cd[:100]}")

    st, zdata, hdr = a.raw("GET", "/api/export/all")
    ok_zip = False
    entries = []
    if st == 200:
        try:
            with zipfile.ZipFile(io.BytesIO(zdata)) as z:
                entries = z.namelist()
                ok_zip = z.testzip() is None
        except Exception as exc:
            entries = [f"ZIP 解析失败: {exc}"]
    check("J2 全量导出 → 可打开的 ZIP（含 notes/ 与 manifest.json）",
          ok_zip and any(e.startswith("notes/") for e in entries) and any("manifest" in e for e in entries),
          f"HTTP {st} entries={entries[:5]}")

    # 导入 3 个 md
    files = [("file", f"imp1-{tag}.md", "text/markdown", b"# imp1\n\nabc"),
             ("file", f"imp2-{tag}.md", "text/markdown", b"# imp2\n\ndef"),
             ("file", f"imp3-{tag}.md", "text/markdown", b"# imp3\n\nghi")]
    body, ct = multipart({}, files)
    st, data, _ = a.raw("POST", "/api/import/markdown", body, {"Content-Type": ct})
    try:
        rj = json.loads(data.decode())
    except Exception:
        rj = {}
    check("J3 导入 3 个 md → imported=3", st == 200 and rj.get("imported") == 3,
          f"HTTP {st} {rj}")

    # front matter
    fm = "---\ntitle: 前端标题被采用\ntags: [导入标签]\nfolder: 导入目录\n---\n\n正文".encode("utf-8")
    body, ct = multipart({}, [("file", f"fm-{tag}.md", "text/markdown", fm)])
    st, data, _ = a.raw("POST", "/api/import/markdown", body, {"Content-Type": ct})
    try:
        fj = json.loads(data.decode())
    except Exception:
        fj = {}
    check("J4 导入含 front matter 的 md → 成功", st == 200 and fj.get("imported") == 1,
          f"HTTP {st} {fj}")

    # preview 结构
    body, ct = multipart({}, files)
    st, data, _ = a.raw("POST", "/api/import/preview", body, {"Content-Type": ct})
    try:
        pj = json.loads(data.decode())
    except Exception:
        pj = {}
    items = pj.get("items", [])
    fields_ok = bool(items) and all(
        set(("title", "sourceFile", "tags", "folder", "sizeBytes")) <= set(it.keys()) for it in items)
    check("J5 preview 结构符合 §10.1（items/total/errors + 条目五字段）",
          isinstance(pj.get("items"), list) and isinstance(pj.get("total"), int)
          and isinstance(pj.get("errors"), list) and fields_ok,
          f"total={pj.get('total')} keys={sorted(items[0].keys()) if items else []}")

    # 恶意 ZIP：Zip Slip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../../evil.md", "slip")
        z.writestr("C:/windows/evil2.md", "slip2")
        z.writestr("ok.md", "# 正常\n\nx")
    body, ct = multipart({}, [("file", f"evil-{tag}.zip", "application/zip", buf.getvalue())])
    st, data, _ = a.raw("POST", "/api/import/markdown", body, {"Content-Type": ct})
    try:
        ej = json.loads(data.decode())
    except Exception:
        ej = {}
    errs = " ".join(ej.get("errors", []))
    leaked = []
    for probe in (os.path.join(os.getcwd(), "evil.md"),
                  os.path.join(tempfile.gettempdir(), "evil.md"),
                  os.path.join(os.getcwd(), "data", "evil.md")):
        if os.path.exists(probe):
            leaked.append(probe)
    check("J6 恶意 ZIP 的路径穿越被拒（Zip Slip）",
          st == 200 and ("非法路径" in errs or "拒绝" in errs) and not leaked,
          f"errors={ej.get('errors')} leaked={leaked}")

    # 坏文件不影响其余
    # 注意：不能用 \xff\xfe 开头 —— 那是 UTF-16LE BOM，服务端会「BOM 感知」地按 UTF-16LE
    # 正确解码（ImportService 的严格解码器）。要触发「编码无法识别」得用真正的非法 UTF-8 序列。
    bad = [("file", f"broken-{tag}.md", "text/markdown", b"\xc3\x28\xa0\xa1 invalid utf8 \x80\x80"),
           ("file", f"good1-{tag}.md", "text/markdown", "# 好的1\n\nx".encode()),
           ("file", f"good2-{tag}.md", "text/markdown", "# 好的2\n\ny".encode())]
    body, ct = multipart({}, bad)
    st, data, _ = a.raw("POST", "/api/import/markdown", body, {"Content-Type": ct})
    try:
        bj = json.loads(data.decode())
    except Exception:
        bj = {}
    check("J7 单个坏文件不阻断其余（imported≥2 且 errors 非空）",
          st == 200 and bj.get("imported", 0) >= 2 and len(bj.get("errors", [])) >= 1,
          f"HTTP {st} imported={bj.get('imported')} errors={len(bj.get('errors', []))}")

    # 导入的 [[链接]] 必须建立
    tag3 = uuid.uuid4().hex[:6]
    ta, tb2 = f"链A{tag3}", f"链B{tag3}"
    files2 = [("file", f"{ta}.md", "text/markdown", f"# {ta}\n\n见 [[{tb2}]]".encode("utf-8")),
              ("file", f"{tb2}.md", "text/markdown", f"# {tb2}\n\n我是B".encode("utf-8"))]
    body, ct = multipart({}, files2)
    st, _, _ = a.raw("POST", "/api/import/markdown", body, {"Content-Type": ct})
    ida = idb = None
    st, lst = a.json("GET", "/api/notes?size=200")
    for it in lst.get("items", []):
        if it.get("title") == ta:
            ida = it.get("id")
        if it.get("title") == tb2:
            idb = it.get("id")
    if ida and idb:
        st, lk = a.json("GET", f"/api/notes/{ida}/links")
        res = lk.get("resolved", [])
        check("J8 导入笔记的 [[链接]] 被重建（resolved 含目标）",
              any(r.get("noteId") == idb for r in res), f"resolved={res}")
        st, bk = a.json("GET", f"/api/notes/{idb}/backlinks")
        check("J8b 目标笔记的反链含导入来源",
              any(b.get("noteId") == ida for b in bk.get("items", [])),
              f"backlinks={[b.get('noteId') for b in bk.get('items', [])]}")
    else:
        check("J8 导入笔记的 [[链接]] 被重建", False, f"未找到导入笔记 ida={ida} idb={idb}")


# ---------------------------------------------------------------- K 统计

def section_k(ctx: dict) -> None:
    section("K. 统计与最近浏览（API.md §9 §4.2）")
    a = ctx["admin"]
    st, n = a.json("POST", "/api/notes", {"folderId": None, "title": "浏览测试" + uuid.uuid4().hex[:6],
                                          "content": "x"})
    nid = n.get("id")
    st, _ = a.json("POST", f"/api/notes/{nid}/view")
    st2, rec = a.json("GET", "/api/recent?limit=20")
    items = rec.get("items", []) if isinstance(rec, dict) else []
    hit = next((i for i in items if i.get("noteId") == nid), None)
    check("K1 view 后出现在 /api/recent", hit is not None, f"items={len(items)}")
    check("K1b recent 时间字段名是 viewedAt（§4.2）", hit is not None and "viewedAt" in hit,
          f"keys={sorted(hit.keys()) if hit else []}")

    st, stt = a.json("GET", "/api/stats")
    needed = {"noteCount", "folderCount", "tagCount", "attachmentCount",
              "totalAttachmentBytes", "trashCount", "dailyCreated"}
    check("K2 /api/stats 含全部约定字段", needed <= set(stt.keys()),
          f"missing={sorted(needed - set(stt.keys()))}")
    dc = stt.get("dailyCreated", [])
    check("K2b dailyCreated 恰为 14 天且每项含 date/count",
          len(dc) == 14 and all(set(("date", "count")) <= set(d.keys()) for d in dc),
          f"len={len(dc)}")
    zeroes = [d for d in dc if d.get("count") == 0]
    check("K2c 无数据的日期补 0（没有空洞）", len(dc) == 14, f"zero_days={len(zeroes)}")


# ---------------------------------------------------------------- L 隔离

def section_l(ctx: dict) -> None:
    section("L. 多用户空间隔离（安全核心）")
    a, m = ctx["admin"], ctx["member"]
    tag = uuid.uuid4().hex[:6]
    word = "隔离独有词" + tag

    st, n = a.json("POST", "/api/notes", {"folderId": None, "title": f"管理员私有-{tag}",
                                          "content": f"秘密内容 {word}"})
    nid = n.get("id")
    st, f = a.json("POST", "/api/folders", {"parentId": None, "name": f"管理员目录-{tag}"})
    fid = f.get("id")

    st, body = m.json("GET", f"/api/notes/{nid}")
    check("L1 成员读他人笔记 → 404（不泄露内容）",
          st == 404 and "_raw" not in body, f"HTTP {st} body={str(body)[:80]}")

    st, _ = m.json("PATCH", f"/api/notes/{nid}", {"title": "篡改"})
    st2, _ = m.json("DELETE", f"/api/notes/{nid}")
    check("L2 成员改/删他人笔记 → 404", st == 404 and st2 == 404, f"PATCH={st} DELETE={st2}")

    st, tree = m.json("GET", "/api/folders?tree=true")
    ids = []
    def flat(nodes):
        for x in nodes or []:
            ids.append(x.get("id"))
            flat(x.get("children"))
    flat(tree)
    check("L3 成员看不到他人目录", fid not in ids, f"visible={ids[:8]}")

    st, srch = m.json("GET", "/api/search?" + urllib.parse.urlencode({"q": word}))
    check("L4 成员搜不到他人笔记里的独有词",
          all(it.get("noteId") != nid for it in srch.get("items", [])),
          f"total={srch.get('total')}")

    st, tr = m.json("GET", "/api/trash")
    check("L5 成员看不到他人回收站",
          all(x.get("id") != nid for x in tr.get("notes", [])) and
          all(x.get("id") != fid for x in tr.get("folders", [])),
          f"notes={len(tr.get('notes', []))} folders={len(tr.get('folders', []))}")

    st, _ = m.json("GET", f"/api/notes/{nid}/versions")
    st2, _ = m.json("GET", f"/api/notes/{nid}/backlinks")
    st3, _ = m.json("DELETE", f"/api/trash/notes/{nid}")
    check("L6 成员的版本/反链/他人回收站操作 → 全部 404",
          st == 404 and st2 == 404 and st3 == 404, f"{st}/{st2}/{st3}")


# ---------------------------------------------------------------- M 加固

def section_m(ctx: dict) -> None:
    section("M. 公网暴露加固")
    anon = Client()
    guarded = ["/api/notes", "/api/folders", "/api/tags", "/api/trash",
               "/api/stats", "/api/recent", "/api/attachments/1"]
    bad = []
    for p in guarded:
        st, _ = anon.json("GET", p)
        if st != 401:
            bad.append((p, st))
    check("M1 未登录访问受保护端点全部 401", not bad, f"异常={bad}")

    st, body = anon.json("GET", "/api/health")
    check("M1b /api/health 无需登录可访问", st == 200, f"HTTP {st}")

    a = ctx["admin"]
    st, _ = a.json("POST", "/api/notes", {"folderId": None, "title": "XSS 载荷测试",
                                          "content": "<script>alert(1)</script><img src=x onerror=alert(2)>"})
    check("M2 XSS 载荷可正常存取（净化责任在前端 DOMPurify）", st == 201, f"HTTP {st}")

    st, data, _ = anon.raw("GET", "/api/notes")
    txt = data.decode("utf-8", "replace")
    check("M5 未授权响应体不含 Java 堆栈或 SQL",
          "java." not in txt and "Exception" not in txt and "SELECT" not in txt.upper(),
          f"body={txt[:100]}")

    for path in ["/api/../docs/SCHEMA.md", "/api/%2e%2e/docs/SCHEMA.md",
                 "/api/notes/../../etc/passwd"]:
        st, data, _ = anon.raw("GET", path)
        t = data.decode("utf-8", "replace")
        if st == 200 and "数据模型契约" in t:
            check(f"M6 路径穿越 {path} 未泄露文件", False, f"HTTP {st}")
            break
    else:
        check("M6 路径穿越尝试未泄露文件", True, "三种 payload 均未返回文件内容")

    st, body = ctx["admin"].json("GET", "/api/auth/login")
    check("M7 方法不支持 → 405（可选：ErrorCode 是否 METHOD_NOT_ALLOWED）",
          st == 405, f"HTTP {st} code={err_code(body)}")

    # 请求体上限
    a2 = ctx["admin"]
    huge = json.dumps({"title": "big", "content": "x" * (9 * 1024 * 1024)}).encode()
    st, data, _ = a2.raw("POST", "/api/notes", huge, {"Content-Type": "application/json"})
    try:
        hj = json.loads(data.decode())
    except Exception:
        hj = {}
    check("M8 9MB JSON 请求体 → 413 PAYLOAD_TOO_LARGE",
          st == 413 and err_code(hj) == "PAYLOAD_TOO_LARGE", f"HTTP {st} code={err_code(hj)}")


# ---------------------------------------------------------------- main

def main() -> int:
    print(f"目标: {BASE}   模式: {'空库(--fresh)' if FRESH else '已有库'}")
    try:
        with urllib.request.urlopen(BASE + "/api/health", timeout=15) as r:
            health = json.loads(r.read().decode())
        print(f"health: {health}")
    except Exception as exc:
        print(f"[致命] /api/health 不可达: {exc}")
        return 2

    ctx = section_b()
    if "admin" not in ctx:
        print("[致命] 无法建立管理员会话，后续节跳过")
        return 2
    section_c(ctx)
    section_d(ctx)
    section_e(ctx)
    section_f(ctx)
    section_g(ctx)
    section_h(ctx)
    section_i(ctx)
    section_j(ctx)
    section_k(ctx)
    section_l(ctx)
    section_m(ctx)

    print("\n" + "=" * 72)
    print(f"结果：PASS {len(PASS)}   FAIL {len(FAIL)}   SKIP {len(SKIP)}")
    if FAIL:
        print("\n失败项：")
        for f in FAIL:
            print(f"  - {f}")
    print("=" * 72)
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
