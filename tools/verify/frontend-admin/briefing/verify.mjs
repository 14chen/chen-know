/**
 * 简报视图验收驱动（CDP）。用法：node verify.mjs [--base http://localhost:5210]
 * 覆盖契约 §9 的前端项 10–13。
 */
import { Browser } from '../../../../frontend/src/editor/lab/cdp.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = (() => {
  const i = process.argv.indexOf('--base')
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'http://localhost:5210'
})()
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url))
const MOCK = 'http://127.0.0.1:8899'

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra: String(extra).slice(0, 300) })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   >> ' + String(extra).slice(0, 300)))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function scenario(body) {
  await fetch(MOCK + '/__scenario', { method: 'POST', body: JSON.stringify(body) })
}

async function run() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await Browser.launch({})
  const page = await browser.newPage(BASE + '/index.html')
  const b = (expr) => page.eval(expr)
  const text = () => b('window.__B.text()')
  const count = (sel) => b('window.__B.count(' + JSON.stringify(sel) + ')')
  const calls = () => b('JSON.parse(JSON.stringify(window.__B.calls))')
  const clickText = (t) => b('window.__B.clickText(' + JSON.stringify(t) + ')')
  const resetCalls = () => b('(() => { const c = window.__B.calls; c.toasts.length = 0; c.opened.length = 0; c.navigated.length = 0; c.refreshNotes = 0; c.refreshTree = 0; return true })()')

  try {
    await page.waitFor('window.__B && window.__B.ready === true', { timeout: 60000 })
    await page.setViewport(1280, 900)

    /* ---------- 加载态（mock 延迟 1200ms） ---------- */
    await scenario({ mode: 'ok', reportShape: 'string' })
    await b('window.__B.mount()')
    const skeletonSeen = await count('.kb-skeleton')
    check('加载态：挂载瞬间出现骨架屏', skeletonSeen > 0, 'skeleton=' + skeletonSeen)
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    check('加载态：数据到达后渲染两张表', (await count('.vw-brief__table')) === 2)

    /* ---------- 源状态表（11） ---------- */
    const links = await b('JSON.parse(JSON.stringify(window.__B.links()))')
    const urls = links.map((l) => l.href)
    check('源状态表：4 条源全部渲染', (await count('.vw-brief__table tbody tr')) >= 4, JSON.stringify(urls))
    check(
      '源状态表：链接可点且目标正确（新窗口 + noopener）',
      links.length === 4 &&
        links.every((l) => /^https:\/\//.test(l.href) && l.target === '_blank' && /noopener/.test(String(l.rel))),
      JSON.stringify(links.slice(0, 2)),
    )
    check(
      '源状态表：三种类型都有中文标签',
      /RSS/.test(await text()) && /HTML/.test(await text()) && /JSON/.test(await text()),
      (await text()).slice(0, 120),
    )
    check('源状态表：暴露最近一次每源状态（含失败源）', (await count('.vw-brief__table tbody tr')) >= 4 && /未取到/.test(await text()), (await text()).replace(/\n/g, ' | ').slice(0, 240))

    /* ---------- 运行历史（12）+ 跳转 ---------- */
    check('运行历史：渲染已有的 2 次运行', (await text()).includes('部分成功') && (await text()).includes('成功'), (await text()).replace(/\n/g, ' | ').slice(0, 200))
    await resetCalls()
    const openedViaHistory = await b(`(() => {
      const rows = Array.from(document.querySelectorAll('.vw-brief__table'))[1].querySelectorAll('tbody tr')
      const btn = Array.from(rows[0].querySelectorAll('button')).find((x) => x.textContent.trim() === '打开简报')
      if (!btn) return false
      btn.click()
      return true
    })()`)
    const afterHistory = await calls()
    check('运行历史：点「打开简报」调用 ctx.openNote(3)', openedViaHistory === true && JSON.stringify(afterHistory.opened) === '[3]', JSON.stringify(afterHistory.opened))

    /* ---------- 立即生成（10） ---------- */
    await scenario({ mode: 'ok', reportShape: 'string' })
    await b('window.__B.mount()')
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    await resetCalls()
    await clickText('立即生成简报')
    await page.waitFor("document.querySelectorAll('.vw-brief__result').length === 1", { timeout: 20000 })
    await page.waitFor("(document.querySelector('.vw-brief__result')?.innerText || '').includes('新内容')", { timeout: 10000 })
    const resultText = await b("document.querySelector('.vw-brief__result')?.innerText ?? ''")
    check('立即生成：回显「新内容 N 条 / 共检查 M 条」', /新内容\s*7\s*条/.test(resultText) && /共检查\s*42\s*条/.test(resultText.replace(/\s+/g, ' ')), resultText.replace(/\n/g, ' | '))
    const genCalls = await calls()
    check('立即生成：成功 toast + 历史刷新后能看到新 run', genCalls.toasts.some((t) => t[0] === 'success' && /新内容 7 条/.test(t[1])), JSON.stringify(genCalls.toasts))
    await page.waitFor("(document.querySelectorAll('.vw-brief__table')[1]?.querySelectorAll('tbody tr').length ?? 0) === 3", { timeout: 10000 })
    const historyText = await b("(Array.from(document.querySelectorAll('.vw-brief__table'))[1]?.innerText) ?? ''")
    check('立即生成：新 run 出现在历史里（3 条）', (historyText.match(/打开简报/g) || []).length >= 3, historyText.replace(/\n/g, ' | ').slice(0, 200))
    await resetCalls()
    await clickText('打开简报')
    check('立即生成：结果区的「打开简报」跳到 noteId=3', JSON.stringify((await calls()).opened) === '[3]', JSON.stringify((await calls()).opened))

    /* ---------- sourceReport 两种形状 ---------- */
    await scenario({ mode: 'ok', reportShape: 'array' })
    await b('window.__B.mount()')
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    check('sourceReport 是数组时也能解析（页面未崩）', (await count('.vw-brief__table')) === 2 && /未取到/.test(await text()))
    const unit = await b("JSON.parse(JSON.stringify([window.__B.parseSourceReport('[]'), window.__B.parseSourceReport([{source:'a',ok:false,count:0,error:'x'}]), window.__B.parseSourceReport('not json'), window.__B.parseSourceReport(null)]))")
    check('parseSourceReport：空数组/数组/坏 JSON/null 都安全', unit[0].length === 0 && unit[1].length === 1 && unit[1][0].ok === false && unit[2].length === 0 && unit[3].length === 0, JSON.stringify(unit))

    /* ---------- 空态 ---------- */
    await scenario({ mode: 'empty' })
    await b('window.__B.mount()')
    await page.waitFor("document.body.innerText.includes('还没有生成过简报')", { timeout: 15000 })
    const emptyText = await text()
    check('空态：没有运行记录时给出引导', /还没有生成过简报/.test(emptyText) && /立即生成简报/.test(emptyText), emptyText.replace(/\n/g, ' | ').slice(0, 220))
    await page.screenshot(SHOTS + 'briefing-empty.png')

    /* ---------- 错误态 + 重试 ---------- */
    await scenario({ mode: 'error' })
    await b('window.__B.mount()')
    await page.waitFor("Array.from(document.querySelectorAll('button')).some((x) => x.textContent.trim() === '重试')", { timeout: 15000 })
    check('错误态：展示失败提示 + 重试按钮', /加载失败/.test(await text()), (await text()).replace(/\n/g, ' | ').slice(0, 200))
    await scenario({ mode: 'ok' })
    await clickText('重试')
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    check('错误态：点重试后恢复', (await count('.vw-brief__table')) === 2)

    /* ---------- 409 并发保护 ---------- */
    await scenario({ mode: 'conflict' })
    await b('window.__B.mount()')
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    await resetCalls()
    await clickText('立即生成简报')
    await page.waitFor("window.__B.calls.toasts.length > 0", { timeout: 10000 })
    check('409 并发：给出 warn 提示而不是错误', JSON.stringify((await calls()).toasts.map((t) => t[0])) === '["warn"]', JSON.stringify((await calls()).toasts))

    /* ---------- 四断点 ---------- */
    await scenario({ mode: 'ok' })
    await b('window.__B.mount()')
    await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2", { timeout: 15000 })
    await clickText('立即生成简报')
    await page.waitFor("document.querySelectorAll('.vw-brief__result').length === 1", { timeout: 20000 })
    for (const size of [
      { name: 'desktop-1440', w: 1440, h: 900 },
      { name: 'laptop-1180', w: 1180, h: 800 },
      { name: 'tablet-900', w: 900, h: 700 },
      { name: 'phone-390', w: 390, h: 844 },
    ]) {
      await page.setViewport(size.w, size.h)
      await sleep(320)
      // 截图前等界面回到稳定态（避免拍到「正在生成…」的骨架）
      await page.waitFor("document.querySelectorAll('.vw-brief__table').length === 2 && document.querySelectorAll('.vw-brief__result').length === 1", { timeout: 15000 })
      await sleep(200)
      const ov = await b('JSON.parse(JSON.stringify(window.__B.overflow()))')
      check('#' + size.w + '×' + size.h + '：无横向溢出', ov.docScroll <= ov.docClient, JSON.stringify(ov))
      const btn = await b("JSON.parse(JSON.stringify(window.__B.rects('.vw-brief__actions .kb-btn')))")
      check('#' + size.w + '：按钮可见', Array.isArray(btn) && btn.length === 2 && btn.every((r) => r.w > 0 && r.h > 0), JSON.stringify(btn))
      await page.screenshot(SHOTS + 'briefing-' + size.name + '.png')
    }

    /* ---------- 触摸设备 44px（真实模拟 pointer: coarse） ---------- */
    await page.setViewport(390, 844)
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await sleep(400)
    const coarse = await b("matchMedia('(pointer: coarse)').matches")
    check('390×844 触摸模拟：pointer: coarse 生效', coarse === true, 'coarse=' + coarse)
    const touchBtns = await b("JSON.parse(JSON.stringify(window.__B.rects('.vw-brief__actions .kb-btn')))")
    check('触摸设备：操作按钮高度 ≥44px', Array.isArray(touchBtns) && touchBtns.length === 2 && touchBtns.every((r) => r.h >= 44), JSON.stringify(touchBtns))
    const historyBtn = await b("JSON.parse(JSON.stringify(window.__B.rects('.vw-brief__table button')))")
    check('触摸设备：表格内「打开简报」≥44px', historyBtn.length >= 1 && historyBtn.every((r) => r.h >= 44), JSON.stringify(historyBtn.slice(0, 3)))
    await page.screenshot(SHOTS + 'briefing-phone-390-coarse.png')
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await sleep(150)

    const pageErrors = await b('JSON.parse(JSON.stringify(window.__B.errors))')
    check('全局：无 console 错误 / 未捕获异常', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 300))
  } finally {
    await browser.close()
  }

  const passed = results.filter((r) => r.ok).length
  const lines = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '   >> ' + r.extra))
  lines.push('', 'RESULT passed ' + passed + '/' + results.length)
  if (passed !== results.length) {
    lines.push('FAILED:')
    for (const r of results.filter((x) => !x.ok)) lines.push('  - ' + r.name + ' >> ' + r.extra)
  }
  writeFileSync(SHOTS + '../result.txt', lines.join('\n') + '\n')
  console.log(lines.join('\n'))
  // 用 exitCode 而不是 process.exit：避免 stdout 缓冲在退出时丢失
  process.exitCode = passed === results.length ? 0 : 1
}

await run().catch((err) => {
  writeFileSync(SHOTS + '../result.txt', 'DRIVER ERROR: ' + String(err && err.stack ? err.stack : err) + '\n')
  console.error('DRIVER ERROR:', err)
  process.exitCode = 1
})
