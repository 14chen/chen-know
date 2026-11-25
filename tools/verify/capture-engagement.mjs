import { launch } from './cdp.mjs'
import { statSync, mkdirSync } from 'node:fs'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = 'D:/work/知识库/docs/images/engagement'
mkdirSync(OUT, { recursive: true })

const b = await launch({ width: 1440, height: 1000, scale: 1 })
const shot = async (p, name) => {
  await p.screenshot(OUT + '/' + name + '.png')
  console.log('  ' + name + '.png  ' + statSync(OUT + '/' + name + '.png').size + ' B')
}
try {
  const p = await b.newPage('http://127.0.0.1:8080/')
  await p.waitForLoad(); await sleep(1000)
  await p.waitFor("!!document.querySelector('input[name=\"username\"]')", { timeout: 25000 })
  await p.eval(`(() => {
    const u=document.querySelector('input[name=username]'), pw=document.querySelector('input[name=password]');
    const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    s.call(u,'verifyeng'); u.dispatchEvent(new Event('input',{bubbles:true}));
    s.call(pw,'VerifyEng123!'); pw.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await sleep(300)
  await p.click('button.kb-btn--primary')
  await p.waitFor("!!document.querySelector('.kb-app')", { timeout: 30000 })
  await sleep(2000)

  // 简报网页视图：今日必读按热度排序 + 热度/印证徽标
  await p.eval('location.hash = "#/briefing"')
  await p.waitFor("!!document.querySelector('.vw-brief__pick')", { timeout: 25000 })
  await sleep(1800)
  await shot(p, '01-briefing-top5')
  const briefFacts = await p.eval(`(() => ({
    heatBadges: [...document.querySelectorAll('.vw-brief__pick-head .kb-badge')]
      .map(b => b.textContent.trim()).filter(t => t.startsWith('热度')).length,
    firstCard: document.querySelector('.vw-brief__pick-card .vw-brief__pick-title')?.textContent.trim() || '',
    intro: document.querySelector('.vw-brief__card-head .vw-brief__faint')?.textContent.trim() || ''
  }))()`)
  console.log('简报事实:', JSON.stringify(briefFacts))

  // 打开第一条详情：社区高赞原话 + 多源印证
  const opened = await p.eval(`(() => {
    const btn = document.querySelector('.vw-brief__pick-main');
    if (!btn) return false; btn.click(); return true;
  })()`)
  await sleep(900)
  if (opened) await shot(p, '02-briefing-drawer-quote')
  const drawerFacts = await p.eval(`(() => ({
    quote: document.querySelector('.vw-brief__quote')?.textContent.trim() || '',
    hasDialog: document.querySelector('dialog.vw-brief__drawer')?.open === true
  }))()`)
  console.log('详情事实:', JSON.stringify(drawerFacts))

  // 周报网页视图：Top3 活跃度证据
  await p.eval('location.hash = "#/weekly"')
  await p.waitFor("!!document.querySelector('.vw-weekly__highlight')", { timeout: 25000 })
  await sleep(2000)
  await shot(p, '03-weekly-top3')
  const weeklyFacts = await p.eval(`(() => ({
    highlights: document.querySelectorAll('.vw-weekly__highlight').length,
    evidence: [...document.querySelectorAll('.vw-weekly__highlight .vw-weekly__faint')]
      .map(e => e.textContent.trim()).filter(t => t.includes('fork')).slice(0,3)
  }))()`)
  console.log('周报事实:', JSON.stringify(weeklyFacts))
} catch (e) {
  console.error('异常:', e.message)
} finally {
  await b.close()
}
