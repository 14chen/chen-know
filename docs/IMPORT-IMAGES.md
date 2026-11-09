# 导入图片支持 · 本轮冻结契约

> 背景：导入的 Markdown 里图片显示不出来。根因有两个，都已复现取证：
> ① `ImportService.readZip()` 只处理 `.md` 条目，ZIP 里的图片被当成「跳过」静默丢弃，正文引用也不重写 → 404；
> ② `ExportService.markdown()` 原样拼接 `note.content()`，导出的引用是 `/api/attachments/{id}`，在外部工具里无意义 —— **连我们自己的导出→再导入都会丢图**。
>
> 结论：**「导出不被锁死」这个承诺目前在图片上是假的**，本轮补上。

---

## 1. 目标

1. **三种输入入口都能带图**：选文件夹 / ZIP / 多选（.md + 图片混合）
2. **正文引用自动重写**：`![](images/a.png)` → `![](/api/attachments/42)`
3. **找不到的图明确报告**，不再静默丢弃
4. **导出的 ZIP 在 Typora / Obsidian / VS Code 里能直接看图**
5. 不改动已有笔记的语义；不引入绕过附件校验的路径

---

## 2. 核心机制：相对路径空间

不管文件从哪来，导入前先把它们放进一个索引：

```
Map<String, byte[]> filesByPath
  key   = 归一化的相对路径（POSIX 分隔符 `/`，无前导 `./`，无盘符，无 `..`）
  value = 文件字节
```

| 来源 | key 怎么来 |
|---|---|
| ZIP | `ZipEntry.getName()` 归一化 |
| 选文件夹 | 前端传 `file.webkitRelativePath`（形如 `docs/images/a.png`） |
| 多选 | 前端传 `file.name`（只有文件名） |

**传输约定**：multipart 的每个文件部分，`filename` 就携带相对路径（含 `/`）。
服务端规则：`filename` 含 `/` → 当相对路径；不含 `/` → 只有文件名（等同放在虚拟根目录）。
这样零新字段、向后兼容。

---

## 3. 引用解析规则

对每个 `.md`（其相对路径记作 `mdPath`）：

### 3.1 识别这些形式的图片引用

```
![alt](target)
![alt](target "title")
![](<target with spaces>)
<img src="target">
<img src='target'>
```

**不做**：`![alt][ref]` 引用式写法（记入 missing 并在报告里注明「暂不支持引用式」）。

### 3.2 跳过（原样保留，不算缺失）

- `http://` `https://` `//` 开头 —— 外部地址
- `data:` 开头 —— 内联数据
- `/api/attachments/` 开头 —— 我们自己的附件（同库内引用）

### 3.3 归一化 target

1. 去掉可能的 `< >` 包裹；URL-decode（`%20` → 空格）
2. 去掉 `?query` 和 `#fragment`
3. 若以 `./` 或 `../` 开头，或既不以 `/` 也不含协议 → **相对 `dirname(mdPath)`** 解析，逐段处理 `..`（越界则判定非法）
4. 若以 `/` 开头 → 按「相对仓库根」处理（去掉前导 `/`）
5. 结果必须是「归一化相对路径」，含 `..` 或盘符则判为**非法**（记入缺失，理由写「路径非法」）

### 3.4 在索引里匹配（按顺序，命中即止）

1. **精确匹配**归一化路径
2. **大小写不敏感**匹配（Windows 来源的路径常见）
3. **basename 唯一匹配**：全索引里按文件名找，**恰好一个**才算命中；有多个同名 → 判定未命中（避免配错图）

### 3.5 结果

- **命中** → 该图片作为附件上传，引用重写为 `/api/attachments/{新id}`
- **未命中** → **正文原样保留**（不删、不改），记入 `missingImages`

---

## 4. 附件上传

- **必须复用** `AttachmentService.upload(principal, MultipartFile, noteId)` —— 它里面有 20 MB 上限与 MIME 白名单校验，**不得绕过**，不得直接写 `uploads/` 目录
- 需要把 `byte[]` 包成 `MultipartFile`（自己写个最小实现即可）
- `originalName` 用索引里的 **basename**（保留扩展名），这样以后导出还能认出来
- 附件类型白名单以外的文件（例如 `.svg`？按现有白名单为准）→ 不上传，记入 `missingImages`，理由写「不支持的图片类型」

---

## 5. 处理顺序（重要）

附件需要 `noteId` 才能关联，所以对每篇带图的笔记：

```
1. 插入笔记（正文先按**原文**存，保证双链等不受影响）
2. 逐个上传命中的图片（带 noteId）
3. PATCH 正文为**重写后**的内容
```

- 若步骤 2/3 失败 → 该篇记入 `errors`，但**已插入的笔记不删除**（用户能看到原文与部分图片），并在错误里说明
- 没有图片引用的笔记 → 只做步骤 1（**不要**多做一次 PATCH）

---

## 6. 契约变更（`docs/API.md` §10 增补）

### 6.1 请求

`POST /api/import/preview` 与 `POST /api/import/markdown`：

- 每个文件的 multipart `filename` **可以**是相对路径（含 `/`）
- 文件类型白名单扩大：`.md` / `.markdown` / `.zip` **+ 图片类型**（与 `AttachmentTypes` 白名单一致，例如 png/jpg/jpeg/gif/webp/bmp）
- 纯图片文件**不会**单独产生笔记，只作为图片素材

### 6.2 响应新增字段

两个接口的响应都增加：

```json
{
  "imported": 3,
  "skipped": 1,
  "errors": [],
  "imagesImported": 5,
  "missingImages": [
    {
      "sourceFile": "notes/使用手册.md",
      "title": "使用手册",
      "line": 12,
      "target": "images/02-登录页.png",
      "reason": "文件集合里没有这个路径"
    }
  ]
}
```

- `imagesImported`：成功上传的图片数
- `missingImages[]`：找不到的引用，**逐条列出**（preview 阶段也要给，让用户在确认前就知道）
- `reason` 取值：`文件集合里没有这个路径` / `路径非法` / `不支持的图片类型` / `暂不支持引用式写法`

> `preview` 语义不变：**只解析、不入库、不上传**。它报告的 `missingImages` 是「如果现在导入，这些会缺」。

---

## 7. 导出侧改动

`ExportService.markdown()`：把正文里我们自己的附件引用重写为 **相对于该 `.md` 所在目录** 的路径。

```
底部路径 = ../ × (mdPath 的目录层数) + "attachments/{id}-{originalName}"
```

| 笔记在包内的位置 | 引用写成 |
|---|---|
| `notes/技术/前端/x.md` | `../../../attachments/15-图.png` |
| `notes/技术/x.md` | `../../attachments/15-图.png` |
| `notes/x.md` | `../attachments/15-图.png` |
| 单篇导出 `x.md`（虚拟根） | `attachments/15-图.png` |

> ⚠️ **本契约初版写的是「与 ZIP 条目名逐字一致」，那是错的。**
> Markdown 的相对链接由渲染器**相对该 `.md` 文件所在目录**解析，不是相对压缩包根。
> 若写成 `attachments/15-图.png`，`notes/技术/x.md` 会被解析到 `notes/技术/attachments/…` → 找不到。
> 正确的判据是「**解析后**指向 ZIP 内那个条目」，而不是「文本与条目名相同」。

- `{originalName}` 必须与 ZIP 条目名**逐字相同**（含空格等字符时用 `![](<...>)` 包裹，**不做百分号编码** —— 磁盘上的文件名就是带空格的，Typora/VS Code 按字面找文件）
- 两种形式都要处理：`![](/api/attachments/3)` 与 `<img src="/api/attachments/3">`（后者是 HTML 属性语义，属性值里不写尖括号）
- 引用指向的附件**在本库不存在**时：保留原文，不报错（导出不该因为脏数据失败）
- **往返自证**：用同一套「相对 `dirname(mdPath)` 解析」的规则（§3.3）重新导入，`../../../attachments/15-图.png` 必须能正确解回 ZIP 内的 `attachments/15-图.png`

---

## 8. 前端改动（`views/io/index.tsx`）

1. `ACCEPT` 增加图片类型；文案从「支持多个 .md / .markdown，或单个 .zip」改为
   「支持 .md / 图片 / 单个 .zip，也可以**选择整个文件夹**」
2. **新增「选择文件夹」按钮**：`<input type="file" webkitdirectory multiple>`。
   提交时用 `file.webkitRelativePath` 作为 filename —— 这是从 Obsidian/Typora 搬家的主路径
3. 多选/文件夹选择时，**图片文件不单独产生笔记**，按 `filename` 参与索引
4. **预览与结果里展示缺图**：
   - 预览弹窗里，若 `missingImages` 非空，用醒目但非报错的样式列出（「N 张图片找不到」+ 明细）
   - 导入结果里同样展示
   - **不得**因为缺图阻断导入（缺图是常态，不该挡住正文）
5. 拖拽上传同样支持图片与文件夹（`DataTransferItem.webkitGetAsEntry()` 递归；若实现成本高，**可只做 input 选择文件夹**，拖拽仅支持文件，但要在回报里说明）

---

## 9. 边界与安全

| 项 | 要求 |
|---|---|
| Zip Slip | 保持现有逐条目校验（绝对路径 / `..` / 盘符一律拒绝） |
| 相对路径穿透 | 前端传来的 `filename` 同样归一化，含 `..` 或盘符 → 拒绝该文件并记 errors |
| 总量上限 | 保持现有 200 MB 解压上限；多选/文件夹的**总字节数**也要有上限（与 ZIP 一致或更低），超限拒绝整批并说明 |
| 条目数上限 | 保持 `MAX_ZIP_ENTRIES`；多选/文件夹的文件数同样限制 |
| 图片大小 | 单张 > 20 MB → 不上传，记入 `missingImages`（理由「超过单文件上限」） |
| 权限 | 附件与笔记都必须带 `spaceId`；不得跨空间 |
| 事务 | 单篇笔记失败不影响其他笔记（现有语义保持） |

---

## 10. 验收标准

**必须用真实文件跑通，不接受「应该可以」：**

1. **ZIP 带图**：ZIP 内 `notes/a.md` + `notes/images/pic.png`，正文 `![](images/pic.png)`
   → 导入后 `imagesImported ≥ 1`，正文引用变成 `/api/attachments/{id}`，且该 URL 返回 200 且字节与原图一致
2. **文件夹带图**：同样内容以「相对路径 filename」提交 → 同上
3. **多选带图**：`a.md` + `same.png`（同目录）→ basename 匹配命中
4. **缺图报告**：引用一个不存在的文件 → 正文原样保留 + `missingImages` 有对应条目 + `reason` 正确
5. **外部地址跳过**：`![](https://example.com/x.png)` → 不算缺失、不改写
6. **导出往返**：造一篇带附件的笔记 → 导出 ZIP → 解压检查 `attachments/` 里的图与 md 里的引用**逐字对应** → 重新导入这个 ZIP → 图重新挂上（`imagesImported ≥ 1`）且能取到
7. **外部工具可渲染**：导出的 ZIP 解压后用**绝对路径**打开那个 `.md`，确认图片引用解析到真实存在的文件（可以用脚本断言文件存在，不必真开 Typora）
8. **回归**：`mvnw -B test` 全绿（基线 162）；`e2e-acceptance.py` 的 J 区块（导入导出）与 §10 相关断言全绿
9. **预览不写库**：调 `preview` 后 `attachmentCount` 与笔记数**不变**
10. **非法路径**：`filename` 含 `..\..\x.png` → 被拒绝且不进正文
11. **大小限制**：超限图片不计入 `imagesImported`，记入 `missingImages`

---

## 11. 文件所有权

| 文件 | 归属 |
|---|---|
| `backend/src/main/java/com/kb/ioport/**` | **kb-ext-api** |
| `backend/src/test/java/com/kb/ioport/**` | **kb-ext-api** |
| `frontend/src/views/io/index.tsx` | **kb-web-admin** |
| `frontend/src/api/io.ts`（若需新增） | **kb-web-admin** |
| `docs/API.md` §10 增补 | **Lead**（由 Lead 统一改，实现者不要动） |
| `docs/IMPORT-IMAGES.md`（本文） | **Lead** |

**不要动**：`com.kb.attachment.**`（复用其 `upload` 即可）、`com.kb.note.**`、`frontend/src/shell/**`、`frontend/src/views/` 下其它视图、`package.json`、`vite.config.ts`、`tsconfig*`。
