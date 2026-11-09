/* 夹具：3 个标签 + 10 篇含「权限/鉴权」的笔记，其中 1 篇在「技术博客」，另建一个空目录 */
const API = process.argv[2] || 'http://127.0.0.1:8095'
const login = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const h = { 'content-type': 'application/json; charset=utf-8', cookie }
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + t.slice(0, 160))
  return t ? JSON.parse(t) : null
}
const tech = await call('POST', '/api/folders', { parentId: null, name: '技术博客' })
const emptyFolder = await call('POST', '/api/folders', { parentId: null, name: '空目录' })
console.log('  目录: 技术博客=' + tech.id + ' 空目录=' + emptyFolder.id)
for (const name of ['权限', '鉴权', '后端']) {
  try { await call('POST', '/api/tags', { name }) } catch (e) { console.log('  tag ' + name + ': ' + e.message.slice(0, 60)) }
}
const tags = await call('GET', '/api/tags')
console.log('  标签: ' + (Array.isArray(tags) ? tags.map((t) => t.name + '(' + t.id + ')').join(', ') : 'n/a'))
const titles = [
  ['权限认证框架说明', true], ['鉴权失败排查', false], ['权限模型设计', false], ['鉴权中间件笔记', false],
  ['权限与角色表', false], ['临时鉴权方案', false], ['权限缓存策略', false], ['鉴权日志分析', false],
  ['前后端分离的权限设计', false], ['关于鉴权的一点思考', false],
]
const tagList = Array.isArray(tags) ? tags : []
let count = 0
for (const [title, inTech] of titles) {
  const body = '# ' + title + '\n\n正文：' + title + '，讨论权限与鉴权的边界，以及会话过期策略。'
  const note = await call('POST', '/api/notes', { title, content: body, folderId: inTech ? tech.id : null })
  if (tagList.length > 0 && count < 3) {
    // 给前 3 篇挂标签（带上 version，避免 400）
    try {
      await call('PATCH', '/api/notes/' + note.id, { tags: [tagList[count % tagList.length].name], version: note.version })
    } catch (e) {
      console.log('  patch tags #' + note.id + ': ' + e.message.slice(0, 70))
    }
  }
  count += 1
}
const list = await call('GET', '/api/notes?size=50')
console.log('  notes total=' + list.total)
const search = await call('GET', '/api/search?q=' + encodeURIComponent('权限'))
console.log('  q=权限 -> total=' + search.total)
const sug = await call('GET', '/api/search/suggest?q=' + encodeURIComponent('权') + '&limit=5')
console.log('  suggest q=权 -> ' + JSON.stringify(sug.items))
