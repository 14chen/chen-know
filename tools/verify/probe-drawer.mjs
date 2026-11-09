import { launch } from './cdp.mjs'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b = await launch({ width: 390, height: 844, scale: 2 })
try {
  const p = await b.newPage('http://127.0.0.1:8090/')
  await p.waitForLoad(); await sleep(1200)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval("(() => { const u=document.querySelector('input[name=\"username\"]'); const pw=document.querySelector('input[name=\"password\"]'); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(u,'demo'); u.dispatchEvent(new Event('input',{bubbles:true})); s.call(pw,'DemoPass123!'); pw.dispatchEvent(new Event('input',{bubbles:true})); })()")
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2500)
  console.log('视口:', await p.eval('innerWidth + "x" + innerHeight'))
  console.log('侧栏可见:', await p.eval("(() => { const s=document.querySelector('.kb-sidebar'); if(!s) return '无 .kb-sidebar'; const r=s.getBoundingClientRect(); return (r.width>0 && r.x>=-5) ? ('可见 w='+Math.round(r.width)) : ('隐藏 x='+Math.round(r.x)+' w='+Math.round(r.width)); })()"))
  const btns = await p.eval("JSON.stringify([...document.querySelectorAll('button')].map(x=>({a:x.getAttribute('aria-label')||'', t:(x.title||''), c:String(x.className).slice(0,40)})).filter(x=>x.a||x.t).slice(0,20))")
  console.log('带标签的按钮:', btns)
} finally { await b.close() }