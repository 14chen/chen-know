import { IconBook, IconPencil } from '@/components/Icon'

import { clampZoom, READ_ZOOM_MAX, READ_ZOOM_MIN, READ_ZOOM_STEP, READ_ZOOM_DEFAULT } from './readZoom'

export interface ReadBarProps {
  /** 百分比，100 = 原始大小 */
  zoom: number
  onZoom: (next: number) => void
  readMode: boolean
  onReadMode: (next: boolean) => void
}

/**
 * 正文阅读工具条：缩放（80%–200%）+ 编辑/阅读切换。
 * 悬浮在正文列底部中间，不占正文高度，也不与右侧大纲卡片抢位置。
 */
export function ReadBar({ zoom, onZoom, readMode, onReadMode }: ReadBarProps) {
  return (
    <div className="kb-readbar" role="toolbar" aria-label="正文阅读工具">
      <div className="kb-readbar__group" role="group" aria-label="编辑或阅读">
        <button
          type="button"
          className={`kb-readbar__mode${readMode ? '' : ' is-active'}`}
          aria-pressed={!readMode}
          title="编辑：可以修改正文"
          onClick={() => onReadMode(false)}
        >
          <IconPencil size={14} />
          <span>编辑</span>
        </button>
        <button
          type="button"
          className={`kb-readbar__mode${readMode ? ' is-active' : ''}`}
          aria-pressed={readMode}
          title="阅读：只能选中与复制，不会误改"
          onClick={() => onReadMode(true)}
        >
          <IconBook size={14} />
          <span>阅读</span>
        </button>
      </div>

      <span className="kb-readbar__sep" aria-hidden="true" />

      <div className="kb-readbar__group" role="group" aria-label="正文缩放">
        <button
          type="button"
          className="kb-readbar__step"
          aria-label="缩小正文"
          title="缩小"
          disabled={zoom <= READ_ZOOM_MIN}
          onClick={() => onZoom(clampZoom(zoom - READ_ZOOM_STEP))}
        >
          −
        </button>
        <input
          className="kb-readbar__range"
          type="range"
          min={READ_ZOOM_MIN}
          max={READ_ZOOM_MAX}
          step={READ_ZOOM_STEP}
          value={zoom}
          aria-label="正文缩放"
          aria-valuetext={`${zoom}%`}
          onChange={(event) => onZoom(clampZoom(Number(event.target.value)))}
        />
        <button
          type="button"
          className="kb-readbar__step"
          aria-label="放大正文"
          title="放大"
          disabled={zoom >= READ_ZOOM_MAX}
          onClick={() => onZoom(clampZoom(zoom + READ_ZOOM_STEP))}
        >
          +
        </button>
        <button
          type="button"
          className="kb-readbar__value"
          title="恢复 100%"
          aria-label={`当前 ${zoom}%，点击恢复 100%`}
          onClick={() => onZoom(READ_ZOOM_DEFAULT)}
        >
          {zoom}%
        </button>
      </div>
    </div>
  )
}
