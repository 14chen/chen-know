/** E4-A：认证 / 主界面布局 / 笔记全流程  (TC-UI-001..022) */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, uiLogin, uiRegister, api, shot, t, results, writeResults, sleep, BASE, editorText, waitSaved, unexpected } from './e4-lib.mjs';

const ADMIN = { u: 'alice', n: '爱丽丝', p: 'alice12345' };
const browser = await launch();
const { ctx, page, bag } = await newPage(browser);
const g = (id, name) => ({ id, name });
const rec = (x, ok, note) => t(x.id, x.name, ok, note);
const submitBtn = (label) => page.evaluate((L) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === L && x.type === 'submit');
  return b ? { disabled: b.disabled, found: true } : { found: false };
}, label);
const errText = () => page.evaluate(() => [...document.querySelectorAll('[role=alert], .kb-field__error, [class*=error]')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));

// ---------- A. 登录 / 注册页 ----------
const A01 = g('TC-UI-001', '登录页字段与说明文案完整');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name=username]');
const loginUi = await page.evaluate(() => ({
  user: !!document.querySelector('input[name=username]'),
  pwd: document.querySelectorAll('input[type=password]').length,
  tabs: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
  hint: (document.body.innerText.replace(/\s+/g, ' ').match(/登录状态[^。]*/) || [''])[0],
  ph: [...document.querySelectorAll('input')].map((e) => e.placeholder)
}));
rec(A01, loginUi.user && loginUi.pwd >= 1 && loginUi.tabs.includes('登录') && loginUi.tabs.includes('注册') && !!loginUi.hint, JSON.stringify(loginUi));
await shot(page, 'A01-登录页');

const A02 = g('TC-UI-002', '登录空表单：提交按钮禁用（前端第一道校验）');
const e2 = await submitBtn('登录');
await page.fill('input[name=username]', ADMIN.u);
const e2b = await submitBtn('登录');
await page.fill('input[name=password]', ADMIN.p);
const e2c = await submitBtn('登录');
rec(A02, e2.disabled === true && e2b.disabled === true && e2c.disabled === false, '空=' + JSON.stringify(e2) + ' 仅账号=' + JSON.stringify(e2b) + ' 填满=' + JSON.stringify(e2c));
await shot(page, 'A02-登录-空表单禁用');

const A03 = g('TC-UI-003', '登录：密码错误 → 提示「用户名或密码错误」且不进入');
await page.fill('input[name=password]', 'wrongpass1');
await page.getByRole('button', { name: '登录', exact: true }).click();
await sleep(1500);
const r3 = { errs: await errText(), side: await page.evaluate(() => !!document.querySelector('aside.kb-sidebar')) };
rec(A03, !r3.side && r3.errs.some((x) => /用户名或密码错误/.test(x)), JSON.stringify(r3));
await shot(page, 'A03-登录-密码错误');

const A04 = g('TC-UI-004', '注册：用户名合法但密码过短(<8) → 可见校验提示');
await uiRegister(page, 'bobby', '鲍比', '123', '');
const r4 = { errs: await errText(), side: await page.evaluate(() => !!document.querySelector('aside.kb-sidebar')) };
rec(A04, !r4.side && r4.errs.some((x) => /密码/.test(x)), JSON.stringify(r4));
await shot(page, 'A04-注册-密码过短');

const A05 = g('TC-UI-005', '注册：用户名过短(<3) → 提示「用户名需 3–32 位…」');
await uiRegister(page, 'ab', '阿', 'abc12345x', '');
const r5 = { errs: await errText(), side: await page.evaluate(() => !!document.querySelector('aside.kb-sidebar')) };
rec(A05, !r5.side && r5.errs.some((x) => /用户名需 3/.test(x)), JSON.stringify(r5));
await shot(page, 'A05-注册-用户名过短');

const A06 = g('TC-UI-006', '空库首位注册者免邀请码且自动成为管理员');
await uiRegister(page, ADMIN.u, ADMIN.n, ADMIN.p, '');
await page.waitForSelector('aside.kb-sidebar', { timeout: 25000 }).catch(() => {});
await sleep(1200);
const r6 = await page.evaluate(() => ({
  side: !!document.querySelector('aside.kb-sidebar'),
  hash: location.hash,
  hasAdmin: [...document.querySelectorAll('button')].some((b) => /成员管理/.test(b.innerText || b.getAttribute('aria-label') || '')),
  userText: (document.body.innerText.replace(/\s+/g, ' ').match(/[\w\u4e00-\u9fa5]+@\w+/) || [''])[0]
}));
rec(A06, r6.side && r6.hasAdmin, JSON.stringify(r6));
await shot(page, 'A06-首位注册-成为管理员');

// 注册类用例需要"未登录"上下文（已登录时访问 / 会进主界面）
const A07 = g('TC-UI-007', '注册：用户名重复 → 提示「用户名已存在」');
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageB = await ctxB.newPage(); pageB.setDefaultTimeout(20000);
await uiRegister(pageB, ADMIN.u, '另一个', 'other12345', '');
await sleep(800);
const r7 = {
  errs: await pageB.evaluate(() => [...document.querySelectorAll('[role=alert], .kb-field__error, [class*=error]')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)),
  side: await pageB.evaluate(() => !!document.querySelector('aside.kb-sidebar'))
};
rec(A07, !r7.side && r7.errs.some((x) => /用户名已存在/.test(x)), JSON.stringify(r7));
await pageB.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/07-A07-注册-用户名重复.png' });
await ctxB.close();

const A08 = g('TC-UI-008', '注册：库中已有用户时邀请码为空 → 提示「需要邀请码才能注册」');
const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageC = await ctxC.newPage(); pageC.setDefaultTimeout(20000);
await uiRegister(pageC, 'carol', '卡罗尔', 'carol12345', '');
await sleep(1400);
const r8 = {
  errs: await pageC.evaluate(() => [...document.querySelectorAll('[role=alert], .kb-field__error, [class*=error]')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)),
  side: await pageC.evaluate(() => !!document.querySelector('aside.kb-sidebar'))
};
rec(A08, !r8.side && r8.errs.some((x) => /邀请码/.test(x)), JSON.stringify(r8));
await pageC.screenshot({ path: 'D:/work/知识库/docs/test-20261027/evidence/e4/shots/08-A08-注册-缺邀请码.png' });
await ctxC.close();

const A09 = g('TC-UI-009', '退出登录后正确凭据登录 → 进入主界面且侧栏导航齐全');
await page.locator('button[aria-label="退出登录"]').first().click();
await page.waitForSelector('[role=dialog]', { timeout: 15000 });
const logoutDialog = await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return { text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 120), btns: [...d.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean) }; });
await shot(page, 'A09-退出登录二次确认');
await page.locator('[role=dialog] button').filter({ hasText: '退出登录' }).first().click();
await page.waitForSelector('input[name=username]', { timeout: 20000 });
const a09loggedOut = await page.evaluate(() => !document.querySelector('aside.kb-sidebar'));
console.log('LOGOUT_DIALOG=' + JSON.stringify(logoutDialog));
await uiLogin(page, ADMIN.u, ADMIN.p);
const r9 = await page.evaluate(() => ({ side: !!document.querySelector('aside.kb-sidebar'), navCount: document.querySelectorAll('nav.kb-nav button').length }));
rec(A09, a09loggedOut && r9.side && r9.navCount >= 11, JSON.stringify({ a09loggedOut, r9 }));
await shot(page, 'A09-登录成功');

// 空库需要先有一篇笔记：用 UI 新建，拿真实 id
await page.locator('button[title="新建笔记"], button[aria-label*="新建笔记"]').first().click();
await page.waitForFunction(() => /#\/notes\/\d+/.test(location.hash), null, { timeout: 20000 });
await page.waitForSelector('.cm-content', { timeout: 20000 });
await sleep(1000);
const noteId = Number(await page.evaluate(() => location.hash.split('/').pop()));

// ---------- B. 主界面结构 ----------
const A10 = g('TC-UI-010', '四块布局：侧栏/目录树/笔记列表/编辑器互不重叠');
await page.goto(BASE + '/#/notes/' + noteId, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 20000 });
await sleep(900);
const layout = await page.evaluate(() => {
  const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { side: box('aside.kb-sidebar'), tree: box('.kb-tree'), editor: box('.cm-editor'), top: box('.kb-topbar'), vw: innerWidth };
});
const ok10 = !!layout.side && !!layout.tree && !!layout.editor && layout.side.x + layout.side.w <= layout.editor.x + 1 && layout.editor.w > 400;
rec(A10, ok10, JSON.stringify(layout));
await shot(page, 'A10-四块布局');

const A11 = g('TC-UI-011', '侧栏导航入口齐全（管理员 12 项）');
const navs = await page.evaluate(() => [...document.querySelectorAll('nav.kb-nav button')].map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()));
const need = ['搜索', '标签', '收藏', '最近浏览', '反链', '关系图', '历史版本', '回收站', '导入导出', '统计', '成员管理'];
rec(A11, need.every((x) => navs.includes(x)), 'count=' + navs.length + ' ' + JSON.stringify(navs));

const A12 = g('TC-UI-012', '刷新后保持当前路由（#/notes/<id>）');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 20000 });
await sleep(900);
const r12 = await page.evaluate(() => ({ hash: location.hash, editor: !!document.querySelector('.cm-content') }));
rec(A12, r12.hash === '#/notes/' + noteId && r12.editor, JSON.stringify({ r12, noteId }));
await shot(page, 'A12-刷新保持路由');

const A13 = g('TC-UI-013', '左栏收起/展开按钮生效');
const b13 = await page.evaluate(() => { const e = document.querySelector('aside.kb-sidebar'); const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; });
await page.locator('button[aria-label="展开/收起左栏"]').first().click().catch(() => {});
await sleep(800);
const a13 = await page.evaluate(() => { const e = document.querySelector('aside.kb-sidebar'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; });
rec(A13, !!a13 && (a13.w !== b13.w || a13.x !== b13.x), JSON.stringify({ b13, a13 }));
await shot(page, 'A13-左栏收起');
await page.locator('button[aria-label="展开/收起左栏"]').first().click().catch(() => {});
await sleep(600);

const A14 = g('TC-UI-014', '宽屏按钮扩大编辑器宽度');
const w0 = await page.evaluate(() => Math.round((document.querySelector('.cm-editor') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width));
await page.locator('button[aria-label*="宽屏"]').first().click().catch(() => {});
await sleep(800);
const w1 = await page.evaluate(() => Math.round((document.querySelector('.cm-editor') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width));
rec(A14, w1 !== w0, 'before=' + w0 + ' after=' + w1);
await shot(page, 'A14-宽屏');
await page.locator('button[aria-label*="宽屏"]').first().click().catch(() => {});
await sleep(500);

const A15 = g('TC-UI-015', '深色主题切换生效');
const th0 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
await page.locator('button[title*="深色"]').first().click().catch(() => {});
await sleep(800);
const th1 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
rec(A15, th0.bg !== th1.bg || th0.attr !== th1.attr, JSON.stringify({ th0, th1 }));
await shot(page, 'A15-深色主题');
await page.locator('button[title*="深色"], button[title*="浅色"]').first().click().catch(() => {});
await sleep(600);

// ---------- C. 笔记全流程 ----------
const A16 = g('TC-UI-016', '新建笔记：路由切到新笔记且列表 +1');
const cnt0 = await page.evaluate(() => document.querySelectorAll('.kb-note-item').length);
await page.locator('button[title="新建笔记"], button[aria-label*="新建笔记"]').first().click();
await page.waitForFunction(() => /#\/notes\/\d+/.test(location.hash), null, { timeout: 20000 }).catch(() => {});
await sleep(1200);
const r16 = await page.evaluate(() => ({ hash: location.hash, cnt: document.querySelectorAll('.kb-note-item').length, editor: !!document.querySelector('.cm-content') }));
rec(A16, /#\/notes\/\d+/.test(r16.hash) && r16.cnt === cnt0 + 1 && r16.editor, JSON.stringify({ cnt0, r16 }));
await shot(page, 'A16-新建笔记');
const newId = Number(r16.hash.split('/').pop());

const A17 = g('TC-UI-017', '写正文 → 显示未保存 → 自动保存为已保存');
await page.locator('.cm-content').click();
await page.keyboard.type('E4 自动化正文：今天天气很好，适合测试中文检索。');
await sleep(400);
const st17 = await page.evaluate(() => (document.body.innerText.match(/未保存|已保存|保存中/g) || ['NONE'])[0]);
const saved17 = await waitSaved(page);
rec(A17, saved17, '首次=' + st17 + ' 最终=' + (saved17 ? '已保存' : '超时'));
await shot(page, 'A17-已保存');

const A18 = g('TC-UI-018', '刷新后正文内容与保存前一致');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 20000 });
await sleep(1300);
const txt18 = await editorText(page);
rec(A18, !!txt18 && txt18.includes('今天天气很好'), 'len=' + String(txt18 || '').length + ' head=' + String(txt18 || '').replace(/\n/g, ' ').slice(0, 70));

const A19 = g('TC-UI-019', '界面提供修改笔记标题的入口（缺陷项）');
await page.locator('.kb-note-item').first().hover();
await sleep(300);
await page.locator('.kb-note-item__more').first().click({ timeout: 8000 }).catch(() => {});
await sleep(700);
const menuItems = await page.evaluate(() => { const m = document.querySelector('[role=menu]'); return m ? [...m.querySelectorAll('button,[role=menuitem]')].map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : []; });
await shot(page, 'A19-笔记项菜单');
await page.keyboard.press('Escape').catch(() => {});
const titleEntry = await page.evaluate(() => ({
  topbarTag: (document.querySelector('.kb-topbar__subject') || {}).tagName || null,
  titleInputs: document.querySelectorAll('input[name=title], input[placeholder*="标题"]').length,
}));
rec(A19, menuItems.some((x) => /重命名|改名|标题/.test(x)) || titleEntry.titleInputs > 0,
  '笔记项菜单=' + JSON.stringify(menuItems) + ' 标题输入框数=' + titleEntry.titleInputs + ' 顶部标题元素=' + titleEntry.topbarTag);

const A20 = g('TC-UI-020', '删除笔记：弹出二次确认并删除成功');
await page.locator('.kb-note-item').first().hover();
await sleep(300);
await page.locator('.kb-note-item__more').first().click({ timeout: 8000 }).catch(() => {});
await sleep(500);
await page.locator('[role=menu] button').filter({ hasText: '删除' }).first().click().catch(() => {});
await sleep(900);
const confirm20 = await page.evaluate(() => {
  const d = document.querySelector('[role=dialog], .kb-modal, [class*=confirm]');
  return d ? { text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 160), btns: [...d.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean) } : null;
});
await shot(page, 'A20-删除二次确认');
if (confirm20) {
  await page.locator('[role=dialog] button, .kb-modal button, [class*=confirm] button').filter({ hasText: /^(删除|确定)$/ }).first().click().catch(() => {});
  await sleep(1500);
}
const r20 = await page.evaluate(() => ({ cnt: document.querySelectorAll('.kb-note-item').length }));
rec(A20, !!confirm20 && r20.cnt === cnt0, JSON.stringify({ confirm20, r20 }));

const A21 = g('TC-UI-021', '回收站列出已删除笔记并可恢复');
await page.locator('nav.kb-nav button').filter({ hasText: '回收站' }).first().click();
await sleep(1400);
const trashText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
const restoreCnt = await page.locator('button').filter({ hasText: /恢复/ }).count();
await shot(page, 'A21-回收站');
let restored = false;
if (restoreCnt) {
  await page.locator('button').filter({ hasText: /恢复/ }).first().click();
  await sleep(1500);
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
  restored = /回收站是空的|还没有/.test(after) || !/恢复/.test(after);
}
rec(A21, restoreCnt > 0 && restored, '列表=' + trashText.slice(0, 120) + ' 恢复按钮数=' + restoreCnt);

// 专门验证：删除"当前打开"的笔记后的界面与请求行为
const A23 = g('TC-UI-023', '删除当前打开的笔记后应切到空态且不再请求已删笔记（缺陷项）');
await page.goto(BASE + '/#/notes/' + newId, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 20000 });
await sleep(800);
bag.http.length = 0; bag.console.length = 0;
const activeItem = page.locator('.kb-note-item--active').first();
const hasActive = await activeItem.count();
await (hasActive ? activeItem : page.locator('.kb-note-item').first()).hover();
await sleep(300);
await (hasActive ? activeItem : page.locator('.kb-note-item').first()).locator('.kb-note-item__more').click({ timeout: 8000 }).catch(() => {});
await sleep(500);
await page.locator('[role=menu] button').filter({ hasText: '删除' }).first().click().catch(() => {});
await sleep(700);
await page.locator('[role=dialog] button').filter({ hasText: /^(删除|确定)$/ }).first().click().catch(() => {});
await sleep(3000);
const afterDel = {
  http: bag.http.slice(),
  console: bag.console.slice(),
  hash: await page.evaluate(() => location.hash),
  editor: await page.evaluate(() => !!document.querySelector('.cm-content')),
  bodyText: await page.evaluate(() => document.body.innerText.replace(/s+/g, ' ').slice(0, 120))
};
const ghostReqs = afterDel.http.filter((x) => x.includes('/api/notes/' + newId));
rec(A23, ghostReqs.length === 0, '已删笔记残留请求=' + JSON.stringify(ghostReqs) + ' hash=' + afterDel.hash + ' editor=' + afterDel.editor + ' 全部4xx=' + JSON.stringify(afterDel.http.slice(0, 4)));
await shot(page, 'A23-删除当前笔记后');

const A22 = g('TC-UI-022', '主界面 A 段无 pageerror / 无 5xx（负向用例产生的 401 已排除）');
const u22 = unexpected(bag);
const fivexx = u22.http.filter((x) => /^5\d\d/.test(x));
rec(A22, u22.pageerror.length === 0 && fivexx.length === 0, JSON.stringify({ pageerror: u22.pageerror, fivexx, allHttp: u22.http.slice(0, 6), console: u22.console.slice(0, 4) }));

writeResults('e4-a-results.json');
console.log('TOTAL=' + results.length + ' PASS=' + results.filter((r) => r.ok).length + ' FAIL=' + results.filter((r) => !r.ok).length + ' newNoteId=' + newId);
await ctx.close();
await browser.close();
