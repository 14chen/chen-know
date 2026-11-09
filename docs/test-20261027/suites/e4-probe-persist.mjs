import { launch, newPage, uiLogin, api, BASE, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page, bag } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');
const mk = await api(ctx, 'POST', '/api/notes', { title: '落库验证', content: '初始内容' });
const id = mk.body.id;
console.log('note id=' + id + ' version=' + mk.body.version);
await page.goto(BASE + '/#/notes/' + id, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content'); await sleep(1000);
await page.locator('.cm-content').click();
await page.keyboard.press('Control+End');
const marker = 'UI写入标记' + Date.now();
await page.keyboard.type(' ' + marker);
// 等状态变为已保存
let status = 'NONE';
for (let i = 0; i < 40; i++) {
  status = await page.evaluate(() => (document.body.innerText.match(/已保存|保存中|未保存|保存失败/g) || ['NONE'])[0]);
  if (status === '已保存') break;
  await sleep(300);
}
await sleep(800);
const after = await api(ctx, 'GET', '/api/notes/' + id);
const vers = await api(ctx, 'GET', '/api/notes/' + id + '/versions');
const vcount = Array.isArray(vers.body) ? vers.body.length : (vers.body && vers.body.items ? vers.body.items.length : -1);
console.log('STATUS=' + status + ' server_version=' + (after.body && after.body.version) + ' versions=' + vcount);
console.log('content_persisted=' + String(after.body && after.body.content || '').includes(marker));
console.log('server_content=' + JSON.stringify(String(after.body && after.body.content || '')).slice(0, 160));
// 再刷新页面看内容
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content'); await sleep(1200);
const txt = await page.evaluate(() => (document.querySelector('.cm-content') || {}).innerText || '');
console.log('after_reload_has_marker=' + txt.includes(marker));
console.log('console=' + JSON.stringify(bag.console.slice(0, 4)));
await ctx.close(); await browser.close();
