
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8510';
let cookie = '';
async function req(method, p, body) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of sc) { const m = /^([^=]+=[^;]+)/.exec(c); if (m) cookie = m[1]; }
  const ct = r.headers.get('content-type') || '';
  const raw = await r.text();
  let j = null; try { j = JSON.parse(raw); } catch {}
  return { status: r.status, ct, j, raw: raw.slice(0, 200) };
}
const out = [];
const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
(async () => {
  await req('POST', '/api/auth/register', { username: 'p2', password: 'Lead1234!', displayName: 'p2' });
  await req('POST', '/api/auth/login', { username: 'p2', password: 'Lead1234!' });
  P('GET /api/notes ->', (await req('GET', '/api/notes')).status);
  for (const payload of [{ title: 'T1', content: 'c1' }, { title: 'T1', content: 'c1', folderId: 0 }, { title: 'T1', content: 'c1', folderId: null }]) {
    const r = await req('POST', '/api/notes', payload);
    P('POST /api/notes ' + JSON.stringify(payload) + ' -> ' + r.status + ' ct=' + r.ct + ' body=' + r.raw);
  }
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
})();
