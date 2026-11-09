/**
 * 开源周报（#/weekly）—— 展示「开源周报/<ISO 周>/」下的项目笔记，并提供「一键获取本周周报」。
 *
 * 数据来源（全部走现有接口，没有新增后端接口）：
 *  · GET /api/folders?tree=true      → 找「开源周报」下最新的周目录（形如 2026-W44）
 *  · GET /api/notes?folderId=&size=  → 该周的项目笔记
 *  · GET /api/notes/{id}             → 逐篇取正文，解析「一句话价值 / 星数 / 语言」
 *  · POST /api/weekly/run            → 抓取并生成（15–40 秒）
 *  · GET /api/weekly/runs?limit=10   → 运行历史
 *
 * 正文解析遵循「取不到就不显示，不瞎猜」：真实笔记格式是
 *   # [GitHub] owner/repo
 *   > 本周新增 ⭐ **+1,234** · 总星 12.7k · Java · 2026-W44
 *   **仓库地址**：https://…
 *   ## 它是做什么的
 *   ## 为什么值得看
 * 同时兼容 `**一句话价值**：…` 与 markdown 表格两种写法（未来格式变化时不至于瞎）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, describeApiError, request } from '@/api/client'
import { listFolders } from '@/api/folders'
import { getNote, listNotes } from '@/api/notes'
import type { FolderNode, NoteListItem } from '@/api/types'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from '@/views/types'
import '@/styles/views-weekly.css'

const WEEKLY_FOLDER = '开源周报'
const WEEK_PATTERN = /^\d{4}-W\d{2}$/
const CONCURRENCY = 4

/* ------------------------------------------------------------ 契约类型 */

interface NoteRef {
  id: number
  title: string
  repo: string
  url: string
  weeklyStars?: number | null
}

interface WeeklyRunResponse {
  runId: number
  isoWeek: string
  status: string
  notesCreated: number
  notesSkipped: number
  notes: NoteRef[]
  githubNote?: string | null
  giteeNote?: string | null
}

interface WeeklyRunRow {
  id: number
  isoWeek: string
  startedAt: string
  finishedAt?: string | null
  status: string
  notesCreated: number
  githubCount: number
  giteeCount: number
  /** 后端正在给 weekly_runs 加这一列；没有就显示「—」 */
  notesSkipped?: number
  error?: string | null
}

interface RepoMeta {
  weeklyStars: string | null
  totalStars: string | null
  language: string | null
}

/* ------------------------------------------------------------ 正文解析 */

/** 找「一句话价值」：优先 `**一句话价值**：`，退回「为什么值得看」首段；都没有则 null */
export function extractValueLine(content: string): string | null {
  const lines = content.split(/\r?\n/)
  const explicit = lines.find((line) => /^\*\*一句话价值\*\*\s*[:：]/.test(line.trim()))
  if (explicit) {
    const text = explicit.replace(/^\*\*一句话价值\*\*\s*[:：]\s*/, '').trim()
    if (text) return text
  }
  // 表格写法：| 一句话价值 | xxx |
  const tableRow = lines.find((line) => /^\|\s*一句话价值\s*\|/.test(line.trim()))
  if (tableRow) {
    const cells = tableRow.split('|').map((cell) => cell.trim()).filter(Boolean)
    if (cells.length >= 2 && cells[1]) return cells[1]
  }
  const headingIndex = lines.findIndex((line) => /^##\s*为什么值得看\s*$/.test(line.trim()))
  if (headingIndex >= 0) {
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
      const text = lines[i].trim()
      if (!text) continue
      if (text.startsWith('#')) break
      return text
    }
  }
  return null
}

/** 解析「本周新增 / 总星 / 语言」：先认 blockquote 元信息行，再认表格；解析不到就是 null */
export function extractRepoMeta(content: string): RepoMeta {
  const meta: RepoMeta = { weeklyStars: null, totalStars: null, language: null }
  const lines = content.split(/\r?\n/)

  const quote = lines.find((line) => /^>/.test(line.trim()))
  if (quote) {
    const cleaned = quote
      .replace(/^\s*>\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/⭐/g, '')
      .trim()
    const parts = cleaned.split('·').map((part) => part.trim()).filter(Boolean)
    for (const part of parts) {
      if (/^\d{4}-W\d{2}$/.test(part)) continue
      const weekly = part.match(/^本周新增\s*([+\-]?[\d,]+|—.*)$/)
      if (weekly) {
        meta.weeklyStars = /^[+\-]?[\d,]+$/.test(weekly[1]) ? weekly[1] : null
        continue
      }
      const total = part.match(/^总星\s*([\d.,]+k?|未标注)$/i)
      if (total) {
        meta.totalStars = /未标注/.test(total[1]) ? null : total[1]
        continue
      }
      if (!meta.language && /^[A-Za-z][A-Za-z0-9+#.\- ]{0,20}$/.test(part)) meta.language = part
    }
  }

  // 表格写法兜底
  for (const line of lines) {
    const row = line.trim()
    if (!row.startsWith('|')) continue
    const cells = row.split('|').map((cell) => cell.trim()).filter(Boolean)
    if (cells.length < 2) continue
    if (/^本周新增$/.test(cells[0])) {
      const value = cells[1].replace(/\*\*/g, '').trim()
      if (/^[+\-]?[\d,]+$/.test(value)) meta.weeklyStars = value
    } else if (/^总星$/.test(cells[0])) {
      const value = cells[1].replace(/\*\*/g, '').trim()
      if (/^[\d.,]+k?$/i.test(value)) meta.totalStars = value
    } else if (/^语言$/.test(cells[0])) {
      meta.language = cells[1] || null
    }
  }
  return meta
}

/** 在「开源周报」下挑 ISO 周最大的子目录（字符串比较即可，格式零填充） */
export function pickLatestWeek(tree: FolderNode[], rootName = WEEKLY_FOLDER): FolderNode | null {
  const root = tree.find((node) => node.name.trim() === rootName)
  if (!root) return null
  const weeks = root.children.filter((child) => WEEK_PATTERN.test(child.name.trim()))
  if (weeks.length === 0) return null
  return weeks.slice().sort((a, b) => a.name.localeCompare(b.name)).pop() ?? null
}

function sourceOf(title: string): 'github' | 'gitee' | 'other' {
  if (/^\[GitHub\]/i.test(title)) return 'github'
  if (/^\[Gitee\]/i.test(title)) return 'gitee'
  return 'other'
}

const RUN_STATUS: Record<string, { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  success: { text: '成功', tone: 'success' },
  partial: { text: '部分成功', tone: 'warning' },
  failed: { text: '失败', tone: 'danger' },
  running: { text: '进行中', tone: 'neutral' },
}

type Banner =
  | { kind: 'loading' }
  | { kind: 'success'; created: number; github: number; gitee: number; skipped?: number }
  | { kind: 'exists'; skipped: number }
  | { kind: 'busy' }
  | { kind: 'partial'; created: number; skipped: number; detail?: string | null }
  | { kind: 'failed'; message: string; retryable: boolean }

interface WeeklyCard {
  note: NoteListItem
  value: string | null
  meta: RepoMeta
}

/* ---------------------------------------------------------------- 视图 */

export default function WeeklyView({ ctx }: ViewProps) {
  const [week, setWeek] = useState<FolderNode | null>(null)
  const [cards, setCards] = useState<WeeklyCard[]>([])
  const [runs, setRuns] = useState<WeeklyRunRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setError('')
    try {
      const [tree, runData] = await Promise.all([
        listFolders(controller.signal),
        request<{ items: WeeklyRunRow[] }>('/api/weekly/runs?limit=10', { signal: controller.signal }).catch(() => ({
          items: [] as WeeklyRunRow[],
        })),
      ])
      if (controller.signal.aborted) return
      setRuns(runData.items ?? [])
      const latest = pickLatestWeek(tree)
      setWeek(latest)
      if (!latest) {
        setCards([])
        setStatus('ready')
        return
      }
      const page = await listNotes({ folderId: latest.id, size: 50, signal: controller.signal })
      if (controller.signal.aborted) return
      const items = page.items ?? []
      // 逐篇取正文解析：并发 4，单篇失败只影响那一张卡
      const queue = [...items]
      const out: WeeklyCard[] = []
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (;;) {
          const note = queue.shift()
          if (!note || controller.signal.aborted) return
          let value: string | null = null
          let meta: RepoMeta = { weeklyStars: null, totalStars: null, language: null }
          try {
            const detail = await getNote(note.id, controller.signal)
            value = extractValueLine(detail.content)
            meta = extractRepoMeta(detail.content)
          } catch {
            /* 取不到就只显示标题与摘要 */
          }
          out.push({ note, value, meta })
        }
      })
      await Promise.all(workers)
      if (controller.signal.aborted) return
      out.sort((a, b) => a.note.id - b.note.id)
      setCards(out)
      setStatus('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeApiError(err))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  const runWeekly = useCallback(
    async () => {
      if (running) return
      setRunning(true)
      setBanner({ kind: 'loading' })
      try {
        const data = await request<WeeklyRunResponse>('/api/weekly/run', { method: 'POST' })
        const github = data.notes.filter((note) => sourceOf(note.title) === 'github').length
        const gitee = data.notes.filter((note) => sourceOf(note.title) === 'gitee').length
        if (data.status === 'failed') {
          const reason = [data.githubNote, data.giteeNote].filter(Boolean).join('；') || '后端未返回具体原因'
          setBanner({ kind: 'failed', message: reason, retryable: true })
          ctx.toast.error('本周周报生成失败')
        } else if (data.notesCreated === 0 && data.notesSkipped > 0) {
          // 不是错误：这周的笔记早就在了（后端按「周目录 + 标题」判重）
          setBanner({ kind: 'exists', skipped: data.notesSkipped })
          ctx.toast.info('本周周报已存在，未重复生成')
        } else if (data.status === 'partial') {
          const detail = [data.githubNote, data.giteeNote].filter(Boolean).join('；')
          setBanner({ kind: 'partial', created: data.notesCreated, skipped: data.notesSkipped, detail })
          ctx.toast.warn('本周周报部分完成')
        } else if (data.notesCreated > 0) {
          setBanner({ kind: 'success', created: data.notesCreated, github, gitee, skipped: data.notesSkipped })
          ctx.toast.success('本周周报已生成')
        } else {
          setBanner({ kind: 'exists', skipped: 0 })
          ctx.toast.info('本周周报已存在')
        }
        await load()
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) {
            // 409 的真实语义是「任务正在运行中」，不是「要不要再来一次」——不弹确认、不给重试，等它跑完即可
            setBanner({ kind: 'busy' })
            ctx.toast.warn('本周周报正在生成中，请等它跑完（约 15–40 秒）后再点')
            return
          }
          if (err.status === 401) {
            ctx.toast.error('登录状态已过期，请重新登录')
            setBanner({ kind: 'failed', message: '登录状态已过期，请重新登录', retryable: false })
            return
          }
          // 有后端消息就照实显示（「Gitee 数据未更新」这类），只有真·网络故障才说网络
          const message = describeApiError(err)
          const usable = message && !/^未知错误$/.test(message)
          setBanner({
            kind: 'failed',
            message: err.status === 0 || !usable ? '网络中断，请检查后重试' : message,
            retryable: true,
          })
          ctx.toast.error('本周周报生成失败')
        } else {
          setBanner({ kind: 'failed', message: '网络中断，请检查后重试', retryable: true })
        }
      } finally {
        setRunning(false)
      }
    },
    [ctx, load, running],
  )

  const scrollToList = useCallback(() => {
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const groups = useMemo(() => {
    const github = cards.filter((card) => sourceOf(card.note.title) === 'github')
    const gitee = cards.filter((card) => sourceOf(card.note.title) === 'gitee')
    const other = cards.filter((card) => sourceOf(card.note.title) === 'other')
    return { github, gitee, other }
  }, [cards])

  return (
    <div className="vw-weekly">
      <header className="vw-weekly__head">
        <div className="vw-weekly__heading">
          <h1 className="vw-weekly__title">开源周报</h1>
          <p className="vw-weekly__sub">每周五 18:30 自动抓取 GitHub / Gitee 涨星最快的各 5 个项目</p>
        </div>
        <div className="vw-weekly__actions">
          <Button
            variant="primary"
            className="vw-weekly__run"
            loading={running}
            aria-busy={running}
            aria-disabled={running}
            onClick={() => void runWeekly()}
          >
            {running ? '正在获取…' : '一键获取本周周报'}
          </Button>
          <Button onClick={() => void load()} disabled={status === 'loading' || running}>
            刷新列表
          </Button>
        </div>
      </header>

      <div className="vw-weekly__body">
        <div className="vw-weekly__banner" aria-live="polite">
          {banner?.kind === 'loading' ? (
            <p className="vw-weekly__strip is-info is-loading">
              正在抓取 GitHub 与 Gitee，约需 15–40 秒，请不要关闭页面
            </p>
          ) : null}
          {banner?.kind === 'success' ? (
            <p className="vw-weekly__strip is-success">
              <span>
                已生成 {banner.created} 篇（GitHub {banner.github} · Gitee {banner.gitee}）
                {banner.skipped && banner.skipped > 0 ? `，${banner.skipped} 篇已存在未重复生成` : ''}
              </span>
              <Button size="sm" onClick={scrollToList}>
                查看本周项目
              </Button>
            </p>
          ) : null}
          {banner?.kind === 'exists' ? (
            <p className="vw-weekly__strip is-info">
              <span>
                本周周报已存在，{banner.skipped} 篇跳过未重复生成
              </span>
              <Button size="sm" onClick={scrollToList}>
                查看本周项目
              </Button>
            </p>
          ) : null}
          {banner?.kind === 'busy' ? (
            <p className="vw-weekly__strip is-warning">
              本周周报正在生成中，请等它跑完（约 15–40 秒）后再点
            </p>
          ) : null}
          {banner?.kind === 'partial' ? (
            <p className="vw-weekly__strip is-warning">
              <span>
                已生成 {banner.created} 篇，{banner.skipped} 篇已存在未重复生成
                {banner.detail ? `（${banner.detail}）` : ''}
              </span>
            </p>
          ) : null}
          {banner?.kind === 'failed' ? (
            <p className="vw-weekly__strip is-error">
              <span>{banner.message}</span>
              {banner.retryable ? (
                <Button size="sm" onClick={() => void runWeekly()}>
                  重试
                </Button>
              ) : null}
            </p>
          ) : null}
        </div>

        {status === 'loading' ? (
          <div className="vw-weekly__skeleton" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="vw-weekly__card vw-weekly__card--skeleton">
                <Skeleton width="42%" height={16} />
                <Skeleton width="86%" />
                <Skeleton width="64%" />
              </div>
            ))}
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="vw-weekly__state">
            <EmptyState
              title="加载失败"
              desc={error || '无法读取周报目录'}
              action={
                <Button variant="primary" onClick={() => void load()}>
                  重试
                </Button>
              }
            />
          </div>
        ) : null}

        {status === 'ready' ? (
          <section className="vw-weekly__section" ref={listRef}>
            <div className="vw-weekly__section-head">
              <h2 className="vw-weekly__section-title">
                本周项目{week ? <span className="vw-weekly__week">{week.name}</span> : null}
              </h2>
              <span className="vw-weekly__faint">
                {cards.length > 0 ? cards.length + ' 个项目' : '暂无'}
              </span>
            </div>

            {cards.length === 0 ? (
              <div className="vw-weekly__state">
                <EmptyState
                  title="还没有生成过开源周报"
                  desc="点右上角「一键获取本周周报」，会自动抓取 GitHub 与 Gitee 本周涨星最快的项目并归档成笔记。"
                  action={
                    <Button variant="primary" loading={running} onClick={() => void runWeekly()}>
                      一键获取本周周报
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                <RepoGroup title="GitHub" items={groups.github} ctx={ctx} />
                <RepoGroup title="Gitee" items={groups.gitee} ctx={ctx} />
                {groups.other.length > 0 ? <RepoGroup title="其他" items={groups.other} ctx={ctx} /> : null}
              </>
            )}
          </section>
        ) : null}

        {status === 'ready' ? (
          <section className="vw-weekly__section">
            <div className="vw-weekly__section-head">
              <h2 className="vw-weekly__section-title">运行历史</h2>
              <span className="vw-weekly__faint">最近 {runs.length} 次</span>
            </div>
            {runs.length === 0 ? (
              <p className="vw-weekly__faint vw-weekly__empty-row">还没有运行记录。</p>
            ) : (
              <div className="vw-weekly__tablewrap">
                <table className="vw-weekly__table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>状态</th>
                      <th className="vw-weekly__num">生成</th>
                      <th className="vw-weekly__num">跳过</th>
                      <th>来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const meta = RUN_STATUS[run.status] ?? { text: run.status, tone: 'neutral' as const }
                      return (
                        <tr key={run.id}>
                          <td className="vw-weekly__time">{ctx.relativeTime(run.startedAt)}</td>
                          <td>
                            <Badge tone={meta.tone}>{meta.text}</Badge>
                          </td>
                          <td className="vw-weekly__num">{run.notesCreated}</td>
                          <td className="vw-weekly__num">
                            {typeof run.notesSkipped === 'number' ? run.notesSkipped : '—'}
                          </td>
                          <td className="vw-weekly__faint">
                            GitHub {run.githubCount} · Gitee {run.giteeCount}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function RepoGroup({ title, items, ctx }: { title: string; items: WeeklyCard[]; ctx: ViewProps['ctx'] }) {
  if (items.length === 0) return null
  return (
    <div className="vw-weekly__group">
      <h3 className="vw-weekly__group-title">
        {title} <span className="vw-weekly__faint">{items.length}</span>
      </h3>
      <ul className="vw-weekly__cards">
        {items.map((card) => (
          <li key={card.note.id}>
            <button
              type="button"
              className="vw-weekly__card"
              onClick={() => ctx.openNote(card.note.id)}
              title={card.note.title}
            >
              <span className="vw-weekly__card-title">{card.note.title}</span>
              <span className="vw-weekly__card-value">{card.value ?? card.note.excerpt ?? '（暂无摘要）'}</span>
              {card.meta.weeklyStars || card.meta.totalStars || card.meta.language ? (
                <span className="vw-weekly__chips">
                  {card.meta.weeklyStars ? (
                    <span className="vw-weekly__chip is-star">本周 +{card.meta.weeklyStars.replace(/^\+/, '')}</span>
                  ) : null}
                  {card.meta.totalStars ? <span className="vw-weekly__chip">总星 {card.meta.totalStars}</span> : null}
                  {card.meta.language ? <span className="vw-weekly__chip">{card.meta.language}</span> : null}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
