/**
 * 演示笔记污染检查（只读，不改任何东西）。
 * 起因：smoke-app.mjs 会在正文里输入「【冒烟测试】」，而外壳会自动保存 —— 会写到真后端。
 * 用法：node src/editor/lab/inspect-notes.mjs
 */
const API = 'http://127.0.0.1:8080'

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }),
})
if (!login.ok) throw new Error(`登录失败 HTTP ${login.status}`)
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])
  .map((c) => c.split(';')[0])
  .join('; ')

const list = await (await fetch(`${API}/api/notes?size=200&sort=updated`, { headers: { cookie } })).json()
const MARK = '【冒烟测试】'
for (const item of list.items) {
  const note = await (await fetch(`${API}/api/notes/${item.id}`, { headers: { cookie } })).json()
  const content = note.content ?? ''
  const hits = [...content.matchAll(new RegExp(MARK, 'g'))].map((m) => m.index)
  console.log(
    `#${item.id}  ${note.title}  |  ${content.length} 字符  |  污染标记 ${hits.length} 处` +
      (hits.length ? `  位置 ${JSON.stringify(hits)}` : ''),
  )
  if (hits.length) {
    for (const at of hits) {
      console.log(`      …${JSON.stringify(content.slice(Math.max(0, at - 30), at + 30))}…`)
    }
    console.log(`      开头 60 字符：${JSON.stringify(content.slice(0, 60))}`)
  }
}
