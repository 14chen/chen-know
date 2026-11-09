/**
 * e3-concurrency.mjs — 10/25/50 并发读多写少混合 + 同一篇笔记并发写是否丢版本
 */
import { call, Session, stats, jdump, log, ensureDirs, md, pool } from './e3-lib.mjs';

const LEVELS = (process.argv[2] || '10,25,50').split(',').map(Number);
const DUR = Number(process.argv[3] || 40) * 1000;
const MIX = [
  { id: 'notes-list', w: 30, path: '/api/notes?page=1&size=50' },
  { id: 'note-detail', w: 20, path: null },
  { id: 'search-1c', w: 20, path: '/api/search?q=' + encodeURIComponent('天') },
  { id: 'tags', w: 5, path: '/api/tags' },
  { id: 'stats', w: 5, path: '/api/stats' },
  { id: 'write-create', w: 12, path: '/api/notes', method: 'POST' },
  { id: 'write-patch', w: 8, path: null, method: 'PATCH' }
];
const RING = MIX.flatMap(m => Array.from({ length: m.w }, () => m));

async function runLevel(level, s, noteIds, durMs) {
  const started = Date.now();
  const deadline = started + durMs;
  let stop = false;
  let cursor = 0;
  const recs = [];
  async function worker() {
    while (!stop) {
      if (Date.now() >= deadline) { stop = true; break; }
      const m = RING[cursor++ % RING.length];
      let r;
      if (m.id === 'note-detail') r = await call('/api/notes/' + noteIds[Math.floor(Math.random() * noteIds.length)], { cookie: s.cookie, timeout: 30000 });
      else if (m.id === 'write-patch') r = await call('/api/notes/' + noteIds[Math.floor(Math.random() * noteIds.length)], { method: 'PATCH', cookie: s.cookie, body: { title: '并发改写 ' + cursor, content: md(cursor, 300) }, timeout: 30000 });
      else if (m.id === 'write-create') r = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { title: '并发新建 ' + cursor, content: md(cursor, 300) }, timeout: 30000 });
      else r = await call(m.path, { cookie: s.cookie, timeout: 30000 });
      recs.push({ id: m.id, ms: r.ms, status: r.status, ok: r.ok, error: r.error, bytes: r.bytes });
    }
  }
  await Promise.all(Array.from({ length: level }, () => worker()));
  const wall = Date.now() - started;
  const s2 = stats(recs.map(r => r.ms));
  const errs = recs.filter(r => !r.ok);
  const perTask = {};
  for (const m of MIX) {
    const rs = recs.filter(r => r.id === m.id);
    if (rs.length) perTask[m.id] = { n: rs.length, p50: stats(rs.map(r => r.ms)).p50, p95: stats(rs.map(r => r.ms)).p95, errors: rs.filter(r => !r.ok).length };
  }
  return {
    level, wallMs: wall, total: recs.length, throughput: Number((recs.length / (wall / 1000)).toFixed(1)),
    p50: s2.p50, p95: s2.p95, p99: s2.p99, max: s2.max,
    errors: errs.length, errorRate: Number((errs.length / recs.length * 100).toFixed(2)),
    statusSeen: [...new Set(recs.map(r => r.status))].sort((a, b) => a - b),
    lockedCount: recs.filter(r => /locked|busy|SQLITE/i.test(String(r.error || ''))).length,
    errorSamples: errs.slice(0, 8).map(e => ({ id: e.id, status: e.status, error: String(e.error).slice(0, 200) })),
    perTask
  };
}

async function sameNoteWrite(s, noteId, concurrency) {
  const before = await call('/api/notes/' + noteId + '/versions', { cookie: s.cookie });
  const beforeLen = Array.isArray(before.json) ? before.json.length : 0;
  const beforeV = beforeLen;
  const res = await pool(concurrency, concurrency, async (i) => call('/api/notes/' + noteId, { method: 'PATCH', cookie: s.cookie, body: { content: md(i, 200) + '\n并发写 ' + i }, timeout: 30000 }));
  const after = await call('/api/notes/' + noteId + '/versions', { cookie: s.cookie });
  const afterLen = Array.isArray(after.json) ? after.json.length : 0;
  const detail = await call('/api/notes/' + noteId, { cookie: s.cookie });
  return {
    concurrency, beforeVersions: beforeLen, afterVersions: afterLen, versionDelta: afterLen - beforeLen,
    expectDelta: concurrency, lostVersions: concurrency - (afterLen - beforeLen),
    currentVersion: detail.json && detail.json.version,
    okCount: res.filter(r => r.ok).length, errors: res.filter(r => !r.ok).map(r => ({ status: r.status, error: String(r.error).slice(0, 120) })),
    p50: stats(res.map(r => r.ms)).p50, max: stats(res.map(r => r.ms)).max
  };
}

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  const list = await call('/api/notes?page=1&size=200', { cookie: s.cookie });
  const noteIds = ((list.json && list.json.items) || []).map(x => x.id);
  if (!noteIds.length) throw new Error('no notes to test');
  log('note pool', noteIds.length);

  const out = { generatedAt: new Date().toISOString(), durSec: DUR / 1000, levels: [] };
  for (const lv of LEVELS) {
    const r = await runLevel(lv, s, noteIds, DUR);
    out.levels.push(r);
    log('c=' + lv, 'rps=' + r.throughput, 'err%=' + r.errorRate, 'locked=' + r.lockedCount, 'p50=' + r.p50, 'p95=' + r.p95, 'max=' + r.max, 'status=' + r.statusSeen.join('/'));
    await new Promise(x => setTimeout(x, 1500));
  }
  // 同一篇笔记并发写
  const target = noteIds[0];
  out.sameNote = [];
  for (const c of [10, 20]) {
    const r = await sameNoteWrite(s, target, c);
    out.sameNote.push(r);
    log('same-note c=' + c, 'versionDelta=' + r.versionDelta + '/' + r.expectDelta, 'lost=' + r.lostVersions, 'ok=' + r.okCount);
  }
  const f = jdump('concurrency.json', out);
  console.log('\n== CONCURRENCY ==');
  for (const l of out.levels) console.log('c=' + l.level + ' rps=' + l.throughput + ' err%=' + l.errorRate + ' locked=' + l.lockedCount + ' p50=' + l.p50 + ' p95=' + l.p95 + ' p99=' + l.p99 + ' max=' + l.max);
  console.log('same-note:', JSON.stringify(out.sameNote.map(x => ({ c: x.concurrency, delta: x.versionDelta, lost: x.lostVersions, ok: x.okCount }))));
  console.log('written:', f);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
