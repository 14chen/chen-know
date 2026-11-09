/* 造「开源周报/2026-W44」目录 + 10 篇真实格式的项目笔记（验收素材） */
const API = process.argv[2] || 'http://127.0.0.1:8095'
const login = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const h = { 'content-type': 'application/json; charset=utf-8', cookie }
const post = async (path, body) => { const r = await fetch(API + path, { method: 'POST', headers: h, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t.slice(0, 200)); return JSON.parse(t) }
const root = await post('/api/folders', { parentId: null, name: '开源周报' })
const week = await post('/api/folders', { parentId: root.id, name: '2026-W44' })
console.log('  目录: 开源周报=' + root.id + ' / 2026-W44=' + week.id)
const repos = [
  ['GitHub', 'openai/openai-python', '1,284', '24.1k', 'Python', 'OpenAI 官方 Python SDK，封装了 Chat / Embedding 等接口。'],
  ['GitHub', 'langgenius/dify', '986', '58.2k', 'TypeScript', '可拖拽编排的 LLM 应用开发平台。'],
  ['GitHub', 'ggml-org/llama.cpp', '742', '72.5k', 'C++', '纯 C/C++ 的 LLM 推理引擎，CPU 也能跑。'],
  ['GitHub', 'n8n-io/n8n', '655', '132k', 'TypeScript', '可自托管的自动化工作流平台。'],
  ['GitHub', 'microsoft/markitdown', '512', '61.4k', 'Python', '把各种文档转成 Markdown 的工具。'],
  ['Gitee', '若依/RuoYi', '318', '9.8k', 'Java', '国内常用的后台管理脚手架。'],
  ['Gitee', 'dromara/hutool', '266', '28.6k', 'Java', 'Java 工具类库合集。'],
  ['Gitee', 'y_project/RuoYi-Vue', '241', '6.1k', 'Java', '若依的 Vue 前后端分离版本。'],
  ['Gitee', 'baomidou/mybatis-plus', '198', '16.2k', 'Java', 'MyBatis 增强工具包。'],
  ['Gitee', 'dromara/Sa-Token', '152', '4.2k', 'Java', '轻量级 Java 权限认证框架。'],
]
let made = 0
for (const [src, repo, stars, total, lang, desc] of repos) {
  const title = '[' + src + '] ' + repo
  const why = '本周新增 ' + stars + ' 颗星，' + src + ' 周榜第 ' + (made % 5 + 1) + ' 名，说明近期关注度真实在涨；主要语言是 ' + lang + '，可直接按这个技术栈评估复用成本。'
  const content = ['# ' + title, '', '> 本周新增 ⭐ **+' + stars + '** · 总星 ' + total + ' · ' + lang + ' · 2026-W44', '', '**仓库地址**：https://example.com/' + repo, '', '## 它是做什么的', desc, '', '## 为什么值得看', why].join('\n')
  await post('/api/notes', { folderId: week.id, title, content })
  made += 1
}
const list = await fetch(API + '/api/notes?folderId=' + week.id + '&size=50', { headers: { cookie } }).then((r) => r.json())
console.log('  已造周报笔记 ' + made + ' 篇；该目录 total=' + list.total)