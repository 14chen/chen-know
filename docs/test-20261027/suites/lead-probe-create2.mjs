
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8510';
let cookie = '';
async function req(method, p, body) {
  const h = {}; if (cookie) h.Cookie = cookie;
  let payload; if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const m = /^([^=]+=[^;]+)/.exec(c); if (m) cookie = m[1]; }
  const raw = await r.text(); let j = null; try { j = JSON.parse(raw); } catch {}
  return { status: r.status, j, raw: raw.slice(0, 160) };
}
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
(async () => {
  const reg = await req('POST', '/api/auth/register', { username: 'probeuser', password: 'Lead1234!', displayName: 'probeuser' });
  P('register ->', reg.status, reg.raw);
  const lg = await req('POST', '/api/auth/login', { username: 'probeuser', password: 'Lead1234!' });
  P('login ->', lg.status, 'cookie=' + (cookie ? 'set' : 'MISSING'), lg.raw);
  const list0 = await req('GET', '/api/notes');
  P('GET /api/notes ->', list0.status, list0.raw);
  for (const p of [{ title: 'T1', content: 'c1' }, { title: 'T1' }, {}]) {
    const r = await req('POST', '/api/notes', p);
    P('POST ' + JSON.stringify(p) + ' -> ' + r.status + ' ' + r.raw);
  }
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
})();
