/**
 * MarkdownEditor —— Typora 式单栏编辑器（对外唯一入口，接口见 PROTOTYPE.md §4）。
 *
 * 组合方式：CodeMirror 6 + 自定义 live preview 装饰器（Markdown 原文即唯一真相）。
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
  placeholder,
  type ViewUpdate,
} from '@codemirror/view'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import { syntaxTree } from '@codemirror/language'
import { codeLanguages } from './codeLanguages'
import {
  clearFormat,
  insertLink,
  setColor,
  toggleBold,
  toggleCode,
  toggleHighlight,
  toggleItalic,
  toggleStrike,
  toggleUnderline,
  wrapSelection,
} from './commands'
import { findAdjacentPair, MARKERS, type ColorProp } from './format'
import { FormatToolbar, type FormatId, type ToolbarState } from './FormatToolbar'
import { blockDecorations, livePreview, type LivePreviewConfig } from './livePreview'
import { editorTheme } from './theme'
import './editor.css'

export interface MarkdownEditorProps {
  /** 受控值：Markdown 原文。外部切换笔记时整体替换 */
  value: string
  /** 每次内容变化回调（含正在输入的中间态） */
  onChange: (next: string) => void
  /** 当前笔记标题，用于 [[双链]] 自动补全时排除自身 */
  noteTitle?: string
  /** 已知笔记标题索引，供 [[双链]] 补全提示（p-shell 提供，可能为空数组） */
  knownTitles?: string[]
  /** 点击已渲染的 [[双链]] 时触发 */
  onWikiLinkClick?: (title: string) => void
  /** 粘贴图片时调用；返回可直接插入正文的 URL。抛错则由编辑器 toast 提示 */
  onUploadImage?: (file: File) => Promise<string>
  /** Ctrl/Cmd+S 触发 */
  onSave?: () => void
  readOnly?: boolean
  className?: string
}

export interface MarkdownEditorHandle {
  focus(): void
  /** 让编辑器重新读取 value（外部替换内容后调用，保持光标位置合理） */
  sync(): void
  /** 滚动到指定行（0 基，与大纲里的 line 对齐）。只移动视口，不动光标 */
  scrollToLine(line: number): void
}

interface Latest {
  value: string
  onChange: (next: string) => void
  noteTitle?: string
  knownTitles?: string[]
  onWikiLinkClick?: (title: string) => void
  onUploadImage?: (file: File) => Promise<string>
  onSave?: () => void
}

interface Toast {
  id: number
  message: string
  kind: 'error' | 'info'
}

const themeCompartment = new Compartment()
const readOnlyCompartment = new Compartment()

let uploadSeq = 0

/** CodeMirror 的 dark 标志：深色 / 墨夜两套算暗色，纸张是浅色 */
function isDarkTheme(): boolean {
  const attr = document.documentElement.dataset.theme
  if (attr === 'dark' || attr === 'midnight') return true
  if (attr === 'light' || attr === 'paper') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function escapeAlt(name: string): string {
  return name.replace(/[[\]()\n]/g, ' ').trim() || 'image'
}

/** `[[` 触发、候选来自 knownTitles 的补全源 */
function wikiCompletionSource(latest: { current: Latest }, cfg: LivePreviewConfig): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = ctx.state.sliceDoc(line.from, ctx.pos)
    const m = /\[\[([^[\]\n]*)$/.exec(before)
    if (!m) return null
    const from = ctx.pos - m[1].length
    const exclude = latest.current.noteTitle
    const seen = new Set<string>()
    const options: Completion[] = []
    for (const raw of cfg.knownTitles) {
      const title = (raw ?? '').trim()
      if (!title || title === exclude || seen.has(title)) continue
      seen.add(title)
      options.push({ label: title, detail: '双链', apply: `${title}]]` })
    }
    if (!options.length) return null
    return { from, options, validFor: /^[^[\]\n]*$/ }
  }
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(props, ref) {
    const {
      value,
      onChange,
      noteTitle,
      knownTitles,
      onWikiLinkClick,
      onUploadImage,
      onSave,
      readOnly = false,
      className,
    } = props

    const hostRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)
    const lastEmitted = useRef(value)
    const [toasts, setToasts] = useState<Toast[]>([])
    const [toolbar, setToolbar] = useState<ToolbarState | null>(null)

    const latest = useRef<Latest>({
      value,
      onChange,
      noteTitle,
      knownTitles,
      onWikiLinkClick,
      onUploadImage,
      onSave,
    })

    const cfgRef = useRef<LivePreviewConfig | null>(null)
    if (!cfgRef.current) cfgRef.current = { knownTitles: knownTitles ?? [], handlers: {} }

    useEffect(() => {
      latest.current = {
        value,
        onChange,
        noteTitle,
        knownTitles,
        onWikiLinkClick,
        onUploadImage,
        onSave,
      }
    })

    const showToast = useCallback((message: string, kind: Toast['kind']) => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev, { id, message, kind }])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3200)
    }, [])

    /* ── 粘贴上传 ─────────────────────────────────────────── */
    const replaceToken = useCallback((view: EditorView, token: string, url: string) => {
      const text = view.state.doc.toString()
      const idx = text.indexOf(token)
      if (idx < 0) return
      view.dispatch({ changes: { from: idx, to: idx + token.length, insert: url } })
    }, [])

    const removeToken = useCallback((view: EditorView, token: string) => {
      const text = view.state.doc.toString()
      const idx = text.indexOf(token)
      if (idx < 0) return
      // 连同 `![名字](` 和 `)` 一起删掉，别留下空壳
      const lineStart = Math.max(0, text.lastIndexOf('![', idx))
      const end = text.indexOf(')', idx + token.length)
      const from = lineStart >= 0 && text.slice(lineStart, idx).startsWith('![') ? lineStart : idx
      const to = end >= 0 && end < idx + token.length + 2 ? end + 1 : idx + token.length
      view.dispatch({ changes: { from, to, insert: '' } })
    }, [])

    const handlePaste = useCallback(
      (event: ClipboardEvent, view: EditorView): boolean => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (!files.length) return false
        const upload = latest.current.onUploadImage
        if (!upload) return false
        event.preventDefault()

        const entries = files.map((file) => ({
          file,
          token: `kbupload${++uploadSeq}`,
          name: file.name || 'image.png',
        }))
        const insert = entries.map((e) => `![${escapeAlt(e.name)}](${e.token})`).join('\n')
        const sel = view.state.selection.main
        const at = sel.from
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert },
          selection: { anchor: at + insert.length },
        })

        // 逐张上传：成功替换占位符，失败回滚该占位符并提示（正文不受影响）
        void (async () => {
          for (const e of entries) {
            try {
              const url = await upload(e.file)
              if (url) replaceToken(view, e.token, url)
              else throw new Error('上传接口未返回 URL')
            } catch (err) {
              removeToken(view, e.token)
              const msg = err instanceof Error ? err.message : String(err)
              showToast(`图片上传失败：${msg}`, 'error')
            }
          }
        })()
        return true
      },
      [removeToken, replaceToken, showToast],
    )

    /* ── 选区格式工具栏（docs/EDITOR-FORMAT.md §4）─────────── */
    const toolbarRaf = useRef(0)

    const computeToolbar = useCallback((view: EditorView): ToolbarState | null => {
      const state = view.state
      if (state.readOnly || !view.hasFocus) return null
      const r = state.selection.main
      if (r.empty) return null
      // 代码块内部不弹（``` 围栏 / 缩进代码块）；选中标记源码本身也不弹，
      // 避免把格式套进 `<span style=…>` 这类标签内部造成损坏
      const tree = syntaxTree(state)
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(r.from, 1)
      while (node) {
        if (
          node.name === 'FencedCode' ||
          node.name === 'CodeBlock' ||
          node.name === 'CodeText' ||
          node.name === 'HTMLTag' ||
          node.name === 'URL' ||
          node.name === 'LinkMark'
        ) {
          return null
        }
        node = node.parent
      }
      const start = view.coordsAtPos(r.from, 1)
      const end = view.coordsAtPos(r.to, -1) ?? start
      if (!start || !end) return null

      // 边界策略：
      // - 跨行但同属普通段落 → 允许（按钮按行分别包裹，见 commands.wrapPerLine）
      // - 跨行且首/尾行带块级标记（标题 / 列表 / 任务 / 引用 / 表格）→ 不弹工具栏，
      //   避免把 `#`、`- `、`|` 这些块级标记包进行内标记而破坏结构
      const fromLine = state.doc.lineAt(r.from)
      const toLine = state.doc.lineAt(r.to)
      if (toLine.number !== fromLine.number) {
        const BLOCKY = /^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/
        if (BLOCKY.test(fromLine.text) || BLOCKY.test(toLine.text)) return null
      }

      const inner = state.sliceDoc(r.from, r.to)
      const checks: [FormatId, { open: string; close: string }][] = [
        ['bold', MARKERS.bold],
        ['italic', MARKERS.italic],
        ['strike', MARKERS.strike],
        ['underline', MARKERS.underline],
        ['highlight', MARKERS.highlight],
        ['code', MARKERS.code],
      ]
      const active: FormatId[] = []
      for (const [id, pair] of checks) {
        const insideMarkers =
          inner.length > pair.open.length + pair.close.length &&
          inner.startsWith(pair.open) &&
          inner.endsWith(pair.close)
        if (insideMarkers || findAdjacentPair(state.doc, r.from, r.to, [pair])) active.push(id)
      }
      const adj = findAdjacentPair(state.doc, r.from, r.to, null)
      return {
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
        centerX: (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2,
        coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
        active,
        color: adj?.prop === 'color' ? adj.value : undefined,
        bg: adj?.prop === 'background-color' ? adj.value : undefined,
      }
    }, [])

    const scheduleToolbar = useCallback(
      (view: EditorView) => {
        if (toolbarRaf.current) return
        toolbarRaf.current = window.requestAnimationFrame(() => {
          toolbarRaf.current = 0
          setToolbar(computeToolbar(view))
        })
      },
      [computeToolbar],
    )

    const runFormat = useCallback(
      (id: FormatId) => {
        const view = viewRef.current
        if (!view) return
        if (id === 'bold') toggleBold(view)
        else if (id === 'italic') toggleItalic(view)
        else if (id === 'strike') toggleStrike(view)
        else if (id === 'underline') toggleUnderline(view)
        else if (id === 'highlight') toggleHighlight(view)
        else if (id === 'code') toggleCode(view)
        else if (id === 'link') insertLink(view)
        else if (id === 'clear') clearFormat(view)
        view.focus()
        scheduleToolbar(view)
      },
      [scheduleToolbar],
    )

    const runColor = useCallback(
      (prop: ColorProp, value: string) => {
        const view = viewRef.current
        if (!view) return
        setColor(view, prop, value)
        view.focus()
        scheduleToolbar(view)
      },
      [scheduleToolbar],
    )

    /* ── 创建编辑器实例 ───────────────────────────────────── */
    useEffect(() => {
      const host = hostRef.current
      if (!host) return
      const cfg = cfgRef.current!

      cfg.handlers.onWikiLink = (title: string) => latest.current.onWikiLinkClick?.(title)
      cfg.handlers.onToggleTask = (markerPos: number, nextChecked: boolean) => {
        const view = viewRef.current
        if (!view) return
        const cur = view.state.sliceDoc(markerPos, markerPos + 3)
        if (!/^\[[ xX]\]$/.test(cur)) return
        view.dispatch({
          changes: { from: markerPos, to: markerPos + 3, insert: nextChecked ? '[x]' : '[ ]' },
        })
      }

      const extensions: Extension[] = [
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        placeholder('开始输入…支持 Markdown、[[双链]]、粘贴图片'),
        markdown({ base: markdownLanguage, codeLanguages }),
        autocompletion({
          override: [wikiCompletionSource(latest, cfg)],
          icons: false,
          closeOnBlur: true,
        }),
        Prec.high(
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                latest.current.onSave?.()
                return true
              },
            },
            { key: 'Mod-b', preventDefault: true, run: (v) => wrapSelection(v, '**') },
            { key: 'Mod-i', preventDefault: true, run: (v) => wrapSelection(v, '*') },
            { key: 'Mod-u', preventDefault: true, run: toggleUnderline },
            { key: 'Mod-e', preventDefault: true, run: toggleCode },
            { key: 'Mod-k', preventDefault: true, run: insertLink },
            { key: 'Tab', preventDefault: true, run: indentMore },
            { key: 'Shift-Tab', preventDefault: true, run: indentLess },
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // 块级装饰必须由 StateField 提供（CodeMirror 限制），且要排在 markdown() 之后
        blockDecorations,
        livePreview(cfg),
        themeCompartment.of(editorTheme(isDarkTheme())),
        readOnlyCompartment.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
        ]),
        EditorView.domEventHandlers({ paste: handlePaste }),
        EditorView.updateListener.of((u: ViewUpdate) => {
          if (u.selectionSet || u.docChanged || u.geometryChanged || u.focusChanged) {
            scheduleToolbar(u.view)
          }
          if (!u.docChanged) return
          const text = u.state.doc.toString()
          lastEmitted.current = text
          latest.current.onChange(text)
        }),
      ]

      const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host })
      viewRef.current = view
      // 焦点变化不产生 CM 事务，需单独监听（否则「先 dispatch 选区、后 focus」时工具栏不出现）
      const onFocus = () => scheduleToolbar(view)
      const onBlur = () => window.setTimeout(() => scheduleToolbar(view), 0)
      view.contentDOM.addEventListener('focus', onFocus)
      view.contentDOM.addEventListener('blur', onBlur)
      return () => {
        view.contentDOM.removeEventListener('focus', onFocus)
        view.contentDOM.removeEventListener('blur', onBlur)
        view.destroy()
        viewRef.current = null
      }
      // 只在挂载时创建一次；其余输入通过各自的 effect 同步
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /* ── 主题跟随 <html data-theme> ────────────────────────── */
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      const sync = () => {
        view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(isDarkTheme())) })
      }
      sync()
      const observer = new MutationObserver(sync)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
      const media = window.matchMedia?.('(prefers-color-scheme: dark)')
      media?.addEventListener?.('change', sync)
      return () => {
        observer.disconnect()
        media?.removeEventListener?.('change', sync)
      }
    }, [])

    /* ── readOnly ─────────────────────────────────────────── */
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
        ]),
      })
    }, [readOnly])

    /* ── 外部替换正文（受控 value）────────────────────────── */
    useEffect(() => {
      const view = viewRef.current
      if (!view) return
      if (view.composing) return
      const current = view.state.doc.toString()
      if (current === value) {
        lastEmitted.current = value
        return
      }
      if (value === lastEmitted.current) return
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: 0 },
      })
      lastEmitted.current = value
    }, [value])

    /* ── 标题索引变化 → 重建 chip 的「已存在/未创建」状态 ─── */
    useEffect(() => {
      const cfg = cfgRef.current!
      cfg.knownTitles = knownTitles ?? []
      viewRef.current?.dispatch({})
    }, [knownTitles])

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          viewRef.current?.focus()
        },
        sync() {
          const view = viewRef.current
          if (!view) return
          const next = latest.current.value
          const current = view.state.doc.toString()
          if (current !== next) {
            view.dispatch({
              changes: { from: 0, to: current.length, insert: next },
              selection: { anchor: 0 },
            })
            lastEmitted.current = next
          }
          view.requestMeasure()
        },
        scrollToLine(line: number) {
          const view = viewRef.current
          if (!view) return
          const total = view.state.doc.lines
          const target = Math.min(Math.max(1, Math.round(line) + 1), total)
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.doc.line(target).from, {
              y: 'start',
              yMargin: 24,
            }),
          })
        },
      }),
      [],
    )

    return (
      <div className={className ? `kb-editor ${className}` : 'kb-editor'}>
        <div className="kb-editor-host" ref={hostRef} />
        {toolbar && <FormatToolbar state={toolbar} onFormat={runFormat} onColor={runColor} />}
        {toasts.length > 0 && (
          <div className="kb-toasts">
            {toasts.map((t) => (
              <div key={t.id} className={`kb-toast kb-toast-${t.kind}`} role="alert">
                {t.message}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },
)
