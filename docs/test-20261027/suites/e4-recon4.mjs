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
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 110)); });

async function dump(label, shot) {
  const d = await p.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 2 && b.height > 2 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const btns = [...document.querySelectorAll('button, [role=button], [class*=btn]')].filter(vis).map((e) => txt(e) || e.getAttribute('title') || e.getAttribute('aria-label') || '');
    const cm = [...document.querySelectorAll('.cm-editor, .cm-content, .CodeMirror, [contenteditable=true], textarea')].filter(vis).map((e) => e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0] + '@' + Math.round(e.getBoundingClientRect().x) + ',' + Math.round(e.getBoundingClientRect().y));
    return { hash: location.hash, len: document.body.innerText.trim().length, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300), btns: [...new Set(btns)].filter(Boolean).slice(0, 36), cm };
  });
  console.log('\n### ' + label + ' ### hash=' + d.hash + ' len=' + d.len);
  console.log('body: ' + d.body);
  if (d.btns.length) console.log('BTN: ' + d.btns.join(' | '));
  if (d.cm.length) console.log('EDITOR: ' + d.cm.join(' ; '));
  if (shot) await p.screenshot({ path: path.join(SHOTS, shot + '.png') });
  return d;
}

async function login(u, pw) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await sleep(600);
  await p.fill('input[name=username]', u);
  await p.fill('input[name=password]', pw);
  await p.getByRole('button', { name: '登录', exact: true }).click();
  await p.waitForSelector('aside.kb-sidebar, .kb-sidebar', { timeout: 20000 });
  await sleep(1200);
}
await login('admin', 'admin12345');
console.log('LOGIN_OK hash=' + (await p.evaluate(() => location.hash)));

// 打开笔记 1
await p.goto(BASE + '/#/notes/1', { waitUntil: 'networkidle' });
await sleep(1500);
await dump('笔记页 #/notes/1', 'recon-E-笔记页');

// 编辑器内部结构
const edInfo = await p.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { sel: s, tag: e.tagName, cls: String(e.className).slice(0, 60), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), editable: e.getAttribute('contenteditable'), ph: e.getAttribute('data-placeholder') || '' }; };
  return ['.cm-editor', '.cm-content', '.cm-scroller', '.kb-editor', '.kb-editor__body', 'input[name=title]', '.kb-title', '[contenteditable=true]'].map(q).filter(Boolean);
});
console.log('\nEDINFO: ' + JSON.stringify(edInfo, null, 1).slice(0, 1800));

// 逐页探查导航
const NAVS = ['搜索', '标签', '收藏', '最近浏览', '反链', '关系图', '历史版本', '回收站', '导入导出', 'AI 简报', '统计', '成员管理'];
for (const n of NAVS) {
  try {
    const btn = p.locator('nav.kb-nav button, .kb-nav button').filter({ hasText: new RegExp('^' + n + '$') }).first();
    if (!(await btn.count())) { console.log('\n[NAV-MISS] ' + n); continue; }
    await btn.click();
    await sleep(1400);
    await dump('导航:' + n, 'recon-F-' + n.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, ''));
  } catch (e) { console.log('\n[NAV-FAIL] ' + n + ': ' + String(e.message).slice(0, 100)); }
}
console.log('\nERR=' + JSON.stringify(errs.slice(0, 8)));
await browser.close();
