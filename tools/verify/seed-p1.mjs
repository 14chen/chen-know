/* 夹具：3 层目录 + 5+ 篇笔记（够测面包屑多级与上下篇） */
const API = process.argv[2] || 'http://127.0.0.1:8095'
const login = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const h = { 'content-type': 'application/json; charset=utf-8', cookie }
const post = async (path, body) => {
  const r = await fetch(API + path, { method: 'POST', headers: h, body: JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t.slice(0, 200))
  return JSON.parse(t)
}
const a = await post('/api/folders', { parentId: null, name: '技术博客' })
const b = await post('/api/folders', { parentId: a.id, name: '前端笔记' })
const c = await post('/api/folders', { parentId: b.id, name: '深度' })
console.log('  目录: 技术博客=' + a.id + ' 前端笔记=' + b.id + ' 深度=' + c.id)
const notes = [
  ['深度专题：渲染管线', c.id, '# 深度专题：渲染管线\n\n这里是三层目录下的笔记。'],
  ['权限认证框架说明', a.id, '# 权限认证框架说明\n\n讲权限与鉴权。'],
  ['SQLite 索引笔记', a.id, '# SQLite 索引笔记\n\n索引与查询计划。'],
  ['CSS 布局速查', a.id, '# CSS 布局速查\n\nflex / grid 对照。'],
  ['未分类的随手记', null, '# 未分类的随手记\n\n根目录笔记。'],
]
for (const [title, folderId, content] of notes) {
  await post('/api/notes', { title, content, folderId })
}
const list = await fetch(API + '/api/notes?size=50', { headers: { cookie } }).then((r) => r.json())
console.log('  notes total=' + list.total)
for (const n of list.items) console.log('    id=' + n.id + ' folder=' + (n.folderId ?? 'null') + ' ' + n.title)
