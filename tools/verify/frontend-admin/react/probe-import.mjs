/**
 * 探针：以「文件夹相对路径 filename」提交 md + 图片，观察后端 /api/import/preview 的行为。
 * 用法：node probe-import.mjs [backendUrl] [user] [password]
 * 只调 preview（契约保证不入库、不上传），安全。
 */
const BACKEND = process.argv[2] || 'http://127.0.0.1:8090'
const USER = process.argv[3] || 'demo'
const PASSWORD = process.argv[4] || 'DemoPass123!'

/* 1x1 透明 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

const login = await fetch(`${BACKEND}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
})
const setCookie = login.headers.get('set-cookie') || ''
const cookie = setCookie.split(';')[0]
console.log(`login ${login.status} cookie=${cookie ? cookie.replace(/=.*/, '=<hidden>') : '(none)'}`)

const md = '# 使用手册\n\n登录页截图：\n\n![登录页](images/02-登录页.png)\n\n外部图：![x](https://example.com/x.png)\n\n缺图：![无](images/not-there.png)\n'

const form = new FormData()
form.append('file', new Blob([md], { type: 'text/markdown' }), 'docs/使用手册.md')
form.append('file', new Blob([PNG], { type: 'image/png' }), 'docs/images/02-登录页.png')

const preview = await fetch(`${BACKEND}/api/import/preview`, { method: 'POST', headers: { cookie }, body: form })
const text = await preview.text()
console.log(`preview ${preview.status}`)
console.log(text)
try {
  const json = JSON.parse(text)
  console.log('--- 顶层字段 ---')
  console.log(Object.keys(json).join(', '))
  console.log('imagesImported 存在:', 'imagesImported' in json)
  console.log('missingImages 存在:', 'missingImages' in json)
  console.log('items[0]:', JSON.stringify(json.items?.[0]))
} catch {
  /* 非 JSON */
}
