/**
 * e3-datavol.mjs — 数据量梯度：100 / 1000 / 10000 篇笔记
 * 用法: node e3-datavol.mjs [levels=100,1000,10000] [samples=20]
 */
import fs from 'node:fs';
import path from 'node:path';
import { call, Session, stats, jdump, log, ensureDirs, md, pool } from './e3-lib.mjs';

const LEVELS = (process.argv[2] || '100,1000,10000').split(',').map(Number);
const N = Number(process.argv[3] || 20);
const WARM = 2;
const DATA_DIR = process.env.E3_DATA_DIR || 'F:\\work\\test\\kb\\d-e3';

function sizeOf(suffix) {
  try { return fs.statSync(path.join(DATA_DIR, 'kb.db' + suffix)).size; } catch { return 0; }
}
function mb(b) { return Number((b / 1048576).toFixed(2)); }

async function createNotes(s, from, to, folderIds, conc = 4) {
  const ids = [];
  let fails = 0;
  const t0 = Date.now();
  const res = await pool(to - from, conc, async (k) => {
    const i = from + k;
    const f = folderIds[i % folderIds.length];
    const r = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { folderId: f, title: '批量笔记 ' + i + ' 号', content: md(i, 400) } });
    if (r.json && r.json.id) ids.push(r.json.id); else if (!r.ok) fails++;
    return r;
  });
  const ms = res.map(r => r.ms);
  return { created: ids.length, fails, wallMs: Date.now() - t0, ids, p50: stats(ms).p50, p95: stats(ms).p95 };
}

async function measure(s, level, noteIds) {
  const rows = [];
  const targets = [
    { id: 'notes-list-p1', name: '笔记列表 第1页(50)', path: '/api/notes?page=1&size=50' },
    { id: 'notes-list-deep', name: '笔记列表 深分页(page=' + Math.max(1, Math.floor(level / 50 / 2)) + ')', path: '/api/notes?page=' + Math.max(1, Math.floor(level / 50 / 2)) + '&size=50' },
    { id: 'notes-by-tag', name: '按标签过滤列表', path: '/api/notes?page=1&size=50&tag=' + encodeURIComponent('T1') },
    { id: 'search-1c', name: '搜索 1 字（天）', path: '/api/search?q=' + encodeURIComponent('天') + '&size=50' },
    { id: 'search-2c', name: '搜索 2 字（天气）', path: '/api/search?q=' + encodeURIComponent('天气') + '&size=50' },
    { id: 'search-rare', name: '搜索 稀有词（体检）', path: '/api/search?q=' + encodeURIComponent('体检') + '&size=50' },
    { id: 'stats', name: '统计 /api/stats', path: '/api/stats' },
    { id: 'tags', name: '标签聚合 /api/tags', path: '/api/tags' },
    { id: 'folders', name: '目录树 /api/folders?tree=true', path: '/api/folders?tree=true' },
    { id: 'note-detail', name: '笔记详情（随机）', path: '/api/notes/' + noteIds[Math.floor(noteIds.length / 2)] },
    { id: 'create-note', name: '新建笔记（写路径）', path: '/api/notes', method: 'POST', body: { folderId: null, title: '测量写延迟', content: md(9, 300) } }
  ];
  for (const t of targets) {
    for (let i = 0; i < WARM; i++) await call(t.path, { method: t.method || 'GET', cookie: s.cookie, body: t.body });
    const ms = [], bytes = [];
    const fail = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const r = await call(t.path, { method: t.method || 'GET', cookie: s.cookie, body: t.body });
      ms.push(r.ms); bytes.push(r.bytes);
      if (!r.ok) fail.push({ status: r.status, error: r.error });
    }
    const wall = performance.now() - t0;
    const st = stats(ms);
    rows.push({ id: t.id, name: t.name, path: t.path, n: st.n, p50: st.p50, p95: st.p95, p99: st.p99, max: st.max,
      bytesAvg: bytes.length ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : 0,
      rps: Number((N / (wall / 1000)).toFixed(1)), errors: fail.length, errorSamples: fail.slice(0, 2) });
    log('  ' + String(t.id).padEnd(16), 'p50=' + String(st.p50).padStart(8), 'p95=' + String(st.p95).padStart(8), 'max=' + String(st.max).padStart(8), 'bytes=' + rows[rows.length - 1].bytesAvg, 'err=' + fail.length);
  }
  return rows;
}

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  // 目录骨架：10 个根目录
  const folderIds = [];
  for (let i = 1; i <= 10; i++) {
    const r = await call('/api/folders', { method: 'POST', cookie: s.cookie, body: { parentId: null, name: 'E3 目录 ' + i } });
    if (r.json && r.json.id) folderIds.push(r.json.id);
  }
  // 10 个标签
  for (let i = 1; i <= 10; i++) await call('/api/tags', { method: 'POST', cookie: s.cookie, body: { name: 'T' + i } });
  const existing = await call('/api/notes?page=1&size=1', { cookie: s.cookie });
  let have = (existing.json && existing.json.total) || 0;
  log('existing notes:', have);
  const noteIds = [];
  for (let i = 0; i < Math.min(have, 20); i++) { const r = await call('/api/notes/' + (i + 1), { cookie: s.cookie }); if (r.json && r.json.id) noteIds.push(r.json.id); }

  const report = { generatedAt: new Date().toISOString(), levels: [], dataDir: DATA_DIR };
  for (const level of LEVELS) {
    const need = level - have;
    log('=== level ' + level + ' (need ' + need + ') ===');
    let createInfo = null;
    if (need > 0) {
      createInfo = await createNotes(s, 1000 + have, 1000 + level, folderIds, 4);
      have = level;
      // 打标签：每 10 篇一个标签
      const sample = Math.min(200, level);
      for (let i = 0; i < sample; i++) {
        const idx = i % 10;
        const r = await call('/api/notes?page=' + (1 + Math.floor(Math.random() * Math.max(1, Math.floor(level / 50)))) + '&size=1', { cookie: s.cookie });
      }
      await call('/api/tags', { cookie: s.cookie });
      log('  created=' + createInfo.created + ' fails=' + createInfo.fails + ' wall=' + createInfo.wallMs + 'ms');
    }
    const listNow = await call('/api/notes?page=1&size=200', { cookie: s.cookie });
    const ids = ((listNow.json && listNow.json.items) || []).map(x => x.id);
    // 给前 100 篇打标签（分批 PUT）
    const tagTargets = ids.slice(0, 100);
    for (let i = 0; i < tagTargets.length; i++) {
      await call('/api/notes/' + tagTargets[i] + '/tags', { method: 'PUT', cookie: s.cookie, body: { tagNames: ['T' + (1 + (i % 10))] } });
    }
    const dbBefore = { db: sizeOf(''), wal: sizeOf('-wal') };
    const rows = await measure(s, level, ids.length ? ids : [1]);
    const dbAfter = { db: sizeOf(''), wal: sizeOf('-wal') };
    report.levels.push({
      level, createInfo, notesTotal: (listNow.json && listNow.json.total) || null,
      sizeMB: { dbBefore: mb(dbBefore.db), walBefore: mb(dbBefore.wal), dbAfter: mb(dbAfter.db), walAfter: mb(dbAfter.wal) },
      rows
    });
    jdump('datavol-' + level + '.json', { level, createInfo, sizeMB: report.levels[report.levels.length - 1].sizeMB, rows });
  }
  jdump('datavol-all.json', report);
  console.log('\n== DATAVOL SUMMARY (ms) ==');
  for (const l of report.levels) {
    console.log('--- level ' + l.level + '  db=' + l.sizeMB.dbAfter + 'MB wal=' + l.sizeMB.walAfter + 'MB');
    for (const r of l.rows) console.log('   ' + String(r.id).padEnd(16) + ' p50=' + String(r.p50).padStart(8) + ' p95=' + String(r.p95).padStart(8) + ' max=' + String(r.max).padStart(8) + ' bytes=' + r.bytesAvg);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
