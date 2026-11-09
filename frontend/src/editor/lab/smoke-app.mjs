/**
 * 集成冒烟：在 p-shell 的**真实外壳**里验证编辑器组件（真后端 8080，经 vite 反代）。
 *   node src/editor/lab/smoke-app.mjs                    # 只读（默认）：不写用户数据
 *   node src/editor/lab/smoke-app.mjs --allow-write      # 敲字测试 + Ctrl+Z 还原 + 服务端比对
 *
 * 注意：真实外壳会自动保存，任何敲进去的字都会落到真后端 —— 所以默认只读。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Browser, sleep } from './cdp.mjs'

const APP_URL = process.argv[2] ?? 'http://localhost:5173/proto/'
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots')

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures.push(name)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const browser = await Browser.launch({ width: 1440, height: 900 })
const page = await browser.newPage(APP_URL)
try {
  await page.setViewport(1440, 900)
  await sleep(2500)
  console.log(`  · URL: ${await page.eval('location.href')}`)

  /* 登录 */
  const loginState = await page.eval(`(() => {
    const inputs = [...document.querySelectorAll('input')]
    return { inputs: inputs.length, buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 8) }
  })()`)
  console.log(`  · 登录页输入框 ${loginState.inputs} 个，按钮 ${JSON.stringify(loginState.buttons)}`)
  if (loginState.inputs >= 2) {
    await page.eval(`(() => {
      const inputs = [...document.querySelectorAll('input')]
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(inputs[0], 'demo')
      set(inputs[1], 'DemoPass123!')
      return true
    })()`)
    await sleep(200)
    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /登录|登陆|进入/.test(b.textContent))
      if (btn) { btn.click(); return true }
      const form = document.querySelector('form')
      if (form) { form.requestSubmit(); return true }
      return false
    })()`)
    await sleep(2500)
  }

  const afterLogin = await page.eval(`({
    url: location.href,
    hasEditor: !!document.querySelector('.cm-editor'),
    body: document.body.innerText.slice(0, 160).replace(/\\n+/g, ' | '),
  })`)
  console.log(`  · 登录后：${JSON.stringify(afterLogin)}`)
  check('登录后进入应用（hash 路由离开登录页）', !/登录/.test(afterLogin.body) || afterLogin.hasEditor, afterLogin.url)

  /* 打开一篇演示笔记（优先「中文排版测试」） */
  const opened = await page.eval(`(() => {
    const items = [...document.querySelectorAll('.kb-note-item')]
    const target =
      items.find((el) => /中文排版测试/.test(el.textContent || '')) ??
      items.find((el) => /长文档性能测试/.test(el.textContent || ''))
    if (!target) return { clicked: false, items: items.length }
    target.click()
    return { clicked: true, items: items.length, label: target.textContent.trim().slice(0, 30) }
  })()`)
  await sleep(2500)
  check('能从列表打开演示笔记', opened.clicked === true, JSON.stringify(opened))
  const editorUp = await page.eval(`!!document.querySelector('.cm-editor .cm-content')`)
  check('编辑器在真实外壳里挂载', editorUp === true)
  const doc = await page.eval(`(() => {
    const content = document.querySelector('.cm-content')
    return content ? content.innerText.slice(0, 120) : null
  })()`)
  const chars = await page.eval(`document.querySelector('.cm-content')?.innerText?.length ?? -1`)
  console.log(`  · 编辑器可见文本（前 120 字）：${JSON.stringify(doc)}`)
  check('笔记正文已载入编辑器', chars > 20, `${chars} 字符`)
  const residue = await page.eval(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')]
    return lines
      .filter((el) => !el.classList.contains('cm-kb-src') && !el.classList.contains('cm-kb-code'))
      .filter((el) => !el.querySelector('.cm-kb-code-inline'))
      .map((el) => el.innerText)
      .filter((t) => t.includes('**') || t.includes(']('))
  })()`)
  check(
    '渲染生效：非当前行 / 非代码块的可见文本里没有 ** 或 ]( 残留',
    Array.isArray(residue) && residue.length === 0,
    JSON.stringify(residue),
  )

  /* 可编辑性：默认**不写入真笔记**（外壳会自动保存，会污染演示数据）。
     需要真的敲字时加 --allow-write：脚本会先记下服务端正文，敲字后 Ctrl+Z 撤销，
     再比对服务端正文是否回到原样，不留残渣。 */
  const allowWrite = process.argv.includes('--allow-write')
  const editable = await page.eval(`document.querySelector('.cm-content').contentEditable === 'true'`)
  check('编辑器在真实外壳里是可编辑状态', editable === true)
  if (allowWrite) {
    const noteId = await page.eval(`(location.hash.match(/notes\\/(\\d+)/) || [])[1] ?? null`)
    const readNote = `(async () => ((await (await fetch('/api/notes/${noteId}')).json()).content ?? null))()`
    const before = await page.eval(readNote)
    const clickPoint = await page.eval(`(() => {
      const r = document.querySelector('.cm-content').getBoundingClientRect()
      return { x: r.x + 40, y: r.y + 30 }
    })()`)
    await page.click(clickPoint.x, clickPoint.y)
    await sleep(300)
    await page.insertText('【冒烟测试】')
    await sleep(600)
    const typed = await page.eval(`document.querySelector('.cm-content').innerText.includes('【冒烟测试】')`)
    check('在真实外壳里可以输入中文（--allow-write）', typed === true)
    await page.combo('z', 2)
    await sleep(2500)
    const after = await page.eval(readNote)
    check(
      '输入后已 Ctrl+Z 撤销，服务端正文回到原样（不留残渣）',
      after === before,
      `before=${before?.length} 字符 after=${after?.length} 字符`,
    )
  } else {
    console.log('  · 跳过「真实敲字」步骤（默认不写真笔记；需要时加 --allow-write）')
  }

  /* 主题跟随 <html data-theme>（浅色/深色各截一张） */
  await page.screenshot(join(SHOTS, '08-real-app-light.png'))
  const themes = await page.eval(`(async () => {
    const before = getComputedStyle(document.querySelector('.cm-content')).color
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /主题/.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')),
    )
    if (!btn) return { before, skipped: true }
    btn.click()
    await new Promise((r) => setTimeout(r, 700))
    const after = getComputedStyle(document.querySelector('.cm-content')).color
    return { before, after, theme: document.documentElement.dataset.theme, skipped: false }
  })()`)
  console.log(`  · 主题切换：${JSON.stringify(themes)}`)
  check('切换主题后编辑器文字颜色跟随变化', themes.skipped || themes.before !== themes.after, JSON.stringify(themes))
  await sleep(400)
  await page.screenshot(join(SHOTS, '09-real-app-dark.png'))
  console.log(`  · 截图：shots/08-real-app-light.png · shots/09-real-app-dark.png`)

  const errors = await page.eval(`window.__labErrors ?? 0`)
  check('页面无未捕获异常', errors === 0, `errors=${errors}`)
  check('CDP 控制台无错误', page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors.slice(0, 3)))
} finally {
  await browser.close()
}

console.log(`\n===== 集成冒烟：${passed} 项通过，${failures.length} 项失败 =====`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exitCode = 1
}
