import { launch, newPage, uiLogin, BASE, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');
for (const q of ['天', '天气', '天气很', '天气记录']) {
  await page.goto(BASE + '/#/search', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder*="搜索标题与正文"]');
  await sleep(700);
  await page.locator('input[placeholder*="搜索标题与正文"]').fill(q);
  await page.keyboard.press('Enter');
  await sleep(2000);
  const r = await page.evaluate(() => ({
    ems: [...document.querySelectorAll('em')].map((e) => e.innerText).slice(0, 6),
    emCount: document.querySelectorAll('em').length,
    mark: document.querySelectorAll('mark, .kb-hl, [class*=highlight]').length,
    hasResults: !!document.querySelector('[class*=vw-result], [class*=search-result]'),
    bodyTail: document.body.innerText.replace(/\s+/g, ' ').slice(300, 700)
  }));
  console.log('Q=' + q + ' => ' + JSON.stringify(r).slice(0, 500));
}
await ctx.close(); await browser.close();
