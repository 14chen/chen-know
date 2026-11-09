/**
 * 笔记速览（digest）—— 放在编辑器**上方**的可折叠块，不侵入编辑器内部。
 *
 * ⚠️ 后端这里是**抽取式**摘要（从正文里挑句子），不是 AI 生成 —— 标题必须写「速览（自动提取）」。
 * 只有正文 ≥800 字时后端才给 digest，没有就整块不渲染。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getNote } from '@/api/notes'
import type { NoteDetail } from '@/api/types'
import '@/styles/views-digest.css'

interface NoteDigest {
  text: string
  sections: string[]
}

const STORAGE_KEY = 'kb.digest.open'

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * @param digest 外壳（useNotes）已经拿到详情时直接传进来 —— 传了就不再自己请求，
 *               避免同一篇笔记发出两次 GET /api/notes/{id}。不传则保持原来的自取行为。
 */
export function DigestPanel({ noteId, digest: provided }: { noteId: number; digest?: NoteDigest | null }) {
  const [fetched, setFetched] = useState<NoteDigest | null>(null)
  const [open, setOpen] = useState<boolean>(readOpen)
  const abortRef = useRef<AbortController | null>(null)
  const digest = provided !== undefined ? (provided && provided.text ? provided : null) : fetched

  useEffect(() => {
    if (provided !== undefined) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setFetched(null)
    getNote(noteId)
      .then((note) => {
        if (controller.signal.aborted) return
        const payload = (note as NoteDetail & { digest?: NoteDigest | null }).digest
        setFetched(payload && payload.text ? payload : null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched(null)
      })
    return () => controller.abort()
  }, [noteId, provided])

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* 隐私模式下写不进去，忽略 */
      }
      return next
    })
  }, [])

  if (!digest) return null

  return (
    <section className={'kb-digest' + (open ? ' is-open' : '')} aria-label="速览（自动提取）">
      <button type="button" className="kb-digest__head" aria-expanded={open} onClick={toggle}>
        <span className="kb-digest__title">速览（自动提取）</span>
        <span className="kb-digest__meta">
          {digest.sections.length > 0 ? <span className="kb-digest__chip">{digest.sections.length} 个小节</span> : null}
          <span className="kb-digest__toggle">{open ? '收起' : '展开'}</span>
        </span>
      </button>
      {open ? <p className="kb-digest__text">{digest.text}</p> : null}
    </section>
  )
}