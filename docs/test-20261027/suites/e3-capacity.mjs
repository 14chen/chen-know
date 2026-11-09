/**
 * e3-capacity.mjs — 容量：整库导出 ZIP、批量导入 1000 md、DB/WAL 体积
 */
import fs from 'node:fs';
import path from 'node:path';
import { call, Session, stats, jdump, log, ensureDirs } from './e3-lib.mjs';

const DATA_DIR = process.env.E3_DATA_DIR || 'F:\\work\\test\\kb\\d-e3';
const N = 3;
const one = (a) => stats(a);
function sizeOf(suf) { try { return fs.statSync(path.join(DATA_DIR, 'kb.db' + suf)).size; } catch { return 0; } }
function mb(b) { return Number((b / 1048576).toFixed(2)); }

function zipWithMd(count) {
  // 最小 ZIP（store 方式）打包 count 个 .md
  const files = [];
  for (let i = 0; i < count; i++) {
    const name = 'bulk/import-' + i + '.md';
    const body = '# 导入笔记 ' + i + '\n\n今天天气很好，导入测试 ' + i + ' 号。机器学习与检索增强。\n';
    files.push({ name, data: Buffer.from(body, 'utf8') });
  }
  const chunks = [];
  const central = [];
  let offset = 0;
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // UTF-8 flag
    local.writeUInt16LE(0, 8);        // store
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, f.data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(f.data.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));
    offset += local.length + nameBuf.length + f.data.length;
  }
  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cenBuf, eocd]);
}

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  const out = { generatedAt: new Date().toISOString(), dataDir: DATA_DIR, sections: {} };

  const before = await call('/api/notes?page=1&size=1', { cookie: s.cookie });
  const noteTotal = (before.json && before.json.total) || 0;
  out.sections.before = { noteTotal, sizeMB: { db: mb(sizeOf('')), wal: mb(sizeOf('-wal')), shm: mb(sizeOf('-shm')) } };
  log('notes=' + noteTotal, 'db=' + out.sections.before.sizeMB.db + 'MB wal=' + out.sections.before.sizeMB.wal + 'MB');

  // 1) 整库导出 ZIP
  const exp = [], expBytes = [];
  for (let i = 0; i < N; i++) {
    const r = await call('/api/export/all', { cookie: s.cookie, binary: true, timeout: 300000 });
    exp.push(r.ms); expBytes.push(r.bytes);
    if (!r.ok) log('export-all failed', r.status, r.error);
    if (i === 0 && r.buf) fs.writeFileSync(path.join('D:\\work\\知识库\\docs\\test-20261027\\evidence\\e3', 'export-all.zip'), r.buf);
  }
  out.sections.exportAll = { noteTotal, runs: N, ms: one(exp), bytesAvg: Math.round(expBytes.reduce((a, b) => a + b, 0) / expBytes.length), bytesPerNote: appx(expBytes[0], noteTotal) };
  log('export-all', 'p50=' + one(exp).p50 + 'ms bytes=' + expBytes[0]);

  // 2) 单篇导出 ZIP
  const anyNote = await call('/api/notes?page=1&size=1', { cookie: s.cookie });
  const nid = anyNote.json.items[0].id;
  const sing = [];
  for (let i = 0; i < 10; i++) { const r = await call('/api/export/notes/' + nid + '.zip', { cookie: s.cookie, binary: true }); sing.push(r.ms); }
  out.sections.exportOne = { ms: one(sing) };
  log('export-one', 'p50=' + one(sing).p50);

  // 3) 批量导入 1000 个 .md
  const zip = zipWithMd(1000);
  out.sections.importSize = { zipBytes: zip.length };
  const fd = new FormData();
  fd.append('file', new Blob([zip], { type: 'application/zip' }), 'e3-bulk-1000.zip');
  const imp = await call('/api/import/markdown', { method: 'POST', cookie: s.cookie, form: fd, timeout: 600000 });
  out.sections.import1000 = { ms: imp.ms, status: imp.status, body: imp.json, bytes: imp.bytes };
  log('import 1000 md', 'ms=' + imp.ms + ' status=' + imp.status + ' imported=' + (imp.json && imp.json.imported));

  const after = await call('/api/notes?page=1&size=1', { cookie: s.cookie });
  out.sections.after = { noteTotal: (after.json && after.json.total) || 0, sizeMB: { db: mb(sizeOf('')), wal: mb(sizeOf('-wal')), shm: mb(sizeOf('-shm')) } };
  log('after import: notes=' + out.sections.after.noteTotal, 'db=' + out.sections.after.sizeMB.db + 'MB wal=' + out.sections.after.sizeMB.wal + 'MB');

  const f = jdump('capacity.json', out);
  console.log(JSON.stringify(out.sections, null, 2).slice(0, 3000));
  console.log('written:', f);
}
function appx(bytes, notes) { return notes ? Math.round(bytes / notes) : null; }
main().catch(e => { console.error('FATAL', e); process.exit(1); });
