import type { ReactNode, SVGProps } from 'react'

/** 自绘图标集（不引入任何 UI/图标库） */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Glyph({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
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

export function IconSun(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </Glyph>
  )
}

export function IconMoon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
    </Glyph>
  )
}

export function IconPanelLeft(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4v16" />
    </Glyph>
  )
}

export function IconLogOut(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M15 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </Glyph>
  )
}

export function IconAlert(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4m0 4h.01" />
    </Glyph>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </Glyph>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Glyph>
  )
}

export function IconSpinner(props: IconProps) {
  return (
    <Glyph {...props} className={['kb-spin', props.className].filter(Boolean).join(' ')}>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </Glyph>
  )
}

export function IconBook(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22Z" />
      <path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20" />
    </Glyph>
  )
}

export function IconEye(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  )
}

export function IconEyeOff(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.4 8.1A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 3.4-.6" />
      <path d="M9.9 10a3 3 0 0 0 4.2 4.2" />
    </Glyph>
  )
}

export function IconCloudOff(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 4l16 16" />
      <path d="M7.5 18.5A4.5 4.5 0 0 1 6.2 9.7 6 6 0 0 1 15 6.6" />
      <path d="M18.9 10.6A4.5 4.5 0 0 1 18 18.5h-6" />
    </Glyph>
  )
}

export function IconFileText(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Glyph>
  )
}

export function IconLinkOff(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1" />
      <path d="M3 3l18 18" />
    </Glyph>
  )
}

export function IconWarn(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5m0 3.5h.01" />
    </Glyph>
  )
}

export function IconMenu(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Glyph>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Glyph>
  )
}

export function IconFolder(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h8A1.5 1.5 0 0 1 20 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 17.5Z" />
    </Glyph>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m9 5 7 7-7 7" />
    </Glyph>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  )
}

export function IconPencil(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
      <path d="m14.5 6.5 3 3" />
    </Glyph>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      <path d="M10 11v5m4-5v5" />
    </Glyph>
  )
}

export function IconTag(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M11 3H5a2 2 0 0 0-2 2v6l10 10 8-8Z" />
      <path d="M7.5 7.5h.01" />
    </Glyph>
  )
}

export function IconStar(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z" />
    </Glyph>
  )
}

export function IconClock(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Glyph>
  )
}

export function IconLink(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1" />
    </Glyph>
  )
}

export function IconHistory(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V10H9" />
      <path d="M12 8v4.5l3 1.8" />
    </Glyph>
  )
}

export function IconUpload(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Glyph>
  )
}

export function IconDownload(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Glyph>
  )
}

export function IconChart(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20h16" />
      <path d="M7 20v-6m5 6V8m5 12v-9" />
    </Glyph>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </Glyph>
  )
}

export function IconInbox(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 13.5 5.5 5h13L21 13.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 13.5h5l1 3h6l1-3h5" />
    </Glyph>
  )
}

export function IconLayers(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m12 3 9 5-9 5-9-5Z" />
      <path d="m4.5 12.5 7.5 4.2 7.5-4.2" />
    </Glyph>
  )
}

export function IconRefresh(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4.5V10H15" />
    </Glyph>
  )
}

