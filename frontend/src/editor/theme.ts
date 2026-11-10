/**
 * 编辑器主题：**只引用 §3 设计 token**，不写任何颜色字面量。
 * 深色/浅色由 `<html data-theme>` 切换 token 值实现，编辑器 DOM 自动跟随；
 * 只有 CodeMirror 内部（tooltip / 面板等）需要 `dark` 标志，由组件在
 * data-theme 变化时重配置 theme compartment。
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const MONO_FONT =
  "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, 'Microsoft YaHei Mono', monospace"

/** 语法高亮：颜色一律来自 token */
const highlightStyle = HighlightStyle.define([
  // Markdown 语法标记（当前行显示源码时可见）：压暗，和正文区分
  { tag: tags.processingInstruction, color: 'var(--text-muted)' },
  { tag: tags.labelName, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: MONO_FONT },
  { tag: tags.quote, color: 'var(--text-secondary)' },
  { tag: tags.contentSeparator, color: 'var(--text-muted)' },
  { tag: tags.heading, fontWeight: '700' },
  // 嵌套代码语言
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.definitionKeyword], color: 'var(--accent)' },
  { tag: [tags.string, tags.character, tags.special(tags.string), tags.regexp], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--accent-hover)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--text)', fontWeight: '600' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--text)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], color: 'var(--text-secondary)' },
  { tag: [tags.meta, tags.annotation], color: 'var(--text-muted)' },
  { tag: tags.invalid, color: 'var(--danger)' },
])

const spec = {
  '&': {
    color: 'var(--text)',
    backgroundColor: 'var(--bg)',
    fontSize: 'var(--fs-base)',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--lh-relaxed)',
    overflow: 'auto',
    // 正文滚到顶/底后不要把手势交给页面（否则整屏会跟着弹）
    overscrollBehavior: 'contain',
  },
  '.cm-content': {
    fontFamily: 'inherit',
    // 宽度由外壳统一管理：编辑器不主张宽度、不居中，只撑满父容器
    padding: 'var(--sp-6) 0',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0 var(--sp-5)' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    // 选区底色走 --selection-bg（f-shell 在 tokens.css 定义，浅/深各一个、明显可见）。
    // 兜底值只在 token 还没落地时生效（30% 主色，肉眼可见），避免回落到全透明。
    backgroundColor: 'var(--selection-bg, color-mix(in srgb, var(--accent) 30%, transparent))',
  },
  // CM 自带选区色（#d7d4f0 / #233）的选择器带 .cm-focused > .cm-scroller > .cm-selectionLayer，
  // 特异性比上面那条高；这里用同形选择器 + 重复类名把特异性顶上去，确保 --selection-bg 真正生效。
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground.cm-selectionBackground, .cm-scroller > .cm-selectionLayer .cm-selectionBackground.cm-selectionBackground':
    {
      backgroundColor: 'var(--selection-bg, color-mix(in srgb, var(--accent) 30%, transparent))',
    },
  // 选区图层 z-index 是 -2（永远在正文下面），而「当前行源码底纹」是不透明背景、正好画在选区之上 →
  // 只要一选中，底纹就把选区色盖掉。有选区时撤掉底纹，选区色才看得见。
  '.cm-scroller:has(.cm-selectionLayer .cm-selectionBackground) .cm-line.cm-kb-src': {
    backgroundColor: 'transparent',
  },
  '.cm-placeholder': { color: 'var(--text-muted)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)',
    boxShadow: 'var(--shadow-lg)',
    color: 'var(--text)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: 'var(--sp-2) var(--sp-3)',
    lineHeight: 'var(--lh-normal)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--accent)',
  },
  '.cm-completionLabel': { fontSize: 'var(--fs-sm)' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', fontSize: 'var(--fs-xs)' },
  '.cm-tooltip-autocomplete-disabled': { display: 'none' },

  /* ── 当前行（显示 Markdown 源码）───────────────────────── */
  '.cm-line.cm-kb-src': {
    backgroundColor: 'var(--bg-subtle)',
  },

  /* ── 标题 ──────────────────────────────────────────── */
  '.cm-line.cm-kb-h1': { fontSize: 'var(--fs-2xl)', fontWeight: '700', padding: 'var(--sp-5) var(--sp-5) var(--sp-2)' },
  '.cm-line.cm-kb-h2': { fontSize: 'var(--fs-xl)', fontWeight: '700', padding: 'var(--sp-5) var(--sp-5) var(--sp-2)' },
  '.cm-line.cm-kb-h3': { fontSize: 'var(--fs-lg)', fontWeight: '650', padding: 'var(--sp-4) var(--sp-5) var(--sp-1)' },
  '.cm-line.cm-kb-h4': { fontSize: 'var(--fs-md)', fontWeight: '650', padding: 'var(--sp-3) var(--sp-5) var(--sp-1)' },
  '.cm-line.cm-kb-h5': { fontSize: 'var(--fs-base)', fontWeight: '650', padding: 'var(--sp-3) var(--sp-5) var(--sp-1)' },
  '.cm-line.cm-kb-h6': {
    fontSize: 'var(--fs-sm)',
    fontWeight: '650',
    color: 'var(--text-secondary)',
    padding: 'var(--sp-3) var(--sp-5) var(--sp-1)',
  },

  /* ── 引用 ──────────────────────────────────────────── */
  '.cm-line.cm-kb-quote': {
    borderLeft: '3px solid var(--border-strong)',
    paddingLeft: 'var(--sp-4)',
    color: 'var(--text-secondary)',
  },

  /* ── 代码 ──────────────────────────────────────────── */
  '.cm-kb-code-inline': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code-text)',
    borderRadius: 'var(--r-sm)',
    padding: '0.1em 0.35em',
    fontFamily: MONO_FONT,
    fontSize: '0.94em',
  },
  '.cm-line.cm-kb-code': {
    backgroundColor: 'var(--code-bg)',
    fontFamily: MONO_FONT,
    fontSize: 'var(--fs-sm)',
    lineHeight: 'var(--lh-normal)',
    padding: '0 var(--sp-5)',
  },
  '.cm-line.cm-kb-code-first': {
    borderRadius: 'var(--r-md) var(--r-md) 0 0',
    paddingTop: 'var(--sp-2)',
  },
  '.cm-line.cm-kb-code-last': {
    borderRadius: '0 0 var(--r-md) var(--r-md)',
    paddingBottom: 'var(--sp-2)',
  },
  /* 围栏 ``` 行 / Setext 下划线行：整行高度归零（比块级 replace 更安全，
     不会牵连相邻行的行装饰）。光标落到该行时该类会被移除，行随即恢复显示。 */
  '.cm-line.cm-kb-fence': {
    fontSize: '0',
    lineHeight: '0',
    height: '0',
    overflow: 'hidden',
    paddingTop: '0',
    paddingBottom: '0',
  },

  /* ── 列表 ──────────────────────────────────────────── */
  '.cm-kb-bullet': {
    color: 'var(--accent)',
    fontWeight: '700',
    marginRight: '0.15em',
  },
  '.cm-kb-checkbox': {
    display: 'inline-block',
    width: '1.05em',
    height: '1.05em',
    marginRight: '0.4em',
    verticalAlign: '-0.16em',
    border: '1.5px solid var(--border-strong)',
    borderRadius: 'var(--r-sm)',
    cursor: 'pointer',
    position: 'relative',
  },
  '.cm-kb-checkbox-on': {
    backgroundColor: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  '.cm-kb-checkbox-on::after': {
    content: '""',
    position: 'absolute',
    left: '0.3em',
    top: '0.1em',
    width: '0.22em',
    height: '0.45em',
    border: '2px solid var(--bg)',
    borderTop: 'none',
    borderLeft: 'none',
    transform: 'rotate(45deg)',
  },

  /* ── 内联 HTML 渲染（docs/EDITOR-FORMAT.md §3）─────────
     这几种颜色是**内容色**（用户在笔记里选的颜色），不是主题色，
     因此用固定字面量；浅底上强制深色文字，保证深色主题下可读。 */
  '.cm-kb-hl': {
    backgroundColor: '#fef08a',
    color: '#1f2328',
    borderRadius: '2px',
    padding: '0.05em 0.1em',
  },
  '.cm-kb-u': {
    textDecoration: 'underline',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '2px',
  },
  '.cm-kb-bg-tint': {
    color: '#1f2328',
    borderRadius: '2px',
    padding: '0.05em 0.1em',
  },

  /* ── 双链 chip ─────────────────────────────────────── */
  '.cm-kb-chip': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--accent)',
    borderRadius: 'var(--r-full)',
    padding: '0.05em 0.5em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background-color var(--dur-fast) var(--ease)',
  },
  '.cm-kb-chip:hover': { backgroundColor: 'var(--accent)', color: 'var(--surface)' },
  '.cm-kb-chip-new': {
    backgroundColor: 'var(--bg-muted)',
    color: 'var(--text-muted)',
    border: '1px dashed var(--border-strong)',
  },
  '.cm-kb-chip-new:hover': { backgroundColor: 'var(--bg-muted)', color: 'var(--text-secondary)' },

  /* ── 分隔线 ────────────────────────────────────────── */
  '.cm-kb-hr': { padding: 'var(--sp-3) var(--sp-5)' },
  '.cm-kb-hr > hr': {
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '0',
  },

  /* ── 图片 ──────────────────────────────────────────── */
  '.cm-kb-image': { display: 'inline-block', verticalAlign: 'top' },
  '.cm-kb-image-el': {
    maxWidth: '100%',
    maxHeight: '340px',
    borderRadius: 'var(--r-md)',
    boxShadow: 'var(--shadow-sm)',
  },
  '.cm-kb-image-broken': {
    color: 'var(--danger)',
    fontFamily: MONO_FONT,
    fontSize: 'var(--fs-sm)',
  },

  /* ── 表格 ──────────────────────────────────────────── */
  '.cm-kb-table-wrap': { padding: 'var(--sp-3) var(--sp-5)' },
  '.cm-kb-table': {
    borderCollapse: 'collapse',
    fontSize: 'var(--fs-sm)',
    borderRadius: 'var(--r-md)',
    overflow: 'hidden',
    border: '1px solid var(--border)',
  },
  '.cm-kb-table th, .cm-kb-table td': {
    border: '1px solid var(--border)',
    padding: 'var(--sp-2) var(--sp-3)',
    textAlign: 'left',
  },
  '.cm-kb-table th': {
    backgroundColor: 'var(--bg-subtle)',
    fontWeight: '650',
    color: 'var(--text-secondary)',
  },
  '.cm-kb-table code': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code-text)',
    borderRadius: 'var(--r-sm)',
    padding: '0.05em 0.3em',
    fontFamily: MONO_FONT,
  },
  '.cm-kb-table a': { color: 'var(--accent)' },
}

export function editorTheme(dark: boolean): Extension {
  return [EditorView.theme(spec, { dark }), syntaxHighlighting(highlightStyle)]
}
