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

async function probe(tag) {
  const r = await p.evaluate(() => {
    const more = document.querySelector('.kb-note-item__more');
    const main = document.querySelector('.kb-note-item__main');
    if (!more) return { err: 'no more btn' };
    const b = more.getBoundingClientRect();
    const cx = Math.round(b.x + b.width / 2), cy = Math.round(b.y + b.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const sm = getComputedStyle(more), sa = getComputedStyle(main);
    return {
      moreBox: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      topElAtCenter: top ? top.tagName + '.' + String(top.className).slice(0, 40) : null,
      moreZ: sm.zIndex, morePos: sm.position, moreOpacity: sm.opacity, morePointer: sm.pointerEvents,
      mainZ: sa.zIndex, mainPos: sa.position, mainPointer: sa.pointerEvents,
      moreClickableByPoint: !!top && (top === more || more.contains(top))
    };
  });
  console.log(tag + ' ' + JSON.stringify(r));
  return r;
}
await probe('NO_HOVER');
await p.locator('.kb-note-item').first().hover();
await sleep(400);
await probe('AFTER_HOVER_ITEM');

// force click 看菜单是否存在（绕过指针拦截）
await p.locator('.kb-note-item__more').first().click({ force: true }).catch((e) => console.log('FORCE_FAIL ' + String(e.message).slice(0, 80)));
await sleep(800);
const menu = await p.evaluate(() => {
  const m = document.querySelector('[role=menu]');
  return m ? { items: [...m.querySelectorAll('button,[role=menuitem]')].map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean) } : { items: null };
});
console.log('MENU_AFTER_FORCE ' + JSON.stringify(menu));
await p.screenshot({ path: path.join(SHOTS, 'recon-Q-更多操作-force.png') });

// 右键是否有上下文菜单
await p.locator('.kb-note-item__main').first().click({ button: 'right' }).catch(() => {});
await sleep(600);
const ctxMenu = await p.evaluate(() => { const m = document.querySelector('[role=menu]'); return m ? [...m.querySelectorAll('button,[role=menuitem]')].map((b) => (b.innerText || '').trim()).filter(Boolean) : null; });
console.log('CONTEXT_MENU ' + JSON.stringify(ctxMenu));
await p.screenshot({ path: path.join(SHOTS, 'recon-R-右键菜单.png') });
await browser.close();
