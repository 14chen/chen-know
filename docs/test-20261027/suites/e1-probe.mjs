/**
 * E1 探针：核对 VERSION 相关接口的真实行为（契约 §4.4 与实现是否一致）
 */
import { Client, get, log } from './e1-lib.mjs';

async function main() {
  const a = new Client('probe');
  const lr = await a.login('e1admin', 'Passw0rd!23');
  log('login=' + lr.status);
  const c = await a.post('/notes', { title: '版本探针' + Date.now(), content: 'v1 内容' });
  const id = get(c.json, 'id');
  log('create note id=' + id + ' version=' + get(c.json, 'version'));
  await a.patch('/notes/' + id, { content: 'v2 内容长度变化' });
  const d = await a.get('/notes/' + id);
  log('after patch1 version=' + get(d.json, 'version'));
  let list = await a.get('/notes/' + id + '/versions');
  log('versions after patch1: ' + JSON.stringify(list.json));
  const cur = get(d.json, 'version');
  const gCur = await a.get('/notes/' + id + '/versions/' + cur);
  log('GET versions/' + cur + ' -> ' + gCur.status + ' ' + JSON.stringify(gCur.json).slice(0, 160));
  const rCur = await a.post('/notes/' + id + '/versions/' + cur + '/restore', {});
  log('POST restore current(' + cur + ') -> ' + rCur.status + ' ' + JSON.stringify(rCur.json).slice(0, 160));
  const v1 = (Array.isArray(list.json) ? list.json : list.json.items || []).slice(-1)[0];
  log('oldest version entry: ' + JSON.stringify(v1));
  const rOld = await a.post('/notes/' + id + '/versions/' + get(v1, 'version') + '/restore', {});
  log('POST restore oldest -> ' + rOld.status + ' ' + JSON.stringify(rOld.json).slice(0, 160));
  const after = await a.get('/notes/' + id);
  log('after restore version=' + get(after.json, 'version') + ' content=' + JSON.stringify(String(get(after.json, 'content')).slice(0, 40)));
  list = await a.get('/notes/' + id + '/versions');
  const arr = Array.isArray(list.json) ? list.json : list.json.items || [];
  log('versions after restore: ' + JSON.stringify(arr.map((x) => ({ v: x.version, size: x.size }))));
  // 额外探针：未登录（全新无 cookie 客户端）访问受保护接口
  const nobody = new Client('nobody');
  for (const p of ['/folders', '/notes', '/search?q=x', '/trash', '/stats', '/tags', '/recent', '/favorites']) {
    const r = await nobody.get(p);
    log('nobody GET ' + p + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 100));
  }
  const up = await nobody.req('POST', '/attachments', { form: (() => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from('x')], { type: 'text/plain' }), 'x.txt'); return fd; })() });
  log('nobody POST /attachments -> ' + up.status + ' ' + JSON.stringify(up.json).slice(0, 120));
  const nn = await nobody.post('/notes', { title: '匿名写', content: 'x' });
  log('nobody POST /notes -> ' + nn.status + ' ' + JSON.stringify(nn.json).slice(0, 120));
}
main().catch((e) => { console.log('probe fail ' + ((e && e.stack) || e)); process.exit(1); });
