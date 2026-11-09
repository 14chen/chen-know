/**
 * 选区可见性验收：只验 --selection-bg 是否真的让选区「一眼可见」。
 *   node src/editor/lab/verify-selection.mjs [labUrl]
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Browser, sleep } from './cdp.mjs'

const LAB = process.argv[2] ?? 'http://localhost:5199/editor-lab.html'
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

/** "rgba(79, 70, 229, 0.35)" / "color(srgb 0.23 0.42 0.96 / 0.3)" / "rgb(199, 210, 254)" → alpha */
function alphaOf(color) {
  if (!color) return 0
  // 现代 color() 写法：color(srgb r g b / a)
  const modern = color.match(/^color\([^/]+\/\s*([\d.]+)\s*\)$/)
  if (modern) return parseFloat(modern[1])
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (!m) return 0
  const parts = m[1].split(/[,/]/).map((s) => parseFloat(s.trim()))
  if (parts.length >= 4) return parts[3]
  return parts.slice(0, 3).every((p) => p === 0) ? 0 : 1
}

const probe = (page) =>
  page.eval(`(() => {
    const sel = document.querySelector('.cm-selectionBackground')
    const cs = sel ? getComputedStyle(sel) : null
    const token = getComputedStyle(document.documentElement).getPropertyValue('--selection-bg').trim()
    const accentSoft = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim()
    const contentBg = getComputedStyle(document.querySelector('.cm-content')).backgroundColor
    return {
      theme: document.documentElement.dataset.theme,
      hasSelectionLayer: !!sel,
      selectionBg: cs ? cs.backgroundColor : null,
      token: token || null,
      accentSoft: accentSoft || null,
      contentBg,
      rect: sel ? sel.getBoundingClientRect().toJSON() : null,
    }
  })()`)

await mkdir(SHOTS, { recursive: true })
const browser = await Browser.launch({ width: 1280, height: 900 })
const page = await browser.newPage(LAB)
try {
  await page.waitFor('!!window.__lab', { timeout: 30000 })
  await page.waitFor("!!document.querySelector('.cm-content')", { timeout: 30000 })
  await sleep(500)

  await page.eval(`window.__lab.setText(${JSON.stringify(
    '这一整段文字用来观察选区效果。选中以后底色必须一眼可见，\n不能只是极淡的一层，否则用户会以为没选中。\n第三行作为对照（不被选中）。',
  )})`)
  await sleep(400)
  // 选中前两行
  await page.eval(`window.__lab.setSelection(0, ${'这一整段文字用来观察选区效果。选中以后底色必须一眼可见，\n不能只是极淡的一层，否则用户会以为没选中。'.length})`)
  await sleep(500)

  const light = await probe(page)
  console.log(`\n[浅色] ${JSON.stringify(light)}`)
  check('浅色：存在选区图层 .cm-selectionBackground', light.hasSelectionLayer === true)
  check('浅色：--selection-bg token 已定义', !!light.token, light.token ?? '（未定义 → 回落到透明）')
  check(
    '浅色：选区 backgroundColor 不是 rgba(0, 0, 0, 0)',
    light.selectionBg !== 'rgba(0, 0, 0, 0)',
    light.selectionBg,
  )
  check(
    '浅色：选区 alpha ≥ 0.25',
    alphaOf(light.selectionBg) >= 0.25,
    `alpha=${alphaOf(light.selectionBg)}`,
  )
  await page.screenshot(join(SHOTS, 's01-selection-light.png'))

  await page.eval("window.__lab.theme('dark')")
  await sleep(700)
  await page.eval(`window.__lab.setSelection(0, 20)`)
  await sleep(400)
  const dark = await probe(page)
  console.log(`\n[深色] ${JSON.stringify(dark)}`)
  check('深色：选区 backgroundColor 不是 rgba(0, 0, 0, 0)', dark.selectionBg !== 'rgba(0, 0, 0, 0)', dark.selectionBg)
  check('深色：选区 alpha ≥ 0.25', alphaOf(dark.selectionBg) >= 0.25, `alpha=${alphaOf(dark.selectionBg)}`)
  await page.screenshot(join(SHOTS, 's02-selection-dark.png'))

  await page.eval("window.__lab.theme('light')")
} finally {
  await browser.close()
}

console.log(`\n===== 选区验收：${passed} 项通过，${failures.length} 项失败 =====`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exitCode = 1
}
