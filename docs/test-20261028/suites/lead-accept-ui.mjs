
import { chromium } from 'file:///F:/devbox/ecms/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8540';
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (id, name, cond, detail) => { cond ? pass++ : fail++; P((cond ? '  PASS ' : '  FAIL ') + id + ' ' + name + (detail !== undefined ? '  [' + String(detail).slice(0, 190) + ']' : '')); };
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
  ok('U1', '登录成功进入应用（有左侧栏）', true);

  await page.locator('button[title="新建笔记"], button[aria-label*="新建笔记"]').first().click();
  await page.waitForSelector('.cm-content', { timeout: 20000 });
  ok('U2', '新建笔记进入编辑器', true);

  const titleBtn = page.locator('[data-testid=topbar-note-title]');
  ok('U3', '顶栏标题是改标题入口', (await titleBtn.count()) === 1, 'count=' + (await titleBtn.count()));
  await titleBtn.click();
  await page.waitForSelector('[data-testid=topbar-note-title-input]', { timeout: 10000 });
  await page.fill('[data-testid=topbar-note-title-input]', '验收改的标题');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const shown = await page.evaluate(() => (document.querySelector('[data-testid=topbar-note-title] .kb-topbar__subject-text') || {}).innerText || '');
  const server = await page.evaluate(async () => { const m = /#\/notes\/(\d+)/.exec(location.hash); if (!m) return null; const r = await fetch('/api/notes/' + m[1], { credentials: 'include' }); return (await r.json()).title; });
  ok('U4', '标题改动界面与数据库都已生效', /验收改的标题/.test(shown) && server === '验收改的标题', 'shown=' + shown + ' server=' + server);

  await page.goto(BASE + '/#/search', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder*="搜索标题与正文"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const has405 = net.some(x => /^405 .*folders/.test(x));
  const okTree = net.some(x => /folders\?tree=true/.test(x));
  ok('U5', '搜索页无 405 且用对端点', !has405 && okTree, 'has405=' + has405 + ' tree=true=' + okTree);

  await page.goto(BASE + '/#/notes/all', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kb-note-item', { timeout: 15000 });
  const delBefore = net.filter(x => /^404 \/api\/notes\/\d+/.test(x)).length;
  await page.locator('.kb-note-item--active .kb-note-item__more, .kb-note-item .kb-note-item__more').first().click();
  await page.waitForTimeout(400);
  await page.locator('[role=menu] button').filter({ hasText: '删除' }).first().click();
  await page.waitForTimeout(600);
  const confirmBtn = page.locator('button').filter({ hasText: /^(确定|确认|删除)$/ }).last();
  if (await confirmBtn.count()) { await confirmBtn.click(); }
  await page.waitForTimeout(1800);
  const delAfter = net.filter(x => /^404 \/api\/notes\/\d+/.test(x)).length;
  ok('U6', '删除当前笔记后无残留 404 请求', delAfter === delBefore, 'delta=' + (delAfter - delBefore));

  for (const vp of [{ w: 375, h: 812 }, { w: 390, h: 844 }, { w: 1366, h: 768 }, { w: 1920, h: 1080 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(BASE + '/#/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('U7-' + vp.w, vp.w + 'px 无横向溢出', ov <= 1, 'overflow=' + ov);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const drawer = await page.evaluate(() => {
    const sb = document.querySelector('aside.kb-sidebar'); if (!sb) return { found: false };
    const before = sb.getBoundingClientRect().x;
    const btn = document.querySelector('button[aria-label*="菜单"], .kb-topbar__menu, button[title*="菜单"]');
    if (btn) btn.click();
    return new Promise(res => setTimeout(() => { const after = sb.getBoundingClientRect().x; res({ found: true, before, after, hasBtn: !!btn }); }, 700));
  });
  ok('U8', '手机端侧栏可开（抽屉）', drawer.found && drawer.hasBtn && drawer.before < 0 && drawer.after >= 0, JSON.stringify(drawer));

  ok('U9', '无未预期 console 错误', consoleErr.length === 0, 'errors=' + consoleErr.slice(0, 2).join(' | '));
  P('');
  P('================ UI 验收: PASS ' + pass + ' / FAIL ' + fail + ' ================');
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
  await b.close();
})().catch(e => { P('EXCEPTION ' + e.message); fs.writeFileSync(process.env.KB_OUT, out.join('\n') + '\nEXC ' + e.message, 'utf8'); });
