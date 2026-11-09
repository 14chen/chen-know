/**
 * e3-lib.mjs — E3 性能测试公共库（Node 原生 fetch + 自建 cookie jar，无新依赖）
 */
import fs from 'node:fs';
import path from 'node:path';

export const PORT = Number(process.env.E3_PORT || 8504);
export const BASE = 'http://127.0.0.1:' + PORT;
export const EV = 'D:\\work\\知识库\\docs\\test-20261027\\evidence\\e3';
export const RAW = path.join(EV, 'raw');
export function ensureDirs() { fs.mkdirSync(RAW, { recursive: true }); }
export function jdump(name, obj) {
  ensureDirs();
  const f = path.join(RAW, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  return f;
}
export const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function pct(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
export function stats(arr, digits = 1) {
  const a = arr.filter(x => typeof x === 'number' && Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const r = (v) => Number(v.toFixed(digits));
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return { n: a.length, min: r(a[0]), p50: r(pct(a, 50)), p90: r(pct(a, 90)), p95: r(pct(a, 95)), p99: r(pct(a, 99)), max: r(a[a.length - 1]), mean: r(mean) };
}

/** 会话：注册首个账号（空库免邀请码成管理员）并登录，持有 KB_SESSION */
export class Session {
  constructor(user = 'e3admin') { this.user = user; this.cookie = null; this.id = null; }
  async ensure() {
    const reg = await call('/api/auth/register', { method: 'POST', body: { username: this.user, displayName: 'E3 测试管理员', password: 'e3pass123' } });
    if (!(reg.status === 201 || reg.status === 409)) log('register status', reg.status);
    const r = await this.login();
    return r;
  }
  async login() {
    const r = await call('/api/auth/login', { method: 'POST', body: { username: this.user, password: 'e3pass123' } });
    if (r.json && r.json.id) this.id = r.json.id;
    const c = r.setCookie || '';
    const m = c.match(/KB_SESSION=([^;]+)/);
    if (m) this.cookie = 'KB_SESSION=' + m[1];
    return r;
  }
}

/** 单次请求（含耗时/字节/JSON/原始字节） */
export async function call(p, opts = {}) {
  const { method = 'GET', body, form, cookie, timeout = 120000, binary = false, raw = false } = opts;
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(BASE + p, { method, headers, body: payload, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    return { path: p, method, ms: performance.now() - t0, status: 0, ok: false, error: String((e && e.message) || e), bytes: 0, json: null };
  }
  let buf, json = null;
  if (binary) { buf = Buffer.from(await res.arrayBuffer()); }
  else {
    buf = Buffer.from(await res.arrayBuffer());
    if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; } }
  }
  const ms = performance.now() - t0;
  const ct = res.headers.get('content-type') || '';
  const errText = json && json.error ? (json.error.code + ':' + (json.error.message || '')) : (res.ok ? null : buf.toString('utf8').slice(0, 160));
  return {
    path: p, method, ms, status: res.status, ok: res.status >= 200 && res.status < 300,
    bytes: buf.length, json, buf, ct, error: errText,
    setCookie: res.headers.get('set-cookie') || null,
    disposition: res.headers.get('content-disposition') || null
  };
}

/** 固定并发池：跑 n 个任务 */
export async function pool(n, conc, fn) {
  const out = new Array(n);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(conc, n) }, async () => {
    while (true) { const i = next++; if (i >= n) return; out[i] = await fn(i); }
  }));
  return out;
}

export function summarize(results, wallMs) {
  const ms = results.map(r => r.ms);
  const errs = results.filter(r => !r.ok);
  const s = stats(ms);
  return {
    total: results.length, errors: errs.length,
    errorRate: results.length ? Number((errs.length / results.length * 100).toFixed(2)) : 0,
    throughput: wallMs > 0 ? Number((results.length / (wallMs / 1000)).toFixed(1)) : null,
    ...s,
    statusSeen: [...new Set(results.map(r => r.status))].sort((a, b) => a - b),
    errorSamples: errs.slice(0, 6).map(e => ({ path: e.path, status: e.status, error: e.error }))
  };
}

/** 造中文正文 */
export function md(i, chars = 400) {
  const seed = '安全生产知识库测试样本 ' + i + ' 号：今天天气很好，适合现场巡检。Spring Boot 笔记记录自动配置原理与索引表结构。';
  let s = '# 笔记 ' + i + '\n\n' + seed + '\n\n';
  while (s.length < chars) s += '- 要点 ' + s.length + '：机器学习模型训练数据需要清洗与标注，检索增强生成依赖向量索引。\n';
  return s.slice(0, chars);
}
