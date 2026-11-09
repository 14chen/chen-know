/**
 * E1 探针 3：跨空间写入/导出隔离、附件 MIME 白名单、邀请码负值
 */
import { Client, get, log, formWith, formFile, unzip } from './e1-lib.mjs';

async function main() {
  const a = new Client('p3a');
  const m = new Client('p3m');
  await a.login('e1admin', 'Passw0rd!23');
  await m.login('e1user', 'Passw0rd!23');
  const tag = 'p3' + Date.now().toString(36).slice(-4);

  // 管理员建目录与笔记
  const f = await a.post('/folders', { parentId: null, name: '管理员私有目录' + tag });
  const fid = get(f.json, 'id');
  const n = await a.post('/notes', { folderId: fid, title: '管理员私有笔记' + tag, content: 'secret ' + tag });
  const nid = get(n.json, 'id');

  // c) 普通用户把自己的笔记 PATCH 进管理员目录
  const mn = await m.post('/notes', { title: '普通用户笔记' + tag, content: 'x' });
  const mnid = get(mn.json, 'id');
  const patch = await m.patch('/notes/' + mnid, { folderId: fid });
  log('PATCH 他人目录 folderId -> ' + patch.status + ' ' + JSON.stringify(patch.json).slice(0, 140));

  // d) 普通用户 H 导出全部，检查是否包含管理员笔记
  const ex = await m.get('/export/all');
  let names = [];
  try { names = unzip(ex.buf).map((e) => e.name); } catch (e) { names = ['<unzip fail: ' + e.message + '>']; }
  log('member /export/all -> ' + ex.status + ' 条目数=' + names.length + ' 含管理员笔记=' + names.some((x) => x.includes('管理员私有笔记' + tag)));
  log('  entries sample: ' + JSON.stringify(names.slice(0, 6)));

  // e) 普通用户上传附件时把 noteId 指向管理员笔记
  const up = await m.req('POST', '/attachments', { form: formWith({ noteId: nid }, [{ field: 'file', bytes: Buffer.from('x'), filename: 'xss' + tag + '.txt', type: 'text/plain' }]) });
  log('member 上传 noteId=他人笔记 -> ' + up.status + ' ' + JSON.stringify(up.json).slice(0, 140));

  // i) MIME 与文件名不一致：.png 名字 + text/html 类型
  const bad = await a.req('POST', '/attachments', { form: formFile('file', Buffer.from('<html><script>alert(1)</script></html>'), 'evil' + tag + '.png', 'text/html') });
  log('上传 text/html（.png 名） -> ' + bad.status + ' ' + JSON.stringify(bad.json).slice(0, 160));

  // j) 邀请码 expiresInHours 负数
  const inv = await a.post('/admin/invites', { expiresInHours: -5 });
  log('邀请码 expiresInHours=-5 -> ' + inv.status + ' ' + JSON.stringify(inv.json).slice(0, 160));

  // k) 普通用户取管理员笔记详情/搜索
  const g = await m.get('/notes/' + nid);
  log('member GET 管理员笔记 -> ' + g.status + ' ' + JSON.stringify(g.json).slice(0, 120));
  const s = await m.get('/search?q=' + encodeURIComponent('secret ' + tag));
  log('member 搜管理员内容 -> ' + s.status + ' total=' + get(s.json, 'total'));
}
main().catch((e) => { console.log('probe3 fail ' + ((e && e.stack) || e)); process.exit(1); });
