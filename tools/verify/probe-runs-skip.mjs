import { launch } from './cdp.mjs'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const b = await launch()
const p = await b.newPage(BASE + '/')
try {
  await p.waitForLoad()
  await new Promise((r) => setTimeout(r, 2500))
  if (await p.eval("document.querySelector('.kb-login') !== null")) {
    await p.eval('(function(){var u=document.querySelector("input[name=username]");var pw=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(pw,"DemoPass123!");pw.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
    await p.click('button[type="submit"]')
    await new Promise((r) => setTimeout(r, 3000))
  }
  await p.eval('location.hash = "#/weekly"')
  await new Promise((r) => setTimeout(r, 4000))
  const cells = await p.eval('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".vw-weekly__table tbody tr"),function(tr){return tr.children[3].textContent.trim()}))')
  const raw = await p.eval('fetch("/api/weekly/runs?limit=3").then(function(r){return r.json()}).then(function(j){return JSON.stringify(j.items.map(function(i){return Object.prototype.hasOwnProperty.call(i,"notesSkipped")}))})')
  console.log('  跳过低 4 列 =', cells)
  console.log('  API 是否带 notesSkipped 字段 =', raw)
} finally {
  await b.close()
}
