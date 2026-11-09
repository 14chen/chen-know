/**
 * e3-baseline.mjs — 响应时间基线：代表性接口 × (warmup 3 + 30 采样)
 */
import { call, Session, stats, jdump, log, ensureDirs, md } from './e3-lib.mjs';

const N = Number(process.argv[2] || 30);
const WARM = 3;

function pngBytes(size) {
  const b = Buffer.alloc(size, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  for (let i = 8; i < size; i++) b[i] = i & 0xff;
  return b;
}
function uploadForm(size, name) {
  const fd = new FormData();
  fd.append('file', new Blob([pngBytes(size)], { type: 'image/png' }), name || 'e3-baseline.png');
  return fd;
}

async function seed(s) {
  const ck = s.cookie;
  const folder = await call('/api/folders', { method: 'POST', cookie: ck, body: { parentId: null, name: 'E3 基线目录' } });
  const folderId = folder.json && folder.json.id;
  const ids = [];
  for (let i = 1; i <= 6; i++) {
    const r = await call('/api/notes', { method: 'POST', cookie: ck, body: { folderId: folderId || null, title: 'E3 基线笔记 ' + i, content: md(i, 600) } });
    if (r.json && r.json.id) ids.push(r.json.id);
  }
  const target = ids[0];
  await call('/api/notes/' + target + '/tags', { method: 'PUT', cookie: ck, body: { tagNames: ['Java', '笔记'] } });
  const up = await call('/api/attachments', { method: 'POST', cookie: ck, form: uploadForm(64 * 1024) });
  const attId = up.json && up.json.id;
  if (attId) await call('/api/notes/' + target, { method: 'PATCH', cookie: ck, body: { content: md(1, 600) + '\n\n![图](/api/attachments/' + attId + ')\n' } });
  const trashMe = ids[ids.length - 1];
  await call('/api/notes/' + trashMe, { method: 'DELETE', cookie: ck });
  return { folderId, noteIds: ids, detailId: target, attId, trashId: trashMe };
}

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  log('session ready, user id', s.id);
  const ctx = await seed(s);
  log('seed done', JSON.stringify(ctx));

  const targets = [
    { id: 'health', name: '健康检查 GET /api/health', path: '/api/health', noAuth: true },
    { id: 'login', name: '登录 POST /api/auth/login', path: '/api/auth/login', method: 'POST', body: { username: 'e3admin', password: 'e3pass123' }, noAuth: true },
    { id: 'notes-list', name: '笔记列表 GET /api/notes?size=50', path: '/api/notes?page=1&size=50' },
    { id: 'note-detail', name: '笔记详情 GET /api/notes/{id}', path: '/api/notes/' + ctx.detailId },
    { id: 'search-1c', name: '搜索1字 GET /api/search?q=天', path: '/api/search?q=' + encodeURIComponent('天') },
    { id: 'search-2c', name: '搜索2字 GET /api/search?q=天气', path: '/api/search?q=' + encodeURIComponent('天气') },
    { id: 'tags', name: '标签列表 GET /api/tags', path: '/api/tags' },
    { id: 'trash', name: '回收站 GET /api/trash', path: '/api/trash' },
    { id: 'stats', name: '统计 GET /api/stats', path: '/api/stats' },
    { id: 'attach-up', name: '附件上传 64KB POST /api/attachments', path: '/api/attachments', method: 'POST', form: true },
    { id: 'attach-down', name: '附件下载 GET /api/attachments/{id}', path: '/api/attachments/' + ctx.attId, binary: true },
    { id: 'export-note', name: '导出单篇 ZIP GET /api/export/notes/{id}.zip', path: '/api/export/notes/' + ctx.detailId + '.zip', binary: true }
  ];

  const rows = [];
  for (const t of targets) {
    const fail = [];
    const opt = () => ({ method: t.method || 'GET', cookie: t.noAuth ? undefined : s.cookie, body: t.body, form: t.form ? uploadForm(64 * 1024, 'e3-warm.png') : undefined, binary: t.binary });
    for (let i = 0; i < WARM; i++) { const r = await call(t.path, opt()); if (!r.ok) fail.push({ phase: 'warm', status: r.status, error: r.error }); }
    const ms = [], bytes = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const r = await call(t.path, opt());
      ms.push(r.ms); bytes.push(r.bytes);
      if (!r.ok) fail.push({ phase: 'sample', status: r.status, error: r.error });
    }
    const wall = performance.now() - t0;
    const st = stats(ms);
    rows.push({
      id: t.id, name: t.name, path: t.path, n: st.n, p50: st.p50, p90: st.p90, p95: st.p95, p99: st.p99, max: st.max, mean: st.mean,
      rps: Number((N / (wall / 1000)).toFixed(1)),
      bytesAvg: bytes.length ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : 0,
      failures: fail.length, failureSamples: fail.slice(0, 3)
    });
    log(String(t.id).padEnd(12), 'p50=' + String(st.p50).padStart(8), 'p95=' + String(st.p95).padStart(8), 'p99=' + String(st.p99).padStart(8), 'max=' + String(st.max).padStart(8), 'bytes=' + rows[rows.length - 1].bytesAvg, 'fail=' + fail.length);
  }
  const out = { generatedAt: new Date().toISOString(), port: Number(process.env.E3_PORT || 8504), samples: N, warmup: WARM, context: ctx, rows };
  const f = jdump('baseline.json', out);
  console.log('\n== BASELINE (ms) ==');
  console.log(['id', 'P50', 'P90', 'P95', 'P99', 'max', 'mean', 'rps', 'bytes', 'fail'].map(x => String(x).padEnd(12)).join(''));
  for (const r of rows) console.log([r.id, r.p50, r.p90, r.p95, r.p99, r.max, r.mean, r.rps, r.bytesAvg, r.failures].map(x => String(x).padEnd(12)).join(''));
  console.log('written:', f);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
