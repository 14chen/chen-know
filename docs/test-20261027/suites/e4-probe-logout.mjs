import { launch, newPage, uiLogin, BASE, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');
const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').replace(/\s+/g, ' ').trim(), aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), cls: String(b.className).slice(0, 40), testid: b.getAttribute('data-testid') })).filter((x) => x.aria || x.title || x.t));
console.log(JSON.stringify(btns.filter((x) => /退出|登录|用户|收起|wide|宽屏|深色|菜单/.test((x.aria || '') + (x.title || '') + x.t)), null, 1).slice(0, 2000));
// 尝试点击退出
const cand = page.locator('button[aria-label*="退出"], button[title*="退出"]').first();
console.log('LOGOUT_CAND_COUNT=' + (await cand.count()));
if (await cand.count()) { await cand.click({ force: true }); await sleep(1500); }
console.log('AFTER_LOGOUT hash=' + (await page.evaluate(() => location.hash)) + ' hasUserInput=' + (await page.locator('input[name=username]').count()) + ' hasSidebar=' + (await page.evaluate(() => !!document.querySelector('aside.kb-sidebar'))));
await page.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/probe-退出登录.png' });
await ctx.close(); await browser.close();
