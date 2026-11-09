import { launch } from './cdp.mjs'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const b = await launch()
const p = await b.newPage(BASE + '/')
try {
  await p.waitForLoad()
  await new Promise((r) => setTimeout(r, 2500))
  console.log('initial text:', JSON.stringify(String(await p.eval('document.body.innerText')).slice(0, 200)))
  console.log('console errors:', JSON.stringify((await p.consoleErrors()).slice(0, 4)))
  const has = await p.eval("document.querySelector('.kb-login') !== null")
  console.log('kb-login present:', has)
  if (has) {
    await p.eval('(function(){var u=document.querySelector("input[name=username]");var pw=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(pw,"DemoPass123!");pw.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
    await p.click('button[type="submit"]')
    await new Promise((r) => setTimeout(r, 3500))
    console.log('after submit text:', JSON.stringify(String(await p.eval('document.body.innerText')).slice(0, 300)))
    console.log('sidebar:', await p.eval("document.querySelector('.kb-sidebar') !== null"))
    console.log('console errors after:', JSON.stringify((await p.consoleErrors()).slice(0, 4)))
    console.log('hash:', await p.eval('location.hash'))
  }
} finally {
  await b.close()
}
