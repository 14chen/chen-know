/**
 * 编辑器独立测试台（开发用，不参与生产构建 —— vite 只以 index.html 为入口）。
 * 访问：npm run dev 后打开 /proto/editor-lab.html
 *
 * 这里同时是自动化验收的宿主：所有断言用的探针都挂在 window.__lab 上。
 */
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { MarkdownEditor, type MarkdownEditorHandle } from '@/editor'
import { livePreviewStats } from '@/editor/livePreview'

const DEMO = `# 知识库编辑器 · 单栏实机测试

光标**所在的那一行**显示 Markdown 源码，其余行渲染成最终效果。把光标移到任意一行试试。

普通段落里有**粗体**、*斜体*、\`行内代码\`、~~删除线~~，以及一个[普通链接](https://example.com/)。

## 二级标题

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

- 无序列表第一项
- 第二项
  - 嵌套的第二层
- 第三项

1. 有序列表第一项
2. 第二项

- [ ] 未完成的任务
- [x] 已完成的任务

> 引用块应该有一条左侧竖线。
> 这是引用的第二行。

\`\`\`ts
// 围栏代码块 + TypeScript 语法高亮
export function greet(name: string): string {
  const now = Date.now()
  return \`你好，\${name} · \${now}\`
}
\`\`\`

| 能力 | 状态 | 说明 |
| --- | :---: | --- |
| 标题 | 完成 | h1 – h6 |
| 表格 | 完成 | GFM |
| 双链 | 完成 | chip 可点击 |

---

双链：[[双向链接演示]] 是已存在的笔记，[[这篇笔记还没写]] 是尚未创建的笔记。

中文排版：全角标点，例如「引号」、破折号——以及省略号……中英混排 mixed content。`

/** 生成 ≥50 KB 的 Markdown（170 个章节，约 55 700 字符） */
function bigDoc(): string {
  const parts: string[] = ['# 长文档性能测试\n']
  for (let i = 1; i <= 170; i++) {
    parts.push(
      `## 第 ${i} 章 · 章节标题占位\n\n` +
        `这是第 ${i} 章的正文段落，用来制造足够长的文档。里面包含**加粗内容 ${i}**、*斜体内容*、` +
        '`inline_code_' +
        i +
        '`，以及中英文混排的句子 mixed with English words and numbers 12345。\n\n' +
        `- 列表项 A${i}\n- 列表项 B${i}\n- 列表项 C${i}\n\n` +
        '```js\n' +
        `const value${i} = ${i} * 42 // 注释占位\n` +
        `console.log('chapter ${i}', value${i})\n` +
        '```\n\n' +
        `| 字段 | 值 |\n| --- | --- |\n| 章节 | ${i} |\n| 字符 | ${400 + i} |\n\n` +
        `> 引用块 ${i}：长文档里滚动与输入都不能卡。\n\n`,
    )
  }
  return parts.join('')
}

/** 对照组：约 5.6 万字符（与长文档同量级），但完全没有 Markdown 语法 */
function plainBigDoc(): string {
  const parts: string[] = []
  for (let i = 0; i < 1760; i++) {
    parts.push(`第 ${i} 行的普通文本内容，没有任何 Markdown 语法，用于性能对照实验。`)
  }
  return parts.join('\n')
}

const EDGE_DOCS: Record<string, string> = {
  空文档: '',
  只有一行: '只有一行文字，没有换行符',
  超长单行: `超长单行 ${'这是一段很长的文字，用来测试单行超长时装饰器是否会卡顿。'.repeat(120)}`,
  纯代码块: '```python\ndef f(x):\n    return x * 2\n```',
  空代码块: '```js\n```',
  未闭合围栏: '```js\nconsole.log(1)\n',
}

interface ProbeLine {
  i: number
  text: string
  cls: string
  fs: string
  fw: string
}

export function Lab() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('kb.theme') as 'light' | 'dark') ?? 'light',
  )
  const [docName, setDocName] = useState('演示文档')
  const [big] = useState(() => bigDoc())
  const [plainBig] = useState(() => plainBigDoc())
  const [text, setText] = useState(DEMO)
  const [readOnly, setReadOnly] = useState(false)
  const [uploadFails, setUploadFails] = useState(false)
  const [titles, setTitles] = useState<string[]>([
    '双向链接演示',
    '中文排版测试',
    '长文档性能测试',
    '演示文档',
  ])
  const [saveCount, setSaveCount] = useState(0)
  const [wikiLog, setWikiLog] = useState<string[]>([])
  const [compLog, setCompLog] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [tick, setTick] = useState(0)

  const ref = useRef<MarkdownEditorHandle>(null)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    localStorage.setItem('kb.theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onError = (e: ErrorEvent) => setErrors((prev) => [...prev, String(e.message)])
    const onRejection = (e: PromiseRejectionEvent) => setErrors((prev) => [...prev, String(e.reason)])
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  // 组合输入事件留证（中文输入法验证用）：挂在 document 上，不依赖编辑器 DOM 何时挂载
  useEffect(() => {
    const log = (type: string) => (e: Event) =>
      setCompLog((prev) => [...prev, `${type}:${(e as CompositionEvent).data ?? ''}`])
    const handlers: [string, EventListener][] = [
      ['compositionstart', log('start')],
      ['compositionupdate', log('update')],
      ['compositionend', log('end')],
    ]
    for (const [t, h] of handlers) document.addEventListener(t, h)
    return () => {
      for (const [t, h] of handlers) document.removeEventListener(t, h)
    }
  }, [])

  const view = useCallback((): EditorView | null => {
    const dom = document.querySelector('.cm-editor')
    return dom ? EditorView.findFromDOM(dom as HTMLElement) : null
  }, [])

  const loadDoc = useCallback(
    (name: string) => {
      setDocName(name)
      if (name === '演示文档') setText(DEMO)
      else if (name === '长文档 50KB') setText(big)
      else if (name === '纯文本 100KB（对照）') setText(plainBig)
      else setText(EDGE_DOCS[name] ?? '')
      requestAnimationFrame(() => ref.current?.focus())
    },
    [big, plainBig],
  )

  const onUploadImage = useCallback(
    async (file: File) => {
      await new Promise((r) => setTimeout(r, 120))
      if (uploadFails) throw new Error('模拟上传失败（后端 500）')
      return `https://cdn.example.com/${encodeURIComponent(file.name || 'image.png')}`
    },
    [uploadFails],
  )

  // 供自动化验收使用的探针
  useEffect(() => {
    const api = {
      setText(next: string) {
        setText(next)
      },
      getText: () => textRef.current,
      docText: () => view()?.state.doc.toString() ?? '',
      setDoc: (name: string) => loadDoc(name),
      setTitles: (list: string[]) => setTitles(list),
      setReadOnly: (v: boolean) => setReadOnly(v),
      uploadFail: (v: boolean) => setUploadFails(v),
      focus: () => ref.current?.focus(),
      sync: () => ref.current?.sync(),
      blur: () => (document.activeElement as HTMLElement | null)?.blur(),
      setCursor: (pos: number) => {
        const v = view()
        if (!v) return false
        v.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
        v.focus()
        return true
      },
      setSelection: (from: number, to: number) => {
        const v = view()
        if (!v) return false
        v.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
        v.focus()
        return true
      },
      lineSpans: (index: number) => {
        const content = document.querySelector('.cm-content')
        const el = content?.querySelectorAll('.cm-line')[index]
        if (!el) return null
        return [...el.querySelectorAll('*')].map((node) => {
          const cs = getComputedStyle(node)
          return {
            tag: node.tagName,
            cls: node.className,
            text: node.textContent,
            fw: cs.fontWeight,
            fs: cs.fontStyle,
            td: cs.textDecorationLine,
            ff: cs.fontFamily,
            color: cs.color,
          }
        })
      },
      tree: (from = 0, to = -1) => {
        const v = view()
        if (!v) return null
        const out: string[] = []
        const end = to < 0 ? v.state.doc.length : to
        syntaxTree(v.state).iterate({
          from,
          to: end,
          enter: (n) => {
            let depth = 0
            for (let p = n.node.parent; p; p = p.parent) depth++
            out.push(
              `${'  '.repeat(depth)}${n.name} [${n.from},${n.to}] ${JSON.stringify(
                v.state.sliceDoc(n.from, Math.min(n.to, n.from + 20)),
              )}`,
            )
          },
        })
        return out
      },
      setCursorLineEnd: (lineNumber: number) => {
        const v = view()
        if (!v) return false
        const line = v.state.doc.line(Math.min(Math.max(1, lineNumber), v.state.doc.lines))
        v.dispatch({ selection: { anchor: line.to }, scrollIntoView: true })
        v.focus()
        return true
      },
      selection: () => {
        const v = view()
        return v ? { from: v.state.selection.main.from, to: v.state.selection.main.to } : null
      },
      selectionText: () => {
        const v = view()
        if (!v) return null
        const r = v.state.selection.main
        return v.state.sliceDoc(r.from, r.to)
      },
      /** 选区在视口中的矩形（断言工具栏在选区上方用） */
      selectionRect: () => {
        const v = view()
        if (!v) return null
        const r = v.state.selection.main
        const a = v.coordsAtPos(r.from, 1)
        const b = v.coordsAtPos(r.to, -1) ?? a
        if (!a || !b) return null
        return {
          top: Math.min(a.top, b.top),
          bottom: Math.max(a.bottom, b.bottom),
          left: Math.min(a.left, b.left),
          right: Math.max(a.right, b.right),
        }
      },
      composing: () => view()?.composing ?? null,
      builds: () => livePreviewStats.builds,
      buildMs: () => Number(livePreviewStats.lastMs.toFixed(3)),
      blockBuilds: () => livePreviewStats.blockBuilds,
      blockBuildMs: () => Number(livePreviewStats.blockLastMs.toFixed(3)),
      blockTotalMs: () => Number(livePreviewStats.blockTotalMs.toFixed(2)),
      resetBuilds: () => livePreviewStats.reset(),
      lineCount: () => view()?.state.doc.lines ?? 0,
      errors: () => errors,
      compLog: () => compLog,
      wikiLog: () => wikiLog,
      saveCount: () => saveCount,
      probe(): {
        lines: ProbeLine[]
        chips: { text: string | null; isNew: boolean }[]
        tables: number
        hrs: number
        boxes: number
        images: number
        codeLines: number
        srcLines: number
        chars: number
      } {
        const v = view()
        const content = document.querySelector('.cm-content')
        const lines: ProbeLine[] = content
          ? [...content.querySelectorAll('.cm-line')].map((el, i) => {
              const cs = getComputedStyle(el)
              return {
                i,
                text: (el as HTMLElement).innerText,
                cls: el.className,
                fs: cs.fontSize,
                fw: cs.fontWeight,
              }
            })
          : []
        return {
          lines,
          chips: [...document.querySelectorAll('.cm-kb-chip')].map((el) => ({
            text: el.textContent,
            isNew: el.classList.contains('cm-kb-chip-new'),
          })),
          tables: document.querySelectorAll('.cm-kb-table').length,
          hrs: document.querySelectorAll('.cm-kb-hr').length,
          boxes: document.querySelectorAll('.cm-kb-checkbox').length,
          images: document.querySelectorAll('.cm-kb-image-el').length,
          codeLines: document.querySelectorAll('.cm-line.cm-kb-code').length,
          srcLines: document.querySelectorAll('.cm-line.cm-kb-src').length,
          chars: v?.state.doc.length ?? -1,
        }
      },
      scrollTop: (value: number) => {
        const scroller = document.querySelector('.cm-scroller')
        if (!scroller) return false
        scroller.scrollTop = value
        return scroller.scrollTop
      },
      scrollMax: () => {
        const s = document.querySelector('.cm-scroller')
        return s ? s.scrollHeight - s.clientHeight : 0
      },
      theme: (next: 'light' | 'dark') => setTheme(next),
      toastTexts: () => [...document.querySelectorAll('.kb-toast')].map((el) => el.textContent),
    }
    Object.assign(window, { __lab: api })
    const id = window.setInterval(() => setTick((t) => t + 1), 500)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors, compLog, wikiLog, saveCount, loadDoc, view])

  const stats = useMemo(
    () => `字符 ${text.length} · 行 ${text.split('\n').length} · 重建 ${livePreviewStats.builds} 次`,
    // tick 用来让统计数字跟着刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, tick],
  )

  const docNames = ['演示文档', '长文档 50KB', '纯文本 100KB（对照）', ...Object.keys(EDGE_DOCS)]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="lab-bar">
        <strong style={{ fontSize: 'var(--fs-sm)' }}>编辑器测试台</strong>
        {docNames.map((name) => (
          <button key={name} className={name === docName ? 'on' : ''} onClick={() => loadDoc(name)}>
            {name}
          </button>
        ))}
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          主题：{theme === 'light' ? '浅色' : '深色'}
        </button>
        <button className={readOnly ? 'on' : ''} onClick={() => setReadOnly((v) => !v)}>
          {readOnly ? '只读：开' : '只读：关'}
        </button>
        <button className={uploadFails ? 'on' : ''} onClick={() => setUploadFails((v) => !v)}>
          {uploadFails ? '上传：失败' : '上传：成功'}
        </button>
        <button
          onClick={() =>
            setTitles((prev) =>
              prev.length ? [] : ['双向链接演示', '中文排版测试', '长文档性能测试'],
            )
          }
        >
          标题索引：{titles.length}
        </button>
        <span className="lab-stat">
          {stats} · 保存 {saveCount} · 双链点击 {wikiLog.join(',') || '—'} · 组合{' '}
          {compLog.length} · 错误 {errors.length}
        </span>
      </div>
      <div className="lab-main">
        <MarkdownEditor
          ref={ref}
          value={text}
          onChange={setText}
          noteTitle="演示文档"
          knownTitles={titles}
          onWikiLinkClick={(title) => setWikiLog((prev) => [...prev, title])}
          onUploadImage={onUploadImage}
          onSave={() => setSaveCount((n) => n + 1)}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('lab-root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
