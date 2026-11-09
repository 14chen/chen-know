/** 编辑器命令：格式包裹/取消、清除格式、颜色、链接、缩进 */
import { indentLess, indentMore } from '@codemirror/commands'
import type { ChangeSpec, Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import {
  BG_COLORS,
  HEX_COLOR_RE,
  MARKERS,
  TEXT_COLORS,
  bgMarker,
  colorMarker,
  findAdjacentPair,
  findSpanAroundOnLine,
  stripFormats,
  type ColorProp,
  type MarkerPair,
  type TextSource,
} from './format'

interface WrapResult {
  changes: ChangeSpec[]
  anchor: number
  head: number
}

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

/** 单字符标记（`*`）不能吃掉更长标记（`**`）的一份 —— 否则「斜体」会把加粗拆了 */
function isLongerRun(doc: TextSource, pos: number, marker: string, side: -1 | 1): boolean {
  if (marker.length !== 1) return false
  const ch = side < 0 ? doc.sliceString(pos - 1, pos) : doc.sliceString(pos, pos + 1)
  return ch === marker
}

/**
 * 把 [from,to] 里的每个非空行分别用 open/close 包裹（跨行时不产生跨行标记）。
 * 返回要提交的 changes，并把选区映射到「内容」上（不含标记）。
 */
function wrapPerLine(doc: Text, from: number, to: number, pair: MarkerPair): WrapResult | null {
  const changes: ChangeSpec[] = []
  const fromLine = doc.lineAt(from)
  const toLine = doc.lineAt(to)
  let wrapped = 0
  let lastEnd = to
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const line = doc.line(n)
    const start = Math.max(from, line.from)
    let end = Math.min(to, line.to)
    while (end > start && isSpace(doc.sliceString(end - 1, end))) end--
    if (end <= start) continue
    changes.push({ from: start, insert: pair.open })
    changes.push({ from: end, insert: pair.close })
    wrapped++
    lastEnd = end
  }
  if (!wrapped) return null
  const anchor = from + pair.open.length
  const head = lastEnd + wrapped * pair.open.length + (wrapped - 1) * pair.close.length
  return { changes, anchor, head }
}

/**
 * 成对格式的开关：
 * - 选区含标记 → 拆掉；外侧紧贴标记 → 取消；否则包裹（跨行逐行包裹）
 * - 光标为空 → 插入成对标记并把光标放中间
 */
export function togglePair(view: EditorView, pair: MarkerPair): boolean {
  const state = view.state
  const ranges = state.selection.ranges
  const changes: ChangeSpec[] = []
  let selection: { anchor: number; head: number } | null = null
  const single = ranges.length === 1

  for (const r of ranges) {
    const { from, to } = r
    const inner = state.sliceDoc(from, to)
    // 1. 选区自身含标记（含 `**x**` 被整体选中）
    if (
      to - from > pair.open.length + pair.close.length &&
      inner.startsWith(pair.open) &&
      inner.endsWith(pair.close)
    ) {
      changes.push({ from, to: from + pair.open.length, insert: '' })
      changes.push({ from: to - pair.close.length, to, insert: '' })
      if (single) {
        selection = { anchor: from, head: to - pair.open.length - pair.close.length }
      }
      continue
    }
    // 2. 外侧紧贴标记 → 取消
    const adj = from >= pair.open.length ? findAdjacentPair(state.doc, from, to, [pair]) : null
    const guarded =
      adj !== null &&
      (isLongerRun(state.doc, adj.openFrom, pair.open, -1) ||
        isLongerRun(state.doc, adj.closeTo, pair.close, 1))
    if (adj && !guarded) {
      changes.push({ from: adj.openFrom, to: adj.openTo, insert: '' })
      changes.push({ from: adj.closeFrom, to: adj.closeTo, insert: '' })
      if (single) {
        selection = {
          anchor: from - pair.open.length,
          head: to - pair.open.length,
        }
      }
      continue
    }
    // 3. 光标为空 → 插入成对标记
    if (from === to) {
      changes.push({ from, insert: pair.open + pair.close })
      if (single) selection = { anchor: from + pair.open.length, head: from + pair.open.length }
      continue
    }
    // 4. 包裹（跨行逐行）
    const res = wrapPerLine(state.doc, from, to, pair)
    if (res) {
      changes.push(...res.changes)
      if (single) selection = { anchor: res.anchor, head: res.head }
    }
  }
  if (!changes.length) return false
  view.dispatch(selection ? { changes, selection } : { changes })
  return true
}

/** 加粗 / 斜体 / 删除线 / 下划线 / 高亮 / 行内代码 */
export const toggleBold = (view: EditorView) => togglePair(view, MARKERS.bold)
export const toggleItalic = (view: EditorView) => togglePair(view, MARKERS.italic)
export const toggleStrike = (view: EditorView) => togglePair(view, MARKERS.strike)
export const toggleUnderline = (view: EditorView) => togglePair(view, MARKERS.underline)
export const toggleHighlight = (view: EditorView) => togglePair(view, MARKERS.highlight)
export const toggleCode = (view: EditorView) => togglePair(view, MARKERS.code)

/** 兼容旧签名（单标记的成对包裹） */
export function wrapSelection(view: EditorView, marker: string): boolean {
  return togglePair(view, { open: marker, close: marker })
}

/** 文字色 / 背景色：已同色 → 取消；已同属性异色 → 换值；在 span 内 → 精确改值；否则包裹 */
export function setColor(view: EditorView, prop: ColorProp, value: string): boolean {
  if (value !== '' && !HEX_COLOR_RE.test(value)) return false
  const state = view.state
  const r = state.selection.main
  if (r.empty) return false
  const { from, to } = r
  const makePair = prop === 'color' ? colorMarker : bgMarker

  // 1. 紧贴选区的同属性 span
  const adj = findAdjacentPair(state.doc, from, to, null)
  if (adj && adj.prop === prop) {
    if (value === '' || adj.value === value) {
      view.dispatch({
        changes: [
          { from: adj.openFrom, to: adj.openTo, insert: '' },
          { from: adj.closeFrom, to: adj.closeTo, insert: '' },
        ],
        selection: { anchor: from - adj.pair.open.length, head: to - adj.pair.open.length },
      })
      return true
    }
    view.dispatch({ changes: { from: adj.openFrom, to: adj.openTo, insert: makePair(value).open } })
    return true
  }
  if (value === '') return true // 「透明」且当前没有底色 → 无事发生

  // 2. 选区落在同一行的某个同属性 span 内部 → 只改那个 open 的值（不嵌套新 span）
  const around = findSpanAroundOnLine(state, from, to, prop)
  if (around) {
    view.dispatch({
      changes: { from: around.openFrom, to: around.openTo, insert: makePair(value).open },
    })
    return true
  }
  // 3. 常规包裹
  return togglePair(view, makePair(value))
}

/** 清除格式：剥掉选区内（以及紧贴/包住选区的）所有已知包裹，只留纯文字 */
export function clearFormat(view: EditorView): boolean {
  const state = view.state
  const r = state.selection.main
  if (r.empty) return false
  let from = r.from
  let to = r.to

  // 1. 向外吞掉紧贴的成对标记（可嵌套多层）
  for (let i = 0; i < 6; i++) {
    const adj = findAdjacentPair(state.doc, from, to, null)
    if (!adj) break
    from = adj.openFrom
    to = adj.closeTo
  }
  // 2. 同行的包住选区的颜色 span 也一并纳入
  for (const prop of ['color', 'background-color'] as ColorProp[]) {
    for (let i = 0; i < 4; i++) {
      const around = findSpanAroundOnLine(state, from, to, prop)
      if (!around) break
      const line = state.doc.lineAt(around.openFrom)
      const closeIdx = state.sliceDoc(around.openTo, line.to).indexOf('</span>')
      if (closeIdx < 0) break
      const closeFrom = around.openTo + closeIdx
      from = around.openFrom
      to = closeFrom + '</span>'.length
    }
  }

  const text = state.sliceDoc(from, to)
  const cleaned = stripFormats(text)
  if (cleaned === text) return false
  view.dispatch({
    changes: { from, to, insert: cleaned },
    selection: { anchor: from, head: from + cleaned.length },
  })
  return true
}

/** `Ctrl/Cmd+K`：把选区变成 `[文字](url)`，并选中 url 占位符 */
export function insertLink(view: EditorView): boolean {
  const state = view.state
  const r = state.selection.main
  const text = state.sliceDoc(r.from, r.to)
  if (text.includes('\n')) return false // 跨行不做链接（表格/标题里也没意义）
  const url = 'url'
  const insert = `[${text}](${url})`
  const urlFrom = r.from + 1 + text.length + 2
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor: urlFrom, head: urlFrom + url.length },
  })
  return true
}

/** 列表内 Tab 缩进（列表项被缩进后自动成为子项） */
export function indentTab(view: EditorView): boolean {
  return indentMore(view)
}

/** Shift-Tab 反缩进 */
export function outdentTab(view: EditorView): boolean {
  return indentLess(view)
}

/** 调色板常量再导出，便于工具栏与测试使用 */
export { BG_COLORS, TEXT_COLORS }
