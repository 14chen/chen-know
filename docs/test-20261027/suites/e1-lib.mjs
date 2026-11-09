/**
 * E1 API 测试公共库（知识库系统）
 * 端口 8502 / 数据目录 F:\work\test\kb\d-e1
 * 只用 Node 内置能力：fetch / FormData / Blob / zlib
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const BASE = process.env.KB_BASE || 'http://127.0.0.1:8502';
export const EVID = process.env.KB_EVID || 'D:\\work\\知识库\\docs\\test-20261027\\evidence\\e1';
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
export const RUNID = STAMP;
fs.mkdirSync(EVID, { recursive: true });
export const CASES_FILE = path.join(EVID, 'e1-cases-' + STAMP + '.jsonl');
export const LOG_FILE = path.join(EVID, 'e1-run-' + STAMP + '.log');
fs.writeFileSync(LOG_FILE, '');
export function log(s) {
  const line = typeof s === 'string' ? s : JSON.stringify(s);
  fs.appendFileSync(LOG_FILE, line + '\n');
  process.stdout.write(line + '\n');
}
export function trunc(s, n) {
  const t = String(s === undefined || s === null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ---------------- Cookie 客户端 ---------------- */
export class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); this.lastRawSetCookie = []; }
  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => k + '=' + v).join('; ');
  }
  async req(method, p, opt) {
    const o = opt || {};
    const headers = Object.assign({}, o.headers || {});
    const ck = this.cookieHeader();
    if (ck) headers['Cookie'] = ck;
    let body;
    if (o.form) body = o.form;
    else if (o.body !== undefined && o.body !== null) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
    else if (o.rawBody !== undefined) { body = o.rawBody; if (o.contentType) headers['Content-Type'] = o.contentType; }
    const url = BASE + (p.startsWith('/api') ? p : '/api' + p);
    let res;
    try {
      res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(o.timeout || 60000) });
    } catch (e) {
      return { status: 0, error: String(e && e.message), headers: new Headers(), json: null, text: '', buf: null, ct: '' };
    }
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    this.lastRawSetCookie = setCookies;
    for (const sc of setCookies) {
      const m = /^([^=]+)=([^;]*)/.exec(sc);
      if (m) {
        const val = m[2];
        if (val === '' || /Max-Age=0/i.test(sc)) this.cookies.delete(m[1]); else this.cookies.set(m[1], val);
      }
    }
    const ct = res.headers.get('content-type') || '';
    const out = { status: res.status, headers: res.headers, ct, json: null, text: '', buf: null, url };
    if (/json/.test(ct)) { try { out.json = await res.json(); } catch (e) { out.json = null; } }
    else if (/^text\/|application\/markdown|text\/markdown/.test(ct)) { out.text = await res.text(); }
    else if (/octet-stream|zip|pdf|image|attachment/.test(ct)) { out.buf = Buffer.from(await res.arrayBuffer()); }
    else { out.text = await res.text(); }
    if (out.buf === null && out.json === null && out.text === '') { try { out.text = await res.text(); } catch (e) {} }
    return out;
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, body, o) { return this.req('POST', p, Object.assign({ body }, o || {})); }
  patch(p, body, o) { return this.req('PATCH', p, Object.assign({ body }, o || {})); }
  del(p, o) { return this.req('DELETE', p, o); }
  put(p, body, o) { return this.req('PUT', p, Object.assign({ body }, o || {})); }
  async login(username, password) {
    const r = await this.post('/auth/login', { username, password });
    return r;
  }
}

/* ---------------- 断言助手 ---------------- */
export function bodyOf(r) {
  if (!r) return '';
  if (r.json !== null && r.json !== undefined) return JSON.stringify(r.json);
  if (r.buf) return 'BINARY ' + r.buf.length + 'B';
  return String(r.text || '');
}
export function K(cond, expected, actual) { return { ok: !!cond, expected: String(expected), actual: trunc(typeof actual === 'string' ? actual : JSON.stringify(actual), 220) }; }
export function S(r, code) { return K(r && r.status === code, 'HTTP ' + code, 'HTTP ' + (r ? r.status : 'ERR') + ' ' + bodyOf(r).slice(0, 200)); }
export function C(r, code, snippet) {
  const b = bodyOf(r);
  return K(r && r.status === code && (snippet === undefined || b.includes(snippet)), 'HTTP ' + code + (snippet ? ' 含「' + snippet + '」' : ''), 'HTTP ' + (r ? r.status : 'ERR') + ' ' + b.slice(0, 200));
}
export function get(o, p) {
  let cur = o;
  for (const k of String(p).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}
export function F(r, p, val) {
  const got = get(r && r.json, p);
  const ok = JSON.stringify(got) === JSON.stringify(val);
  return K(ok, p + '=' + JSON.stringify(val), p + '=' + JSON.stringify(got));
}
export function Fx(r, p, pred, label) {
  const got = get(r && r.json, p);
  return K(pred(got), (label || p), p + '=' + JSON.stringify(got));
}
export function isArr(v) { return Array.isArray(v); }
export function hasErr(r, code, field) {
  const ec = get(r && r.json, 'error.code');
  const fd = get(r && r.json, 'error.field');
  const okField = field === undefined || fd === field;
  return K(r && r.status > 0 && ec === code && okField, 'error.code=' + code + (field === undefined ? '' : ' field=' + field), 'HTTP ' + (r && r.status) + ' error=' + JSON.stringify(r && r.json && r.json.error));
}

/* ---------------- 用例运行器 ---------------- */
export class Runner {
  constructor() { this.cases = []; this.ctx = {}; this.t0 = Date.now(); }
  async tc(id, title, fn) {
    const rec = { id, module: id.split('-')[1], title, status: 'fail', expected: '', actual: '', ms: 0 };
    const t0 = Date.now();
    try {
      const out = await fn();
      const list = Array.isArray(out) ? out : out ? [out] : [];
      const bad = list.filter((x) => x && x.ok === false);
      if (list.length === 0) { rec.status = 'blocked'; rec.actual = '用例未返回断言'; }
      else if (bad.length === 0) { rec.status = 'pass'; rec.expected = '全部断言通过（' + list.length + '）'; rec.actual = 'ok'; }
      else {
        rec.status = 'fail';
        rec.expected = bad.map((x) => x.expected).join('；').slice(0, 300);
        rec.actual = bad.map((x) => x.actual).join('；').slice(0, 400);
      }
    } catch (e) {
      rec.status = 'fail';
      rec.actual = '异常：' + ((e && e.message) || e);
    }
    rec.ms = Date.now() - t0;
    this.cases.push(rec);
    fs.appendFileSync(CASES_FILE, JSON.stringify(rec) + '\n');
    const mark = rec.status === 'pass' ? '✓' : rec.status === 'blocked' ? '⊘' : '✗';
    log('  ' + mark + ' ' + id + ' ' + title + (rec.status === 'pass' ? '' : '  => ' + rec.actual.slice(0, 180)));
    return rec;
  }
  summary() {
    const by = {};
    for (const c of this.cases) {
      by[c.module] = by[c.module] || { pass: 0, fail: 0, blocked: 0, total: 0 };
      by[c.module][c.status]++;
      by[c.module].total++;
    }
    const tot = { pass: 0, fail: 0, blocked: 0, total: this.cases.length };
    for (const m of Object.values(by)) { tot.pass += m.pass; tot.fail += m.fail; tot.blocked += m.blocked; }
    return { by, tot, ms: Date.now() - this.t0 };
  }
}

/* ---------------- multipart 助手 ---------------- */
export function formFile(name, bytes, filename, type) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: type || 'application/octet-stream' }), filename);
  return fd;
}
export function formWith(fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  for (const f of files || []) fd.append(f.field || 'file', new Blob([f.bytes], { type: f.type || 'application/octet-stream' }), f.filename);
  return fd;
}

/* ---------------- 最小 ZIP 读取（导出包解析） ---------------- */
export function unzip(buf) {
  const entries = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 ZIP（找不到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8');
    const lnt = buf.readUInt16LE(lho + 26);
    const let2 = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnt + let2;
    const raw = buf.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('不支持的压缩方式 ' + method + '（' + name + '）');
    entries.push({ name, method, size: usize, data });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}
export function zipText(entries, name) {
  const e = entries.find((x) => x.name === name);
  return e ? e.data.toString('utf8') : null;
}
