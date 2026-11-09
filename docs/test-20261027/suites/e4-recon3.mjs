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
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });

async function dump(label, shotName) {
  const d = await p.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 2 && b.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const btns = [...document.querySelectorAll('button, [role=button], [class*=btn]')].filter(vis).map((e) => txt(e) || e.getAttribute('title') || e.getAttribute('aria-label') || '');
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(vis).map((e) => e.tagName.toLowerCase() + (e.type ? '[' + e.type + ']' : '') + (e.placeholder ? '{' + e.placeholder + '}' : ''));
    const regions = [...document.querySelectorAll('header, nav, aside, main, .cm-editor, [class*=sidebar], [class*=tree], [class*=note-list], [class*=editor], [class*=toolbar]')].filter(vis).map((e) => {
      const b = e.getBoundingClientRect();
      return (e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ').slice(0, 2).join('.').trim()).slice(0, 40) + '@' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height);
    });
    return { hash: location.hash, len: document.body.innerText.trim().length, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 320), btns: [...new Set(btns)].filter(Boolean).slice(0, 40), inputs, regions: regions.slice(0, 22) };
  });
  console.log('\n### ' + label + ' ### hash=' + d.hash + ' len=' + d.len);
  console.log('body: ' + d.body);
  if (d.btns.length) console.log('BTN: ' + d.btns.join(' | '));
  if (d.inputs.length) console.log('IN: ' + d.inputs.join(' | '));
  if (d.regions.length) console.log('REGION: ' + d.regions.join(' ; '));
  if (shotName) await p.screenshot({ path: path.join(SHOTS, shotName + '.png') });
  return d;
}
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('[STEP-FAIL] ' + name + ': ' + String(e.message).slice(0, 160)); } };

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await sleep(700);
// 注册首位管理员
await step('注册', async () => {
  await p.getByText('注册', { exact: true }).first().click();
  await sleep(500);
  await p.fill('input[name=username]', 'admin');
  await p.fill('input[name=displayName]', '管理员');
  await p.fill('input[name=password]', 'admin12345');
  await p.getByRole('button', { name: '注册并登录' }).click();
  await p.waitForFunction(() => location.hash !== '' && location.hash !== '#/', null, { timeout: 20000 });
  await sleep(1500);
});
await dump('注册后主界面', 'recon-C-主界面');

// 主界面路由探查：点顶部/侧栏可点的入口
await step('清点可点导航', async () => {
  const navs = await p.evaluate(() => [...document.querySelectorAll('a[href^="#"], [data-nav], nav *, aside *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; }).map((e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 16));
  console.log('NAVTEXT: ' + [...new Set(navs)].slice(0, 30).join(' | '));
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')));
  console.log('HREFS: ' + [...new Set(hrefs)].join(' '));
});

await step('新建笔记', async () => {
  const newBtn = p.locator('button').filter({ hasText: /新建|新笔记|写笔记|\+/ }).first();
  if (await newBtn.count()) { await newBtn.click(); await sleep(1200); }
});
await dump('新建笔记后', 'recon-D-编辑器');

console.log('\nERR=' + JSON.stringify(errs.slice(0, 6)));
await browser.close();
