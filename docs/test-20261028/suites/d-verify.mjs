#!/usr/bin/env node
/** D 流验证：CSP/Referrer-Policy、Cookie Secure、Origin 守卫（含既有脚本兼容性） */
import http from 'node:http';
import fs from 'node:fs';

const HOST = '127.0.0.1', PORT = 8534;
const OUT = 'D:\\work\\知识库\\docs\\test-20261028\\evidence\\d';
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
function R(name, pass, detail) { rows.push({ name: name, pass: !!pass, detail: detail || '' }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + ' :: ' + String(detail).slice(0, 180)); }
const jars = {};
function jar(n) { return (jars[n] = jars[n] || {}); }
function ck(n) { return Object.entries(jar(n)).map(([k, v]) => k + '=' + v).join('; '); }
function store(n, sc) { if (!sc) return; for (const c of (Array.isArray(sc) ? sc : [sc])) { const kv = String(c).split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar(n)[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } }
function request(method, p, opt) {
  opt = opt || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opt.headers || {});
    let body = null;
    if (opt.json !== undefined) { body = Buffer.from(JSON.stringify(opt.json)); headers['Content-Type'] = 'application/json'; }
    if (body) headers['Content-Length'] = body.length;
    if (opt.as && Object.keys(jar(opt.as)).length) headers['Cookie'] = ck(opt.as);
    Object.assign(headers, opt.headers || {});
    const req = http.request({ host: HOST, port: PORT, method: method, path: p, headers: headers, timeout: 30000 }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(ch), text = buf.toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        if (opt.as) store(opt.as, res.headers['set-cookie']);
        resolve({ status: res.statusCode, headers: res.headers, text: text, json: json, buf: buf, len: buf.length });
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

async function main() {
  const ts = Date.now().toString().slice(-6);
  const AD = 'dadmin' + ts, AL = 'dalice' + ts, PW = 'Passw0rd#' + ts;

  /* ---------- 1. 安全响应头（DEF-E2-002 修前：无 CSP / 无 Referrer-Policy） ---------- */
  const root = await G('/');
  const health = await G('/api/health');
  const cspRoot = String(root.headers['content-security-policy'] || '');
  const refRoot = String(root.headers['referrer-policy'] || '');
  const cspHealth = String(health.headers['content-security-policy'] || '');
  R('HTML 首屏有 Content-Security-Policy', cspRoot.length > 0, cspRoot.slice(0, 260));
  R('HTML 首屏有 Referrer-Policy', refRoot.length > 0, refRoot);
  R('API 响应也带 CSP（统一由 Security 头写入器输出）', cspHealth.length > 0, cspHealth.slice(0, 120));
  R('CSP 含 default-src self + object-src none + frame-ancestors none',
    /default-src 'self'/.test(cspRoot) && /object-src 'none'/.test(cspRoot) && /frame-ancestors 'none'/.test(cspRoot), cspRoot.slice(0, 200));
  R('CSP style-src 放开 unsafe-inline（CodeMirror 需要）', /style-src 'self' 'unsafe-inline'/.test(cspRoot), '');
  R('CSP script-src 未放开 unsafe-inline', !/script-src[^;]*unsafe-inline/.test(cspRoot), '');
  const hashes = [...cspRoot.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map(m => m[1]);
  R('CSP 为 index.html 内联主题脚本带上 sha256', hashes.length >= 1, 'hashes=' + hashes.length + ' ' + hashes.map(h => h.slice(0, 12)).join(','));
  R('X-Frame-Options 仍为 DENY（未被 headers 定制覆盖掉）', String(root.headers['x-frame-options'] || '') === 'DENY', String(root.headers['x-frame-options']));
  R('X-Content-Type-Options 仍为 nosniff', String(root.headers['x-content-type-options'] || '') === 'nosniff', String(health.headers['x-content-type-options']));

  /* ---------- 2. Cookie Secure（DEF-E2-003） ---------- */
  const reg = await P('/api/auth/register', { json: { username: AD, displayName: 'D管理员', password: PW } });
  R('注册首个用户成为 admin', reg.status === 201 && reg.json && reg.json.role === 'admin', 'status=' + reg.status + ' role=' + (reg.json || {}).role);
  const plainLogin = await P('/api/auth/login', { as: 'plain', json: { username: AD, password: PW } });
  const plainCookie = String((plainLogin.headers['set-cookie'] || []).join(' | '));
  R('纯 http 登录：Set-Cookie 不含 Secure（本地调试不丢 cookie）', plainLogin.status === 200 && !/;\s*Secure/i.test(plainCookie), plainCookie.slice(0, 130));
  const httpsLogin = await P('/api/auth/login', { as: 'https', json: { username: AD, password: PW }, headers: { 'X-Forwarded-Proto': 'https' } });
  const httpsCookie = String((httpsLogin.headers['set-cookie'] || []).join(' | '));
  R('X-Forwarded-Proto: https 登录：Set-Cookie 含 Secure（DEF-E2-003 修复点）', /;\s*Secure/i.test(httpsCookie), httpsCookie.slice(0, 130));
  R('两种情形其余标志不变（HttpOnly + SameSite=Lax + Path=/）',
    /HttpOnly/i.test(httpsCookie) && /SameSite=Lax/i.test(httpsCookie) && /Path=\//i.test(httpsCookie), httpsCookie.slice(0, 160));

  /* ---------- 3. 跨源写请求拦截（DEF-E2-004） ---------- */
  await P('/api/auth/login', { as: 'u', json: { username: AD, password: PW } });
  const evil = await P('/api/notes', { as: 'u', json: { title: 'evil', content: 'x' }, headers: { Origin: 'https://evil.example.com' } });
  R('跨源 Origin 写请求被拒 403', evil.status === 403, 'status=' + evil.status + ' ' + snip(evil, 120));
  R('拒因是 FORBIDDEN 且文案一致', evil.json && evil.json.error && evil.json.error.code === 'FORBIDDEN', snip(evil, 140));
  const same = await P('/api/notes', { as: 'u', json: { title: 'same-origin', content: 'y' }, headers: { Origin: 'http://127.0.0.1:8534' } });
  R('同源 Origin 写请求放行 200/201', same.status === 200 || same.status === 201, 'status=' + same.status + ' id=' + (same.json || {}).id);
  const noOrigin = await P('/api/notes', { as: 'u', json: { title: 'cli-no-origin', content: 'z' } });
  R('无 Origin（curl/Node fetch/既有测试脚本）放行', noOrigin.status === 200 || noOrigin.status === 201, 'status=' + noOrigin.status);
  const crossSiteNoOrigin = await P('/api/notes', { as: 'u', json: { title: 'cs', content: 'q' }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  R('无 Origin 但 Sec-Fetch-Site: cross-site 被拒 403', crossSiteNoOrigin.status === 403, 'status=' + crossSiteNoOrigin.status);
  const sameSite = await P('/api/notes', { as: 'u', json: { title: 'ss', content: 'q' }, headers: { 'Sec-Fetch-Site': 'same-site' } });
  R('Sec-Fetch-Site: same-site 放行（同站不同子域不误杀）', sameSite.status === 200 || sameSite.status === 201, 'status=' + sameSite.status);
  const del = await request('DELETE', '/api/notes/' + ((same.json || {}).id || 1), { as: 'u', headers: { Origin: 'https://evil.example.com' } });
  R('DELETE 同样受守卫（跨源 → 403）', del.status === 403, 'status=' + del.status);
  const put = await request('PATCH', '/api/notes/' + ((same.json || {}).id || 1), { as: 'u', json: { title: 'x' }, headers: { Origin: 'http://evil.example.com' } });
  R('PATCH 同样受守卫（跨源 → 403）', put.status === 403, 'status=' + put.status);
  const getCross = await G('/api/notes', { as: 'u', headers: { Origin: 'https://evil.example.com' } });
  R('GET 不受影响（读请求保持现状）', getCross.status === 200, 'status=' + getCross.status);
  const opt = await request('OPTIONS', '/api/notes', { headers: { Origin: 'https://evil.example.com' } });
  R('OPTIONS 预检不被守卫拦（交回框架处理）', opt.status !== 403, 'status=' + opt.status);
  const loginCross = await P('/api/auth/login', { json: { username: AD, password: PW }, headers: { Origin: 'https://evil.example.com' } });
  R('跨源登录也被拒（登录会建会话，属写操作）', loginCross.status === 403, 'status=' + loginCross.status);

  // 供浏览器脚本复用（避免二次注册需要邀请码）
  fs.writeFileSync(OUT + '\\d-creds.json', JSON.stringify({ admin: AD, password: PW, at: new Date().toISOString() }, null, 1));
  const pass = rows.filter(r => r.pass).length;
  fs.writeFileSync(OUT + '\\d-check-' + ts + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), pass: pass, total: rows.length, rows: rows }, null, 2));
  console.log('RESULT ' + pass + '/' + rows.length);
  process.exit(pass === rows.length ? 0 : 1);
}
main().catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : e)); process.exit(2); });
