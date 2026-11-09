/**
 * Typora 式 live preview 装饰器。
 *
 * 三条不变量：
 * 1. **Markdown 原文是唯一真相**：装饰器只做「隐藏语法标记 / 加样式 / 换成 widget」，
 *    永远不修改文档，也不做 HTML↔Markdown 往返。
 * 2. **当前行（含选区跨行）保持源码**：任何「隐藏类」装饰都跳过与活动行相交的节点。
 * 3. **只处理 view.visibleRanges**：长文档下每次重建的代价与可视区行数成正比。
 *
 * 分成两层，因为 CodeMirror 6 规定「块级装饰 / 替换换行符的装饰」只能由 StateField 提供
 * （ViewPlugin 里会抛 RangeError）：
 * - StateField `blockDecorations`：表格 widget、分隔线、围栏 ``` 行折叠、Setext 下划线折叠。
 *   它看不到视口，因此只在**块级容器**里遍历语法树（Document/引用/列表项下钻，段落直接剪枝），
 *   50 KB 文档也只访问上千个节点。
 * - ViewPlugin `livePreview`：只处理 visibleRanges —— 行级类名、行内标记隐藏、bullet/checkbox/
 *   双链 chip/图片 widget、Table 之外的块级样式。
 *
 * IME：`view.composing` 为真时只做 `map(changes)` 保持位置有效，绝不重建装饰；
 * 组合结束后（wasComposing && !composing）立即补一次重建。
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type WidgetType,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { parseInlineTag, safeStyleText, type ColorProp } from './format'
import {
  BulletWidget,
  CheckboxWidget,
  HrWidget,
  ImageWidget,
  TableWidget,
  WikiChipWidget,
  type LiveHandlers,
} from './widgets'

export interface LivePreviewConfig {
  /** 已知笔记标题（用于 [[双链]] 已存在/未创建的视觉区分），组件会原地更新该数组 */
  knownTitles: string[]
  /** 交互回调容器，组件会原地更新其字段 */
  handlers: LiveHandlers
}

const WIKI_RE = /\[\[([^[\]\n|]{1,120})(?:\|([^[\]\n]{1,120}))?\]\]/g

/** 这些节点内部不做双链扫描（正则兜底不能误伤代码/链接） */
const PROTECTED = new Set([
  'InlineCode',
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'URL',
  'Autolink',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'HTMLTag',
])

const HIDE = Decoration.replace({})
const INLINE_CODE = Decoration.mark({ class: 'cm-kb-code-inline' })

/* 内联 HTML 渲染出的装饰（样式串一律由 format.safeStyleText 用校验后的枚举值重拼）。
   用真实语义元素 <mark> / <u>，而不是 span —— 语义与检查口径都对得上。 */
const HTML_MARK = Decoration.mark({ tagName: 'mark', class: 'cm-kb-hl' })
const HTML_UNDERLINE = Decoration.mark({ tagName: 'u', class: 'cm-kb-u' })
/** 浅色底纹上强制深色文字，保证深色主题下仍可读 */
const HTML_BG_TINT = 'cm-kb-bg-tint'

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-kb-h1',
  ATXHeading2: 'cm-kb-h2',
  ATXHeading3: 'cm-kb-h3',
  ATXHeading4: 'cm-kb-h4',
  ATXHeading5: 'cm-kb-h5',
  ATXHeading6: 'cm-kb-h6',
}

/** 当前行（显示源码的那一行）的类名 */
export const SOURCE_LINE_CLASS = 'cm-kb-src'

interface Span {
  from: number
  to: number
}

function activeRanges(state: EditorState): Span[] {
  const out: Span[] = []
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from)
    const b = state.doc.lineAt(r.to)
    out.push({ from: a.from, to: b.to })
  }
  out.sort((x, y) => x.from - y.from)
  const merged: Span[] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
    else merged.push({ from: r.from, to: r.to })
  }
  return merged
}

function overlaps(list: Span[], from: number, to: number): boolean {
  for (const s of list) {
    if (from <= s.to && to >= s.from) return true
  }
  return false
}

/** 隐藏 [from,to)，可选吞掉后面一个空格（`## ` 的尾空格） */
function hideWithSpace(state: EditorState, from: number, to: number): Range<Decoration> {
  let end = to
  if (state.sliceDoc(end, end + 1) === ' ') end++
  return HIDE.range(from, end)
}

/**
 * 需要「整行收起来」的语法行（围栏 ``` 行、Setext 下划线）用行类把行高归零，
 * 而不是块级 replace：块级 replace 会把**相邻行**的行装饰一起吃掉（实测）。
 * 文本本身用行内 replace 隐藏（不跨换行符，ViewPlugin 允许）。
 */
const HIDDEN_LINE_CLASS = 'cm-kb-fence'

function hasChild(node: SyntaxNode, name: string): boolean {
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) return true
  return false
}

function imageParts(raw: string): { src: string; alt: string } | null {
  const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(raw.trim())
  if (!m) return null
  return { alt: m[1], src: m[2] }
}

/* ══════════════════════════════════════════════════════════════
 * 块级装饰（StateField）：表格 / 分隔线 / 围栏折叠 / Setext 下划线折叠
 * ══════════════════════════════════════════════════════════════ */

function blockReplace(
  state: EditorState,
  from: number,
  to: number,
  widget: WidgetType,
): Range<Decoration> {
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(Math.min(to, state.doc.length))
  // 刻意**不**吃掉尾随换行符：实测把换行符一起替换会让紧随其后的那一行
  // 丢掉行装饰（标题会变成正文大小）。
  return Decoration.replace({ widget, block: true }).range(first.from, last.to)
}

function fenceMarks(node: SyntaxNode): SyntaxNode[] {
  const marks: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === 'CodeMark') marks.push(c)
  return marks
}

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const active = activeRanges(state)
  const doc = state.doc
  const isActive = (from: number, to: number) => overlaps(active, from, to)

  syntaxTree(state).iterate({
    enter: (ref) => {
      const node = ref.node
      switch (node.name) {
        case 'Table':
          if (!isActive(node.from, node.to)) {
            const first = doc.lineAt(node.from)
            const last = doc.lineAt(Math.min(node.to, doc.length))
            decos.push(
              blockReplace(state, node.from, node.to, new TableWidget(doc.sliceString(first.from, last.to))),
            )
          }
          return false
        case 'HorizontalRule': {
          if (!isActive(node.from, node.to)) {
            decos.push(blockReplace(state, node.from, node.to, new HrWidget()))
          }
          return false
        }
        case 'Document':
        case 'Blockquote':
        case 'ListItem':
        case 'BulletList':
        case 'OrderedList':
          return true
        default:
          // 段落/标题内部不可能出现块级表格或分隔线 → 剪枝
          return false
      }
    },
  })
  return Decoration.set(decos, true)
}

const KEY_CACHE = new WeakMap<EditorState, string>()

function activeKey(state: EditorState): string {
  let key = KEY_CACHE.get(state)
  if (key === undefined) {
    key = activeRanges(state)
      .map((r) => `${r.from}-${r.to}`)
      .join(',')
    KEY_CACHE.set(state, key)
  }
  return key
}

interface BlockValue {
  decos: DecorationSet
  key: string
}

/** 块级装饰：必须由 StateField 提供，否则 CodeMirror 会拒绝块级/替换换行的装饰 */
export const blockDecorations = StateField.define<BlockValue>({
  create(state) {
    return { decos: timedBlockBuild(state), key: activeKey(state) }
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value
    const key = activeKey(tr.state)
    if (!tr.docChanged && key === value.key) return value
    return { decos: timedBlockBuild(tr.state), key }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decos),
})

/* ══════════════════════════════════════════════════════════════
 * 行内/行级装饰（ViewPlugin，只处理可视区）
 * ══════════════════════════════════════════════════════════════ */

class InlineBuilder {
  decos: Range<Decoration>[] = []
  readonly handlers: LiveHandlers
  readonly state: EditorState
  private lineClasses = new Map<number, Set<string>>()
  private protectedRanges: Span[] = []
  private htmlTags: Span[] = []
  private active: Span[]
  private known: Set<string>

  constructor(state: EditorState, handlers: LiveHandlers, knownTitles: string[]) {
    this.state = state
    this.handlers = handlers
    this.active = activeRanges(state)
    this.known = new Set(knownTitles)
  }

  /** 收集可见区内的 HTMLTag 节点，供 renderInlineHtml() 配对 */
  pushHtmlTag(from: number, to: number): void {
    this.htmlTags.push({ from, to })
    this.protect(from, to)
  }

  /**
   * 把白名单内联 HTML 渲染成真实样式：
   * `<mark>` 黄底 / `<u>` 下划线 / `<span style="color|background-color:#rrggbb">` 对应颜色。
   * 规则与既有 Markdown 装饰一致：**标签自身所在行是当前行时保留源码**。
   * 不认识的标签/属性不处理（保持源码显示）。
   */
  renderInlineHtml(): void {
    if (!this.htmlTags.length) return
    const tags = [...this.htmlTags].sort((a, b) => a.from - b.from)
    const stack: { tag: 'mark' | 'u' | 'span'; prop?: ColorProp; value?: string; from: number; to: number }[] = []
    for (const t of tags) {
      const parsed = parseInlineTag(this.state.sliceDoc(t.from, t.to))
      if (!parsed) continue
      if (parsed.kind === 'open') {
        stack.push({ tag: parsed.tag, prop: parsed.prop, value: parsed.value, from: t.from, to: t.to })
        continue
      }
      // 闭合：取最近的同名 open
      let idx = -1
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === parsed.tag) {
          idx = i
          break
        }
      }
      if (idx < 0) continue
      const open = stack[idx]
      stack.length = idx
      const contentFrom = open.to
      const contentTo = t.from
      if (contentTo <= contentFrom) continue
      // Typora 行为：标签所在行是当前行 → 保留源码
      const openLine = this.state.doc.lineAt(open.from)
      const closeLine = this.state.doc.lineAt(t.from)
      if (overlaps(this.active, openLine.from, openLine.to)) continue
      if (overlaps(this.active, closeLine.from, closeLine.to)) continue

      let mark: Decoration | null = null
      if (open.tag === 'mark') {
        mark = HTML_MARK
      } else if (open.tag === 'u') {
        mark = HTML_UNDERLINE
      } else if (open.prop && open.value) {
        // 关键安全点：样式串由校验后的属性名 + 6 位十六进制值重新拼出
        const style = safeStyleText(open.prop, open.value)
        mark = style
          ? Decoration.mark({
              class: open.prop === 'background-color' ? HTML_BG_TINT : undefined,
              attributes: { style },
            })
          : null
      }
      if (!mark) continue
      this.decos.push(mark.range(contentFrom, contentTo))
      this.decos.push(HIDE.range(open.from, open.to))
      this.decos.push(HIDE.range(t.from, t.to))
    }
  }

  isActive(from: number, to: number): boolean {
    return overlaps(this.active, from, to)
  }

  addLineClass(lineFrom: number, cls: string): void {
    let set = this.lineClasses.get(lineFrom)
    if (!set) {
      set = new Set()
      this.lineClasses.set(lineFrom, set)
    }
    set.add(cls)
  }

  /** 给 [from,to] 内与可视区相交的所有行加类 */
  addLineClassRange(nodeFrom: number, nodeTo: number, cls: string, vr: Span): void {
    const doc = this.state.doc
    let from = Math.max(nodeFrom, vr.from)
    const to = Math.min(nodeTo, vr.to)
    while (from <= to) {
      const line = doc.lineAt(from)
      this.addLineClass(line.from, cls)
      if (line.to >= to) break
      from = line.to + 1
    }
  }

  /** 给活动行打上「源码行」底纹类 */
  markSourceLines(vr: Span): void {
    const doc = this.state.doc
    for (const s of this.active) {
      let from = Math.max(s.from, vr.from)
      const to = Math.min(s.to, vr.to)
      while (from <= to) {
        const line = doc.lineAt(from)
        this.addLineClass(line.from, SOURCE_LINE_CLASS)
        if (line.to >= to) break
        from = line.to + 1
      }
    }
  }

  protect(from: number, to: number): void {
    this.protectedRanges.push({ from, to })
  }

  push(deco: Range<Decoration> | null): void {
    if (deco) this.decos.push(deco)
  }

  /** 兜底扫描：可视区每行的 [[双链]] */
  scanWikiLinks(vr: Span): void {
    const doc = this.state.doc
    let pos = vr.from
    while (pos <= vr.to) {
      const line = doc.lineAt(pos)
      if (!overlaps(this.active, line.from, line.to) && line.text.includes('[[')) {
        const text = line.text
        WIKI_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = WIKI_RE.exec(text))) {
          const from = line.from + m.index
          const to = from + m[0].length
          if (from >= vr.from && from <= vr.to && !overlaps(this.protectedRanges, from, to)) {
            const title = m[1].trim()
            if (title) {
              const display = (m[2] ?? m[1]).trim()
              this.push(
                Decoration.replace({
                  widget: new WikiChipWidget(display, this.known.has(title), this.handlers),
                }).range(from, to),
              )
            }
          }
        }
      }
      if (line.to >= vr.to) break
      pos = line.to + 1
    }
  }

  finish(): DecorationSet {
    for (const [from, classes] of this.lineClasses) {
      this.push(Decoration.line({ class: [...classes].join(' ') }).range(from))
    }
    return Decoration.set(this.decos, true)
  }
}

function handleInlineNode(b: InlineBuilder, node: SyntaxNode, vr: Span): boolean | void {
  const state = b.state
  const doc = state.doc
  const name = node.name

  switch (name) {
    /* ── 行级 ─────────────────────────────────────── */
    case 'FencedCode': {
      b.protect(node.from, node.to)
      const openLine = doc.lineAt(node.from)
      const endLine = doc.lineAt(Math.min(node.to, doc.length))
      const marks = fenceMarks(node)
      const closeLine = marks.length > 1 ? doc.lineAt(marks[1].from) : null
      const interactive = b.isActive(node.from, node.to)
      const firstContent = openLine.number + 1
      const lastContent = closeLine ? closeLine.number - 1 : endLine.number
      if (lastContent >= firstContent) {
        for (let n = firstContent; n <= lastContent; n++) {
          const ln = doc.line(n)
          b.addLineClass(ln.from, 'cm-kb-code')
          if (n === firstContent) b.addLineClass(ln.from, 'cm-kb-code-first')
          if (n === lastContent) b.addLineClass(ln.from, 'cm-kb-code-last')
        }
      } else {
        // 空代码块：保留一行空的代码行，别让整块消失
        b.addLineClass(openLine.from, 'cm-kb-code')
        b.addLineClass(openLine.from, 'cm-kb-code-first')
        b.addLineClass(openLine.from, 'cm-kb-code-last')
      }
      if (!interactive) {
        for (const mark of marks) {
          const line = doc.lineAt(mark.from)
          b.addLineClass(line.from, HIDDEN_LINE_CLASS)
          if (line.to > line.from) b.push(HIDE.range(line.from, line.to))
        }
      }
      return false
    }
    case 'CodeBlock': {
      b.protect(node.from, node.to)
      b.addLineClassRange(node.from, node.to, 'cm-kb-code', vr)
      return false
    }
    case 'Table':
      return false
    case 'HorizontalRule':
      return false
    case 'Blockquote': {
      b.addLineClassRange(node.from, node.to, 'cm-kb-quote', vr)
      return
    }
    case 'SetextHeading1':
    case 'SetextHeading2': {
      const cls = name === 'SetextHeading1' ? 'cm-kb-h1' : 'cm-kb-h2'
      const textLine = doc.lineAt(node.from)
      b.addLineClass(textLine.from, cls)
      const mark = node.lastChild
      if (mark && mark.name === 'HeaderMark') {
        const under = doc.lineAt(mark.from)
        if (under.number !== textLine.number && !b.isActive(mark.from, mark.to)) {
          b.addLineClass(under.from, HIDDEN_LINE_CLASS)
          if (under.to > under.from) b.push(HIDE.range(under.from, under.to))
        }
      }
      return false
    }
    case 'ATXHeading1':
    case 'ATXHeading2':
    case 'ATXHeading3':
    case 'ATXHeading4':
    case 'ATXHeading5':
    case 'ATXHeading6': {
      // 字号/间距走整行类，而不是 highlight tag —— 这样当前行显示 `##` 源码时
      // 标记本身也跟标题一样大（与 Typora 一致）
      b.addLineClassRange(node.from, node.to, HEADING_CLASS[name], vr)
      return
    }

    /* ── 行内 ─────────────────────────────────────── */
    case 'InlineCode': {
      b.push(INLINE_CODE.range(node.from, node.to))
      return
    }
    case 'Image': {
      const slice = state.sliceDoc(node.from, node.to)
      const img = imageParts(slice)
      if (img && !b.isActive(node.from, node.to)) {
        b.push(Decoration.replace({ widget: new ImageWidget(img.src, img.alt) }).range(node.from, node.to))
      }
      return false
    }
    case 'Task': {
      const marker = node.firstChild
      if (!marker || marker.name !== 'TaskMarker') return
      // 只有 `[ ]` 自己落在当前行时才显示源码：Task 节点可能吞掉后一行
      // （列表项的惰性续行），按节点判断会让复选框无谓地消失
      if (b.isActive(marker.from, marker.to)) return
      const parent = node.parent
      const mark = parent && parent.firstChild?.name === 'ListMark' ? parent.firstChild : null
      const checked = /[xX]/.test(state.sliceDoc(marker.from, marker.to))
      b.push(
        Decoration.replace({
          widget: new CheckboxWidget(checked, marker.from, b.handlers),
        }).range(mark ? mark.from : marker.from, marker.to),
      )
      return
    }
    case 'HeaderMark': {
      if (!b.isActive(node.from, node.to)) {
        const line = doc.lineAt(node.from)
        // Setext 下划线独占一行，整个折叠由 StateField 处理；这里只管 ATX 的 `#`
        if (node.from !== line.from || node.to !== line.to) {
          b.push(hideWithSpace(state, node.from, node.to))
        }
      }
      return false
    }
    case 'QuoteMark': {
      if (!b.isActive(node.from, node.to)) b.push(hideWithSpace(state, node.from, node.to))
      return false
    }
    case 'ListMark': {
      // 结构：BulletList > ListItem > ListMark
      const item = node.parent
      const list = item?.parent
      if (!item || !list || list.name !== 'BulletList' || b.isActive(node.from, node.to)) return false
      // 任务列表项由复选框接管
      if (hasChild(item, 'Task')) return false
      b.push(Decoration.replace({ widget: new BulletWidget('•') }).range(node.from, node.to))
      return false
    }
    case 'TaskMarker':
      return false
    case 'EmphasisMark':
    case 'StrikethroughMark':
    case 'CodeMark':
    case 'LinkMark': {
      if (!b.isActive(node.from, node.to)) b.push(HIDE.range(node.from, node.to))
      return false
    }
    case 'URL': {
      if (b.isActive(node.from, node.to)) return false
      const link = node.parent
      if (link && link.name === 'Link' && state.sliceDoc(link.from, link.from + 1) === '[') {
        b.push(HIDE.range(node.from, node.to))
      }
      return false
    }
    case 'LinkLabel': {
      if (!b.isActive(node.from, node.to)) b.push(HIDE.range(node.from, node.to))
      return false
    }
    default: {
      if (name === 'HTMLTag') {
        b.pushHtmlTag(node.from, node.to)
        return false
      }
      if (PROTECTED.has(name)) b.protect(node.from, node.to)
      return
    }
  }
}

function buildInlineDecorations(view: EditorView, cfg: LivePreviewConfig): DecorationSet {
  const state = view.state
  const b = new InlineBuilder(state, cfg.handlers, cfg.knownTitles)
  const tree = syntaxTree(state)
  for (const vr of view.visibleRanges) {
    const span: Span = { from: vr.from, to: vr.to }
    b.markSourceLines(span)
    tree.iterate({
      from: vr.from,
      to: vr.to,
      enter: (ref) => handleInlineNode(b, ref.node, span),
    })
    b.scanWikiLinks(span)
  }
  b.renderInlineHtml()
  return b.finish()
}

/* ══════════════════════════════════════════════════════════════
 * 插件 + 统计
 * ══════════════════════════════════════════════════════════════ */

/** 装饰器运行统计（测试台用来量化「组合输入期间不重建」与构建耗时） */
export const livePreviewStats = {
  builds: 0,
  lastMs: 0,
  totalMs: 0,
  blockBuilds: 0,
  blockLastMs: 0,
  blockTotalMs: 0,
  reset() {
    this.builds = 0
    this.lastMs = 0
    this.totalMs = 0
    this.blockBuilds = 0
    this.blockLastMs = 0
    this.blockTotalMs = 0
  },
}

function timedBlockBuild(state: EditorState): DecorationSet {
  const t0 = performance.now()
  const set = buildBlockDecorations(state)
  const dt = performance.now() - t0
  livePreviewStats.blockBuilds++
  livePreviewStats.blockLastMs = dt
  livePreviewStats.blockTotalMs += dt
  return set
}

export function livePreview(cfg: LivePreviewConfig): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private composing = false
      constructor(view: EditorView) {
        this.decorations = this.rebuild(view)
      }
      private rebuild(view: EditorView): DecorationSet {
        const t0 = performance.now()
        const set = buildInlineDecorations(view, cfg)
        const dt = performance.now() - t0
        livePreviewStats.builds++
        livePreviewStats.lastMs = dt
        livePreviewStats.totalMs += dt
        return set
      }
      update(u: ViewUpdate) {
        const wasComposing = this.composing
        this.composing = u.view.composing
        // 组合输入中：只保证旧装饰随文档位移有效，绝不重建（否则丢字/跳光标）
        if (u.docChanged) this.decorations = this.decorations.map(u.changes)
        if (u.view.composing) return
        if (
          wasComposing ||
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.transactions.length > 0
        ) {
          this.decorations = this.rebuild(u.view)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  )
}
