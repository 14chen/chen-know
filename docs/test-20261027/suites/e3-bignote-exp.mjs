import { call, Session, stats, log } from './e3-lib.mjs';
const s = new Session(); await s.ensure();
async function time(path, n = 5) { const ms = []; for (let i = 0; i < n; i++) { const r = await call(path, { cookie: s.cookie, timeout: 120000 }); ms.push(r.ms); } return stats(ms); }
const before = await time('/api/search?q=' + encodeURIComponent('天') + '&size=50');
log('before delete: q=天 p50=' + before.p50);
// 找出大正文笔记并删除
const found = [];
for (const kw of ['大正文', '边界探测载体']) {
  const r = await call('/api/notes?page=1&size=50&q=' + encodeURIComponent(kw), { cookie: s.cookie });
  for (const it of (r.json && r.json.items) || []) found.push(it.id);
}
log('big notes found:', found.join(','));
for (const id of found) { const d = await call('/api/notes/' + id, { method: 'DELETE', cookie: s.cookie }); log('  delete', id, d.status); }
await new Promise(r => setTimeout(r, 1500));
const after = await time('/api/search?q=' + encodeURIComponent('天') + '&size=50');
const after2 = await time('/api/search?q=' + encodeURIComponent('天') + '&size=50');
const size10 = await time('/api/search?q=' + encodeURIComponent('天') + '&size=10');
const out = { before: before, after: after, after2: after2, size10: size10, deletedIds: found };
console.log(JSON.stringify(out, null, 2));
