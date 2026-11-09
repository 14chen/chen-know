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
await sleep(1200);

// 打开笔记项的更多操作菜单
await p.locator('.kb-note-item__more').first().click();
await sleep(700);
const menu = await p.evaluate(() => {
  const m = document.querySelector('[role=menu]');
  if (!m) return { found: false };
  return { found: true, items: [...m.querySelectorAll('button, [role=menuitem]')].map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean) };
});
console.log('NOTE_MENU ' + JSON.stringify(menu));
await p.screenshot({ path: path.join(SHOTS, 'recon-O-笔记项菜单.png') });

// 若含重命名 → 点开看输入框
if (menu.found && menu.items.some((t) => /重命名/.test(t))) {
  await p.locator('[role=menu] button, [role=menu] [role=menuitem]').filter({ hasText: '重命名' }).first().click();
  await sleep(700);
  const inputs = await p.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => ({ tag: e.tagName, name: e.name || '', ph: e.placeholder || '', val: e.value })));
  console.log('RENAME_INPUTS ' + JSON.stringify(inputs));
  await p.screenshot({ path: path.join(SHOTS, 'recon-P-重命名.png') });
}
await browser.close();
