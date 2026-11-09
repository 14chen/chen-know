#!/usr/bin/env node
/** D 流浏览器验收：CSP 不破坏页面（登录/编辑器键入/Markdown 渲染/附件图片/深色主题/无 violation） */
import fs from 'node:fs';
import http from 'node:http';
const PW = 'file:///F:/devbox/ecms/node_modules/playwright/index.mjs';
const BASE = 'http://127.0.0.1:8534';
const OUT = 'D:\\work\\知识库\\docs\\test-20261028\\evidence\\d';
const SHOTS = OUT + '\\shots';
fs.mkdirSync(SHOTS, { recursive: true });
const rows = [];
const R = (n, ok, d) => { rows.push({ name: n, pass: !!ok, detail: d || '' }); console.log((ok ? '[PASS] ' : '[FAIL] ') + n + ' :: ' + String(d || '').slice(0, 200)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 极简 JSON 客户端（独立 cookie jar，不与浏览器上下文混用） ---- */
function httpJson(method, p, cookie, payload) {
  return new Promise((resolve) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const headers = {};
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    if (cookie) headers['Cookie'] = cookie;
    const req = http.request({ host: '127.0.0.1', port: 8534, method: method, path: p, headers: headers, timeout: 20000 }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        const sc = (res.headers['set-cookie'] || []).map((c) => String(c).split(';')[0]).join('; ');
        resolve({ status: res.statusCode, body: json, cookie: sc });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (body) req.write(body);
    req.end();
  });
}
async function apiLogin(u, p) { const r = await httpJson('POST', '/api/auth/login', '', { username: u, password: p }); return r && r.cookie; }
async function apiPost(p, cookie, payload) { const r = await httpJson('POST', p, cookie, payload); return r ? Object.assign({ status: r.status }, r.body || {}) : null; }

async function launch() {
  const { chromium } = await import(PW);
  for (const o of [{ channel: 'msedge' }, {}]) { try { return await chromium.launch(o); } catch (e) {} }
  throw new Error('no browser');
}

async function main() {
  const ts = Date.now().toString().slice(-6);
  const U = 'dui' + ts, P = 'Passw0rd#' + ts;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  const consoleErrors = [], pageErrors = [], httpErr = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) httpErr.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(BASE, '').split('?')[0]); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push({ directive: e.violatedDirective, blocked: String(e.blockedURI || '').slice(0, 90), sample: String(e.sample || '').slice(0, 60) });
    });
  });

  // 先用 d-verify 建好的 admin 拿邀请码，再注册 UI 用账号（首人之后注册必须有邀请码）
  const creds = JSON.parse(fs.readFileSync(OUT + '\\d-creds.json', 'utf8'));
  const adminCookie = await apiLogin(creds.admin, creds.password);
  if (!adminCookie) throw new Error('admin 登录失败，先跑 d-verify.mjs 生成 d-creds.json');
  const invite = await apiPost('/api/admin/invites', adminCookie, {});
  if (!invite || !invite.code) throw new Error('邀请码创建失败: ' + JSON.stringify(invite));
  const reg = await apiPost('/api/auth/register', '', { username: U, displayName: 'D界面', password: P, inviteCode: invite.code });
  R('注册 UI 测试账号（用 admin 邀请码）', reg && reg.status === 201, JSON.stringify(reg || {}).slice(0, 160));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name=username]', { timeout: 25000 });
  await page.fill('input[name=username]', U);
  await page.fill('input[name=password]', P);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForSelector('aside.kb-sidebar', { timeout: 30000 });
  await sleep(800);
  R('登录成功并进入主界面（aside.kb-sidebar 出现）', true, 'url=' + page.url());
  // 登录前 SPA 会探一次 /api/auth/me 得到 401（未登录的预期行为），从断言基线里清掉
  consoleErrors.length = 0; httpErr.length = 0; pageErrors.length = 0;

  // 同源 fetch 建笔记 + 传附件（同时验证 Origin 守卫不误杀真实前端）
  const noteId = await page.evaluate(async () => {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'CSP 验收笔记', content: '# 标题一\n\n正文段落\n' }) });
    const j = await r.json();
    return j && j.id;
  });
  R('浏览器同源 POST 建笔记成功（Origin 守卫不误杀前端）', !!noteId, 'noteId=' + noteId);
  const attId = await page.evaluate(async () => {
    const bin = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('file', new Blob([bin], { type: 'image/png' }), 'csp-test.png');
    fd.append('noteId', String(window.__noteId || ''));
    const r = await fetch('/api/attachments', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    return j && j.id;
  }).catch(() => null);
  R('浏览器同源 multipart 上传成功（附件 id 非空）', !!attId, 'attId=' + attId);

  // 写入含图片与列表的正文
  if (noteId) {
    await page.evaluate(async (args) => {
      const body = '# 标题一\n\n段落文字\n\n- 列表项甲\n- 列表项乙\n\n![](/api/attachments/' + args.att + ')\n';
      await fetch('/api/notes/' + args.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: body }) });
    }, { id: noteId, att: attId });
    await page.goto(BASE + '/#/notes/' + noteId, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cm-content', { timeout: 25000 });
    await sleep(1000);
    const state = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.cm-content img')].filter((i) => i.getAttribute('src'));
      return {
        editorReady: !!document.querySelector('.cm-content'),
        imgCount: imgs.length,
        imgLoaded: imgs.map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, broken: i.parentElement && i.parentElement.classList.contains('cm-kb-image-broken') })),
        text: (document.querySelector('.cm-content') || {}).textContent || ''
      };
    });
    R('编辑器渲染（CodeMirror .cm-content 就绪）', state.editorReady, '');
    R('Markdown 图片被渲染为 <img>', state.imgCount >= 1, JSON.stringify(state.imgLoaded).slice(0, 180));
    R('附件图片真正加载（naturalWidth > 0，img-src self 生效且未被拦）', state.imgLoaded.some((i) => i.w > 0), JSON.stringify(state.imgLoaded).slice(0, 180));
    R('图片未被判为 broken', !state.imgLoaded.some((i) => i.broken), '');

    // 键入
    await page.click('.cm-content');
    await page.keyboard.press('End');
    await page.keyboard.type(' CSP-TYPING-OK');
    await sleep(500);
    const typed = await page.evaluate(() => (document.querySelector('.cm-content') || {}).textContent || '');
    R('编辑器可键入（输入内容出现在编辑区）', typed.indexOf('CSP-TYPING-OK') >= 0, 'text 片段=' + typed.slice(-40));
    await page.screenshot({ path: SHOTS + '\\01-editor-light.png' }).catch(() => {});
  } else {
    R('（跳过后面的编辑器检查）', false, '建笔记失败');
  }

  // 深色主题：localStorage 写入后刷新，验证内联主题引导脚本在 CSP 下仍执行
  await page.evaluate(() => localStorage.setItem('kb.theme', '"dark"'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('aside.kb-sidebar', { timeout: 25000 });
  await sleep(600);
  const themeState = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('kb.theme') }));
  R('深色主题生效（内联主题脚本未被 CSP 拦：data-theme=dark）', themeState.attr === 'dark', JSON.stringify(themeState));
  await page.screenshot({ path: SHOTS + '\\02-editor-dark.png' }).catch(() => {});

  // 回到浅色并统计 violation
  await page.evaluate(() => localStorage.setItem('kb.theme', '"light"'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('aside.kb-sidebar', { timeout: 25000 });
  await sleep(600);
  const violations = await page.evaluate(() => window.__csp || []);
  R('无 Content-Security-Policy 违规（securitypolicyviolation 计数 = 0）', violations.length === 0, JSON.stringify(violations).slice(0, 300));
  R('无 JS 运行时错误（pageerror 为空）', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 240));
  R('无 console error', consoleErrors.length === 0, JSON.stringify(consoleErrors).slice(0, 240));
  R('页面未出现 4xx/5xx 请求', httpErr.length === 0, JSON.stringify(httpErr).slice(0, 240));
  await page.screenshot({ path: SHOTS + '\\03-after-light.png' }).catch(() => {});

  const pass = rows.filter((r) => r.pass).length;
  fs.writeFileSync(OUT + '\\d-browser-' + ts + '.json', JSON.stringify({ at: new Date().toISOString(), pass: pass, total: rows.length, rows: rows }, null, 1));
  console.log('RESULT ' + pass + '/' + rows.length);
  await browser.close();
  process.exit(pass === rows.length ? 0 : 1);
}
main().catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(2); });
