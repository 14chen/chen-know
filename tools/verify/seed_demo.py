# -*- coding: utf-8 -*-
"""给编辑器原型准备演示数据：一个演示账号 + 若干覆盖面广的笔记。

用法：
    python seed_demo.py <base_url> [--user demo] [--pass DemoPass123!]

幂等：账号已存在则直接登录；笔记按标题去重（已存在则跳过）。
"""
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

base = sys.argv[1].rstrip("/")
user = "demo"
pwd = "DemoPass123!"
if "--user" in sys.argv:
    user = sys.argv[sys.argv.index("--user") + 1]
if "--pass" in sys.argv:
    pwd = sys.argv[sys.argv.index("--pass") + 1]

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


# ---------------------------------------------------------------- 演示正文

WELCOME = """# 欢迎使用你的知识库

这是一个**跑在自己电脑上**的个人知识库。左边选一篇笔记，右边这一栏就可以**直接编辑** ——
注意把光标放到某一行上，那一行会露出 Markdown 源码，光标移开就又变回排好版的样子。

## 常用的几样

- **粗体**用两个星号，*斜体*用单个星号
- `行内代码`用反引号包起来
- ~~删除线~~用两个波浪线
- 链接长这样：[Markdown 官方说明](https://commonmark.org/)

### 待办清单

- [x] 装好 JDK 21
- [x] 启动服务
- [ ] 写下第一篇笔记
- [ ] 把地址发给同事

### 引用

> 记不住的东西，就等于没发生过。
> —— 某个记性不好的人

---

## 一个小表格

| 功能 | 怎么用 | 备注 |
|---|---|---|
| 搜索 | 顶栏搜索框 | 支持 1–2 个汉字 |
| 双链 | 输入两个方括号 | 见下一篇演示 |
| 传图 | 直接粘贴截图 | 自动上传 |

下一节我们看看代码块和双链怎么写。
"""

SYNTAX = """# Markdown 速查

## 代码块

```python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```javascript
const greet = (name) => `你好，${name}`
console.log(greet('世界'))
```

```sql
SELECT n.title, COUNT(b.id) AS backlinks
FROM notes n
LEFT JOIN links b ON b.target_note_id = n.id
WHERE n.deleted_at IS NULL
GROUP BY n.id
ORDER BY backlinks DESC;
```

```java
public record Note(long id, String title, String content) {}
```

## 标题层级

# 一级标题
## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题

## 列表

1. 有序列表第一项
2. 第二项
   - 嵌套无序项
   - 再来一条
3. 第三项

## 行内元素

**粗体**、*斜体*、***粗斜体***、`code`、~~删除线~~、[链接](https://example.com)、
<span>裸 HTML 标签</span>（会被净化）

## 分隔线

---

结束。
"""

LINK_A = """# 双向链接演示（A）

这里引用一篇**已存在**的笔记：[[双向链接演示（B）]]

这里引用一篇**还不存在**的笔记：[[这篇笔记还没写]]

## 试试看

1. 把光标放到上面任意一行 —— 你应该能看到原始的 `[[ ]]` 语法
2. 把光标移到别处 —— 它们会变成可以点的标签
3. 新起一行，输入两个左方括号 `[[` —— 应该会弹出补全列表
4. 点上面那个已存在的链接 —— 应该跳到 B 那篇

## 反链

如果 B 里也引用了 A，那么 B 的「反向引用」里就能看到 A。这个原型暂时没接反链面板，
但底层数据已经在算了。
"""

LINK_B = """# 双向链接演示（B）

我是被 A 引用的那篇。

顺便我也引用回 A：[[双向链接演示（A）]]，这样就形成了一个环。

## 为什么会这样

双向链接的价值在于：你不需要先想好文件该放哪个目录，
只要在写的时候用 `[[ ]]` 提到它，笔记之间就自动建立了关系。
"""

CHINESE = """# 中文排版测试

## 标点与字距

他说：「今天天气不错，要不要出去走走？」——我回答：「好啊，等我五分钟。」
她补充道：『记得带伞，天气预报说下午有雨……』

中文标点应当全角：，。；：？！「」『』（）《》【】、·
英文与数字用半角：Hello, World! ABC 123 4.56% $100

中英混排时，**中文与 English 之间会自动加一点空隙**吗？这取决于字体与排版设置。
数字如 2026 年 10 月 16 日，或 15:49:08。

## 长段落

这段用来测试连续中文在编辑器里的换行与滚动表现。知识管理这件事，说起来简单，
做起来却要面对很多取舍：是先把东西记下来，还是先想清楚分类？是追求结构完整，
还是追求记录速度？多数人的经验是——先记，再整理。因为**记录的成本必须足够低**，
低到你在看到一个有趣想法的三秒内就能把它存下来，否则它就会溜走。
而整理的成本可以很高，因为它可以批量、可以慢慢来、可以借助工具。
这个知识库的设计正是基于这个判断：新建一篇笔记只需要一次点击，
正文输入全程自动保存，不需要你操心「保存」这件事。

## 特殊字符

- 数学：1 + 1 = 2，a² + b² = c²
- 货币：￥100、$50、€30
- 箭头：→ ← ↑ ↓ ⇒
- 其他：★ ☆ ✓ ✗ ● ○ ◆ ◇

## 容易出问题的输入

- 全角空格：　（这里有一个）
- 零宽字符：​（这里有一个）
- 制表符：	（这里有一个）

如果编辑器在这些地方丢字或跳光标，说明装饰器处理有问题。
"""


def build_long_doc() -> str:
    """≥50KB 的长文档，用于性能评估。"""
    parts = ["# 长文档性能测试\n\n本文档约 50 KB，用于观察编辑与滚动是否流畅。\n"]
    for i in range(1, 121):
        parts.append(f"\n## 第 {i} 节\n")
        parts.append(
            f"这是第 {i} 节的正文。段落内容刻意写得比较长，以便模拟真实的笔记密度。"
            f"知识库的价值随着条目增多而增加，但单篇文档过长时，编辑器的渲染策略就会成为瓶颈。"
            f"因此这里特意准备了 {i} 个章节，每节都包含中文段落、`行内代码`、**强调**与 [链接](https://example.com/{i})。\n"
        )
        if i % 10 == 0:
            parts.append("\n```python\n")
            parts.append(f"def section_{i}(x):\n    return x * {i}\n")
            parts.append("```\n")
        if i % 15 == 0:
            parts.append("\n| 列 A | 列 B |\n|---|---|\n| 值 1 | 值 2 |\n")
        if i % 20 == 0:
            parts.append("\n- [ ] 待办项一\n- [x] 待办项二\n")
    return "".join(parts)


NOTES = [
    ("欢迎使用知识库", WELCOME),
    ("Markdown 速查", SYNTAX),
    ("双向链接演示（A）", LINK_A),
    ("双向链接演示（B）", LINK_B),
    ("中文排版测试", CHINESE),
    ("长文档性能测试", build_long_doc()),
]


def main() -> int:
    st, me = call("GET", "/api/auth/me")
    if st != 200:
        st, reg = call("POST", "/api/auth/register",
                       {"username": user, "displayName": "演示账号", "password": pwd})
        if st not in (200, 201):
            # 可能库非空且需要邀请码；尝试直接登录
            st2, _ = call("POST", "/api/auth/login", {"username": user, "password": pwd})
            if st2 != 200:
                print(f"[失败] 注册 HTTP {st} {reg} / 登录 HTTP {st2}")
                return 1
        else:
            print(f"已创建演示账号 {user} / {pwd}（role={reg.get('role')}）")
            call("POST", "/api/auth/login", {"username": user, "password": pwd})
    else:
        print(f"已以 {me.get('username')} 身份登录")

    st, lst = call("GET", "/api/notes?size=200")
    existing = {it["title"] for it in lst.get("items", [])}
    print(f"库中已有 {len(existing)} 篇笔记")

    created = 0
    for title, content in NOTES:
        if title in existing:
            print(f"  跳过（已存在）: {title}")
            continue
        st, note = call("POST", "/api/notes", {"folderId": None, "title": title, "content": content})
        if st == 201:
            created += 1
            print(f"  已创建: {title}  (id={note.get('id')}, {len(content)} 字符)")
        else:
            print(f"  [失败] {title}: HTTP {st} {note}")

    # ---------------------------------------------------------------- 夹具充实
    # 回归脚本（verify-views.mjs）会检查标签视图、收藏视图、历史版本视图。
    # 只造笔记不给这些，那 4 条断言会永远失败 —— 不是功能坏了，是数据不够。
    st, lst1 = call("GET", "/api/notes?size=200")
    by_title = {it["title"]: it["id"] for it in lst1.get("items", [])}

    tag_plan = {
        "欢迎使用知识库": ["入门"],
        "Markdown 速查": ["参考", "入门"],
        "中文排版测试": ["排版", "参考"],
    }
    made_tags = 0
    for title, names in tag_plan.items():
        nid = by_title.get(title)
        if not nid:
            continue
        st, _ = call("PUT", f"/api/notes/{nid}/tags", {"tagNames": names})
        if st == 200:
            made_tags += 1

    fav_titles = ["欢迎使用知识库", "双向链接演示（A）"]
    made_fav = 0
    for title in fav_titles:
        nid = by_title.get(title)
        if not nid:
            continue
        st, _ = call("PATCH", f"/api/notes/{nid}", {"isFavorite": True})
        if st == 200:
            made_fav += 1

    # 历史版本：改两次内容，服务端会各自留一条旧版本
    made_ver = 0
    nid = by_title.get("欢迎使用知识库")
    if nid:
        for i in range(2):
            st, _ = call("PATCH", f"/api/notes/{nid}",
                         {"content": WELCOME + f"\n\n<!-- 版本探针 {i + 1} -->\n"})
            if st == 200:
                made_ver += 1

    st, lst2 = call("GET", "/api/notes?size=200")
    print(f"\n夹具：标签挂载 {made_tags} 篇 / 收藏 {made_fav} 篇 / 版本探针 {made_ver} 次")
    print(f"完成：新建 {created} 篇，库中共 {lst2.get('total')} 篇")
    print(f"登录信息：用户名 {user}  密码 {pwd}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
