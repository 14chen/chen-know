/**
 * 富文本格式的**唯一真源**（对应 docs/EDITOR-FORMAT.md §2）。
 *
 * 存储格式（写进笔记正文的原文）：
 *   加粗 **文字**   斜体 *文字*   删除线 ~~文字~~   行内代码 `文字`   链接 [文字](url)
 *   高亮 <mark>文字</mark>
 *   下划线 <u>文字</u>
 *   文字色 <span style="color:#e11d48">文字</span>
 *   背景色 <span style="background-color:#fef08a">文字</span>
 *
 * 安全约束（第二轮红线，不得破例）：
 *   - 只认 color / background-color 两个属性，值必须匹配 ^#[0-9a-f]{6}$（小写）
 *   - 绝不把用户写的 style 字符串塞进 DOM；渲染样式串一律由**校验后的枚举值**重新拼出
 *   - 不认识的标签/属性不渲染（保持源码显示）
 */

/** 允许的十六进制颜色：小写 6 位 */
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/

/** 文字颜色调色板（固定，不给自由取色 —— 保证产出干净可预期） */
export const TEXT_COLORS = [
  { value: '#e11d48', name: '红' },
  { value: '#ea580c', name: '橙' },
  { value: '#ca8a04', name: '黄' },
  { value: '#16a34a', name: '绿' },
  { value: '#2563eb', name: '蓝' },
  { value: '#7c3aed', name: '紫' },
  { value: '#475569', name: '灰' },
] as const

/** 背景颜色调色板；value 为空串代表「透明 = 清除底色」 */
export const BG_COLORS = [
  { value: '', name: '透明' },
  { value: '#fee2e2', name: '红' },
  { value: '#ffedd5', name: '橙' },
  { value: '#fef9c3', name: '黄' },
  { value: '#dcfce7', name: '绿' },
  { value: '#dbeafe', name: '蓝' },
  { value: '#ede9fe', name: '紫' },
  { value: '#f1f5f9', name: '灰' },
  { value: '#e5e7eb', name: '深灰' },
] as const

export type ColorProp = 'color' | 'background-color'

export interface MarkerPair {
  open: string
  close: string
}

export const MARKERS = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  strike: { open: '~~', close: '~~' },
  code: { open: '`', close: '`' },
  underline: { open: '<u>', close: '</u>' },
  highlight: { open: '<mark>', close: '</mark>' },
} satisfies Record<string, MarkerPair>

export function colorMarker(value: string): MarkerPair {
  return { open: `<span style="color:${value}">`, close: '</span>' }
}

export function bgMarker(value: string): MarkerPair {
  return { open: `<span style="background-color:${value}">`, close: '</span>' }
}

/** 所有内联包裹对（长 open 优先，避免 `**` 被 `*` 抢走） */
export function allPairs(): MarkerPair[] {
  const pairs: MarkerPair[] = [
    MARKERS.bold,
    MARKERS.strike,
    MARKERS.italic,
    MARKERS.code,
    MARKERS.underline,
    MARKERS.highlight,
    ...TEXT_COLORS.map((c) => colorMarker(c.value)),
    ...BG_COLORS.filter((c) => c.value).map((c) => bgMarker(c.value)),
  ]
  return pairs.sort((a, b) => b.open.length - a.open.length)
}

export interface InlineTag {
  kind: 'open' | 'close'
  tag: 'mark' | 'u' | 'span'
  /** 仅 span 有 */
  prop?: ColorProp
  value?: string
}

const RE = {
  openMark: /^<mark\s*>$/i,
  closeMark: /^<\/mark\s*>$/i,
  openU: /^<u\s*>$/i,
  closeU: /^<\/u\s*>$/i,
  openSpan: /^<span\s+([^>]*?)>$/i,
  closeSpan: /^<\/span\s*>$/i,
  styleAttr: /^style\s*=\s*(?:"([^"]*)"|'([^']*)')$/,
  styleDecl: /^(color|background-color)\s*:\s*(#[0-9a-f]{6})$/,
}

/** 解析一个内联 HTML 标签源码，只承认白名单形态；null = 不渲染（保持源码） */
export function parseInlineTag(raw: string): InlineTag | null {
  const text = raw.trim()
  if (RE.closeMark.test(text)) return { kind: 'close', tag: 'mark' }
  if (RE.openMark.test(text)) return { kind: 'open', tag: 'mark' }
  if (RE.closeU.test(text)) return { kind: 'close', tag: 'u' }
  if (RE.openU.test(text)) return { kind: 'open', tag: 'u' }
  if (RE.closeSpan.test(text)) return { kind: 'close', tag: 'span' }
  const open = RE.openSpan.exec(text)
  if (open) {
    const attr = RE.styleAttr.exec(open[1].trim())
    if (!attr) return null
    const decl = RE.styleDecl.exec((attr[1] ?? attr[2] ?? '').trim())
    if (!decl) return null
    return { kind: 'open', tag: 'span', prop: decl[1] as ColorProp, value: decl[2] }
  }
  return null
}

/**
 * 渲染用样式串：由**校验后的属性名 + 校验过的 6 位十六进制值**重新拼出，
 * 不是用户原文的任何切片。仅供 Decoration.mark({attributes:{style}}) 使用。
 */
export function safeStyleText(prop: ColorProp, value: string): string | null {
  if (prop !== 'color' && prop !== 'background-color') return null
  if (!HEX_COLOR_RE.test(value)) return null
  return `${prop}:${value}`
}

/** 纯文本剥离：把选区里的所有已知包裹标记去掉，只留文字 */
export function stripFormats(text: string): string {
  return text
    .replace(/<\/?(?:mark|u)\s*>/gi, '')
    .replace(/<span\s+style\s*=\s*"(?:color|background-color)\s*:\s*#[0-9a-f]{6}"\s*>/gi, '')
    .replace(/<span\s+style\s*=\s*'(?:color|background-color)\s*:\s*#[0-9a-f]{6}'\s*>/gi, '')
    .replace(/<\/span\s*>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/~~/g, '')
    .replace(/`/g, '')
    .replace(/\*/g, '')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
}

/** 紧贴 [from,to] 外侧的成对标记（工具栏产出的一定是这种形态） */
export interface AdjacentPair {
  openFrom: number
  openTo: number
  closeFrom: number
  closeTo: number
  pair: MarkerPair
  prop?: ColorProp
  value?: string
}

export interface TextSource {
  sliceString(from: number, to: number): string
}

/** 找到紧贴选区外侧的某个成对标记；pairs 传 null 表示「任意已知标记」 */
export function findAdjacentPair(
  doc: TextSource,
  from: number,
  to: number,
  pairs: MarkerPair[] | null,
): AdjacentPair | null {
  const list = pairs ?? allPairs()
  for (const pair of list) {
    if (from < pair.open.length) continue
    if (doc.sliceString(from - pair.open.length, from) !== pair.open) continue
    if (doc.sliceString(to, to + pair.close.length) !== pair.close) continue
    const parsed = parseInlineTag(pair.open)
    return {
      openFrom: from - pair.open.length,
      openTo: from,
      closeFrom: to,
      closeTo: to + pair.close.length,
      pair,
      prop: parsed?.prop,
      value: parsed?.value,
    }
  }
  return null
}

/**
 * 在同一行内找「包住选区」的颜色 span（选区是它的真子集时用），
 * 返回该 open 标签的位置与旧值，便于精确改值而不是嵌套一层新 span。
 */
export function findSpanAroundOnLine(
  state: { doc: { lineAt: (pos: number) => { from: number; to: number } }; sliceDoc: TextSource['sliceString'] },
  from: number,
  to: number,
  prop: ColorProp,
): { openFrom: number; openTo: number; value: string } | null {
  const line = state.doc.lineAt(from)
  if (state.doc.lineAt(to).from !== line.from) return null // 跨行不处理
  const text = state.sliceDoc(line.from, line.to)
  const re = new RegExp(`<span\\s+style\\s*=\\s*"(?:${prop})\\s*:\\s*(#[0-9a-f]{6})"\\s*>`, 'g')
  let best: { openFrom: number; openTo: number; value: string } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const openFrom = line.from + m.index
    const openTo = openFrom + m[0].length
    if (openTo > from) break // 必须在选区左外侧
    const closeIdx = text.indexOf('</span>', to - line.from)
    if (closeIdx < 0) continue
    best = { openFrom, openTo, value: m[1] }
  }
  return best
}
