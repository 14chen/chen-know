import { call, Session, stats, log } from './e3-lib.mjs';
const s = new Session(); await s.ensure();
const f = await call('/api/folders?tree=true', { cookie: s.cookie });
const flat = [];
(function walk(a) { for (const n of a || []) { flat.push(n); walk(n.children); } })(f.json);
log('folders', flat.length, flat.slice(0, 4).map(x => x.id + ':' + x.name).join(','));
// 找一个大正文笔记（1MB 那条）
const big = await call('/api/notes?page=1&size=5&sort=updated', { cookie: s.cookie });
const rows = [];
async function time(path, n = 5) {
  const ms = [];
  for (let i = 0; i < n; i++) { const r = await call(path, { cookie: s.cookie, timeout: 120000 }); ms.push(r.ms); }
  return stats(ms);
}
const g1 = await time('/api/search?q=' + encodeURIComponent('天') + '&size=50');
const fid = flat.length ? flat[0].id : null;
const g2 = fid ? await time('/api/search?q=' + encodeURIComponent('天') + '&size=50&folderId=' + fid) : null;
const g3 = await time('/api/search?q=' + encodeURIComponent('天') + '&size=10');
const g4 = await time('/api/search?q=' + encodeURIComponent('体检') + '&size=50');
const out = { global_q_tian_size50: g1, folderScoped_q_tian: g2, global_q_tian_size10: g3, rare_q: g4 };
console.log(JSON.stringify(out, null, 2));
