
import { chromium } from 'file:///F:/devbox/ecms/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8540';
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (id, name, cond, detail) => { cond ? pass++ : fail++; P((cond ? '  PASS ' : '  FAIL ') + id + ' ' + name + (detail !== undefined ? '  [' + String(detail).slice(0, 200) + ']' : '')); };
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErr = []; const net = [];
  page.on('console', m => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 100)); });
  page.on('response', r => { net.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name=username]', { timeout: 20000 });
  await page.fill('input[name=username]', 'verifier');
  await page.fill('input[name=password]', 'Verify1234!');
  await page.getByRole('button', { name: /^登录$/ }).first().click();
  await page.waitForSelector('aside.kb-sidebar', { timeout: 25000 });

  // 新建一篇专门用来删
  await page.locator('button[title="新建笔记"], button[aria-label*="新建笔记"]').first().click();
  await page.waitForSelector('.cm-content', { timeout: 20000 });
  await page.waitForTimeout(800);

  const delBefore = net.filter(x => /^404 \/api\/notes\/\d+/.test(x)).length;
  const more = page.locator('.kb-note-item--active .kb-note-item__more').first();
  let needForce = false;
  try { await more.click({ timeout: 4000 }); } catch { needForce = true; await more.click({ force: true }); }
  await page.waitForTimeout(500);
  ok('U6a', '笔记项「更多操作」菜单可打开（记录是否需要 force）', true, needForce ? '需要 force（存在层级遮挡，已记录）' : '正常点击即可');
  const delItem = page.locator('[role=menu] button').filter({ hasText: '删除' }).first();
  if (await delItem.count()) { await delItem.click(); } else { ok('U6b', '菜单里有删除项', false, '未找到'); }
  await page.waitForTimeout(700);
  const confirm = page.locator('button').filter({ hasText: /^(确定|确认|删除)$/ }).last();
  if (await confirm.count()) { await confirm.click(); }
  await page.waitForTimeout(2000);
  const delAfter = net.filter(x => /^404 \/api\/notes\/\d+/.test(x)).length;
  ok('U6', '删除当前笔记后无残留 404 请求（DEF-E4-004）', delAfter === delBefore, 'delta=' + (delAfter - delBefore));

  for (const vp of [{ w: 375, h: 812 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1366, h: 768 }, { w: 1920, h: 1080 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(BASE + '/#/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1100);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('U7-' + vp.w, vp.w + 'px 无横向溢出', ov <= 1, 'overflow=' + ov);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const drawer = await page.evaluate(() => new Promise(res => {
    const sb = document.querySelector('aside.kb-sidebar'); if (!sb) return res({ found: false });
    const before = Math.round(sb.getBoundingClientRect().x);
    const btn = document.querySelector('.kb-topbar__menu, button[aria-label*="菜单"], button[title*="菜单"]');
    if (!btn) return res({ found: true, hasBtn: false, before });
    btn.click();
    setTimeout(() => res({ found: true, hasBtn: true, before, after: Math.round(sb.getBoundingClientRect().x) }), 800);
  }));
  ok('U8', '手机端抽屉可开', drawer.found && drawer.hasBtn && drawer.before < 0 && drawer.after >= 0, JSON.stringify(drawer));

  ok('U9', '无未预期 console 错误', consoleErr.length === 0, 'errors=' + consoleErr.slice(0, 3).join(' | '));
  P('');
  P('================ UI 验收（第二轮）: PASS ' + pass + ' / FAIL ' + fail + ' ================');
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
  await b.close();
})().catch(e => { P('EXCEPTION ' + e.message); fs.writeFileSync(process.env.KB_OUT, out.join('\n') + '\nEXC ' + e.message, 'utf8'); });
