import { launch, newPage, uiLogin, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');
const probe = async (tag) => {
  const d = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="退出登录"]');
    if (!b) return { err: 'no btn' };
    const r = b.getBoundingClientRect();
    const s = getComputedStyle(b);
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      opacity: s.opacity, pe: s.pointerEvents, display: s.display,
      topEl: top ? top.tagName + '.' + String(top.className).slice(0, 30) : null,
      parentCls: String(b.parentElement.className).slice(0, 40),
      sidebar: !!document.querySelector('aside.kb-sidebar')
    };
  });
  console.log(tag + ' ' + JSON.stringify(d));
  return d;
};
await probe('NO_HOVER');
await page.locator('button[aria-label="退出登录"]').first().hover();
await sleep(400);
await probe('HOVER_BTN');
// 正常点击（hover 后）
await page.locator('button[aria-label="退出登录"]').first().click({ timeout: 8000 }).catch((e) => console.log('CLICK_ERR ' + String(e.message).slice(0, 120)));
await sleep(1500);
const after = await page.evaluate(() => ({ hash: location.hash, userInput: !!document.querySelector('input[name=username]'), sidebar: !!document.querySelector('aside.kb-sidebar'), dialog: document.querySelector('[role=dialog]') ? document.querySelector('[role=dialog]').innerText.replace(/\s+/g, ' ').slice(0, 120) : null, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160) }));
console.log('AFTER_CLICK ' + JSON.stringify(after));
await page.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/probe-退出登录2.png' });
await ctx.close(); await browser.close();
