/** E4-C：回收站 / 导入导出 / 统计与成员 / 主题与移动端 / 健壮性 (TC-UI-049..069) */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, uiLogin, uiRegister, api, shot, t, results, writeResults, sleep, BASE, SHOTS, openNote, editorText, waitSaved, unexpected } from './e4-lib.mjs';

const browser = await launch();
const { ctx, page, bag } = await newPage(browser);
const g = (id, name) => ({ id, name });
const rec = (x, ok, note) => t(x.id, x.name, ok, note);
await uiLogin(page, 'alice', 'alice12345');

const nav = async (label, wait) => {
  await page.locator('nav.kb-nav button').filter({ hasText: label }).first().click();
  await sleep(wait || 1500);
};

// ---------- H. 回收站 ----------
const mk = await api(ctx, 'POST', '/api/notes', { title: 'E4回收站笔记', content: '待删除内容' });
const delId = mk.body.id;
await openNote(page, delId);
await page.locator('.kb-note-item--active').first().hover();
await sleep(300);
await page.locator('.kb-note-item--active').first().locator('.kb-note-item__more').click({ timeout: 8000 }).catch(() => {});
await sleep(500);
await page.locator('[role=menu] button').filter({ hasText: '删除' }).first().click().catch(() => {});
await sleep(600);
await page.locator('[role=dialog] button').filter({ hasText: /^(删除|确定)$/ }).first().click().catch(() => {});
await sleep(1500);

const C49 = g('TC-UI-049', '回收站列出已删笔记（含原目录与删除时间）');
await nav('回收站', 1800);
const tr = await page.evaluate(() => ({ body: document.body.innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean) }));
rec(C49, /E4回收站笔记/.test(tr.body) && tr.btns.some((x) => /恢复/.test(x)), '含已删笔记=' + /E4回收站笔记/.test(tr.body) + ' 按钮=' + JSON.stringify(tr.btns.filter((x) => /恢复|删除|清空/.test(x))));
await shot(page, 'C49-回收站列表');

const C50 = g('TC-UI-050', '回收站恢复笔记 → 回到笔记列表');
await page.locator('button').filter({ hasText: /^恢复$/ }).first().click().catch(async () => { await page.locator('button').filter({ hasText: /恢复/ }).first().click(); });
await sleep(1800);
const after50 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const back50 = await api(ctx, 'GET', '/api/notes/' + delId);
rec(C50, back50.status === 200, '恢复后笔记状态=' + back50.status + ' 回收站提示=' + (/回收站是空的|还没有/.test(after50) ? '已空' : '仍有条目'));
await shot(page, 'C50-恢复后');

const C51 = g('TC-UI-051', '清空回收站需二次确认');
await api(ctx, 'DELETE', '/api/notes/' + delId);
await sleep(400);
await nav('回收站', 1600);
const beforeClear = await page.evaluate(() => /E4回收站笔记/.test(document.body.innerText));
await page.locator('button').filter({ hasText: /清空回收站/ }).first().click().catch(() => {});
await sleep(900);
const dlg51 = await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return d ? { text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 100), btns: [...d.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean) } : null; });
await shot(page, 'C51-清空二次确认');
await page.locator('[role=dialog] button').filter({ hasText: /取消/ }).first().click().catch(() => {});
rec(C51, !!dlg51, '确认框=' + JSON.stringify(dlg51));

// ---------- I. 导入导出 ----------
const C52 = g('TC-UI-052', '导出整库 ZIP：文件真实下载且非 0 字节');
await nav('导入导出', 1800);
const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await page.locator('button').filter({ hasText: /导出全部（ZIP）|导出全部/ }).first().click().catch(() => {});
const file = await dl;
let zipInfo = null;
if (file) {
  const fp = path.join(SHOTS, 'export-all.zip');
  await file.saveAs(fp).catch(() => {});
  if (fs.existsSync(fp)) {
    const st = fs.statSync(fp);
    const head = fs.readFileSync(fp).subarray(0, 2).toString('latin1');
    zipInfo = { name: file.suggestedFilename(), bytes: st.size, isZip: head === 'PK' };
    fs.rmSync(fp, { force: true });
  }
}
rec(C52, !!zipInfo && zipInfo.bytes > 0 && zipInfo.isZip, JSON.stringify(zipInfo));
await shot(page, 'C52-导出ZIP');

const C53 = g('TC-UI-053', '导出入口：界面只有 ZIP（整库/单篇），无「导出单篇 .md」');
const ioBtns = await page.evaluate(() => [...document.querySelectorAll('main button, .kb-main button, section button')].map((b) => (b.innerText || '').trim()).filter(Boolean));
const ioAll = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean));
const hasZip = ioAll.some((x) => /导出.*ZIP|导出全部/.test(x));
const hasMdExport = ioAll.some((x) => /导出.*\.md|单篇.*\.md/.test(x));
rec(C53, hasZip && !hasMdExport, 'ZIP入口=' + hasZip + ' .md入口=' + hasMdExport + ' 主区按钮=' + JSON.stringify(ioBtns.slice(0, 10)));
await shot(page, 'C53-导出入口清点');

const C54 = g('TC-UI-054', '导入 .md：选择文件 → 预览 → 导入成功');
const mdPath = path.join(SHOTS, '_e4-import.md');
fs.writeFileSync(mdPath, '---\ntitle: E4导入笔记\ntags: [e4, 导入]\nfolder: E4测试目录\n---\n\n# E4导入笔记\n\n这是通过 UI 导入的正文，包含 [[E4来源链接]]。\n', 'utf8');
const mdInput = page.locator('input[type=file][accept*=".md"]').first();
const fileInputs = await page.locator('input[type=file]').count();
let imported = false, impNote = 'file inputs=' + fileInputs;
if (await mdInput.count()) {
  await mdInput.setInputFiles(mdPath).catch(() => {});
  await sleep(1500);
  const prev = page.locator('button').filter({ hasText: /预览导入内容/ }).first();
  if (await prev.count()) { await prev.click().catch(() => {}); await sleep(2500); }
  const prevText = await page.evaluate(() => document.querySelector('main') ? document.querySelector('main').innerText.replace(/\s+/g, ' ') : document.body.innerText.replace(/\s+/g, ' '));
  const confirmBtn = page.locator('main button, section button').filter({ hasText: /确认导入|开始导入|导入这份|导入$/ }).first();
  if (await confirmBtn.count()) { await confirmBtn.click().catch(() => {}); await sleep(3000); }
  const lst = await api(ctx, 'GET', '/api/notes?size=200');
  imported = (lst.body.items || []).some((n) => n.title === 'E4导入笔记');
  impNote = '预览含条目=' + /E4导入笔记/.test(prevText) + ' 导入后存在=' + imported + ' 预览片段=' + prevText.slice(0, 120);
}
rec(C54, imported, impNote);
await shot(page, 'C54-导入md');

const C55 = g('TC-UI-055', '导入非法文件给出可见错误（不静默失败）');
fs.writeFileSync(path.join(SHOTS, '_e4-bad.txt'), 'not a markdown file', 'utf8');
if (await page.locator('input[type=file][accept*=".md"]').count()) {
  await page.locator('input[type=file][accept*=".md"]').first().setInputFiles(path.join(SHOTS, '_e4-bad.txt')).catch(() => {});
  await sleep(1500);
  const prev2 = page.locator('button').filter({ hasText: /预览导入内容/ }).first();
  if (await prev2.count()) { await prev2.click().catch(() => {}); await sleep(2200); }
}
const badText = await page.evaluate(() => document.querySelector('main') ? document.querySelector('main').innerText.replace(/\s+/g, ' ') : document.body.innerText.replace(/\s+/g, ' '));
rec(C55, /不支持|错误|失败|仅支持|请选择/.test(badText), badText.slice(200, 420));
await shot(page, 'C55-导入非法文件');

// ---------- J. 统计与成员 ----------
const C57 = g('TC-UI-057', '统计页数值与 /api/stats 一致');
const stats = await api(ctx, 'GET', '/api/stats');
await nav('统计', 2000);
const st = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const nums = stats.body || {};
const ok57 = new RegExp('\\b' + nums.noteCount + '\\b').test(st) && new RegExp('\\b' + nums.tagCount + '\\b').test(st);
rec(C57, ok57, 'API noteCount=' + nums.noteCount + ' tagCount=' + nums.tagCount + ' trashCount=' + nums.trashCount + ' 页面片段=' + st.slice(120, 300));
await shot(page, 'C57-统计页');

const C58 = g('TC-UI-058', '成员管理列出用户、角色与操作按钮');
await nav('成员管理', 2000);
const ad = await page.evaluate(() => ({ body: document.body.innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean) }));
rec(C58, /alice/.test(ad.body) && /管理员/.test(ad.body) && ad.btns.some((x) => /编辑/.test(x)), 'haveAlice=' + /alice/.test(ad.body) + ' 按钮=' + JSON.stringify(ad.btns.filter((x) => /创建|邀请|编辑|停用|删除/.test(x)).slice(0, 8)));
await shot(page, 'C58-成员管理');

const C59 = g('TC-UI-059', '生成邀请码并显示');
let invitePost = 0;
const onReq = (r) => { if (r.method() === 'POST' && r.url().includes('/api/admin/invites')) invitePost += 1; };
page.on('request', onReq);
await page.locator('button').filter({ hasText: /生成邀请码/ }).first().click().catch(() => {});
await sleep(2500);
page.off('request', onReq);
const inviteInfo = await page.evaluate(() => ({ body: document.body.innerText.replace(/\s+/g, ' '), codes: [...document.querySelectorAll('code, [class*=code], input')].map((e) => (e.innerText || e.value || '').trim()).filter((x) => /^[A-Za-z0-9_-]{6,}$/.test(x)).slice(0, 5) }));
const inv = await api(ctx, 'GET', '/api/admin/invites');
const inviteList = (inv.body && (inv.body.items || inv.body)) || [];
rec(C59, invitePost > 0 && Array.isArray(inviteList) && inviteList.length > 0, 'POST次数=' + invitePost + ' API邀请码数=' + inviteList.length + ' 页面码=' + JSON.stringify(inviteInfo.codes));
await shot(page, 'C59-邀请码');

const C60 = g('TC-UI-060', '用邀请码注册第二个用户并登录成功');
const unused = inviteList.filter((x) => !x.used && !x.isUsed);
const pick = unused.length ? unused[unused.length - 1] : (inviteList.length ? inviteList[inviteList.length - 1] : null);
const invCode = pick ? (pick.code || pick.inviteCode) : null;
let reg2 = false, regNote = 'no invite code';
if (invCode) {
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage(); p2.setDefaultTimeout(20000);
  const uname = 'dave' + String(Date.now()).slice(-5);
  await uiRegister(p2, uname, '戴夫', 'dave12345', invCode);
  await sleep(2000);
  reg2 = await p2.evaluate(() => !!document.querySelector('aside.kb-sidebar'));
  regNote = 'invite=' + invCode + ' 进入主界面=' + reg2;
  await p2.screenshot({ path: path.join(SHOTS, 'C60-邀请码注册.png') });
  await ctx2.close();
}
rec(C60, reg2, regNote);

// ---------- K. 主题与移动端 ----------
const C61 = g('TC-UI-061', '深色主题选择在刷新后保持');
const th = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
if (th !== 'dark') {
  await page.locator('button[title*="深色"]').first().click().catch(() => {});
  for (let i = 0; i < 20; i++) { const v = await page.evaluate(() => document.documentElement.getAttribute('data-theme')); if (v === 'dark') break; await sleep(300); }
}
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('aside.kb-sidebar', { timeout: 20000 }).catch(() => {});
await sleep(1200);
const th2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
rec(C61, th2 === 'dark', '刷新前=' + th + ' 刷新后=' + th2);
await shot(page, 'C61-深色主题持久化');

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mctx.newPage(); mp.setDefaultTimeout(20000);
await uiLogin(mp, 'alice', 'alice12345');
const mob = await mp.evaluate(() => { const de = document.documentElement; const side = document.querySelector('aside.kb-sidebar'); const b = side ? side.getBoundingClientRect() : null; return { overflow: de.scrollWidth - de.clientWidth, vw: de.clientWidth, sideX: b ? Math.round(b.x) : null, burger: !!document.querySelector('button[aria-label*="菜单"], button[title*="菜单"]') }; });
const C62 = g('TC-UI-062', '390×844 首页无横向溢出且侧栏收起为抽屉');
rec(C62, mob.overflow <= 1 && mob.sideX !== null && mob.sideX < 0 && mob.burger, JSON.stringify(mob));
await mp.screenshot({ path: path.join(SHOTS, 'C62-移动端首页.png') });

const C63 = g('TC-UI-063', '移动端汉堡按钮可打开抽屉侧栏');
await mp.locator('button[aria-label*="菜单"], button[title*="菜单"]').first().click().catch(() => {});
await sleep(900);
const drawer = await mp.evaluate(() => { const s = document.querySelector('aside.kb-sidebar'); const b = s ? s.getBoundingClientRect() : null; return { x: b ? Math.round(b.x) : null, w: b ? Math.round(b.width) : null, open: b ? b.x >= 0 : false }; });
rec(C63, !!drawer.open, JSON.stringify(drawer));
await mp.screenshot({ path: path.join(SHOTS, 'C63-移动端抽屉.png') });
await mp.locator('button[aria-label*="收起"], button[title*="收起"], [class*=drawer-mask], .kb-drawer__mask').first().click().catch(() => {});
await sleep(600);

const C64 = g('TC-UI-064', '移动端编辑器可输入并保存');
const mNote = await api(ctx, 'POST', '/api/notes', { title: 'E4移动端笔记', content: '移动端初始' });
await mp.goto(BASE + '/#/notes/' + mNote.body.id, { waitUntil: 'domcontentloaded' });
await mp.reload({ waitUntil: 'domcontentloaded' });
await mp.waitForSelector('.cm-content', { timeout: 25000 }).catch(() => {});
await sleep(1200);
let mSaved = false, mNote2 = '';
if (await mp.locator('.cm-content').count()) {
  await mp.locator('.cm-content').click();
  await mp.keyboard.press('Control+End');
  await mp.keyboard.type(' 手机端输入ABC');
  for (let i = 0; i < 40; i++) { const s = await mp.evaluate(() => (document.body.innerText.match(/已保存/g) || [''])[0]); if (s === '已保存') { mSaved = true; break; } await sleep(300); }
  await sleep(800);
  const chk = await api(ctx, 'GET', '/api/notes/' + mNote.body.id);
  mNote2 = '服务端含输入=' + String(chk.body.content || '').includes('手机端输入ABC');
}
rec(C64, mSaved, mNote2);
await mp.screenshot({ path: path.join(SHOTS, 'C64-移动端编辑器.png') });
await mctx.close();

// ---------- L. 健壮性 ----------
const C69 = g('TC-UI-069', '定位 405 /api/folders/tree 的触发页面（缺陷项）');
const pages = ['搜索', '标签', '收藏', '最近浏览', '反链', '关系图', '历史版本', '回收站', '导入导出', '统计', '成员管理'];
const hit405 = [];
for (const nm of pages) {
  const before = bag.http.length;
  await nav(nm, 1400);
  const news = bag.http.slice(before).filter((x) => /405/.test(x));
  if (news.length) hit405.push(nm + ':' + news[0]);
}
rec(C69, hit405.length === 0, '触发页=' + JSON.stringify(hit405));

const C65 = g('TC-UI-065', '逐页遍历无 pageerror / 无 5xx');
const u65 = unexpected(bag);
rec(C65, u65.pageerror.length === 0 && u65.http.filter((x) => /^5\d\d/.test(x)).length === 0, JSON.stringify({ pe: u65.pageerror.slice(0, 3), http: u65.http.slice(0, 8) }).slice(0, 400));

const C66 = g('TC-UI-066', '接口 500 时有兜底提示，不白屏');
const ctxE = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pE = await ctxE.newPage(); pE.setDefaultTimeout(20000);
await uiLogin(pE, 'alice', 'alice12345');
await pE.route('**/api/stats', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '服务端异常' } }) }).catch(() => {}));
await pE.goto(BASE + '/#/stats', { waitUntil: 'domcontentloaded' });
await sleep(2500);
const e66 = await pE.evaluate(() => ({ body: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' '), side: !!document.querySelector('aside.kb-sidebar') }));
rec(C66, e66.side && /失败|错误|异常|重试/.test(e66.body), e66.body.slice(0, 200));
await pE.screenshot({ path: path.join(SHOTS, 'C66-接口500兜底.png') });

const C67 = g('TC-UI-067', '接口断链（abort）时给出兜底提示');
await pE.unroute('**/api/stats').catch(() => {});
await pE.route('**/api/notes**', (r) => r.abort('failed').catch(() => {}));
await pE.goto(BASE + '/#/notes', { waitUntil: 'domcontentloaded' });
await sleep(2500);
const e67 = await pE.evaluate(() => ({ body: (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' '), side: !!document.querySelector('aside.kb-sidebar') }));
rec(C67, e67.side && /失败|错误|网络|重试/.test(e67.body), e67.body.slice(0, 200));
await pE.screenshot({ path: path.join(SHOTS, 'C67-断链兜底.png') });
await ctxE.close();

const C68 = g('TC-UI-068', '不存在的 hash 路由不白屏');
await page.goto(BASE + '/#/this-route-does-not-exist', { waitUntil: 'domcontentloaded' });
await sleep(1800);
const e68 = await page.evaluate(() => ({ body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200), len: document.body.innerText.trim().length, side: !!document.querySelector('aside.kb-sidebar') }));
rec(C68, e68.len > 10, JSON.stringify(e68).slice(0, 240));
await shot(page, 'C68-未知路由');

writeResults('e4-c-results.json');
console.log('TOTAL=' + results.length + ' PASS=' + results.filter((r) => r.ok).length + ' FAIL=' + results.filter((r) => !r.ok).length);
await ctx.close();
await browser.close();
