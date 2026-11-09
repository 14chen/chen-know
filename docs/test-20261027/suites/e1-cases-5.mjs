/**
 * E1 用例集 5：边界与契约补测（请求体上限、分页越界、highlight 原文、导出排除未引用附件、白名单格式等）
 */
import { K, S, C, F, Fx, hasErr, get, unzip, formWith, formFile } from './e1-lib.mjs';

export default async function run(R, ctx) {
  const { admin, member } = ctx;
  const tag = 'e1x' + Date.now().toString(36).slice(-5);
  const itemsOf = (r) => { const j = r && r.json; if (Array.isArray(j)) return j; return (j && j.items) || []; };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');

  await R.tc('TC-NOTE-031', '非 multipart 请求体超 8MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const huge = 'b'.repeat(9 * 1024 * 1024);
    const r = await admin.req('POST', '/notes', { body: { title: '超大请求体', content: huge }, timeout: 120000 });
    return [K(r.status === 413, 'HTTP 413', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json || {}).slice(0, 160)), hasErr(r, 'PAYLOAD_TOO_LARGE')];
  });
  await R.tc('TC-NOTE-032', '分页 page 超出总页数 → items 为空且 total 不变', async () => {
    const base = await admin.get('/notes?page=1&size=2');
    const far = await admin.get('/notes?page=9999&size=2');
    return [S(base, 200), S(far, 200), K(itemsOf(far).length === 0, 'items 为空', itemsOf(far).length),
      K(Number(get(far.json, 'total')) === Number(get(base.json, 'total')), 'total 一致', get(base.json, 'total') + ' vs ' + get(far.json, 'total'))];
  });
  await R.tc('TC-NOTE-033', 'folderId 非数字（abc）→ 400 或按无过滤处理（记录实际）', async () => {
    const r = await admin.get('/notes?folderId=abc');
    return [K(r.status === 200 || r.status === 400, '200/400', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json || {}).slice(0, 140))];
  });
  await R.tc('TC-NOTE-034', 'folderId 负数（-1）不 500', async () => {
    const r = await admin.get('/notes?folderId=-1');
    return [K(r.status !== 500, '不得 500', 'HTTP ' + r.status)];
  });
  await R.tc('TC-SEARCH-019', 'highlight 在原文上计算（不含逐字加空格的 FTS blob）', async () => {
    const c = await admin.post('/notes', { title: '高亮原文' + tag, content: '今天天气很好，适合出去散步。' });
    const r = await admin.get('/search?q=' + encodeURIComponent('天气'));
    const one = itemsOf(r).find((x) => (x.noteId || x.id) === get(c.json, 'id')) || {};
    const hl = String(one.highlight || '');
    const blobLike = /今 天 天 气/.test(hl) || /天 气 很/.test(hl);
    return [S(r, 200), K(hl.includes('<em>'), '含 <em> 高亮', hl.slice(0, 120)), K(!blobLike, '不是逐字加空格的 blob', hl.slice(0, 120)),
      K(hl.includes('，') || hl.includes('。') || hl.includes('散步'), '保留原文标点/上下文', hl.slice(0, 120))];
  });
  await R.tc('TC-SEARCH-020', 'q 为单个空格 → 200 不报错', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent(' '));
    return [S(r, 200)];
  });
  await R.tc('TC-TAG-013', '没有笔记的标签仍返回且 count=0（契约 §4.3）', async () => {
    const name = '空标签' + tag;
    const c = await admin.post('/tags', { name });
    const r = await admin.get('/tags');
    const arr = Array.isArray(r.json) ? r.json : itemsOf(r);
    const row = arr.find((x) => x.name === name);
    return [S(c, 201), K(!!row, '列表中仍返回该标签', JSON.stringify(arr.map((x) => x.name).slice(-4))), K(row && Number(row.count) === 0, 'count=0', row && row.count)];
  });
  await R.tc('TC-FILE-015', '白名单内 GIF 可上传 → 201', async () => {
    const r = await admin.req('POST', '/attachments', { form: formFile('file', GIF, '动图' + tag + '.gif', 'image/gif') });
    return [S(r, 201), F(r, 'mimeType', 'image/gif')];
  });
  await R.tc('TC-FILE-016', '普通用户不能下载管理员空间的附件（正常路径隔离）', async () => {
    const up = await admin.req('POST', '/attachments', { form: formFile('file', PNG, 'admin-only' + tag + '.png', 'image/png') });
    const id = get(up.json, 'id');
    const r = await member.get('/attachments/' + id);
    return [S(up, 201), K(r.status === 404 || r.status === 403, '404/403', 'HTTP ' + r.status + ' ' + JSON.stringify(r.json || {}).slice(0, 140))];
  });
  await R.tc('TC-IMPEXP-017', '单篇导出只打包正文实际引用的附件（不打包未引用）', async () => {
    const n = await admin.post('/notes', { title: '排除未引用' + tag, content: '待补' });
    const id = get(n.json, 'id');
    const up1 = await admin.req('POST', '/attachments', { form: formWith({ noteId: id }, [{ field: 'file', bytes: PNG, filename: 'used' + tag + '.png', type: 'image/png' }]) });
    const up2 = await admin.req('POST', '/attachments', { form: formWith({ noteId: id }, [{ field: 'file', bytes: PNG, filename: 'unused' + tag + '.png', type: 'image/png' }]) });
    const usedId = get(up1.json, 'id');
    await admin.patch('/notes/' + id, { content: '正文只引用一张：![a](/api/attachments/' + usedId + ')' });
    const z = await admin.get('/export/notes/' + id + '.zip');
    const names = unzip(z.buf).map((e) => e.name);
    const atts = names.filter((x) => x.startsWith('attachments/'));
    return [S(z, 200), K(atts.length === 1, '只含 1 个附件条目', JSON.stringify(atts)),
      K(atts[0] && atts[0].includes('used' + tag), '打包的是被引用的那张', JSON.stringify(atts)),
      K(!names.some((x) => x.includes('unused' + tag)), '未引用的未打包', JSON.stringify(names))];
  });
  await R.tc('TC-IMPEXP-018', '导出附件条目名形如 {id}-{原名}', async () => {
    const n = await admin.post('/notes', { title: '命名规则' + tag, content: '待补' });
    const id = get(n.json, 'id');
    const up = await admin.req('POST', '/attachments', { form: formWith({ noteId: id }, [{ field: 'file', bytes: PNG, filename: '命名' + tag + '.png', type: 'image/png' }]) });
    const attId = get(up.json, 'id');
    await admin.patch('/notes/' + id, { content: '![x](/api/attachments/' + attId + ')' });
    const z = await admin.get('/export/notes/' + id + '.zip');
    const name = (unzip(z.buf).map((e) => e.name).filter((x) => x.startsWith('attachments/')) || [])[0] || '';
    return [S(z, 200), K(name === 'attachments/' + attId + '-命名' + tag + '.png', '条目名=' + 'attachments/' + attId + '-命名' + tag + '.png', name)];
  });
  await R.tc('TC-STAT-009', '/recent?limit=500 不 500（记录上限行为）', async () => {
    const r = await admin.get('/recent?limit=500');
    const arr = itemsOf(r);
    return [S(r, 200), K(arr.length <= 500, '条数 ≤500', arr.length)];
  });
}
