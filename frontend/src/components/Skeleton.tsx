/** 骨架屏：侧栏笔记列表加载态用 */
export function Skeleton({
  width = '100%',
  height = 12,
  radius = 'var(--r-sm)',
}: {
  width?: number | string
  height?: number | string
  radius?: string
}) {
  return (
    <span
      className="kb-skeleton"
      style={{ display: 'block', width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  )
}
