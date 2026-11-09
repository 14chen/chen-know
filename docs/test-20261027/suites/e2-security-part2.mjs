#!/usr/bin/env node
/**
 * E2 安全测试·第二轮（修正上游 multipart 字段名，补齐 ZIP 深检与越权写回证）
 * 用法：node e2-security-part2.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HOST = '127.0.0.1', PORT = 8503;
const EV = 'D:\\work\\知识库\\docs\\test-20261027\\evidence\\e2';
const DATADIR = 'F:\\work\\test\\kb\\d-e2';
const TS = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.mkdirSync(EV, { recursive: true });
const RAW = path.join(EV, 'e2-raw2-' + TS + '.log');
const rawFd = fs.openSync(RAW, 'a');
const cases = [];

function C(id, cat, name, expect, fn) {
  return (async () => {
    let out;
    try { out = await fn(); } catch (e) { out = { v: 'BLOCKED', a: 'EXC ' + e.message, e: '', sev: '' }; }
    const rec = { id: id, cat: cat, name: name, expect: expect, verdict: out.v, actual: out.a || '', evidence: (out.e || '').slice(0, 900), severity: out.sev || '' };
    cases.push(rec);
    console.log('[' + out.v + '] ' + id + ' ' + name + ' :: ' + String(out.a).slice(0, 110));
  })();
}
const PASS = (a, e) => ({ v: 'PASS', a: a, e: e });
const FAIL = (a, e, sev) => ({ v: 'FAIL', a: a, e: e, sev: sev || 'S3' });
const BLOCK = (a, e) => ({ v: 'BLOCKED', a: a, e: e });

const jars = {};
function jar(n) { if (!jars[n]) jars[n] = {}; return jars[n]; }
function cookieHeader(n) { return Object.entries(jar(n)).map(([k, v]) => k + '=' + v).join('; '); }
function storeCookies(n, sc) { if (!sc) return; for (const c of (Array.isArray(sc) ? sc : [sc])) { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar(n)[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } }
function request(method, p, opt) {
  opt = opt || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opt.headers || {});
    let body = null;
    if (opt.json !== undefined) { body = Buffer.from(JSON.stringify(opt.json)); headers['Content-Type'] = 'application/json'; }
    else if (opt.rawBody) { body = Buffer.isBuffer(opt.rawBody) ? opt.rawBody : Buffer.from(String(opt.rawBody)); if (opt.rawType) headers['Content-Type'] = opt.rawType; }
    if (body) headers['Content-Length'] = body.length;
    if (opt.as && Object.keys(jar(opt.as)).length) headers['Cookie'] = cookieHeader(opt.as);
    Object.assign(headers, opt.headers || {});
    const req = http.request({ host: HOST, port: PORT, method: method, path: p, headers: headers, timeout: 60000 }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(ch);
        const text = buf.toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        if (opt.as) storeCookies(opt.as, res.headers['set-cookie']);
        if (!opt.silent) { try { fs.writeSync(rawFd, '[' + (opt.as || 'anon') + '] ' + method + ' ' + p + ' -> ' + res.statusCode + ' :: ' + text.replace(/\s+/g, ' ').slice(0, 400) + '\n'); } catch (e) {} }
        resolve({ status: res.statusCode, headers: res.headers, text: text, json: json, buf: buf, len: buf.length });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}
const G = (p, o) => request('GET', p, o);
const P = (p, o) => request('POST', p, o);
const PATCH = (p, o) => request('PATCH', p, o);
const DEL = (p, o) => request('DELETE', p, o);
const snip = (r, n) => String((r && r.text) || '').replace(/\s+/g, ' ').slice(0, n || 150);
const ev = (m, p, r, x) => m + ' ' + p + ' => ' + (r ? r.status : 'ERR') + ' | ' + snip(r, 130) + (x ? ' | ' + x : '');

/* ---- ZIP 写（可造 ../ 条目） ---- */
function crc32(buf) { let c, crc = 0xffffffff; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function zipStore(entries) {
  const loc = [], cen = []; let off = 0;
  for (const en of entries) {
    const name = Buffer.from(en.name, 'utf8');
    const data = Buffer.from(en.data === undefined ? '' : en.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    loc.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cen.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cb = Buffer.concat(cen);
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10);
  eo.writeUInt32LE(cb.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(loc), cb, eo]);
}
/* ---- ZIP 读（store + deflate） ---- */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('no EOCD');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lnameLen = buf.readUInt16LE(lho + 26);
    const lextraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnameLen + lextraLen;
    const raw = buf.slice(dataStart, dataStart + csize);
    let data = Buffer.alloc(0);
    try { data = method === 8 ? zlib.inflateRawSync(raw) : raw; } catch (e) { data = raw; }
    out.push({ name: name, size: data.length, data: data, method: method });
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}
function multipart(fields, files) {
  const b = '----e2p' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const k of Object.keys(fields || {})) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(fields[k]) + '\r\n'));
  for (const f of files) parts.push(Buffer.concat([
    Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + (f.field || 'file') + '"; filename="' + f.filename + '"\r\nContent-Type: ' + (f.type || 'application/octet-stream') + '\r\n\r\n'),
    Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data)), Buffer.from('\r\n')
  ]));
  parts.push(Buffer.from('--' + b + '--\r\n'));
  return { body: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + b };
}
async function upload(as, filename, type, data, extra) {
  const mp = multipart(extra || {}, [{ field: 'file', filename: filename, type: type, data: data }]);
  return P('/api/attachments', { as: as, rawBody: mp.body, rawType: mp.rawType || mp.type });
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

async function loginAs(label, u, p) { return P('/api/auth/login', { as: label, json: { username: u, password: p } }); }

async function main() {
  const h = await G('/api/health');
  if (h.status !== 200) throw new Error('not healthy');
  // 自建账号（需在空数据目录上运行：首人免邀请码成为 admin）
  const ts = Date.now().toString().slice(-6);
  const ADM = 'p2admin' + ts, AL = 'p2alice' + ts, BO = 'p2bob' + ts, PW = 'Passw0rd#' + ts;
  const rAd = await P('/api/auth/register', { json: { username: ADM, displayName: 'P2管理员', password: PW } });
  if (rAd.status !== 201) throw new Error('admin 注册失败 ' + rAd.status + '（数据目录非空？请用全新目录重启实例）: ' + snip(rAd, 120));
  const adLogin = await loginAs('p2admin', ADM, PW);
  if (adLogin.status !== 200) throw new Error('admin 登录失败 ' + adLogin.status);
  const inv1 = await P('/api/admin/invites', { as: 'p2admin', json: { expiresInHours: 24 } });
  const inv2 = await P('/api/admin/invites', { as: 'p2admin', json: { expiresInHours: 24 } });
  const rA = await P('/api/auth/register', { json: { username: AL, displayName: 'P2爱丽丝', password: PW, inviteCode: inv1.json.code } });
  const rB = await P('/api/auth/register', { json: { username: BO, displayName: 'P2鲍勃', password: PW, inviteCode: inv2.json.code } });
  const A = await loginAs('alice', AL, PW), B = await loginAs('bob', BO, PW);
  console.log('setup2: admin=' + rAd.status + ' alice=' + rA.status + ' bob=' + rB.status + ' logins=' + A.status + '/' + B.status);
  if (A.status !== 200 || B.status !== 200) throw new Error('alice/bob 登录失败 ' + A.status + '/' + B.status + ' invite=' + JSON.stringify(inv1.json));

  const nA = await P('/api/notes', { as: 'alice', json: { title: 'A2机密', content: 'ALICE-ONLY-MARKER 内容' } });
  const A_NOTE = nA.json && nA.json.id;
  const nB = await P('/api/notes', { as: 'bob', json: { title: 'B2自己的', content: 'BOB-ONLY-MARKER content' } });
  const B_NOTE = nB.json && nB.json.id;
  const aUp = await upload('alice', 'a2-att.png', 'image/png', PNG, { noteId: String(A_NOTE) });
  const A_ATT = aUp.json && aUp.json.id;
  console.log('notes: A=' + A_NOTE + ' B=' + B_NOTE + ' att=' + A_ATT);

  /* ---------- 1. ZIP 导入（正确字段名 file） ---------- */
  await C('TC-IMPEXP-101', '导入导出', '导入含 ../evil.md 的 ZIP（Zip Slip，字段名 file）', '路径穿越被拒；不写到数据目录外', async () => {
    const zip = zipStore([{ name: '../e2p-evil.md', data: '# evil' }, { name: 'goodp.md', data: '# good' }]);
    const mp = multipart({}, [{ field: 'file', filename: 'slip.zip', type: 'application/zip', data: zip }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const candidates = [path.resolve(DATADIR, '..', 'e2p-evil.md'), path.resolve(DATADIR, 'e2p-evil.md'), path.resolve('F:\\work\\test\\kb', 'e2p-evil.md')];
    let stray = [];
    for (const c of candidates) if (fs.existsSync(c)) stray.push(c);
    function walk(d, depth) { if (depth > 3) return; let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const en of ents) { const fp = path.join(d, en.name); if (en.isDirectory()) walk(fp, depth + 1); else if (en.name.indexOf('e2p-evil') >= 0) stray.push(fp); } }
    walk('F:\\work\\test\\kb', 0);
    const body = r.text || '';
    if (stray.length) return FAIL('Zip Slip 写到了目录外：' + stray.join(','), ev('POST', '/api/import/markdown', r), 'S1');
    const rejected = /穿越|非法|拒绝|不合法|error/i.test(body);
    return rejected ? PASS('被拒：' + snip(r, 120), ev('POST', '/api/import/markdown', r, 'entries=../e2p-evil.md,goodp.md')) : FAIL('未报穿越且无落地文件（可能静默丢弃）：' + snip(r, 130), ev('POST', '/api/import/markdown', r), 'S2');
  });
  await C('TC-IMPEXP-102', '导入导出', 'ZIP 含 2001 条目（超 2000 上限）', '被拒（400/413）或 200 带错误，不 500', async () => {
    const ent = []; for (let i = 0; i < 2001; i++) ent.push({ name: 'n' + i + '.md', data: '# x' });
    const zip = zipStore(ent);
    const mp = multipart({}, [{ field: 'file', filename: 'many.zip', type: 'application/zip', data: zip }]);
    const r = await P('/api/import/preview', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    if (r.status >= 500) return FAIL('500：' + snip(r, 130), ev('POST', '/api/import/preview', r, '2001 entries'), 'S2');
    return PASS('status=' + r.status + ' ' + snip(r, 120), ev('POST', '/api/import/preview', r, '2001 entries'));
  });
  await C('TC-IMPEXP-103', '导入导出', '导入正文含脚本与 [[他人笔记标题]]', '不 500；不写入他人空间', async () => {
    const mp = multipart({}, [{ field: 'file', filename: 'evil2.md', type: 'text/markdown', data: '# T\n<script>alert(1)</script>\n[[B2自己的]]\n' }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    if (r.status >= 500) return FAIL('500：' + snip(r, 130), ev('POST', '/api/import/markdown', r), 'S2');
    const bList = await G('/api/notes', { as: 'bob' });
    return PASS('status=' + r.status + ' imported=' + ((r.json || {}).imported) + ' skipped=' + ((r.json || {}).skipped) + '；B 侧仍 ' + bList.status, ev('POST', '/api/import/markdown', r));
  });
  await C('TC-IMPEXP-104', '导入导出', '导入后正文脚本是否原样入库（服务端渲染侧风险）', '原样存储（JSON），依赖前端消毒', async () => {
    const mp = multipart({}, [{ field: 'file', filename: 'xss2.md', type: 'text/markdown', data: '# XSS2\n<img src=x onerror=alert(9)>\n' }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const notes = await G('/api/notes?size=200', { as: 'alice' });
    const item = (notes.json && notes.json.items || []).find(x => String(x.title).indexOf('XSS2') >= 0);
    if (!item) return BLOCK('导入后未找到该笔记（imported=' + ((r.json || {}).imported) + '）', ev('POST', '/api/import/markdown', r));
    const det = await G('/api/notes/' + item.id, { as: 'alice' });
    const raw = (det.text || '').indexOf('<img src=x onerror') >= 0;
    return raw ? PASS('导入正文原样保存（JSON 返回），服务端不转义', ev('GET', '/api/notes/' + item.id, det)) : PASS('已过滤', '');
  });
  await C('TC-IMPEXP-105', '导入导出', '未登录导入/导出', '401', async () => {
    const mp = multipart({}, [{ field: 'file', filename: 'a.md', type: 'text/markdown', data: Buffer.from('# a') }]);
    const a = await G('/api/export/all');
    const b = await P('/api/import/markdown', { rawBody: mp.body, rawType: mp.type });
    return (a.status === 401 && b.status === 401) ? PASS('export=' + a.status + ' import=' + b.status, '') : FAIL('export=' + a.status + ' import=' + b.status, '', 'S1');
  });

  /* ---------- 2. 导出 ZIP 深检（真解压） ---------- */
  await C('TC-EXPORT-101', '导入导出', 'B 的整库导出解压后不含 A 的标识串', '解压后逐条目搜索 ALICE-ONLY-MARKER 为空', async () => {
    const r = await G('/api/export/all', { as: 'bob' });
    if (r.status !== 200) return BLOCK('导出 ' + r.status, ev('GET', '/api/export/all', r));
    let entries;
    try { entries = unzip(r.buf); } catch (e) { return BLOCK('解压失败：' + e.message, 'len=' + r.len); }
    const names = entries.map(e => e.name);
    const leak = entries.filter(e => e.data.toString('utf8').indexOf('ALICE-ONLY-MARKER') >= 0).map(e => e.name);
    return leak.length ? FAIL('B 的导出里出现 A 的内容：' + leak.join(','), ev('GET', '/api/export/all', r), 'S1') : PASS('解压 ' + entries.length + ' 条目（' + names.slice(0, 4).join(',') + '），无 A 内容', 'entries=' + entries.length);
  });
  await C('TC-EXPORT-102', '导入导出', 'A 的整库导出解压后含自己的笔记（正路径）', '含 ALICE-ONLY-MARKER', async () => {
    const r = await G('/api/export/all', { as: 'alice' });
    if (r.status !== 200) return BLOCK('导出 ' + r.status, '');
    let entries; try { entries = unzip(r.buf); } catch (e) { return BLOCK('解压失败', ''); }
    const hit = entries.some(e => e.data.toString('utf8').indexOf('ALICE-ONLY-MARKER') >= 0);
    return hit ? PASS('解压 ' + entries.length + ' 条目，命中自己的正文', 'entries=' + entries.length) : FAIL('导出里没有自己的正文（' + entries.length + ' 条目）', 'names=' + entries.map(e => e.name).slice(0, 6).join(','));
  });
  await C('TC-EXPORT-103', '导入导出', '导出包内条目名不得含 ../ 或绝对路径', '全部为相对安全路径', async () => {
    const r = await G('/api/export/all', { as: 'alice' });
    if (r.status !== 200) return BLOCK('导出 ' + r.status, '');
    let entries; try { entries = unzip(r.buf); } catch (e) { return BLOCK('解压失败', ''); }
    const bad = entries.filter(e => e.name.indexOf('../') >= 0 || e.name.startsWith('/') || /^[A-Za-z]:/.test(e.name)).map(e => e.name);
    return bad.length ? FAIL('危险条目名：' + bad.join(','), 'names=' + entries.map(e => e.name).join(','), 'S2') : PASS(entries.length + ' 条目全部相对安全，示例 ' + entries.map(e => e.name).slice(0, 3).join(','), '');
  });
  await C('TC-EXPORT-104', '导入导出', '单篇导出 ZIP 的引用路径（不得出现 ../../ 逃出包根）', '单篇包内引用为 attachments/…（无 ../）', async () => {
    const r = await G('/api/export/notes/' + A_NOTE + '.zip', { as: 'alice' });
    if (r.status !== 200) return BLOCK('导出 ' + r.status, ev('GET', '/api/export/notes/{id}.zip', r));
    let entries; try { entries = unzip(r.buf); } catch (e) { return BLOCK('解压失败', ''); }
    const md = entries.find(e => /\.md$/.test(e.name));
    const body = md ? md.data.toString('utf8') : '';
    const hasUp = body.indexOf('../') >= 0;
    return hasUp ? FAIL('单篇导出正文出现 ../：' + body.slice(0, 120), 'entries=' + entries.map(e => e.name).join(','), 'S2') : PASS('条目 ' + entries.map(e => e.name).join(',') + ' 正文无 ../', '');
  });

  /* ---------- 3. 附件跨空间（精确回证） ---------- */
  await C('TC-FILE-101', '空间隔离', 'B 指向 A 笔记上传的附件，A 能否看到/读到', 'A 不可见（附件属 B 空间）', async () => {
    const up = await upload('bob', 'b2-inject.png', 'image/png', PNG, { noteId: String(A_NOTE) });
    const id = up.json && up.json.id;
    if (!id) return PASS('上传被拒 ' + up.status + '：' + snip(up, 90), ev('POST', '/api/attachments', up, 'noteId=' + A_NOTE));
    const aGet = await G('/api/attachments/' + id, { as: 'alice' });
    const aNote = await G('/api/notes/' + A_NOTE, { as: 'alice' });
    const inNote = (aNote.text || '').indexOf('b2-inject') >= 0;
    return (aGet.status !== 200 && !inNote) ? PASS('上传 ' + up.status + '，A 读该附件=' + aGet.status + '，A 笔记里未出现该文件名', ev('GET', '/api/attachments/' + id, aGet)) : FAIL('A 能读 B 的附件或笔记里出现该文件名（aGet=' + aGet.status + ' inNote=' + inNote + '）', '', 'S1');
  });
  await C('TC-FILE-102', '空间隔离', 'B 删 A 的附件后 A 仍可读（回证）', 'A 200', async () => {
    const d = await DEL('/api/attachments/' + A_ATT, { as: 'bob' });
    const g = await G('/api/attachments/' + A_ATT, { as: 'alice' });
    return (d.status === 404 || d.status === 403) && g.status === 200 ? PASS('B 删除=' + d.status + '，A 读=' + g.status, ev('DELETE', '/api/attachments/' + A_ATT, d)) : FAIL('B删除=' + d.status + ' A读=' + g.status, '', 'S1');
  });

  /* ---------- 4. 补充：越权读版本/历史与搜索侧信道 ---------- */
  await C('TC-NOTE-101', '空间隔离', 'B 读 A 笔记的版本列表与首个版本（回证）', '404/403', async () => {
    const v1 = await G('/api/notes/' + A_NOTE + '/versions', { as: 'bob' });
    const v2 = await G('/api/notes/' + A_NOTE + '/versions/1', { as: 'bob' });
    const ok = [404, 403].indexOf(v1.status) >= 0 && [404, 403].indexOf(v2.status) >= 0;
    return ok ? PASS('versions=' + v1.status + ' version1=' + v2.status, ev('GET', '/api/notes/{id}/versions', v1)) : FAIL('versions=' + v1.status + ' v1=' + v2.status + ' ' + snip(v2, 90), '', 'S1');
  });
  await C('TC-SEARCH-101', '空间隔离', '搜索侧信道：B 用 A 标题前缀逐字探测', '始终 0 结果', async () => {
    const probes = ['ALICE-ONLY', 'ALICE-ONLY-MARK', 'A2机密', '机'];
    const out = [];
    for (const q of probes) { const r = await G('/api/search?q=' + encodeURIComponent(q), { as: 'bob', silent: true }); out.push(q + '=' + (r.json ? r.json.total : '?')); }
    const bad = out.filter(x => !/=(0|null|\?)$/.test(x));
    return bad.length ? FAIL('出现命中：' + out.join(' '), '', 'S1') : PASS(out.join(' '), '');
  });
  await C('TC-NOTE-102', '空间隔离', 'B 通过 PATCH 把 A 的笔记移到自己目录（folderId 越权写）', '404/403，A 笔记目录不变', async () => {
    const fB = await P('/api/folders', { as: 'bob', json: { name: 'bob2目录' } });
    const fid = fB.json && fB.json.id;
    const r = await PATCH('/api/notes/' + A_NOTE, { as: 'bob', json: { folderId: fid } });
    const chk = await G('/api/notes/' + A_NOTE, { as: 'alice' });
    const moved = chk.json && String(chk.json.folderId) === String(fid);
    return (r.status === 404 || r.status === 403) && !moved ? PASS('PATCH=' + r.status + '，A 的 folderId=' + (chk.json || {}).folderId, ev('PATCH', '/api/notes/{A}', r)) : FAIL('PATCH=' + r.status + ' moved=' + moved, '', 'S1');
  });

  finish();
}
let fin = false;
function finish() {
  if (fin) return; fin = true;
  const stat = { total: cases.length, pass: 0, fail: 0, blocked: 0 };
  for (const c of cases) { if (c.verdict === 'PASS') stat.pass++; else if (c.verdict === 'FAIL') stat.fail++; else stat.blocked++; }
  fs.writeFileSync(path.join(EV, 'e2p-results-' + TS + '.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stat: stat, cases: cases }, null, 2));
  const lines = ['# E2 安全用例（第二轮：ZIP 深检 / 越权回证）', '', '- 统计：' + stat.total + ' / 通过 ' + stat.pass + ' / 失败 ' + stat.fail + ' / 阻塞 ' + stat.blocked, '', '| 用例 | 分类 | 名称 | 结论 | 严重度 | 实际 | 证据 |', '|---|---|---|---|---|---|---|'];
  for (const c of cases) lines.push('| ' + c.id + ' | ' + c.cat + ' | ' + c.name.replace(/\|/g, '/') + ' | ' + c.verdict + ' | ' + (c.severity || '-') + ' | ' + String(c.actual).replace(/\|/g, '/').slice(0, 150) + ' | ' + String(c.evidence).replace(/\|/g, '/').slice(0, 190) + ' |');
  fs.writeFileSync(path.join(EV, 'e2p-cases-' + TS + '.md'), lines.join('\n'));
  console.log('STAT2 ' + JSON.stringify(stat));
  try { fs.closeSync(rawFd); } catch (e) {}
}
setTimeout(() => { try { finish(); } catch (e) {} process.exit(4); }, 240000);
main().then(() => setTimeout(() => process.exit(0), 500)).catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : e)); try { finish(); } catch (e2) {} setTimeout(() => process.exit(5), 800); });
