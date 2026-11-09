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
await p.fill('input[name=username]', 'admin');
await p.fill('input[name=password]', 'admin12345');
await p.getByRole('button', { name: '登录', exact: true }).click();
await p.waitForSelector('aside.kb-sidebar', { timeout: 20000 });
await sleep(1000);
await p.goto(BASE + '/#/notes/1', { waitUntil: 'networkidle' });
await sleep(1500);

// 1) 头部 HTML 片段：标题在哪
const headHtml = await p.evaluate(() => {
  const cands = ['.kb-note-head', '.kb-editor__head', '.kb-note-header', 'header.kb-main-head', '.kb-main__head', '.kb-topbar'];
  for (const s of cands) { const e = document.querySelector(s); if (e) return { sel: s, html: e.outerHTML.replace(/\s+/g, ' ').slice(0, 700) }; }
  // 回退：找包含"未命名笔记"且不是 sidebar 的最上层
  const all = [...document.querySelectorAll('div,header')].filter((e) => !e.closest('aside') && /未命名笔记/.test(e.textContent || '') && e.getBoundingClientRect().width > 300 && e.getBoundingClientRect().height < 120);
  const e = all[all.length - 1];
  return e ? { sel: 'fallback', html: e.outerHTML.replace(/\s+/g, ' ').slice(0, 700) } : { sel: 'none' };
});
console.log('HEAD ' + JSON.stringify(headHtml, null, 1).slice(0, 1100));

// 2) 双击标题
await p.getByText('未命名笔记').nth(1).dblclick().catch(async () => { await p.locator('text=未命名笔记').last().dblclick().catch(() => {}); });
await sleep(600);
const afterDbl = await p.evaluate(() => [...document.querySelectorAll('input, textarea, [contenteditable=true]')].map((e) => e.tagName + (e.name ? '[' + e.name + ']' : '') + ' ph=' + (e.placeholder || '')).slice(0, 8));
console.log('AFTER_DBLCLICK inputs=' + JSON.stringify(afterDbl));
await p.screenshot({ path: path.join(SHOTS, 'recon-J-标题双击.png') });

// 3) 更多操作菜单
await p.locator('button:has-text("更多操作")').first().click().catch(() => {});
await sleep(700);
const overlays = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return (s.position === 'fixed' || s.position === 'absolute') && b.height > 10 && b.width > 40 && s.visibility !== 'hidden' && b.top > 0; }).map((e) => ({ cls: String(e.className).slice(0, 30), t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) })).filter((x) => x.t).slice(0, 10));
console.log('OVERLAYS_MORE ' + JSON.stringify(overlays, null, 1).slice(0, 900));
await p.screenshot({ path: path.join(SHOTS, 'recon-K-更多操作菜单.png') });
await p.keyboard.press('Escape');

// 4) [[ 候选：全面扫浮层
await p.locator('.cm-content').click();
await p.keyboard.press('End');
await p.keyboard.type(' 测试双链 [[');
await sleep(1200);
const ov2 = await p.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e); const b = e.getBoundingClientRect();
    if ((s.position === 'fixed' || s.position === 'absolute') && b.height > 8 && b.width > 30 && s.display !== 'none' && s.visibility !== 'hidden') {
      out.push({ cls: String(e.className).slice(0, 40), w: Math.round(b.width), h: Math.round(b.height), t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100) });
    }
  }
  return out.filter((x) => x.h > 8).slice(0, 12);
});
console.log('OVERLAYS_WIKI ' + JSON.stringify(ov2, null, 1).slice(0, 1200));
await p.screenshot({ path: path.join(SHOTS, 'recon-L-双链候选.png') });

// 5) 鼠标 hover 到链接/语法上是否渲染成排版（Markdown 实时预览）
await p.keyboard.press('Escape');
await p.keyboard.press('Enter');
await p.keyboard.type('# 标题一');
await sleep(400);
await p.keyboard.press('Enter');
await p.keyboard.type('**加粗** 测试');
await sleep(600);
const cmHtml = await p.evaluate(() => { const c = document.querySelector('.cm-content'); return c.innerHTML.replace(/\s+/g, ' ').slice(0, 900); });
console.log('CM_HTML ' + cmHtml);
await p.screenshot({ path: path.join(SHOTS, 'recon-M-排版.png') });
await browser.close();
