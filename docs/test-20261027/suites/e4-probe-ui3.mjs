import { launch, newPage, uiLogin, api, BASE, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');

// A) 反链：API 是否已建立
const list = await api(ctx, 'GET', '/api/notes?size=200');
const items = list.body.items || [];
const byTitle = (t) => items.filter((n) => n.title === t).map((n) => n.id);
console.log('TITLES=' + JSON.stringify(items.slice(0, 8).map((n) => n.id + ':' + n.title)));
const ids = byTitle('天气记录');
console.log('天气记录 ids=' + JSON.stringify(ids));
for (const id of ids.slice(0, 2)) {
  const bl = await api(ctx, 'GET', '/api/notes/' + id + '/backlinks');
  const lk = await api(ctx, 'GET', '/api/notes/' + id + '/links');
  console.log('note ' + id + ' backlinks=' + JSON.stringify(bl.body).slice(0, 160) + ' links=' + JSON.stringify(lk.body).slice(0, 160));
}
const yin = byTitle('索引表');
if (yin.length) {
  const lk = await api(ctx, 'GET', '/api/notes/' + yin[0] + '/links');
  console.log('索引表 links=' + JSON.stringify(lk.body).slice(0, 200));
}

// B) 搜索页结构
await page.goto(BASE + '/#/search', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[placeholder*="搜索标题与正文"]'); await sleep(800);
const searchUi = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].map((e) => e.placeholder || e.type);
  const forms = [...document.querySelectorAll('form')].map((f) => ({ cls: String(f.className).slice(0, 30), btns: [...f.querySelectorAll('button')].map((b) => (b.innerText || '').trim()) }));
  const btns = [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').trim(), type: b.type, cls: String(b.className).slice(0, 30) })).filter((x) => x.t);
  return { inputs, forms, btns: btns.slice(0, 12) };
});
console.log('SEARCH_UI=' + JSON.stringify(searchUi).slice(0, 900));
// 用回车提交
await page.locator('input[placeholder*="搜索标题与正文"]').fill('天气');
await page.keyboard.press('Enter');
await sleep(2000);
const res = await page.evaluate(() => ({ ems: [...document.querySelectorAll('em')].map((e) => e.innerText).slice(0, 5), md: !!document.querySelector('[class*=highlight]'), body: document.body.innerText.replace(/\s+/g, ' ').slice(300, 700) }));
console.log('SEARCH_RESULT=' + JSON.stringify(res).slice(0, 600));
await page.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/probe-search.png' });

// C) 版本页结构
const target = ids[0];
for (const c of ['甲', '乙', '丙']) { await api(ctx, 'PATCH', '/api/notes/' + target, { content: '版本内容' + c }); await sleep(150); }
await page.goto(BASE + '/#/versions?note=' + target, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2000);
const verUi = await page.evaluate(() => ({
  btns: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 20),
  rows: [...document.querySelectorAll('li, tr, [class*=version]')].map((x) => ({ t: (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), cls: String(x.className).slice(0, 30) })).filter((x) => /v\d/.test(x.t)).slice(0, 8),
  links: [...document.querySelectorAll('a')].map((a) => ({ t: (a.innerText || '').trim().slice(0, 20), h: a.getAttribute('href') })).slice(0, 8)
}));
console.log('VER_UI=' + JSON.stringify(verUi, null, 1).slice(0, 1200));
await page.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/probe-versions.png' });
await ctx.close(); await browser.close();
