/**
 * E1 探针 4：整库导出的图片相对路径（§10.2 表格）与「导出→导入」往返完整性
 */
import { Client, get, log, formWith, unzip, zipText } from './e1-lib.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const a = new Client('p4');
  await a.login('e1admin', 'Passw0rd!23');
  const tag = 'p4' + Date.now().toString(36).slice(-4);

  // 建两级目录 + 笔记 + 图片
  const f1 = await a.post('/folders', { parentId: null, name: '技术' + tag });
  const f1id = get(f1.json, 'id');
  const f2 = await a.post('/folders', { parentId: f1id, name: '前端' + tag });
  const f2id = get(f2.json, 'id');
  const n = await a.post('/notes', { folderId: f2id, title: '前端笔记' + tag, content: '待补' });
  const nid = get(n.json, 'id');
  const up = await a.req('POST', '/attachments', { form: formWith({ noteId: nid }, [{ field: 'file', bytes: PNG, filename: '示意图' + tag + '.png', type: 'image/png' }]) });
  const attId = get(up.json, 'id');
  await a.patch('/notes/' + nid, { content: '正文\n\n![图](/api/attachments/' + attId + ')\n' });

  // 整库导出：看 md 在包内的相对引用
  const z = await a.get('/export/all');
  const entries = unzip(z.buf);
  const names = entries.map((e) => e.name);
  const mdName = names.find((x) => x.includes('前端笔记' + tag));
  const md = mdName ? entries.find((e) => e.name === mdName).data.toString('utf8') : '';
  const attNames = names.filter((x) => x.startsWith('attachments/'));
  log('整库导出条目示例: ' + JSON.stringify(names.slice(0, 6)));
  log('目标 md 路径: ' + mdName);
  log('md 内图片引用: ' + JSON.stringify(md.split('\n').filter((l) => l.includes('![')).join(' | ')));
  log('attachments 条目: ' + JSON.stringify(attNames.slice(0, 3)));

  // 把整库 zip 再导回来，检查图片是否被正确重写
  const fd = formWith({}, [{ field: 'file', bytes: z.buf, filename: 'all' + tag + '.zip', type: 'application/zip' }]);
  const r = await a.req('POST', '/import/markdown', { form: fd, timeout: 180000 });
  log('整库 zip 重新导入 -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 300));
  const q = await a.get('/search?q=' + encodeURIComponent('前端笔记' + tag));
  const items = (get(q.json, 'items') || []);
  log('导入后同名笔记数: ' + items.length + ' ids=' + JSON.stringify(items.map((x) => x.noteId || x.id)));
  for (const it of items.slice(0, 3)) {
    const d = await a.get('/notes/' + (it.noteId || it.id));
    log('  笔记 ' + (it.noteId || it.id) + ' 正文: ' + JSON.stringify(String(get(d.json, 'content')).slice(0, 80)));
  }
  // manifest
  const man = zipText(entries, 'manifest.json');
  log('manifest 片段: ' + JSON.stringify(String(man).slice(0, 200)));
}
main().catch((e) => { console.log('probe4 fail ' + ((e && e.stack) || e)); process.exit(1); });
