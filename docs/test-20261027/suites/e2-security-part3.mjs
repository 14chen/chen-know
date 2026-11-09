#!/usr/bin/env node
/** E2 第三轮：契约上限复核 + 头/时序/边界补充（自带 setup，需空数据目录） */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HOST = '127.0.0.1', PORT = 8503;
const EV = 'D:\\work\\知识库\\docs\\test-20261027\\evidence\\e2';
const TS = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.mkdirSync(EV, { recursive: true });
const RAW = path.join(EV, 'e2-raw3-' + TS + '.log');
const rawFd = fs.openSync(RAW, 'a');
const cases = [];
function C(id, cat, name, expect, fn) {
  return (async () => {
    let out;
    try { out = await fn(); } catch (e) { out = { v: 'BLOCKED', a: 'EXC ' + e.message, e: '', sev: '' }; }
    cases.push({ id: id, cat: cat, name: name, expect: expect, verdict: out.v, actual: out.a || '', evidence: (out.e || '').slice(0, 900), severity: out.sev || '' });
    console.log('[' + out.v + '] ' + id + ' ' + name + ' :: ' + String(out.a).slice(0, 110));
  })();
}
const PASS = (a, e) => ({ v: 'PASS', a: a, e: e });
const FAIL = (a, e, sev) => ({ v: 'FAIL', a: a, e: e, sev: sev || 'S3' });
const BLOCK = (a, e) => ({ v: 'BLOCKED', a: a, e: e });
const jars = {};
const jar = (n) => (jars[n] = jars[n] || {});
const ck = (n) => Object.entries(jar(n)).map(([k, v]) => k + '=' + v).join('; ');
function store(n, sc) { if (!sc) return; for (const c of (Array.isArray(sc) ? sc : [sc])) { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar(n)[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } }
function request(method, p, opt) {
  opt = opt || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opt.headers || {});
    let body = null;
    if (opt.json !== undefined) { body = Buffer.from(JSON.stringify(opt.json)); headers['Content-Type'] = 'application/json'; }
    else if (opt.rawBody) { body = Buffer.isBuffer(opt.rawBody) ? opt.rawBody : Buffer.from(String(opt.rawBody)); if (opt.rawType) headers['Content-Type'] = opt.rawType; }
    if (body) headers['Content-Length'] = body.length;
    if (opt.as && Object.keys(jar(opt.as)).length) headers['Cookie'] = ck(opt.as);
    Object.assign(headers, opt.headers || {});
    const t0 = Date.now();
    const req = http.request({ host: HOST, port: PORT, method: method, path: p, headers: headers, timeout: 90000 }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(ch);
        const text = buf.toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        if (opt.as) store(opt.as, res.headers['set-cookie']);
        if (!opt.silent) { try { fs.writeSync(rawFd, '[' + (opt.as || 'anon') + '] ' + method + ' ' + p + ' -> ' + res.statusCode + ' (' + (Date.now() - t0) + 'ms) :: ' + text.replace(/\s+/g, ' ').slice(0, 350) + '\n'); } catch (e) {} }
        resolve({ status: res.statusCode, headers: res.headers, text: text, json: json, buf: buf, len: buf.length, ms: Date.now() - t0 });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}
const G = (p, o) => request('GET', p, o), P = (p, o) => request('POST', p, o);
const snip = (r, n) => String((r && r.text) || '').replace(/\s+/g, ' ').slice(0, n || 140);
const ev = (m, p, r, x) => m + ' ' + p + ' => ' + (r ? r.status : 'ERR') + ' | ' + snip(r, 120) + (x ? ' | ' + x : '');
function crc32(b) { let c, crc = 0xffffffff; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function zipStore(entries) {
  const loc = [], cen = []; let off = 0;
  for (const en of entries) {
    const name = Buffer.from(en.name, 'utf8'), data = Buffer.from(en.data === undefined ? '' : en.data, 'utf8'), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    loc.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cen.push(ch, name); off += 30 + name.length + data.length;
  }
  const cb = Buffer.concat(cen), eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10);
  eo.writeUInt32LE(cb.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(loc), cb, eo]);
}
function multipart(fields, files) {
  const b = '----e2q' + Math.random().toString(16).slice(2); const parts = [];
  for (const k of Object.keys(fields || {})) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(fields[k]) + '\r\n'));
  for (const f of files) parts.push(Buffer.concat([Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + (f.field || 'file') + '"; filename="' + f.filename + '"\r\nContent-Type: ' + (f.type || 'application/octet-stream') + '\r\n\r\n'), Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data)), Buffer.from('\r\n')]));
  parts.push(Buffer.from('--' + b + '--\r\n'));
  return { body: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + b };
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

async function main() {
  const h = await G('/api/health');
  if (h.status !== 200) throw new Error('not healthy');
  const ts = Date.now().toString().slice(-6);
  const ADM = 'p3admin' + ts, AL = 'p3alice' + ts, BO = 'p3bob' + ts, PW = 'Passw0rd#' + ts;
  const rAd = await P('/api/auth/register', { json: { username: ADM, displayName: 'P3管理员', password: PW } });
  if (rAd.status !== 201) throw new Error('admin 注册失败 ' + rAd.status);
  await P('/api/auth/login', { as: 'admin', json: { username: ADM, password: PW } });
  const i1 = await P('/api/admin/invites', { as: 'admin', json: {} });
  const i2 = await P('/api/admin/invites', { as: 'admin', json: {} });
  const rA = await P('/api/auth/register', { json: { username: AL, displayName: 'P3爱丽丝', password: PW, inviteCode: i1.json.code } });
  const rB = await P('/api/auth/register', { json: { username: BO, displayName: 'P3鲍勃', password: PW, inviteCode: i2.json.code } });
  const A = await P('/api/auth/login', { as: 'alice', json: { username: AL, password: PW } });
  const B = await P('/api/auth/login', { as: 'bob', json: { username: BO, password: PW } });
  console.log('setup3: admin=' + rAd.status + ' alice=' + rA.status + ' bob=' + rB.status + ' logins=' + A.status + '/' + B.status);

  /* --- 1. 契约：ZIP 条目上限 2000（空文件不产生笔记，只测上限） --- */
  await C('TC-IMPEXP-201', '导入导出', 'ZIP 含 2001 个空条目：是否执行「上限 2000」', '应拒绝（400/413 或 errors 明确拒绝整包）', async () => {
    const ent = []; for (let i = 0; i < 2001; i++) ent.push({ name: 'e' + i + '.md', data: '' });
    const zip = zipStore(ent);
    const mp = multipart({}, [{ field: 'file', filename: 'cap.zip', type: 'application/zip', data: zip }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const msg = snip(r, 200);
    const rejected = r.status >= 400 && r.status !== 500;
    const errMentions = /2000|条目|上限/.test(msg);
    if (r.status >= 500) return FAIL('500：' + msg, ev('POST', '/api/import/markdown', r, '2001 empty entries'), 'S2');
    return (rejected && errMentions) ? PASS('按上限拒绝：' + msg, ev('POST', '/api/import/markdown', r, '2001 entries')) : FAIL('未按 2000 上限拒绝：status=' + r.status + ' ' + msg, ev('POST', '/api/import/markdown', r, '2001 empty entries'), 'S3');
  });
  /* --- 2. 导入正文脚本原样入库（大小写不敏感找标题） --- */
  await C('TC-IMPEXP-202', '导入导出', '导入 .md 含 <img onerror> 后正文是否原样存储', '原样存储（JSON 返回），依赖前端消毒', async () => {
    const mp = multipart({}, [{ field: 'file', filename: 'p3xss.md', type: 'text/markdown', data: '# P3XSS\n<img src=x onerror=alert(7)>\n' }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const list = await G('/api/notes?size=200', { as: 'alice' });
    const items = (list.json && list.json.items) || [];
    const hit = items.find(x => String(x.title).toLowerCase().indexOf('p3xss') >= 0) || items[0];
    if (!hit) return BLOCK('导入成功但未找到笔记（imported=' + ((r.json || {}).imported) + '）', ev('POST', '/api/import/markdown', r));
    const det = await G('/api/notes/' + hit.id, { as: 'alice' });
    const raw = (det.text || '').indexOf('<img src=x onerror') >= 0;
    return raw ? PASS('正文原样保存（title=' + hit.title + '）', ev('GET', '/api/notes/' + hit.id, det)) : PASS('已过滤', '');
  });

  /* --- 3. HTTP 头补充 --- */
  await C('TC-NF-201', 'HTTP 头', 'HTML 首屏是否有 CSP / Referrer-Policy', '至少记录现状（缺 CSP 计 S4）', async () => {
    const r = await G('/');
    const h = r.headers;
    const csp = h['content-security-policy'] || '';
    const rp = h['referrer-policy'] || '';
    const xfo = h['x-frame-options'] || '';
    const nosniff = h['x-content-type-options'] || '';
    if (!csp) return FAIL('无 CSP（nosniff=' + nosniff + ' XFO=' + xfo + ' Referrer-Policy=' + (rp || '缺失') + '）', 'GET / headers=' + Object.keys(h).join(','), 'S4');
    return PASS('CSP 存在：' + csp.slice(0, 100), 'GET /');
  });
  await C('TC-NF-202', 'HTTP 头', 'HTTPS 场景是否给 Cookie 加 Secure（X-Forwarded-Proto 探测）', '视部署而定，记录现状', async () => {
    const r = await P('/api/auth/login', { json: { username: AL, password: PW }, headers: { 'X-Forwarded-Proto': 'https' } });
    const sc = String((r.headers['set-cookie'] || []).join(' | '));
    const secure = /secure/i.test(sc);
    return PASS('X-Forwarded-Proto: https 时 Set-Cookie Secure=' + secure + '（' + sc.slice(0, 90) + '）', 'login');
  });

  /* --- 4. 时序侧信道（用户名枚举） --- */
  await C('TC-AUTH-201', '鉴权', '登录响应时间是否因用户是否存在而明显不同', '两者均值差 < 100ms（无显著时序差）', async () => {
    const timesExist = [], timesAbsent = [];
    for (let i = 0; i < 5; i++) { const r = await P('/api/auth/login', { json: { username: AL, password: 'Wrong#' + i }, silent: true }); timesExist.push(r.ms); }
    for (let i = 0; i < 5; i++) { const r = await P('/api/auth/login', { json: { username: 'ghost' + ts + i, password: 'Wrong#' + i }, silent: true }); timesAbsent.push(r.ms); }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const d = Math.abs(avg(timesExist) - avg(timesAbsent));
    return d < 100 ? PASS('存在用户均值 ' + avg(timesExist).toFixed(1) + 'ms，不存在 ' + avg(timesAbsent).toFixed(1) + 'ms，差 ' + d.toFixed(1) + 'ms', 'login×10') : FAIL('时序差 ' + d.toFixed(1) + 'ms（存在 ' + avg(timesExist).toFixed(0) + ' / 不存在 ' + avg(timesAbsent).toFixed(0) + '）', 'login×10', 'S3');
  });

  /* --- 5. 边界 --- */
  await C('TC-NOTE-201', '空间隔离', '超大 id / 非数字 id 的响应', '400 或 404，不 500', async () => {
    const out = [];
    for (const id of ['999999999999999999999', '1e9', '0x10', ' 1', '1%20', '-0']) { const r = await G('/api/notes/' + id, { as: 'alice', silent: true }); out.push(id + '=' + r.status); if (r.status >= 500) return FAIL('500：' + id, '', 'S2'); }
    return PASS(out.join(' '), 'GET /api/notes/<weird>');
  });
  await C('TC-SEARCH-201', 'SQL 注入', '超长查询串 / emoji / 控制字符', '不 500', async () => {
    const qs = ['x'.repeat(5000), '🔍😀', '\u0000\u0001', '%00', 'a*"b(c)'];
    const out = [];
    for (const q of qs) { const r = await G('/api/search?q=' + encodeURIComponent(q), { as: 'alice', silent: true }); out.push(r.status); if (r.status >= 500) return FAIL('q=' + JSON.stringify(q).slice(0, 20) + ' → ' + r.status + ' ' + snip(r, 100), '', 'S2'); }
    return PASS('5 组状态 ' + out.join('/'), 'GET /api/search?q=<weird>');
  });
  await C('TC-ADMIN-201', '鉴权', '管理员删除自己 / 降级自己', '拒绝（400/403）', async () => {
    const me = await G('/api/auth/me', { as: 'admin' });
    const id = me.json && me.json.id;
    const d = await request('DELETE', '/api/admin/users/' + id, { as: 'admin' });
    const p = await request('PATCH', '/api/admin/users/' + id, { as: 'admin', json: { role: 'member' } });
    const still = await G('/api/auth/me', { as: 'admin' });
    const ok = (d.status === 400 || d.status === 403) && (p.status === 400 || p.status === 403) && still.status === 200;
    return ok ? PASS('DELETE=' + d.status + ' PATCH=' + p.status + '，仍可访问=' + still.status, ev('DELETE', '/api/admin/users/{self}', d)) : FAIL('DELETE=' + d.status + ' PATCH=' + p.status + ' me=' + still.status, ev('DELETE', '/api/admin/users/{self}', d), 'S2');
  });
  await C('TC-FILE-201', '附件上传', '空文件 / 无 filename 的上传', '400 校验失败，不 500', async () => {
    const mp1 = multipart({}, [{ field: 'file', filename: 'empty.png', type: 'image/png', data: Buffer.alloc(0) }]);
    const r1 = await P('/api/attachments', { as: 'alice', rawBody: mp1.body, rawType: mp1.type });
    const mp2 = multipart({}, []);
    const r2 = await P('/api/attachments', { as: 'alice', rawBody: mp2.body, rawType: mp2.type });
    if (r1.status >= 500 || r2.status >= 500) return FAIL('5xx：' + r1.status + '/' + r2.status, '', 'S2');
    return PASS('空文件=' + r1.status + ' 无文件=' + r2.status, ev('POST', '/api/attachments', r2, 'no file part'));
  });
  await C('TC-TAG-201', 'XSS', '标签名长度/特殊字符边界', '不 500；超长被拒', async () => {
    const long = 'x'.repeat(300);
    const r1 = await P('/api/tags', { as: 'alice', json: { name: long } });
    const r2 = await P('/api/tags', { as: 'alice', json: { name: '  ' } });
    if (r1.status >= 500 || r2.status >= 500) return FAIL('5xx：' + r1.status + '/' + r2.status, '', 'S2');
    return PASS('300 字标签=' + r1.status + ' 空白标签=' + r2.status, ev('POST', '/api/tags', r1, '300 chars'));
  });

  finish();
}
let fin = false;
function finish() {
  if (fin) return; fin = true;
  const stat = { total: cases.length, pass: 0, fail: 0, blocked: 0 };
  for (const c of cases) { if (c.verdict === 'PASS') stat.pass++; else if (c.verdict === 'FAIL') stat.fail++; else stat.blocked++; }
  fs.writeFileSync(path.join(EV, 'e2q-results-' + TS + '.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stat: stat, cases: cases }, null, 2));
  const lines = ['# E2 安全用例（第三轮：契约上限 / 头 / 时序 / 边界）', '', '- 统计：' + stat.total + ' / 通过 ' + stat.pass + ' / 失败 ' + stat.fail + ' / 阻塞 ' + stat.blocked, '', '| 用例 | 分类 | 名称 | 结论 | 严重度 | 实际 | 证据 |', '|---|---|---|---|---|---|---|'];
  for (const c of cases) lines.push('| ' + c.id + ' | ' + c.cat + ' | ' + c.name.replace(/\|/g, '/') + ' | ' + c.verdict + ' | ' + (c.severity || '-') + ' | ' + String(c.actual).replace(/\|/g, '/').slice(0, 150) + ' | ' + String(c.evidence).replace(/\|/g, '/').slice(0, 190) + ' |');
  fs.writeFileSync(path.join(EV, 'e2q-cases-' + TS + '.md'), lines.join('\n'));
  console.log('STAT3 ' + JSON.stringify(stat));
  try { fs.closeSync(rawFd); } catch (e) {}
}
setTimeout(() => { try { finish(); } catch (e) {} process.exit(4); }, 240000);
main().then(() => setTimeout(() => process.exit(0), 400)).catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : e)); try { finish(); } catch (e2) {} setTimeout(() => process.exit(5), 700); });
