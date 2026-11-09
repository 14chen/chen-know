/**
 * E4 侦察：抓真实 DOM（按钮/输入框/空态/布局区块），并截图
 * 用法: node e4-recon.mjs   （实例需已在 8505）
 */
import fs from 'node:fs';
import path from 'node:path';

const PW = 'file:///F:/devbox/ecms/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const BASE = process.env.KB_BASE || 'http://127.0.0.1:8505';
const EV = 'D:/work/知识库/docs/test-20261027/evidence/e4';
const SHOTS = path.join(EV, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 120)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });

async function digest(p, label) {
  const d = await p.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 2 && b.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const btns = [...document.querySelectorAll('button, a[role=button], [class*=btn]')].filter(vis).map(txt).filter((t) => t && t.length < 30);
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(vis).map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type || '', ph: e.placeholder || '', name: e.name || '', id: e.id || '', aria: e.getAttribute('aria-label') || '' }));
    const links = [...document.querySelectorAll('a')].filter(vis).map(txt).filter(Boolean).slice(0, 15);
    return {
      url: location.href, hash: location.hash, title: document.title,
      bodyLen: document.body.innerText.trim().length,
      bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 260),
      btns: [...new Set(btns)].slice(0, 30), inputs, links: [...new Set(links)]
    };
  });
  console.log('\n### ' + label + ' ###');
  console.log('hash=' + d.hash + '  title=' + d.title + '  bodyLen=' + d.bodyLen);
  console.log('body: ' + d.bodyHead);
  if (d.btns.length) console.log('BTN: ' + d.btns.join(' | '));
  if (d.inputs.length) console.log('IN: ' + d.inputs.map((x) => x.tag + (x.type ? '[' + x.type + ']' : '') + (x.ph ? '{' + x.ph + '}' : '') + (x.name ? '(' + x.name + ')' : '')).join(' | '));
  if (d.links.length) console.log('A: ' + d.links.join(' | '));
  return d;
}

async function shot(name) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await sleep(1200);
await digest(p, 'A 初始页（空库）');
await shot('recon-A-初始页');

// 尝试注册首人（空库 → 免邀请码 + admin）
const bodyTxt = await p.evaluate(() => document.body.innerText);
if (/注册|sign\s*up|register/i.test(bodyTxt)) {
  const hasRegForm = await p.locator('input[type=password]').count();
  console.log('\n发现密码框数=' + hasRegForm);
  // 切到注册页签
  const regTab = p.locator('button, a, [role=tab], [class*=tab]').filter({ hasText: /注册/ }).first();
  if (await regTab.count()) { await regTab.click().catch(() => {}); await sleep(600); await digest(p, 'B 注册页签'); await shot('recon-B-注册'); }
}
console.log('\nERR ' + JSON.stringify(errs.slice(0, 5)));
await browser.close();
