/**
 * live-preview 用的装饰部件（widget）。
 *
 * 约定：
 * - 每个 widget 都实现 `eq()`，只比较「展示数据」。否则每次重建装饰都会
 *   重建 DOM，图片会闪、复选框会丢焦点、IME 组合也会被打断。
 * - 交互回调统一走 `LiveHandlers`（一个由插件持有的**稳定对象**），
 *   widget 只捕获这个对象，因此回调换了实现也不需要重建 DOM。
 *
 * 注意：`erasableSyntaxOnly` 禁用构造函数参数属性，字段必须显式声明 + 赋值。
 */
import { WidgetType } from '@codemirror/view'

export interface LiveHandlers {
  /** 点击 [[双链]] 时调用 */
  onWikiLink?: (title: string) => void
  /** 点击任务复选框时调用，markerPos 指向 `[ ]` 起点 */
  onToggleTask?: (markerPos: number, nextChecked: boolean) => void
}

/** 无序列表项目符号 */
export class BulletWidget extends WidgetType {
  readonly char: string
  constructor(char: string) {
    super()
    this.char = char
  }
  eq(other: WidgetType) {
    return other instanceof BulletWidget && other.char === this.char
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-kb-bullet'
    span.textContent = this.char
    return span
  }
  ignoreEvent() {
    return false
  }
}

/** 任务列表复选框（可点击切换） */
export class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  readonly markerPos: number
  readonly handlers: LiveHandlers
  constructor(checked: boolean, markerPos: number, handlers: LiveHandlers) {
    super()
    this.checked = checked
    this.markerPos = markerPos
    this.handlers = handlers
  }
  eq(other: WidgetType) {
    return other instanceof CheckboxWidget && other.checked === this.checked
  }
  toDOM() {
    const box = document.createElement('span')
    box.className = this.checked ? 'cm-kb-checkbox cm-kb-checkbox-on' : 'cm-kb-checkbox'
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.title = this.checked ? '标记为未完成' : '标记为已完成'
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.handlers.onToggleTask?.(this.markerPos, !this.checked)
    })
    return box
  }
  ignoreEvent() {
    return false
  }
}

/** 分隔线 `---` */
export class HrWidget extends WidgetType {
  eq(other: WidgetType) {
    return other instanceof HrWidget
  }
  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-kb-hr'
    const hr = document.createElement('hr')
    div.appendChild(hr)
    return div
  }
  ignoreEvent() {
    return false
  }
}

/** [[双链]] 芯片 */
export class WikiChipWidget extends WidgetType {
  readonly title: string
  readonly exists: boolean
  readonly handlers: LiveHandlers
  constructor(title: string, exists: boolean, handlers: LiveHandlers) {
    super()
    this.title = title
    this.exists = exists
    this.handlers = handlers
  }
  eq(other: WidgetType) {
    return (
      other instanceof WikiChipWidget && other.title === this.title && other.exists === this.exists
    )
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.exists ? 'cm-kb-chip' : 'cm-kb-chip cm-kb-chip-new'
    span.textContent = this.title
    span.title = this.exists ? `打开：${this.title}` : `尚未创建：${this.title}`
    span.setAttribute('role', 'link')
    span.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.handlers.onWikiLink?.(this.title)
    })
    return span
  }
  ignoreEvent() {
    return false
  }
}

/** 行内图片 */
export class ImageWidget extends WidgetType {
  readonly src: string
  readonly alt: string
  constructor(src: string, alt: string) {
    super()
    this.src = src
    this.alt = alt
  }
  eq(other: WidgetType) {
    return other instanceof ImageWidget && other.src === this.src && other.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-kb-image'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    img.className = 'cm-kb-image-el'
    // 图片加载失败时降级为原始 markdown 文本，避免出现破图
    img.addEventListener('error', () => {
      wrap.textContent = `![${this.alt}](${this.src})`
      wrap.classList.add('cm-kb-image-broken')
    })
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

interface ParsedTable {
  head: string[]
  align: (string | null)[]
  rows: string[][]
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (c === '|') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur.trim())
  return out
}

function parseTable(source: string): ParsedTable {
  const lines = source.split('\n').filter((l) => l.trim().length > 0)
  if (!lines.length) return { head: [], align: [], rows: [] }
  const head = splitRow(lines[0])
  const align: (string | null)[] = []
  const rows: string[][] = []
  let bodyStart = 1
  if (lines.length > 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1]) && lines[1].includes('-')) {
    for (const cell of splitRow(lines[1])) {
      const t = cell.trim()
      const left = t.startsWith(':')
      const right = t.endsWith(':')
      align.push(!left && !right ? null : left && right ? 'center' : left ? 'left' : 'right')
    }
    bodyStart = 2
  }
  for (let i = bodyStart; i < lines.length; i++) rows.push(splitRow(lines[i]))
  return { head, align, rows }
}

/** 表格块部件 */
export class TableWidget extends WidgetType {
  readonly source: string
  constructor(source: string) {
    super()
    this.source = source
  }
  eq(other: WidgetType) {
    return other instanceof TableWidget && other.source === this.source
  }
  toDOM() {
    const { head, align, rows } = parseTable(this.source)
    const table = document.createElement('table')
    table.className = 'cm-kb-table'
    const applyAlign = (el: HTMLElement, i: number) => {
      const a = align[i]
      if (a) el.style.textAlign = a
    }
    if (head.length) {
      const thead = document.createElement('thead')
      const tr = document.createElement('tr')
      head.forEach((cell, i) => {
        const th = document.createElement('th')
        applyAlign(th, i)
        th.appendChild(renderInline(cell))
        tr.appendChild(th)
      })
      thead.appendChild(tr)
      table.appendChild(thead)
    }
    if (rows.length) {
      const tbody = document.createElement('tbody')
      for (const row of rows) {
        const tr = document.createElement('tr')
        row.forEach((cell, i) => {
          const td = document.createElement('td')
          applyAlign(td, i)
          td.appendChild(renderInline(cell))
          tr.appendChild(td)
        })
        tbody.appendChild(tr)
      }
      table.appendChild(tbody)
    }
    const wrap = document.createElement('div')
    wrap.className = 'cm-kb-table-wrap'
    wrap.appendChild(table)
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

const INLINE_RE =
  /(\*\*|__)([^*_\n]+?)\1|(\*|_)([^*_\n]+?)\3|`([^`\n]+)`|~~([^~\n]+?)~~|\[([^\]\n]*)\]\(([^)\s]+)\)|\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g

/** 表格单元格里的行内语法渲染（粗体/斜体/行内代码/删除线/链接/双链） */
function renderInline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  let last = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
    if (m[2] !== undefined) {
      const el = document.createElement('strong')
      el.textContent = m[2]
      frag.appendChild(el)
    } else if (m[4] !== undefined) {
      const el = document.createElement('em')
      el.textContent = m[4]
      frag.appendChild(el)
    } else if (m[5] !== undefined) {
      const el = document.createElement('code')
      el.textContent = m[5]
      frag.appendChild(el)
    } else if (m[6] !== undefined) {
      const el = document.createElement('del')
      el.textContent = m[6]
      frag.appendChild(el)
    } else if (m[7] !== undefined) {
      const a = document.createElement('a')
      a.textContent = m[7] || m[8]
      a.href = m[8]
      a.target = '_blank'
      a.rel = 'noreferrer'
      frag.appendChild(a)
    } else if (m[9] !== undefined) {
      const chip = document.createElement('span')
      chip.className = 'cm-kb-chip'
      chip.textContent = m[10] ?? m[9]
      frag.appendChild(chip)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  return frag
}
