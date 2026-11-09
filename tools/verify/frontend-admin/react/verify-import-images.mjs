/**
 * 真链路验收：以「文件夹相对路径 filename」导入 md + 图片，验证契约 docs/IMPORT-IMAGES.md §6/§8 的前后端链路。
 * 用法：node verify-import-images.mjs [backendUrl] [user] [password]
 *
 * 覆盖（对应契约 §10 的前端相关项）：
 *   - preview：接受图片、不报「不支持的文件类型」、missingImages 逐条正确
 *   - import ：imagesImported ≥ 1，笔记正文引用被重写为 /api/attachments/{id}
 *   - 取回该附件 URL：200 且字节与原图一致
 *   - 收尾：删除测试笔记（含回收站）与附件，不给实例留垃圾
 */
const BACKEND = process.argv[2] || 'http://127.0.0.1:8090'
const USER = process.argv[3] || 'demo'
const PASSWORD = process.argv[4] || 'DemoPass123!'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra: String(extra).slice(0, 300) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   >> ' + String(extra).slice(0, 300)}`)
}

const login = await fetch(`${BACKEND}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
})
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
check('登录测试实例', login.status === 200 && !!cookie, `${login.status} ${cookie ? '' : 'no cookie'}`)

async function api(path, { method = 'GET', form, body } = {}) {
  const res = await fetch(BACKEND + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json, text, headers: res.headers }
}

const STAMP = String(Date.now()).slice(-6)
const TITLE = `QA-图片导入-${STAMP}`
const missingRef = `images/not-there-${STAMP}.png`
const md = `# ${TITLE}\n\n登录页：\n\n![登录页](images/02-登录页.png)\n\n缺图：![没有](${missingRef})\n\n外部图：![x](https://example.com/x.png)\n`

function folderForm() {
  const form = new FormData()
  form.append('file', new Blob([md], { type: 'text/markdown' }), `docs/${TITLE}.md`)
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'docs/images/02-登录页.png')
  return form
}

/* ---- preview ---- */
const preview = await api('/api/import/preview', { method: 'POST', form: folderForm() })
check('preview 200（图片不再被当成 unsupported）', preview.status === 200, `${preview.status} ${preview.text.slice(0, 160)}`)
check('preview 无「不支持的文件类型」错误', !/不支持的文件类型/.test(preview.text), preview.text.slice(0, 200))
check('preview items 只含 md 一篇（图片不产生笔记）', preview.json?.items?.length === 1 && preview.json.items[0].sourceFile === `docs/${TITLE}.md`, JSON.stringify(preview.json?.items))
check('preview 顶层含 imagesImported 与 missingImages', preview.json && 'imagesImported' in preview.json && Array.isArray(preview.json.missingImages), Object.keys(preview.json ?? {}).join(','))
const previewMissing = preview.json?.missingImages ?? []
check(
  'preview 缺图逐条正确（只有真缺的那张；外部地址不算）',
  previewMissing.length === 1 && previewMissing[0].target === missingRef && previewMissing[0].reason === '文件集合里没有这个路径' && typeof previewMissing[0].line === 'number',
  JSON.stringify(previewMissing),
)
check('preview 的 imagesImported = 将会导入的图片数（新语义，非 0）', (preview.json?.imagesImported ?? 0) >= 1, `imagesImported=${preview.json?.imagesImported}`)

/* ---- import ---- */
const imported = await api('/api/import/markdown', { method: 'POST', form: folderForm() })
check('import 200 且 imported ≥ 1', imported.status === 200 && (imported.json?.imported ?? 0) >= 1, JSON.stringify(imported.json))
check('import imagesImported ≥ 1（图片真的上传了）', (imported.json?.imagesImported ?? 0) >= 1, JSON.stringify(imported.json))
check('import 缺图仍逐条报告且不阻断', (imported.json?.missingImages ?? []).length === 1, JSON.stringify(imported.json?.missingImages))

/* ---- bmp / avif：白名单已加，前端也收下 ---- */
const BMP_TITLE = `QA-bmp-avif-${STAMP}`
const bmp = Buffer.concat([
  Buffer.from('BM'),
  Buffer.alloc(12),
  Buffer.from([0x28, 0, 0, 0]), // DIB header size = 40
  Buffer.alloc(8),
  Buffer.from([1, 0, 24, 0]),
  Buffer.alloc(8),
  Buffer.from([0x10, 0x0e, 0xff, 0x00]), // 一个像素（BGRA）
])
const avif = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypavif'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('avifmif1'),
  Buffer.alloc(16),
])
const bmpMd = `# ${BMP_TITLE}\n\nbmp：![b](img/a.bmp)\n\navif：![a](img/b.avif)\n`
const bmpForm = () => {
  const form = new FormData()
  form.append('file', new Blob([bmpMd], { type: 'text/markdown' }), `docs/${BMP_TITLE}.md`)
  form.append('file', new Blob([bmp], { type: 'image/bmp' }), 'docs/img/a.bmp')
  form.append('file', new Blob([avif], { type: 'image/avif' }), 'docs/img/b.avif')
  return form
}
const bmpPreview = await api('/api/import/preview', { method: 'POST', form: bmpForm() })
check('bmp/avif：preview 不报不支持', bmpPreview.status === 200 && (bmpPreview.json?.missingImages ?? []).length === 0, JSON.stringify(bmpPreview.json?.missingImages))
check('bmp/avif：preview imagesImported = 2（新语义）', bmpPreview.json?.imagesImported === 2, `imagesImported=${bmpPreview.json?.imagesImported}`)
const bmpImport = await api('/api/import/markdown', { method: 'POST', form: bmpForm() })
check('bmp/avif：导入成功且 imagesImported = 2', bmpImport.status === 200 && bmpImport.json?.imagesImported === 2, JSON.stringify(bmpImport.json))
let bmpNote = null
{
  const after = await api('/api/notes?size=200&sort=updated')
  bmpNote = (after.json?.items ?? []).find((n) => n.title === BMP_TITLE)
  if (bmpNote) {
    const detail = await api(`/api/notes/${bmpNote.id}`)
    const content = detail.json?.content ?? ''
    const refs = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    check('bmp/avif：两条引用都被重写为附件 URL', refs.length === 2 && refs.every((r) => /^\/api\/attachments\/\d+$/.test(r)), JSON.stringify(refs))
    const bytes = await Promise.all(
      refs.map(async (r) => {
        const res = await fetch(BACKEND + r, { headers: { cookie } })
        return res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0)
      }),
    )
    check('bmp/avif：附件可取回且字节一致', bytes[0].equals(bmp) && bytes[1].equals(avif), `bmp=${bytes[0].length}/${bmp.length} avif=${bytes[1].length}/${avif.length}`)
    await api(`/api/notes/${bmpNote.id}`, { method: 'DELETE' })
    await api(`/api/trash/notes/${bmpNote.id}`, { method: 'DELETE' })
    for (const r of refs) await api(r, { method: 'DELETE' })
  } else {
    check('bmp/avif：能查到导入的笔记', false, `title=${BMP_TITLE}`)
  }
}

/* ---- 正文引用被重写 ---- */
const list = await api('/api/notes?size=200&sort=updated')
const created = (list.json?.items ?? []).find((n) => n.title === TITLE)
check('导入后能在笔记列表里找到', !!created, `title=${TITLE} found=${!!created}`)

let attachmentPath = ''
if (created) {
  const detail = await api(`/api/notes/${created.id}`)
  const content = detail.json?.content ?? ''
  const match = /!\[[^\]]*\]\(([^)]+)\)/.exec(content)
  attachmentPath = match ? match[1] : ''
  check('正文引用被重写为 /api/attachments/{id}', /^\/api\/attachments\/\d+$/.test(attachmentPath), `content=${content.replace(/\n/g, ' | ').slice(0, 200)}`)
  check('正文里不再残留相对路径', !content.includes('images/02-登录页.png'), content.slice(0, 200))
  check('缺图引用被原样保留', content.includes(missingRef), content.replace(/\n/g, ' | ').slice(0, 240))
  check('外部地址未被改写', content.includes('https://example.com/x.png'), content.slice(-120))

  if (attachmentPath) {
    const file = await fetch(BACKEND + attachmentPath, { headers: { cookie } })
    const bytes = Buffer.from(await file.arrayBuffer())
    check('附件 URL 返回 200', file.status === 200, String(file.status))
    check('附件字节与原图一致', bytes.equals(PNG), `sent=${PNG.length}B got=${bytes.length}B`)
  }
}

/* ---- 收尾清理 ---- */
if (created) {
  await api(`/api/notes/${created.id}`, { method: 'DELETE' })
  await api(`/api/trash/notes/${created.id}`, { method: 'DELETE' })
}
if (attachmentPath) await api(attachmentPath, { method: 'DELETE' })
const leftovers = await api('/api/notes?size=200&sort=updated')
const stillThere = (leftovers.json?.items ?? []).filter((n) => n.title === TITLE).length
check('收尾：测试笔记已从库里清掉', stillThere === 0, `left=${stillThere}`)

const passed = results.filter((r) => r.ok).length
console.log(`\nRESULT passed ${passed}/${results.length}`)
if (passed !== results.length) {
  console.log('FAILED:')
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name} >> ${r.extra}`)
  process.exit(1)
}
