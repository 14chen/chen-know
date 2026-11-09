
import { chromium } from 'file:///F:/devbox/ecms/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8540';
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
  page.on('response', r => { if (r.status() === 401) errs.push('401 ' + r.url().replace(BASE, '')); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name=username]');
  await page.fill('input[name=username]', 'verifier');
  await page.fill('input[name=password]', 'Verify1234!');
  await page.getByRole('button', { name: /^登录$/ }).first().click();
  await page.waitForSelector('aside.kb-sidebar', { timeout: 25000 });
  await page.locator('button[title="新建笔记"]').first().click();
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(800);

  // 先 hover 再点（模拟真人）
  const row = page.locator('.kb-note-item--active').first();
  await row.hover();
  await page.waitForTimeout(400);
  const more = page.locator('.kb-note-item--active .kb-note-item__more').first();
  let okDirect = true;
  try { await more.click({ timeout: 5000 }); } catch { okDirect = false; }
  P('hover 后直接点击「更多」: ' + (okDirect ? '成功（无需 force）' : '失败（需 force）'));
  const menuOpen = await page.locator('[role=menu]').count();
  P('菜单是否打开: ' + menuOpen);
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
  await b.close();
})();
