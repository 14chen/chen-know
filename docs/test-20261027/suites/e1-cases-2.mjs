/**
 * E1 用例集 2：NOTE（笔记）/ SEARCH（搜索）/ TAG（标签）
 */
import { K, S, C, F, Fx, hasErr, get, log } from './e1-lib.mjs';

export default async function run(R, ctx) {
  const { admin, member, U } = ctx;
  const tag = 'e1n' + Date.now().toString(36).slice(-5);
  const N = {};
  const BT = String.fromCharCode(96);
  const itemsOf = (r) => { const j = r && r.json; if (Array.isArray(j)) return j; return (j && j.items) || []; };

  /* ================= NOTE ================= */
  await R.tc('TC-NOTE-001', '创建最小笔记（无标题无正文）→ 201', async () => {
    const r = await admin.post('/notes', {});
    return [S(r, 201), Fx(r, 'id', (v) => Number.isInteger(v) && v > 0, 'id>0'), F(r, 'title', ''), F(r, 'content', '')];
  });
  await R.tc('TC-NOTE-002', '创建带标题/正文/目录的笔记 → 201', async () => {
    const folder = await admin.post('/folders', { parentId: null, name: '笔记目录' + tag });
    N.folder = get(folder.json, 'id');
    const r = await admin.post('/notes', { folderId: N.folder, title: '今天天气很好' + tag, content: '今天天气很好，适合出去散步。下午可能下雨。' });
    N.weather = get(r.json, 'id');
    return [S(r, 201), F(r, 'folderId', N.folder), F(r, 'title', '今天天气很好' + tag), Fx(r, 'version', (v) => Number(v) >= 1, 'version>=1')];
  });
  await R.tc('TC-NOTE-003', '列表不含正文 content 字段', async () => {
    const r = await admin.get('/notes?page=1&size=50');
    const items = itemsOf(r);
    const one = items[0] || {};
    return [S(r, 200), K(items.length > 0, 'items 非空', items.length), K(!('content' in one), '列表项无 content', JSON.stringify(Object.keys(one)))];
  });
  await R.tc('TC-NOTE-004', '详情含 content/tags/backlinkCount', async () => {
    const r = await admin.get('/notes/' + N.weather);
    return [S(r, 200), Fx(r, 'content', (v) => String(v).includes('适合出去散步'), 'content 有正文'), Fx(r, 'tags', (v) => Array.isArray(v), 'tags 为数组'), Fx(r, 'backlinkCount', (v) => typeof v === 'number', 'backlinkCount 为数字')];
  });
  await R.tc('TC-NOTE-005', 'PATCH 标题 → 200 且 version 递增', async () => {
    const before = await admin.get('/notes/' + N.weather);
    const v0 = get(before.json, 'version');
    const r = await admin.patch('/notes/' + N.weather, { title: '今天天气很好（改）' + tag });
    const after = await admin.get('/notes/' + N.weather);
    return [S(r, 200), F(after, 'title', '今天天气很好（改）' + tag), K(Number(get(after.json, 'version')) === Number(v0) + 1, 'version=' + (Number(v0) + 1), get(after.json, 'version'))];
  });
  await R.tc('TC-NOTE-006', 'PATCH 正文 → 200 且 version 递增', async () => {
    const before = await admin.get('/notes/' + N.weather);
    const v0 = get(before.json, 'version');
    const r = await admin.patch('/notes/' + N.weather, { content: '今天天气很好，适合出去散步。下午可能下雨。补充：记得带伞。' });
    const after = await admin.get('/notes/' + N.weather);
    return [S(r, 200), K(Number(get(after.json, 'version')) === Number(v0) + 1, 'version=' + (Number(v0) + 1), get(after.json, 'version'))];
  });
  await R.tc('TC-NOTE-007', 'PATCH 收藏 → 200 且不产生新版本（契约 §4.4）', async () => {
    const before = await admin.get('/notes/' + N.weather);
    const v0 = get(before.json, 'version');
    const r = await admin.patch('/notes/' + N.weather, { isFavorite: true });
    const after = await admin.get('/notes/' + N.weather);
    const versions = await admin.get('/notes/' + N.weather + '/versions');
    const vlist = Array.isArray(versions.json) ? versions.json : itemsOf(versions);
    return [S(r, 200), F(after, 'isFavorite', true), K(Number(get(after.json, 'version')) === Number(v0), 'version 不变=' + v0, get(after.json, 'version')),
      K(vlist.length <= Number(v0), '版本条数不超过 version（收藏未产生版本）', vlist.length)];
  });
  await R.tc('TC-NOTE-008', 'PATCH 置顶 → 200 且 isPinned=true', async () => {
    const r = await admin.patch('/notes/' + N.weather, { isPinned: true });
    const after = await admin.get('/notes/' + N.weather);
    return [S(r, 200), F(after, 'isPinned', true)];
  });
  await R.tc('TC-NOTE-009', 'PATCH sortOrder → 200', async () => {
    const r = await admin.patch('/notes/' + N.weather, { sortOrder: 5 });
    return [S(r, 200)];
  });
  await R.tc('TC-NOTE-010', '空 PATCH {} → 400 field=body', async () => {
    const r = await admin.patch('/notes/' + N.weather, {});
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED', 'body')];
  });
  await R.tc('TC-NOTE-011', 'folderId=0 只看未分类笔记', async () => {
    const uncat = await admin.post('/notes', { title: '未分类笔记' + tag, content: 'no folder' });
    const r = await admin.get('/notes?folderId=0&page=1&size=100');
    const items = itemsOf(r);
    const allNull = items.length > 0 && items.every((x) => x.folderId === null || x.folderId === 0);
    const hasUncat = items.some((x) => x.id === get(uncat.json, 'id'));
    return [S(uncat, 201), S(r, 200), K(hasUncat, '含刚建的未分类笔记', JSON.stringify(items.map((x) => x.folderId).slice(0, 8))), K(allNull, '全部 folderId 为 null/0', JSON.stringify(items.map((x) => x.folderId)))];
  });
  await R.tc('TC-NOTE-012', 'folderId=指定目录 只看该目录直属笔记', async () => {
    const r = await admin.get('/notes?folderId=' + N.folder + '&page=1&size=100');
    const items = itemsOf(r);
    return [S(r, 200), K(items.length > 0 && items.every((x) => Number(x.folderId) === Number(N.folder)), '全部属于该目录', JSON.stringify(items.map((x) => x.folderId)))];
  });
  await R.tc('TC-NOTE-013', '按 tag 过滤列表', async () => {
    await admin.put('/notes/' + N.weather + '/tags', { tagNames: ['天气' + tag] });
    const r = await admin.get('/notes?tag=' + encodeURIComponent('天气' + tag) + '&page=1&size=100');
    const items = itemsOf(r);
    return [S(r, 200), K(items.length >= 1 && items.some((x) => x.id === N.weather), '过滤结果含该笔记', items.length)];
  });
  await R.tc('TC-NOTE-014', 'favorite=true 只看收藏', async () => {
    const r = await admin.get('/notes?favorite=true&page=1&size=100');
    const items = itemsOf(r);
    return [S(r, 200), K(items.length >= 1 && items.every((x) => x.isFavorite === true), '全部为收藏', JSON.stringify(items.map((x) => x.isFavorite)))];
  });
  await R.tc('TC-NOTE-015', 'sort=title：非置顶分组内按标题升序', async () => {
    const r = await admin.get('/notes?sort=title&page=1&size=100');
    const items = itemsOf(r);
    const unpinned = items.filter((x) => !x.isPinned).map((x) => String(x.title || ''));
    const asc = unpinned.every((t, i) => i === 0 || unpinned[i - 1] <= t);
    const pinnedFirst = items.findIndex((x) => !x.isPinned);
    const allPinnedBefore = pinnedFirst === -1 || items.slice(pinnedFirst).every((x) => !x.isPinned);
    return [S(r, 200), K(unpinned.length > 1, '非置顶条目>1', unpinned.length), K(asc, '非置顶分组按标题升序', JSON.stringify(unpinned.slice(0, 6))),
      K(allPinnedBefore, '置顶全部排在非置顶之前', 'firstUnpinned=' + pinnedFirst)];
  });
  await R.tc('TC-NOTE-016', 'sort=created 可返回且不报错', async () => {
    const r = await admin.get('/notes?sort=created&page=1&size=10');
    return [S(r, 200), K(itemsOf(r).length > 0, 'items 非空', itemsOf(r).length)];
  });
  await R.tc('TC-NOTE-017', '置顶笔记始终排在前面（契约 §4.4）', async () => {
    const r = await admin.get('/notes?page=1&size=100&sort=updated');
    const items = itemsOf(r);
    const firstUnpinned = items.findIndex((x) => !x.isPinned);
    const lastPinned = items.reduce((acc, x, i) => (x.isPinned ? i : acc), -1);
    return [S(r, 200), K(items.length > 2, '条目>2', items.length), K(lastPinned < (firstUnpinned === -1 ? items.length : firstUnpinned), '置顶都在非置顶之前', 'lastPinned=' + lastPinned + ' firstUnpinned=' + firstUnpinned)];
  });
  await R.tc('TC-NOTE-018', '分页 page=2&size=2 生效', async () => {
    const p1 = await admin.get('/notes?page=1&size=2');
    const p2 = await admin.get('/notes?page=2&size=2');
    const i1 = itemsOf(p1).map((x) => x.id);
    const i2 = itemsOf(p2).map((x) => x.id);
    return [S(p1, 200), S(p2, 200), F(p1, 'page', 1), F(p1, 'size', 2), K(itemsOf(p1).length <= 2, '第 1 页 ≤2 条', itemsOf(p1).length), K(i1.join(',') !== i2.join(','), '两页内容不同', i1 + ' vs ' + i2)];
  });
  await R.tc('TC-NOTE-019', '非法分页 page=0 / size=abc 不 500', async () => {
    const a = await admin.get('/notes?page=0&size=10');
    const b = await admin.get('/notes?page=1&size=abc');
    return [K(a.status === 200 || a.status === 400, 'page=0 → 200/400', 'HTTP ' + a.status), K(b.status === 200 || b.status === 400, 'size=abc → 200/400', 'HTTP ' + b.status), K(a.status !== 500 && b.status !== 500, '不得 500', a.status + '/' + b.status)];
  });
  await R.tc('TC-NOTE-020', '分页 size=201（超上限 200）不 500', async () => {
    const r = await admin.get('/notes?page=1&size=201');
    const size = get(r.json, 'size');
    return [K(r.status === 200 || r.status === 400, '200/400', 'HTTP ' + r.status), K(r.status !== 200 || Number(size) <= 200, 'size 被截到 ≤200', 'size=' + size)];
  });
  await R.tc('TC-NOTE-021', '标题超过 512 字 → 400', async () => {
    const r = await admin.post('/notes', { title: 'T'.repeat(513), content: 'x' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-NOTE-022', '正文字符数超过 2MB → 400', async () => {
    const big = 'a'.repeat(2 * 1024 * 1024 + 16);
    const r = await admin.post('/notes', { title: '超大正文', content: big });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-NOTE-023', '不存在的笔记 → 404', async () => {
    const r = await admin.get('/notes/999999');
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  await R.tc('TC-NOTE-024', '非法 id（abc）不 500', async () => {
    const r = await admin.get('/notes/abc');
    return [K(r.status >= 400 && r.status < 500, '4xx', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 120))];
  });
  await R.tc('TC-NOTE-025', 'DELETE 笔记 → 204，详情 404', async () => {
    const c = await admin.post('/notes', { title: '待删' + tag, content: 'del me' });
    const id = get(c.json, 'id');
    const d = await admin.del('/notes/' + id);
    const g = await admin.get('/notes/' + id);
    return [S(c, 201), S(d, 204), S(g, 404)];
  });
  await R.tc('TC-NOTE-026', '未登录访问笔记 → 401', async () => {
    const r = await ctx.nobody.get('/notes');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-NOTE-027', 'excerpt 为剥离 Markdown 的纯文本片段', async () => {
    const md = '# 标题\n\n**加粗**与' + BT + '代码' + BT + '，链接[示例](https://x.y)。';
    const c = await admin.post('/notes', { title: '摘要素材' + tag, content: md.repeat(3) });
    const id = get(c.json, 'id');
    const r = await admin.get('/notes/' + id);
    const ex = String(get(r.json, 'excerpt') || '');
    const clean = !ex.includes('**') && !ex.includes(BT) && !ex.includes('](http');
    const hashLeak = ex.includes('# 标题');
    return [S(r, 200), K(ex.length > 0, 'excerpt 非空', ex.slice(0, 60)), K(clean, '剥离 ** / 反引号 / 链接 URL', ex.slice(0, 80)),
      K(true, '观察项：多行拼接后行首 # 是否残留 = ' + hashLeak, ex.slice(0, 100))];
  });
  await R.tc('TC-NOTE-028', 'POST /notes/{id}/view → 204 且进入 /recent', async () => {
    const v = await admin.post('/notes/' + N.weather + '/view', {});
    const rec = await admin.get('/recent?limit=20');
    const items = itemsOf(rec);
    const hit = items.find((x) => x.id === N.weather || x.noteId === N.weather);
    return [S(v, 204), S(rec, 200), K(!!hit, 'recent 含该笔记', JSON.stringify(items.slice(0, 2))), K(hit ? typeof (hit.viewedAt || hit.viewed_at) === 'string' : false, '含 viewedAt 时间字段', hit && Object.keys(hit).join(','))];
  });
  await R.tc('TC-NOTE-029', 'title 类型错误（对象）→ 400', async () => {
    const r = await admin.post('/notes', { title: { a: 1 }, content: 'x' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  await R.tc('TC-NOTE-030', '普通用户把笔记放进他人目录 → 404/403（正常路径隔离）', async () => {
    const r = await member.post('/notes', { folderId: N.folder, title: '越权目录' + tag, content: 'x' });
    return [K(r.status === 404 || r.status === 403, '404 或 403', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 140))];
  });

  /* ================= SEARCH ================= */
  const S1 = await admin.post('/notes', { title: '天空笔记' + tag, content: '天空中有一朵云，慢慢飘。' });
  const S2 = await admin.post('/notes', { title: '知识库搭建计划' + tag, content: '知识库的目录结构与全文检索设计。' });
  const S3 = await admin.post('/notes', { title: 'Spring Boot 笔记' + tag, content: 'Spring Boot 自动配置原理与条件注解。' });
  const S4 = await admin.post('/notes', { title: '搜索素材-不要命中' + tag, content: '这条只有汉字：天。' });
  const idS = { sky: get(S1.json, 'id'), kb: get(S2.json, 'id'), spring: get(S3.json, 'id'), only: get(S4.json, 'id') };
  const searchOf = (r) => itemsOf(r);

  await R.tc('TC-SEARCH-001', '1 字中文「天」可命中多条', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('天'));
    const items = searchOf(r);
    const ids = items.map((x) => x.noteId || x.id);
    return [S(r, 200), K(ids.includes(idS.sky), '命中「天空笔记」', JSON.stringify(ids.slice(0, 6))), K(ids.length >= 2, '命中 ≥2 条', ids.length)];
  });
  await R.tc('TC-SEARCH-002', '2 字中文「天气」按短语精确匹配', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('天气'));
    const ids = searchOf(r).map((x) => x.noteId || x.id);
    return [S(r, 200), K(ids.includes(N.weather), '命中天气笔记', JSON.stringify(ids)), K(!ids.includes(idS.only), '不含只出现「天」的笔记', '误命中')];
  });
  await R.tc('TC-SEARCH-003', '3 字中文「知识库」命中', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('知识库'));
    const ids = searchOf(r).map((x) => x.noteId || x.id);
    return [S(r, 200), K(ids.includes(idS.kb), '命中知识库笔记', JSON.stringify(ids))];
  });
  await R.tc('TC-SEARCH-004', '高亮结果带 <em> 标记', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('天气'));
    const one = searchOf(r)[0] || {};
    const blob = JSON.stringify(one);
    return [S(r, 200), K(blob.includes('<em>'), '含 <em> 高亮', blob.slice(0, 200)), K(!!(one.highlight || one.title), '含 highlight/title 字段', Object.keys(one).join(','))];
  });
  await R.tc('TC-SEARCH-005', '无匹配词 → total=0 且 items=[]', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('绝不存在的词zzz'));
    return [S(r, 200), F(r, 'total', 0), Fx(r, 'items', (v) => Array.isArray(v) && v.length === 0, 'items=[]')];
  });
  await R.tc('TC-SEARCH-006', 'q 为空退化为列表', async () => {
    const r = await admin.get('/search?q=');
    return [S(r, 200), K(searchOf(r).length > 0, 'items 非空', searchOf(r).length)];
  });
  await R.tc('TC-SEARCH-007', '搜索按 tag 过滤', async () => {
    await admin.put('/notes/' + idS.kb + '/tags', { tagNames: ['检索' + tag] });
    const r = await admin.get('/search?q=' + encodeURIComponent('知识库') + '&tag=' + encodeURIComponent('检索' + tag));
    const ids = searchOf(r).map((x) => x.noteId || x.id);
    return [S(r, 200), K(ids.length === 1 && ids[0] === idS.kb, '只命中带该标签的 1 条', JSON.stringify(ids))];
  });
  await R.tc('TC-SEARCH-008', '搜索按 folderId=0 过滤未分类', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('知识库') + '&folderId=0');
    const ids = searchOf(r).map((x) => x.noteId || x.id);
    return [S(r, 200), K(ids.includes(idS.kb), '未分类笔记可命中', JSON.stringify(ids)), K(!ids.includes(N.weather), '属于目录的不出现', JSON.stringify(ids))];
  });
  await R.tc('TC-SEARCH-009', '搜索分页 size=1 生效', async () => {
    const p1 = await admin.get('/search?q=' + encodeURIComponent('天') + '&page=1&size=1');
    const p2 = await admin.get('/search?q=' + encodeURIComponent('天') + '&page=2&size=1');
    return [S(p1, 200), F(p1, 'size', 1), K(searchOf(p1).length === 1, '第 1 页 1 条', searchOf(p1).length), K(JSON.stringify(p1.json) !== JSON.stringify(p2.json), '两页不同', 'same')];
  });
  await R.tc('TC-SEARCH-010', '已删除笔记不出现在搜索结果', async () => {
    const c = await admin.post('/notes', { title: '搜索待删' + tag, content: '独特词麒麟笔' + tag });
    const id = get(c.json, 'id');
    const before = await admin.get('/search?q=' + encodeURIComponent('麒麟笔' + tag));
    const del = await admin.del('/notes/' + id);
    const after = await admin.get('/search?q=' + encodeURIComponent('麒麟笔' + tag));
    return [S(before, 200), K(searchOf(before).length >= 1, '删除前可搜到', searchOf(before).length), S(del, 204), K(searchOf(after).length === 0, '删除后搜不到', searchOf(after).length)];
  });
  await R.tc('TC-SEARCH-011', '更新正文后：新词命中、旧词不命中', async () => {
    const c = await admin.post('/notes', { title: '词变更' + tag, content: '初稿包含词甲戌' + tag });
    const id = get(c.json, 'id');
    await admin.patch('/notes/' + id, { content: '改稿包含词乙亥' + tag });
    const oldQ = await admin.get('/search?q=' + encodeURIComponent('甲戌' + tag));
    const newQ = await admin.get('/search?q=' + encodeURIComponent('乙亥' + tag));
    return [K(searchOf(oldQ).length === 0, '旧词搜不到', searchOf(oldQ).length), K(searchOf(newQ).some((x) => (x.noteId || x.id) === id), '新词能搜到', JSON.stringify(searchOf(newQ).map((x) => x.noteId || x.id)))];
  });
  await R.tc('TC-SEARCH-012', '拉丁词大小写不敏感', async () => {
    const a = await admin.get('/search?q=Spring');
    const b = await admin.get('/search?q=spring');
    const ia = searchOf(a).map((x) => x.noteId || x.id);
    const ib = searchOf(b).map((x) => x.noteId || x.id);
    return [S(a, 200), S(b, 200), K(ia.includes(idS.spring) && ib.includes(idS.spring), '两种大小写都命中', ia.length + '/' + ib.length)];
  });
  await R.tc('TC-SEARCH-013', '查询含双引号不导致 500', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('"天气"'));
    return [K(r.status !== 500, '不得 500', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 120)), S(r, 200)];
  });
  await R.tc('TC-SEARCH-014', '结果含 score 与 folderId/updatedAt 字段', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('知识库'));
    const one = searchOf(r)[0] || {};
    return [S(r, 200), K('score' in one, '含 score', Object.keys(one).join(',')), K('folderId' in one, '含 folderId', Object.keys(one).join(',')), K('updatedAt' in one, '含 updatedAt', Object.keys(one).join(','))];
  });
  await R.tc('TC-SEARCH-015', '搜索 size 超上限 201 不 500 且被截断', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent('天') + '&size=201');
    const size = get(r.json, 'size');
    return [K(r.status === 200 || r.status === 400, '200/400', 'HTTP ' + r.status), K(r.status !== 200 || Number(size) <= 200, 'size ≤200', 'size=' + size)];
  });
  await R.tc('TC-SEARCH-016', '搜索未登录 → 401', async () => {
    const r = await ctx.nobody.get('/search?q=天气');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-SEARCH-017', '跨标点子串「天气」在「天气，很好」中命中', async () => {
    const c = await admin.post('/notes', { title: '标点测试' + tag, content: '今天的天气，很好。' });
    const id = get(c.json, 'id');
    const r = await admin.get('/search?q=' + encodeURIComponent('天气'));
    const ids = searchOf(r).map((x) => x.noteId || x.id);
    return [S(c, 201), K(ids.includes(id), '命中该笔记', JSON.stringify(ids))];
  });
  await R.tc('TC-SEARCH-018', '搜索结果不返回他人空间的笔记（正常路径）', async () => {
    const r = await member.get('/search?q=' + encodeURIComponent('知识库'));
    const ids = searchOf(r).map((x) => x.noteId || x.id);
    return [S(r, 200), K(!ids.includes(idS.kb), '不含管理员笔记', JSON.stringify(ids))];
  });

  /* ================= TAG ================= */
  const T = {};
  await R.tc('TC-TAG-001', '创建标签 → 201 含 name/color', async () => {
    const r = await admin.post('/tags', { name: '标签甲' + tag, color: '#ff0000' });
    T.a = get(r.json, 'id');
    return [S(r, 201), F(r, 'name', '标签甲' + tag), F(r, 'color', '#ff0000')];
  });
  await R.tc('TC-TAG-002', '不传颜色时使用默认色', async () => {
    const r = await admin.post('/tags', { name: '标签乙' + tag });
    T.b = get(r.json, 'id');
    return [S(r, 201), K(typeof get(r.json, 'color') === 'string' && String(get(r.json, 'color')).startsWith('#'), '默认色为 #RRGGBB', get(r.json, 'color'))];
  });
  await R.tc('TC-TAG-003', '重名标签（大小写不敏感）→ 409', async () => {
    const r = await admin.post('/tags', { name: ('标签甲' + tag).toUpperCase() });
    return [S(r, 409), hasErr(r, 'CONFLICT')];
  });
  await R.tc('TC-TAG-004', '标签列表为数组且含 count', async () => {
    const r = await admin.get('/tags');
    const arr = Array.isArray(r.json) ? r.json : itemsOf(r);
    const one = arr[0] || {};
    return [S(r, 200), K(arr.length > 0, '非空', arr.length), K('count' in one, '含 count', Object.keys(one).join(','))];
  });
  await R.tc('TC-TAG-005', 'PATCH 标签改名 → 200 且生效', async () => {
    const r = await admin.patch('/tags/' + T.b, { name: '标签乙改名' + tag });
    const list = await admin.get('/tags');
    const arr = Array.isArray(list.json) ? list.json : itemsOf(list);
    return [S(r, 200), K(arr.some((x) => x.id === T.b && x.name === '标签乙改名' + tag), '列表中已改名', JSON.stringify(arr.filter((x) => x.id === T.b)))];
  });
  await R.tc('TC-TAG-006', 'PATCH 标签改色 → 200 且生效', async () => {
    const r = await admin.patch('/tags/' + T.b, { color: '#00aa88' });
    const list = await admin.get('/tags');
    const arr = Array.isArray(list.json) ? list.json : itemsOf(list);
    const row = arr.find((x) => x.id === T.b);
    return [S(r, 200), K(row && row.color === '#00aa88', 'color=#00aa88', row && row.color)];
  });
  await R.tc('TC-TAG-007', 'PUT 笔记标签：覆盖式设置并返回笔记详情', async () => {
    const r = await admin.put('/notes/' + idS.kb + '/tags', { tagNames: ['检索' + tag, '标签乙改名' + tag] });
    const tags = get(r.json, 'tags') || [];
    return [S(r, 200), K(Array.isArray(tags) && tags.length === 2, 'tags 为 2 个', JSON.stringify(tags.map((x) => x.name))), K('content' in (r.json || {}), '返回的是笔记详情（含 content）', Object.keys(r.json || {}).join(','))];
  });
  await R.tc('TC-TAG-008', 'PUT 笔记标签：不存在的标签自动创建', async () => {
    const name = '自动创建' + tag;
    const r = await admin.put('/notes/' + idS.sky + '/tags', { tagNames: [name] });
    const list = await admin.get('/tags');
    const arr = Array.isArray(list.json) ? list.json : itemsOf(list);
    return [S(r, 200), K(arr.some((x) => x.name === name), '标签已自动创建', JSON.stringify(arr.map((x) => x.name).slice(0, 8)))];
  });
  await R.tc('TC-TAG-009', 'tag 的 count 反映未删除笔记数', async () => {
    const name = '计数标签' + tag;
    const c1 = await admin.post('/notes', { title: '计数1' + tag, content: 'x' });
    const c2 = await admin.post('/notes', { title: '计数2' + tag, content: 'y' });
    await admin.put('/notes/' + get(c1.json, 'id') + '/tags', { tagNames: [name] });
    await admin.put('/notes/' + get(c2.json, 'id') + '/tags', { tagNames: [name] });
    const l1 = await admin.get('/tags');
    const a1 = (Array.isArray(l1.json) ? l1.json : itemsOf(l1)).find((x) => x.name === name);
    await admin.del('/notes/' + get(c2.json, 'id'));
    const l2 = await admin.get('/tags');
    const a2 = (Array.isArray(l2.json) ? l2.json : itemsOf(l2)).find((x) => x.name === name);
    return [K(a1 && a1.count === 2, '初始 count=2', a1 && a1.count), K(a2 && a2.count === 1, '删一篇后 count=1', a2 && a2.count)];
  });
  await R.tc('TC-TAG-010', 'DELETE 标签 → 204，且从笔记详情解除', async () => {
    const name = '待删标签' + tag;
    const c = await admin.post('/notes', { title: '挂标签' + tag, content: 'x' });
    const id = get(c.json, 'id');
    await admin.put('/notes/' + id + '/tags', { tagNames: [name] });
    const list = await admin.get('/tags');
    const row = (Array.isArray(list.json) ? list.json : itemsOf(list)).find((x) => x.name === name);
    const del = await admin.del('/tags/' + get(row, 'id'));
    const note = await admin.get('/notes/' + id);
    const names = (get(note.json, 'tags') || []).map((x) => x.name);
    return [S(del, 204), K(!names.includes(name), '笔记已解除该标签', JSON.stringify(names))];
  });
  await R.tc('TC-TAG-011', 'PATCH 不存在的标签 → 404', async () => {
    const r = await admin.patch('/tags/999999', { name: 'x' + tag });
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  await R.tc('TC-TAG-012', '创建标签名称为空 → 400', async () => {
    const r = await admin.post('/tags', { name: '' });
    return [S(r, 400), hasErr(r, 'VALIDATION_FAILED')];
  });
  ctx.ids = { N, idS, T };
}
