import { launch } from './cdp.mjs'
const BASE = process.argv[2] || 'http://127.0.0.1:8096'
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
  await p.eval('(function(){window.__urls=[];var f=window.fetch.bind(window);window.fetch=function(u,o){var s=String(u&&u.url?u.url:u);if(s.indexOf("/api/notes/")>=0)window.__urls.push(((o&&o.method)||"GET")+" "+s);return f(u,o)};return true})()')
  await p.eval('(function(){window.__urls=[];return true})()')
  await p.eval('location.hash = "#/notes/7"')
  await sleep(3000)
  console.log('urls:', await p.eval('JSON.stringify(window.__urls)'))
  const opacity = await p.eval('(function(){var s=document.querySelector(".kb-editor-pane .cm-scroller");s.scrollTop=Math.round(s.scrollHeight*0.5);var bar=document.querySelector(".kb-progress__bar");return new Promise(function(res){setTimeout(function(){res(getComputedStyle(bar).opacity+" / width="+bar.style.width)},250)})})()')
  console.log('bar right after scroll:', opacity)
  const faded = await p.eval('(function(){var bar=document.querySelector(".kb-progress__bar");return new Promise(function(res){setTimeout(function(){res(getComputedStyle(bar).opacity)},2000)})})()')
  console.log('bar after 2s:', faded)
} finally { await b.close() }