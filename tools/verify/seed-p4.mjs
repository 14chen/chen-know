const API = process.argv[2] || 'http://127.0.0.1:8095'
const login = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'DemoPass123!' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const h = { 'content-type': 'application/json; charset=utf-8', cookie }
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + t.slice(0, 140))
  return t ? JSON.parse(t) : null
}
const fence = String.fromCharCode(96).repeat(3)
const table = [
  '| 项目 | 语言 | Stars | 许可 | 维护 | 备注 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 权限框架 A | Java | 12800 | Apache-2.0 | 活跃 | 企业常用，文档齐全 |',
  '| 鉴权中间件 B | Go | 9400 | MIT | 活跃 | 轻量，适合网关侧 |',
  '| 会话服务 C | Node | 5600 | MIT | 一般 | 参考实现 |',
].join('\n')
const content = [
  '# 排版演示（代码块 / 表格）',
  '',
  '这是一段用于测试行宽的正文，讲权限与鉴权的关系，以及会话过期策略的处理方式。这段话会重复几次以便观察行宽与行高是否稳定。',
  '这一段继续写长一点：认证回答你是谁，授权回答你能做什么；两者混在一起设计，后期就会出现权限点散落各处、无法审计的问题。',
  '',
  '## Java 示例',
  '',
  fence + 'java',
  'public class Demo {',
  '  public static void main(String[] args) {',
  '    System.out.println("hello 权限");',
  '  }',
  '}',
  fence,
  '',
  '## Python 示例',
  '',
  fence + 'python',
  'def check(user):',
  '    return user.has("perm:read")',
  fence,
  '',
  '## 无语言代码块',
  '',
  fence,
  'echo 无语言',
  fence,
  '',
  '## 宽表格',
  '',
  table,
  '',
  '## 结尾',
  '',
  '收尾段落。',
].join('\n')
const note = await call('POST', '/api/notes', { title: '排版演示：代码块与表格', content })
console.log('  排版笔记 id=' + note.id)
for (const name of ['后端', '权限', '前端']) { try { await call('POST', '/api/tags', { name }) } catch (e) { } }
const tags = await call('GET', '/api/tags')
console.log('  tags=' + JSON.stringify((tags || []).map((t) => t.name + ':' + t.count)))
for (const t of ['后端', '鉴权', '权限']) {
  for (let i = 0; i < 3; i++) {
    const n = await call('POST', '/api/notes', { title: t + ' 测试 ' + (i + 1), content: '# ' + t + ' 测试\n\n关于' + t + '的正文。' })
  }
}
const list = await call('GET', '/api/notes?size=50')
console.log('  notes total=' + list.total + ' | excerpt 有值=' + list.items.filter((i) => i.excerpt).length)
console.log('  sample excerpt=' + JSON.stringify((list.items[0] || {}).excerpt))
