import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeApiError } from '@/api/client'
import { uploadAttachment } from '@/api/attachments'
import { getNote, listNotes, patchNote, recordNoteView } from '@/api/notes'
import type { NoteListItem } from '@/api/types'
import { useToast } from '@/components/Toast'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** 契约要求的自动保存防抖时长 */
export const AUTOSAVE_DELAY = 800

/** 单次 flush 最多连续落盘几轮（保存期间用户仍在输入时才有第二轮） */
const MAX_FLUSH_ROUNDS = 5

/** 列表接口单页上限（API.md §0.3），全量拉取按这个粒度翻页 */
export const NOTES_PAGE_SIZE = 200

/** 全量拉取的安全上限：达到后继续分页没有意义，但**必须显式提示**，不允许静默截断 */
export const MAX_NOTES = 2000

/** 新建/清空标题时的兜底标题（后端允许空标题，前端统一给它一个可读名字） */
export const FALLBACK_TITLE = '未命名笔记'

type FlushReason = 'auto' | 'manual' | 'switch' | 'sync' | 'version'

function reasonLabel(reason: FlushReason): string {
  if (reason === 'auto') return '自动保存'
  if (reason === 'manual') return '保存'
  if (reason === 'switch') return '切换笔记前的保存'
  if (reason === 'sync') return '刷新前的保存'
  return '保存版本前的保存'
}

/** 详情页头部要用的元信息（原本 AppShell 又单独 getNote 了一次，现在由 hook 一并给出） */
export interface SelectedNoteMeta {
  folderId: number | null
  createdAt: string
  updatedAt: string
  version: number
}

export interface NotesController {
  items: NoteListItem[]
  /** 服务端报告的总数（用于「仅加载前 N 篇」提示） */
  listTotal: number
  /** true = 命中 MAX_NOTES 上限，列表不完整 */
  listTruncated: boolean
  knownTitles: string[]
  listLoading: boolean
  listError: string | null
  /** 让外壳重新拉取笔记列表（含末尾的标题同步） */
  reload: () => Promise<void>
  /**
   * 重新加载**当前打开的笔记**（含正文）：版本回滚、导入覆盖后同步编辑器。
   * 没有打开的笔记时是 no-op；不触发整表重拉。
   */
  reloadCurrentNote: () => Promise<void>
  /** 清空当前打开的笔记（例如它刚被删除）：会同时停掉未落盘的自动保存 */
  clear: () => void
  /** 登记「已删除」的笔记 id：此后对它的路由同步/重载一律忽略，避免 404 请求 */
  markDeleted: (id: number) => void
  /** 改标题：PATCH title 后同步列表与顶栏；空标题兜底为「未命名笔记」，返回最终标题 */
  renameNote: (id: number, title: string) => Promise<string>

  selectedId: number | null
  selectedTitle: string
  /** 当前笔记的目录/时间/版本；切换笔记时随正文一起更新，保存成功后版本自增 */
  selectedMeta: SelectedNoteMeta | null
  /** 当前笔记的「速览」（后端计算，正文 ≥800 字才有）——避免 DigestPanel 再拉一次详情 */
  selectedDigest: { text: string; sections: string[] } | null
  content: string
  noteLoading: boolean
  noteError: string | null

  saveState: SaveState
  savedAt: number | null
  lastError: string | null
  hasUnsavedChanges: boolean

  /** 切换笔记：切换前先把未保存改动落盘，落盘失败则不切换（抛错） */
  select: (id: number) => Promise<void>
  changeContent: (next: string) => void
  /** 立即落盘（Ctrl/Cmd+S）。失败已提示，不会抛出 */
  saveNow: () => Promise<void>
  /** 显式保存一个历史版本：即使正文没改也会留下快照并递增版本号 */
  saveVersion: () => Promise<void>
  uploadImage: (file: File) => Promise<string>
}

export function useNotes(): NotesController {
  const toast = useToast()

  const [items, setItems] = useState<NoteListItem[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [listTruncated, setListTruncated] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedTitle, setSelectedTitle] = useState('')
  const [selectedMeta, setSelectedMeta] = useState<SelectedNoteMeta | null>(null)
  const [selectedDigest, setSelectedDigest] = useState<{ text: string; sections: string[] } | null>(null)
  const [content, setContent] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  // 保存状态机的可变引用（同步读取，不受 React 渲染批次影响）
  const noteIdRef = useRef<number | null>(null)
  /** 已删除的笔记 id：登记后路由残留的 id 不再触发 getNote（避免删除后仍打 404） */
  const deletedIdsRef = useRef<Set<number>>(new Set())
  const contentRef = useRef('')
  const savedContentRef = useRef('')
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const loadSeqRef = useRef(0)
  const listSeqRef = useRef(0)
  /** 最近一次已上报「浏览」的笔记 id（同一篇连续打开只记一次） */
  const lastViewedRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /* ---- 笔记列表（不含正文）--------------------------------------------
     全量拉取：按 200/页翻页直到收齐 total（上限 MAX_NOTES）。
     首页到达即渲染，后续页在后台补齐；单页失败保留已到手的数据并给出重试，
     不允许「整体空白」，也不允许静默截断（截断时 listTruncated=true）。 */
  const reload = useCallback(async () => {
    const seq = listSeqRef.current + 1
    listSeqRef.current = seq
    setListLoading(true)

    // 顺手同步当前笔记的标题/元信息（列表是权威的，标题可能被别处改过）
    const syncCurrent = (list: NoteListItem[]) => {
      const currentId = noteIdRef.current
      if (currentId === null) return
      const current = list.find((item) => item.id === currentId)
      if (current) setSelectedTitle(current.title)
    }

    try {
      const first = await listNotes({ page: 1, size: NOTES_PAGE_SIZE, sort: 'updated' })
      if (listSeqRef.current !== seq) return

      let collected = first.items.slice(0, MAX_NOTES)
      setItems(collected)
      syncCurrent(collected)
      setListTotal(first.total)
      setListTruncated(first.total > MAX_NOTES)
      setListError(null)

      const target = Math.min(first.total, MAX_NOTES)
      let page = 1
      while (collected.length < target) {
        page += 1
        try {
          const next = await listNotes({ page, size: NOTES_PAGE_SIZE, sort: 'updated' })
          if (listSeqRef.current !== seq) return
          if (next.items.length === 0) break
          collected = collected.concat(next.items).slice(0, MAX_NOTES)
          setItems(collected)
          syncCurrent(collected)
        } catch (cause) {
          if (listSeqRef.current !== seq) return
          setListError(
            `第 ${page} 页加载失败（已显示前 ${collected.length} 篇）：${describeApiError(cause)}`,
          )
          break
        }
      }
    } catch (cause) {
      if (listSeqRef.current !== seq) return
      setListError(describeApiError(cause))
    } finally {
      if (listSeqRef.current === seq) setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /* ---- 保存 ------------------------------------------------------------ */

  /**
   * 落盘一次「当前内容」。执行时才读引用，因此排队期间产生的新输入也会被正确处理。
   * createVersion=false（自动保存）时正文照常落盘，但服务端不写历史、不递增版本号。
   */
  const runSave = useCallback(async (createVersion: boolean): Promise<void> => {
    const id = noteIdRef.current
    if (id === null || !dirtyRef.current) return

    const snapshot = contentRef.current
    if (snapshot === savedContentRef.current) {
      dirtyRef.current = false
      setSaveState('saved')
      return
    }

    setSaveState('saving')
    const updated = await patchNote(id, { content: snapshot, createVersion })
    if (noteIdRef.current !== id) return

    savedContentRef.current = snapshot
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, updatedAt: updated.updatedAt, version: updated.version, excerpt: updated.excerpt }
          : item,
      ),
    )

    // 保存返回的是权威的 version/updatedAt：详情页头部的「更新 / 第 N 版」直接跟着变，不用再拉一次
    setSelectedMeta((prev) =>
      prev ? { ...prev, updatedAt: updated.updatedAt, version: updated.version } : prev,
    )

    if (contentRef.current === snapshot) {
      dirtyRef.current = false
      setSaveState('saved')
      setSavedAt(Date.now())
      setLastError(null)
    } else {
      // 保存期间又输入了：保持 dirty，交由下一轮
      setSaveState('dirty')
    }
  }, [])

  /** 同一时刻只允许一个 PATCH 在飞 */
  const enqueueSave = useCallback(
    (createVersion: boolean): Promise<void> => {
      const next = queueRef.current.then(
        () => runSave(createVersion),
        () => runSave(createVersion),
      )
      queueRef.current = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
    [runSave],
  )

  /** 把未保存内容全部落盘；失败时提示并抛出（调用方决定是否中止切换） */
  const flush = useCallback(
    async (reason: FlushReason): Promise<void> => {
      clearTimer()
      await queueRef.current
      if (!dirtyRef.current) return

      try {
        // 只有用户主动的「保存」才递增版本；自动保存 / 切换前落盘 / 刷新前落盘都不刷版本。
        const createVersion = reason === 'manual'
        for (let round = 0; round < MAX_FLUSH_ROUNDS && dirtyRef.current; round += 1) {
          await enqueueSave(createVersion)
        }
      } catch (error) {
        const message = describeApiError(error)
        setLastError(message)
        setSaveState('error')
        toast.error(`${reasonLabel(reason)}失败：${message}`)
        throw error
      }
    },
    [clearTimer, enqueueSave, toast],
  )

  const changeContent = useCallback(
    (next: string) => {
      contentRef.current = next
      setContent(next)

      if (noteIdRef.current === null) return

      if (next === savedContentRef.current) {
        // 改回原样：撤销未保存标记
        dirtyRef.current = false
        clearTimer()
        setSaveState('saved')
        return
      }

      dirtyRef.current = true
      setSaveState('dirty')
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush('auto').catch(() => {
          /* flush 内部已弹出错误提示 */
        })
      }, AUTOSAVE_DELAY)
    },
    [clearTimer, flush],
  )

  const saveNow = useCallback(async (): Promise<void> => {
    try {
      await flush('manual')
    } catch {
      /* flush 内部已弹出错误提示 */
    }
  }, [flush])

  /**
   * 显式存一个版本。先把还没落盘的自动保存内容按「不建版本」的方式写下去，
   * 再单独发一次 forceVersion=true 的 PATCH 打快照 —— 因此无论刚才是否在输入，
   * 点一次就只会多一个版本，不会把途中的自动保存也算进去。
   */
  const saveVersion = useCallback(async (): Promise<void> => {
    clearTimer()
    try {
      await flush('version')
    } catch {
      /* flush 内部已弹出错误提示 */
      return
    }
    const id = noteIdRef.current
    if (id === null) return
    try {
      const updated = await patchNote(id, { forceVersion: true })
      if (noteIdRef.current !== id) return
      setSelectedMeta((prev) =>
        prev ? { ...prev, version: updated.version, updatedAt: updated.updatedAt } : prev,
      )
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, version: updated.version, updatedAt: updated.updatedAt }
            : item,
        ),
      )
      setSaveState('saved')
      setSavedAt(Date.now())
      setLastError(null)
      toast.success(`已保存第 ${updated.version} 版`)
    } catch (error) {
      const message = describeApiError(error)
      setLastError(message)
      setSaveState('error')
      toast.error(`保存版本失败：${message}`)
    }
  }, [clearTimer, flush, toast])

  /* ---- 切换笔记（切换前必须落盘）-------------------------------------- */
  const select = useCallback(
    async (id: number): Promise<void> => {
      if (noteIdRef.current === id) return
      // 刚被删除的笔记：地址栏可能还残留它的 id，直接忽略，绝不发请求
      if (deletedIdsRef.current.has(id)) return

      // 硬要求：有未保存改动必须先落盘；失败则抛出，由调用方保持原地
      await flush('switch')
      clearTimer()

      const seq = loadSeqRef.current + 1
      loadSeqRef.current = seq

      // 加载期间卸载编辑器，杜绝「旧内容写进新笔记」
      noteIdRef.current = null
      contentRef.current = ''
      savedContentRef.current = ''
      dirtyRef.current = false
      setContent('')
      setNoteLoading(true)
      setNoteError(null)
      setSaveState('saved')
      setSavedAt(null)
      setSelectedMeta(null)
      setSelectedDigest(null)
      setSelectedId(id)

      try {
        const note = await getNote(id)
        if (loadSeqRef.current !== seq) return

        noteIdRef.current = note.id
        contentRef.current = note.content
        savedContentRef.current = note.content
        dirtyRef.current = false
        setContent(note.content)
        setSelectedTitle(note.title)
        setSelectedDigest(
          (note as { digest?: { text: string; sections: string[] } }).digest ?? null,
        )
        setSelectedMeta({
          folderId: note.folderId,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          version: note.version,
        })
        setSaveState('saved')
        setSavedAt(Date.now())

        // 「最近浏览」：只在这里记（一次真正的打开），不在渲染期调用。
        // 同一篇**连续**打开只记一次；失败静默，绝不影响打开主流程。
        if (lastViewedRef.current !== note.id) {
          lastViewedRef.current = note.id
          void recordNoteView(note.id).catch(() => {
            lastViewedRef.current = null
          })
        }
      } catch (error) {
        if (loadSeqRef.current !== seq) return
        setNoteError(describeApiError(error))
        setSelectedId(null)
      } finally {
        if (loadSeqRef.current === seq) setNoteLoading(false)
      }
    },
    [clearTimer, flush],
  )

  /** 清空当前打开的笔记（笔记被删除后调用）：停掉自动保存，避免 PATCH 打到已删笔记 */
  const clear = useCallback((): void => {
    clearTimer()
    loadSeqRef.current += 1
    noteIdRef.current = null
    contentRef.current = ''
    savedContentRef.current = ''
    dirtyRef.current = false
    lastViewedRef.current = null
    setSelectedId(null)
    setSelectedTitle('')
    setContent('')
    setNoteLoading(false)
    setNoteError(null)
    setSaveState('saved')
    setSavedAt(null)
  }, [clearTimer])

  /** 重新拉当前笔记的正文：版本回滚 / 导入覆盖后同步编辑器。
   *  先落盘（否则服务端内容会覆盖用户刚输入的东西），落盘失败则放弃拉取；
   *  只拉这一篇，不触发整表重拉。 */
  const reloadCurrentNote = useCallback(async (): Promise<void> => {
    const id = noteIdRef.current
    if (id === null) return

    try {
      await flush('sync')
    } catch {
      /* 落盘失败已提示：保留编辑器里未保存的内容，不做覆盖 */
      return
    }

    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq

    try {
      const note = await getNote(id)
      if (loadSeqRef.current !== seq || noteIdRef.current !== id) return

      contentRef.current = note.content
      savedContentRef.current = note.content
      dirtyRef.current = false
      setContent(note.content)
      setSelectedTitle(note.title)
      setSaveState('saved')
      setSavedAt(Date.now())
      setLastError(null)
      setNoteError(null)
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                title: note.title,
                excerpt: note.excerpt,
                version: note.version,
                updatedAt: note.updatedAt,
                tags: note.tags,
                folderId: note.folderId,
                isFavorite: note.isFavorite,
                isPinned: note.isPinned,
              }
            : item,
        ),
      )
    } catch (error) {
      if (loadSeqRef.current !== seq) return
      setNoteError(describeApiError(error))
    }
  }, [flush])

  const uploadImage = useCallback(async (file: File): Promise<string> => {
    const id = noteIdRef.current
    // 失败时直接抛出，由编辑器自行 toast（契约 §4）
    const attachment = await uploadAttachment(file, id ?? undefined)
    return attachment.url
  }, [])

  /* 有未保存内容时，关闭/刷新页面给出原生确认，避免丢数据 */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const knownTitles = useMemo(() => items.map((item) => item.title), [items])

  /** 登记「已删除」：由外壳在删除成功后调用，用于抑制对已删笔记的后续请求 */
  const markDeleted = useCallback((id: number): void => {
    deletedIdsRef.current.add(id)
  }, [])

  /** 改标题：PATCH title → 同步列表与顶栏；空标题兜底为「未命名笔记」 */
  const renameNote = useCallback(async (id: number, raw: string): Promise<string> => {
    const trimmed = (raw || '').trim().slice(0, 512)
    const title = trimmed || FALLBACK_TITLE
    const updated = await patchNote(id, { title })
    const finalTitle = (updated && updated.title) || title
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, title: finalTitle } : item)))
    if (noteIdRef.current === id) setSelectedTitle(finalTitle)
    return finalTitle
  }, [])

  return {
    items,
    listTotal,
    listTruncated,
    knownTitles,
    listLoading,
    listError,
    reload,
    reloadCurrentNote,
    clear,
    markDeleted,
    renameNote,
    selectedId,
    selectedTitle,
    selectedMeta,
    selectedDigest,
    content,
    noteLoading,
    noteError,
    saveState,
    savedAt,
    lastError,
    hasUnsavedChanges: saveState === 'dirty' || saveState === 'saving',
    select,
    changeContent,
    saveNow,
    saveVersion,
    uploadImage,
  }
}