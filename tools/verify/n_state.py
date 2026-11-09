# -*- coding: utf-8 -*-
"""N 节辅助：直接读 SQLite 库做独立于 API 的证据（前/后状态对比）。

用法：
    python n_state.py <kb.db 路径> [--json]
"""
import json
import sqlite3
import sys

db_path = sys.argv[1]
con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row
cur = con.cursor()

state = {}
for table in ("users", "spaces", "folders", "notes", "tags", "note_tags",
              "links", "attachments", "activities", "note_versions", "invites"):
    try:
        state[table] = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except sqlite3.Error as exc:
        state[table] = f"ERR:{exc}"

state["soft_deleted_notes"] = cur.execute(
    "SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL").fetchone()[0]
state["alive_notes"] = cur.execute(
    "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL").fetchone()[0]

admin = cur.execute(
    "SELECT username, display_name FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
state["admin_username"] = admin["username"] if admin else None

# 取一篇存活笔记的标题与正文片段，供重启后核对
sample = cur.execute(
    "SELECT id, title, substr(content,1,40) AS snippet FROM notes "
    "WHERE deleted_at IS NULL ORDER BY id LIMIT 3").fetchall()
state["sample_notes"] = [dict(r) for r in sample]

# FTS 索引是否仍可用（只认 MATCH —— external content 表的 COUNT 不可信）
state["fts_probe"] = {}
for row in cur.execute("SELECT id, title FROM notes WHERE deleted_at IS NULL LIMIT 3"):
    title = row["title"] or ""
    if not title:
        continue
    # 取标题里的一段连续汉字做子串查询
    hits_run = []
    cur_cn = []
    for ch in title:
        if "\u4e00" <= ch <= "\u9fff":
            cur_cn.append(ch)
        elif cur_cn:
            hits_run.append("".join(cur_cn))
            cur_cn = []
    if cur_cn:
        hits_run.append("".join(cur_cn))
    for frag in hits_run[:2]:
        if len(frag) < 1:
            continue
        expr = '"' + " ".join(frag) + '"'
        try:
            n = cur.execute(
                "SELECT COUNT(*) FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid "
                "WHERE notes_fts MATCH ? AND n.deleted_at IS NULL", (expr,)).fetchone()[0]
            state["fts_probe"][frag] = n
        except sqlite3.Error as exc:
            state["fts_probe"][frag] = f"ERR:{exc}"

state["journal_mode"] = cur.execute("PRAGMA journal_mode").fetchone()[0]
state["integrity"] = cur.execute("PRAGMA integrity_check").fetchone()[0]

print(json.dumps(state, ensure_ascii=False, indent=2))
