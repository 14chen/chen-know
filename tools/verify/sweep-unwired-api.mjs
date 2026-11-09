// 排查：api/ 下导出的每个函数，在界面代码里到底有没有被调用
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'D:/deepseekhums/work/知识库/frontend/src'
const files = []
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const f = join(d, e)
    if (statSync(f).isDirectory()) walk(f)
    else if (/\.(ts|tsx)$/.test(f)) files.push(f)
  }
}
walk(ROOT)

const apiFiles = files.filter((f) => f.replace(/\\/g, '/').includes('/api/'))
const otherFiles = files.filter((f) => !f.replace(/\\/g, '/').includes('/api/'))

// 收集 api/ 导出
const exported = new Map() // name -> 定义文件
for (const f of apiFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    if (m[1] === 'request') continue
    exported.set(m[1], f.split(/[\\/]/).pop())
  }
}

console.log(`api/ 下导出 ${exported.size} 个函数：\n`)
const unused = []
for (const [name, def] of [...exported].sort()) {
  let callSites = 0
  const where = []
  for (const f of otherFiles) {
    const src = readFileSync(f, 'utf8')
    // 排除 import 行，只看真实调用
    for (const line of src.split('\n')) {
      if (line.includes('import')) continue
      if (new RegExp(`\\b${name}\\s*\\(`).test(line)) {
        callSites++
        where.push(f.replace(ROOT, 'src'))
      }
    }
  }
  const tag = callSites === 0 ? '❌ 未接线' : `✅ ${callSites} 处`
  console.log(`  ${tag.padEnd(10)} ${name.padEnd(24)} (${def})`)
  if (callSites === 0) unused.push(name)
}
console.log(`\n未被界面调用的 API：${unused.length} 个`)
unused.forEach((n) => console.log('  - ' + n))
