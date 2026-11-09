import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, uiLogin, api, BASE, sleep, SHOTS } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');

// A) 导入导出页结构
await page.locator('nav.kb-nav button').filter({ hasText: '导入导出' }).first().click();
await sleep(1800);
const io = await page.evaluate(() => ({
  fileInputs: [...document.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.getAttribute('accept'), multiple: e.multiple, hidden: getComputedStyle(e).display, cls: String(e.className).slice(0, 30) })),
  btns: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean),
  dropzones: [...document.querySelectorAll('[class*=drop]')].map((e) => String(e.className).slice(0, 40)).slice(0, 5)
}));
console.log('IO_UI=' + JSON.stringify(io, null, 1).slice(0, 900));

// B) 邀请码 API
const invs = await api(ctx, 'GET', '/api/admin/invites');
console.log('INVITES_GET status=' + invs.status + ' body=' + JSON.stringify(invs.body).slice(0, 200));
const createInv = await api(ctx, 'POST', '/api/admin/invites', { expiresInHours: 24 });
console.log('INVITES_POST status=' + createInv.status + ' body=' + JSON.stringify(createInv.body).slice(0, 200));
const invs2 = await api(ctx, 'GET', '/api/admin/invites');
console.log('INVITES_AFTER=' + JSON.stringify(invs2.body).slice(0, 300));

// C) 主题持久化
await page.goto(BASE + '/#/stats', { waitUntil: 'domcontentloaded' });
await sleep(1200);
const t0 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).slice(0, 6) }));
console.log('THEME_BEFORE=' + JSON.stringify(t0));
await page.locator('button[title*="深色"]').first().click();
await sleep(900);
const t1 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).slice(0, 6) }));
console.log('THEME_AFTER_CLICK=' + JSON.stringify(t1));
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(1500);
const t2 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).slice(0, 6) }));
console.log('THEME_AFTER_RELOAD=' + JSON.stringify(t2));
await page.screenshot({ path: path.join(SHOTS, 'probe-主题.png') });
await ctx.close(); await browser.close();
