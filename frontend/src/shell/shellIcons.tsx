import type { ReactNode, SVGProps } from 'react'

/**
 * 外壳自用的小图标。
 *
 * 共享图标集在 `@/components/Icon`（本轮文件边界不含 components/），
 * 因此这里就近定义外壳自用的图标，风格与共享图标集一致（24 格、currentColor 描边）。
 */

export interface ShellIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Glyph({ size = 16, children, ...rest }: ShellIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 「⋯」：更多操作 */
export function IconMore(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </Glyph>
  )
}

/** 向外箭头：切到「宽屏」 */
export function IconExpand(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 10v-6h6M20 14v6h-6" />
      <path d="M10 4 4 10M14 20l6-6" />
    </Glyph>
  )
}

/** AI 简报：报纸 + 火花 */
export function IconBriefing(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V19a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V19a2 2 0 0 1-2 2" />
      <path d="M7 8h6M7 11.5h6M7 15h3.5" />
      <path d="M18.5 3.5v2.2M17.4 4.6h2.2" />
    </Glyph>
  )
}

/** 关系图：三个节点两两相连 */
export function IconGraph(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="5.6" r="2.4" />
      <circle cx="5.6" cy="18" r="2.4" />
      <circle cx="18.4" cy="18" r="2.4" />
      <path d="M10.9 7.8 6.9 15.8M13.1 7.8l4 8M8 18h8" />
    </Glyph>
  )
}

/** 开源周报：日历 + 一周的日期点 */
export function IconWeekly(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 9.6h17M8 3.2v3.4M16 3.2v3.4" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
    </Glyph>
  )
}

/** 调色板：主题选择 */
export function IconPalette(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 0-4h-.7a1.6 1.6 0 0 1 0-3.2H16a5 5 0 0 0 5-5c0-3.2-4-5.8-9-5.8Z" />
      <circle cx="7.6" cy="10.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10.6" cy="7.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** 向内箭头：切回「窄栏」 */
export function IconContract(props: ShellIconProps) {
  return (
    <Glyph {...props}>
      <path d="M10 4v6H4M14 20v-6h6" />
      <path d="m4 4 6 6M20 20l-6-6" />
    </Glyph>
  )
}
