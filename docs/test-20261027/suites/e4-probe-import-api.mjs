import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, uiLogin, BASE, SHOTS, sleep } from './e4-lib.mjs';
const browser = await launch();
const { ctx, page } = await newPage(browser);
await uiLogin(page, 'alice', 'alice12345');
const md = path.join(SHOTS, '_e4-api-import.md');
fs.writeFileSync(md, '---\ntitle: E4-API导入笔记\ntags: [e4]\nfolder: E4测试目录\n---\n\n# E4-API导入笔记\n\n正文 [[E4目标笔记H1]]。\n', 'utf8');
const r = await page.evaluate(async (text) => {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'text/markdown' }), 'e4-api-import.md');
  const a = await fetch('/api/import/preview', { method: 'POST', body: fd });
  return { status: a.status, body: await a.json().catch(() => ({})) };
}, fs.readFileSync(md, 'utf8'));
console.log('PREVIEW=' + JSON.stringify(r).slice(0, 400));
const r2 = await page.evaluate(async (text) => {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'text/markdown' }), 'e4-api-import.md');
  const a = await fetch('/api/import/markdown', { method: 'POST', body: fd });
  return { status: a.status, body: await a.json().catch(() => ({})) };
}, fs.readFileSync(md, 'utf8'));
console.log('IMPORT=' + JSON.stringify(r2).slice(0, 300));
await sleep(500);
const lst = await page.evaluate(async () => { const r = await fetch('/api/notes?size=200'); const j = await r.json(); return (j.items || []).filter((n) => /E4-API导入/.test(n.title)).map((n) => n.id + ':' + n.title); });
console.log('AFTER=' + JSON.stringify(lst));
await ctx.close(); await browser.close();
