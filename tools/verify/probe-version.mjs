import { launch } from './cdp.mjs'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const API = process.argv[3] || 'http://127.0.0.1:8095'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await launch()
const p = await b.newPage(BASE + '/')
try {
  await p.waitForLoad()
  await sleep(2500)
  if (await p.eval("document.querySelector('.kb-login') !== null")) {
    await p.eval('(function(){var u=document.querySelector("input[name=username]");var pw=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(pw,"DemoPass123!");pw.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
    await p.click('button[type="submit"]')
    await sleep(3000)
  }
  await p.eval('location.hash = "#/notes/8"')
  await sleep(3000)
  console.log('meta before:', await p.eval('document.querySelector(".kb-notemeta").textContent.trim()'))
  console.log('api before version:', await p.eval('fetch("/api/notes/8").then(r=>r.json()).then(j=>j.version)'))
  await p.click('.cm-content')
  await sleep(300)
  console.log('active:', await p.eval('document.activeElement.className'))
  await p.type('XYZ')
  await sleep(3000)
  console.log('editor tail:', await p.eval('document.querySelector(".cm-content").textContent.slice(-40)'))
  console.log('meta after 5s:', await p.eval('document.querySelector(".kb-notemeta").textContent.trim()'))
  await sleep(4000)
  console.log('meta after 9s:', await p.eval('document.querySelector(".kb-notemeta").textContent.trim()'))
  console.log('api after version:', await p.eval('fetch("/api/notes/8").then(r=>r.json()).then(j=>j.version)'))
} finally {
  await b.close()
}
