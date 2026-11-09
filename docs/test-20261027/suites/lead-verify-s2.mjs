
import fs from 'node:fs';
const BASE = process.env.KB_BASE || 'http://127.0.0.1:8510';
let cookie = '';
async function req(method, p, body, opts) {
  const h = { ...(opts && opts.headers) };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  for (const c of sc) { const m = /^([^=]+=[^;]+)/.exec(c); if (m) cookie = m[1]; }
  let j = null, t = '';
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) { try { j = await r.json(); } catch {} } else { t = await r.text(); }
  return { status: r.status, json: j, text: t };
}
const log = [];
const P = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

(async () => {
  // 0. 首人自动 admin
  const reg = await req('POST', '/api/auth/register', { username: 'leadcheck', password: 'Lead1234!', displayName: 'leadcheck' });
  P('register ->', reg.status, JSON.stringify(reg.json || {}).slice(0, 120));
  const lg = await req('POST', '/api/auth/login', { username: 'leadcheck', password: 'Lead1234!' });
  P('login ->', lg.status, 'cookie=' + (cookie ? 'set' : 'MISSING'));

  // 1) DEF-E4-001：API 是否支持改标题？UI 无入口是否属实（这里只能验 API 侧）
  const c1 = await req('POST', '/api/notes', { title: '原名ABC', content: 'body-1', folderId: 0 });
  const id1 = c1.json?.id ?? c1.json?.noteId ?? c1.json?.data?.id;
  P('create note ->', c1.status, 'id=' + id1);
  const p1 = await req('PATCH', '/api/notes/' + id1, { title: '改名XYZ' });
  P('PATCH title ->', p1.status, JSON.stringify(p1.json || {}).slice(0, 160));
  const g1 = await req('GET', '/api/notes/' + id1);
  P('  title after PATCH =', JSON.stringify(g1.json?.title ?? g1.json?.data?.title));

  // 2) DEF-E1-002：空 .md 导入是否落空笔记、skipped 恒 0
  const fd = new FormData();
  fd.append('file', new Blob(['   \n\n'], { type: 'text/markdown' }), 'empty.md');
  const imp = await req('POST', '/api/import/markdown', fd);
  P('import empty.md ->', imp.status, JSON.stringify(imp.json || {}).slice(0, 200));

  // 3) DEF-E4-002：同名笔记 + [[标题]] 是否丢链
  const a = await req('POST', '/api/notes', { title: '重名笔记Z', content: 'A', folderId: 0 });
  const b = await req('POST', '/api/notes', { title: '重名笔记Z', content: 'B', folderId: 0 });
  const c = await req('POST', '/api/notes', { title: '引用者Z', content: '见 [[重名笔记Z]] 与 [[不存在的标题Z]]', folderId: 0 });
  const cid = c.json?.id ?? c.json?.noteId ?? c.json?.data?.id;
  await new Promise(r => setTimeout(r, 500));
  const link = await req('GET', '/api/notes/' + cid + '/links');
  P('links for 引用者Z ->', link.status, JSON.stringify(link.json || {}).slice(0, 300));

  // 4) DEF-E3-001 轻量版：大正文是否拖慢搜索（先测基线，再插大笔记，再测）
  const t1 = Date.now(); await req('GET', '/api/search?q=' + encodeURIComponent('天气')); const base = Date.now() - t1;
  const big = '天'.repeat(300000) + ' 天气 ' + '气'.repeat(300000);
  const nb = await req('POST', '/api/notes', { title: '大笔记Z', content: big, folderId: 0 });
  await new Promise(r => setTimeout(r, 800));
  const t2 = Date.now(); await req('GET', '/api/search?q=' + encodeURIComponent('天气')); const after = Date.now() - t2;
  P('search 1KB-note baseline =', base + 'ms', '| after inserting ~600KB note =', after + 'ms', '| big note status =', nb.status);
  fs.writeFileSync(process.env.KB_OUT, log.join('\n'), 'utf8');
})().catch(e => { console.log('ERR ' + e.message); });
