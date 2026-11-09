/* 知识库 Service Worker —— 手写，无第三方依赖（不引 workbox） */
'use strict'

const SHELL_PREFIX = 'kb-shell-'
const ASSETS_PREFIX = 'kb-assets-'
const OFFLINE_URL = '/offline.html'
const STATIC_PRECACHE = [OFFLINE_URL, '/manifest.webmanifest']

const META_CACHE = 'kb-meta'

/** 当前构建的 cache 名：以 index.html 里带哈希的构建产物名当作版本号 */
async function rememberStamp(stamp) {
  const cache = await caches.open(META_CACHE)
  await cache.put('/kb-stamp', new Response(stamp, { headers: { 'content-type': 'text/plain' } }))
}

/* 当前版本必须来自 install 时记下的 stamp，不能对 cache 名排序取最大：
   stamp 是内容哈希（A-Za-z0-9_-），不是单调递增的十六进制串。
   排序取「最大」有概率选到上一代，activate 就会把刚写好的新 cache 当旧的删掉，
   结果是部署后离线打开还是旧版本（或直接白屏）。 */
async function activePair() {
  const cache = await caches.open(META_CACHE)
  const res = await cache.match('/kb-stamp')
  if (!res) return null
  const stamp = (await res.text()).trim()
  if (!stamp) return null
  return { stamp, shell: SHELL_PREFIX + stamp, assets: ASSETS_PREFIX + stamp }
}

function stampFromHtml(html) {
  // assets/index-B1s2c3d4.js → b1s2c3d4（同一次构建里所有产物共享同一段哈希后缀语义）
  const m = html.match(/\/assets\/[A-Za-z0-9_.-]*-([A-Za-z0-9_-]{6,})\.(?:js|css)/)
  if (m) return m[1].toLowerCase()
  // 兜底：用 index.html 内容的简易哈希
  let h = 0
  for (let i = 0; i < html.length; i += 1) h = (h * 31 + html.charCodeAt(i)) >>> 0
  return h.toString(16)
}

function assetUrls(html) {
  const out = new Set()
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g
  let m
  while ((m = re.exec(html)) !== null) out.add(m[1])
  return [...out]
}

/* ---------------------------------------------------------------- install */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/', { cache: 'no-store' })
      const html = await res.text()
      const stamp = stampFromHtml(html)
      await rememberStamp(stamp)
      const shellCache = await caches.open(SHELL_PREFIX + stamp)
      const assetsCache = await caches.open(ASSETS_PREFIX + stamp)

      await shellCache.put('/', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
      await Promise.allSettled(STATIC_PRECACHE.map((u) => shellCache.add(u)))
      // 预缓存本次构建的全部产物（带哈希，永不失效）
      await Promise.allSettled(assetUrls(html).map((u) => assetsCache.add(u)))
      await self.skipWaiting()
    })().catch((err) => {
      // 预缓存失败不应让 SW 装不上：退化为运行时按需缓存
      console.warn('[sw] install precache failed', err)
      return self.skipWaiting()
    }),
  )
})

/* --------------------------------------------------------------- activate */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 只在「确实知道当前版本」时才清理：install 失败（离线/接口异常）时 pair 为 null，
      // 此时什么都不删，保住上一代离线外壳总比清空强。
      const pair = await activePair()
      if (pair) {
        const keep = new Set([pair.shell, pair.assets, META_CACHE])
        const names = await caches.keys()
        await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)))
      }
      await self.clients.claim()
    })(),
  )
})

/* ------------------------------------------------------------------ fetch */
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // ① /api/** 一律直连网络，绝不缓存（缓存会导致看到过期数据）
  if (url.pathname.startsWith('/api/')) return

  // ② 构建产物 /assets/*（带内容哈希）：cache-first，命中即返回，永不失效
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const pair = await activePair()
        if (pair) {
          const cached = await (await caches.open(pair.assets)).match(request, { ignoreSearch: true })
          if (cached) return cached
        }
        const res = await fetch(request)
        if (res.ok && pair) (await caches.open(pair.assets)).put(request, res.clone())
        return res
      })(),
    )
    return
  }

  // ③ 页面导航（index.html）：network-first，失败回落缓存，再回落「当前离线」页
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      (async () => {
        const pair = await activePair()
        try {
          const res = await fetch(request)
          if (res && res.ok && pair) {
            const shell = await caches.open(pair.shell)
            await shell.put('/', res.clone())
          }
          return res
        } catch (err) {
          if (pair) {
            const cached = await (await caches.open(pair.shell)).match('/')
            if (cached) return cached
          }
          const offline = await caches.match(OFFLINE_URL)
          if (offline) return offline
          return new Response('当前离线', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        }
      })(),
    )
    return
  }

  // ④ 其它同源静态资源（图标 / manifest / favicon）：cache-first + 回填
  event.respondWith(
    (async () => {
      const pair = await activePair()
      const shell = pair ? await caches.open(pair.shell) : null
      const cached = shell ? await shell.match(request) : null
      if (cached) return cached
      try {
        const res = await fetch(request)
        if (res.ok && shell) shell.put(request, res.clone())
        return res
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' })
      }
    })(),
  )
})
