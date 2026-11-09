/**
 * e3-body-limit.mjs — 正文字数/字节上限边界探测（API.md §4.4 声明 content ≤ 2MB、非 multipart 体 ≤ 8MB）
 */
import { call, Session, jdump, log, ensureDirs } from './e3-lib.mjs';

function ascii(n) { return 'a'.repeat(n); }
function cjk(n) { return '安'.repeat(n); }

async function main() {
  ensureDirs();
  const s = new Session();
  await s.ensure();
  const n = await call('/api/notes', { method: 'POST', cookie: s.cookie, body: { title: '边界探测载体', content: '' } });
  const id = n.json.id;
  const cases = [
    { name: 'ascii-1.00MB(1,000,000 字符)', content: ascii(1000000) },
    { name: 'ascii-2.00MB(2,000,000 字符)', content: ascii(2000000) },
    { name: 'ascii-2097151 字符(2MB-1)', content: ascii(2097151) },
    { name: 'ascii-2097152 字符(=2MB)', content: ascii(2097152) },
    { name: 'ascii-2200000 字符(>2MB)', content: ascii(2200000) },
    { name: 'cjk-800000 字符(UTF8≈2.4MB)', content: cjk(800000) },
    { name: 'cjk-1000000 字符(UTF8≈3MB)', content: cjk(1000000) },
    { name: 'ascii-8500000 字符(>8MB 请求体)', content: ascii(8500000) }
  ];
  const rows = [];
  for (const c of cases) {
    const utf8 = Buffer.byteLength(c.content, 'utf8');
    const r = await call('/api/notes/' + id, { method: 'PATCH', cookie: s.cookie, body: { content: c.content } });
    const err = r.json && r.json.error ? r.json.error : null;
    rows.push({ name: c.name, chars: c.content.length, utf8Bytes: utf8, jsonBodyBytes: utf8 + 40, status: r.status, code: err && err.code, message: err && String(err.message).slice(0, 120), noteField: err && err.field, ms: Number(r.ms.toFixed(1)) });
    log(c.name, 'chars=' + c.content.length, 'utf8=' + utf8, '->', r.status, err ? err.code : 'OK', 'ms=' + r.ms.toFixed(1));
  }
  jdump('body-limit.json', { at: new Date().toISOString(), rows });
  console.log(JSON.stringify(rows, null, 2));
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
