# -*- coding: utf-8 -*-
"""在真后端里造一条「已软删的笔记 + 已软删的目录」，用于验证回收站视图在非空场景下的渲染。

用法：python mk_trash.py <base_url> <user> <pass>
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

base = sys.argv[1].rstrip("/")
user, pwd = sys.argv[2], sys.argv[3]

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode("utf-8")) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return exc.code, {"_raw": raw[:200].decode("utf-8", "replace")}


st, _ = call("POST", "/api/auth/login", {"username": user, "password": pwd})
print("login:", st)
assert st == 200, "登录失败"

st, folder = call("POST", "/api/folders", {"parentId": None, "name": "回收站视图验证目录"})
print("create folder:", st, folder.get("id"))
st, note = call("POST", "/api/notes",
                {"folderId": None, "title": "回收站视图验证笔记", "content": "用于验证回收站非空场景"})
print("create note:", st, note.get("id"))

st, _ = call("DELETE", f"/api/notes/{note['id']}")
print("soft delete note:", st)
st, _ = call("DELETE", f"/api/folders/{folder['id']}")
print("soft delete folder:", st)

st, trash = call("GET", "/api/trash")
print("trash now:", json.dumps({"notes": len(trash.get("notes", [])),
                                "folders": len(trash.get("folders", []))}, ensure_ascii=False))
