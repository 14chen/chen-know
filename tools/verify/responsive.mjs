// 响应式独立验收：在四个断点下逐个视图检查布局、横向溢出、抽屉行为与触摸目标。
// Lead 的验收工具，不复用实现者的脚本。
//
// 用法：node tools/verify/responsive.mjs [url] [--shots]
//   默认对着 http://127.0.0.1:8080/proto/index.html
//   --shots 额外把每个断点×视图截一张图到 tools/verify/shots/responsive/

import { launch } from './cdp.mjs'
import { mkdirSync } from 'node:fs'

const APP_URL = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'http://127.0.0.1:8080/proto/index.html'
const SHOTS = process.argv.includes('--shots')
const SHOT_DIR = 'D:/deepseekhums/work/知识库/tools/verify/shots/responsive'
const USER = process.env.KB_USER || 'demo'
const PASS = process.env.KB_PASS || 'DemoPass123!'

const BREAKPOINTS = [
  { name: '桌面', key: 'desktop', width: 1440, height: 900, expectRail: true },
  { name: '笔记本', key: 'laptop', width: 1180, height: 800, expectRail: true },
  { name: '平板', key: 'tablet', width: 900, height: 700, expectRail: false },
  { name: '手机', key: 'phone', width: 390, height: 844, expectRail: false },
]

// 每个视图：路由 hash、名称、以及在该视图里可以验证的主要交互元素选择器（可选）
const ROUTES = [
  { hash: '#/notes/1', name: '笔记' },
  { hash: '#/search?q=%E5%A4%A9%E6%B0%94', name: '搜索' },
  { hash: '#/tags', name: '标签' },
  { hash: '#/backlinks?note=3', name: '反链' },
  { hash: '#/versions?note=1', name: '版本' },
  { hash: '#/favorites', name: '收藏' },
  { hash: '#/recent', name: '最近' },
  { hash: '#/trash', name: '回收站' },
  { hash: '#/io', name: '导入导出' },
  { hash: '#/stats', name: '统计' },
  { hash: '#/admin', name: '成员管理' },
]

if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
  } else {
    fail++
    failures.push(`${name}${detail ? ' :: ' + detail : ''}`)
  }
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  :: ' + detail : ''}`)
}

const b = await launch({ width: 1440, height: 900 })
try {
  const p = await b.newPage(APP_URL)
  await p.waitForLoad()
  await p.waitFor(`!!document.querySelector('input[name="username"]')`, { timeout: 30000 })
  await p.eval(`(() => {
    const u = document.querySelector('input[name="username"]');
    const pw = document.querySelector('input[name="password"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(u, ${JSON.stringify(USER)}); u.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(pw, ${JSON.stringify(PASS)}); pw.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await p.click('button.kb-btn--primary')
  await p.waitFor(`!!document.querySelector('.kb-app') || !!document.querySelector('main')`, { timeout: 30000 })
  await sleep(1500)

  for (const bp of BREAKPOINTS) {
    console.log('')
    console.log('='.repeat(72))
    console.log(`${bp.name}  ${bp.width}×${bp.height}`)
    console.log('='.repeat(72))
    await p.setViewport(bp.width, bp.height, 1)
    await sleep(700)

    for (const route of ROUTES) {
      // 用整文档导航（hash 变化的同文档导航不会重新挂载）
      await p.goto(`${APP_URL.split('#')[0]}${route.hash}`, { waitMs: 1400 })
      await sleep(900)

      const probe = await p.eval(`JSON.stringify((() => {
        const de = document.documentElement;
        const overflow = de.scrollWidth - de.clientWidth;
        const sidebar = document.querySelector('.kb-sidebar');
        const sbRect = sidebar ? sidebar.getBoundingClientRect() : null;
        const sidebarVisible = !!sbRect && sbRect.width > 20 && sbRect.right > 20;
        const main = document.querySelector('.kb-main') || document.querySelector('main');
        const mainRect = main ? main.getBoundingClientRect() : null;
        // 视图是否渲染出内容（排除白屏）
        const contentLen = (main ? main.innerText : '').trim().length;
        // 触摸目标：按钮与 role=button
        const targets = [...document.querySelectorAll('button, [role="button"], a[href]')]
          .map(e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16) }; })
          .filter(x => x.w > 0 && x.h > 0);
        const small = targets.filter(x => x.w < 44 || x.h < 44);
        return {
          overflow,
          sidebarVisible,
          sidebarWidth: sbRect ? Math.round(sbRect.width) : 0,
          mainWidth: mainRect ? Math.round(mainRect.width) : 0,
          contentLen,
          targetCount: targets.length,
          smallCount: small.length,
          smallest: small.slice(0, 3).map(x => x.w + 'x' + x.h + ' ' + x.t),
        };
      })())`)
      const r = JSON.parse(probe)

      check(`${bp.name}·${route.name}：无横向溢出`, r.overflow <= 0, `overflow=${r.overflow}px`)
      check(`${bp.name}·${route.name}：内容已渲染（非白屏）`, r.contentLen > 10, `文本长度=${r.contentLen}`)
      if (r.smallCount > 0) {
        console.log(`        触摸目标偏小 ${r.smallCount}/${r.targetCount} 例：${r.smallest.join(' | ')}`)
      }
      if (SHOTS) {
        await p.screenshot(`${SHOT_DIR}/${bp.key}-${route.name}.png`)
      }
    }

    // 抽屉/侧栏开合：
    // 桌面是 position:static，靠 width 变化（288 → 0）判断可见；
    // 平板/手机是 position:fixed 移出屏幕（left:-240），**width 恒定不变**，靠 left 判断。
    // 统一用「可见 = 宽度>20 且右边缘仍在视口内」，两种形态都适用。
    const side = async () =>
      JSON.parse(
        await p.eval(`JSON.stringify((() => {
          const sb = document.querySelector('.kb-sidebar');
          if (!sb) return { visible: false, width: 0, left: 0 };
          const r = sb.getBoundingClientRect();
          return {
            visible: r.width > 20 && (r.left + r.width) > 20,
            width: Math.round(r.width),
            left: Math.round(r.left),
          };
        })())`),
      )

    const beforeSide = await side()
    // ⚠️ 必须限定在视口内（left >= 0）：离屏抽屉内部的「收起左栏」按钮在 DOM 里同样可见，
    //    正则先匹配到它就会点了个不在屏幕上的按钮 —— 这是本脚本第一版的真实误判。
    const toggleFound = await p.eval(`(() => {
      const t = [...document.querySelectorAll('button')].find(b => {
        const r = b.getBoundingClientRect();
        const lab = (b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '');
        return r.width > 0 && r.left >= 0 && r.left < innerWidth && /左栏|菜单|侧栏|sidebar|menu|导航/i.test(lab);
      });
      if (!t) return false;
      t.click();
      return true;
    })()`)
    await sleep(700)
    const afterSide = await side()
    const hasScrim = await p.eval(`!!document.querySelector('.kb-drawer-scrim, [class*="scrim"], [class*="overlay"]')`)
    console.log(
      `        侧栏：切换按钮=${toggleFound} 可见 ${beforeSide.visible}→${afterSide.visible}` +
        ` (left ${beforeSide.left}→${afterSide.left}, width ${beforeSide.width}→${afterSide.width}) 遮罩=${hasScrim}`,
    )
    if (!bp.expectRail) {
      check(`${bp.name}：存在侧栏开关按钮`, toggleFound)
      check(`${bp.name}：开关能改变侧栏可见状态`, beforeSide.visible !== afterSide.visible,
        `${beforeSide.visible} → ${afterSide.visible}`)
    }
  }

  // 触摸目标专项（手机断点，pointer: coarse）
  console.log('')
  console.log('='.repeat(72))
  console.log('触摸目标（手机 390×844 + pointer:coarse）')
  console.log('='.repeat(72))
  // ⚠️ 正确做法：Emulation.setEmulatedMedia 模拟不了 pointer/hover 特性（实测 matches 恒为 false），
  //    必须用 touch emulation + mobile 视口，否则测到的仍是桌面尺寸 —— 本脚本第一版就测了个假的。
  await p._send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await p.setViewport(390, 844, 1)
  await p._send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  })
  await p.goto(`${APP_URL.split('#')[0]}#/notes/1`, { waitMs: 1800 })
  await sleep(1000)

  // 先断言前置条件：coarse 必须真的生效，否则这次测量无意义
  const coarseOn = await p.eval(`window.matchMedia('(pointer: coarse)').matches`)
  check('触摸模拟前置条件：pointer:coarse 已生效', coarseOn === true, `matches=${coarseOn}`)

  // 抽屉**关闭**时视口内的目标（顶栏那几个）
  const measure = async () =>
    JSON.parse(
      await p.eval(`JSON.stringify((() => {
        const targets = [...document.querySelectorAll('button, [role="button"]')]
          .map(e => {
            const r = e.getBoundingClientRect();
            return {
              w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left),
              t: (e.getAttribute('aria-label') || e.getAttribute('title') || (e.textContent || '').trim()).slice(0, 18)
            };
          })
          .filter(x => x.w > 0 && x.h > 0 && x.left >= 0 && x.left < 390);
        const bad = targets.filter(x => x.w < 44 || x.h < 44);
        return {
          total: targets.length, bad: bad.length,
          worst: bad.sort((a, b) => a.h - b.h).slice(0, 6).map(x => x.w + 'x' + x.h + ' ' + x.t),
        };
      })())`),
    )

  const closed = await measure()
  check('手机断点（抽屉关闭）视口内按钮 ≥44px', closed.bad === 0,
    closed.bad ? `${closed.bad}/${closed.total} 偏小：${closed.worst.join(' | ')}` : `${closed.total} 个达标`)

  // ⚠️ 必须**打开抽屉再测**：侧栏内部的目标（目录树行按钮等）在关闭时全在视口外，
  //    只测关闭状态等于漏掉整个侧栏 —— 本脚本上一版就漏了，靠单独诊断才发现折叠箭头只有 32px。
  await p.eval(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.left < innerWidth &&
             /左栏|菜单|侧栏|menu/i.test((b.getAttribute('aria-label') || ''));
    });
    if (t) t.click();
  })()`)
  await sleep(900)
  // 展开第一个有子目录的目录，让行内操作按钮露出来
  await p.eval(`(() => {
    const el = [...document.querySelectorAll('.kb-sidebar *')]
      .find(e => /^技术/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0);
    if (el) el.click();
  })()`)
  await sleep(700)

  const opened = await measure()
  check('手机断点（抽屉打开）侧栏内按钮 ≥44px', opened.bad === 0,
    opened.bad ? `${opened.bad}/${opened.total} 偏小：${opened.worst.join(' | ')}` : `${opened.total} 个达标`)

  console.log('')
  console.log('='.repeat(72))
  console.log(`结果：PASS ${pass}   FAIL ${fail}`)
  if (failures.length) {
    console.log('失败项：')
    failures.forEach((f) => console.log('  - ' + f))
  }
  console.log('='.repeat(72))
  process.exitCode = fail ? 1 : 0
} catch (e) {
  console.error('响应式验收脚本异常：', e.message)
  process.exitCode = 2
} finally {
  await b.close()
}
