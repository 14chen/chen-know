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
  await p.eval('(function(){window.__stack=[];var f=window.fetch.bind(window);window.fetch=function(u,o){var s=String(u&&u.url?u.url:u);var i=s.indexOf("/api/notes/");var m=(o&&o.method)?String(o.method).toUpperCase():"GET";if(i>=0&&m==="GET"){var rest=s.slice(i+11);var c=rest.charAt(0);if(c>="0"&&c<="9"&&rest.indexOf("/related")<0){window.__stack.push(new Error().stack.split("\n").slice(1,4).join(" | "))}}return f(u,o)};return true})()')
  await p.eval('location.hash = "#/notes/7"')
  await sleep(3000)
  const stacks = await p.eval('JSON.stringify(window.__stack)')
  console.log('calls:', stacks)
  // 进度条：滚动后立即读
  await p.eval('(function(){var s=document.querySelector(".kb-editor-pane .cm-scroller");s.scrollTop=Math.round(s.scrollHeight*0.5);return true})()')
  await sleep(320)
  console.log('bar after 320ms:', await p.eval('(function(){var b=document.querySelector(".kb-progress__bar");return getComputedStyle(b).opacity+" / "+(b.className)})()'))
  await sleep(2000)
  console.log('bar after 2.3s:', await p.eval('(function(){var b=document.querySelector(".kb-progress__bar");return getComputedStyle(b).opacity+" / "+(b.className)})()'))
} finally { await b.close() }
