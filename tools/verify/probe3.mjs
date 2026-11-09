// 打开「欢迎使用知识库」（含任务列表）探明复选框的真实 DOM 表示。
import { launch } from './cdp.mjs'

const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage('http://localhost:5173/proto/index.html')
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`)
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, 'demo'); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.cm-content')`, { timeout: 20000 })
  await new Promise((r) => setTimeout(r, 1500))

  // 确保打开的是第一篇（欢迎使用知识库）
  await p.eval(`(() => {
    const el = [...document.querySelectorAll('*')].find(e =>
      (e.textContent || '').trim() === '欢迎使用知识库' && e.children.length === 0);
    if (el) el.click();
  })()`)
  await new Promise((r) => setTimeout(r, 1800))

  const out = await p.eval(`JSON.stringify({
    allKbClasses: [...new Set([...document.querySelectorAll('.cm-content *')]
      .flatMap(e => [...e.classList]).filter(c => c.startsWith('cm-kb')))].sort(),
    inputsInContent: [...document.querySelectorAll('.cm-content input')].map(e => e.type),
    taskLineHtml: (() => {
      const line = [...document.querySelectorAll('.cm-line')].find(l => /装好 JDK|写下第一篇/.test(l.textContent || ''));
      return line ? line.outerHTML.slice(0, 700) : null;
    })(),
    tableCount: document.querySelectorAll('.cm-content table').length,
    hrCount: document.querySelectorAll('.cm-content hr').length,
    preCount: document.querySelectorAll('.cm-content pre').length,
    codeBlockish: [...document.querySelectorAll('.cm-content *')].filter(e => /codeblock|code-block/i.test(String(e.className))).length
  }, null, 1)`)
  console.log(out)
} finally {
  await b.close()
}
