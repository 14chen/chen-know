
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8510';
let cookie = '';
async function req(method, p, body) {
  const h = {}; if (cookie) h.Cookie = cookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const m = /^([^=]+=[^;]+)/.exec(c); if (m) cookie = m[1]; }
  const raw = await r.text(); let j = null; try { j = JSON.parse(raw); } catch {}
  return { status: r.status, j, raw: raw.slice(0, 300) };
}
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await req('POST', '/api/auth/register', { username: 'verifier', password: 'Lead1234!', displayName: 'verifier' });
  await req('POST', '/api/auth/login', { username: 'verifier', password: 'Lead1234!' });

  // A) DEF-E4-002 同名笔记是否丢链
  await req('POST', '/api/notes', { title: '重名Z', content: 'A' });
  await req('POST', '/api/notes', { title: '重名Z', content: 'B' });
  const c = await req('POST', '/api/notes', { title: '引用者Z', content: '见 [[重名Z]] 与 [[不存在的标题Z]]' });
  const cid = c.j?.id;
  await sleep(700);
  const lk = await req('GET', '/api/notes/' + cid + '/links');
  P('A) links ->', lk.status, JSON.stringify(lk.j));
  const resolved = lk.j?.resolved?.length ?? -1, dangling = lk.j?.dangling?.length ?? -1;
  P('   resolved=' + resolved + ' dangling=' + dangling + '  (期望 1+1，若 resolved=1,dangling=0 则丢链成立)');

  // B) DEF-E1-001 对当前版本回滚
  const n = await req('POST', '/api/notes', { title: '版本Z', content: 'v1' });
  const nid = n.j?.id;
  await req('PATCH', '/api/notes/' + nid, { content: 'v2' });
  const det = await req('GET', '/api/notes/' + nid);
  const cur = det.j?.version;
  const gv = await req('GET', '/api/notes/' + nid + '/versions/' + cur);
  const rs = await req('POST', '/api/notes/' + nid + '/versions/' + cur + '/restore');
  P('B) current version =', cur, '| GET versions/' + cur + ' ->', gv.status, '| POST restore ->', rs.status, rs.raw.slice(0, 90));

  // C) DEF-E3-001 大正文拖慢搜索（轻量）
  for (let i = 0; i < 30; i++) await req('POST', '/api/notes', { title: '普通' + i, content: '今天天气不错，记录一下笔记内容 ' + i });
  await sleep(500);
  const t1 = Date.now(); const s1 = await req('GET', '/api/search?q=' + encodeURIComponent('天气')); const d1 = Date.now() - t1;
  await req('POST', '/api/notes', { title: '大正文Z', content: ('天气 ' + '填充内容'.repeat(60) + '\n').repeat(1200) });
  await sleep(1200);
  const t2 = Date.now(); const s2 = await req('GET', '/api/search?q=' + encodeURIComponent('天气')); const d2 = Date.now() - t2;
  P('C) search before big note =', d1 + 'ms (total=' + (s1.j?.total) + ') | after =', d2 + 'ms (total=' + (s2.j?.total) + ')');
  P('   大正文笔记大小约 ' + Math.round(('天气 ' + '填充内容'.repeat(60) + '\n').repeat(1200).length / 1024) + ' KB');

  // D) DEF-E1-002 空文件导入（再确认一次）
  const fd = new FormData();
  fd.append('file', new Blob(['   \n\n'], { type: 'text/markdown' }), 'empty.md');
  const imp = await req('POST', '/api/import/markdown', fd);
  P('D) import empty.md ->', imp.status, imp.raw.slice(0, 160));

  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
})().catch(e => { console.log('ERR ' + e.message); fs.writeFileSync(process.env.KB_OUT, 'ERR ' + e.message, 'utf8'); });
