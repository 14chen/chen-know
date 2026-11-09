/**
 * 定点修复：删掉演示笔记被写进去的测试标记「【冒烟测试】」。
 *
 * 默认**干跑**，只打印将要做什么；必须显式加 --apply 才会写回后端。
 * 安全前提（任一不满足就中止，不做任何写入）：
 *   1. 目标笔记标题必须是「中文排版测试」；
 *   2. 标记必须出现在文档**开头**（我的冒烟脚本只会插在开头）；
 *   3. 标记数量 1–2 处，且长度正好 6 个字符。
 *
 * 用法：
 *   node src/editor/lab/repair-demo-note.mjs           # 干跑
 *   node src/editor/lab/repair-demo-note.mjs --apply   # 写回并回读校验
 */
const API = 'http://127.0.0.1:8080'
const TITLE = '中文排版测试'
const MARK = '【冒烟测试】'
const apply = process.argv.includes('--apply')

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
const target = list.items.find((n) => n.title === TITLE)
if (!target) throw new Error(`没找到标题为「${TITLE}」的笔记，中止`)
const note = await (await fetch(`${API}/api/notes/${target.id}`, { headers: { cookie } })).json()
const content = note.content ?? ''

const count = content.split(MARK).length - 1
if (count === 0) {
  console.log(`#${target.id}「${TITLE}」没有测试标记，无需修复。`)
  process.exit(0)
}
if (!content.startsWith(MARK)) {
  throw new Error(`#${target.id} 的标记不在文档开头（共 ${count} 处），不是我的插入模式 → 中止，不写入`)
}
if (count > 2) throw new Error(`标记数量异常（${count} 处），中止，不写入`)

let cleaned = content
while (cleaned.startsWith(MARK)) cleaned = cleaned.slice(MARK.length)
// 头部可能残留一个已存在的换行，只在原来是「标记+换行」时保留原样
console.log(`#${target.id}「${TITLE}」`)
console.log(`  修复前 ${content.length} 字符，开头：${JSON.stringify(content.slice(0, 40))}`)
console.log(`  修复后 ${cleaned.length} 字符，开头：${JSON.stringify(cleaned.slice(0, 40))}`)
console.log(`  将删除开头的 ${content.length - cleaned.length} 个字符（${count} × "${MARK}"）`)

if (!apply) {
  console.log('\n干跑结束，未写入任何东西。确认无误后加 --apply 执行。')
  process.exit(0)
}

const patch = await fetch(`${API}/api/notes/${target.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ content: cleaned }),
})
if (!patch.ok) throw new Error(`PATCH 失败 HTTP ${patch.status}: ${await patch.text()}`)
const after = await (await fetch(`${API}/api/notes/${target.id}`, { headers: { cookie } })).json()
const left = (after.content ?? '').split(MARK).length - 1
console.log(`\n已写回。回读校验：${after.content.length} 字符，残留标记 ${left} 处`)
if (left !== 0) throw new Error('回读仍有残留，请人工检查')
console.log('修复完成 ✅')
