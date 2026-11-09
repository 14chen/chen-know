import fs from 'node:fs';
import path from 'node:path';
import { call, Session, jdump, log, md } from './e3-lib.mjs';
const DATA = process.env.E3_DATA_DIR || 'F:\\work\\test\\kb\\d-e3';
const sz = (s) => { try { return fs.statSync(path.join(DATA, 'kb.db' + s)).size; } catch { return 0; } };
const mb = (b) => Number((b / 1048576).toFixed(2));
const s = new Session(); await s.ensure();
const samples = [];
let stop = false;
const t0 = Date.now();
const sampler = (async () => { while (!stop) { samples.push({ t: Date.now() - t0, db: sz(''), wal: sz('-wal') }); await new Promise(r => setTimeout(r, 50)); } })();
const start = { db: sz(''), wal: sz('-wal') };
let ok = 0;
for (let i = 0; i < 300; i++) { const r = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { title: 'WAL 探针 ' + i, content: md(i, 800) } }); if (r.ok) ok++; }
stop = true; await sampler;
const end = { db: sz(''), wal: sz('-wal') };
const out = { start: { dbMB: mb(start.db), walMB: mb(start.wal) }, end: { dbMB: mb(end.db), walMB: mb(end.wal) },
  peakWalMB: mb(Math.max(...samples.map(x => x.wal))), peakDbMB: mb(Math.max(...samples.map(x => x.db))),
  samples: samples.length, createdOk: ok, wallMs: Date.now() - t0, growthPerNoteBytes: Math.round((end.db - start.db) / Math.max(1, ok)) };
console.log(JSON.stringify(out, null, 2));
jdump('wal-growth.json', out);
