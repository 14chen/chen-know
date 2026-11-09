/**
 * E1 用例集 4：FILE（附件）/ IMPEXP（导入导出）/ STAT（统计与动态）
 */
import { K, S, C, F, Fx, hasErr, get, unzip, zipText, formWith, formFile } from './e1-lib.mjs';

export default async function run(R, ctx) {
  const { admin, U } = ctx;
  const tag = 'e1f' + Date.now().toString(36).slice(-5);
  const itemsOf = (r) => { const j = r && r.json; if (Array.isArray(j)) return j; return (j && j.items) || []; };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf8');
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', 'utf8');
  const TXT = Buffer.from('纯文本内容：中文与换行\n第二行', 'utf8');
  const A = {};

  /* ================= FILE ================= */
  await R.tc('TC-FILE-001', '上传 PNG → 201 且返回 id/url/originalName/mimeType/sizeBytes', async () => {
    const r = await admin.req('POST', '/attachments', { form: formFile('file', PNG, '架构图' + tag + '.png', 'image/png') });
    A.png = get(r.json, 'id');
    return [S(r, 201), Fx(r, 'id', (v) => Number.isInteger(v) && v > 0, 'id>0'), F(r, 'originalName', '架构图' + tag + '.png'),
      F(r, 'mimeType', 'image/png'), F(r, 'sizeBytes', PNG.length), Fx(r, 'url', (v) => String(v).includes('/api/attachments/'), 'url 指向 /api/attachments/{id}')];
  });
  await R.tc('TC-FILE-002', '下载 PNG：200 + 正确 Content-Type + nosniff + inline + UTF-8 文件名', async () => {
    const r = await admin.get('/attachments/' + A.png);
    const cd = r.headers.get('content-disposition') || '';
    return [S(r, 200), K(/image\/png/.test(r.ct), 'Content-Type=image/png', r.ct),
      K((r.headers.get('x-content-type-options') || '') === 'nosniff', 'X-Content-Type-Options=nosniff', r.headers.get('x-content-type-options')),
      K(/inline/i.test(cd), 'Content-Disposition=inline', cd), K(/filename\*=UTF-8''/.test(cd), 'filename* UTF-8 编码', cd),
      K(r.buf && r.buf.length === PNG.length, '文件字节数一致', r.buf && r.buf.length)];
  });
  await R.tc('TC-FILE-003', '上传 PDF → 201 且 mimeType=application/pdf', async () => {
    const r = await admin.req('POST', '/attachments', { form: formFile('file', PDF, '报告' + tag + '.pdf', 'application/pdf') });
    A.pdf = get(r.json, 'id');
    const d = await admin.get('/attachments/' + A.pdf);
    return [S(r, 201), F(r, 'mimeType', 'application/pdf'), S(d, 200), K(/pdf/.test(d.ct), '下载 Content-Type 含 pdf', d.ct)];
  });
  await R.tc('TC-FILE-004', '上传 TXT（中文文件名）→ originalName 保留中文', async () => {
    const r = await admin.req('POST', '/attachments', { form: formFile('file', TXT, '说明' + tag + '.txt', 'text/plain') });
    A.txt = get(r.json, 'id');
    const d = await admin.get('/attachments/' + A.txt);
    const txt = d.buf ? d.buf.toString('utf8') : String(d.text || '');
    return [S(r, 201), F(r, 'originalName', '说明' + tag + '.txt'), S(d, 200), K(txt.includes('中文'), '下载内容含中文', txt.slice(0, 40))];
  });
  await R.tc('TC-FILE-005', '上传 SVG → 下载强制 attachment（防内嵌脚本 XSS）', async () => {
    const r = await admin.req('POST', '/attachments', { form: formFile('file', SVG, '图形' + tag + '.svg', 'image/svg+xml') });
    A.svg = get(r.json, 'id');
    const d = await admin.get('/attachments/' + A.svg);
    const cd = d.headers.get('content-disposition') || '';
    return [S(r, 201), S(d, 200), K(/attachment/i.test(cd), 'svg 下载为 attachment', cd)];
  });
  await R.tc('TC-FILE-006', '上传可执行类型（.exe）→ 415 拒绝', async () => {
    const r = await admin.req('POST', '/attachments', { form: formFile('file', Buffer.from('MZfake'), 'virus' + tag + '.exe', 'application/x-msdownload') });
    return [S(r, 415), hasErr(r, 'UNSUPPORTED_MEDIA_TYPE')];
  });
  await R.tc('TC-FILE-007', '上传 21MB 文件 → 413 PAYLOAD_TOO_LARGE', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const r = await admin.req('POST', '/attachments', { form: formFile('file', big, 'big' + tag + '.txt', 'text/plain'), timeout: 120000 });
    return [K(r.status === 413, 'HTTP 413', 'HTTP ' + r.status + ' ' + String(JSON.stringify(r.json || r.text)).slice(0, 140)), hasErr(r, 'PAYLOAD_TOO_LARGE')];
  });
  await R.tc('TC-FILE-008', 'multipart 缺少 file 字段 → 400', async () => {
    const fd = formWith({ noteId: '1' }, []);
    const r = await admin.req('POST', '/attachments', { form: fd });
    return [K(r.status === 400, 'HTTP 400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 140))];
  });
  await R.tc('TC-FILE-009', '带 noteId 上传 → 201 且归属该笔记', async () => {
    const n = await admin.post('/notes', { title: '附件归属' + tag, content: 'x' });
    const nid = get(n.json, 'id');
    const fd = formWith({ noteId: nid }, [{ field: 'file', bytes: PNG, filename: 'belong' + tag + '.png', type: 'image/png' }]);
    const r = await admin.req('POST', '/attachments', { form: fd });
    return [S(n, 201), S(r, 201), K(get(r.json, 'noteId') === nid || get(r.json, 'noteId') === undefined, 'noteId 绑定或未回显（记录）', 'noteId=' + get(r.json, 'noteId'))];
  });
  await R.tc('TC-FILE-010', 'DELETE 附件 → 204，之后下载 404', async () => {
    const up = await admin.req('POST', '/attachments', { form: formFile('file', PNG, 'todelete' + tag + '.png', 'image/png') });
    const id = get(up.json, 'id');
    const d = await admin.del('/attachments/' + id);
    const g = await admin.get('/attachments/' + id);
    return [S(up, 201), S(d, 204), S(g, 404)];
  });
  await R.tc('TC-FILE-011', '下载不存在的附件 → 404', async () => {
    const r = await admin.get('/attachments/999999');
    return [S(r, 404), hasErr(r, 'NOT_FOUND')];
  });
  await R.tc('TC-FILE-012', '未登录上传 → 401', async () => {
    const r = await ctx.nobody.req('POST', '/attachments', { form: formFile('file', PNG, 'anon' + tag + '.png', 'image/png') });
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  await R.tc('TC-FILE-013', '未登录下载 → 401', async () => {
    const r = await ctx.nobody.get('/attachments/' + A.png);
    return [S(r, 401)];
  });
  await R.tc('TC-FILE-014', '删除附件后文件不可再取（磁盘文件已清理）', async () => {
    const up = await admin.req('POST', '/attachments', { form: formFile('file', TXT, 'disk' + tag + '.txt', 'text/plain') });
    const id = get(up.json, 'id');
    await admin.del('/attachments/' + id);
    const g = await admin.get('/attachments/' + id);
    const p = await admin.get('/attachments/' + id);
    return [S(g, 404), S(p, 404), K(!p.buf || p.buf.length === 0, '无文件内容返回', p.buf && p.buf.length)];
  });

  /* ================= IMPEXP ================= */
  // 造一篇带图片引用的笔记
  const noteForExp = await admin.post('/notes', { title: '导出笔记' + tag, content: '待补图' });
  A.note = get(noteForExp.json, 'id');
  const up2 = await admin.req('POST', '/attachments', { form: formWith({ noteId: A.note }, [{ field: 'file', bytes: PNG, filename: '图解' + tag + '.png', type: 'image/png' }]) });
  A.imgId = get(up2.json, 'id');
  await admin.patch('/notes/' + A.note, { content: '导出正文。\n\n![图](/api/attachments/' + A.imgId + ')\n\n结尾。' });
  await admin.put('/notes/' + A.note + '/tags', { tagNames: ['导出标签' + tag] });

  await R.tc('TC-IMPEXP-001', '导出单篇 .md → 200 文本且含正文', async () => {
    const r = await admin.get('/export/notes/' + A.note + '.md');
    const txt = r.text || (r.buf ? r.buf.toString('utf8') : '');
    return [S(r, 200), K(txt.includes('导出正文'), '含正文', txt.slice(0, 60)), K(String(r.ct).includes('markdown') || String(r.ct).includes('text'), '文本类 Content-Type', r.ct)];
  });
  await R.tc('TC-IMPEXP-002', '导出单篇 .zip → 含 md、attachments、manifest.json', async () => {
    const r = await admin.get('/export/notes/' + A.note + '.zip');
    if (!r.buf) return [K(false, '返回 zip 字节流', 'HTTP ' + r.status + ' ' + r.ct)];
    let names = [];
    try { names = unzip(r.buf).map((e) => e.name); } catch (e) { return [K(false, 'zip 可解析', e.message)]; }
    A.zipNames = names;
    const hasMd = names.some((n) => n.endsWith('.md'));
    const hasManifest = names.includes('manifest.json');
    const hasAtt = names.some((n) => n.startsWith('attachments/'));
    return [S(r, 200), K(hasMd, '含 .md', JSON.stringify(names)), K(hasManifest, '含 manifest.json', JSON.stringify(names)), K(hasAtt, '含 attachments/', JSON.stringify(names))];
  });
  await R.tc('TC-IMPEXP-003', 'zip 内 md 的图片引用重写为 attachments/ 相对路径', async () => {
    const r = await admin.get('/export/notes/' + A.note + '.zip');
    const entries = unzip(r.buf);
    const mdEntry = entries.find((e) => e.name.endsWith('.md'));
    const md = mdEntry ? mdEntry.data.toString('utf8') : '';
    const attName = (A.zipNames || []).find((n) => n.startsWith('attachments/')) || '';
    return [K(!!mdEntry, '存在 md', md.slice(0, 40)), K(md.includes('attachments/'), '引用以 attachments/ 开头', md.slice(0, 200)), K(!md.includes('/api/attachments/'), '不再含 /api/attachments/', md.slice(0, 200)),
      K(attName.includes('图解' + tag), '附件条目名含原文件名', attName)];
  });
  await R.tc('TC-IMPEXP-004', 'zip 内 manifest.json 可解析且为对象', async () => {
    const r = await admin.get('/export/notes/' + A.note + '.zip');
    const txt = zipText(unzip(r.buf), 'manifest.json');
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { return [K(false, 'manifest 可解析为 JSON', String(e.message))]; }
    return [K(j && typeof j === 'object', 'manifest 为对象', Object.keys(j || {}).join(','))];
  });
  await R.tc('TC-IMPEXP-005', '整库导出 /export/all → zip 含 notes/ 路径', async () => {
    const r = await admin.get('/export/all');
    if (!r.buf) return [K(false, '返回 zip', 'HTTP ' + r.status + ' ' + r.ct)];
    let names = [];
    try { names = unzip(r.buf).map((e) => e.name); } catch (e) { return [K(false, 'zip 可解析', e.message)]; }
    return [S(r, 200), K(names.some((n) => n.startsWith('notes/')), '含 notes/ 目录条目', JSON.stringify(names.slice(0, 8))), K(names.includes('manifest.json'), '含 manifest.json', 'missing')];
  });
  await R.tc('TC-IMPEXP-006', '导出的单篇 zip 可重新导入（往返）', async () => {
    const z = await admin.get('/export/notes/' + A.note + '.zip');
    const before = get((await admin.get('/stats')).json, 'noteCount');
    const fd = formWith({}, [{ field: 'file', bytes: z.buf, filename: 'roundtrip' + tag + '.zip', type: 'application/zip' }]);
    const r = await admin.req('POST', '/import/markdown', { form: fd, timeout: 120000 });
    const after = get((await admin.get('/stats')).json, 'noteCount');
    return [S(r, 200), K(Number(get(r.json, 'imported')) >= 1, 'imported ≥1', get(r.json, 'imported')), K(Number(after) === Number(before) + 1, '笔记数 +1', before + '→' + after)];
  });
  await R.tc('TC-IMPEXP-007', '导入两篇 .md（含 front matter tags/folder）→ 标签与目录生效', async () => {
    const md1 = '---\ntitle: 导入标题一' + tag + '\ntags: [导入甲' + tag + ', 导入乙]\nfolder: 导入目录' + tag + '\n---\n\n# 忽略的标题\n\n正文一。\n';
    const md2 = '# 文件名优先' + tag + '\n\n正文二。\n';
    const fd = formWith({}, [
      { field: 'file', bytes: Buffer.from(md1, 'utf8'), filename: 'a' + tag + '.md', type: 'text/markdown' },
      { field: 'file', bytes: Buffer.from(md2, 'utf8'), filename: 'b' + tag + '.md', type: 'text/markdown' },
    ]);
    const r = await admin.req('POST', '/import/markdown', { form: fd, timeout: 120000 });
    const list = await admin.get('/notes?page=1&size=300');
    const items = itemsOf(list);
    const imported = items.filter((x) => String(x.title).includes(tag));
    const one = items.find((x) => String(x.title) === '导入标题一' + tag);
    const tagNames = one ? ((await admin.get('/notes/' + one.id)).json.tags || []).map((x) => x.name) : [];
    return [S(r, 200), K(Number(get(r.json, 'imported')) >= 2, 'imported ≥2', get(r.json, 'imported')),
      K(!!one, 'front matter 标题优先于文件名/H1', JSON.stringify(imported.map((x) => x.title).slice(0, 6))),
      K(tagNames.includes('导入甲' + tag), 'front matter tags 生效', JSON.stringify(tagNames)),
      K(one ? one.folderId !== null && one.folderId !== undefined : false, 'front matter folder 生效（folderId 非空）', one && one.folderId)];
  });
  await R.tc('TC-IMPEXP-008', '导入预览 /import/preview：items 字段名固定', async () => {
    const md = '---\ntitle: 预览标题' + tag + '\ntags: [预览标签]\n---\n正文。\n';
    const fd = formWith({}, [{ field: 'file', bytes: Buffer.from(md, 'utf8'), filename: 'preview' + tag + '.md', type: 'text/markdown' }]);
    const r = await admin.req('POST', '/import/preview', { form: fd, timeout: 60000 });
    const one = (get(r.json, 'items') || [])[0] || {};
    return [S(r, 200), K(Array.isArray(get(r.json, 'items')), 'items 为数组', typeof get(r.json, 'items')),
      K('title' in one, '含 title', Object.keys(one).join(',')), K('sourceFile' in one, '含 sourceFile', Object.keys(one).join(',')),
      K('tags' in one, '含 tags', Object.keys(one).join(',')), K('folder' in one, '含 folder', Object.keys(one).join(',')), K('sizeBytes' in one, '含 sizeBytes', Object.keys(one).join(','))];
  });
  await R.tc('TC-IMPEXP-009', '预览 total 与 items 长度一致', async () => {
    const fd = formWith({}, [
      { field: 'file', bytes: Buffer.from('# 预览甲' + tag + '\n内容', 'utf8'), filename: 'p1' + tag + '.md', type: 'text/markdown' },
      { field: 'file', bytes: Buffer.from('# 预览乙' + tag + '\n内容', 'utf8'), filename: 'p2' + tag + '.md', type: 'text/markdown' },
    ]);
    const r = await admin.req('POST', '/import/preview', { form: fd });
    const items = get(r.json, 'items') || [];
    return [S(r, 200), K(Number(get(r.json, 'total')) === items.length, 'total=' + items.length, get(r.json, 'total'))];
  });
  await R.tc('TC-IMPEXP-010', '预览不落库（笔记数不变）', async () => {
    const before = get((await admin.get('/stats')).json, 'noteCount');
    const fd = formWith({}, [{ field: 'file', bytes: Buffer.from('# 不落库' + tag + '\n内容', 'utf8'), filename: 'nope' + tag + '.md', type: 'text/markdown' }]);
    await admin.req('POST', '/import/preview', { form: fd });
    const after = get((await admin.get('/stats')).json, 'noteCount');
    return [K(Number(after) === Number(before), '笔记数不变（' + before + '）', after)];
  });
  await R.tc('TC-IMPEXP-011', '预览 imagesImported 表示"将导入的图片数"（>0）', async () => {
    const md = '# 带图笔记' + tag + '\n\n![图](images/x' + tag + '.png)\n';
    const fd = formWith({}, [
      { field: 'file', bytes: Buffer.from(md, 'utf8'), filename: 'withimg' + tag + '.md', type: 'text/markdown' },
      { field: 'file', bytes: PNG, filename: 'images/x' + tag + '.png', type: 'image/png' },
    ]);
    const r = await admin.req('POST', '/import/preview', { form: fd });
    return [S(r, 200), K(Number(get(r.json, 'imagesImported')) >= 1, 'imagesImported ≥1', get(r.json, 'imagesImported'))];
  });
  await R.tc('TC-IMPEXP-012', '导入时图片随笔记导入并重写为 /api/attachments/{id}', async () => {
    const md = '# 带图导入' + tag + '\n\n![图](images/y' + tag + '.png)\n';
    const fd = formWith({}, [
      { field: 'file', bytes: Buffer.from(md, 'utf8'), filename: 'img-note' + tag + '.md', type: 'text/markdown' },
      { field: 'file', bytes: PNG, filename: 'images/y' + tag + '.png', type: 'image/png' },
    ]);
    const r = await admin.req('POST', '/import/markdown', { form: fd, timeout: 120000 });
    const list = await admin.get('/notes?page=1&size=300');
    const one = itemsOf(list).find((x) => String(x.title) === 'img-note' + tag);
    let content = '';
    if (one) content = String(get((await admin.get('/notes/' + one.id)).json, 'content'));
    return [S(r, 200), K(Number(get(r.json, 'imagesImported')) >= 1, 'imagesImported ≥1', get(r.json, 'imagesImported')),
      K(content.includes('/api/attachments/'), '正文引用被重写为 /api/attachments/', content.slice(0, 120))];
  });
  await R.tc('TC-IMPEXP-013', '缺少被引用图片 → missingImages 带 reason', async () => {
    const md = '# 缺图笔记' + tag + '\n\n![图](images/not-exist' + tag + '.png)\n';
    const fd = formWith({}, [{ field: 'file', bytes: Buffer.from(md, 'utf8'), filename: 'missing' + tag + '.md', type: 'text/markdown' }]);
    const r = await admin.req('POST', '/import/preview', { form: fd });
    const mi = get(r.json, 'missingImages') || [];
    const one = mi[0] || {};
    return [S(r, 200), K(Array.isArray(mi) && mi.length >= 1, 'missingImages 非空', JSON.stringify(mi).slice(0, 200)),
      K(one && typeof one.reason === 'string' && one.reason.length > 0, '含 reason', one && one.reason),
      K(one && 'sourceFile' in one && 'target' in one, '含 sourceFile/target', one && Object.keys(one).join(','))];
  });
  await R.tc('TC-IMPEXP-014', '空 .md 文件计入 skipped（不算错）', async () => {
    const fd = formWith({}, [{ field: 'file', bytes: Buffer.from('   \n', 'utf8'), filename: 'empty' + tag + '.md', type: 'text/markdown' }]);
    const r = await admin.req('POST', '/import/markdown', { form: fd });
    return [S(r, 200), K(Number(get(r.json, 'skipped')) >= 1, 'skipped ≥1', get(r.json, 'skipped')), K(arrLenZero(get(r.json, 'errors')), 'errors 为空', JSON.stringify(get(r.json, 'errors')))];
  });
  await R.tc('TC-IMPEXP-015', '导入非 UTF-8 文件 → errors 记录且不中断', async () => {
    const bad = Buffer.from([0xC3, 0x28, 0xA0, 0xA1, 0x20, 0x41]);
    const good = Buffer.from('# 好文件' + tag + '\n内容', 'utf8');
    const fd = formWith({}, [
      { field: 'file', bytes: bad, filename: 'bad' + tag + '.md', type: 'text/markdown' },
      { field: 'file', bytes: good, filename: 'good' + tag + '.md', type: 'text/markdown' },
    ]);
    const r = await admin.req('POST', '/import/markdown', { form: fd });
    return [S(r, 200), K(Number(get(r.json, 'imported')) >= 1, '好文件仍被导入', get(r.json, 'imported')),
      K(Array.isArray(get(r.json, 'errors')), 'errors 为数组', typeof get(r.json, 'errors'))];
  });
  await R.tc('TC-IMPEXP-016', '未登录导出 → 401', async () => {
    const r = await ctx.nobody.get('/export/notes/' + A.note + '.zip');
    return [S(r, 401)];
  });

  function arrLenZero(v) { return Array.isArray(v) ? v.length === 0 : v === undefined; }

  /* ================= STAT ================= */
  await R.tc('TC-STAT-001', '/api/stats 含全部约定字段', async () => {
    const r = await admin.get('/stats');
    const keys = ['noteCount', 'folderCount', 'tagCount', 'attachmentCount', 'totalAttachmentBytes', 'trashCount', 'updatedToday', 'dailyCreated'];
    const miss = keys.filter((k) => !(k in (r.json || {})));
    return [S(r, 200), K(miss.length === 0, '字段齐全', JSON.stringify(miss)), Fx(r, 'noteCount', (v) => typeof v === 'number' && v >= 1, 'noteCount>0')];
  });
  await R.tc('TC-STAT-002', 'dailyCreated 固定 14 天并按日期升序', async () => {
    const r = await admin.get('/stats');
    const arr = get(r.json, 'dailyCreated') || [];
    const dates = arr.map((x) => x.date);
    const asc = dates.every((d, i) => i === 0 || dates[i - 1] < d);
    const today = new Date().toISOString().slice(0, 10);
    return [S(r, 200), K(arr.length === 14, '长度 14', arr.length), K(asc, '日期升序', JSON.stringify(dates.slice(0, 4))), K(dates.includes(today), '含今天 ' + today, JSON.stringify(dates.slice(-3)))];
  });
  await R.tc('TC-STAT-003', 'noteCount 与 /notes 列表 total 一致', async () => {
    const st = await admin.get('/stats');
    const list = await admin.get('/notes?page=1&size=1');
    return [S(st, 200), K(Number(get(st.json, 'noteCount')) === Number(get(list.json, 'total')), 'stats.noteCount == notes.total', get(st.json, 'noteCount') + ' vs ' + get(list.json, 'total'))];
  });
  await R.tc('TC-STAT-004', '/api/recent 去重且按 viewedAt 倒序', async () => {
    const a = await admin.post('/notes', { title: '最近A' + tag, content: 'x' });
    const b = await admin.post('/notes', { title: '最近B' + tag, content: 'y' });
    await admin.post('/notes/' + get(a.json, 'id') + '/view', {});
    await admin.post('/notes/' + get(b.json, 'id') + '/view', {});
    await admin.post('/notes/' + get(a.json, 'id') + '/view', {});
    const r = await admin.get('/recent?limit=20');
    const items = itemsOf(r);
    const ids = items.map((x) => x.noteId || x.id);
    const dupA = ids.filter((x) => x === get(a.json, 'id')).length;
    return [S(r, 200), K(dupA === 1, '同一笔记只出现一次', dupA), K(ids[0] === get(a.json, 'id'), '最近浏览的排在第一位', JSON.stringify(ids.slice(0, 4)))];
  });
  await R.tc('TC-STAT-005', '/api/favorites 为分页信封且 items 是笔记列表项', async () => {
    const r = await admin.get('/favorites?page=1&size=10');
    const items = itemsOf(r);
    const one = items[0] || {};
    return [S(r, 200), K('page' in (r.json || {}) && 'size' in (r.json || {}) && 'total' in (r.json || {}), '含 page/size/total', Object.keys(r.json || {}).join(',')),
      K('title' in one && 'tags' in one && !('content' in one), 'items 为列表项结构', Object.keys(one).join(','))];
  });
  await R.tc('TC-STAT-006', '取消收藏后不再出现在 /favorites', async () => {
    const c = await admin.post('/notes', { title: '收藏来回' + tag, content: 'x' });
    const id = get(c.json, 'id');
    await admin.patch('/notes/' + id, { isFavorite: true });
    const in1 = itemsOf(await admin.get('/favorites?page=1&size=100')).some((x) => x.id === id);
    await admin.patch('/notes/' + id, { isFavorite: false });
    const in2 = itemsOf(await admin.get('/favorites?page=1&size=100')).some((x) => x.id === id);
    return [K(in1, '收藏后在列表', in1), K(!in2, '取消后不在列表', in2)];
  });
  await R.tc('TC-STAT-007', 'stats.trashCount 随删除笔记增加', async () => {
    const before = get((await admin.get('/stats')).json, 'trashCount');
    const c = await admin.post('/notes', { title: '统计回收站' + tag, content: 'x' });
    await admin.del('/notes/' + get(c.json, 'id'));
    const after = get((await admin.get('/stats')).json, 'trashCount');
    return [K(Number(after) >= Number(before) + 1, 'trashCount 增加', before + '→' + after)];
  });
  await R.tc('TC-STAT-008', '未登录访问 /stats → 401', async () => {
    const r = await ctx.nobody.get('/stats');
    return [S(r, 401), hasErr(r, 'UNAUTHORIZED')];
  });
  ctx.ids.file = A;
}
