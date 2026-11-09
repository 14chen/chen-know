/**
 * 导入导出视图 —— 路由 `#/io`（契约 docs/API.md §10、docs/IMPORT-IMAGES.md §8）
 *
 * 导出走**浏览器导航下载**（响应带 Content-Disposition），不用 fetch。
 * 导入支持三种入口，都能带图片：
 *   ① 多选 .md + 图片　② 选择整个文件夹（用 webkitRelativePath 保相对路径）　③ 单个 .zip
 * 图片不单独产生笔记，只作为正文图片引用的素材；找不到的引用逐条报告，**不阻断导入**。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAttachmentHealth } from '@/api/attachments'
import type { AttachmentHealth } from '@/api/attachments'
import { describeApiError, request } from '@/api/client'
import {
  BATCH_LIMIT_BYTES,
  buildImportFormData,
  collectDroppedFiles,
  fileSizeWarning,
  IMPORT_ACCEPT,
  kindOf,
  relativePathOf,
  summarize,
  type ImportPreview,
  type ImportSummary,
  type MissingImage,
} from '@/api/io'
import type { ImportPreviewItem } from '@/api/types'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import type { ViewProps } from '@/views/types'

type Busy = 'preview' | 'import' | null

/** 浏览器导航下载：文件名由后端 Content-Disposition 决定 */
function triggerDownload(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export default function IoView({ ctx }: ViewProps) {
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [blocked, setBlocked] = useState<{ errors: string[]; hint: string } | null>(null)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [noteId, setNoteId] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  /**
   * 收集一批文件。source = 'folder' 表示「选择文件夹」/拖入文件夹：整批替换（一次导入一个来源）。
   * ZIP 必须单独导入；图片与 .md 可自由混。
   */
  const addFiles = useCallback(
    (incoming: File[] | null, source: 'files' | 'folder') => {
      if (!incoming || incoming.length === 0) return
      const accepted = incoming.filter((file) => kindOf(file.name) !== 'other')
      const rejected = incoming.length - accepted.length

      setFiles((prev) => {
        const zip = accepted.filter((file) => kindOf(file.name) === 'zip').pop()
        if (zip) return [zip]
        const keep = source === 'folder' ? [] : prev.filter((file) => kindOf(file.name) !== 'zip')
        const merged = [...keep]
        for (const file of accepted) {
          const path = relativePathOf(file)
          if (!merged.some((item) => relativePathOf(item) === path && item.size === file.size)) merged.push(file)
        }
        return merged
      })

      if (rejected > 0) {
        ctx.toast.warn(`已忽略 ${rejected} 个不支持的文件（仅支持 .md / 图片 / .zip）`)
      }
      if (accepted.some((file) => kindOf(file.name) === 'zip') && accepted.length > 1) {
        ctx.toast.info('ZIP 需单独导入，已只保留该 ZIP')
      }
    },
    [ctx],
  )

  const addDropped = useCallback(
    async (dataTransfer: DataTransfer | null, fallback: FileList | null) => {
      const dropped = await collectDroppedFiles(dataTransfer, fallback)
      if (dropped.length === 0) {
        ctx.toast.warn('没有读到可导入的文件')
        return
      }
      const hasFolderPath = dropped.some((file) => relativePathOf(file) !== file.name)
      addFiles(dropped, hasFolderPath ? 'folder' : 'files')
    },
    [addFiles, ctx],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
    setBlocked(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }, [])

  /**
   * 缺图面板的「改用选择文件夹」：清空当前选择（避免 ZIP/文件与文件夹两个来源混在一起）、
   * 关掉预览弹窗，然后直接打开文件夹选择器。
   */
  const switchToFolder = useCallback(() => {
    clearFiles()
    setResult(null)
    setPreview(null)
    folderInputRef.current?.click()
  }, [clearFiles])

  const runPreview = useCallback(async () => {
    if (busy || files.length === 0) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy('preview')
    setBlocked(null)
    setResult(null)
    try {
      const data = await request<ImportPreview>('/api/import/preview', {
        method: 'POST',
        formData: buildImportFormData(files),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (data.items.length === 0) {
        const now = summarize(files)
        setBlocked({
          errors: data.errors ?? [],
          hint:
            now.markdown === 0 && now.zip === 0
              ? '只选到了图片。图片要作为素材随 .md 一起导入，请同时选择对应的 Markdown 文件（或整个文件夹）。'
              : '所选文件里没有解析到任何笔记。',
        })
      } else {
        setPreview(data)
      }
    } catch (err) {
      if (controller.signal.aborted) return
      ctx.toast.error(`预览失败：${describeApiError(err)}`)
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }, [busy, ctx, files])

  const runImport = useCallback(async () => {
    if (busy || files.length === 0) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy('import')
    try {
      const data = await request<ImportSummary>('/api/import/markdown', {
        method: 'POST',
        formData: buildImportFormData(files),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setResult(data)
      setPreview(null)
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
      await Promise.all([ctx.refreshNotes(), ctx.refreshTree()])
      const images = data.imagesImported ?? 0
      ctx.toast.success(
        `导入完成：新增 ${data.imported} 篇${images > 0 ? `、图片 ${images} 张` : ''}，跳过 ${data.skipped} 篇`,
      )
    } catch (err) {
      if (controller.signal.aborted) return
      ctx.toast.error(`导入失败：${describeApiError(err)}`)
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }, [busy, ctx, files])

  const batch = summarize(files)
  const noteOptions = [
    { value: '', label: ctx.notes.length ? '选择一篇笔记…' : '还没有可导出的笔记' },
    ...ctx.notes.map((note) => ({ value: String(note.id), label: note.title || `（无标题 #${note.id}）` })),
  ]
  const batchOverLimit = batch.totalBytes > BATCH_LIMIT_BYTES

  return (
    <div className="kb-adm kb-adm--io">
      <header className="kb-adm__head">
        <div className="kb-adm__heading">
          <h1 className="kb-adm__title">导入导出</h1>
          <p className="kb-adm__sub">导出为 ZIP 备份（整库或单篇，含正文与图片），或从 .md / 图片 / 文件夹 / ZIP 批量导入</p>
        </div>
      </header>

      <div className="kb-adm__body">
        <div className="kb-adm__stack">
          {/* ---------------- 导出 ---------------- */}
          <section className="kb-adm-card">
            <div className="kb-adm-card__head">
              <h2 className="kb-adm-card__title">导出</h2>
            </div>
            <div className="kb-adm-card__body kb-adm-io-row">
              <div className="kb-adm-io-row__text">
                <p className="kb-adm-strong">全部笔记</p>
                <p className="kb-adm-faint">
                  打包为 ZIP：notes/&#123;目录&#125;/&#123;标题&#125;.md + attachments/ + manifest.json；解压后正文按相对路径引用图片，Typora / Obsidian 可直接渲染
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  triggerDownload('/api/export/all')
                  ctx.toast.info('已开始下载全部笔记（ZIP）')
                }}
              >
                导出全部（ZIP）
              </Button>
            </div>
            <div className="kb-adm-card__body kb-adm-io-row">
              <div className="kb-adm-io-row__text">
                <p className="kb-adm-strong">单篇导出</p>
                <p className="kb-adm-faint">
                  导出为 ZIP（含正文 + 这篇用到的图片，解压后图片能直接显示）
                </p>
              </div>
              <div className="kb-adm-io-row__control">
                <Select
                  options={noteOptions}
                  value={noteId}
                  onChange={(event) => setNoteId(event.target.value)}
                  aria-label="选择要导出的笔记"
                />
                <Button
                  disabled={!noteId}
                  onClick={() => {
                    triggerDownload(`/api/export/notes/${noteId}.zip`)
                    ctx.toast.info('已开始下载所选笔记（ZIP，含图片）')
                  }}
                >
                  导出 ZIP
                </Button>
              </div>
            </div>
          </section>

          {/* ---------------- 导入 ---------------- */}
          <section className="kb-adm-card">
            <div className="kb-adm-card__head">
              <h2 className="kb-adm-card__title">导入</h2>
              <p className="kb-adm-card__sub">
                支持 .md / 图片 / 单个 .zip，也可以<strong>选择整个文件夹</strong>；图片作为素材随正文一起导入，找不到的图会逐条列出但不影响正文
              </p>
            </div>
            <div className="kb-adm-card__body">
              <div
                className={`kb-adm-drop${dragging ? ' is-over' : ''}${busy ? ' is-disabled' : ''}`}
                role="button"
                tabIndex={0}
                aria-label="选择或拖入要导入的文件或文件夹"
                onClick={() => {
                  if (!busy) fileInputRef.current?.click()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    if (!busy) fileInputRef.current?.click()
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault()
                  dragDepth.current += 1
                  setDragging(true)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => {
                  dragDepth.current = Math.max(0, dragDepth.current - 1)
                  if (dragDepth.current === 0) setDragging(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  dragDepth.current = 0
                  setDragging(false)
                  if (busy) return
                  void addDropped(event.dataTransfer, event.dataTransfer?.files ?? null)
                }}
              >
                <p className="kb-adm-drop__title">拖拽文件或文件夹到此处，或点击选择</p>
                <p className="kb-adm-faint">支持 .md / 图片（png, jpg, jpeg, gif, webp, bmp, avif, svg）/ 单个 .zip</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={IMPORT_ACCEPT}
                className="kb-visually-hidden"
                onChange={(event) => {
                  addFiles(event.target.files ? Array.from(event.target.files) : null, 'files')
                  event.target.value = ''
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="kb-visually-hidden"
                onChange={(event) => {
                  addFiles(event.target.files ? Array.from(event.target.files) : null, 'folder')
                  event.target.value = ''
                }}
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              />

              <div className="kb-adm-btnrow">
                <Button
                  variant="primary"
                  onClick={() => void runPreview()}
                  disabled={files.length === 0}
                  loading={busy === 'preview'}
                >
                  预览导入内容
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} disabled={busy !== null}>
                  选择文件
                </Button>
                <Button onClick={() => folderInputRef.current?.click()} disabled={busy !== null}>
                  选择文件夹
                </Button>
                <Button onClick={clearFiles} disabled={files.length === 0 || busy !== null}>
                  清空选择
                </Button>
              </div>

              {files.length > 0 ? (
                <>
                  <p className="kb-adm-summary">
                    已选 {files.length} 个文件（{batch.markdown} 篇笔记 · {batch.image} 张图片），共{' '}
                    {ctx.formatBytes(batch.totalBytes)}
                    {batchOverLimit ? (
                      <span className="kb-adm-warn">
                        {' '}
                        · 超过 {ctx.formatBytes(BATCH_LIMIT_BYTES)} 上限，服务端会拒绝整批
                      </span>
                    ) : null}
                  </p>
                  <ul className="kb-adm-files">
                    {files.map((file, index) => {
                      const warning = fileSizeWarning(file, ctx.formatBytes)
                      const kind = kindOf(file.name)
                      return (
                        <li
                          key={`${relativePathOf(file)}-${index}`}
                          className={`kb-adm-file${warning ? ' is-warn' : ''}`}
                        >
                          <span className={`kb-adm-file__kind is-${kind}`} aria-hidden="true">
                            {kind === 'image' ? '图' : kind === 'zip' ? 'ZIP' : 'MD'}
                          </span>
                          <div className="kb-adm-file__main">
                            <p className="kb-adm-file__name" title={relativePathOf(file)}>
                              {relativePathOf(file)}
                            </p>
                            <p className="kb-adm-faint">
                              {ctx.formatBytes(file.size)}
                              {warning ? ` · ${warning}` : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFile(index)}
                            disabled={busy !== null}
                          >
                            移除
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}

              {blocked ? (
                <div className="kb-adm-result is-error">
                  <p className="kb-adm-result__title">没有可导入的条目</p>
                  <p className="kb-adm-faint">{blocked.hint}</p>
                  {blocked.errors.length > 0 ? (
                    <ul className="kb-adm-error-list">
                      {blocked.errors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {result ? <ImportResultBlock result={result} onSwitchToFolder={switchToFolder} /> : null}
            </div>
          </section>

          {/* ---------------- 附件体检 ---------------- */}
          <AttachmentHealthCard ctx={ctx} />
        </div>
      </div>

      {/* ---------------- 预览确认 ---------------- */}
      <Modal
        open={preview !== null}
        title="确认导入"
        onClose={() => {
          if (busy !== 'import') setPreview(null)
        }}
        footer={
          <>
            <Button onClick={() => setPreview(null)} disabled={busy === 'import'}>
              取消
            </Button>
            <Button variant="primary" loading={busy === 'import'} onClick={() => void runImport()}>
              导入 {preview?.total ?? 0} 篇
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="kb-adm-preview">
            <p className="kb-adm-summary">
              共 {preview.total} 篇待导入（来自 {files.length || preview.total} 个文件
              {batch.image > 0 ? `，其中 ${batch.image} 张图片` : ''}）
              {preview.errors?.length ? `，其中 ${preview.errors.length} 个文件解析失败` : ''}。确认后将写入当前空间。
            </p>
            {preview.errors?.length ? (
              <ul className="kb-adm-error-list">
                {preview.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            {(preview.imagesImported ?? 0) > 0 ? (
              <p className="kb-adm-summary">
                <span className="kb-adm-chip is-success">将上传图片 {preview.imagesImported} 张</span>
              </p>
            ) : null}
            <MissingImagesBlock images={preview.missingImages ?? []} onSwitchToFolder={switchToFolder} />
            <ul className="kb-adm-preview-list">
              {preview.items.map((item, index) => (
                <PreviewRow key={`${item.sourceFile}-${index}`} item={item} formatBytes={ctx.formatBytes} />
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------ 附件体检 */

/** 附件体检：列出「登记了但磁盘上找不到」的断链附件，并给出所属笔记的跳转 */
function AttachmentHealthCard({ ctx }: { ctx: ViewProps['ctx'] }) {
  const [health, setHealth] = useState<AttachmentHealth | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const data = await getAttachmentHealth()
      setHealth(data)
      setState('ready')
    } catch (err) {
      setError(describeApiError(err))
      setState('error')
    }
  }, [])

  const missing = health?.missingItems ?? []
  const orphans = health?.orphans ?? []

  return (
    <section className="kb-adm-card">
      <div className="kb-adm-card__head">
        <h2 className="kb-adm-card__title">附件体检</h2>
        <p className="kb-adm-card__sub">
          检查登记过的附件在磁盘上是否还在 —— 恢复 / 迁移后容易丢文件，这里能把「引用还在但文件没了」的逐条列出来
        </p>
      </div>
      <div className="kb-adm-card__body">
        <div className="kb-adm-btnrow">
          <Button variant="primary" loading={state === 'loading'} onClick={() => void run()}>
            检查附件
          </Button>
        </div>

        {state === 'error' ? (
          <div className="kb-adm-result is-error">
            <p className="kb-adm-result__title">检查失败</p>
            <p className="kb-adm-faint">{error}</p>
          </div>
        ) : null}

        {state === 'ready' && health ? (
          health.total === 0 ? (
            <p className="kb-adm-faint">还没有上传过附件。</p>
          ) : (
            <>
              <p className="kb-adm-chips kb-adm-health__summary">
                <span className="kb-adm-chip">共 {health.total} 个附件</span>
                <span className="kb-adm-chip is-success">正常 {health.ok}</span>
                <span className={(health.missing > 0 ? 'kb-adm-chip is-warning' : 'kb-adm-chip') + ''}>
                  缺失 {health.missing}
                </span>
                {orphans.length > 0 ? <span className="kb-adm-chip">孤儿 {orphans.length}</span> : null}
              </p>

              {health.missing === 0 ? (
                <div className="kb-adm-health__ok">
                  <p className="kb-adm-strong">全部附件都在，没有断链。</p>
                </div>
              ) : (
                <div className="kb-adm-health is-warning">
                  <p className="kb-adm-health__head">
                    <span className="kb-adm-health__count">
                      {health.missing} 个附件找不到文件
                    </span>
                    <span className="kb-adm-missing__hint">
                      笔记里的图片会显示不出来；重新上传同名文件即可恢复（原文件名如下）
                    </span>
                  </p>
                  <ul className="kb-adm-health__list">
                    {missing.map((item) => (
                      <li key={item.id} className="kb-adm-health__item">
                        <span className="kb-adm-health__name" title={item.originalName}>
                          {item.originalName}
                        </span>
                        <span className="kb-adm-faint">{ctx.formatBytes(item.sizeBytes)}</span>
                        <Button size="sm" variant="ghost" onClick={() => ctx.openNote(item.noteId)}>
                          {item.noteTitle || `笔记 #${item.noteId}`}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )
        ) : null}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- 缺图 */

/**
 * 缺图是常态：用醒目但**非报错**的样式列出，且绝不阻断确认按钮。
 * 文案必须说清「原因 + 动作」——只告诉用户「找不到」是不够的（真实反馈就是这么来的）。
 */
function MissingImagesBlock({
  images,
  onSwitchToFolder,
}: {
  images: MissingImage[]
  /** 给出一条可点的出路：清空选择后直接打开文件夹选择器 */
  onSwitchToFolder?: () => void
}) {
  if (images.length === 0) return null
  return (
    <div className="kb-adm-missing">
      <p className="kb-adm-missing__head">
        <span className="kb-adm-missing__count">{images.length} 张图片找不到</span>
        <span className="kb-adm-missing__hint">正文会原样保留引用，不影响导入</span>
      </p>
      <div className="kb-adm-missing__guide">
        <p className="kb-adm-missing__why">
          这些图片在你电脑上是有的，只是<strong>这次没有被选中</strong>。Markdown 里的图片是相对路径，浏览器无法自己去磁盘找 —— 请点下面的按钮把图片所在的目录一起选上。
        </p>
        {onSwitchToFolder ? (
          <Button size="sm" onClick={onSwitchToFolder}>
            改用选择文件夹
          </Button>
        ) : null}
      </div>
      <ul className="kb-adm-missing__list">
        {images.map((item, index) => (
          <li key={`${item.sourceFile}-${item.line}-${item.target}-${index}`} className="kb-adm-missing__item">
            <span className="kb-adm-missing__where" title={item.sourceFile}>
              {item.title || item.sourceFile}
              {item.line ? ` 第 ${item.line} 行` : ''}
            </span>
            <span className="kb-adm-missing__target" title={item.target}>
              {item.target || '(空路径)'}
            </span>
            <span className="kb-adm-missing__reason">{item.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- 结果 */

function ImportResultBlock({ result, onSwitchToFolder }: { result: ImportSummary; onSwitchToFolder: () => void }) {
  const errors = result.errors ?? []
  const images = result.imagesImported ?? 0
  const missing = result.missingImages ?? []
  return (
    <div className={`kb-adm-result${errors.length ? ' is-error' : ''}`}>
      <p className="kb-adm-result__title">导入结果</p>
      <p className="kb-adm-chips">
        <span className="kb-adm-chip is-success">导入 {result.imported} 篇</span>
        <span className="kb-adm-chip">跳过 {result.skipped} 篇</span>
        <span className="kb-adm-chip">图片 {images} 张</span>
        <span className={`kb-adm-chip${errors.length ? ' is-danger' : ''}`}>出错 {errors.length}</span>
      </p>
      {errors.length > 0 ? (
        <ul className="kb-adm-error-list">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      <MissingImagesBlock images={missing} onSwitchToFolder={onSwitchToFolder} />
      {errors.length === 0 && missing.length === 0 ? <p className="kb-adm-faint">全部文件均已处理完成。</p> : null}
    </div>
  )
}

function PreviewRow({
  item,
  formatBytes,
}: {
  item: ImportPreviewItem
  formatBytes: (n: number) => string
}) {
  return (
    <li className="kb-adm-preview-item">
      <p className="kb-adm-preview-item__title" title={item.title}>
        {item.title || '（未命名）'}
      </p>
      <p className="kb-adm-preview-item__meta">
        <span className="kb-adm-truncate">{item.sourceFile}</span>
        <span>{item.folder ? `目录：${item.folder}` : '目录：未分类'}</span>
        <span>{formatBytes(item.sizeBytes)}</span>
        {item.tags.length > 0 ? (
          <span className="kb-adm-chips">
            {item.tags.map((tag) => (
              <span key={tag} className="kb-adm-chip">
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </p>
    </li>
  )
}
