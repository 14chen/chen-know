# -*- coding: utf-8 -*-
"""把隔离 dev 环境重置成「干净可演示」状态。

做四件事（幂等，可反复跑）：
  1. 清理：删除不属于演示集的笔记与标签（测试残留），走正规 API（软删 → 彻底删）
  2. 建目录树：技术/{前端,后端}、生活
  3. 归位：把 6 篇演示笔记分派到合适目录
  4. 校验：内容与 seed_demo.py 逐字节一致、目录结构正确

用法：
    python reset_demo_env.py <base_url> [--check] [--yes]
      --check  只报告将要做什么，不写
      --yes    确认执行清理（不加则只做建目录/归位，不删东西）
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from seed_demo import NOTES  # noqa: E402

base = sys.argv[1].rstrip("/")
CHECK = "--check" in sys.argv
YES = "--yes" in sys.argv
USER, PASS = "demo", "DemoPass123!"

DEMO_TITLES = [t for t, _ in NOTES]
DEMO_TAGS = {"Java", "笔记", "验收", "中文标签"}  # 允许保留的标签；其余视为测试残留

# 演示目录结构：名字 -> 父目录名（None = 根）
FOLDERS = [
    ("技术", None),
    ("前端", "技术"),
    ("后端", "技术"),
    ("生活", None),
]

# 演示笔记 -> 目标目录（None = 未分类）
ASSIGN = {
    "欢迎使用知识库": None,
    "Markdown 速查": "技术",
    "双向链接演示（A）": "前端",
    "双向链接演示（B）": "前端",
    "中文排版测试": "生活",
    "长文档性能测试": "后端",
}

# 演示标签（name -> 颜色）以及要打在哪些笔记上
DEMO_TAGS_NEW = {
    "入门": "#2563eb",
    "参考": "#059669",
    "排版": "#d97706",
}
TAG_ASSIGN = {
    "欢迎使用知识库": ["入门"],
    "Markdown 速查": ["参考"],
    "中文排版测试": ["参考", "排版"],
    "双向链接演示（A）": ["参考"],
}
# 收藏与浏览记录（让 /favorites 与 /recent 不是空态）
FAVORITES = ["欢迎使用知识库", "双向链接演示（A）"]
VIEWED = ["Markdown 速查", "中文排版测试", "长文档性能测试"]

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None):
    body, headers = None, {}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base + path, data=body, method=method, headers=headers)
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


def main() -> int:
    st, _ = call("POST", "/api/auth/login", {"username": USER, "password": PASS})
    if st != 200:
        print(f"[失败] 登录 HTTP {st}")
        return 1

    # ---------- 1. 清理测试残留 ----------
    st, lst = call("GET", "/api/notes?size=200")
    total = lst.get("total", 0)
    all_notes = list(lst.get("items", []))
    page = 1
    while len(all_notes) < total and page < 50:
        page += 1
        st, nxt = call("GET", f"/api/notes?size=200&page={page}")
        all_notes.extend(nxt.get("items", []))

    junk = [n for n in all_notes if n["title"] not in DEMO_TITLES]
    # 同名重复的演示笔记：seed_demo 被重复执行过就会产生副本（实测见过 4 份）。
    # 只保留 id 最小的那一份（它带着目录归属与标签），其余当残留清掉。
    from collections import defaultdict
    dupes = []
    by_title = defaultdict(list)
    for n in all_notes:
        if n["title"] in DEMO_TITLES:
            by_title[n["title"]].append(n)
    for title, group in by_title.items():
        group.sort(key=lambda x: x["id"])
        if len(group) > 1:
            dupes.extend(group[1:])
            print(f"  重复副本：{title} × {len(group)}（保留 id={group[0]['id']}，清理 {len(group)-1} 份）")
    junk.extend(dupes)
    print(f"笔记总数 {len(all_notes)}，其中非演示笔记 {len([n for n in all_notes if n['title'] not in DEMO_TITLES])} 篇，重复副本 {len(dupes)} 篇")
    if junk[:5]:
        print("  例如：" + " / ".join(n["title"][:24] for n in junk[:5]))

    st, tags = call("GET", "/api/tags")
    junk_tags = [t for t in (tags or []) if t["name"] not in DEMO_TAGS]
    print(f"标签总数 {len(tags or [])}，其中非演示标签 {len(junk_tags)} 个")

    if junk and YES and not CHECK:
        print(f"\n--- 清理 {len(junk)} 篇笔记 ---")
        for n in junk:
            call("DELETE", f"/api/notes/{n['id']}")
            call("DELETE", f"/api/trash/notes/{n['id']}")
        print("  完成")
    elif junk and not CHECK:
        print("  （未加 --yes，跳过清理）")

    if junk_tags and YES and not CHECK:
        print(f"--- 清理 {len(junk_tags)} 个标签 ---")
        for t in junk_tags:
            call("DELETE", f"/api/tags/{t['id']}")
        print("  完成")

    if CHECK:
        print("\n[--check] 未写入任何东西")
        return 0

    # ---------- 2. 建目录树 ----------
    print()
    st, tree = call("GET", "/api/folders?tree=true")

    def find(nodes, name):
        for n in nodes or []:
            if n["name"] == name:
                return n
            r = find(n.get("children"), name)
            if r:
                return r
        return None

    made = []
    for name, parent_name in FOLDERS:
        st, tree = call("GET", "/api/folders?tree=true")
        if find(tree, name):
            continue
        parent_id = None
        if parent_name:
            p = find(tree, parent_name)
            if not p:
                print(f"  [跳过] {name}：父目录 {parent_name} 不存在")
                continue
            parent_id = p["id"]
        st, r = call("POST", "/api/folders", {"parentId": parent_id, "name": name})
        made.append(f"{name}({st})")
    print(f"目录：新建 {made if made else '无需新建'}")

    # ---------- 3. 归位 ----------
    st, tree = call("GET", "/api/folders?tree=true")
    st, lst = call("GET", "/api/notes?size=200")
    by_title = {n["title"]: n for n in lst.get("items", [])}
    moved = []
    for title, folder_name in ASSIGN.items():
        note = by_title.get(title)
        if not note:
            continue
        want = find(tree, folder_name)["id"] if folder_name else None
        if note["folderId"] != want:
            st, _ = call("PATCH", f"/api/notes/{note['id']}", {"folderId": want})
            moved.append(f"{title}→{folder_name or '未分类'}({st})")
    print(f"归位：{moved if moved else '无需移动'}")

    # ---------- 3.5 标签 / 收藏 / 浏览记录（让演示视图不是空态）----------
    st, tags = call("GET", "/api/tags")
    have = {t["name"]: t["id"] for t in (tags or [])}
    made_tags = []
    for name, color in DEMO_TAGS_NEW.items():
        if name not in have:
            st, r = call("POST", "/api/tags", {"name": name, "color": color})
            if st == 201:
                have[name] = r["id"]
                made_tags.append(name)
    print(f"标签：新建 {made_tags if made_tags else '无需新建'}（现有 {len(have)} 个）")

    st, lst = call("GET", "/api/notes?size=200")
    by_title = {n["title"]: n for n in lst.get("items", [])}

    tagged = []
    for title, names in TAG_ASSIGN.items():
        note = by_title.get(title)
        if not note:
            continue
        cur = sorted(t["name"] for t in note.get("tags", []))
        if cur != sorted(names):
            st, _ = call("PUT", f"/api/notes/{note['id']}/tags", {"tagNames": names})
            tagged.append(f"{title}→{names}({st})")
    print(f"打标签：{tagged if tagged else '无需变更'}")

    fav = []
    for title in FAVORITES:
        note = by_title.get(title)
        if note and not note.get("isFavorite"):
            st, _ = call("PATCH", f"/api/notes/{note['id']}", {"isFavorite": True})
            fav.append(f"{title}({st})")
    print(f"收藏：{fav if fav else '无需变更'}（共 {len(FAVORITES)} 篇）")

    # 浏览记录：/api/recent 按 viewedAt 倒序，重复 view 只保留最近一次
    for title in VIEWED:
        note = by_title.get(title)
        if note:
            call("POST", f"/api/notes/{note['id']}/view")
    print(f"浏览记录：已写入 {len(VIEWED)} 篇")

    # 历史版本：改一次再改回来 —— 内容最终与种子一致，但 note_versions 里留下记录，
    # 这样「历史版本」视图才有东西可展示（note_versions 只存被替换掉的版本）。
    seeded_hist = []
    target = by_title.get("欢迎使用知识库")
    if target:
        st, cur = call("GET", f"/api/notes/{target['id']}")
        original = cur.get("content", "")
        if cur.get("version", 1) < 2:
            call("PATCH", f"/api/notes/{target['id']}",
                 {"content": original + "\n\n<!-- 历史版本占位 -->\n"})
            call("PATCH", f"/api/notes/{target['id']}", {"content": original})
            seeded_hist.append("欢迎使用知识库")
    print(f"历史版本：{seeded_hist if seeded_hist else '已有记录'}")

    # ---------- 4. 校验 ----------
    print("\n--- 校验 ---")
    st, tree = call("GET", "/api/folders?tree=true")

    def dump(nodes, depth=0):
        for n in nodes or []:
            print("  " + "  " * depth + f"{n['name']}  (noteCount={n['noteCount']}, id={n['id']})")
            dump(n.get("children"), depth + 1)

    dump(tree)

    st, lst = call("GET", "/api/notes?size=200")
    expected = dict(NOTES)
    bad = 0
    for it in lst.get("items", []):
        if it["title"] not in expected:
            print(f"  [多余] {it['title']}")
            bad += 1
    for title in DEMO_TITLES:
        if not any(it["title"] == title for it in lst.get("items", [])):
            print(f"  [缺失] {title}")
            bad += 1
    print(f"\n结论：{'全部就绪' if bad == 0 else f'{bad} 处异常'}（共 {lst.get('total')} 篇）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
