/**
 * E1 重启后持久化验证：start → 建数据 → stop → start → 查
 * 用法：node e1-persist.mjs   （在实例重启之后运行）
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client, Runner, EVID, BASE, get, log } from './e1-lib.mjs';

const anchorFile = path.join(EVID, 'e1-anchor.json');

async function main() {
  const anchor = JSON.parse(fs.readFileSync(anchorFile, 'utf8'));
  const R = new Runner();
  const anon = new Client('anon-p');
  const admin = new Client('admin-p');

  await R.tc('TC-NF-001', '重启后实例可访问：/api/health 200 且 db=ok', async () => {
    const r = await anon.get('/health');
    return [{ ok: r.status === 200, expected: 'HTTP 200', actual: 'HTTP ' + r.status }, { ok: get(r.json, 'db') === 'ok', expected: 'db=ok', actual: String(get(r.json, 'db')) }];
  });
  await R.tc('TC-NF-002', '重启后账号仍可登录（SQLite 持久化）', async () => {
    const r = await admin.login(anchor.adminUser, anchor.adminPw);
    return [{ ok: r.status === 200, expected: 'HTTP 200', actual: 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160) }];
  });
  await R.tc('TC-NF-003', '重启后重启前创建的笔记仍存在（标题与正文一致）', async () => {
    const r = await admin.get('/notes/' + anchor.noteId);
    return [{ ok: r.status === 200, expected: 'HTTP 200', actual: 'HTTP ' + r.status },
      { ok: get(r.json, 'title') === anchor.noteTitle, expected: 'title=' + anchor.noteTitle, actual: String(get(r.json, 'title')) },
      { ok: String(get(r.json, 'content') || '').includes('重启前写入'), expected: 'content 含"重启前写入"', actual: String(get(r.json, 'content')).slice(0, 60) }];
  });
  await R.tc('TC-NF-004', '重启后重启前创建的标签仍在', async () => {
    const r = await admin.get('/tags');
    const arr = Array.isArray(r.json) ? r.json : (get(r.json, 'items') || []);
    return [{ ok: arr.some((x) => x.name === anchor.tagName), expected: '含标签 ' + anchor.tagName, actual: JSON.stringify(arr.map((x) => x.name).slice(0, 6)) }];
  });
  await R.tc('TC-NF-005', '重启后旧会话 Cookie 的处置（记录实际：401 需重登 / 200 仍有效）', async () => {
    const c = new Client('oldsess');
    if (anchor.sessionCookie) c.cookies.set('KB_SESSION', anchor.sessionCookie);
    const r = await c.get('/auth/me');
    return [{ ok: r.status === 200 || r.status === 401, expected: 'HTTP 200 或 401（不得 500）', actual: 'HTTP ' + r.status + ' body=' + JSON.stringify(r.json).slice(0, 120) }];
  });
  await R.tc('TC-NF-006', '重启后全量检索仍可用（FTS5 索引持久化）', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('重启前写入'));
    const items = Array.isArray(r.json) ? r.json : (get(r.json, 'items') || []);
    return [{ ok: r.status === 200, expected: 'HTTP 200', actual: 'HTTP ' + r.status },
      { ok: items.length >= 1, expected: '命中 ≥1 条', actual: items.length }];
  });

  const sum = R.summary();
  log('\n=== 持久化汇总 ===');
  for (const [m, s] of Object.entries(sum.by)) log('  ' + m + '：共 ' + s.total + '，通过 ' + s.pass + '，失败 ' + s.fail);
  fs.writeFileSync(path.join(EVID, 'e1-persist-' + anchor.noteId + '.json'), JSON.stringify({ by: sum.by, tot: sum.tot, cases: R.cases }, null, 2));
  process.exit(sum.tot.fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('!! 持久化检查失败：' + ((e && e.stack) || e)); process.exit(3); });
