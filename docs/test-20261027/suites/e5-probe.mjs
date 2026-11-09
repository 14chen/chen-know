import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8506';
const out = [];
let cookie = '';
function rec(id, claim, expected, actual, verdict, extra) { out.push({ id, claim, expected, actual, verdict, extra: extra || null }); }
async function req(method, path, body, opts) {
  const o = opts || {};
  const headers = {};
  if (cookie && !o.noCookie) headers['Cookie'] = cookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc.length && !o.noCookie) cookie = sc.map(function (c) { return c.split(';')[0]; }).join('; ');
  const ct = res.headers.get('content-type') || '';
  let json = null, text = '';
  if (ct.indexOf('json') >= 0) { try { json = await res.json(); } catch (e) { json = null; } }
  else { text = await res.text(); }
  return { status: res.status, json: json, text: text, ct: ct, setCookie: sc };
}
const J = function (o) { return JSON.stringify(o).slice(0, 200); };

let r1 = await req('GET', '/api/health');
let k1 = r1.json ? Object.keys(r1.json).sort().join(',') : '(none)';
rec('V01', 'API.md 11: GET /api/health -> {status,version,time,db}', 'HTTP 200 且含 status/version/time/db', 'HTTP ' + r1.status + ' keys=' + k1, r1.status === 200 && k1.indexOf('db') >= 0 ? 'CONFIRM' : 'MISMATCH', r1.json);

let mf = await req('GET', '/manifest.webmanifest', undefined, { noCookie: true });
let sw = await req('GET', '/sw.js', undefined, { noCookie: true });
rec('V02', 'PWA: /manifest.webmanifest 与 /sw.js 由 static 提供（API.md 未登记）', '两者 200', 'manifest=' + mf.status + ' sw=' + sw.status, mf.status === 200 && sw.status === 200 ? 'CONFIRM' : 'MISMATCH');

const uname = 'u' + Date.now().toString().slice(-8);
let rg = await req('POST', '/api/auth/register', { username: uname, displayName: '验证甲', password: 'Passw0rd2026x' }, { noCookie: true });
rec('V03', 'API.md 1: 空库首人注册免邀请码且 role=admin', '201 且 role=admin', 'HTTP ' + rg.status + ' role=' + (rg.json && rg.json.role), rg.status === 201 && rg.json && rg.json.role === 'admin' ? 'CONFIRM' : 'MISMATCH', rg.json);
rec('V04', 'API.md 1 v1: 注册成功不下发 KB_SESSION', '响应无 Set-Cookie', 'Set-Cookie 条数=' + rg.setCookie.length, rg.setCookie.length === 0 ? 'CONFIRM' : 'MISMATCH');

let na = await req('GET', '/api/notes', undefined, { noCookie: true });
rec('V05', 'API.md 0.2: 未登录 -> 401 UNAUTHORIZED', 'HTTP 401', 'HTTP ' + na.status + ' code=' + (na.json && na.json.error && na.json.error.code), na.status === 401 ? 'CONFIRM' : 'MISMATCH', na.json);

let lg = await req('POST', '/api/auth/login', { username: uname, password: 'Passw0rd2026x' });
rec('V06', 'API.md 1: 登录 200 + Set-Cookie KB_SESSION', 'HTTP 200 且下发 Cookie', 'HTTP ' + lg.status + ' cookie=' + (lg.setCookie[0] || '').slice(0, 22), lg.status === 200 && lg.setCookie.length > 0 ? 'CONFIRM' : 'MISMATCH', lg.json);

let cn = await req('POST', '/api/notes', { title: '天气验证笔记', content: '今天天气很好，Spring Boot 笔记 v2' });
const nid = cn.json && cn.json.id;
rec('V07', 'API.md 4: POST /api/notes -> 201', 'HTTP 201', 'HTTP ' + cn.status + ' id=' + nid, cn.status === 201 ? 'CONFIRM' : 'MISMATCH', cn.json);

let ls = await req('GET', '/api/notes?folderId=0');
let k2 = ls.json ? Object.keys(ls.json).sort().join(',') : '(none)';
rec('V08', 'API.md 0.3/3.1: 列表信封 {items,page,size,total}；folderId=0 = 未分类', '200 且 keys 含 items/page/size/total', 'HTTP ' + ls.status + ' keys=' + k2, ls.status === 200 && k2.indexOf('items') >= 0 && k2.indexOf('total') >= 0 ? 'CONFIRM' : 'MISMATCH');

let ep = await req('PATCH', '/api/notes/' + nid, {});
let fld = ep.json && ep.json.error && ep.json.error.field;
rec('V09', 'API.md 4.4: 空 PATCH -> 400 VALIDATION_FAILED field=body', '400 且 field=body', 'HTTP ' + ep.status + ' field=' + fld, ep.status === 400 && fld === 'body' ? 'CONFIRM' : 'MISMATCH', ep.json);

let se = await req('GET', '/api/search?q=' + encodeURIComponent('天'));
let hit = se.json && se.json.items ? se.json.items.length : -1;
rec('V10', 'README/使用手册/SCHEMA 2: 支持 1 个汉字起搜', '至少 1 条命中', 'HTTP ' + se.status + ' total=' + (se.json && se.json.total) + ' items=' + hit, se.status === 200 && hit > 0 ? 'CONFIRM' : 'MISMATCH', (se.json && se.json.items || []).slice(0, 1));

let ar = await req('GET', '/api/archive/runs');
let wk = await req('GET', '/api/weekly/runs');
let ah = await req('GET', '/api/attachments/health');
let at = await req('POST', '/api/autotag/run');
rec('V11', '代码有 /api/archive、/api/weekly、/api/attachments/health、/api/autotag，API.md 全未登记', 'API.md 无这四条；实测可达', 'archive=' + ar.status + ' weekly=' + wk.status + ' attachHealth=' + ah.status + ' autotag=' + at.status, (ar.status === 200 || ar.status === 403) && (wk.status === 200 || wk.status === 403) ? 'CONFIRM-DRIFT' : 'MISMATCH', { ar: ar.json, ah: ah.json, at: at.json });

let bs = await req('GET', '/api/briefing/sources');
let nn = bs.json && bs.json.items ? bs.json.items.length : -1;
rec('V12', 'VERIFY 第六轮: GET /api/briefing/sources -> 200，10 个源', '200 且源数=10', 'HTTP ' + bs.status + ' 源数=' + nn, bs.status === 200 ? (nn === 10 ? 'CONFIRM' : 'PARTIAL') : 'MISMATCH');
let br = await req('POST', '/api/briefing/run');
rec('V13', 'CONVENTIONS 7.1: briefing 关闭时应安全降级、不 5xx', '非 5xx', 'HTTP ' + br.status + ' ' + J(br.json), br.status < 500 ? 'CONFIRM' : 'MISMATCH', br.json);

let ex = await req('GET', '/api/export/notes/' + nid);
rec('V14', 'ExportController 映射 notes/{id} 与 notes/{id}.md；API.md 只登记 .md 与 .zip', '无扩展名也 200（未登记）', 'HTTP ' + ex.status + ' ct=' + ex.ct, ex.status === 200 ? 'CONFIRM-DRIFT' : 'MISMATCH');

let fd = new FormData();
fd.append('file', new Blob([Buffer.from('BM6AAAAAAAAAAAAAAAAAAAAAAA')], { type: 'image/bmp' }), 'a.bmp');
let up = await req('POST', '/api/attachments', fd);
rec('V15', 'API.md 7.1 白名单未列 bmp/avif；使用手册:436 列了 bmp/avif；AttachmentTypes 含 bmp/avif', '上传 bmp 被接受', 'HTTP ' + up.status + ' ' + J(up.json), up.status === 201 ? 'CONFIRM-DOC-MISS' : 'MISMATCH', up.json);

fs.writeFileSync('D:/work/知识库/docs/test-20261027/evidence/e5/probe.json', JSON.stringify(out, null, 2), 'utf8');
out.forEach(function (o) { console.log(o.id + ' ' + o.verdict + ' | ' + o.actual); });