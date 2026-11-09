/** E4-B：编辑器特性 / 搜索 / 双向链接 / 历史版本 (TC-UI-024..046) */
import { launch, newPage, uiLogin, api, shot, t, results, writeResults, sleep, BASE, editorText, openNote, waitSaved, unexpected } from './e4-lib.mjs';

const browser = await launch();
const { ctx, page, bag } = await newPage(browser);
const g = (id, name) => ({ id, name });
const rec = (x, ok, note) => t(x.id, x.name, ok, note);
const setEditor = async (text) => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
  await sleep(300);
};

await uiLogin(page, 'alice', 'alice12345');
const mkNote = async (title, content) => (await api(ctx, 'POST', '/api/notes', { title, content, folderId: null })).body;
const n1 = await mkNote('天气记录', '今天天气很好，适合出去散步。晴，微风。');
const n2 = await mkNote('工作周报', '本周完成接口联调，下周计划做性能优化。');
const n3 = await mkNote('索引表', '常用入口：[[天气记录]] 与 [[工作周报]]。');
console.log('notes=' + JSON.stringify([n1.id, n2.id, n3.id]));

// ---------- D. 编辑器特性 ----------
await openNote(page, n1.id);
const B24 = g('TC-UI-024', 'Markdown 实时排版：# 标题行即时渲染为标题样式');
await setEditor('# 天气观察');
await sleep(900);
const h1 = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.cm-line')].find((l) => /天气观察/.test(l.innerText || ''));
  return t ? { cls: String(t.className), html: t.innerHTML.replace(/\s+/g, ' ').slice(0, 160) } : null;
});
rec(B24, !!h1 && /cm-kb-h1/.test(h1.cls), JSON.stringify(h1));
await shot(page, 'B24-标题实时排版');

const B25 = g('TC-UI-025', '行内 Markdown：**加粗** 的标记符号被弱化显示');
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('**重点** 与普通文字');
await sleep(900);
const bold = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.cm-line')].find((l) => /重点/.test(l.innerText || ''));
  return t ? { cls: String(t.className), spans: [...t.querySelectorAll('span')].map((s) => ({ cls: String(s.className), t: (s.innerText || '').slice(0, 8) })).slice(0, 5) } : null;
});
rec(B25, !!bold && bold.spans.length >= 2, JSON.stringify(bold));
await shot(page, 'B25-行内格式');
await waitSaved(page);

const B26 = g('TC-UI-026', '输入 [[ 后弹出笔记标题候选');
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('参见 [[');
await sleep(1200);
const popupBare = await page.evaluate(() => { const p = document.querySelector('.cm-tooltip-autocomplete'); return p ? { t: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 120), h: Math.round(p.getBoundingClientRect().height) } : null; });
await page.keyboard.type('工');
await sleep(1500);
const popup = await page.evaluate(() => { const p = document.querySelector('.cm-tooltip-autocomplete'); return p ? { t: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 120), h: Math.round(p.getBoundingClientRect().height) } : null; });
rec(B26, !!popup && /工作周报/.test(popup.t), '仅[[:' + JSON.stringify(popupBare) + ' 输入过滤字后:' + JSON.stringify(popup));
await shot(page, 'B26-双链候选');

const B27 = g('TC-UI-027', '从候选中回车选择 → 插入完整 [[标题]]');
let inserted = false;
if (popup) {
  await page.keyboard.press('Enter');
  await sleep(1200);
  const txt = await editorText(page);
  inserted = /\[\[工作周报\]\]/.test(txt || '');
  rec(B27, inserted, '正文片段=' + String(txt || '').replace(/\n/g, ' | ').slice(-90));
} else rec(B27, false, '候选未出现');
await waitSaved(page);

const B28 = g('TC-UI-028', '插入图片：上传附件后正文引用可渲染且附件可访问');
const up = await page.evaluate(async () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'e4-test.png');
  const r = await fetch('/api/attachments', { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
});
const attId = up.body && up.body.id;
let imgOk = null;
if (attId) {
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![](/api/attachments/' + attId + ')');
  await sleep(1400);
  imgOk = await page.evaluate(async (id) => {
    const imgs = [...document.querySelectorAll('.cm-content img')].map((i) => i.getAttribute('src'));
    const r = await fetch('/api/attachments/' + id);
    return { editorImgs: imgs.slice(0, 3), status: r.status, ct: r.headers.get('content-type') };
  }, attId);
}
rec(B28, !!attId && imgOk && imgOk.status === 200 && /image\//.test(imgOk.ct || ''), 'upload=' + up.status + ' att=' + attId + ' ' + JSON.stringify(imgOk));
await waitSaved(page);
await shot(page, 'B28-插入图片');

const B29 = g('TC-UI-029', 'Ctrl+S 手动保存 → 状态为已保存');
await page.keyboard.press('Control+End');
await page.keyboard.type(' 手动保存');
await sleep(300);
await page.keyboard.press('Control+s');
await sleep(1600);
const st29 = await page.evaluate(() => (document.body.innerText.match(/已保存|保存中|未保存/g) || ['NONE'])[0]);
rec(B29, st29 === '已保存', 'status=' + st29);

// ---------- E. 搜索 ----------
const kwInput = () => page.locator('input[placeholder*="搜索标题与正文"]').first();
async function doSearch(q) {
  await page.goto(BASE + '/#/search', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder*="搜索标题与正文"]', { timeout: 20000 });
  await sleep(600);
  await kwInput().fill(q);
  await page.keyboard.press('Enter');
  await sleep(1900);
  return page.evaluate(() => ({
    ems: [...document.querySelectorAll('em')].map((e) => (e.innerText || '').slice(0, 16)),
    body: document.body.innerText.replace(/\s+/g, ' '),
    links: [...document.querySelectorAll('a[href*="#/notes/"], [class*=result] [class*=item]')].length
  }));
}
const B30 = g('TC-UI-030', '搜索 1 个中文字「天」→ 有结果');
const s30 = await doSearch('天');
rec(B30, /天气记录/.test(s30.body), s30.body.slice(0, 180));
await shot(page, 'B30-搜索1字');
const B31 = g('TC-UI-031', '搜索 2 个中文字「天气」→ 有结果');
const s31 = await doSearch('天气');
rec(B31, /天气记录/.test(s31.body), s31.body.slice(0, 180));
await shot(page, 'B31-搜索2字');
const B32 = g('TC-UI-032', '搜索 3 个中文字「天气很」→ 有结果');
const s32 = await doSearch('天气很');
rec(B32, /天气记录/.test(s32.body), s32.body.slice(0, 180));
await shot(page, 'B32-搜索3字');
const s33 = await doSearch('天气');
const B33 = g('TC-UI-033', '搜索结果用 <em> 高亮命中词（1–2 字查询）');
rec(B33, s33.ems.length > 0, '2字em=' + JSON.stringify(s33.ems.slice(0, 4)) + ' 1字em=' + JSON.stringify(s30.ems.slice(0, 4)));
await shot(page, 'B33-高亮');

const B47 = g('TC-UI-047', '3 字中文查询命中但无 <em> 高亮（缺陷项）');
const hitHasText = /天气很好/.test(s32.body);
rec(B47, !(hitHasText && s32.ems.length === 0), '共N条=' + (s32.body.match(/共 (\d+) 条/) || ['?'])[1] + ' em数=' + s32.ems.length + ' 摘录含"天气很好"=' + hitHasText);
await shot(page, 'B47-3字查询不高亮');
const B34 = g('TC-UI-034', '点击搜索结果跳转到对应笔记');
let jumped = false;
const resLink = page.locator('a[href*="#/notes/"], button, [class*=result] [class*=item]').filter({ hasText: /天气记录/ }).first();
if (await resLink.count()) { await resLink.click().catch(() => {}); await sleep(1600); jumped = await page.evaluate(() => /#\/notes\/\d+/.test(location.hash)); }
rec(B34, jumped, 'hash=' + (await page.evaluate(() => location.hash)));
await shot(page, 'B34-搜索跳转');
const B35 = g('TC-UI-035', '搜索无结果时显示空态且不报错');
const s35 = await doSearch('zzz不存在关键词zzz');
rec(B35, !/服务端异常/.test(s35.body), s35.body.slice(0, 200));
await shot(page, 'B35-搜索无结果');

// ---------- F. 双向链接 ----------
// 用唯一标题的干净数据验证双链（避免同名笔记干扰）
const srcA = await mkNote('E4源笔记G1', '这里引用 [[E4目标笔记H1]] 一次。');
const tgtB = await mkNote('E4目标笔记H1', '我是被引用的目标笔记。');
await sleep(500);
const apiBl = await api(ctx, 'GET', '/api/notes/' + tgtB.id + '/backlinks');
console.log('API反链=' + JSON.stringify(apiBl.body).slice(0, 200));

const B36 = g('TC-UI-036', '反链页：被引用笔记显示引用来源');
await page.goto(BASE + '/#/backlinks?note=' + tgtB.id, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2200);
const bl36 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
rec(B36, /E4源笔记G1/.test(bl36), 'API反链=' + JSON.stringify(apiBl.body).slice(0, 120) + ' | 页面=' + bl36.slice(180, 420));
await shot(page, 'B36-反链列表');

const B37 = g('TC-UI-037', '反链页：显示该笔记的出链');
await page.goto(BASE + '/#/backlinks?note=' + srcA.id, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2200);
const bl37 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
rec(B37, /出链 1/.test(bl37) && /E4目标笔记H1/.test(bl37), bl37.slice(180, 420));
await shot(page, 'B37-出链');

const B38 = g('TC-UI-038', '点击反链条目跳转到来源笔记');
let blJump = false;
const blItem = page.locator('a, button, li, [class*=backlink]').filter({ hasText: /E4目标笔记H1|E4源笔记G1/ }).first();
if (await blItem.count()) { await blItem.click().catch(() => {}); await sleep(1800); blJump = await page.evaluate(() => /#\/notes\/\d+/.test(location.hash)); }
rec(B38, blJump, 'hash=' + (await page.evaluate(() => location.hash)));
await shot(page, 'B38-反链跳转');

const B39 = g('TC-UI-039', '关系图页显示节点与引用统计');
await page.goto(BASE + '/#/graph', { waitUntil: 'domcontentloaded' });
await sleep(2200);
const gr = await page.evaluate(() => ({ body: document.body.innerText.replace(/\s+/g, ' '), svg: document.querySelectorAll('svg circle, svg line, svg path').length }));
const grHead = (gr.body.match(/\d+ 篇笔记 · \d+ 条引用/) || [''])[0];
rec(B39, !!grHead && gr.svg > 5, 'head=' + grHead + ' svg=' + gr.svg);
await shot(page, 'B39-关系图');

const B40 = g('TC-UI-040', '悬空 [[不存在的笔记]] 不报错');
await openNote(page, n1.id);
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('悬空引用 [[根本不存在的笔记]]');
await waitSaved(page);
await sleep(600);
const d40 = await page.evaluate(() => ({ err: /服务端异常/.test(document.body.innerText), side: !!document.querySelector('aside.kb-sidebar') }));
rec(B40, !d40.err && d40.side, JSON.stringify(d40));
await shot(page, 'B40-悬空链接');

// ---------- G. 历史版本（用 API 造 3 个版本，再验证 UI 的列表/查看/回滚） ----------
for (const c of ['版本A内容', '版本B内容', '版本C内容']) {
  await api(ctx, 'PATCH', '/api/notes/' + n1.id, { content: '# 天气观察\n重点 与普通文字\n' + c });
  await sleep(200);
}
const versApi = await api(ctx, 'GET', '/api/notes/' + n1.id + '/versions');
const vcountBefore = Array.isArray(versApi.body) ? versApi.body.length : 0;
const B41 = g('TC-UI-041', '历史版本页列出该笔记的多个版本');
await page.goto(BASE + '/#/versions?note=' + n1.id, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2200);
const v41 = await page.evaluate(() => ({ body: document.body.innerText.replace(/\s+/g, ' '), rows: [...document.querySelectorAll('button')].map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => /^v\d+ /.test(t)) }));
rec(B41, vcountBefore >= 3 && (v41.rows.length >= 3 || /\d+ 个版本/.test(v41.body)), 'API版本数=' + vcountBefore + ' 页面版本行=' + JSON.stringify(v41.rows.slice(0, 4)));
await shot(page, 'B41-版本列表');

const B42 = g('TC-UI-042', '可查看某个旧版本的全文');
let viewed42 = false;
const verRow = page.locator('button').filter({ hasText: /^v1\s/ }).first();
if (await verRow.count()) {
  await verRow.click().catch(() => {});
  await sleep(1800);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  viewed42 = /版本[ABC]内容|v1/.test(body) && body.length > 400;
} else {
  const anyVer = page.locator('button').filter({ hasText: /^v\d/ }).first();
  if (await anyVer.count()) { await anyVer.click().catch(() => {}); await sleep(1800); const b2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')); viewed42 = b2.length > 400; }
}
rec(B42, viewed42, 'bodyLen=' + (await page.evaluate(() => document.body.innerText.length)));
await shot(page, 'B42-查看旧版');

const B43 = g('TC-UI-043', '回滚到旧版本：正文改回旧内容');
const rollBtn = page.locator('button').filter({ hasText: /回滚到此版本/ }).first();
let rolled43 = false, rollNote = '未找到回滚按钮';
if (await rollBtn.count()) {
  await rollBtn.click().catch(() => {});
  await sleep(900);
  const dlg = page.locator('[role=dialog] button').filter({ hasText: /^回滚$|确定|确认/ }).first();
  if (await dlg.count()) { await dlg.click().catch(() => {}); }
  await sleep(2000);
  await openNote(page, n1.id);
  const txt = await editorText(page);
  const after = await api(ctx, 'GET', '/api/notes/' + n1.id);
  rolled43 = /版本[ABC]内容/.test(String(after.body.content || ''));
  rollNote = '回滚后服务端正文=' + JSON.stringify(String(after.body.content || '').slice(-30)) + ' version=' + after.body.version;
}
rec(B43, rolled43, rollNote);
await shot(page, 'B43-回滚后');

const B44 = g('TC-UI-044', '回滚本身产生新版本（版本数增加）');
const versAfter = await api(ctx, 'GET', '/api/notes/' + n1.id + '/versions');
const vcountAfter = Array.isArray(versAfter.body) ? versAfter.body.length : 0;
rec(B44, vcountAfter > vcountBefore, '回滚前=' + vcountBefore + ' 回滚后=' + vcountAfter);

const B45 = g('TC-UI-045', '直接修改地址栏 hash 切换笔记应生效（缺陷项）');
const noteA = await mkNote('路由A', 'AAA');
const noteB = await mkNote('路由B', 'BBB');
await openNote(page, noteA.id);
await page.goto(BASE + '/#/notes/' + noteB.id, { waitUntil: 'domcontentloaded' });
await sleep(2000);
const hash45 = await page.evaluate(() => location.hash);
const shown45 = await editorText(page);
const routed = hash45 === '#/notes/' + noteB.id && /BBB/.test(String(shown45 || ''));
rec(B45, routed, 'hash=' + hash45 + ' 编辑器内容=' + JSON.stringify(String(shown45 || '').slice(0, 40)));
await shot(page, 'B45-改hash切笔记');

const B48 = g('TC-UI-048', '搜索结果显示「共 N 条」计数');
const m48 = (s33.body.match(/共 (\d+) 条/) || [])[1];
rec(B48, !!m48 && Number(m48) > 0, '共N条=' + m48);

const B46 = g('TC-UI-046', 'B 段无未预期 pageerror / 5xx（405 单列）');
const u46 = unexpected(bag);
rec(B46, u46.pageerror.length === 0 && u46.http.filter((x) => /^5\d\d/.test(x)).length === 0, JSON.stringify({ pe: u46.pageerror.slice(0, 3), http: u46.http.slice(0, 8) }).slice(0, 400));

writeResults('e4-b-results.json');
console.log('TOTAL=' + results.length + ' PASS=' + results.filter((r) => r.ok).length + ' FAIL=' + results.filter((r) => !r.ok).length);
await ctx.close();
await browser.close();
