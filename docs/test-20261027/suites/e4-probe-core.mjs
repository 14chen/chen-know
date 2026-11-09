import { launch, newPage, uiLogin, api, BASE, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page, bag } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');

// 1) 版本：查 note 3 现状
const n3 = await api(ctx, 'GET', '/api/notes/3');
const v3 = await api(ctx, 'GET', '/api/notes/3/versions');
console.log('NOTE3 version=' + (n3.body && n3.body.version) + ' versions_api=' + JSON.stringify(v3.body && (v3.body.items || v3.body)).slice(0, 200));
// 直接 PATCH 两次，看是否产生版本
const p1 = await api(ctx, 'PATCH', '/api/notes/3', { content: 'API 修改第 1 次 ' + Date.now() });
const v3b = await api(ctx, 'GET', '/api/notes/3/versions');
const p2 = await api(ctx, 'PATCH', '/api/notes/3', { content: 'API 修改第 2 次 ' + Date.now() });
const v3c = await api(ctx, 'GET', '/api/notes/3/versions');
const count = (x) => { const b = x.body; if (!b) return -1; if (Array.isArray(b)) return b.length; if (Array.isArray(b.items)) return b.items.length; return -1; };
console.log('PATCH1=' + p1.status + ' versions=' + count(v3b) + ' | PATCH2=' + p2.status + ' versions=' + count(v3c) + ' body=' + JSON.stringify(v3c.body).slice(0, 300));

// 2) 目录树：建一个目录，看 UI 是否显示
const cr = await api(ctx, 'POST', '/api/folders', { parentId: null, name: 'E4测试目录' });
console.log('CREATE_FOLDER status=' + cr.status + ' id=' + (cr.body && cr.body.id));
const tree = await api(ctx, 'GET', '/api/folders?tree=true');
console.log('TREE_API=' + JSON.stringify(tree.body).slice(0, 200));
const treeWrong = await api(ctx, 'GET', '/api/folders/tree');
console.log('TREE_WRONG_PATH status=' + treeWrong.status + ' body=' + JSON.stringify(treeWrong.body).slice(0, 120));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('aside.kb-sidebar');
await sleep(1500);
const sideTree = await page.evaluate(() => ({ treeText: (document.querySelector('.kb-tree') || {}).innerText ? document.querySelector('.kb-tree').innerText.replace(/\s+/g, ' ').slice(0, 200) : null }));
console.log('SIDEBAR_TREE=' + JSON.stringify(sideTree));

// 3) [[ 补全：带过滤字再试，并扫全部浮层
await page.goto(BASE + '/#/notes/3', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content'); await sleep(800);
bag.console.length = 0;
await page.locator('.cm-content').click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('测试 [[工');
await sleep(1500);
const ov = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e), b = e.getBoundingClientRect();
    if ((s.position === 'absolute' || s.position === 'fixed') && b.height > 8 && b.width > 40 && s.visibility !== 'hidden' && s.display !== 'none') {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ cls: String(e.className).slice(0, 45), h: Math.round(b.height), t: t.slice(0, 80) });
    }
  }
  return { overlays: out.slice(0, 10), tooltipInDom: !!document.querySelector('.cm-tooltip') };
});
console.log('WIKI_POPUP=' + JSON.stringify(ov).slice(0, 900));
console.log('CONSOLE=' + JSON.stringify(bag.console.slice(0, 4)));
await page.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/probe-wiki-popup.png' });
await ctx.close(); await browser.close();
