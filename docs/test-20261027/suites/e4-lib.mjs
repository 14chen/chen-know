/** E4 公共库：浏览器/登录/API/截图/断言 */
import fs from 'node:fs';
import path from 'node:path';

export const PW = 'file:///F:/devbox/ecms/node_modules/playwright/index.mjs';
export const BASE = process.env.KB_BASE || 'http://127.0.0.1:8505';
export const EV = 'D:/work/知识库/docs/test-20261027/evidence/e4';
export const SHOTS = path.join(EV, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const results = [];
export let shotSeq = 0;

export function t(id, name, ok, note) {
  results.push({ id, name, ok: !!ok, note: note === undefined ? '' : String(note).slice(0, 500) });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + id + ' ' + name + (note ? '  (' + String(note).slice(0, 220) + ')' : ''));
}
export function writeResults(file) {
  fs.writeFileSync(path.join(EV, file), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
}

export async function launch() {
  const { chromium } = await import(PW);
  for (const o of [{ channel: 'msedge' }, {}]) {
    try { return await chromium.launch(o); } catch (e) {}
  }
  throw new Error('no browser');
}

export async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const bag = { console: [], pageerror: [], http: [] };
  page.on('console', (m) => { if (m.type() === 'error') bag.console.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => bag.pageerror.push(String(e.message).slice(0, 160)));
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400) bag.http.push(s + ' ' + r.request().method() + ' ' + r.url().replace(BASE, '').split('?')[0]);
  });
  return { ctx, page, bag };
}

export async function shot(page, name) {
  shotSeq += 1;
  const f = String(shotSeq).padStart(2, '0') + '-' + name.replace(/[\\/:*?"<>|\s]+/g, '-') + '.png';
  await page.screenshot({ path: path.join(SHOTS, f) }).catch(() => {});
  return f;
}

export async function uiLogin(page, username, password) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name=username]', { timeout: 20000 });
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForSelector('aside.kb-sidebar', { timeout: 25000 });
  await sleep(700);
}

export async function uiRegister(page, username, displayName, password, inviteCode) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByText('注册', { exact: true }).first().click();
  await page.waitForSelector('input[name=displayName]', { timeout: 15000 });
  await page.fill('input[name=username]', username);
  await page.fill('input[name=displayName]', displayName);
  await page.fill('input[name=password]', password);
  if (inviteCode) await page.fill('input[name=inviteCode]', inviteCode);
  await page.getByRole('button', { name: '注册并登录' }).click();
  await sleep(1500);
}

/** 用浏览器上下文的 cookie 做 API 调用（与 UI 同一会话） */
export async function api(ctx, method, p, data) {
  const r = await ctx.request.fetch(BASE + p, { method, data, headers: data ? { 'content-type': 'application/json' } : undefined });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status(), body };
}
export async function apiLoginReq(browser, username, password) {
  const ctx = await browser.newContext();
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { username, password }, headers: { 'content-type': 'application/json' } });
  return { ctx, status: r.status(), body: await r.json().catch(() => null) };
}
export async function noteByTitle(page, title) {
  const r = await api(page.context(), 'GET', '/api/notes?size=200');
  const items = (r.body && (r.body.items || r.body)) || [];
  return items.find((n) => n.title === title);
}
/** 打开笔记：goto 后强制 reload，避免"仅改 hash 不切换笔记"的前端行为污染用例 */
export async function openNote(page, id) {
  await page.goto(BASE + '/#/notes/' + id, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-content', { timeout: 25000 });
  await sleep(800);
}
export async function editorText(page) {
  return page.evaluate(() => { const c = document.querySelector('.cm-content'); return c ? c.innerText : null; });
}
export async function typeBody(page, text) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
  await sleep(300);
}
export async function waitSaved(page, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await page.evaluate(() => document.body.innerText.match(/已保存|保存中|未保存|保存失败/g));
    if (st && st.includes('已保存')) return true;
    await sleep(250);
  }
  return false;
}
export const ERRWHITELIST = [/401 \/api\/auth\/me/, /401.*auth\/me/];
export function unexpected(bag) {
  const http = bag.http.filter((x) => !ERRWHITELIST.some((re) => re.test(x)));
  const con = bag.console.filter((t) => !/Failed to load resource: the server responded with a status of 401/.test(t));
  return { console: con, pageerror: bag.pageerror.slice(), http };
}
