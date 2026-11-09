/* 搜索筛选 + 速览 + 附件体检 验收（真实后端 + 构建产物）。 */
import { launch } from './cdp.mjs'
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:8096')
const API = arg('--api', 'http://127.0.0.1:8095')
const DATA = arg('--data', '')
const SHOTS = fileURLToPath(new URL('./ui-shots/', import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra: String(extra === undefined ? '' : extra).slice(0, 400) }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   >> ' + String(extra).slice(0, 400))) }
mkdirSync(SHOTS, { recursive: true })

/* ---------- 准备数据：登录 + 造含「权限/鉴权」的笔记 + 造一条断链附件 ---------- */
let cookie = ''
const apiFetch = (path, opts) => fetch(API + path, { ...(opts || {}), headers: { ...((opts && opts.headers) || {}), cookie } })
const loginRes = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }) })
cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0]
check('准备：登录实例', loginRes.status === 200 && cookie.length > 0, 'status=' + loginRes.status)

async function createNote(title, content) {
  const res = await apiFetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, content }) })
  return await res.json()
}
const stamp = String(Date.now()).slice(-5)
const n1 = await createNote('QA-权限-甲-' + stamp, '这一篇讲权限模型：角色、权限点与鉴权链路。\n\n权限校验发生在服务端，鉴权失败返回 401。')
const n2 = await createNote('QA-鉴权-乙-' + stamp, '鉴权实践笔记：会话 Cookie、KB_SESSION 与过期策略。\n\n权限与鉴权是两件事，别混。')
check('准备：造了 2 篇含「权限/鉴权」的笔记', !!n1.id && !!n2.id, JSON.stringify([n1.id, n2.id]))

/* 传一张图到长文档笔记，再删掉磁盘文件 → 造出断链 */
const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const form = new FormData()
form.append('file', new Blob([pngBytes], { type: 'image/png' }), '技能测试1.png')
form.append('noteId', '6')
const upRes = await apiFetch('/api/attachments', { method: 'POST', body: form })
const uploaded = await upRes.json()
check('准备：上传一张附件到笔记 6', upRes.status < 300 && !!uploaded.id, 'status=' + upRes.status + ' ' + JSON.stringify(uploaded))
let deletedFile = ''
if (DATA) {
  // 布局是 uploads/<spaceId>/<uuid>.<ext>：递归找最新的那个文件删掉，造出断链
  const root = join(DATA, 'uploads')
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else found.push({ full, t: statSync(full).mtimeMs })
    }
  }
  walk(root)
  found.sort((a, b) => b.t - a.t)
  if (found.length) {
    unlinkSync(found[0].full)
    deletedFile = found[0].full.slice(root.length + 1)
  }
}
check('准备：删掉磁盘文件造出 1 条断链', deletedFile.length > 0, 'deleted=' + deletedFile)

const browser = await launch()
const page = await browser.newPage(BASE + '/')
const ev = (e) => page.eval(e)

async function loginUi() {
  await page.waitForLoad()
  await page.waitFor("document.querySelector('.kb-login') !== null || document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  if (!(await ev("document.querySelector('.kb-login') !== null"))) return
  await ev('(function(){var u=document.querySelector("input[name=username]");var p=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(p,"DemoPass123!");p.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
  await page.click('button[type="submit"]')
  await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  await sleep(800)
}

try {
  await page.setViewport(1440, 900)
  await loginUi()

  /* ---------- A. 搜索筛选 ---------- */
  const totals = {}
  const search = async (hash, waitText) => {
    await ev('location.hash = ' + JSON.stringify(hash))
    await page.waitFor('document.querySelector(".vw__count") !== null || document.querySelector(".vw-state") !== null', { timeout: 25000 })
    await sleep(900)
    const txt = await ev('document.querySelector(".vw__count") ? document.querySelector(".vw__count").innerText : ""')
    if (waitText) await sleep(200)
    return txt;
  };
  const t0 = await search('#/search?q=' + encodeURIComponent('权限'));
  totals.base = t0;
  check('搜索：先有关键词结果', /共 \d+ 条/.test(t0), t0)
  const t1 = await search('#/search?q=' + encodeURIComponent('权限') + '&folderId=0');
  totals.folder = t1;
  check('搜索：加目录筛选（未分类）后仍可用', /共 \d+ 条/.test(t1) && /已筛选/.test(t1), t1)
  const tagList = await ev('fetch("/api/tags").then(function(r){return r.json()}).then(function(a){return a.length ? String(a[0].id) : ""})')
  const t2 = tagList ? await search('#/search?q=' + encodeURIComponent('权限') + '&tagId=' + tagList) : '';
  totals.tag = t2;
  check('搜索：加标签筛选后仍可用（带 tagId）', !tagList || (/共 \d+ 条/.test(t2) && /已筛选/.test(t2)), 'tagId=' + tagList + ' ' + t2)
  const t3 = await search('#/search?q=' + encodeURIComponent('权限') + '&from=2020-01-01&to=2030-12-31');
  totals.date = t3;
  check('搜索：日期范围筛选后仍可用', /共 \d+ 条/.test(t3) && /已筛选/.test(t3), t3)
  console.log('      四个数字: 无筛选=' + totals.base + ' | 目录=' + totals.folder + ' | 标签=' + totals.tag + ' | 日期=' + totals.date)

  /* snippet 渲染 */
  const snippet = await ev('(function(){var el=document.querySelector(".vw-search-snippet");if(!el)return JSON.stringify({found:false});return JSON.stringify({found:true,text:el.textContent,strongs:el.querySelectorAll("strong").length,strongText:Array.prototype.map.call(el.querySelectorAll("strong"),function(s){return s.textContent}).join("|"),innerHTMLHasTags:el.innerHTML.indexOf("<em>")>=0})})()')
  const sn = JSON.parse(snippet)
  check('snippet：结果里出现纯文本片段', sn.found === true, snippet)
  check('snippet：命中词用 <strong> 加粗（不是 innerHTML）', sn.strongs >= 1 && /权限|鉴权/.test(sn.strongText), snippet)
  await page.screenshot(join(SHOTS, 'search-snippet-1440.png'))

  /* URL 状态 + 刷新复现 */
  await ev('location.hash = "#/search?q=' + encodeURIComponent('权限') + '&folderId=0&from=2020-01-01&to=2030-12-31&sort=updated"')
  await sleep(1200)
  const hashBefore = await ev('location.hash')
  await page.goto(BASE + '/' + hashBefore, { waitMs: 2000 })
  await loginUi()
  await sleep(1200)
  const hashAfter = await ev('location.hash')
  const selState = await ev('JSON.stringify({folder:(document.querySelectorAll(".vw__bar select")[0]||{}).value,tag:(document.querySelectorAll(".vw__bar select")[1]||{}).value,sort:(document.querySelectorAll(".vw__bar select")[2]||{}).value,from:(document.querySelectorAll(".vw__bar input[type=date]")[0]||{}).value,to:(document.querySelectorAll(".vw__bar input[type=date]")[1]||{}).value})')
  const st = JSON.parse(selState)
  check('URL 状态：刷新后 hash 与筛选控件都能复现', hashAfter === hashBefore && st.folder === '0' && st.from === '2020-01-01' && st.to === '2030-12-31' && st.sort === 'updated', 'before=' + hashBefore + ' after=' + hashAfter + ' controls=' + selState)

  /* 清空筛选 + 空态 */
  await page.waitFor('Array.prototype.some.call(document.querySelectorAll("button"),function(b){return /清空筛选/.test(b.textContent)})', { timeout: 15000 })
  const clickedClear = await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("button"),function(x){return /清空筛选/.test(x.textContent)});if(!b)return false;b.click();return true})()')
  await sleep(1200)
  const hashCleared = await ev('location.hash')
  check('一键清空筛选：只留关键词', clickedClear === true && String(hashCleared).indexOf('folderId') < 0 && String(hashCleared).indexOf('from=') < 0, hashCleared)
  const emptyState = await ev('(function(){location.hash="#/search?q=zzzzz-not-exist";return true})()')
  void emptyState
  await sleep(1600)
  const emptyText = await ev('document.body.innerText')
  check('无结果时给明确空态（换关键词 / 清除筛选）', /没有匹配的结果|当前筛选条件下没有结果/.test(String(emptyText)) && /换个关键词/.test(String(emptyText)), String(emptyText).replace(/\s+/g, ' ').slice(0, 160))

  /* ---------- B. 速览 ---------- */
  await ev('location.hash = "#/notes/6"')
  await page.waitFor('document.querySelector(".kb-digest") !== null', { timeout: 25000 })
  const digestHead = await ev('document.querySelector(".kb-digest__title").textContent')
  check('速览：标题写的是「速览（自动提取）」', digestHead === '速览（自动提取）', digestHead)
  const collapsed = await ev('document.querySelector(".kb-digest__text") === null')
  check('速览：默认折叠（不显示正文）', collapsed === true, String(collapsed))
  await ev('document.querySelector(".kb-digest__head").click()')
  await page.waitFor('document.querySelector(".kb-digest__text") !== null', { timeout: 10000 })
  await sleep(500)
  const digestText = await ev('document.querySelector(".kb-digest__text").textContent')
  check('速览：展开后显示自动提取的正文片段', String(digestText).length > 20, String(digestText).slice(0, 120))
  const stored = await ev('localStorage.getItem("kb.digest.open")')
  check('速览：展开状态写进 localStorage', stored === '1', String(stored))
  await page.screenshot(join(SHOTS, 'digest-open-1440.png'))
  await ev('location.hash = "#/notes/2"')
  await sleep(1500)
  const shortNoteDigest = await ev('document.querySelector(".kb-digest") === null')
  check('速览：短文（无 digest）整块不渲染', shortNoteDigest === true, String(shortNoteDigest))

  /* ---------- C. 附件体检 ---------- */
  await ev('location.hash = "#/io"')
  await page.waitFor('Array.prototype.some.call(document.querySelectorAll("button"),function(b){return b.textContent.trim()==="检查附件"})', { timeout: 25000 })
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("button"),function(x){return x.textContent.trim()==="检查附件"});b.click();return true})()')
  await page.waitFor('document.querySelector(".kb-adm-health") !== null || document.querySelector(".kb-adm-health__ok") !== null', { timeout: 25000 })
  await sleep(700)
  const healthText = await ev('(function(){var c=document.querySelector(".kb-adm-health__summary");return c?c.innerText:""})()')
  check('附件体检：显示 共 N / 正常 X / 缺失 Y', /共 \d+ 个附件/.test(healthText) && /正常 \d+/.test(healthText) && /缺失 \d+/.test(healthText), healthText.replace(/\n/g, ' | '))
  const missingRow = await ev('(function(){var li=document.querySelector(".kb-adm-health__item");if(!li)return JSON.stringify({found:false});return JSON.stringify({found:true,text:li.innerText})})()')
  const mr = JSON.parse(missingRow)
  check('附件体检：逐条列出断链（原文件名 + 大小 + 所属笔记）', mr.found === true && /技能测试1\.png/.test(mr.text) && /B|KB/.test(mr.text), missingRow)
  const openedFromHealth = await ev('(function(){var li=document.querySelector(".kb-adm-health__item");if(!li)return false;var b=li.querySelector("button");if(!b)return false;b.click();return true})()')
  await sleep(1500)
  const hashFromHealth = await ev('location.hash')
  check('附件体检：点所属笔记能跳转', openedFromHealth === true && /#\/notes\/6/.test(String(hashFromHealth)), String(hashFromHealth))
  await ev('location.hash = "#/io"')
  await sleep(1200)
  await ev('(function(){var b=Array.prototype.find.call(document.querySelectorAll("button"),function(x){return x.textContent.trim()==="检查附件"});b.click();return true})()')
  await page.waitFor('document.querySelector(".kb-adm-health") !== null', { timeout: 20000 })
  await sleep(700)
  await page.screenshot(join(SHOTS, 'attachment-health-1440.png'))

  /* ---------- 四断点 ---------- */
  for (const size of [[1440, 900], [1180, 800], [900, 700], [390, 844]]) {
    await page.setViewport(size[0], size[1])
    await ev('location.hash = "#/search?q=' + encodeURIComponent('权限') + '&folderId=0&sort=updated"')
    await sleep(1400)
    const ov = await ev('JSON.stringify({doc:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})')
    const o = JSON.parse(ov)
    check('搜索 @' + size[0] + '：无横向溢出', o.doc <= o.client, ov)
    if (size[0] === 390) await page.screenshot(join(SHOTS, 'search-phone-390.png'))
    if (size[0] === 900) await page.screenshot(join(SHOTS, 'search-tablet-900.png'))
  }

  /* 清理我造的笔记 */
  for (const id of [n1.id, n2.id]) { await apiFetch('/api/notes/' + id, { method: 'DELETE' }); await apiFetch('/api/trash/notes/' + id, { method: 'DELETE' }) }
  const consoleErrs = await page.consoleErrors()
  check('页面无 console 错误', consoleErrs.length === 0, JSON.stringify(consoleErrs).slice(0, 300))
} finally {
  await browser.close()
}

const passed = results.filter((r) => r.ok).length
const out = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '   >> ' + r.extra))
out.push('', 'RESULT passed ' + passed + '/' + results.length)
if (passed !== results.length) { out.push('FAILED:'); for (const r of results.filter((x) => !x.ok)) out.push('  - ' + r.name + ' >> ' + r.extra) }
writeFileSync(join(SHOTS, 'result.txt'), out.join('\n') + '\n')
console.log(out.join('\n'))
process.exitCode = passed === results.length ? 0 : 1