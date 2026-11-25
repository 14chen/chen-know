/**
 * 收藏功能真·UI 回归：不通过 API 预置 isFavorite，完全从界面操作。
 * 用法：node favorite-ui-verify.mjs [--base http://127.0.0.1:8080]
 * 验收：列表「⋯」菜单收藏 → 顶栏 ⭐ 状态同步 → #/favorites 出现该笔记 → 取消收藏后回到空态。
 */
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:8080'
const DB = 'D:/work/知识库/data/kb.db'
const USER = 'favverify', PWD = 'FavVerify123!', INVITE = 'FAVVERIFY'
const SHOTS = 'C:/Users/HP/AppData/Local/Temp/opencode/'

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra: String(extra).slice(0, 300) })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   >> ' + String(extra).slice(0, 300)))
}

const db = new DatabaseSync(DB)
db.exec('PRAGMA foreign_keys = ON')
let noteId = null
let browser = null

try {
  // 准备：临时用户 + 邀请码 + 一篇没有收藏的笔记
  db.prepare('INSERT OR REPLACE INTO invites (code, created_by, created_at) VALUES (?, 1, ?)')
    .run(INVITE, new Date().toISOString())
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, displayName: '收藏验证', password: PWD, inviteCode: INVITE }),
  })
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PWD }),
  })
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const created = await fetch(BASE + '/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '收藏UI验证笔记', content: '# 收藏UI验证笔记\n\n用于验证收藏入口。' }),
  })
  const note = await created.json()
  noteId = note.id
  check('准备：创建了一篇未收藏的笔记', created.status === 201 && note.isFavorite === false,
    JSON.stringify(note))

  const { Browser } = await import(pathToFileURL(
    'D:/work/知识库/frontend/src/editor/lab/cdp.mjs').href)
  browser = await Browser.launch({})
  const page = await browser.newPage(BASE + '/')
  const ev = (e) => page.eval(e)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await page.waitFor("document.querySelector('.kb-login') !== null || document.querySelector('.kb-sidebar') !== null",
    { timeout: 30000 })
  await ev(`(function(){
    var u=document.querySelector('input[name=username]'), p=document.querySelector('input[name=password]');
    var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    set.call(u,'${USER}'); u.dispatchEvent(new Event('input',{bubbles:true}));
    set.call(p,'${PWD}'); p.dispatchEvent(new Event('input',{bubbles:true}));
    var b=document.querySelector('.kb-login button[type=submit]')||Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('登录'));
    if(b)b.click(); return true
  })()`)
  await page.waitFor("document.querySelector('.kb-sidebar') !== null", { timeout: 30000 })
  await sleep(500)

  // 1. 左侧栏「⋯」菜单收藏
  await ev('location.hash = "#/notes/' + noteId + '"')
  await page.waitFor('document.querySelector("[data-testid=topbar-favorite]") !== null', { timeout: 30000 })
  await sleep(500)
  const before = await ev('document.querySelector("[data-testid=topbar-favorite]").getAttribute("aria-pressed")')
  check('顶栏 ⭐ 初始为未收藏', before === 'false', String(before))

  await ev(`(function(){
    var more=document.querySelector('.kb-note-item__more');
    if(!more) return false;
    more.click(); return true
  })()`)
  await page.waitFor('document.querySelector(".kb-note-menu") !== null', { timeout: 10000 })
  const menuText = await ev('document.querySelector(".kb-note-menu").innerText')
  check('「⋯」菜单出现「收藏」项', /收藏/.test(menuText), menuText)
  await ev(`(function(){
    var item=Array.prototype.find.call(document.querySelectorAll('.kb-note-menu__item'), function(b){return b.textContent.trim()==='收藏'});
    if(!item) return false; item.click(); return true
  })()`)
  await page.waitFor('document.querySelector("[data-testid=topbar-favorite]").getAttribute("aria-pressed") === "true"',
    { timeout: 15000 })
  check('点菜单收藏后顶栏 ⭐ 变为已收藏', true)
  await page.screenshot(SHOTS + 'favorite-ui-1-starred.png')

  // 2. 收藏页出现该笔记
  await ev('location.hash = "#/favorites"')
  await page.waitFor('document.body.innerText.includes("收藏UI验证笔记")', { timeout: 20000 })
  const favText = await ev('document.body.innerText')
  check('#/favorites 出现刚收藏的笔记', /收藏UI验证笔记/.test(favText))
  await page.screenshot(SHOTS + 'favorite-ui-2-list.png')

  // 3. 顶栏 ⭐ 取消收藏（回到笔记页）
  await ev('location.hash = "#/notes/' + noteId + '"')
  await page.waitFor('document.querySelector("[data-testid=topbar-favorite]") !== null', { timeout: 30000 })
  await ev('document.querySelector("[data-testid=topbar-favorite]").click()')
  await page.waitFor('document.querySelector("[data-testid=topbar-favorite]").getAttribute("aria-pressed") === "false"',
    { timeout: 15000 })
  check('顶栏 ⭐ 可取消收藏', true)

  await ev('location.hash = "#/favorites"')
  await page.waitFor('document.body.innerText.includes("还没有收藏的笔记")', { timeout: 20000 })
  check('取消收藏后收藏页回到空态', true)
  await page.screenshot(SHOTS + 'favorite-ui-3-empty.png')

  check('页面无 console 错误', page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors).slice(0, 300))
} catch (error) {
  check('脚本执行完成', false, error?.stack || String(error))
} finally {
  if (browser) await browser.close()
  db.exec('BEGIN')
  if (noteId) db.prepare('DELETE FROM notes WHERE id = ?').run(noteId)
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(USER)
  if (u) {
    const s = db.prepare('SELECT id FROM spaces WHERE owner_id = ?').get(u.id)
    if (s) {
      try { db.prepare('DELETE FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE space_id = ?)').run(s.id) } catch {}
    }
  }
  db.prepare('DELETE FROM users WHERE username = ?').run(USER)
  db.prepare('DELETE FROM invites WHERE code = ?').run(INVITE)
  db.exec('COMMIT')
}

const passed = results.filter((r) => r.ok).length
const lines = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '   >> ' + r.extra))
lines.push('', 'RESULT passed ' + passed + '/' + results.length)
writeFileSync('C:/Users/HP/AppData/Local/Temp/opencode/favorite-ui-result.txt', lines.join('\n') + '\n')
console.log(lines.join('\n'))
process.exitCode = passed === results.length ? 0 : 1
