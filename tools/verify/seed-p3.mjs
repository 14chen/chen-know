/* 夹具：一篇带 7 个标题 + 代码块（块内有 # 注释行）的长文，同目录再造 3 篇（让相关推荐出结果） */
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
const folder = await call('POST', '/api/folders', { parentId: null, name: '技术博客' })
console.log('  目录 技术博客=' + folder.id)
const fence = String.fromCharCode(96).repeat(3)
const long = [
  '# 权限系统总览',
  '',
  '这是总览段落，讲权限与鉴权的关系。',
  '',
  '## 一、认证与授权',
  '',
  '认证回答你是谁，授权回答你能做什么。',
  '',
  '### 1.1 会话与 Token',
  '',
  '会话用 Cookie，Token 用 Header。',
  '',
  '## 二、代码示例',
  '',
  fence + 'bash',
  '# 这是代码块里的注释行，不能被当成标题',
  '# 第二行注释也不行',
  'echo hello',
  fence,
  '',
  '### 2.1 中间补齐一段',
  '',
  '正文段落。',
  '',
  '## 三、权限模型',
  '',
  'RBAC / ABAC 对比。',
  '',
  '### 3.1 角色表设计',
  '',
  '角色与权限是多对多。',
  '',
  '## 四、常见坑',
  '',
  '缓存与权限失效。',
  '',
  '### 4.1 会话过期',
  '',
  '过期后返回 401。',
  '',
  '## 五、总结',
  '',
  '收尾段落。',
].join('\n')
const main = await call('POST', '/api/notes', { title: '权限系统长文（大纲测试）', content: long, folderId: folder.id })
console.log('  长文 id=' + main.id)
const others = [
  ['权限模型补充说明', 'RBAC 与 ABAC 的取舍，权限与鉴权的边界。'],
  ['鉴权失败排查手册', '401/403 排查路径，权限点校验顺序。'],
  ['会话与 Token 对比', '会话 Cookie 与 Token Header 的差异。'],
]
for (const [title, body] of others) {
  const n = await call('POST', '/api/notes', { title, content: '# ' + title + '\n\n' + body, folderId: folder.id })
  console.log('  关联笔记 id=' + n.id + ' ' + title)
}
const lonely = await call('POST', '/api/notes', { title: '孤立笔记（无关联）', content: '# 孤立笔记\n\n这篇没有任何共同标签/目录/内容词，用来验证相关推荐为空时整块不渲染。', folderId: null })
console.log('  孤立笔记 id=' + lonely.id)
const related = await call('GET', '/api/notes/' + main.id + '/related?limit=5')
console.log('  related(' + main.id + ') = ' + JSON.stringify((related.items || []).map((i) => i.title + '|' + i.reasonLabel)))
const relLonely = await call('GET', '/api/notes/' + lonely.id + '/related?limit=5')
console.log('  related(孤立) = ' + JSON.stringify(relLonely.items))
