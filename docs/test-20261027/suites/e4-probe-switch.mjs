import { launch, newPage, uiLogin, api, BASE, sleep, shot } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');
const wire = [];
page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/notes/')) wire.push(r.url().replace(BASE, '') + ' | ' + String(r.postData() || '').slice(0, 80)); });
const newNote = async () => {
  await page.locator('button[title="新建笔记"], button[aria-label*="新建笔记"]').first().click();
  await page.waitForFunction(() => /#\/notes\/\d+/.test(location.hash), null, { timeout: 15000 });
  await page.waitForSelector('.cm-content'); await sleep(900);
  return Number(await page.evaluate(() => location.hash.split('/').pop()));
};
const typeAndSave = async (txt) => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(txt);
  for (let i = 0; i < 40; i++) { const s = await page.evaluate(() => (document.body.innerText.match(/已保存|未保存|保存中/g) || [''])[0]); if (s === '已保存') break; await sleep(250); }
  await sleep(900);
};
const A = await newNote();
wire.length = 0;
await typeAndSave(' AAA-第一号笔记');
const wA = wire.slice();
const B = await newNote();
wire.length = 0;
await typeAndSave(' BBB-第二号笔记');
const wB = wire.slice();
console.log('A=' + A + ' B=' + B);
console.log('保存A时的PATCH: ' + JSON.stringify(wA));
console.log('保存B时的PATCH: ' + JSON.stringify(wB));

// 点击列表里的第一篇（A）再编辑
const items = await page.evaluate(() => [...document.querySelectorAll('.kb-note-item__main')].map((b) => ({ t: (b.innerText || '').slice(0, 20) })));
console.log('LIST=' + JSON.stringify(items));
// 用“最旧”的一篇：列表倒数第一篇
await page.locator('.kb-note-item__main').last().click();
await sleep(1500);
const curHash = await page.evaluate(() => location.hash);
wire.length = 0;
await typeAndSave(' XXX-切回后编辑');
const wC = wire.slice();
console.log('点击列表后 hash=' + curHash + ' 编辑后的PATCH=' + JSON.stringify(wC));

// 服务端核对
for (const id of [A, B]) {
  const r = await api(ctx, 'GET', '/api/notes/' + id);
  console.log('NOTE ' + id + ' content=' + JSON.stringify(String(r.body.content || '').slice(0, 60)) + ' version=' + r.body.version);
}
await shot(page, 'probe-切换笔记保存');
await ctx.close(); await browser.close();
