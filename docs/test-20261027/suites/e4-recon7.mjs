import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('file:///F:/devbox/ecms/node_modules/playwright/index.mjs');
const BASE = process.env.KB_BASE || 'http://127.0.0.1:8505';
const SHOTS = 'D:/work/知识库/docs/test-20261027/evidence/e4/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.fill('input[name=username]', 'admin'); await p.fill('input[name=password]', 'admin12345');
await p.getByRole('button', { name: '登录', exact: true }).click();
await p.waitForSelector('aside.kb-sidebar', { timeout: 20000 });
await sleep(1000);
await p.goto(BASE + '/#/notes/1', { waitUntil: 'networkidle' });
await sleep(1500);

// A) 点 topbar 标题
await p.locator('.kb-topbar__subject').click().catch(() => {});
await sleep(600);
console.log('AFTER_CLICK_SUBJECT ' + JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => e.tagName + '[' + (e.name || e.placeholder || '') + ']'))));

// B) 笔记列表项 HTML + 更多操作
const itemHtml = await p.evaluate(() => {
  const it = document.querySelector('[class*=note-item], [class*=noteItem], .kb-note-list > *, li');
  return it ? it.outerHTML.replace(/\s+/g, ' ').slice(0, 800) : 'NO_ITEM';
});
console.log('ITEM ' + itemHtml);

const before = await p.evaluate(() => document.body.querySelectorAll('*').length);
await p.locator('button:has-text("更多操作")').first().click().catch((e) => console.log('CLICK_FAIL ' + String(e.message).slice(0, 80)));
await sleep(900);
const diff = await p.evaluate((n) => {
  const all = [...document.querySelectorAll('body *')];
  const added = all.slice(n).filter((e) => (e.innerText || '').trim()).map((e) => ({ cls: String(e.className).slice(0, 34), t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150) }));
  return { total: all.length, addedCount: all.length - n, added: added.slice(0, 12) };
}, before);
console.log('AFTER_MORE ' + JSON.stringify(diff, null, 1).slice(0, 1500));
await p.screenshot({ path: path.join(SHOTS, 'recon-N-更多操作.png') });
await browser.close();
