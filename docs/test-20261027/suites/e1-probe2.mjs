/**
 * E1 探针：导入空文件与图片重写的真实行为
 */
import { Client, get, log, formWith } from './e1-lib.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const a = new Client('probe2');
  await a.login('e1admin', 'Passw0rd!23');
  const tag = 'pr' + Date.now().toString(36).slice(-5);

  // 1) 纯空白 .md
  const fd = formWith({}, [{ field: 'file', bytes: Buffer.from('   \n\n', 'utf8'), filename: 'empty' + tag + '.md', type: 'text/markdown' }]);
  const r = await a.req('POST', '/import/markdown', { form: fd });
  log('空文件导入 -> ' + r.status + ' ' + JSON.stringify(r.json));
  const list = await a.get('/notes?page=1&size=50&q=' + encodeURIComponent('empty' + tag));
  log('空文件是否落库（按标题搜）: ' + JSON.stringify((get(list.json, 'items') || []).map((x) => ({ id: x.id, title: x.title }))));

  // 2) 图片随笔记导入
  const md = '# 带图' + tag + '\n\n![图](images/z' + tag + '.png)\n';
  const fd2 = formWith({}, [
    { field: 'file', bytes: Buffer.from(md, 'utf8'), filename: 'img-note' + tag + '.md', type: 'text/markdown' },
    { field: 'file', bytes: PNG, filename: 'images/z' + tag + '.png', type: 'image/png' },
  ]);
  const r2 = await a.req('POST', '/import/markdown', { form: fd2 });
  log('带图导入 -> ' + r2.status + ' ' + JSON.stringify(r2.json));
  const l2 = await a.get('/notes?page=1&size=50&q=' + encodeURIComponent('img-note' + tag));
  const one = (get(l2.json, 'items') || [])[0];
  log('导入后笔记: ' + JSON.stringify(one && { id: one.id, title: one.title }));
  if (one) {
    const d = await a.get('/notes/' + one.id);
    log('正文: ' + JSON.stringify(String(get(d.json, 'content'))));
  }
  // 3) 预览同一批
  const fd3 = formWith({}, [
    { field: 'file', bytes: Buffer.from(md, 'utf8'), filename: 'img-note2' + tag + '.md', type: 'text/markdown' },
    { field: 'file', bytes: PNG, filename: 'images/z' + tag + '.png', type: 'image/png' },
  ]);
  const r3 = await a.req('POST', '/import/preview', { form: fd3 });
  log('预览 -> ' + r3.status + ' ' + JSON.stringify(r3.json));
}
main().catch((e) => { console.log('probe2 fail ' + ((e && e.stack) || e)); process.exit(1); });
