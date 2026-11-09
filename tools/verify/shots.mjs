/**
 * 用真实应用截 9 张手册插图（docs/images 里丢失的 9 张）。
 * 用法：node shots.mjs --base http://127.0.0.1:8090 --out ../../docs/images
 */
import { launch } from './cdp.mjs'
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:8090')
const OUT = resolve(arg('--out', '../../docs/images'))
const USER = arg('--user', 'demo')
const PASS = arg('--pass', 'DemoPass123!')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shots = []

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

async function shoot(page, name) {
  const path = join(OUT, name)
  await sleep(350)
  await page.screenshot(path)
  const kb = Math.round(statSync(path).size / 1024)
  const size = await page.eval('({ w: window.innerWidth, h: window.innerHeight })')
  shots.push({ name, w: size.w, h: size.h, kb })
  console.log('  shot ' + name + '  ' + size.w + 'x' + size.h + '  ' + kb + 'KB')
}

async function goto(page, hash) {
  await page.eval('location.hash = ' + JSON.stringify(hash))
  await sleep(500)
}

async function main() {
  const b = await launch()
  const page = await b.newPage(BASE + '/')
  try {
    await page.waitForLoad()
    await page.setViewport(1440, 900)

    /* 1) 登录页（未登录） */
    await page.waitFor("document.querySelector('.kb-login') !== null", { timeout: 20000 })
    await sleep(400)
    await shoot(page, '02-登录页.png')

    /* 登录 */
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
    await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 20000 })
    await sleep(700)

    /* 打开一篇有反链的笔记 */
    const opened = await page.eval([
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
    if (!opened) throw new Error('侧栏里找不到「双向链接演示（A）」')
    await page.waitFor("document.querySelector('.cm-content') !== null", { timeout: 20000 })
    await sleep(600)

    /* 2) [[ 触发候选下拉 */
    await page.click('.cm-content')
    await sleep(200)
    await page.press('End', { ctrl: true })
    await page.press('Enter')
    await page.type('[[')
    await page.waitFor("document.querySelector('.cm-tooltip-autocomplete li') !== null", { timeout: 10000 })
    await sleep(500)
    await shoot(page, '06-输入两个方括号弹出候选.png')
    await page.press('Escape')

    /* 3) 反链 */
    await goto(page, '#/backlinks')
    await sleep(900)
    await shoot(page, '09-反向链接.png')

    /* 4) 导入导出 */
    await goto(page, '#/io')
    await sleep(900)
    await shoot(page, '12-导入导出.png')

    /* 5) 统计 */
    await goto(page, '#/stats')
    await sleep(1000)
    await shoot(page, '13-统计.png')

    /* 6) 深色主题 */
    await goto(page, '#/notes')
    await sleep(700)
    await page.click('[aria-label="切换到深色主题"]')
    await sleep(900)
    await shoot(page, '15-深色主题.png')

    /* 7) 手机：侧栏抽屉 */
    await page.setViewport(390, 844)
    await sleep(800)
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
    await sleep(1000)
    await shoot(page, '17-手机-侧栏抽屉.png')

    /* 8) 手机：搜索 */
    await page.eval('document.body.click()')
    await sleep(300)
    await goto(page, '#/search')
    await sleep(1000)
    await shoot(page, '18-手机-搜索.png')

    /* 9) 平板：编辑器 */
    await page.setViewport(900, 700)
    await sleep(700)
    await goto(page, '#/notes')
    await page.waitFor("document.querySelector('.cm-content') !== null", { timeout: 15000 })
    await sleep(900)
    await shoot(page, '19-平板-编辑器.png')

    writeFileSync(join(OUT, '..', 'shots-report.json'), JSON.stringify(shots, null, 2))
    console.log('\\nRESULT ' + shots.length + ' 张')
    for (const s of shots) console.log('  ' + s.name + '  ' + s.w + 'x' + s.h + '  ' + s.kb + 'KB')
  } finally {
    await b.close()
  }
}

await main().catch((e) => {
  console.error('SHOTS FAILED:', e && e.message ? e.message : e)
  process.exitCode = 1
})
