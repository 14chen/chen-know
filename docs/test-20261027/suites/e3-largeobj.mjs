/**
 * e3-largeobj.mjs — 大对象：1MB/5MB Markdown、100 版本、1MB/20MB 附件
 */
import fs from 'node:fs';
import { call, Session, stats, jdump, log, ensureDirs, md } from './e3-lib.mjs';

const N = 5;
const one = (arr) => stats(arr);

function blob(size, type, name) {
  const b = Buffer.alloc(size, 0x41);
  if (type === 'image/png') { Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); }
  const fd = new FormData();
  fd.append('file', new Blob([b], { type }), name);
  return fd;
}
function bigMd(bytes) {
  const unit = '安全生产巡检记录：今天天气很好，需要检查排水沟与通风系统。Spring Boot 自动配置。\n';
  return unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit))).slice(0, bytes);
}

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  const out = { generatedAt: new Date().toISOString(), sections: {} };

  // ---- 1. 1MB / 2MB / 5MB Markdown 保存与打开 ----
  const sizes = [1024 * 1024, 2 * 1024 * 1024, 5 * 1024 * 1024];
  for (const sz of sizes) {
    const content = bigMd(sz);
    const c = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { title: '大正文 ' + (sz / 1024 / 1024).toFixed(1) + 'MB', content: '' } });
    const id = c.json && c.json.id;
    const saves = [], opens = [], statuses = [];
    for (let i = 0; i < N; i++) {
      const r = await call('/api/notes/' + id, { method: 'PATCH', cookie: s.cookie, body: { content } });
      saves.push(r.ms); statuses.push(r.status);
      if (r.ok) { const g = await call('/api/notes/' + id, { cookie: s.cookie }); opens.push(g.ms); }
    }
    out.sections['md-' + (sz / 1024 / 1024) + 'MB'] = { bytes: sz, saveStatuses: statuses, save: one(saves), open: one(opens), noteId: id };
    log('md ' + (sz / 1024 / 1024) + 'MB', 'save p50=' + one(saves).p50 + ' status=' + [...new Set(statuses)].join(','), 'open p50=' + one(opens).p50);
  }

  // ---- 2. 版本历史：100 个版本 ----
  const vn = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { title: '版本历史笔记', content: md(1, 300) } });
  const vid = vn.json.id;
  const patchMs = [];
  for (let i = 1; i <= 100; i++) {
    const r = await call('/api/notes/' + vid, { method: 'PATCH', cookie: s.cookie, body: { content: md(i, 300) + '\n第 ' + i + ' 版' } });
    patchMs.push(r.ms);
  }
  const vlist = [];
  for (let i = 0; i < N; i++) { const r = await call('/api/notes/' + vid + '/versions', { cookie: s.cookie }); vlist.push(r.ms); }
  const vlistBody = await call('/api/notes/' + vid + '/versions', { cookie: s.cookie });
  const vOne = [];
  for (let i = 0; i < N; i++) { const r = await call('/api/notes/' + vid + '/versions/1', { cookie: s.cookie }); vOne.push(r.ms); }
  const restores = [];
  for (let i = 0; i < N; i++) { const r = await call('/api/notes/' + vid + '/versions/1/restore', { method: 'POST', cookie: s.cookie, body: {} }); restores.push(r.ms); }
  const after = await call('/api/notes/' + vid, { cookie: s.cookie });
  out.sections['versions-100'] = {
    patchCount: 100, patch: one(patchMs), list: one(vlist), listBytes: vlistBody.bytes, listLen: Array.isArray(vlistBody.json) ? vlistBody.json.length : (vlistBody.json && vlistBody.json.items ? vlistBody.json.items.length : null),
    getVersion1: one(vOne), restore: one(restores), versionAfterRestore: after.json && after.json.version
  };
  log('versions', 'list p50=' + one(vlist).p50 + ' restore p50=' + one(restores).p50 + ' versionAfter=' + (after.json && after.json.version));

  // ---- 3. 附件 1MB / 20MB / 21MB ----
  for (const mbSz of [1, 20, 21]) {
    const size = mbSz * 1024 * 1024;
    const ups = [], downs = [], statuses = [];
    let attId = null;
    for (let i = 0; i < (mbSz === 21 ? 2 : N); i++) {
      const r = await call('/api/attachments', { method: 'POST', cookie: s.cookie, form: blob(size, 'application/pdf', 'e3-' + mbSz + 'mb.pdf'), timeout: 180000 });
      ups.push(r.ms); statuses.push(r.status);
      if (r.json && r.json.id) attId = r.json.id;
      if (!r.ok && mbSz !== 21) log('  upload ' + mbSz + 'MB failed', r.status, r.error);
    }
    if (attId) { for (let i = 0; i < N; i++) { const r = await call('/api/attachments/' + attId, { cookie: s.cookie, binary: true, timeout: 180000 }); downs.push(r.ms); } }
    out.sections['attach-' + mbSz + 'MB'] = { bytes: size, uploadStatuses: statuses, upload: one(ups), download: one(downs), attId };
    log('attach ' + mbSz + 'MB', 'up p50=' + one(ups).p50 + ' status=' + [...new Set(statuses)].join(','), 'down p50=' + one(downs).p50);
  }

  const f = jdump('largeobj.json', out);
  console.log(JSON.stringify(out.sections, null, 2).slice(0, 4000));
  console.log('written:', f);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
