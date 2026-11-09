export const READ_ZOOM_MIN = 80
export const READ_ZOOM_MAX = 200
export const READ_ZOOM_STEP = 10
export const READ_ZOOM_DEFAULT = 100

/** 缩放值一律走这里：整数百分比、夹在 80–200、按 5 的倍数取整 */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return READ_ZOOM_DEFAULT
  const snapped = Math.round(value / 5) * 5
  return Math.min(READ_ZOOM_MAX, Math.max(READ_ZOOM_MIN, snapped))
}
