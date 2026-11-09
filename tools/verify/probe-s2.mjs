import { launch } from './cdp.mjs'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await launch()
const p = await b.newPage(BASE + '/')
const INPUT = 'input[type="search"]'
try {
  await p.waitForLoad()
  await sleep(2500)
  if (await p.eval("document.querySelector('.kb-login') !== null")) {
    await p.eval('(function(){var u=document.querySelector("input[name=username]");var pw=document.querySelector("input[name=password]");var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(u,"demo");u.dispatchEvent(new Event("input",{bubbles:true}));s.call(pw,"DemoPass123!");pw.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
    await p.click('button[type="submit"]')
    await sleep(3000)
  }
  await p.eval('location.hash = "#/search"')
  await sleep(2000)
  console.log('inputs found:', await p.eval("JSON.stringify(Array.prototype.map.call(document.querySelectorAll('input'),function(i){return i.type+':'+i.name+':'+i.placeholder.slice(0,10)}))"))
  await p.eval('(function(){window.__c={search:0,suggest:0};var f=window.fetch.bind(window);window.fetch=function(u,o){var s=String(u&&u.url?u.url:u);if(s.indexOf("/api/search/suggest")>=0)window.__c.suggest++;else if(s.indexOf("/api/search")>=0)window.__c.search++;return f(u,o)};return true})()')
  await p.eval('(function(){var i=document.querySelector(' + JSON.stringify(INPUT) + ');i.focus();return document.activeElement===i})()')
  await p.type('abc', { perChar: 30 })
  await sleep(1200)
  console.log('input value:', JSON.stringify(await p.eval('document.querySelector(' + JSON.stringify(INPUT) + ').value')))
  console.log('counter:', await p.eval('JSON.stringify(window.__c)'))
  console.log('hash:', await p.eval('location.hash'))
} finally { await b.close() }
