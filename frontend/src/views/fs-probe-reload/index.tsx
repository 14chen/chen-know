import type { ViewProps } from '@/views/types'

/** FS-PROBE：验收 reloadCurrentNote（验收后删除） */
export default function FsProbeReload({ ctx }: ViewProps) {
  return (
    <div className="kb-editor-pane" style={{ display: 'grid', placeItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <p>FS-PROBE reloadCurrentNote</p>
        <p data-testid="probe-current">currentNoteId: {String(ctx.currentNoteId)}</p>
        <p data-testid="probe-count">notes: {ctx.notes.length}</p>
        <button
          id="fs-probe-reload"
          type="button"
          className="kb-btn kb-btn--primary"
          onClick={() => {
            void ctx.reloadCurrentNote()
          }}
        >
          调用 reloadCurrentNote
        </button>
      </div>
    </div>
  )
}
