const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 后端时间戳是 ISO-8601 UTC（形如 2026-10-16T02:33:14Z），可直接被 Date 解析 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''

  const diff = now - time
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`

  const date = new Date(time)
  const monthDay = `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  return date.getFullYear() === new Date(now).getFullYear()
    ? monthDay
    : `${date.getFullYear()} 年 ${monthDay}`
}

/** 形如 15:07，用于「已保存 · 15:07」 */
export function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 绝对时间：2026-10-16 16:45（本地时区；无法解析时返回原串） */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso || ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

/** 只到日期：2026-10-16（回收站 / 统计等场景） */
export function formatDateOnly(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso || ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const KIB = 1024
const MIB = KIB * 1024
const GIB = MIB * 1024

/** 字节数格式化：1.2 KB / 5.0 MB / 812 B */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < KIB) return `${Math.round(bytes)} B`
  if (bytes < MIB) return `${(bytes / KIB).toFixed(1)} KB`
  if (bytes < GIB) return `${(bytes / MIB).toFixed(1)} MB`
  return `${(bytes / GIB).toFixed(1)} GB`
}
