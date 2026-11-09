/**
 * 用真实应用截一张手册插图（每次进程只拍一张：V8/Edge 在这种机器上偶发 OOM，单张失败不影响其它）
 * 用法：node shot-one.mjs --name 02-登录页 --base http://127.0.0.1:8090 --out ../../docs/images
 */
import { launch } from './cdp.mjs'
import { statSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const NAME = arg('--name', '')
const BASE = arg('--base', 'http://127.0.0.1:8090')
const OUT = resolve(arg('--out', '../../docs/images'))
const USER = arg('--user', 'demo')
const PASS = arg('--pass', 'DemoPass123!')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!NAME) { console.error("缺少 --name"); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const DESKTOP = [1440, 900]
const PHONE = [390, 844]
const TABLET = [900, 700]

async function login(page) {
  await page.waitForLoad()
  await page.waitFor("document.querySelector('.kb-login') !== null", { timeout: 25000 })
  const fill = [
    "(() => {",
    "  const u = document.querySelector('input[name=\"username\"]')",
    "  const p = document.querySelector('input[name=\"password\"]')",
    "  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set",
    "  setter.call(u, " + JSON.stringify(USER) + "); u.dispatchEvent(new Event('input', { bubbles: true }))",
    "  setter.call(p, " + JSON.stringify(PASS) + "); p.dispatchEvent(new Event('input', { bubbles: true }))",
    "  return true",
    "})()",
  ].join('\n')
  await page.eval(fill)
  await page.click('button[type="submit"]')
  await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 25000 })
  await sleep(700)
}

async function openNoteA(page) {
  const ok = await page.eval([
    "(() => {",
    "  const want = '双向链接演示（A）'",
    "  const nodes = Array.from(document.querySelectorAll('.kb-sidebar *'))",
    "    .filter((el) => (el.textContent || '').trim() === want && el.children.length === 0)",
    "  const target = nodes[0]",
    "  if (!target) return false",
    "  ;(target.closest('button, [role=button], .kb-tree-row__main, li, div') || target).click()",
    "  return true",
    "})()",
  ].join('\n'))
  if (!ok) throw new Error('侧栏里找不到「双向链接演示（A）」')
  await page.waitFor("document.querySelector('.cm-content') !== null", { timeout: 25000 })
  await sleep(700)
}

async function goto(page, hash) {
  await page.eval('location.hash = ' + JSON.stringify(hash))
  await sleep(700)
}

const STEPS = {
  "02-登录页": async (page) => {
    await page.waitForLoad()
    await page.waitFor("document.querySelector('.kb-login') !== null", { timeout: 25000 })
    await sleep(500)
  },
  "06-输入两个方括号弹出候选": async (page) => {
    await login(page)
    await openNoteA(page)
    await page.click('.cm-content')
    await sleep(250)
    await page.press('Enter')
    await page.type('[[')
    await page.waitFor("document.querySelector('.cm-tooltip-autocomplete li') !== null", { timeout: 12000 })
    await sleep(600)
  },
  "09-反向链接": async (page) => {
    await login(page)
    await openNoteA(page)
    await goto(page, '#/backlinks')
    await sleep(1000)
  },
  "12-导入导出": async (page) => {
    await login(page)
    await goto(page, '#/io')
    await sleep(1100)
  },
  "13-统计": async (page) => {
    await login(page)
    await goto(page, '#/stats')
    await sleep(1300)
  },
  "15-深色主题": async (page) => {
    await login(page)
    await openNoteA(page)
    await page.click('[aria-label=\"切换到深色主题\"]')
    await sleep(1100)
  },
  "17-手机-侧栏抽屉": async (page) => {
    await login(page)
    await page.setViewport(390, 844)
    await sleep(900)
    const menu = await page.eval([
      "(() => {",
      "  const btn = Array.from(document.querySelectorAll('[aria-label]'))",
      "    .find((el) => /侧栏|展开左栏|菜单/.test(el.getAttribute('aria-label') || ''))",
      "  if (!btn) return null",
      "  const r = btn.getBoundingClientRect()",
      "  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }",
      "})()",
    ].join('\n'))
    if (!menu) throw new Error('手机上找不到侧栏/菜单按钮')
    await page.clickAt(menu.x, menu.y)
    await sleep(1100)
  },
  "18-手机-搜索": async (page) => {
    await login(page)
    await page.setViewport(390, 844)
    await sleep(600)
    await goto(page, '#/search')
    await sleep(1200)
  },
  "19-平板-编辑器": async (page) => {
    await login(page)
    await page.setViewport(900, 700)
    await sleep(700)
    await openNoteA(page)
    await sleep(900)
  },
}

const step = STEPS[NAME]
if (!step) { console.error("未知的 --name: " + NAME + "（可选: " + Object.keys(STEPS).join(
) + "）"); process.exit(2) }

const VIEWPORT = NAME.startsWith("17") || NAME.startsWith("18") ? PHONE : NAME.startsWith("19") ? TABLET : DESKTOP

const b = await launch()
const page = await b.newPage(BASE + "/")
try {
  await page.setViewport(VIEWPORT[0], VIEWPORT[1])
  await step(page)
  const path = join(OUT, NAME + ".png")
  await page.screenshot(path)
  const kb = Math.round(statSync(path).size / 1024)
  const size = await page.eval('({ w: window.innerWidth, h: window.innerHeight })')
  console.log('OK ' + NAME + '.png  ' + size.w + 'x' + size.h + '  ' + kb + 'KB')
} finally {
  await b.close()
}
