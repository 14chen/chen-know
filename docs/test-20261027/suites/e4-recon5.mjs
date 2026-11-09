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
const bad = [];
p.on('response', (r) => { const s = r.status(); if (s >= 400) bad.push(s + ' ' + r.request().method() + ' ' + r.url().replace(BASE, '')); });
p.on('pageerror', (e) => bad.push('pageerror ' + String(e.message).slice(0, 100)));

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.fill('input[name=username]', 'admin');
await p.fill('input[name=password]', 'admin12345');
await p.getByRole('button', { name: '登录', exact: true }).click();
await p.waitForSelector('aside.kb-sidebar', { timeout: 20000 });
await sleep(1200);
console.log('LOGIN bad=' + JSON.stringify(bad.splice(0)));

await p.goto(BASE + '/#/notes/1', { waitUntil: 'networkidle' });
await sleep(1500);
console.log('NOTE bad=' + JSON.stringify(bad.splice(0)));

// 标题元素 & 工具栏结构
const struct = await p.evaluate(() => {
  const out = {};
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className).slice(0, 50), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), val: e.value === undefined ? '' : e.value }; };
  out.titleInput = q('input[name=title]') || q('.kb-editor input[type=text]') || q('input[placeholder*=标题]');
  out.titleOther = [...document.querySelectorAll('.kb-editor > *, .kb-editor__head *')].slice(0, 12).map((e) => e.tagName + '.' + String(e.className).split(' ')[0]);
  out.toolbarBtns = [...document.querySelectorAll('.kb-editor button, .kb-editor__head button, [class*=toolbar] button')].map((e) => (e.innerText || '').trim() || e.getAttribute('title') || e.getAttribute('aria-label') || '').filter(Boolean);
  return out;
});
console.log('STRUCT ' + JSON.stringify(struct, null, 1).slice(0, 1200));

// 更多操作菜单
await p.locator('button:has-text("更多操作")').first().click().catch(() => {});
await sleep(600);
const menu = await p.evaluate(() => [...document.querySelectorAll('[role=menu] *, .kb-menu *, .dropdown *')].filter((e) => e.getBoundingClientRect().height > 4).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 20).slice(0, 20));
console.log('MORE_MENU ' + JSON.stringify([...new Set(menu)]));
await p.screenshot({ path: path.join(SHOTS, 'recon-G-更多操作.png') });
await p.keyboard.press('Escape').catch(() => {});
await sleep(400);

// 编辑正文：autosave 与状态
await p.locator('.cm-content').click();
await p.keyboard.type('第一行测试内容');
await sleep(300);
const st1 = await p.evaluate(() => document.body.innerText.match(/已保存[^\n]*|保存中[^\n]*|未保存[^\n]*/) ? document.body.innerText.match(/已保存[^\n]*|保存中[^\n]*|未保存[^\n]*/)[0] : 'NO_STATUS');
console.log('AFTER_TYPE status=' + st1);
await sleep(2500);
const st2 = await p.evaluate(() => document.body.innerText.match(/已保存[^\n]*|保存中[^\n]*|未保存[^\n]*/) ? document.body.innerText.match(/已保存[^\n]*|保存中[^\n]*|未保存[^\n]*/)[0] : 'NO_STATUS');
console.log('AFTER_WAIT status=' + st2);
const apiAfter = bad.splice(0);
console.log('EDIT bad=' + JSON.stringify(apiAfter));

// [[ 触发
await p.keyboard.type(' [[知');
await sleep(900);
const ac = await p.evaluate(() => {
  const pop = document.querySelector('.cm-tooltip-autocomplete, .cm-tooltip');
  return { popup: pop ? pop.innerText.replace(/\s+/g, ' ').slice(0, 120) : null, visible: pop ? pop.getBoundingClientRect().height > 4 : false };
});
console.log('AUTOCOMPLETE ' + JSON.stringify(ac));
await p.screenshot({ path: path.join(SHOTS, 'recon-H-双链补全.png') });
await p.keyboard.press('Escape').catch(() => {});

// 移动端
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mctx.newPage();
await mp.goto(BASE + '/', { waitUntil: 'networkidle' });
await mp.fill('input[name=username]', 'admin');
await mp.fill('input[name=password]', 'admin12345');
await mp.getByRole('button', { name: '登录', exact: true }).click();
await mp.waitForSelector('aside.kb-sidebar', { timeout: 20000 });
await sleep(1500);
const m = await mp.evaluate(() => {
  const de = document.documentElement;
  const side = document.querySelector('aside.kb-sidebar');
  const hb = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim() || b.getAttribute('title') || b.getAttribute('aria-label') || '').filter(Boolean);
  const sb = side ? side.getBoundingClientRect() : null;
  return { overflow: de.scrollWidth - de.clientWidth, vw: de.clientWidth, sidebar: sb ? { x: Math.round(sb.x), w: Math.round(sb.width), visibleInViewport: sb.right > 1 } : null, btns: hb.slice(0, 26) };
});
console.log('MOBILE ' + JSON.stringify(m));
await mp.screenshot({ path: path.join(SHOTS, 'recon-I-移动端.png') });
await mctx.close();
await browser.close();
