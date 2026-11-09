/**
 * PWA 相关：Service Worker 注册 + 离线提示条。
 *
 * SW 只在生产构建注册（dev server 每次热更新换 URL，缓存只会让人以为改动没生效）。
 */
const BANNER_ID = 'kb-offline-banner'

function ensureBanner(): HTMLDivElement {
  const existing = document.getElementById(BANNER_ID)
  if (existing) return existing as HTMLDivElement
  const el = document.createElement('div')
  el.id = BANNER_ID
  el.setAttribute('role', 'status')
  el.textContent = '当前离线 · 已缓存的内容仍可查看，联网后自动恢复'
  el.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:0',
    'z-index:2147483000',
    'padding:10px 16px calc(10px + env(safe-area-inset-bottom, 0px))',
    'background:#4f46e5',
    'color:#fff',
    'font-size:13px',
    'line-height:1.5',
    'text-align:center',
    'box-shadow:0 -1px 3px rgba(16,24,40,0.2)',
    'display:none',
  ].join(';')
  document.body.appendChild(el)
  return el
}

function syncBanner(): void {
  if (!document.body) return
  const banner = ensureBanner()
  banner.style.display = navigator.onLine ? 'none' : 'block'
}

/** 断网时在界面上给一条可见提示（缓存内容仍可用），恢复后自动消失 */
export function installOfflineBanner(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', syncBanner)
  window.addEventListener('offline', syncBanner)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncBanner, { once: true })
  } else {
    syncBanner()
  }
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('[pwa] Service Worker 注册失败', error)
    })
  })
}
