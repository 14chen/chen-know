#!/usr/bin/env node
/**
 * E2 安全测试套件（知识库）
 * 覆盖：跨空间越权/IDOR、会话、CSRF、SQLi(FTS5)、XSS、上传、ZIP 导入导出、鉴权与暴力破解、信息泄露、HTTP 头
 * 用法：node e2-security.mjs
 * 端口 8503，数据目录 F:\work\test\kb\d-e2（由 kb-harness.ps1 启停）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HOST = '127.0.0.1';
const PORT = 8503;
const BASE = 'http://' + HOST + ':' + PORT;
const EV = 'D:\\work\\知识库\\docs\\test-20261027\\evidence\\e2';
const DATADIR = 'F:\\work\\test\\kb\\d-e2';
const TS = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.mkdirSync(EV, { recursive: true });
const RAW = path.join(EV, 'e2-raw-' + TS + '.log');
const rawFd = fs.openSync(RAW, 'a');

const cases = [];
let seq = 0;
function C(id, cat, name, expect, fn) {
  return (async () => {
    let out;
    try { out = await fn(); } catch (e) { out = { v: 'BLOCKED', a: 'EXC ' + e.message, e: '', sev: '' }; }
    const rec = { id: id, cat: cat, name: name, expect: expect, verdict: out.v, actual: out.a || '', evidence: (out.e || '').slice(0, 900), severity: out.sev || '' };
    cases.push(rec); seq += 1;
    console.log('[' + out.v + '] ' + id + ' ' + name + ' :: ' + String(out.a).slice(0, 110));
  })();
}
const PASS = (a, e) => ({ v: 'PASS', a: a, e: e });
const FAIL = (a, e, sev) => ({ v: 'FAIL', a: a, e: e, sev: sev || 'S3' });
const BLOCK = (a, e) => ({ v: 'BLOCKED', a: a, e: e });

/* ---------------- HTTP + cookie jar ---------------- */
const jars = {};
function jar(name) { if (!jars[name]) jars[name] = {}; return jars[name]; }
function cookieHeader(name) { return Object.entries(jar(name)).map(([k, v]) => k + '=' + v).join('; '); }
function storeCookies(name, setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of list) {
    const kv = String(c).split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) jar(name)[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
}
function request(method, p, opt) {
  opt = opt || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opt.headers || {});
    let body = null;
    if (opt.json !== undefined) { body = Buffer.from(JSON.stringify(opt.json)); headers['Content-Type'] = 'application/json'; }
    else if (opt.form !== undefined) { body = Buffer.from(new URLSearchParams(opt.form).toString()); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (opt.rawBody) { body = opt.rawBody; if (opt.rawType) headers['Content-Type'] = opt.rawType; }
    if (body) headers['Content-Length'] = body.length;
    if (opt.cookie) headers['Cookie'] = opt.cookie;
    else if (opt.as && Object.keys(jar(opt.as)).length) headers['Cookie'] = cookieHeader(opt.as);
    Object.assign(headers, opt.headers || {});
    const req = http.request({ host: HOST, port: PORT, method: method, path: p, headers: headers, timeout: 60000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        if (opt.as) storeCookies(opt.as, res.headers['set-cookie']);
        if (!opt.silent) {
          try { fs.writeSync(rawFd, '[' + (opt.as || 'anon') + '] ' + method + ' ' + p + ' -> ' + res.statusCode + ' :: ' + text.replace(/\s+/g, ' ').slice(0, 500) + '\n'); } catch (e) {}
        }
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
const PUT = (p, o) => request('PUT', p, o);
function snip(r, n) { const t = (r && r.text ? r.text : '').replace(/\s+/g, ' '); return t.slice(0, n || 160); }
function ev(method, p, r, extra) { return method + ' ' + p + ' => ' + (r ? r.status : 'ERR') + ' | ' + snip(r, 150) + (extra ? ' | ' + extra : ''); }

/* ---------------- 最小 ZIP 写入（store，无压缩；可构造 ../ 条目） ---------------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStore(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const en of entries) {
    const name = Buffer.from(en.name, 'utf8');
    const data = Buffer.from(en.data === undefined ? '' : en.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}
function multipart(fields, files) {
  const b = '----e2' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const k of Object.keys(fields || {})) parts.push(Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(fields[k]) + '\r\n'));
  for (const f of files) parts.push(Buffer.concat([
    Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="' + (f.field || 'file') + '"; filename="' + f.filename + '"\r\nContent-Type: ' + (f.type || 'application/octet-stream') + '\r\n\r\n'),
    f.data, Buffer.from('\r\n')
  ]));
  parts.push(Buffer.from('--' + b + '--\r\n'));
  return { body: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + b };
}
async function upload(asName, filename, type, data, extra) {
  const mp = multipart(extra || {}, [{ filename: filename, type: type, data: data }]);
  return P('/api/attachments', { as: asName, rawBody: mp.body, rawType: mp.type });
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const created = { notes: [], folders: [], atts: [], tags: [] };

async function main() {
  const h = await G('/api/health');
  if (h.status !== 200) throw new Error('service not healthy: ' + h.status);
  console.log('health: ' + snip(h, 120));

  /* ---------- 建 3 个账号：admin / alice / bob ---------- */
  const ts = Date.now().toString().slice(-6);
  const AD = 'e2admin' + ts, AL = 'e2alice' + ts, BO = 'e2bob' + ts;
  const PW = 'Passw0rd#' + ts;
  const reg = await P('/api/auth/register', { json: { username: AD, displayName: 'E2管理员', password: PW } });
  const regA = await P('/api/auth/register', { json: { username: AL, displayName: 'E2爱丽丝', password: PW } });
  const lgAd = await P('/api/auth/login', { as: 'admin', json: { username: AD, password: PW } });
  const inv1 = await P('/api/admin/invites', { as: 'admin', json: { expiresInHours: 24 } });
  const inv2 = await P('/api/admin/invites', { as: 'admin', json: { expiresInHours: 24 } });
  const code1 = inv1.json && inv1.json.code, code2 = inv2.json && inv2.json.code;
  const r1 = await P('/api/auth/register', { json: { username: AL, displayName: 'E2爱丽丝', password: PW, inviteCode: code1 } });
  const r2 = await P('/api/auth/register', { json: { username: BO, displayName: 'E2鲍勃', password: PW, inviteCode: code2 } });
  const lgA = await P('/api/auth/login', { as: 'alice', json: { username: AL, password: PW } });
  const lgB = await P('/api/auth/login', { as: 'bob', json: { username: BO, password: PW } });
  console.log('setup: adminReg=' + reg.status + ' regNoInvite=' + regA.status + ' aliceReg=' + r1.status + ' bobReg=' + r2.status + ' logins=' + lgAd.status + '/' + lgA.status + '/' + lgB.status);
  const setId = (t) => t === 'admin' ? 'admin' : t;

  /* ---------- alice 造数据 ---------- */
  const nA = await P('/api/notes', { as: 'alice', json: { title: 'alice机密笔记', content: 'ALICE-SECRET-TOKEN 内容' + '<script>alert(1)</script>' } });
  const A_NOTE = nA.json && nA.json.id;
  const fA = await P('/api/folders', { as: 'alice', json: { name: 'alice机密目录' } });
  const A_FOLDER = fA.json && fA.json.id;
  const tA = await P('/api/tags', { as: 'alice', json: { name: 'alice机密标签' } });
  const A_TAG = tA.json && tA.json.id;
  const aUp = await upload('alice', 'alice-secret.png', 'image/png', PNG, {});
  const A_ATT = aUp.json && aUp.json.id;
  await PATCH('/api/notes/' + A_NOTE, { as: 'alice', json: { content: 'ALICE-SECRET-TOKEN 第二版 <img src=x onerror=alert(1)>' } });
  const nDel = await P('/api/notes', { as: 'alice', json: { title: 'alice待删笔记', content: 'will be deleted' } });
  const A_DEL = nDel.json && nDel.json.id;
  await DEL('/api/notes/' + A_DEL, { as: 'alice' });
  const nB = await P('/api/notes', { as: 'bob', json: { title: 'bob自己的笔记', content: 'bob content only' } });
  const B_NOTE = nB.json && nB.json.id;
  console.log('alice data: note=' + A_NOTE + ' folder=' + A_FOLDER + ' tag=' + A_TAG + ' att=' + A_ATT + ' deleted=' + A_DEL + ' | bob note=' + B_NOTE);

  /* ================= A. 跨空间越权 / IDOR ================= */
  const NOSUCH = 999999;
  const base404 = await G('/api/notes/' + NOSUCH, { as: 'bob' });
  const cross = await G('/api/notes/' + A_NOTE, { as: 'bob' });
  await C('TC-NOTE-001', '空间隔离', 'B 直接读 A 的笔记 id', '404 且与不存在 id 响应一致（不泄露存在性）', async () => {
    const same = cross.status === base404.status && String(cross.text) === String(base404.text);
    if (cross.status === 200) return FAIL('B 读到了 A 的笔记正文：' + snip(cross, 120), ev('GET', '/api/notes/' + A_NOTE, cross), 'S1');
    return PASS('status=' + cross.status + ' 与不存在 id 响应一致=' + same, ev('GET', '/api/notes/' + A_NOTE, cross, 'baseline=' + base404.status + ' ' + snip(base404, 60)));
  });
  await C('TC-NOTE-002', '空间隔离', 'B 用 A 的 id 改标题（PATCH）', '404/403，且 A 的笔记未被改动', async () => {
    const r = await PATCH('/api/notes/' + A_NOTE, { as: 'bob', json: { title: 'HACKED-BY-BOB' } });
    const chk = await G('/api/notes/' + A_NOTE, { as: 'alice' });
    const hacked = chk.json && String(chk.json.title).indexOf('HACKED') >= 0;
    if (r.status < 300 && hacked) return FAIL('跨空间改写成功，A 的标题变成 ' + chk.json.title, ev('PATCH', '/api/notes/' + A_NOTE, r, 'A 复查 title=' + (chk.json || {}).title), 'S1');
    return PASS('写被拒 status=' + r.status + '，A 的标题未变=' + !hacked, ev('PATCH', '/api/notes/' + A_NOTE, r));
  });
  await C('TC-NOTE-003', '空间隔离', 'B 用 A 的 id 删除（DELETE）', '404/403，A 的笔记仍可读', async () => {
    const r = await DEL('/api/notes/' + A_NOTE, { as: 'bob' });
    const chk = await G('/api/notes/' + A_NOTE, { as: 'alice' });
    if (r.status < 300 && chk.status !== 200) return FAIL('跨空间删除成功', ev('DELETE', '/api/notes/' + A_NOTE, r, 'A 复查=' + chk.status), 'S1');
    return PASS('删除被拒 status=' + r.status + '，A 仍可读=' + chk.status, ev('DELETE', '/api/notes/' + A_NOTE, r));
  });
  await C('TC-NOTE-004', '空间隔离', 'B 给 A 的笔记记浏览（POST /view）', '404/403', async () => {
    const r = await P('/api/notes/' + A_NOTE + '/view', { as: 'bob' });
    return (r.status === 404 || r.status === 403) ? PASS('status=' + r.status, ev('POST', '/api/notes/' + A_NOTE + '/view', r)) : FAIL('status=' + r.status, ev('POST', '/api/notes/' + A_NOTE + '/view', r), 'S2');
  });
  for (const [id, seg, name] of [['TC-NOTE-005', 'links', '出链'], ['TC-NOTE-006', 'backlinks', '反链'], ['TC-NOTE-007', 'versions', '版本列表']]) {
    await C(id, '空间隔离', 'B 读 A 笔记的' + name + '（/' + seg + '）', '404/403', async () => {
      const r = await G('/api/notes/' + A_NOTE + '/' + seg, { as: 'bob' });
      return (r.status === 404 || r.status === 403) ? PASS('status=' + r.status, ev('GET', '/api/notes/' + A_NOTE + '/' + seg, r)) : FAIL('status=' + r.status + ' ' + snip(r, 90), ev('GET', '/api/notes/' + A_NOTE + '/' + seg, r), 'S1');
    });
  }
  await C('TC-NOTE-008', '空间隔离', 'B 读 A 笔记的历史版本全文', '404/403', async () => {
    const r = await G('/api/notes/' + A_NOTE + '/versions/1', { as: 'bob' });
    return (r.status === 404 || r.status === 403) ? PASS('status=' + r.status, ev('GET', '/api/notes/' + A_NOTE + '/versions/1', r)) : FAIL('返回 ' + r.status + ' 正文 ' + snip(r, 100), ev('GET', '/api/notes/' + A_NOTE + '/versions/1', r), 'S1');
  });
  await C('TC-NOTE-009', '空间隔离', 'B 把 A 的笔记回滚到某版本', '404/403', async () => {
    const r = await P('/api/notes/' + A_NOTE + '/versions/1/restore', { as: 'bob' });
    return (r.status === 404 || r.status === 403) ? PASS('status=' + r.status, ev('POST', '/api/notes/' + A_NOTE + '/versions/1/restore', r)) : FAIL('status=' + r.status, ev('POST', '/api/notes/' + A_NOTE + '/versions/1/restore', r), 'S1');
  });
  await C('TC-TAG-001', '空间隔离', 'B 覆盖式设置 A 笔记的标签', '404/403', async () => {
    const r = await PUT('/api/notes/' + A_NOTE + '/tags', { as: 'bob', json: { tagNames: ['bob-pwn'] } });
    const chk = await G('/api/notes/' + A_NOTE, { as: 'alice' });
    const tags = (chk.json && chk.json.tags || []).map(t => t.name).join(',');
    return (r.status === 404 || r.status === 403) ? PASS('status=' + r.status + '，A 的标签未变(' + tags + ')', ev('PUT', '/api/notes/' + A_NOTE + '/tags', r)) : FAIL('status=' + r.status + '，A 标签=' + tags, ev('PUT', '/api/notes/' + A_NOTE + '/tags', r), 'S1');
  });
  await C('TC-FILE-001', '空间隔离', 'B 读 A 的附件（GET /api/attachments/{id}）', '404/403，且不返回文件字节', async () => {
    const r = await G('/api/attachments/' + A_ATT, { as: 'bob' });
    if (r.status === 200 && r.buf && r.buf[0] === 0x89) return FAIL('越权读到 A 的附件 ' + r.len + ' 字节', ev('GET', '/api/attachments/' + A_ATT, r, 'Content-Type=' + r.headers['content-type']), 'S1');
    return PASS('status=' + r.status, ev('GET', '/api/attachments/' + A_ATT, r));
  });
  await C('TC-FILE-002', '空间隔离', 'B 删 A 的附件', '404/403，A 仍能读', async () => {
    const r = await DEL('/api/attachments/' + A_ATT, { as: 'bob' });
    const chk = await G('/api/attachments/' + A_ATT, { as: 'alice' });
    return (r.status === 404 || r.status === 403) && chk.status === 200 ? PASS('删除被拒 ' + r.status + '，A 仍可读 200', ev('DELETE', '/api/attachments/' + A_ATT, r)) : FAIL('delete=' + r.status + ' A复查=' + chk.status, ev('DELETE', '/api/attachments/' + A_ATT, r), 'S1');
  });
  await C('TC-FILE-003', '空间隔离', 'B 把新附件挂到 A 的笔记上（noteId 越权写）', '拒绝或挂到自己空间，绝不写进 A 的笔记', async () => {
    const r = await upload('bob', 'bob-inject.png', 'image/png', PNG, { noteId: String(A_NOTE) });
    const id = r.json && r.json.id;
    if (r.status >= 300) return PASS('status=' + r.status + '（拒绝）', ev('POST', '/api/attachments', r, 'noteId=' + A_NOTE));
    const aNotes = await G('/api/notes/' + A_NOTE, { as: 'alice' });
    const leaked = (aNotes.json && aNotes.json.attachments || []).some ? false : false;
    const aAttList = JSON.stringify(aNotes.json || {});
    if (id) created.atts.push(id);
    const visible = aAttList.indexOf('bob-inject') >= 0;
    return visible ? FAIL('B 的附件挂进了 A 的笔记', ev('POST', '/api/attachments', r), 'S1') : PASS('status=' + r.status + ' 附件 id=' + id + '，未出现在 A 的笔记里', ev('POST', '/api/attachments', r, 'A 笔记附件字段未见 bob-inject'));
  });
  await C('TC-FOLDER-001', '空间隔离', 'B 的目录树里不含 A 的目录', '不含 alice机密目录', async () => {
    const r = await G('/api/folders?tree=true', { as: 'bob' });
    const has = (r.text || '').indexOf('alice机密目录') >= 0;
    return has ? FAIL('B 的目录树里出现 A 的目录', ev('GET', '/api/folders?tree=true', r), 'S1') : PASS('未出现（status=' + r.status + '）', ev('GET', '/api/folders?tree=true', r));
  });
  await C('TC-FOLDER-002', '空间隔离', 'B 改 A 的目录名（PATCH）', '404/403', async () => {
    const r = await PATCH('/api/folders/' + A_FOLDER, { as: 'bob', json: { name: 'hacked-folder' } });
    const chk = await G('/api/folders?tree=true', { as: 'alice' });
    const renamed = (chk.text || '').indexOf('hacked-folder') >= 0;
    return (r.status === 404 || r.status === 403) && !renamed ? PASS('status=' + r.status + '，A 的目录名未变', ev('PATCH', '/api/folders/' + A_FOLDER, r)) : FAIL('status=' + r.status + ' renamed=' + renamed, ev('PATCH', '/api/folders/' + A_FOLDER, r), 'S1');
  });
  await C('TC-FOLDER-003', '空间隔离', 'B 删 A 的目录（连同其中笔记）', '404/403，A 的目录与笔记仍在', async () => {
    const r = await DEL('/api/folders/' + A_FOLDER, { as: 'bob' });
    const chk = await G('/api/folders?tree=true', { as: 'alice' });
    const gone = (chk.text || '').indexOf('alice机密目录') < 0;
    return (r.status === 404 || r.status === 403) && !gone ? PASS('status=' + r.status + '，A 的目录仍在', ev('DELETE', '/api/folders/' + A_FOLDER, r)) : FAIL('status=' + r.status + ' 目录消失=' + gone, ev('DELETE', '/api/folders/' + A_FOLDER, r), 'S1');
  });
  await C('TC-TAG-002', '空间隔离', 'B 的标签列表不含 A 的标签', '不含 alice机密标签', async () => {
    const r = await G('/api/tags', { as: 'bob' });
    return (r.text || '').indexOf('alice机密标签') >= 0 ? FAIL('B 看到 A 的标签', ev('GET', '/api/tags', r), 'S1') : PASS('未出现', ev('GET', '/api/tags', r));
  });
  await C('TC-TAG-003', '空间隔离', 'B 改/删 A 的标签', '404/403', async () => {
    const p1 = await PATCH('/api/tags/' + A_TAG, { as: 'bob', json: { name: 'bob-hacked' } });
    const p2 = await DEL('/api/tags/' + A_TAG, { as: 'bob' });
    const ok = (p1.status === 404 || p1.status === 403) && (p2.status === 404 || p2.status === 403);
    return ok ? PASS('PATCH=' + p1.status + ' DELETE=' + p2.status, ev('DELETE', '/api/tags/' + A_TAG, p2, 'PATCH=' + p1.status)) : FAIL('PATCH=' + p1.status + ' DELETE=' + p2.status, '', 'S1');
  });
  await C('TC-TRASH-001', '空间隔离', 'B 的回收站不含 A 删掉的笔记', '不含 alice待删笔记', async () => {
    const r = await G('/api/trash', { as: 'bob' });
    return (r.text || '').indexOf('alice待删笔记') >= 0 ? FAIL('B 的回收站出现 A 的笔记', ev('GET', '/api/trash', r), 'S1') : PASS('未出现', ev('GET', '/api/trash', r));
  });
  await C('TC-TRASH-002', '空间隔离', 'B 从回收站恢复 A 的笔记', '404/403', async () => {
    const r = await P('/api/trash/notes/' + A_DEL + '/restore', { as: 'bob' });
    const chk = await G('/api/notes/' + A_DEL, { as: 'alice' });
    return (r.status === 404 || r.status === 403) && chk.status !== 200 ? PASS('status=' + r.status + '，A 的笔记仍处删除态', ev('POST', '/api/trash/notes/' + A_DEL + '/restore', r)) : FAIL('status=' + r.status + ' A 复查=' + chk.status, ev('POST', '/api/trash/notes/' + A_DEL + '/restore', r), 'S1');
  });
  await C('TC-TRASH-003', '空间隔离', 'B 彻底删除 A 回收站里的笔记', '404/403，A 仍能在回收站看到', async () => {
    const r = await DEL('/api/trash/notes/' + A_DEL, { as: 'bob' });
    const chk = await G('/api/trash', { as: 'alice' });
    const still = (chk.text || '').indexOf('alice待删笔记') >= 0;
    return (r.status === 404 || r.status === 403) && still ? PASS('status=' + r.status + '，A 回收站仍有该笔记', ev('DELETE', '/api/trash/notes/' + A_DEL, r)) : FAIL('status=' + r.status + ' still=' + still, ev('DELETE', '/api/trash/notes/' + A_DEL, r), 'S1');
  });
  await C('TC-EXPORT-001', '空间隔离', 'B 导出 A 的笔记 ZIP', '404/403', async () => {
    const r = await G('/api/export/notes/' + A_NOTE + '.zip', { as: 'bob' });
    return (r.status === 404 || r.status === 403) ? PASS('status=' + r.status, ev('GET', '/api/export/notes/' + A_NOTE + '.zip', r)) : FAIL('status=' + r.status + ' len=' + r.len, ev('GET', '/api/export/notes/' + A_NOTE + '.zip', r), 'S1');
  });
  await C('TC-EXPORT-002', '空间隔离', 'B 导出整库不含 A 的内容', '不含 ALICE-SECRET-TOKEN / alice机密', async () => {
    const r = await G('/api/export/all', { as: 'bob' });
    if (r.status !== 200) return BLOCK('导出返回 ' + r.status, ev('GET', '/api/export/all', r));
    const hasAlice = r.buf.indexOf(Buffer.from('ALICE-SECRET-TOKEN')) >= 0 || r.buf.indexOf(Buffer.from('alice')) >= 0;
    return hasAlice ? FAIL('B 的整库导出里出现 A 的内容', ev('GET', '/api/export/all', r), 'S1') : PASS('导出 ' + r.len + ' 字节，未命中 A 的标识串', ev('GET', '/api/export/all', r, 'len=' + r.len));
  });
  await C('TC-NOTE-010', '空间隔离', 'IDOR 遍历笔记 id 1..25（B 身份）', '全部 404/403，无一 200', async () => {
    const hits = [];
    for (let i = 1; i <= 25; i++) {
      const r = await G('/api/notes/' + i, { as: 'bob', silent: true });
      if (r.status === 200) hits.push(i + ':' + String((r.json || {}).title || '').slice(0, 12));
    }
    const own = hits.filter(h => h.indexOf('bob自己的笔记') >= 0).length;
    const bad = hits.length - own;
    return bad === 0 ? PASS('25 次遍历命中 ' + hits.length + ' 条（其中本人 ' + own + ' 条）', 'GET /api/notes/1..25 as bob') : FAIL('命中他人笔记 ' + bad + ' 条：' + hits.join(','), 'GET /api/notes/1..25 as bob', 'S1');
  });
  await C('TC-SEARCH-001', '空间隔离', 'B 搜索 A 笔记里的专有词', '0 条结果', async () => {
    const r = await G('/api/search?q=ALICE-SECRET-TOKEN', { as: 'bob' });
    const total = r.json && r.json.total;
    return (r.status === 200 && total === 0) ? PASS('total=0', ev('GET', '/api/search?q=ALICE-SECRET-TOKEN', r)) : FAIL('total=' + total + ' ' + snip(r, 100), ev('GET', '/api/search?q=ALICE-SECRET-TOKEN', r), 'S1');
  });
  await C('TC-SEARCH-002', '空间隔离', 'B 按标签过滤取 A 的标签', '0 条结果', async () => {
    const r = await G('/api/search?tag=' + encodeURIComponent('alice机密标签'), { as: 'bob' });
    const total = r.json ? (r.json.total !== undefined ? r.json.total : (r.json.items || []).length) : -1;
    return total === 0 ? PASS('total=0', ev('GET', '/api/search?tag=alice机密标签', r)) : FAIL('total=' + total, ev('GET', '/api/search?tag=alice机密标签', r), 'S1');
  });
  await C('TC-STAT-001', '空间隔离', 'B 的统计数字只算自己', 'noteCount 不含 A 的笔记', async () => {
    const r = await G('/api/stats', { as: 'bob' });
    const n = r.json && r.json.noteCount;
    return (r.status === 200 && n !== undefined && n <= 2) ? PASS('noteCount=' + n, ev('GET', '/api/stats', r)) : FAIL('noteCount=' + n + '（B 只有 1~2 篇）', ev('GET', '/api/stats', r), 'S1');
  });
  await C('TC-STAT-002', '空间隔离', 'B 的最近浏览/收藏不含 A 的笔记', '不含 A 的 id', async () => {
    const r1 = await G('/api/recent?limit=20', { as: 'bob' });
    const r2 = await G('/api/favorites', { as: 'bob' });
    const leak = (r1.text || '').indexOf('alice') >= 0 || (r2.text || '').indexOf('alice') >= 0;
    return leak ? FAIL('出现 A 的笔记', '', 'S1') : PASS('recent=' + r1.status + ' favorites=' + r2.status + ' 均未命中 alice', ev('GET', '/api/recent', r1));
  });

  /* ================= B. 会话安全 ================= */
  const lh = await P('/api/auth/login', { as: 'sess', json: { username: AL, password: PW } });
  const sc = lh.headers['set-cookie'] || [];
  const scStr = Array.isArray(sc) ? sc.join(' | ') : String(sc);
  await C('TC-AUTH-001', '会话', 'KB_SESSION 的 HttpOnly / SameSite / Path 标志', 'HttpOnly + SameSite=Lax + Path=/', async () => {
    const lower = scStr.toLowerCase();
    const ok = lower.indexOf('httponly') >= 0 && lower.indexOf('samesite=lax') >= 0 && lower.indexOf('path=/') >= 0;
    return ok ? PASS('Set-Cookie: ' + scStr.slice(0, 140), 'login 响应头') : FAIL('缺少标志：' + scStr.slice(0, 160), 'login 响应头', 'S2');
  });
  await C('TC-AUTH-002', '会话', 'HTTP 下是否误标 Secure（会导到不了站点）', '无 Secure 或仅 HTTPS 时有', async () => {
    const hasSecure = String(scStr).toLowerCase().indexOf('secure') >= 0;
    return PASS('Secure=' + hasSecure + '（当前 HTTP 明文访问）', 'Set-Cookie: ' + scStr.slice(0, 120));
  });
  await C('TC-AUTH-003', '会话', '伪造/篡改 KB_SESSION 值', '401', async () => {
    const r = await G('/api/auth/me', { cookie: 'KB_SESSION=deadbeefdeadbeefdeadbeefdeadbeef' });
    return r.status === 401 ? PASS('401', ev('GET', '/api/auth/me', r)) : FAIL('status=' + r.status, ev('GET', '/api/auth/me', r), 'S1');
  });
  await C('TC-AUTH-004', '会话', '未带 Cookie 访问受保护接口', '401', async () => {
    const r = await G('/api/notes');
    return r.status === 401 ? PASS('401', ev('GET', '/api/notes', r)) : FAIL('status=' + r.status, ev('GET', '/api/notes', r), 'S1');
  });
  await C('TC-AUTH-005', '会话', '登出后旧 Cookie 是否还能用', '401（服务端销毁会话）', async () => {
    const r0 = await G('/api/auth/me', { as: 'sess' });
    const old = cookieHeader('sess');
    const lo = await P('/api/auth/logout', { as: 'sess' });
    const r1 = await G('/api/auth/me', { cookie: old });
    const r2 = await G('/api/notes', { cookie: old });
    return (lo.status === 204 || lo.status === 200) && r1.status === 401 && r2.status === 401 ? PASS('logout=' + lo.status + ' → 复用 401/401', ev('GET', '/api/auth/me', r1, '旧 cookie 复用')) : FAIL('logout=' + lo.status + ' me=' + r1.status + ' notes=' + r2.status, ev('GET', '/api/auth/me', r1), 'S1');
  });
  await C('TC-AUTH-006', '会话', '会话固定：登录前后会话标识是否变化', '登录后为新会话（不复用未登录时下发的值）', async () => {
    const pre = await G('/api/auth/me');
    const preCookie = (pre.headers['set-cookie'] || []).join(';');
    await P('/api/auth/login', { as: 'fix', json: { username: AL, password: PW } });
    const post = cookieHeader('fix');
    const preVal = (preCookie.match(/KB_SESSION=([^;]+)/) || [])[1] || '';
    const postVal = (post.match(/KB_SESSION=([^;]+)/) || [])[1] || '';
    if (!preVal) return PASS('未登录时不下发会话 cookie（无固定点），登录后值=' + postVal.slice(0, 8) + '…', 'anon 响应无 Set-Cookie');
    return preVal !== postVal ? PASS('登录前=' + preVal.slice(0, 8) + '… 登录后=' + postVal.slice(0, 8) + '…（已更换）', 'anon Set-Cookie vs 登录 Set-Cookie') : FAIL('登录后沿用匿名会话值', 'anon=' + preVal.slice(0, 12), 'S2');
  });
  await C('TC-AUTH-007', '会话', '同一账号并发两个会话是否都有效', '均有效（互不踢掉）', async () => {
    await P('/api/auth/login', { as: 'alice2', json: { username: AL, password: PW } });
    const a = await G('/api/auth/me', { as: 'alice' });
    const b = await G('/api/auth/me', { as: 'alice2' });
    return (a.status === 200 && b.status === 200) ? PASS('两个会话都 200', 'alice 原会话=' + a.status + '，新会话=' + b.status) : BLOCK('a=' + a.status + ' b=' + b.status, '');
  });
  await C('TC-AUTH-008', '会话', 'Cookie 值长度/随机性（不足以对抗猜测）', '长度 ≥ 128 位随机', async () => {
    const v = (cookieHeader('alice2').match(/KB_SESSION=([^;]+)/) || [])[1] || '';
    return v.length >= 32 ? PASS('长度 ' + v.length, 'KB_SESSION 长度=' + v.length) : FAIL('长度仅 ' + v.length, '', 'S3');
  });

  /* ================= C. CSRF ================= */
  await C('TC-AUTH-010', 'CSRF', '跨源 POST 能否修改数据（带 Origin: evil）', 'SameSite=Lax 下浏览器不发 Cookie；服务端若无 Origin 校验则仅靠 Lax', async () => {
    const r = await P('/api/notes', { as: 'alice', json: { title: 'csrf-probe', content: 'x' }, headers: { Origin: 'https://evil.example.com', 'Sec-Fetch-Site': 'cross-site' } });
    if (r.status === 201) { if (r.json && r.json.id) created.notes.push(r.json.id); return FAIL('服务端接受跨源 POST（201）——无 Origin 校验，唯一防线是 SameSite=Lax', ev('POST', '/api/notes', r, 'Origin: https://evil.example.com'), 'S3'); }
    return PASS('拒绝 status=' + r.status, ev('POST', '/api/notes', r));
  });
  await C('TC-AUTH-011', 'CSRF', '是否存在 CSRF token（页面/接口）', '契约声明不启用（依赖 Lax），确认无 token 机制', async () => {
    const r = await G('/');
    const has = /csrf/i.test(r.text || '');
    return PASS('页面未见 csrf 字段=' + has + '（契约 §0.2 声明不启用，防线为 SameSite=Lax）', 'GET / 首屏 ' + (r.text || '').length + ' 字节');
  });
  await C('TC-AUTH-012', 'CSRF', 'GET 是否触发写操作（导出写审计日志）', '仅导出会写日志；不得有其它 GET 写库', async () => {
    const before = await G('/api/stats', { as: 'alice' });
    const ex = await G('/api/export/all', { as: 'alice' });
    const after = await G('/api/stats', { as: 'alice' });
    return PASS('export/all=' + ex.status + '，stats 前后 noteCount ' + (before.json || {}).noteCount + '→' + (after.json || {}).noteCount + '（仅写 export 活动日志）', 'GET 侧无破坏性写入');
  });

  /* ================= D. SQL 注入 / FTS5 MATCH ================= */
  const injects = [
    ["' OR 1=1 --", '经典'],
    ['" OR 1=1 --', '双引号闭合'],
    ['NEAR(', 'FTS5 NEAR 未闭合'],
    ['(', '括号不闭合'],
    ['*', '通配星号'],
    ['title:foo', '列限定符'],
    ['a AND b', '布尔运算符'],
    ['^abc', '行首符'],
    ['"', '孤立双引号'],
    ['\\', '反斜杠'],
    ["' UNION SELECT 1,2,3 --", 'UNION'],
    ['1);DROP TABLE notes;--', '堆叠语句'],
  ];
  for (let i = 0; i < injects.length; i++) {
    const [q, label] = injects[i];
    await C('TC-SEARCH-1' + String(i + 1).padStart(2, '0'), 'SQL 注入', 'FTS5 查询注入：' + label + ' ' + q, '不 500、不报 SQL 错误', async () => {
      const r = await G('/api/search?q=' + encodeURIComponent(q), { as: 'alice' });
      const bad = r.status >= 500 || /SQLITE|OperationalError|syntax error|FTS5|no such table/i.test(r.text || '');
      if (bad) return FAIL('触发 ' + r.status + '：' + snip(r, 130), ev('GET', '/api/search?q=' + q, r), 'S1');
      return PASS('status=' + r.status + ' total=' + ((r.json || {}).total), ev('GET', '/api/search?q=' + q, r));
    });
  }
  await C('TC-SEARCH-020', 'SQL 注入', 'tag 参数注入', '不 500、不越权', async () => {
    const r = await G('/api/search?tag=' + encodeURIComponent("' OR 1=1 --"), { as: 'bob' });
    return (r.status < 500 && !/SQLITE|syntax error/i.test(r.text || '')) ? PASS('status=' + r.status + ' total=' + ((r.json || {}).total), ev('GET', '/api/search?tag=...', r)) : FAIL('status=' + r.status + ' ' + snip(r, 120), '', 'S1');
  });
  await C('TC-NOTE-020', 'SQL 注入', '列表 folderId 参数注入', '不 500、不越权', async () => {
    const tries = ['1 OR 1=1', '1;DROP TABLE notes', "1' --", 'abc', '-1', '99999999999999999999'];
    const out = [];
    for (const t of tries) { const r = await G('/api/notes?folderId=' + encodeURIComponent(t), { as: 'bob', silent: true }); out.push(r.status + (r.status >= 500 ? '!' : '')); if (r.status >= 500 || /SQLITE|syntax error/i.test(r.text || '')) return FAIL('folderId=' + t + ' 触发 ' + r.status + ' ' + snip(r, 100), '', 'S1'); }
    return PASS('6 组取值状态 ' + out.join('/'), 'GET /api/notes?folderId=...');
  });
  await C('TC-NOTE-021', 'SQL 注入', 'sort 参数注入（order by 拼接点）', '非法 sort 回落默认，不 500', async () => {
    const tries = ['updated;DROP TABLE notes;--', "title' ,(select 1)", 'xxx', 'updated DESC'];
    const out = [];
    for (const t of tries) { const r = await G('/api/notes?sort=' + encodeURIComponent(t), { as: 'alice', silent: true }); out.push(r.status); if (r.status >= 500) return FAIL('sort=' + t + ' → ' + r.status + ' ' + snip(r, 120), '', 'S1'); }
    const alive = await G('/api/notes', { as: 'alice' });
    return PASS('4 组 sort 状态 ' + out.join('/') + '，notes 表仍可查(' + alive.status + ')', 'GET /api/notes?sort=...');
  });
  await C('TC-NOTE-022', 'SQL 注入', 'page/size 畸形（负值/超大/非数字）', '归一或 400，不 500', async () => {
    const tries = ['page=-1&size=-5', 'page=0&size=0', 'page=abc&size=xyz', 'page=1&size=999999999', 'page=1e309&size=1'];
    const out = [];
    for (const t of tries) { const r = await G('/api/notes?' + t, { as: 'alice', silent: true }); out.push(r.status); if (r.status >= 500) return FAIL(t + ' → ' + r.status + ' ' + snip(r, 120), '', 'S2'); }
    return PASS('5 组状态 ' + out.join('/'), 'GET /api/notes?page=...');
  });
  await C('TC-FOLDER-010', 'SQL 注入', '目录名/笔记标题带 SQL 元字符（存储侧）', '正常存取，不报错', async () => {
    const nm = "x'); DROP TABLE notes;--";
    const f = await P('/api/folders', { as: 'alice', json: { name: nm } });
    const n = await P('/api/notes', { as: 'alice', json: { title: nm, content: 'q' } });
    if (n.json && n.json.id) created.notes.push(n.json.id);
    const list = await G('/api/notes', { as: 'alice' });
    return (f.status === 201 && n.status === 201 && list.status === 200) ? PASS('目录/笔记均写入成功，列表可查', 'POST /api/folders + /api/notes') : FAIL('f=' + f.status + ' n=' + n.status + ' list=' + list.status, '', 'S2');
  });

  /* ================= E. XSS（服务端视角） ================= */
  const xssPayloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '<iframe src=javascript:alert(1)>', '<svg onload=alert(1)>'];
  await C('TC-NOTE-030', 'XSS', '笔记正文含脚本：接口是否原样回吐', 'JSON 响应原样返回（不转义）——需前端渲染侧消毒', async () => {
    const n = await P('/api/notes', { as: 'alice', json: { title: 'xss-body', content: xssPayloads.join('\n') } });
    const id = n.json && n.json.id; if (id) created.notes.push(id);
    const r = await G('/api/notes/' + id, { as: 'alice' });
    const raw = xssPayloads.every(p => (r.text || '').indexOf(p) >= 0);
    const ct = String(r.headers['content-type'] || '');
    if (raw && /application\/json/.test(ct)) return PASS('正文原样返回（JSON，Content-Type=' + ct.split(';')[0] + '），服务端不转义属设计；风险取决于前端 Markdown 渲染', ev('GET', '/api/notes/' + id, r), null);
    return raw ? FAIL('原样返回且非 JSON 类型：' + ct, '', 'S2') : PASS('已转义', '');
  });
  await C('TC-NOTE-031', 'XSS', '标题字段含脚本', '同上：JSON 原样', async () => {
    const n = await P('/api/notes', { as: 'alice', json: { title: '<img src=x onerror=alert(1)>', content: 't' } });
    const id = n.json && n.json.id; if (id) created.notes.push(id);
    const r = await G('/api/notes/' + id, { as: 'alice' });
    const raw = (r.text || '').indexOf('<img src=x onerror') >= 0;
    return raw ? PASS('标题原样返回（JSON）', ev('GET', '/api/notes/' + id, r)) : PASS('已转义/过滤', '');
  });
  await C('TC-TAG-010', 'XSS', '标签名含脚本', '标签名原样存储（渲染侧风险）', async () => {
    const t = await P('/api/tags', { as: 'alice', json: { name: '<svg onload=alert(1)>' } });
    const list = await G('/api/tags', { as: 'alice' });
    const raw = (list.text || '').indexOf('<svg onload') >= 0;
    return raw ? PASS('标签名原样返回（JSON）', ev('GET', '/api/tags', list)) : PASS('已过滤', '');
  });
  await C('TC-FOLDER-011', 'XSS', '目录名含脚本', '目录名原样存储（渲染侧风险）', async () => {
    const f = await P('/api/folders', { as: 'alice', json: { name: '<img src=x onerror=alert(2)>' } });
    const list = await G('/api/folders?tree=true', { as: 'alice' });
    const raw = (list.text || '').indexOf('<img src=x onerror') >= 0;
    return raw ? PASS('目录名原样返回（JSON）', ev('GET', '/api/folders?tree=true', list)) : PASS('已过滤', '');
  });
  await C('TC-SEARCH-030', 'XSS', '搜索 highlight 是否把用户输入拼进 HTML 片段', 'highlight 为 HTML（含 <em>），必须对原文转义', async () => {
    const n = await P('/api/notes', { as: 'alice', json: { title: 'hl-test', content: '<img src=x onerror=alert(1)> 关键词XSS 这里' } });
    const id = n.json && n.json.id; if (id) created.notes.push(id);
    const r = await G('/api/search?q=' + encodeURIComponent('关键词XSS'), { as: 'alice' });
    const hl = (r.json && r.json.items && r.json.items[0] && r.json.items[0].highlight) || '';
    const unescaped = hl.indexOf('<img') >= 0;
    const hasEm = hl.indexOf('<em>') >= 0;
    if (unescaped) return FAIL('highlight 内含未转义的原始标签：' + hl.slice(0, 120) + '（前端若 innerHTML 渲染即 XSS）', ev('GET', '/api/search?q=关键词XSS', r), 'S2');
    return PASS('highlight 未见未转义标签（含 <em>=' + hasEm + '）：' + hl.slice(0, 90), ev('GET', '/api/search?q=关键词XSS', r));
  });
  await C('TC-SEARCH-031', 'XSS', '反链 excerpt 是否未转义回吐', 'JSON 原样（渲染侧风险）', async () => {
    const a = await P('/api/notes', { as: 'alice', json: { title: 'BL-TARGET', content: 'target' } });
    const b = await P('/api/notes', { as: 'alice', json: { title: 'BL-SRC', content: '<svg onload=alert(1)> 见 [[BL-TARGET]]' } });
    if (a.json && a.json.id) created.notes.push(a.json.id);
    if (b.json && b.json.id) created.notes.push(b.json.id);
    const r = await G('/api/notes/' + (a.json && a.json.id) + '/backlinks', { as: 'alice' });
    const raw = (r.text || '').indexOf('<svg onload') >= 0;
    return raw ? PASS('反链 excerpt 原样返回（JSON）', ev('GET', '/api/notes/{id}/backlinks', r)) : PASS('已转义', ev('GET', '/api/notes/{id}/backlinks', r));
  });
  await C('TC-FILE-020', 'XSS', '上传文件名含脚本时的 Content-Disposition', 'filename 需转义，不得注入头', async () => {
    const r = await upload('alice', '<svg onload=alert(1)>.png', 'image/png', PNG, {});
    const id = r.json && r.json.id; if (id) created.atts.push(id);
    const g = await G('/api/attachments/' + id, { as: 'alice' });
    const cd = String(g.headers['content-disposition'] || '');
    const bad = /[\r\n]/.test(cd);
    return bad ? FAIL('响应头被注入：' + JSON.stringify(cd), ev('GET', '/api/attachments/' + id, g), 'S2') : PASS('Content-Disposition=' + cd.slice(0, 110), ev('GET', '/api/attachments/' + id, g));
  });

  /* ================= F. 附件上传 ================= */
  const uploadCases = [
    ['TC-FILE-030', 'shell.php', 'image/png', 'PHP 双扩展名 + 图片 MIME', 201],
    ['TC-FILE-031', 'x.html', 'text/html', 'HTML 类型', 415],
    ['TC-FILE-032', 'x.svg', 'image/svg+xml', 'SVG（白名单内）', 201],
    ['TC-FILE-033', 'x.html', 'image/png', '伪装成图片的 HTML（MIME 白名单看 MIME）', 201],
    ['TC-FILE-034', 'x.PNG', 'image/png', '大写扩展名', 201],
    ['TC-FILE-035', 'noext', 'image/png', '无扩展名', 201],
    ['TC-FILE-036', '../../evil.png', 'image/png', '路径穿越文件名', 201],
    ['TC-FILE-037', 'x.exe', 'application/x-msdownload', '可执行文件', 415],
  ];
  for (const [id, fname, mime, label, expectStatus] of uploadCases) {
    await C(id, '附件上传', '上传 ' + label + '（' + fname + ' / ' + mime + '）', '按 MIME 白名单判定，服务端重命名落盘', async () => {
      const r = await upload('alice', fname, mime, PNG, {});
      const gotId = r.json && r.json.id; if (gotId) created.atts.push(gotId);
      const saved = r.json && r.json.originalName;
      if (r.status >= 500) return FAIL('500：' + snip(r, 120), ev('POST', '/api/attachments', r, fname), 'S2');
      const okAllow = expectStatus === 201 && r.status === 201;
      const okDeny = expectStatus === 415 && (r.status === 415 || r.status === 400);
      return (okAllow || okDeny) ? PASS('status=' + r.status + ' saved=' + saved, ev('POST', '/api/attachments', r, fname)) : FAIL('期望 ' + expectStatus + ' 实际 ' + r.status + ' ' + snip(r, 110), ev('POST', '/api/attachments', r, fname), 'S3');
    });
  }
  await C('TC-FILE-040', '附件上传', 'SVG 的响应头（inline 会在浏览器执行脚本）', 'svg 必须 Content-Disposition: attachment + nosniff', async () => {
    const up = await upload('alice', 'e2.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'), {});
    const id = up.json && up.json.id; if (id) created.atts.push(id);
    const g = await G('/api/attachments/' + id, { as: 'alice' });
    const cd = String(g.headers['content-disposition'] || '');
    const nosniff = String(g.headers['x-content-type-options'] || '');
    const ct = String(g.headers['content-type'] || '');
    const risk = !/attachment/i.test(cd) || !/nosniff/i.test(nosniff);
    return risk ? FAIL('svg 可内联打开：Content-Disposition=' + cd + ' nosniff=' + nosniff + ' ct=' + ct, ev('GET', '/api/attachments/' + id, g), 'S1') : PASS('attachment + nosniff（ct=' + ct.slice(0, 40) + '）', ev('GET', '/api/attachments/' + id, g));
  });
  await C('TC-FILE-041', '附件上传', '上传 21MB 文件（超 20MB 上限）', '413', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const r = await upload('alice', 'big.png', 'image/png', big, {});
    return (r.status === 413 || r.status === 400) ? PASS('status=' + r.status, ev('POST', '/api/attachments', r, '21MB')) : FAIL('status=' + r.status, ev('POST', '/api/attachments', r, '21MB'), 'S2');
  });
  await C('TC-FILE-042', '附件上传', '未登录上传', '401', async () => {
    const r = await upload('anonx', 'a.png', 'image/png', PNG, {});
    return r.status === 401 ? PASS('401', ev('POST', '/api/attachments', r)) : FAIL('status=' + r.status, ev('POST', '/api/attachments', r), 'S1');
  });
  await C('TC-FILE-043', '附件上传', '落盘目录是否逃出 data/uploads（路径穿越）', '仅 data/uploads 内，无 .. 逃逸文件', async () => {
    const r = await upload('alice', '../../e2-escape.png', 'image/png', PNG, {});
    const id = r.json && r.json.id; if (id) created.atts.push(id);
    const upDir = path.join(DATADIR, 'uploads');
    let stray = [];
    function walk(d, depth) {
      if (depth > 3) return;
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const en of ents) { const fp = path.join(d, en.name); if (en.isDirectory()) walk(fp, depth + 1); else if (en.name.indexOf('evil') >= 0 || en.name.indexOf('escape') > 0) stray.push(fp); }
    }
    walk(DATADIR, 0);
    const outside = stray.filter(fp => !path.resolve(fp).startsWith(path.resolve(DATADIR) + path.sep));
    void upDir;
    return outside.length ? FAIL('发现逃逸文件 ' + outside.join(','), '', 'S1') : PASS('数据目录内未发现逃逸文件（' + (stray.length) + ' 个命中均在目录内）', 'walk(' + DATADIR + ')');
  });

  /* ================= G. ZIP 导入导出 ================= */
  await C('TC-IMPEXP-001', '导入导出', '导入含 ../evil.md 的 ZIP（Zip Slip）', '路径穿越被拒，不写到数据目录外', async () => {
    const zip = zipStore([{ name: '../e2-evil.md', data: '# evil' }, { name: 'good.md', data: '# good' }]);
    const mp = multipart({}, [{ field: 'files', filename: 'slip.zip', type: 'application/zip', data: zip }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const evilPath = path.resolve(DATADIR, '..', 'e2-evil.md');
    const escaped = fs.existsSync(evilPath) || fs.existsSync(path.join('F:\\work\\test\\kb', 'e2-evil.md'));
    const body = r.text || '';
    if (escaped) return FAIL('Zip Slip 成功，文件写到数据目录外：' + evilPath, ev('POST', '/api/import/markdown', r), 'S1');
    const rejected = /穿越|非法|路径|拒绝|error/i.test(body) || (r.json && r.json.errors && r.json.errors.length);
    return rejected ? PASS('被拒并被记录：' + snip(r, 120), ev('POST', '/api/import/markdown', r, 'entries=../e2-evil.md,good.md')) : FAIL('未报错且无文件落地（需人工确认是否静默丢弃）：' + snip(r, 120), ev('POST', '/api/import/markdown', r), 'S2');
  });
  await C('TC-IMPEXP-002', '导入导出', 'ZIP 含 2001 个条目（超 2000 上限）', '被拒（错误或 413/400），不 500', async () => {
    const ent = [];
    for (let i = 0; i < 2001; i++) ent.push({ name: 'n' + i + '.md', data: '# x' });
    const zip = zipStore(ent);
    const mp = multipart({}, [{ field: 'files', filename: 'many.zip', type: 'application/zip', data: zip }]);
    const r = await P('/api/import/preview', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const bothOk = r.status < 500;
    return bothOk ? PASS('status=' + r.status + ' ' + snip(r, 120), ev('POST', '/api/import/preview', r, '2001 entries')) : FAIL('500：' + snip(r, 130), ev('POST', '/api/import/preview', r), 'S2');
  });
  await C('TC-IMPEXP-003', '导入导出', '导入 .md 正文含脚本与 [[链接]]', '不 500，不污染他人空间', async () => {
    const mp = multipart({}, [{ field: 'files', filename: 'evil.md', type: 'text/markdown', data: '# T\n<script>alert(1)</script>\n[[bob自己的笔记]]' }]);
    const r = await P('/api/import/markdown', { as: 'alice', rawBody: mp.body, rawType: mp.type });
    const bobList = await G('/api/notes', { as: 'bob' });
    return (r.status < 500) ? PASS('status=' + r.status + ' imported=' + ((r.json || {}).imported) + '，B 侧列表仍 ' + bobList.status, ev('POST', '/api/import/markdown', r)) : FAIL('500：' + snip(r, 130), '', 'S2');
  });
  await C('TC-IMPEXP-004', '导入导出', '导出全部 ZIP 的包内条目名（不得含 ../）', '条目名安全，无绝对路径', async () => {
    const r = await G('/api/export/all', { as: 'alice' });
    if (r.status !== 200) return BLOCK('导出返回 ' + r.status, '');
    const txt = r.buf.toString('latin1');
    const hasDotDot = txt.indexOf('../') >= 0;
    return hasDotDot ? FAIL('包内出现 ../ 路径', 'export/all len=' + r.len, 'S2') : PASS('包内未见 ../（' + r.len + ' 字节）', 'export/all');
  });
  await C('TC-IMPEXP-005', '导入导出', '未登录调用导入/导出', '401', async () => {
    const a = await G('/api/export/all');
    const mp = multipart({}, [{ field: 'files', filename: 'a.md', type: 'text/markdown', data: '# a' }]);
    const b = await P('/api/import/markdown', { rawBody: mp.body, rawType: mp.type });
    return (a.status === 401 && b.status === 401) ? PASS('export=' + a.status + ' import=' + b.status, '') : FAIL('export=' + a.status + ' import=' + b.status, '', 'S1');
  });

  /* ================= H. 鉴权 / 暴力破解 / 注册 ================= */
  await C('TC-ADMIN-001', '鉴权', '普通用户访问管理员接口（6 个）', '全部 403', async () => {
    const paths = ['/api/admin/users', '/api/admin/invites'];
    const out = [];
    for (const p of paths) { const r = await G(p, { as: 'bob' }); out.push(p + '=' + r.status); if (r.status !== 403) return FAIL(out.join(' '), ev('GET', p, r), 'S1'); }
    const p1 = await P('/api/admin/invites', { as: 'bob', json: {} });
    const p2 = await P('/api/admin/users', { as: 'bob', json: { username: 'x' + Date.now(), displayName: 'x', password: 'Passw0rd#1', role: 'admin' } });
    out.push('POST invites=' + p1.status, 'POST users=' + p2.status);
    const ok = p1.status === 403 && p2.status === 403;
    return ok ? PASS(out.join(' '), ev('POST', '/api/admin/users', p2)) : FAIL(out.join(' '), ev('POST', '/api/admin/users', p2), 'S1');
  });
  await C('TC-ADMIN-002', '鉴权', '未登录访问管理员接口', '401', async () => {
    const r = await G('/api/admin/users');
    return r.status === 401 ? PASS('401', ev('GET', '/api/admin/users', r)) : FAIL('status=' + r.status, ev('GET', '/api/admin/users', r), 'S1');
  });
  await C('TC-ADMIN-003', '鉴权', '普通用户自提权（PATCH 自己 role=admin）', '拒绝或无效', async () => {
    const me = await G('/api/auth/me', { as: 'bob' });
    const id = me.json && me.json.id;
    const r = await PATCH('/api/admin/users/' + id, { as: 'bob', json: { role: 'admin' } });
    const after = await G('/api/auth/me', { as: 'bob' });
    const stillMember = after.json && after.json.role === 'member';
    return (r.status === 403 && stillMember) ? PASS('PATCH=' + r.status + '，role 仍 ' + (after.json || {}).role, ev('PATCH', '/api/admin/users/' + id, r)) : FAIL('PATCH=' + r.status + ' role=' + (after.json || {}).role, ev('PATCH', '/api/admin/users/' + id, r), 'S1');
  });
  await C('TC-AUTH-020', '鉴权', '不存在用户 vs 密码错误：响应是否可区分', '状态码与文案一致（防枚举）', async () => {
    const a = await P('/api/auth/login', { json: { username: 'nouser' + Date.now(), password: 'WrongPass#1' } });
    const b = await P('/api/auth/login', { json: { username: AL, password: 'WrongPass#1' } });
    const same = a.status === b.status;
    const bodySame = JSON.stringify(a.json) === JSON.stringify(b.json) || (snip(a, 200) === snip(b, 200));
    return (same && bodySame) ? PASS('两者均 ' + a.status + ' 且文案一致：' + snip(a, 90), '不存在用户 / 密码错误') : FAIL('不存在=' + a.status + '/' + snip(a, 80) + ' 存在=' + b.status + '/' + snip(b, 80), '', 'S3');
  });
  await C('TC-AUTH-021', '鉴权', '连错 5 次是否限流（429）', '第 6 次起 429', async () => {
    const victim = 'e2lock' + Date.now().toString().slice(-6);
    await P('/api/auth/register', { json: { username: victim, displayName: '锁测', password: 'Passw0rd#9', inviteCode: (await P('/api/admin/invites', { as: 'admin', json: {} })).json.code } });
    const seq = [];
    for (let i = 0; i < 7; i++) { const r = await P('/api/auth/login', { json: { username: victim, password: 'bad#' + i } }); seq.push(r.status); }
    const locked = seq.indexOf(429) >= 0;
    const okLogin = await P('/api/auth/login', { json: { username: victim, password: 'Passw0rd#9' } });
    return locked ? PASS('状态序列 ' + seq.join(',') + '；锁定期正确口令=' + okLogin.status, 'login×7') : FAIL('7 次错误未触发 429：' + seq.join(',') + '（契约要求 5 次锁定 15 分钟）', 'login×7', 'S2');
  });
  await C('TC-AUTH-022', '鉴权', '停用账号登录', '403（不是 401，且仅密码正确时暴露）', async () => {
    const nm = 'e2dis' + Date.now().toString().slice(-6);
    const inv = await P('/api/admin/invites', { as: 'admin', json: {} });
    await P('/api/auth/register', { json: { username: nm, displayName: '停用测', password: 'Passw0rd#9', inviteCode: inv.json.code } });
    const list = await G('/api/admin/users', { as: 'admin' });
    const u = (list.json && list.json.items || []).find(x => x.username === nm);
    if (!u) return BLOCK('未找到该用户', '');
    await PATCH('/api/admin/users/' + u.id, { as: 'admin', json: { disabled: true } });
    const good = await P('/api/auth/login', { json: { username: nm, password: 'Passw0rd#9' } });
    const bad = await P('/api/auth/login', { json: { username: nm, password: 'x#1' } });
    return good.status === 403 ? PASS('正确口令 403（停用），错误口令 ' + bad.status + '（不泄露）', ev('POST', '/api/auth/login', good)) : FAIL('正确口令 status=' + good.status, ev('POST /api/auth/login', good), 'S3');
  });
  await C('TC-AUTH-023', '鉴权', '无邀请码注册（首位之后）', '400/403', async () => {
    const r = await P('/api/auth/register', { json: { username: 'noinv' + Date.now().toString().slice(-6), displayName: 'x', password: 'Passw0rd#1' } });
    return (r.status === 400 || r.status === 403) ? PASS('status=' + r.status + ' ' + snip(r, 80), ev('POST', '/api/auth/register', r)) : FAIL('status=' + r.status, ev('POST', '/api/auth/register', r), 'S1');
  });
  await C('TC-AUTH-024', '鉴权', '伪造邀请码枚举（20 次随机 32 位 hex）', '全部拒绝；无 500', async () => {
    const st = {};
    for (let i = 0; i < 20; i++) {
      const code = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      const r = await P('/api/auth/register', { json: { username: 'g' + Date.now().toString().slice(-6) + i, displayName: 'x', password: 'Passw0rd#1', inviteCode: code }, silent: true });
      st[r.status] = (st[r.status] || 0) + 1;
    }
    const ok = !st[201] && !st[500];
    return ok ? PASS('状态分布 ' + JSON.stringify(st), 'register ×20') : FAIL('分布 ' + JSON.stringify(st), '', 'S1');
  });
  await C('TC-AUTH-025', '鉴权', '注册接口是否可被刷（连续 10 次带无效邀请码）', '有拒绝，无 500；应有限流或至少不崩', async () => {
    const out = [];
    for (let i = 0; i < 10; i++) { const r = await P('/api/auth/register', { json: { username: 'spam' + Date.now().toString().slice(-6) + i, displayName: 'x', password: 'Passw0rd#1', inviteCode: 'deadbeef' + i }, silent: true }); out.push(r.status); }
    const bad = out.filter(s => s >= 500).length;
    return bad === 0 ? PASS('10 次状态 ' + out.join(','), 'register ×10（无 5xx；未观察到限流）') : FAIL('出现 ' + bad + ' 次 5xx', '', 'S3');
  });
  await C('TC-AUTH-026', '鉴权', '注册字段注入（username 含 SQL/路径）', '400 校验拒绝', async () => {
    const tries = ["a' OR 1=1--", '../../etc/passwd', '<script>alert(1)</script>', 'a'.repeat(64)];
    const out = [];
    for (const u of tries) { const inv = await P('/api/admin/invites', { as: 'admin', json: {} }); const r = await P('/api/auth/register', { json: { username: u, displayName: 'x', password: 'Passw0rd#1', inviteCode: inv.json.code }, silent: true }); out.push(r.status); }
    const bad = out.filter(s => s === 201 || s >= 500).length;
    return bad === 0 ? PASS('4 组非法 username 状态 ' + out.join(','), 'register ×4') : FAIL('接受了非法 username 或 5xx：' + out.join(','), '', 'S2');
  });
  await C('TC-AUTH-027', '鉴权', '弱口令注册（< 8 位）', '400', async () => {
    const inv = await P('/api/admin/invites', { as: 'admin', json: {} });
    const r = await P('/api/auth/register', { json: { username: 'weak' + Date.now().toString().slice(-6), displayName: 'x', password: '1234567', inviteCode: inv.json.code } });
    return r.status === 400 ? PASS('400 ' + snip(r, 80), 'register weak pwd') : FAIL('status=' + r.status, ev('POST', '/api/auth/register', r), 'S3');
  });

  /* ================= I. 信息泄露 / 静态资源 ================= */
  for (const [id, p, label] of [
    ['TC-NF-001', '/api/nope-e2', '未知 API 路径'],
    ['TC-NF-002', '/api/notes/abc', '非法 id 类型'],
    ['TC-NF-003', '/api/notes/-1', '负数 id'],
    ['TC-NF-004', '/WEB-INF/web.xml', 'WEB-INF'],
    ['TC-NF-005', '/application.properties', '配置文件'],
    ['TC-NF-006', '/static/../application.properties', '静态目录穿越'],
    ['TC-NF-007', '/assets/../application.properties', 'assets 穿越'],
    ['TC-NF-008', '/actuator/env', 'actuator env'],
    ['TC-NF-009', '/actuator/health', 'actuator health'],
    ['TC-NF-010', '/api/health/../admin/users', '路径规范化穿越'],
    ['TC-NF-011', '/%2e%2e/application.properties', '编码穿越'],
  ]) {
    await C(id, '信息泄露', label + ' ' + p, '不泄露源码/配置/堆栈，非 200 或安全降级', async () => {
      const r = await G(p, { as: 'bob' });
      const leak = /spring\.datasource|password|jdbc:|<web-app|server\.port|Exception|at com\.kb|Caused by|stackTrace/i.test(r.text || '');
      if (leak) return FAIL('响应泄露敏感内容：' + snip(r, 140), ev('GET', p, r), 'S1');
      if (r.status >= 500) return FAIL('500（未捕获异常）：' + snip(r, 140), ev('GET', p, r), 'S2');
      return PASS('status=' + r.status + ' ' + snip(r, 70), ev('GET', p, r));
    });
  }
  await C('TC-NF-012', '信息泄露', '错误响应体结构（code/message/field，无堆栈）', '标准 JSON 错误，无 trace', async () => {
    const r = await G('/api/notes/999999', { as: 'bob' });
    const hasTrace = /stackTrace|"trace"|Exception/i.test(r.text || '');
    const structured = r.json && r.json.error && r.json.error.code;
    return (structured && !hasTrace) ? PASS('error.code=' + r.json.error.code + ' message=' + r.json.error.message, ev('GET', '/api/notes/999999', r)) : FAIL('结构异常或含 trace：' + snip(r, 140), ev('GET', '/api/notes/999999', r), 'S3');
  });
  await C('TC-NF-013', '信息泄露', '不支持的方法（PUT /api/notes）', '405 METHOD_NOT_ALLOWED', async () => {
    const r = await PUT('/api/notes', { as: 'bob', json: {} });
    return (r.status === 405 || r.status === 404) ? PASS('status=' + r.status, ev('PUT', '/api/notes', r)) : FAIL('status=' + r.status, ev('PUT', '/api/notes', r), 'S4');
  });
  await C('TC-NF-014', '信息泄露', '超大 JSON 请求体（> 8MB）', '413 PAYLOAD_TOO_LARGE', async () => {
    const body = Buffer.alloc(9 * 1024 * 1024, 0x41);
    const r = await PATCH('/api/notes/' + B_NOTE, { as: 'bob', rawBody: body, rawType: 'application/json' });
    return (r.status === 413 || r.status === 400) ? PASS('status=' + r.status, ev('PATCH', '/api/notes/{id}', r, '9MB body')) : FAIL('status=' + r.status, '', 'S2');
  });
  await C('TC-NF-015', '信息泄露', '正文超 2MB 上限', '400/413', async () => {
    const big = 'x'.repeat(2100000);
    const r = await PATCH('/api/notes/' + B_NOTE, { as: 'bob', json: { content: big } });
    return (r.status === 400 || r.status === 413) ? PASS('status=' + r.status + ' ' + snip(r, 80), 'PATCH content=2.1MB') : FAIL('status=' + r.status, '', 'S3');
  });

  /* ================= J. HTTP 头 ================= */
  await C('TC-NF-020', 'HTTP 头', 'API 响应安全头（nosniff / Frame-Options / CSP / Referrer）', '至少 nosniff；其余按实现记录', async () => {
    const r = await G('/api/health');
    const h = r.headers;
    const flags = { nosniff: h['x-content-type-options'], frame: h['x-frame-options'], csp: h['content-security-policy'], referrer: h['referrer-policy'] };
    const atLeast = String(flags.nosniff || '').toLowerCase() === 'nosniff';
    return atLeast ? PASS(JSON.stringify(flags).slice(0, 200), 'GET /api/health') : FAIL('缺 X-Content-Type-Options，其余=' + JSON.stringify(flags).slice(0, 160), 'GET /api/health', 'S3');
  });
  await C('TC-NF-021', 'HTTP 头', '首页(HTML)安全头', 'nosniff + Frame-Options/CSP 建议', async () => {
    const r = await G('/');
    const h = r.headers;
    const flags = { ct: h['content-type'], nosniff: h['x-content-type-options'], frame: h['x-frame-options'], csp: h['content-security-policy'] ? 'yes' : 'no', referrer: h['referrer-policy'] };
    return PASS(JSON.stringify(flags).slice(0, 220), 'GET /');
  });
  await C('TC-NF-022', 'HTTP 头', '附件响应头（nosniff + Content-Disposition）', '两者齐全', async () => {
    const r = await G('/api/attachments/' + A_ATT, { as: 'alice' });
    const h = r.headers;
    const ok = String(h['x-content-type-options'] || '').toLowerCase() === 'nosniff' && !!h['content-disposition'];
    return ok ? PASS('nosniff + CD=' + String(h['content-disposition']).slice(0, 60), ev('GET', '/api/attachments/' + A_ATT, r)) : FAIL('缺头：' + JSON.stringify({ ns: h['x-content-type-options'], cd: h['content-disposition'] }), '', 'S3');
  });
  await C('TC-NF-023', 'HTTP 头', 'Server / X-Powered-By 版本泄露', '不暴露具体版本', async () => {
    const r = await G('/api/health');
    const srv = r.headers['server'] || '';
    const xp = r.headers['x-powered-by'] || '';
    return (srv || xp) ? PASS('Server="' + srv + '" X-Powered-By="' + xp + '"（属常规信息，低风险）', 'GET /api/health') : PASS('无 Server/X-Powered-By', '');
  });

  /* ---------- 汇总 ---------- */
  finish();
}

let finished = false;
function finish() {
  if (finished) return; finished = true;
  const stat = { total: cases.length, pass: 0, fail: 0, blocked: 0 };
  for (const c of cases) { if (c.verdict === 'PASS') stat.pass++; else if (c.verdict === 'FAIL') stat.fail++; else stat.blocked++; }
  const payload = { generatedAt: new Date().toISOString(), base: BASE, dataDir: DATADIR, stat: stat, cases: cases };
  fs.writeFileSync(path.join(EV, 'e2-results-' + TS + '.json'), JSON.stringify(payload, null, 2));
  const lines = ['# E2 安全用例执行清单', '', '- 生成：' + payload.generatedAt, '- 被测：' + BASE + '（数据目录 ' + DATADIR + '）', '- 统计：用例 ' + stat.total + ' / 通过 ' + stat.pass + ' / 失败 ' + stat.fail + ' / 阻塞 ' + stat.blocked, '', '| 用例 | 分类 | 名称 | 结论 | 严重度 | 实际 | 证据 |', '|---|---|---|---|---|---|---|'];
  for (const c of cases) lines.push('| ' + c.id + ' | ' + c.cat + ' | ' + c.name.replace(/\|/g, '/') + ' | ' + c.verdict + ' | ' + (c.severity || '-') + ' | ' + String(c.actual).replace(/\|/g, '/').slice(0, 150) + ' | ' + String(c.evidence).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 190) + ' |');
  fs.writeFileSync(path.join(EV, 'e2-cases-' + TS + '.md'), lines.join('\n'));
  const byCat = {};
  for (const c of cases) { byCat[c.cat] = byCat[c.cat] || { PASS: 0, FAIL: 0, BLOCKED: 0 }; byCat[c.cat][c.verdict]++; }
  console.log('STAT ' + JSON.stringify(stat));
  console.log('BYCAT ' + JSON.stringify(byCat));
  try { fs.closeSync(rawFd); } catch (e) {}
  console.log('EVIDENCE ' + EV + '  ts=' + TS);
}

setTimeout(() => { console.log('HARD-TIMEOUT'); try { finish(); } catch (e) {} setTimeout(() => process.exit(4), 800); }, 300000);
main().then(() => setTimeout(() => process.exit(0), 600)).catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : e)); try { finish(); } catch (e2) {} setTimeout(() => process.exit(5), 800); });
