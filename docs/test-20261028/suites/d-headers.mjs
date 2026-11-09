#!/usr/bin/env node
/** 头矩阵抽样：各端点是否都带齐安全头（CSP/Referrer/nosniff/XFO）*/
import http from 'node:http';
import fs from 'node:fs';
const HOST = '127.0.0.1', PORT = 8534;
const OUT = 'D:\\work\\知识库\\docs\\test-20261028\\evidence\\d';
function get(p, headers) {
  return new Promise((res, rej) => {
    const req = http.request({ host: HOST, port: PORT, method: 'GET', path: p, headers: headers || {}, timeout: 15000 }, (r) => {
      const ch = []; r.on('data', (c) => ch.push(c)); r.on('end', () => res({ status: r.statusCode, h: r.headers }));
    });
    req.on('error', rej); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
  });
}
const targets = [
  ['/', 'SPA 首屏 HTML'],
  ['/index.html', 'SPA 静态 HTML'],
  ['/manifest.webmanifest', 'PWA manifest'],
  ['/icons/icon-192.png', '图标（图片）'],
  ['/api/health', '健康检查 JSON'],
  ['/assets/index-urNQZnQW.js', '打包 JS'],
  ['/api/auth/me', '未登录 API（401）'],
  ['/api/nope-404', '未知 API'],
];
const rows = [];
for (const [p, label] of targets) {
  const r = await get(p);
  const h = r.h;
  rows.push({
    path: p, label: label, status: r.status,
    csp: h['content-security-policy'] ? 'yes' : 'no',
    referrer: h['referrer-policy'] || '',
    nosniff: h['x-content-type-options'] || '',
    xfo: h['x-frame-options'] || '',
    cache: h['cache-control'] || ''
  });
  console.log(p + ' (' + r.status + ') csp=' + (h['content-security-policy'] ? 'yes' : 'NO') + ' referrer=' + (h['referrer-policy'] || 'NO') + ' nosniff=' + (h['x-content-type-options'] || 'NO') + ' xfo=' + (h['x-frame-options'] || 'NO'));
}
const allHave = rows.every((x) => x.csp === 'yes' && x.referrer && x.nosniff === 'nosniff' && x.xfo === 'DENY');
console.log('ALL-HEADERS-ON-EVERY-RESPONSE=' + allHave);
fs.writeFileSync(OUT + '\\d-headers-matrix.json', JSON.stringify({ at: new Date().toISOString(), allHave: allHave, rows: rows }, null, 1));
process.exit(allHave ? 0 : 1);
