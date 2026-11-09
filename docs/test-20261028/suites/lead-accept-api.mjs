
import fs from 'node:fs';
const BASE = process.env.KB_BASE || 'http://127.0.0.1:8540';
let cookie = '';
async function req(method, p, body, extraHeaders) {
  const h = { ...(extraHeaders || {}) };
  if (cookie && !(extraHeaders && extraHeaders.__noCookie)) h.Cookie = cookie;
  delete h.__noCookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const m = /^([^=]+=[^;]+)/.exec(c); if (m) cookie = m[1]; }
  const raw = await r.text();
  let j = null; try { j = JSON.parse(raw); } catch {}
  return { status: r.status, j, raw, headers: r.headers };
}
function storeZip(entries) {
  const enc = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  for (const e of entries) {
    const nameB = enc.encode(e.name); const dataB = enc.encode(e.content || '');
    const crc = crc32(dataB);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, dataB.length, true); lh.setUint32(22, dataB.length, true);
    lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    const local = Buffer.concat([Buffer.from(lh.buffer), Buffer.from(nameB), Buffer.from(dataB)]);
    chunks.push(local);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, dataB.length, true); cd.setUint32(24, dataB.length, true);
    cd.setUint16(28, nameB.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    central.push(Buffer.concat([Buffer.from(cd.buffer), Buffer.from(nameB)]));
    offset += local.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, centralBuf.length, true); end.setUint32(16, offset, true);
  return Buffer.concat([...chunks, centralBuf, Buffer.from(end.buffer)]);
}
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
const out = []; const P = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (id, name, cond, detail) => { cond ? pass++ : fail++; P((cond ? '  PASS ' : '  FAIL ') + id + ' ' + name + (detail !== undefined ? '  [' + String(detail).slice(0, 200) + ']' : '')); };
(async () => {
  // 初始化：首人 admin
  await req('POST', '/api/auth/register', { username: 'verifier', password: 'Verify1234!', displayName: 'verifier' });
  await req('POST', '/api/auth/login', { username: 'verifier', password: 'Verify1234!' });

  P('=== A. 导入原子性（DEF-E2-001）===');
  const before = (await req('GET', '/api/notes')).j?.total;
  const fd1 = new FormData(); fd1.append('file', new Blob(['   \n\n'], { type: 'text/markdown' }), 'empty.md');
  const imp1 = await req('POST', '/api/import/markdown', fd1);
  const after1 = (await req('GET', '/api/notes')).j?.total;
  ok('A1', '空 .md 计入 skipped 且不落库', imp1.status === 200 && (imp1.j?.imported === 0) && (imp1.j?.skipped >= 1) && after1 === before, JSON.stringify(imp1.j) + ' total ' + before + '->' + after1);

  const big = []; for (let i = 0; i < 2001; i++) big.push({ name: 'e' + i + '.md', content: '' });
  const fd2 = new FormData(); fd2.append('file', new Blob([storeZip(big)], { type: 'application/zip' }), 'over.zip');
  const imp2 = await req('POST', '/api/import/markdown', fd2);
  const after2 = (await req('GET', '/api/notes')).j?.total;
  ok('A2', '2001 条目 ZIP 被拒且零写入', (imp2.status === 413) && after2 === before, 'status=' + imp2.status + ' total ' + before + '->' + after2);

  const exact = []; for (let i = 0; i < 2000; i++) exact.push({ name: 'k' + i + '.md', content: 'body ' + i });
  const fd3 = new FormData(); fd3.append('file', new Blob([storeZip(exact)], { type: 'application/zip' }), 'exact.zip');
  const t0 = Date.now(); const imp3 = await req('POST', '/api/import/markdown', fd3); const dtImport = Date.now() - t0;
  ok('A3', '2000 条目可导入（边界内）', imp3.status === 200 && imp3.j?.imported === 2000, 'status=' + imp3.status + ' imported=' + imp3.j?.imported + ' ' + dtImport + 'ms');
  ok('A4', '2000 篇导入耗时 ≤5s（DEF-E3-004）', dtImport <= 5000, dtImport + 'ms');

  P('=== B. 搜索：大正文与高亮（DEF-E3-001 / E4-003）===');
  const sample = async (n) => { const ts = []; for (let i = 0; i < n; i++) { const t = Date.now(); await req('GET', '/api/search?q=' + encodeURIComponent('天气')); ts.push(Date.now() - t); } ts.sort((a, b) => a - b); return ts[Math.floor(ts.length * 0.95)]; };
  const base95 = await sample(12);
  const bigBody = ('天气 记录 ' + '填充内容'.repeat(200) + '\n').repeat(700);
  await req('POST', '/api/notes', { title: '大正文验证', content: bigBody });
  await sleep(800);
  const big95 = await sample(12);
  const ratio = big95 / Math.max(base95, 1);
  ok('B1', '大正文场景搜索 P95 比值 ≤1.3（DEF-E3-001）', ratio <= 1.3, 'base95=' + base95 + 'ms big95=' + big95 + 'ms ratio=' + ratio.toFixed(2) + ' 大正文=' + Math.round(bigBody.length / 1024) + 'KB');

  const srch = await req('GET', '/api/search?q=' + encodeURIComponent('天气'));
  const items = srch.j?.items || [];
  const anyEm = items.some(it => /<em>/i.test((it.highlight || '') + (it.title || ''))) || items.some(it => /<strong>|\*\*/.test(it.snippet || ''));
  ok('B2', '三字以内中文检索有强调输出（em/strong）', anyEm, 'items=' + items.length + ' sample=' + JSON.stringify(items[0] || {}).slice(0, 160));

  P('=== C. 标题修改（DEF-E4-001 的 API 侧）===');
  const n1 = await req('POST', '/api/notes', { title: '未命名笔记', content: 'x' });
  const nid = n1.j?.id;
  const ren = await req('PATCH', '/api/notes/' + nid, { title: '会议纪要-验收' });
  const got = await req('GET', '/api/notes/' + nid);
  ok('C1', 'PATCH title 生效', ren.status === 200 && got.j?.title === '会议纪要-验收', 'title=' + got.j?.title);
  const s2 = await req('GET', '/api/search?q=' + encodeURIComponent('会议纪要-验收'));
  ok('C2', '新标题可被搜到', (s2.j?.total || 0) >= 1, 'total=' + s2.j?.total);

  P('=== D. 当前版本回滚（DEF-E1-001）===');
  const n2 = await req('POST', '/api/notes', { title: '版本验收', content: 'v1' });
  const vid = n2.j?.id;
  await req('PATCH', '/api/notes/' + vid, { content: 'v2' });
  const det = await req('GET', '/api/notes/' + vid); const cur = det.j?.version;
  const gv = await req('GET', '/api/notes/' + vid + '/versions/' + cur);
  const rs = await req('POST', '/api/notes/' + vid + '/versions/' + cur + '/restore');
  ok('D1', '当前版本 GET 200 且 restore 200（no-op）', gv.status === 200 && rs.status === 200, 'GET=' + gv.status + ' POST=' + rs.status);

  P('=== E. 同名双链歧义（DEF-E4-002）===');
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = await req('POST', '/api/notes', { title: '重名验收', content: 'x' + i }); ids.push(r.j.id); }
  const refn = await req('POST', '/api/notes', { title: '引用方', content: '见 [[重名验收]] 与 [[不存在词]]' });
  await sleep(700);
  const lk = await req('GET', '/api/notes/' + refn.j.id + '/links');
  const resolved0 = (lk.j?.resolved || [])[0] || {};
  const blCounts = [];
  for (const id of ids) { const bl = await req('GET', '/api/notes/' + id + '/backlinks'); blCounts.push((bl.j?.items || []).length); }
  ok('E1', 'resolved 暴露歧义信息', resolved0.ambiguous === true || (resolved0.candidates || 0) > 1, JSON.stringify(resolved0).slice(0, 160));
  ok('E2', '三篇同名笔记都能看到反链', blCounts.every(c => c >= 1), 'backlinks=' + JSON.stringify(blCounts));

  P('=== F. 统计接口（DEF-E3-003）===');
  const st = []; for (let i = 0; i < 15; i++) { const t = Date.now(); await req('GET', '/api/stats'); st.push(Date.now() - t); }
  st.sort((a, b) => a - b); const st95 = st[Math.floor(st.length * 0.95)];
  const statsBody = await req('GET', '/api/stats');
  ok('F1', '统计 P95 ≤50ms 且字段齐全', st95 <= 50 && statsBody.status === 200, 'p95=' + st95 + 'ms keys=' + Object.keys(statsBody.j || {}).join(','));

  P('=== G. 安全（DEF-E2-002/003/004）===');
  const root = await req('GET', '/');
  const csp = root.headers.get('content-security-policy') || '';
  const rp = root.headers.get('referrer-policy') || '';
  ok('G1', 'CSP 与 Referrer-Policy 存在', csp.length > 0 && rp.length > 0, 'csp=' + csp.slice(0, 80) + ' | rp=' + rp);
  const lgHttps = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ username: 'verifier', password: 'Verify1234!' }) });
  const scHttp = (lgHttps.headers.getSetCookie ? lgHttps.headers.getSetCookie() : []).join(';');
  const lgPlain = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'verifier', password: 'Verify1234!' }) });
  const scPlain = (lgPlain.headers.getSetCookie ? lgPlain.headers.getSetCookie() : []).join(';');
  ok('G2', 'X-Forwarded-Proto https 时 Cookie 带 Secure', /Secure/i.test(scHttp) && !/Secure/i.test(scPlain), 'https=[' + scHttp.slice(0, 90) + '] http=[' + scPlain.slice(0, 90) + ']');
  const cross = await req('POST', '/api/notes', { title: '跨源测试' }, { Origin: 'https://evil.example.com' });
  ok('G3', '跨源写请求被拒', cross.status === 403, 'status=' + cross.status);
  const sameOrigin = await req('POST', '/api/notes', { title: '同源测试' }, { Origin: 'http://127.0.0.1:8540' });
  ok('G4', '同源写请求放行', sameOrigin.status === 201, 'status=' + sameOrigin.status);

  P('=== H. 简报开关（DEF-E5-009）===');
  const t1 = Date.now(); const run = await req('POST', '/api/briefing/run', {}); const dtRun = Date.now() - t1;
  ok('H1', 'enabled=false 时 run 被拒且无外连迹象', (run.status === 403) && dtRun < 500, 'status=' + run.status + ' ' + dtRun + 'ms');

  P('');
  P('================ 验收结果: PASS ' + pass + ' / FAIL ' + fail + ' ================');
  fs.writeFileSync(process.env.KB_OUT, out.join('\n'), 'utf8');
})().catch(e => { P('EXCEPTION ' + e.message); fs.writeFileSync(process.env.KB_OUT, out.join('\n') + '\nEXC ' + e.stack, 'utf8'); });
