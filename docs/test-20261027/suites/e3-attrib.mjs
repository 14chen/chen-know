/**
 * e3-attrib.mjs — 归因：单独压某一类接口，判断"并发劣化"是 CPU 争用还是内部串行
 */
import { call, Session, stats, jdump, log, ensureDirs, pool } from './e3-lib.mjs';

const TARGETS = [
  { id: 'search-1c', path: '/api/search?q=' + encodeURIComponent('天') + '&size=50' },
  { id: 'search-2c', path: '/api/search?q=' + encodeURIComponent('天气') + '&size=50' },
  { id: 'stats', path: '/api/stats' },
  { id: 'notes-list', path: '/api/notes?page=1&size=50' }
];

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  const out = { generatedAt: new Date().toISOString(), rows: [] };
  for (const t of TARGETS) {
    const serial = [];
    for (let i = 0; i < 10; i++) { const r = await call(t.path, { cookie: s.cookie }); serial.push(r.ms); }
    const t0 = performance.now();
    const conc = await pool(40, 10, async () => call(t.path, { cookie: s.cookie, timeout: 120000 }));
    const wall = performance.now() - t0;
    const sS = stats(serial), cS = stats(conc.map(r => r.ms));
    const errs = conc.filter(r => !r.ok).length;
    out.rows.push({ id: t.id, serialP50: sS.p50, concurrent10P50: cS.p50, concurrent10P95: cS.p95, concurrent10Max: cS.max,
      ratio: Number((cS.p50 / sS.p50).toFixed(2)), throughput: Number((40 / (wall / 1000)).toFixed(1)), errors: errs });
    log(t.id.padEnd(12), 'serial p50=' + String(sS.p50).padStart(8), '| c10 p50=' + String(cS.p50).padStart(9), 'ratio=' + (cS.p50 / sS.p50).toFixed(2) + 'x', 'rps=' + (40 / (wall / 1000)).toFixed(1), 'err=' + errs);
    await new Promise(r => setTimeout(r, 1000));
  }
  const f = jdump('attrib.json', out);
  console.log(JSON.stringify(out.rows, null, 2));
  console.log('written:', f);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
