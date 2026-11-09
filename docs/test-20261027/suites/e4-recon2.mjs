import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('file:///F:/devbox/ecms/node_modules/playwright/index.mjs');
const BASE = process.env.KB_BASE || 'http://127.0.0.1:8505';
const SHOTS = 'D:/work/知识库/docs/test-20261027/evidence/e4/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });

async function dump(label) {
  const d = await p.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 2 && b.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const btns = [...document.querySelectorAll('button, [role=button], [class*=btn]')].filter(vis).map((e) => txt(e) || e.getAttribute('title') || e.getAttribute('aria-label') || '').filter(Boolean);
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(vis).map((e) => e.tagName.toLowerCase() + (e.type ? '[' + e.type + ']' : '') + (e.placeholder ? '{' + e.placeholder + '}' : '') + (e.name ? '(' + e.name + ')' : ''));
    const regions = [...document.querySelectorAll('header, nav, aside, main, [class*=sidebar], [class*=tree], [class*=list], [class*=editor], [class*=toolbar], .cm-editor')].filter(vis).map((e) => {
      const b = e.getBoundingClientRect();
      return (e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0]).slice(0, 42) + ' @' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height);
    });
    return { hash: location.hash, bodyLen: document.body.innerText.trim().length, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300), btns: [...new Set(btns)].slice(0, 40), inputs, regions: regions.slice(0, 20) };
  });
  console.log('\n### ' + label + ' ### hash=' + d.hash + ' len=' + d.bodyLen);
  console.log('body: ' + d.body);
  if (d.btns.length) console.log('BTN: ' + d.btns.join(' | '));
  if (d.inputs.length) console.log('IN: ' + d.inputs.join(' | '));
  if (d.regions.length) console.log('REGION: ' + d.regions.join(' ; '));
  return d;
}

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await sleep(800);
// 点注册页签
await p.getByText('注册', { exact: true }).first().click().catch(async () => { await p.locator('text=注册').first().click(); });
await sleep(800);
await dump('注册页签');
await p.screenshot({ path: path.join(SHOTS, 'recon-B-注册页.png') });
console.log('\nERR=' + JSON.stringify(errs.splice(0)));
await browser.close();
