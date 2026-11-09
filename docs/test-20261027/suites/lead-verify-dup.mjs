
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8510';
let cookie = '';
async function req(method, p, body) {
  const h = {}; if (cookie) h.Cookie = cookie;
  let payload; if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const m = /^([^=]+=[^;]+)/.exec(c); if (m) cookie = m[1]; }
  const raw = await r.text(); let j = null; try { j = JSON.parse(raw); } catch {}
  return { status: r.status, j, raw };
}
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await req('POST', '/api/auth/register', { username: 'dupuser', password: 'Lead1234!', displayName: 'dupuser' });
  await req('POST', '/api/auth/login', { username: 'dupuser', password: 'Lead1234!' });

  // 场景1：3 篇同名 + 引用它 + 引用一个不存在的
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = await req('POST', '/api/notes', { title: '天气记录', content: 'x' + i }); ids.push(r.j.id); }
  const w = await req('POST', '/api/notes', { title: '工作周报', content: 'w' });
  const ref = await req('POST', '/api/notes', { title: '引用者', content: '见 [[天气记录]] 与 [[工作周报]] 与 [[无此笔记]]' });
  await sleep(900);
  const lk = await req('GET', '/api/notes/' + ref.j.id + '/links');
  P('场景1 links ->', JSON.stringify(lk.j));
  P('  resolved=' + (lk.j?.resolved?.length) + ' dangling=' + JSON.stringify(lk.j?.dangling));
  for (const id of ids) {
    const bl = await req('GET', '/api/notes/' + id + '/backlinks');
    P('  同名笔记 ' + id + ' backlinks -> ' + JSON.stringify(bl.j).slice(0, 140));
  }
  const blw = await req('GET', '/api/notes/' + w.j.id + '/backlinks');
  P('  工作周报 backlinks -> ' + JSON.stringify(blw.j).slice(0, 140));

  // 场景2：把引用者放到不同目录（能否影响解析）
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
})().catch(e => { fs.writeFileSync(process.env.KB_OUT, 'ERR ' + e.message, 'utf8'); console.log('ERR ' + e.message); });
