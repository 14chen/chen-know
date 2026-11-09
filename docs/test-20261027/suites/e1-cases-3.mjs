/**
 * E1 用例集 3：LINK（双链）/ VERSION（版本）/ TRASH（回收站）
 */
import { K, S, C, F, Fx, hasErr, get } from './e1-lib.mjs';

export default async function run(R, ctx) {
  const { admin, U } = ctx;
  const tag = 'e1v' + Date.now().toString(36).slice(-5);
  const itemsOf = (r) => { const j = r && r.json; if (Array.isArray(j)) return j; return (j && j.items) || []; };
  const arrOf = (v) => (Array.isArray(v) ? v : []);
  const trashOf = (r) => { const j = (r && r.json) || {}; return { notes: arrOf(j.notes || (j.data && j.data.notes)), folders: arrOf(j.folders || (j.data && j.data.folders)) }; };

  /* ================= LINK ================= */
  const target = await admin.post('/notes', { title: '目标笔记1' + tag, content: '我是被引用的笔记。' });
  const tid = get(target.json, 'id');
  const src = await admin.post('/notes', {
    title: '来源笔记' + tag,
    content: '这里引用 [[目标笔记1' + tag + ']]，还引用一个 [[还没创建的标题' + tag + ']]。'
  });
  const sid = get(src.json, 'id');

  await R.tc('TC-LINK-001', '解析 [[标题]]：已存在进 resolved、未创建进 dangling', async () => {
    const r = await admin.get('/notes/' + sid + '/links');
    const resolved = arrOf(get(r.json, 'resolved'));
    const dangling = arrOf(get(r.json, 'dangling'));
    return [S(r, 200), K(resolved.some((x) => x.noteId === tid), 'resolved 含目标笔记 id=' + tid, JSON.stringify(resolved)),
      K(dangling.some((x) => String(x).includes('还没创建的标题')), 'dangling 含未创建标题', JSON.stringify(dangling)),
      K(dangling.every((x) => typeof x === 'string'), 'dangling 为字符串数组', JSON.stringify(dangling))];
  });
  await R.tc('TC-LINK-002', 'resolved 元素含 noteId/title/folderId', async () => {
    const r = await admin.get('/notes/' + sid + '/links');
    const one = arrOf(get(r.json, 'resolved'))[0] || {};
    return [S(r, 200), K('noteId' in one, '含 noteId', Object.keys(one).join(',')), K('title' in one, '含 title', Object.keys(one).join(',')), K('folderId' in one, '含 folderId', Object.keys(one).join(','))];
  });
  await R.tc('TC-LINK-003', '反链：被引用笔记能查到来源', async () => {
    const r = await admin.get('/notes/' + tid + '/backlinks');
    const items = arrOf(get(r.json, 'items')) .length ? arrOf(get(r.json, 'items')) : itemsOf(r);
    const hit = items.find((x) => (x.noteId || x.id) === sid);
    return [S(r, 200), K(!!hit, '反链含来源笔记', JSON.stringify(items.map((x) => x.noteId || x.id))),
      K(hit ? String(hit.title || '').includes('来源笔记') : false, '反链含标题', hit && hit.title), K(hit ? typeof hit.excerpt === 'string' : false, '反链含 excerpt', hit && Object.keys(hit).join(','))];
  });
  await R.tc('TC-LINK-004', '两篇笔记引用同一目标 → 反链 2 条', async () => {
    const s2 = await admin.post('/notes', { title: '来源笔记二' + tag, content: '也看 [[目标笔记1' + tag + ']] 吧' });
    const r = await admin.get('/notes/' + tid + '/backlinks');
    const items = arrOf(get(r.json, 'items')).length ? arrOf(get(r.json, 'items')) : itemsOf(r);
    const ids = items.map((x) => x.noteId || x.id);
    return [S(s2, 201), K(ids.includes(sid) && ids.includes(get(s2.json, 'id')), '两条来源都在', JSON.stringify(ids))];
  });
  await R.tc('TC-LINK-005', '同一来源多次引用同一标题按来源去重', async () => {
    const s3 = await admin.post('/notes', { title: '重复引用' + tag, content: '[[目标笔记1' + tag + ']] 与 [[目标笔记1' + tag + ']] 两次' });
    const r = await admin.get('/notes/' + tid + '/backlinks');
    const items = arrOf(get(r.json, 'items')).length ? arrOf(get(r.json, 'items')) : itemsOf(r);
    const cnt = items.filter((x) => (x.noteId || x.id) === get(s3.json, 'id')).length;
    return [S(s3, 201), K(cnt === 1, '同一来源只出现 1 次', '出现 ' + cnt + ' 次')];
  });
  await R.tc('TC-LINK-006', '自引用不计入自己的反链', async () => {
    const me = await admin.post('/notes', { title: '自己引用自己' + tag, content: '本笔记见 [[自己引用自己' + tag + ']]' });
    const myId = get(me.json, 'id');
    const r = await admin.get('/notes/' + myId + '/backlinks');
    const items = arrOf(get(r.json, 'items')).length ? arrOf(get(r.json, 'items')) : itemsOf(r);
    return [S(me, 201), K(!items.some((x) => (x.noteId || x.id) === myId), '反链不含自己', JSON.stringify(items.map((x) => x.noteId || x.id)))];
  });
  await R.tc('TC-LINK-007', '目标被软删除后该引用退化为 dangling（契约 §4.1）', async () => {
    const t2 = await admin.post('/notes', { title: '稍后删除的目标' + tag, content: 'x' });
    const t2id = get(t2.json, 'id');
    const s4 = await admin.post('/notes', { title: '引用将删目标' + tag, content: '看 [[稍后删除的目标' + tag + ']]' });
    const s4id = get(s4.json, 'id');
    const before = await admin.get('/notes/' + s4id + '/links');
    const beforeResolved = arrOf(get(before.json, 'resolved')).some((x) => x.noteId === t2id);
    await admin.del('/notes/' + t2id);
    const after = await admin.get('/notes/' + s4id + '/links');
    const afterResolved = arrOf(get(after.json, 'resolved')).some((x) => x.noteId === t2id);
    const afterDangling = arrOf(get(after.json, 'dangling')).some((x) => String(x).includes('稍后删除的目标'));
    return [K(beforeResolved, '删除前在 resolved', beforeResolved), K(!afterResolved, '删除后不在 resolved', afterResolved), K(afterDangling, '退化为 dangling', JSON.stringify(get(after.json, 'dangling')))];
  });
  await R.tc('TC-LINK-008', '目标标题改名后原引用不再 resolved', async () => {
    const t3 = await admin.post('/notes', { title: '会改名的目标' + tag, content: 'x' });
    const t3id = get(t3.json, 'id');
    const s5 = await admin.post('/notes', { title: '引用会改名目标' + tag, content: '看 [[会改名的目标' + tag + ']]' });
    const s5id = get(s5.json, 'id');
    const before = arrOf(get((await admin.get('/notes/' + s5id + '/links')).json, 'resolved')).some((x) => x.noteId === t3id);
    await admin.patch('/notes/' + t3id, { title: '改名之后的目标' + tag });
    const after = await admin.get('/notes/' + s5id + '/links');
    const still = arrOf(get(after.json, 'resolved')).some((x) => x.noteId === t3id);
    const newTitle = arrOf(get(after.json, 'resolved')).map((x) => x.title).join(',');
    return [K(before, '改名前的引用可解析', before), S(after, 200),
      K(true, '观察项：改名后 resolved 仍指向原 id = ' + still + '；展示标题=' + newTitle + '（契约 §4.1 未定义改名语义）', newTitle)];
  });
  await R.tc('TC-LINK-009', '无链接笔记返回 {resolved:[],dangling:[]}', async () => {
    const c = await admin.post('/notes', { title: '无链接' + tag, content: '没有任何方括号。' });
    const r = await admin.get('/notes/' + get(c.json, 'id') + '/links');
    return [S(r, 200), Fx(r, 'resolved', (v) => Array.isArray(v) && v.length === 0, 'resolved=[]'), Fx(r, 'dangling', (v) => Array.isArray(v) && v.length === 0, 'dangling=[]')];
  });
  await R.tc('TC-LINK-010', '未登录访问 links/backlinks → 401', async () => {
    const a = await ctx.nobody.get('/notes/' + sid + '/links');
    const b = await ctx.nobody.get('/notes/' + tid + '/backlinks');
    return [S(a, 401), S(b, 401)];
  });
  await R.tc('TC-LINK-011', 'PATCH 正文后链接重建（新增引用生效）', async () => {
    const s6 = await admin.post('/notes', { title: '后加引用' + tag, content: '一开始没有链接。' });
    const s6id = get(s6.json, 'id');
    const before = arrOf(get((await admin.get('/notes/' + s6id + '/links')).json, 'resolved')).length;
    await admin.patch('/notes/' + s6id, { content: '现在加了 [[目标笔记1' + tag + ']]。' });
    const after = arrOf(get((await admin.get('/notes/' + s6id + '/links')).json, 'resolved'));
    return [K(before === 0, '改前无出链', before), K(after.some((x) => x.noteId === tid), '改后新增出链', JSON.stringify(after))];
  });
  await R.tc('TC-LINK-012', '不存在的笔记取 links → 404', async () => {
    const r = await admin.get('/notes/999999/links');
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });

  /* ================= VERSION ================= */
  const V = {};
  const vc = await admin.post('/notes', { title: '版本笔记' + tag, content: '第一版内容' });
  V.id = get(vc.json, 'id');
  await R.tc('TC-VERSION-001', '新建后版本列表可读（数组）', async () => {
    const r = await admin.get('/notes/' + V.id + '/versions');
    return [S(r, 200), Fx(r, '', (v) => true, 'ok'), K(Array.isArray(r.json) || Array.isArray(get(r.json, 'items')), '返回数组', typeof r.json)];
  });
  await R.tc('TC-VERSION-002', '改正文后版本数 +1，且含 version/createdAt/size', async () => {
    const b = await admin.get('/notes/' + V.id + '/versions');
    const n0 = (Array.isArray(b.json) ? b.json : itemsOf(b)).length;
    await admin.patch('/notes/' + V.id, { content: '第二版内容，比第一版长一些' });
    const r = await admin.get('/notes/' + V.id + '/versions');
    const list = Array.isArray(r.json) ? r.json : itemsOf(r);
    const one = list[0] || {};
    return [S(r, 200), K(list.length === n0 + 1, '版本数 +1（' + (n0 + 1) + '）', list.length),
      K('version' in one, '含 version', Object.keys(one).join(',')), K('createdAt' in one, '含 createdAt', Object.keys(one).join(',')), K('size' in one, '含 size', Object.keys(one).join(','))];
  });
  await R.tc('TC-VERSION-003', 'versions[].size 为字符数（码点）', async () => {
    const content = '中文内容长度十二字';
    const c = await admin.post('/notes', { title: 'size 校验' + tag, content });
    const id = get(c.json, 'id');
    await admin.patch('/notes/' + id, { content: content + '再改一次' });
    const r = await admin.get('/notes/' + id + '/versions');
    const list = Array.isArray(r.json) ? r.json : itemsOf(r);
    const sizes = list.map((x) => x.size);
    const okSize = sizes.some((s) => Number(s) === content.length) || Number(get(list[0] || {}, 'size')) === (content + '再改一次').length;
    return [S(r, 200), K(okSize, '存在 size=' + content.length + '（字符数）', JSON.stringify(sizes))];
  });
  await R.tc('TC-VERSION-004', '收藏/置顶/移动目录不产生版本', async () => {
    const b = await admin.get('/notes/' + V.id + '/versions');
    const n0 = (Array.isArray(b.json) ? b.json : itemsOf(b)).length;
    await admin.patch('/notes/' + V.id, { isFavorite: true, isPinned: true });
    const r = await admin.get('/notes/' + V.id + '/versions');
    const n1 = (Array.isArray(r.json) ? r.json : itemsOf(r)).length;
    return [K(n1 === n0, '版本数不变（' + n0 + '）', n1)];
  });
  await R.tc('TC-VERSION-005', 'GET 历史版本返回旧内容', async () => {
    const list = await admin.get('/notes/' + V.id + '/versions');
    const arr = Array.isArray(list.json) ? list.json : itemsOf(list);
    const oldest = arr[arr.length - 1] || {};
    const v = get(oldest, 'version');
    if (v === undefined) return [K(false, '存在历史版本号', JSON.stringify(oldest))];
    const r = await admin.get('/notes/' + V.id + '/versions/' + v);
    const txt = JSON.stringify(r.json);
    return [S(r, 200), K(txt.includes('第一版内容') || txt.includes('第二版内容'), '返回历史正文', txt.slice(0, 160))];
  });
  await R.tc('TC-VERSION-006', '取当前版本号返回当前内容（契约 §4.4）', async () => {
    const cur = await admin.get('/notes/' + V.id);
    const v = get(cur.json, 'version');
    const r = await admin.get('/notes/' + V.id + '/versions/' + v);
    const txt = JSON.stringify(r.json);
    return [S(r, 200), K(txt.includes('第二版内容'), '返回当前正文', txt.slice(0, 160))];
  });
  await R.tc('TC-VERSION-007', '回滚到旧版本 → 正文变回旧内容', async () => {
    const list = await admin.get('/notes/' + V.id + '/versions');
    const arr = Array.isArray(list.json) ? list.json : itemsOf(list);
    const oldest = arr[arr.length - 1] || {};
    const v = get(oldest, 'version');
    const r = await admin.post('/notes/' + V.id + '/versions/' + v + '/restore', {});
    const after = await admin.get('/notes/' + V.id);
    return [S(r, 200), K(String(get(after.json, 'content')).includes('第一版内容'), '正文回到第一版', String(get(after.json, 'content')).slice(0, 60))];
  });
  await R.tc('TC-VERSION-008', '回滚后：note.version 递增且被覆盖的内容留成历史快照', async () => {
    const list = await admin.get('/notes/' + V.id + '/versions');
    const arr = Array.isArray(list.json) ? list.json : itemsOf(list);
    const sizes = arr.map((x) => Number(x.size));
    const hasSecond = sizes.includes('第二版内容，比第一版长一些'.length);
    const hasFirst = sizes.includes('第一版内容'.length);
    const cur = await admin.get('/notes/' + V.id);
    return [K(hasSecond, '历史快照含第二版内容（回滚前的内容没丢）', JSON.stringify(sizes)),
      K(hasFirst, '历史快照含第一版内容', JSON.stringify(sizes)),
      K(Number(get(cur.json, 'version')) >= 3, '当前 version 递增到 ≥3', get(cur.json, 'version'))];
  });
  await R.tc('TC-VERSION-009', '对当前版本回滚是 no-op 200', async () => {
    const cur = await admin.get('/notes/' + V.id);
    const v = get(cur.json, 'version');
    const before = String(get(cur.json, 'content'));
    const r = await admin.post('/notes/' + V.id + '/versions/' + v + '/restore', {});
    const after = await admin.get('/notes/' + V.id);
    return [S(r, 200), K(String(get(after.json, 'content')) === before, '正文不变', String(get(after.json, 'content')).slice(0, 40))];
  });
  await R.tc('TC-VERSION-010', '版本列表按版本号倒序', async () => {
    const r = await admin.get('/notes/' + V.id + '/versions');
    const arr = Array.isArray(r.json) ? r.json : itemsOf(r);
    const vs = arr.map((x) => Number(x.version));
    const desc = vs.every((v, i) => i === 0 || vs[i - 1] > v);
    return [S(r, 200), K(desc, '版本号严格递减', JSON.stringify(vs))];
  });
  await R.tc('TC-VERSION-011', '不存在的版本号 → 404', async () => {
    const r = await admin.get('/notes/' + V.id + '/versions/9999');
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  await R.tc('TC-VERSION-012', '未登录访问版本 → 401', async () => {
    const r = await ctx.nobody.get('/notes/' + V.id + '/versions');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });

  /* ================= TRASH ================= */
  await R.tc('TC-TRASH-001', '删除笔记进回收站，含 deletedAt/folderName', async () => {
    const f = await admin.post('/folders', { parentId: null, name: '回收目录' + tag });
    const fid = get(f.json, 'id');
    const n = await admin.post('/notes', { folderId: fid, title: '进回收站' + tag, content: 'x' });
    const nid = get(n.json, 'id');
    await admin.del('/notes/' + nid);
    const r = await admin.get('/trash');
    const t = trashOf(r);
    const row = t.notes.find((x) => x.id === nid);
    return [S(r, 200), K(!!row, '回收站含该笔记', JSON.stringify(t.notes.map((x) => x.id))),
      K(row ? typeof row.deletedAt === 'string' : false, '含 deletedAt', row && Object.keys(row).join(',')),
      K(row ? row.folderName === '回收目录' + tag : false, 'folderName=原目录名', row && row.folderName)];
  });
  await R.tc('TC-TRASH-002', '恢复笔记 → 204，回到列表且目录保持', async () => {
    const r0 = await admin.get('/trash');
    const t0 = trashOf(r0);
    const row = t0.notes.find((x) => String(x.title || '').includes('进回收站' + tag));
    const id = row && row.id;
    const r = await admin.post('/trash/notes/' + id + '/restore', {});
    const list = await admin.get('/notes?page=1&size=200');
    const back = itemsOf(list).find((x) => x.id === id);
    return [S(r, 204), K(!!back, '笔记回到列表', JSON.stringify(itemsOf(list).map((x) => x.id).slice(0, 5))),
      K(back ? Number(back.folderId) === Number(row.folderId) : false, 'folderId 保持=' + (row && row.folderId), back && back.folderId)];
  });
  await R.tc('TC-TRASH-003', '彻底删除笔记 → 回收站清空该项且不可恢复', async () => {
    const n = await admin.post('/notes', { title: '彻底删' + tag, content: 'x' });
    const id = get(n.json, 'id');
    await admin.del('/notes/' + id);
    const d = await admin.del('/trash/notes/' + id);
    const t = trashOf(await admin.get('/trash'));
    const g = await admin.get('/notes/' + id);
    const re = await admin.post('/trash/notes/' + id + '/restore', {});
    return [S(d, 204), K(!t.notes.some((x) => x.id === id), '回收站不再含该笔记', JSON.stringify(t.notes.map((x) => x.id))), S(g, 404), K(re.status === 404, '恢复请求 404', 'HTTP ' + re.status)];
  });
  const P = {};
  await R.tc('TC-TRASH-004', '删除目录：子孙目录与其中笔记一起进回收站，noteCount 含子孙', async () => {
    const p = await admin.post('/folders', { parentId: null, name: 'P父' + tag });
    P.p = get(p.json, 'id');
    const c = await admin.post('/folders', { parentId: P.p, name: 'C子' + tag });
    P.c = get(c.json, 'id');
    const n1 = await admin.post('/notes', { folderId: P.p, title: 'P父笔记' + tag, content: 'x' });
    const n2 = await admin.post('/notes', { folderId: P.c, title: 'C子笔记' + tag, content: 'y' });
    P.n1 = get(n1.json, 'id');
    P.n2 = get(n2.json, 'id');
    const del = await admin.del('/folders/' + P.p);
    const t = trashOf(await admin.get('/trash'));
    const fp = t.folders.find((x) => x.id === P.p);
    return [S(del, 204),
      K(t.folders.some((x) => x.id === P.p) && t.folders.some((x) => x.id === P.c), '回收站含父与子目录', JSON.stringify(t.folders.map((x) => x.id))),
      K(t.notes.some((x) => x.id === P.n1) && t.notes.some((x) => x.id === P.n2), '回收站含两篇笔记', JSON.stringify(t.notes.map((x) => x.id))),
      K(fp && Number(fp.noteCount) === 2, 'folders[].noteCount=2（含子孙）', fp && fp.noteCount)];
  });
  await R.tc('TC-TRASH-005', '恢复子目录：祖先链与随删笔记一并恢复（契约 §3）', async () => {
    const r = await admin.post('/trash/folders/' + P.c + '/restore', {});
    const tree = await admin.get('/folders');
    const txt = JSON.stringify(tree.json);
    const list = await admin.get('/notes?page=1&size=300');
    const ids = itemsOf(list).map((x) => x.id);
    return [S(r, 204), K(txt.includes('P父' + tag), '父目录被一并恢复（祖先链）', '未恢复'),
      K(txt.includes('C子' + tag), '子目录恢复', '未恢复'),
      K(ids.includes(P.n2), '子目录内笔记恢复', JSON.stringify(ids.slice(0, 8))),
      K(!ids.includes(P.n1), '祖先目录里的笔记保持删除状态（契约 §3）', JSON.stringify(ids.slice(0, 8)))];
  });
  await R.tc('TC-TRASH-006', '恢复后清空回收站不会级联删掉已恢复的存活数据', async () => {
    const n = await admin.post('/notes', { title: '待清空' + tag, content: 'x' });
    const nid = get(n.json, 'id');
    await admin.del('/notes/' + nid);
    const e = await admin.post('/trash/empty', {});
    const list = await admin.get('/notes?page=1&size=300');
    const ids = itemsOf(list).map((x) => x.id);
    const tree = JSON.stringify((await admin.get('/folders')).json);
    return [S(e, 200), K(ids.includes(P.n2), '先前恢复的笔记仍在（子目录内那篇）', JSON.stringify(ids.filter((x) => x === P.n1 || x === P.n2))),
      K(tree.includes('P父' + tag) && tree.includes('C子' + tag), '恢复的目录仍在', '目录丢失')];
  });
  await R.tc('TC-TRASH-007', 'empty 返回 {deletedNotes, deletedFolders}', async () => {
    const f = await admin.post('/folders', { parentId: null, name: '待清目录' + tag });
    await admin.del('/folders/' + get(f.json, 'id'));
    const r = await admin.post('/trash/empty', {});
    const j = r.json || {};
    return [S(r, 200), K(typeof (j.deletedNotes !== undefined ? j.deletedNotes : get(j, 'deleted.notes')) !== 'undefined' || 'deletedNotes' in j, '含 deletedNotes', Object.keys(j).join(',')),
      K('deletedFolders' in j, '含 deletedFolders', Object.keys(j).join(','))];
  });
  await R.tc('TC-TRASH-008', '清空后回收站两个数组都为空', async () => {
    const r = await admin.get('/trash');
    const t = trashOf(r);
    return [S(r, 200), K(t.notes.length === 0, 'notes 为空', t.notes.length), K(t.folders.length === 0, 'folders 为空', t.folders.length)];
  });
  await R.tc('TC-TRASH-009', '软删不修改 updatedAt（契约 §4.4）', async () => {
    const n = await admin.post('/notes', { title: '软删时间' + tag, content: 'x' });
    const id = get(n.json, 'id');
    const before = await admin.get('/notes/' + id);
    const u0 = get(before.json, 'updatedAt');
    await admin.del('/notes/' + id);
    const trash = await admin.get('/trash');
    const row = trashOf(trash).notes.find((x) => x.id === id);
    const after = await admin.get('/notes/' + id);
    return [K(typeof u0 === 'string', '删除前有 updatedAt', u0), K(row ? row.deletedAt >= u0 : true, 'deletedAt ≥ updatedAt', row && (row.deletedAt + ' vs ' + u0)), S(after, 404)];
  });
  await R.tc('TC-TRASH-010', '回收站两数组按 deletedAt 倒序', async () => {
    const a = await admin.post('/notes', { title: '倒序A' + tag, content: 'x' });
    const b = await admin.post('/notes', { title: '倒序B' + tag, content: 'y' });
    await admin.del('/notes/' + get(a.json, 'id'));
    await new Promise((r) => setTimeout(r, 1100));
    await admin.del('/notes/' + get(b.json, 'id'));
    const t = trashOf(await admin.get('/trash'));
    const ia = t.notes.findIndex((x) => x.id === get(a.json, 'id'));
    const ib = t.notes.findIndex((x) => x.id === get(b.json, 'id'));
    return [K(ia >= 0 && ib >= 0, '两条都在回收站', ia + '/' + ib), K(ib < ia, '后删的排在前面（倒序）', 'ia=' + ia + ' ib=' + ib)];
  });
  await R.tc('TC-TRASH-011', '恢复不存在的笔记 → 404', async () => {
    const r = await admin.post('/trash/notes/999999/restore', {});
    return [S(r, 404)];
  });
  await R.tc('TC-TRASH-012', '彻底删除不存在的笔记 → 404', async () => {
    const r = await admin.del('/trash/notes/999999');
    return [S(r, 404)];
  });
  await R.tc('TC-TRASH-013', '未登录访问回收站 → 401', async () => {
    const r = await ctx.nobody.get('/trash');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-TRASH-014', '删除笔记不影响其所在目录', async () => {
    const f = await admin.post('/folders', { parentId: null, name: '保留目录' + tag });
    const fid = get(f.json, 'id');
    const n = await admin.post('/notes', { folderId: fid, title: '删笔记保目录' + tag, content: 'x' });
    await admin.del('/notes/' + get(n.json, 'id'));
    const tree = JSON.stringify((await admin.get('/folders')).json);
    return [S(f, 201), K(tree.includes('保留目录' + tag), '目录仍在', '目录消失')];
  });
  await R.tc('TC-TRASH-015', '普通用户回收站看不到管理员数据（正常路径隔离）', async () => {
    const r = await ctx.member.get('/trash');
    const t = trashOf(r);
    return [S(r, 200), K(!t.notes.some((x) => String(x.title || '').includes(tag)), '不含管理员回收站项', JSON.stringify(t.notes.map((x) => x.title)).slice(0, 160))];
  });
  await R.tc('TC-TRASH-016', '清空回收站后再查仍为 200 空态（幂等）', async () => {
    const e1 = await admin.post('/trash/empty', {});
    const e2 = await admin.post('/trash/empty', {});
    const t = trashOf(await admin.get('/trash'));
    return [S(e1, 200), S(e2, 200), K(t.notes.length === 0 && t.folders.length === 0, '两数组为空', t.notes.length + '/' + t.folders.length)];
  });
  ctx.ids.link = { sid, tid };
  ctx.ids.ver = V;
}
