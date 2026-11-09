/**
 * e3-stability.mjs — 3 分钟持续压力：错误率 + Java 进程 RSS 漂移
 * 用法: node e3-stability.mjs [durSec=180] [conc=25]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { call, Session, stats, jdump, log, ensureDirs, md } from './e3-lib.mjs';

const DUR = Number(process.argv[2] || 180) * 1000;
const CONC = Number(process.argv[3] || 25);
const EV = 'D:\\work\\知识库\\docs\\test-20261027\\evidence\\e3';
const SCRIPT = 'D:\\work\\知识库\\docs\\test-20261027\\suites\\e3-rss-sampler.ps1';
const PIDFILE = 'F:\\work\\test\\kb\\logs\\kb-8504.pid';
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

function readRss(csv) {
  if (!fs.existsSync(csv)) return [];
  return fs.readFileSync(csv, 'utf8').split(/\r?\n/).filter(Boolean).slice(1).map(l => {
    const p = l.split(',');
    return { t: Number(p[0]), rss: Number(p[1]), priv: Number(p[2]), threads: Number(p[3]), cpu: Number(p[4]) };
  }).filter(x => Number.isFinite(x.rss));
}

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  const list = await call('/api/notes?page=1&size=200', { cookie: s.cookie });
  const noteIds = ((list.json && list.json.items) || []).map(x => x.id);
  const pid = fs.existsSync(PIDFILE) ? Number(fs.readFileSync(PIDFILE, 'utf8').trim()) : 0;
  log('java pid', pid, 'note pool', noteIds.length);

  const csv = path.join(EV, 'rss-stability.csv');
  let sampler = null;
  if (pid) sampler = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-TargetPid', String(pid), '-Out', csv, '-IntervalMs', '1000'], { stdio: 'ignore', windowsHide: true });
  await new Promise(r => setTimeout(r, 1500));

  const started = Date.now();
  const deadline = started + DUR;
  let stop = false, cursor = 0;
  const recs = [];
  async function worker() {
    while (!stop) {
      if (Date.now() >= deadline) { stop = true; break; }
      const m = RING[cursor++ % RING.length];
      let r;
      if (m.id === 'note-detail') r = await call('/api/notes/' + noteIds[Math.floor(Math.random() * noteIds.length)], { cookie: s.cookie, timeout: 30000 });
      else if (m.id === 'write-patch') r = await call('/api/notes/' + noteIds[Math.floor(Math.random() * noteIds.length)], { method: 'PATCH', cookie: s.cookie, body: { content: md(cursor, 300) + '\n稳定压测 ' + cursor }, timeout: 30000 });
      else if (m.id === 'write-create') r = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { title: '稳定压测新建 ' + cursor, content: md(cursor, 300) }, timeout: 30000 });
      else r = await call(m.path, { cookie: s.cookie, timeout: 30000 });
      recs.push({ id: m.id, ms: r.ms, status: r.status, ok: r.ok, error: r.error, t: Date.now() - started });
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  const ended = Date.now();
  const wall = ended - started;
  if (sampler) try { sampler.kill(); } catch {}
  await new Promise(r => setTimeout(r, 1200));

  const rss = readRss(csv);
  const win = (lo, hi) => { const w = rss.filter(x => x.t >= started + lo && x.t <= Math.min(ended, started + hi)); return w.length ? { samples: w.length, start: w[0].rss, end: w[w.length - 1].rss, max: Math.max(...w.map(x => x.rss)), privMax: Math.max(...w.map(x => x.priv)) } : null; };
  const mins = [];
  const nMins = Math.ceil(wall / 60000);
  for (let i = 0; i < nMins; i++) {
    const lo = i * 60000, hi = (i + 1) * 60000;
    const rs = recs.filter(x => x.t >= lo && x.t < hi);
    if (!rs.length) continue;
    const st = stats(rs.map(x => x.ms));
    mins.push({ minute: i + 1, n: rs.length, rps: Number((rs.length / (Math.min(60000, wall - lo) / 1000)).toFixed(1)), errors: rs.filter(x => !x.ok).length, p50: st.p50, p95: st.p95, max: st.max, rss: win(lo, hi) });
  }
  const errs = recs.filter(x => !x.ok);
  const overall = { total: recs.length, errors: errs.length, errorRate: Number((errs.length / recs.length * 100).toFixed(2)), rps: Number((recs.length / (wall / 1000)).toFixed(1)), ...stats(recs.map(x => x.ms)) };
  const firstQ = rss.filter(x => x.t <= started + wall * 0.25).map(x => x.rss);
  const lastQ = rss.filter(x => x.t >= started + wall * 0.75).map(x => x.rss);
  const avg = (a) => a.length ? a.reduce((p, c) => p + c, 0) / a.length : null;
  const out = {
    generatedAt: new Date().toISOString(), durationSec: Number((wall / 1000).toFixed(1)), concurrency: CONC, javaPid: pid,
    overall, perMinute: mins,
    rss: { samples: rss.length, first: rss.length ? rss[0].rss : null, last: rss.length ? rss[rss.length - 1].rss : null, max: rss.length ? Math.max(...rss.map(x => x.rss)) : null,
           firstQuarterAvg: avg(firstQ) === null ? null : Number(avg(firstQ).toFixed(1)), lastQuarterAvg: avg(lastQ) === null ? null : Number(avg(lastQ).toFixed(1)),
           driftMB: (avg(firstQ) !== null && avg(lastQ) !== null) ? Number((avg(lastQ) - avg(firstQ)).toFixed(1)) : null,
           privMax: rss.length ? Math.max(...rss.map(x => x.priv)) : null },
    perTask: Object.fromEntries(MIX.map(m => { const rs = recs.filter(r => r.id === m.id); return [m.id, rs.length ? { n: rs.length, p50: stats(rs.map(r => r.ms)).p50, p95: stats(rs.map(r => r.ms)).p95, errors: rs.filter(r => !r.ok).length } : null]; })),
    errorSamples: errs.slice(0, 8).map(e => ({ id: e.id, status: e.status, error: String(e.error).slice(0, 200) })),
    lockedCount: recs.filter(r => /locked|busy|SQLITE/i.test(String(r.error || ''))).length
  };
  const f = jdump('stability.json', out);
  console.log('\n== STABILITY ' + out.durationSec + 's @' + CONC + ' ==');
  console.log(['min', 'n', 'rps', 'err', 'p50', 'p95', 'max', 'rss'].map(x => String(x).padEnd(10)).join(''));
  for (const m of mins) console.log([m.minute, m.n, m.rps, m.errors, m.p50, m.p95, m.max, m.rss && m.rss.max].map(x => String(x).padEnd(10)).join(''));
  console.log('overall:', JSON.stringify(overall), 'locked=', out.lockedCount);
  console.log('rss:', JSON.stringify(out.rss));
  console.log('written:', f);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
