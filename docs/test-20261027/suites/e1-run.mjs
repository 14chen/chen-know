/**
 * E1 运行入口：启动实例后执行全部用例
 * 用法：node e1-run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client, Runner, EVID, RUNID, log, BASE, get, K } from './e1-lib.mjs';
import cases1 from './e1-cases-1.mjs';
import cases2 from './e1-cases-2.mjs';
import cases3 from './e1-cases-3.mjs';
import cases4 from './e1-cases-4.mjs';
import cases5 from './e1-cases-5.mjs';

const ADMIN_U = process.env.KB_ADMIN || 'e1admin';
const ADMIN_P = process.env.KB_ADMIN_PW || 'Passw0rd!23';
const MEMBER_U = process.env.KB_MEMBER || 'e1user';
const MEMBER_P = process.env.KB_MEMBER_PW || 'Passw0rd!23';

async function main() {
  log('# E1 API 测试 ' + new Date().toISOString() + '  BASE=' + BASE + '  RUNID=' + RUNID);
  const anon = new Client('anon');
  const health = await anon.get('/health');
  if (health.status !== 200) { log('!! 实例未就绪 HTTP ' + health.status); process.exit(2); }
  log('实例就绪：' + JSON.stringify(health.json));

  // 1) 首人注册（库空时免邀请码，成为 admin）
  const reg = await anon.post('/auth/register', { username: ADMIN_U, displayName: 'E1 管理员', password: ADMIN_P });
  log('首人注册：HTTP ' + reg.status + ' ' + JSON.stringify(reg.json).slice(0, 160));
  const admin = new Client('admin');
  const adminLogin = await admin.login(ADMIN_U, ADMIN_P);
  if (adminLogin.status !== 200) { log('!! 管理员登录失败 HTTP ' + adminLogin.status + ' ' + JSON.stringify(adminLogin.json)); process.exit(2); }
  const me = await admin.get('/auth/me');
  log('管理员登录成功 id=' + get(me.json, 'id') + ' role=' + get(me.json, 'role'));

  // 2) 普通用户（用管理员接口直接建，避免依赖邀请码流程之外的路径）
  const mk = await admin.post('/admin/users', { username: MEMBER_U, displayName: 'E1 普通用户', password: MEMBER_P, role: 'member' });
  log('创建普通用户：HTTP ' + mk.status + ' ' + JSON.stringify(mk.json).slice(0, 120));
  const member = new Client('member');
  const memberLogin = await member.login(MEMBER_U, MEMBER_P);
  if (memberLogin.status !== 200) { log('!! 普通用户登录失败 HTTP ' + memberLogin.status); process.exit(2); }

  const ctx = {
    anon, admin, member,
    nobody: new Client('nobody'),   // 永不登录，用于「未登录」断言
    anon2: new Client('anon2'), anon3: new Client('anon3'), anon4: new Client('anon4'),
    anon5: new Client('anon5'), anon6: new Client('anon6'), anon7: new Client('anon7'),
    ClientCtor: Client,
    U: {
      adminUsername: ADMIN_U, adminPassword: ADMIN_P,
      memberUsername: MEMBER_U, memberPassword: MEMBER_P,
      adminId: get(me.json, 'id'), memberId: get(mk.json, 'id'),
    },
    ids: {},
  };

  const R = new Runner();
  const meta = { runId: RUNID, base: BASE, startedAt: new Date().toISOString(), adminId: ctx.U.adminId, memberId: ctx.U.memberId };

  log('\n=== 用例集 1：AUTH / ADMIN / FOLDER ===');
  await cases1(R, ctx);
  log('\n=== 用例集 2：NOTE / SEARCH / TAG ===');
  await cases2(R, ctx);
  log('\n=== 用例集 3：LINK / VERSION / TRASH ===');
  await cases3(R, ctx);
  log('\n=== 用例集 4：FILE / IMPEXP / STAT ===');
  await cases4(R, ctx);
  log('\n=== 用例集 5：边界与契约补测 ===');
  await cases5(R, ctx);

  // 持久化锚点 + DB 级不变量检查（SCHEMA §4 的不变量在库侧再验一遍）
  const anchor = {
    noteTitle: '持久化锚点' + RUNID,
    adminUser: ADMIN_U, adminPw: ADMIN_P,
    sessionCookie: admin.cookies.get('KB_SESSION') || '',
    adminId: ctx.U.adminId,
  };
  const anchorNote = await admin.post('/notes', { title: anchor.noteTitle, content: '重启前写入：' + RUNID });
  anchor.noteId = get(anchorNote.json, 'id');
  const tagCreate = await admin.post('/tags', { name: '持久化标签' + RUNID, color: '#123456' });
  anchor.tagName = '持久化标签' + RUNID;
  fs.writeFileSync(path.join(EVID, 'e1-anchor.json'), JSON.stringify(anchor, null, 2));

  const DB_PATH = process.env.KB_DB || 'F:\\work\\test\\kb\\d-e1\\kb.db';
  let db = null;
  try { db = new DatabaseSync('file:' + DB_PATH + '?mode=ro', { readOnly: true }); } catch (e) { log('!! 打不开临时库：' + e.message); }
  const one = (sql, ...ps) => { try { return db.prepare(sql).get(...ps); } catch (e) { return { __err: e.message }; } };
  const all = (sql, ...ps) => { try { return db.prepare(sql).all(...ps); } catch (e) { return [{ __err: e.message }]; } };

  await R.tc('TC-NF-007', 'DB/全文索引：notes_fts MATCH 能命中中文短语（索引可用）', async () => {
    if (!db) return [K(false, '数据库可打开', DB_PATH)];
    const hit = all('SELECT n.id FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid WHERE notes_fts MATCH ?', '"重 启 前 写 入"');
    const ids = hit.map((x) => x.id);
    return [K(!hit.some((x) => x.__err), 'MATCH 查询无异常', JSON.stringify(hit)), K(ids.includes(anchor.noteId), '命中锚点笔记 id=' + anchor.noteId, JSON.stringify(ids.slice(0, 5)))];
  });
  await R.tc('TC-NF-008', 'DB/版本：note_versions 快照数 = notes.version-1（每次改动留版本）', async () => {
    if (!db) return [K(false, '数据库可打开', DB_PATH)];
    const vid = get(ctx.ids, 'ver.id');
    const n = one('SELECT id, version FROM notes WHERE id=?', vid);
    const c = one('SELECT COUNT(*) AS c FROM note_versions WHERE note_id=?', vid);
    return [K(!!n && !n.__err, '笔记存在 id=' + vid, JSON.stringify(n)), K(!!c && !c.__err, '版本表可查', JSON.stringify(c)),
      K(Number(get(c, 'c')) === Number(get(n, 'version')) - 1, '快照数=' + (Number(get(n, 'version')) - 1) + '（version=' + get(n, 'version') + '）', get(c, 'c'))];
  });
  await R.tc('TC-NF-009', 'DB/动态：activities 记录了 view 行为（/api/notes/{id}/view）', async () => {
    if (!db) return [K(false, '数据库可打开', DB_PATH)];
    const rows = all("SELECT note_id, action FROM activities WHERE action='view' ORDER BY id DESC LIMIT 5");
    return [K(rows.length >= 1 && !rows.some((x) => x.__err), '存在 view 记录', JSON.stringify(rows.slice(0, 3)))];
  });
  await R.tc('TC-NF-010', 'DB/软删除：deleted_at 非空且记录仍在 notes 表（与回收站一致）', async () => {
    if (!db) return [K(false, '数据库可打开', DB_PATH)];
    const c = one('SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NOT NULL');
    const t = await admin.get('/trash');
    const trashNotes = (get(t.json, 'notes') || []).length;
    return [K(Number(get(c, 'c')) >= 1, '库中有软删笔记', get(c, 'c')), K(Number(get(c, 'c')) >= trashNotes, '库中软删数 ≥ 回收站条数(' + trashNotes + ')', get(c, 'c'))];
  });
  await R.tc('TC-NF-011', 'DB/附件：stored_name 为 {spaceId}/{uuid}.{ext}，不含客户端文件名', async () => {
    if (!db) return [K(false, '数据库可打开', DB_PATH)];
    const rows = all('SELECT stored_name, original_name FROM attachments ORDER BY id DESC LIMIT 10');
    const bad = rows.filter((x) => x.__err || !/^\d+\/[0-9a-fA-F-]{32,36}\.[a-z0-9]+$/.test(String(x.stored_name)));
    const leaked = rows.filter((x) => !x.__err && String(x.stored_name).includes(String(x.original_name).replace(/\.[^.]+$/, '')));
    return [K(rows.length >= 1, '存在附件记录', rows.length), K(bad.length === 0, '存储名符合 {spaceId}/{uuid}.{ext}', JSON.stringify(bad.slice(0, 2))),
      K(leaked.length === 0, '存储名不含原始文件名', JSON.stringify(leaked.slice(0, 2)))];
  });
  if (db) { try { db.close(); } catch (e) {} }

  const sum = R.summary();
  log('\n=== 汇总 ===');
  for (const [m, s] of Object.entries(sum.by)) log('  ' + m + '：共 ' + s.total + '，通过 ' + s.pass + '，失败 ' + s.fail + '，阻塞 ' + s.blocked);
  log('  合计：' + sum.tot.total + '，通过 ' + sum.tot.pass + '，失败 ' + sum.tot.fail + '，阻塞 ' + sum.tot.blocked + '，耗时 ' + sum.ms + 'ms');

  const fails = R.cases.filter((c) => c.status !== 'pass');
  const summary = Object.assign({}, meta, { by: sum.by, tot: sum.tot, ms: sum.ms,
    nonPass: fails.map((c) => ({ id: c.id, module: c.module, title: c.title, status: c.status, expected: c.expected, actual: c.actual })) });
  fs.writeFileSync(path.join(EVID, 'e1-summary-' + RUNID + '.json'), JSON.stringify(summary, null, 2));

  log('已写入持久化锚点 noteId=' + anchor.noteId + '，等待重启验证');
  process.exit(sum.tot.fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('!! 运行失败：' + ((e && e.stack) || e)); process.exit(3); });
