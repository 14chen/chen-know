import { IconCheck, IconCloudOff, IconSpinner } from '@/components/Icon'
import { formatClock } from './time'
import type { SaveState } from './useNotes'

export interface SaveStatusProps {
  state: SaveState
  savedAt: number | null
  onRetry: () => void
}

/** 「未保存 / 保存中 / 已保存 / 失败」状态指示（验收项要求可见） */
export function SaveStatus({ state, savedAt, onRetry }: SaveStatusProps) {
  if (state === 'error') {
    return (
      <span className="kb-save-status" data-state="error" role="status" aria-live="polite">
        <IconCloudOff size={13} />
        保存失败
        <button type="button" className="kb-save-status__retry" onClick={onRetry}>
          重试
        </button>
      </span>
    )
  }

  if (state === 'saving') {
    return (
      <span className="kb-save-status" data-state="saving" role="status" aria-live="polite">
        <IconSpinner size={13} />
        保存中…
      </span>
    )
  }

  if (state === 'dirty') {
    return (
      <span className="kb-save-status" data-state="dirty" role="status" aria-live="polite">
        <span className="kb-dot" />
        未保存
      </span>
    )
  }

  return (
    <span className="kb-save-status" data-state="saved" role="status" aria-live="polite">
      <IconCheck size={13} />
      {savedAt !== null ? (
        <>
          已保存
          <span className="kb-save-status__time">· {formatClock(savedAt)}</span>
        </>
      ) : (
        '已保存'
      )}
    </span>
  )
}
