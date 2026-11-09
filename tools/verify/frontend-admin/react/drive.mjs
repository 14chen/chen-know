    for (const size of sizes) {
      await page.setViewport(size.w, size.h)
      await sleep(300)
      const overflow = await h.overflow()
      check(`#/${view} @${size.w}×${size.h}: 无横向溢出`, overflow.docScroll <= overflow.docClient, `scrollWidth=${overflow.docScroll} clientWidth=${overflow.docClient} bodyScroll=${overflow.bodyScroll}`)
      if (view === 'admin' && size.w === 390) {
        const hintCount = await h.count('.kb-adm-table-hint')
        const fadeCount = await h.count('.kb-adm-table-fade')
        const hintText = await h.evalIn(`document.querySelector('.kb-adm-table-hint')?.textContent ?? ''`)
        check('admin @390: 表格溢出时出现滚动提示（右缘渐隐 + 文案）', hintCount >= 1 && fadeCount >= 1 && /左右滑动/.test(hintText), `hint=${hintCount} fade=${fadeCount} text="${hintText}"`)
      }
      const path = `${SHOTS}/${view}-${size.name}.png`
      await page.screenshot(path)
      console.log(`      shot ${path}`)
      if (view === 'admin' && size.w === 390) {
        await sleep(4300)
        const stillThere = await h.count('.kb-adm-table-hint')
        check('admin @390: 提示 4s 后自动消失（计时器无泄漏）', stillThere === 0, `hint=${stillThere}`)
      }
    }
/* --- next edit fragment --- */
/* --------------------------------------------------- 导入图片 / 文件夹 */

const MD_FOLDER = '# 使用手册\n\n登录页：\n\n![登录页](images/02-登录页.png)\n\n缺图：![没有](images/not-there.png)\n'

async function clearSelection(h) {
  await h.clickText('清空选择')
  await new Promise((r) => setTimeout(r, 150))
}

async function lastPreviewRequest() {
  const log = await requestLog()
  return log.filter((x) => x.url === '/api/import/preview').slice(-1)[0]
}

async function phaseIoImages(page, h) {
  console.log('\n—— io：图片 / 文件夹导入 ——')
  await api('/__scenario', { method: 'POST', body: { previewMode: 'images', importMode: 'images' } })
  await h.mount('io', true)
  await page.waitFor("document.querySelectorAll('.kb-adm-drop').length > 0", { timeout: 10000 })

  /* 1) accept 与文件夹输入 */
  const accept = await h.evalIn(`document.querySelectorAll('input[type=file]')[0].getAttribute('accept')`)
  check('io: ACCEPT 含图片扩展名与 MIME', /\.png/.test(accept) && /\.jpg/.test(accept) && /\.svg/.test(accept) && /image\/png/.test(accept), accept)
  check('io: ACCEPT 仍含 md 与 zip', /\.markdown/.test(accept) && /\.zip/.test(accept), accept)
  const dirAttr = await h.evalIn(`document.querySelectorAll('input[type=file]')[1].hasAttribute('webkitdirectory')`)
  const dirMultiple = await h.evalIn(`document.querySelectorAll('input[type=file]')[1].hasAttribute('multiple')`)
  check('io: 「选择文件夹」输入带 webkitdirectory + multiple', dirAttr && dirMultiple, `webkitdirectory=${dirAttr} multiple=${dirMultiple}`)
  const copy = await h.text()
  check('io: 文案说明支持图片与文件夹', /选择整个文件夹/.test(copy) && /图片/.test(copy), copy.split('\n').slice(0, 6).join(' | '))

  /* 2) 组合①：只选 md */
  await h.evalIn(`window.__H.setInputFiles(0, [{ name: 'solo.md', content: '# 只有 md\\n' }])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 1", { timeout: 5000 })
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 1", { timeout: 8000 })
  let req = await lastPreviewRequest()
  check('组合① 只有 md：filename = 文件名', !!req && req.files.length === 1 && req.files[0] === 'solo.md', JSON.stringify(req?.files))
  await h.clickText('取消')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 5000 })
  await clearSelection(h)

  /* 3) 组合②：md + 同目录图片（多选） */
  await h.evalIn(`window.__H.setInputFiles(0, [
    { name: 'note.md', content: '# 图文\\n\\n![pic](pic.png)\\n' },
    { name: 'pic.png', content: 'PNGDATA', type: 'image/png' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 2", { timeout: 5000 })
  const summary2 = await h.text()
  check('组合② md+图片：摘要分别计数', /1 篇笔记 · 1 张图片/.test(summary2), summary2.split('\n').filter((l) => l.includes('已选')).join(' | '))
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 1", { timeout: 8000 })
  req = await lastPreviewRequest()
  check('组合② 多选：filename 为纯文件名（md + 图）', !!req && req.files.join(',') === 'note.md,pic.png', JSON.stringify(req?.files))
  await h.clickText('取消')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 5000 })
  await clearSelection(h)

  /* 4) 组合③：选择文件夹（关键路径：webkitRelativePath 作为 filename） */
  const injected = await h.evalIn(`window.__H.setInputFiles(1, [
    { name: '使用手册.md', path: 'docs/使用手册.md', content: ${JSON.stringify(MD_FOLDER)} },
    { name: '02-登录页.png', path: 'docs/images/02-登录页.png', content: 'PNG-A', type: 'image/png' },
    { name: 'logo.svg', path: 'docs/images/logo.svg', content: '<svg/>', type: 'image/svg+xml' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 3", { timeout: 5000 })
  check(
    '组合③ 文件夹：注入的相对路径被识别',
    JSON.stringify(injected) === JSON.stringify(['docs/使用手册.md', 'docs/images/02-登录页.png', 'docs/images/logo.svg']),
    JSON.stringify(injected),
  )
  const folderText = await h.text()
  check('组合③ 文件夹：摘要 1 篇笔记 · 2 张图片', /1 篇笔记 · 2 张图片/.test(folderText), folderText.split('\n').filter((l) => l.includes('已选')).join(' | '))
  check('组合③ 文件夹：列表显示相对路径（不是只有文件名）', /docs\/images\/02-登录页\.png/.test(folderText))

  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 1", { timeout: 8000 })
  req = await lastPreviewRequest()
  check(
    '组合③ 文件夹：multipart filename 携带相对路径（契约 §2）',
    !!req && req.files.includes('docs/使用手册.md') && req.files.includes('docs/images/02-登录页.png') && req.files.includes('docs/images/logo.svg'),
    JSON.stringify(req?.files),
  )

  /* 5) 缺图明细：醒目但非报错，且不阻断确认 */
  const modalText = await h.evalIn(`document.querySelector('.kb-modal').innerText`)
  check('缺图：弹出「N 张图片找不到」', /3 张图片找不到/.test(modalText), modalText.replace(/\n/g, ' | ').slice(0, 200))
  check(
    '缺图：逐条列出 文件/行号/路径/原因',
    /第 12 行/.test(modalText) && /images\/02-登录页\.png/.test(modalText) && /文件集合里没有这个路径/.test(modalText) && /第 18 行/.test(modalText) && /路径非法/.test(modalText) && /不支持的图片类型/.test(modalText),
    modalText.replace(/\n/g, ' | ').slice(0, 320),
  )
  check('缺图：样式是 warning 而非 error', (await h.count('.kb-adm-missing')) === 1 && (await h.count('.kb-modal .kb-adm-result.is-error')) === 0)
  check('preview 的 imagesImported 展示为「将上传图片」', /将上传图片 2 张/.test(modalText))
  const confirmDisabled = await h.evalIn(`document.querySelector('.kb-modal__footer .kb-btn--primary').disabled`)
  check('缺图不阻断：确认按钮可点', confirmDisabled === false, `disabled=${confirmDisabled}`)

  /* 6) 390px 下缺图明细可读且无横向溢出 */
  await page.setViewport(390, 844)
  await sleep(320)
  const overflow = await h.overflow()
  check('缺图 @390：无横向溢出', overflow.docScroll <= overflow.docClient, `scrollWidth=${overflow.docScroll} clientWidth=${overflow.docClient}`)
  const itemWidths = await h.rects('.kb-adm-missing__item')
  check('缺图 @390：每条明细都在可视宽度内', itemWidths.length === 3 && itemWidths.every((r) => r.w > 0 && r.w <= 350), JSON.stringify(itemWidths))
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot(`${SHOTS}/io-missing-images-390.png`)
  await page.setViewport(1280, 900)
  await sleep(200)

  /* 7) 确认导入 → 结果里的 imagesImported + 缺图 */
  await h.resetCalls()
  await h.clickSel('.kb-modal__footer .kb-btn--primary')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 10000 })
  await page.waitFor("document.querySelectorAll('.kb-adm-result').length > 0", { timeout: 10000 })
  const resultText = await h.text()
  check(
    '结果：导入篇数 + 图片张数 + 缺图',
    /导入 1 篇/.test(resultText) && /图片 3 张/.test(resultText) && /3 张图片找不到/.test(resultText),
    resultText.replace(/\n/g, ' | ').slice(-320),
  )
  check('结果：缺图明细仍在', (await h.count('.kb-adm-result .kb-adm-missing__item')) === 3)
  const resultCalls = await h.calls()
  check('结果：refreshNotes + refreshTree 被调用', resultCalls.refreshNotes >= 1 && resultCalls.refreshTree >= 1, JSON.stringify(resultCalls))

  /* 8) 组合④：单个 zip */
  await api('/__scenario', { method: 'POST', body: { previewMode: 'ok', importMode: 'ok' } })
  await h.evalIn(`window.__H.setInputFiles(0, [{ name: 'backup.zip', content: 'PKzip', type: 'application/zip' }])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 1", { timeout: 5000 })
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 1", { timeout: 8000 })
  req = await lastPreviewRequest()
  check('组合④ 单个 zip：filename = zip 名', !!req && req.files.length === 1 && req.files[0] === 'backup.zip', JSON.stringify(req?.files))
  await h.clickText('取消')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 5000 })

  /* 9) zip + 其它文件 → 只保留 zip（原有约束不回退） */
  await h.evalIn(`window.__H.setInputFiles(0, [
    { name: 'a.md', content: '# a\\n' },
    { name: 'backup.zip', content: 'PK', type: 'application/zip' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 1", { timeout: 5000 })
  const zipOnly = await h.evalIn(`document.querySelector('.kb-adm-file__name').textContent`)
  check('组合：zip 与 md 混选时只保留 zip', zipOnly === 'backup.zip', zipOnly)
  await clearSelection(h)

  /* 10) 拖拽带图片 */
  await h.evalIn(`window.__H.dropFiles([
    { name: 'drop.md', content: '# 拖拽\\n\\n![p](p.png)\\n' },
    { name: 'p.png', content: 'PNGDATA' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 2", { timeout: 5000 })
  const dropText = await h.text()
  check('拖拽：md + 图片都能进来', /1 篇笔记 · 1 张图片/.test(dropText), dropText.split('\n').filter((l) => l.includes('已选')).join(' | '))
  await clearSelection(h)

  /* 11) 纯图片批次：给明确提示而不是「没有可导入的条目」 */
  await h.evalIn(`window.__H.setInputFiles(0, [{ name: 'only.png', content: 'PNGDATA', type: 'image/png' }])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 1", { timeout: 5000 })
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-adm-result').length > 0", { timeout: 8000 })
  const onlyImagesText = await h.text()
  check('纯图片批次：提示要同时选 .md', /只选到了图片/.test(onlyImagesText), onlyImagesText.replace(/\n/g, ' | ').slice(-200))
  await clearSelection(h)

  /* 12) 拖拽文件夹的递归逻辑（假 entry 树） */
  const walked = await h.evalIn(`(async () => {
    const io = window.__H.io
    const mkFile = (path) => new File(['x'], path.split('/').pop())
    const fileEntry = (path) => ({ isFile: true, isDirectory: false, name: path.split('/').pop(), fullPath: '/' + path, file: (cb) => cb(mkFile(path)) })
    const dirEntry = (path, children) => ({
      isFile: false, isDirectory: true, name: path.split('/').pop() || path, fullPath: '/' + path,
      createReader: () => {
        let sent = false
        return { readEntries: (cb) => { if (sent) return cb([]); sent = true; cb(children) } }
      }
    })
    const tree = dirEntry('docs', [
      fileEntry('docs/使用手册.md'),
      dirEntry('docs/images', [
        fileEntry('docs/images/02-登录页.png'),
        dirEntry('docs/images/deep', [fileEntry('docs/images/deep/nested.png')]),
      ]),
    ])
    const files = await io.collectEntryFiles(tree)
    return files.map((f) => io.relativePathOf(f))
  })()`)
  check(
    '拖拽文件夹：递归收集并还原相对路径（3 层嵌套 + readEntries 分页）',
    JSON.stringify(walked) === JSON.stringify(['docs/使用手册.md', 'docs/images/02-登录页.png', 'docs/images/deep/nested.png']),
    JSON.stringify(walked),
  )

  /* 13) 纯逻辑：kindOf / 体积提示 */
  const kinds = await h.evalIn(`(() => {
    const io = window.__H.io
    return {
      md: io.kindOf('a.md'), markdown2: io.kindOf('a.markdown'), png: io.kindOf('x.png'),
      jpg: io.kindOf('x.JPG'), svg: io.kindOf('x.svg'), zip: io.kindOf('x.zip'),
      bmp: io.kindOf('x.bmp'), txt: io.kindOf('x.txt'),
      warn: io.fileSizeWarning(new File([new Uint8Array(21 * 1024 * 1024)], 'big.png', { type: 'image/png' }), (n) => Math.round(n / 1048576) + ' MB'),
    }
  })()`)
  check('kindOf：md/markdown/图片/zip 分类正确', kinds.md === 'markdown' && kinds.markdown2 === 'markdown' && kinds.png === 'image' && kinds.jpg === 'image' && kinds.svg === 'image' && kinds.zip === 'zip', JSON.stringify(kinds))
  check('kindOf：bmp/txt 归为 other（与后端白名单一致）', kinds.bmp === 'other' && kinds.txt === 'other', JSON.stringify(kinds))
  check('超过 20 MB 的图片给出提示', /MB/.test(kinds.warn) && /上限/.test(kinds.warn), kinds.warn)
}

async function main() {
/* --- next edit fragment --- */
    if (MODE === 'error') {
      await phaseErrorStates(page, h)
    } else if (MODE === 'io-images') {
      await h.init()
      await phaseIoImages(page, h)
      const pageErrors = await h.errors()
      check('全局(io-images): 视图无 console 错误', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 300))
    } else if (MODE === 'states') {
/* --- next edit fragment --- */
  check('io 拖拽: 文件列表 + 总大小（文案含笔记/图片计数）', (await h.count('.kb-adm-file')) === 2 && /已选 2 个文件（2 篇笔记 · 0 张图片），共 /.test(filesText), filesText.split('\n').filter((l) => l.includes('已选')).join(' | '))
/* --- next edit fragment --- */
  check(
    'io 边界: total=0 时只展示阻断块（errors 条数取决于后端，不作为必需条件）',
    /没有可导入的条目/.test(errText) && (await h.count('.kb-modal')) === 0 && (await h.count('.kb-adm-preview-list')) === 0,
    `errorItems=${await h.count('.kb-adm-error-list li')} text=${errText.split('\n').filter((l) => /没有可导入|zip/.test(l)).join(' | ')}`,
  )
/* --- next edit fragment --- */
  for (const view of ['stats', 'admin']) {
    await h.mount(view, true)
    let mounted = true
    try {
      await page.waitFor("document.querySelectorAll('.kb-adm-card').length > 0", { timeout: 20000 })
    } catch {
      mounted = false
    }
    if (!mounted) {
      const snapshot = await h.evalIn('document.body.innerText.slice(0, 200)')
      check(`#/${view} 断点截图前挂载成功`, false, `mounted=false body=${snapshot}`)
      continue
    }
/* --- next edit fragment --- */
  /* 6) 四断点：缺图弹窗不产生横向溢出；390px 下明细可读 + 截图 */
  mkdirSync(SHOTS, { recursive: true })
  for (const size of [
    { name: 'desktop-1440', w: 1440, h: 900 },
    { name: 'laptop-1180', w: 1180, h: 800 },
    { name: 'tablet-900', w: 900, h: 700 },
    { name: 'phone-390', w: 390, h: 844 },
  ]) {
    await page.setViewport(size.w, size.h)
    await sleep(300)
    const overflow = await h.overflow()
    check(`缺图弹窗 @${size.w}×${size.h}: 无横向溢出`, overflow.docScroll <= overflow.docClient, `scrollWidth=${overflow.docScroll} clientWidth=${overflow.docClient}`)
    const itemWidths = await h.rects('.kb-adm-missing__item')
    const limit = size.w - 40
    check(`缺图弹窗 @${size.w}: 每条明细都在弹窗宽度内`, itemWidths.length === 3 && itemWidths.every((r) => r.w > 0 && r.w <= limit), JSON.stringify(itemWidths))
    if (size.w === 390) await page.screenshot(`${SHOTS}/io-missing-images-390.png`)
  }
  await page.setViewport(1280, 900)
  await sleep(200)
/* --- next edit fragment --- */
    await page.waitFor('window.__H && window.__H.ready === true', { timeout: 60000 })
    await page.setViewport(1280, 900)
    // Vite 首次加载新增模块可能触发依赖预构建并强制整页重载 —— 先显式重载一次，
    // 让后续断言跑在一个不再自我刷新的页面上（否则会中途 lost-page 超时）。
    await sleep(900)
    await page.send('Page.navigate', { url: HARNESS })
    await sleep(300)
    await page.waitFor('window.__H && window.__H.ready === true', { timeout: 30000 })
/* --- next edit fragment --- */
    await page.waitFor('window.__H && window.__H.ready === true', { timeout: 60000 })
    await page.setViewport(1280, 900)
/* --- next edit fragment --- */
  await h.setInput('.kb-modal .kb-field:nth-of-type(1) input', 'QA 验收用户（改）')
  before = (await requestLog()).length
  await h.clickText('保存')
  let saved = true
  try {
    await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 8000 })
  } catch {
    saved = false
  }
  if (!saved) {
    // 弹窗没关 = 保存失败（我的视图会保留弹窗并显示行内错误）；把错误原文带出来，
    // 便于区分「产品缺陷」与「测试实例被重启/网络抖动」
    const stillOpen = await h.evalIn(`document.querySelector('.kb-modal') ? document.querySelector('.kb-modal').innerText : '(已关闭)'`)
    check('admin 编辑: 保存后关闭弹窗', false, `仍打开，内容=${stillOpen.replace(/\n/g, ' | ').slice(0, 200)}`)
  }
  log = (await requestLog()).slice(before)
/* --- next edit fragment --- */
async function clearSelection(h) {
  await h.clickText('清空选择')
  await new Promise((r) => setTimeout(r, 150))
}

/** 填表并回读校验（React 受控输入偶发丢事件：不校验就会出现「字段是空的」这种假结果） */
async function fill(page, h, selector, value) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await h.setInput(selector, value)
    await new Promise((r) => setTimeout(r, 60))
    const got = await h.evalIn(`document.querySelector(${JSON.stringify(selector)})?.value ?? ''`)
    if (got === value) return true
  }
  return false
}
/* --- next edit fragment --- */
  const passed = results.filter((r) => r.ok).length
  console.log(`\nRESULT passed ${passed}/${results.length}`)
  if (passed !== results.length) {
    console.log('FAILED:')
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name} >> ${r.extra}`)
    process.exit(1)
  }
  // 退出码只跟随断言结论：浏览器关闭时页面里可能还有在途 fetch，
  // 它 reject 成的未捕获异常会把退出码翻成 1（机器负载高时尤其明显）。
  process.exit(0)
}

process.on('unhandledRejection', (reason) => {
  console.log(`(忽略退出阶段的未捕获异常: ${String(reason).slice(0, 120)})`)
})

await main()
/* --- next edit fragment --- */
  const confirmDisabled = await h.evalIn(`document.querySelector('.kb-modal__footer .kb-btn--primary').disabled`)
  check('缺图不阻断：确认按钮可点', confirmDisabled === false, `disabled=${confirmDisabled}`)

  /* 5b) 引导：文案说清「原因 + 动作」，按钮能打开文件夹选择器并清空已有选择 */
  check(
    '缺图引导：文案说清原因（没被选中 / 浏览器找不到磁盘）',
    /这次没有被选中/.test(modalText) && /浏览器无法自己去磁盘找/.test(modalText) && /把图片所在的目录一起选上/.test(modalText),
    modalText.replace(/\n/g, ' | ').slice(0, 300),
  )
  check('缺图引导：面板里有「改用选择文件夹」按钮', (await h.count('.kb-adm-missing__guide .kb-btn')) === 1 && /改用选择文件夹/.test(modalText))
  const guideDisabled = await h.evalIn(`document.querySelector('.kb-adm-missing__guide .kb-btn').disabled`)
  check('缺图引导：按钮可点', guideDisabled === false, `disabled=${guideDisabled}`)

  await h.resetInputClicks()
  const filesBeforeSwitch = await h.evalIn(`Array.from(document.querySelectorAll('.kb-adm-file__name')).map(n => n.textContent)`)
  await h.clickSel('.kb-adm-missing__guide .kb-btn')
  await sleep(250)
  const clicks = await h.inputClicks()
  const folderInputIndex = await h.evalIn(
    `Array.from(document.querySelectorAll('input[type=file]')).findIndex(i => i.hasAttribute('webkitdirectory'))`,
  )
  check(
    '缺图引导：点按钮打开了文件夹选择器（webkitdirectory input 被 click）',
    clicks.length === 1 && clicks[0].webkitdirectory === true && clicks[0].index === folderInputIndex && clicks[0].connected === true,
    `clicks=${JSON.stringify(clicks)} folderInputIndex=${folderInputIndex}`,
  )
  const afterSwitch = await h.evalIn(`({
    files: Array.from(document.querySelectorAll('.kb-adm-file__name')).map(n => n.textContent),
    modal: document.querySelectorAll('.kb-modal').length,
    summary: document.querySelectorAll('.kb-adm-summary').length,
  })`)
  check(
    '缺图引导：点按钮后已有选择被清空、预览弹窗关闭',
    afterSwitch.files.length === 0 && afterSwitch.modal === 0 && afterSwitch.summary === 0,
    `before=${JSON.stringify(filesBeforeSwitch)} after=${JSON.stringify(afterSwitch)}`,
  )

  /* 5c) 改选文件夹后缺图清零（mock 切成「图都找得到」的响应） */
  await api('/__scenario', { method: 'POST', body: { previewMode: 'imagesResolved' } })
  const folderPicked = await h.evalIn(`window.__H.setInputFiles(${folderInputIndex}, [
    { name: '使用手册.md', path: 'docs/使用手册.md', content: 'x' },
    { name: '02-登录页.png', path: 'docs/images/02-登录页.png', content: 'PNG-A', type: 'image/png' },
    { name: 'logo.svg', path: 'docs/images/logo.svg', content: '<svg/>', type: 'image/svg+xml' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 3", { timeout: 5000 })
  check(
    '缺图引导：改用选择文件夹后拿到的是带相对路径的整批文件',
    JSON.stringify(folderPicked) === JSON.stringify(['docs/使用手册.md', 'docs/images/02-登录页.png', 'docs/images/logo.svg']),
    JSON.stringify(folderPicked),
  )
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 1", { timeout: 8000 })
  const resolvedText = await h.evalIn(`document.querySelector('.kb-modal').innerText`)
  check(
    '缺图引导：改选文件夹后缺图清零、面板消失',
    !/张图片找不到/.test(resolvedText) && (await h.count('.kb-adm-missing')) === 0 && /将上传图片 3 张/.test(resolvedText),
    resolvedText.replace(/\n/g, ' | ').slice(0, 240),
  )
  await h.clickText('取消')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 5000 })
  await clearSelection(h)
  await api('/__scenario', { method: 'POST', body: { previewMode: 'images', importMode: 'images' } })

  /* 6) 四断点：缺图弹窗不产生横向溢出；390px 下明细可读 + 截图 */
/* --- next edit fragment --- */
/* ---------------------------------------------- 真后端：缺图 → 引导 → 改选文件夹 */

async function phaseIoReal(page, h) {
  console.log('\n—— io：真后端（用户场景）只选 .md → 引导 → 改用选择文件夹 ——')
  await h.mount('io', true)
  await page.waitFor("document.querySelectorAll('.kb-adm-drop').length > 0", { timeout: 10000 })
  const stamp = String(Date.now()).slice(-6)
  const title = `QA-引导-${stamp}`
  const md = `# ${title}\n\n登录页：\n\n![登录页](images/02-登录页.png)\n\n真缺的图：![没有](images/not-there-${stamp}.png)\n`

  /* 1) 只选 .md —— 用户截图里的场景 */
  await h.evalIn(`window.__H.setInputFiles(0, [{ name: '${title}.md', content: ${JSON.stringify(md)} }])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 1", { timeout: 5000 })
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-adm-missing').length === 1", { timeout: 15000 })
  const modalText = await h.evalIn(`document.querySelector('.kb-modal').innerText`)
  check('真后端·只选 md：出现缺图面板', /张图片找不到/.test(modalText), modalText.replace(/\n/g, ' | ').slice(0, 200))
  check(
    '真后端·只选 md：文案给出原因与动作',
    /这次没有被选中/.test(modalText) && /浏览器无法自己去磁盘找/.test(modalText) && /把图片所在的目录一起选上/.test(modalText),
    modalText.replace(/\n/g, ' | ').slice(0, 260),
  )
  check('真后端·只选 md：明细完整（文件/行号/路径/原因）', /第 \d+ 行/.test(modalText) && /images\/02-登录页\.png/.test(modalText) && /文件集合里没有这个路径/.test(modalText), modalText.replace(/\n/g, ' | ').slice(0, 320))
  check('真后端·只选 md：确认按钮未被阻断', (await h.evalIn(`document.querySelector('.kb-modal__footer .kb-btn--primary').disabled`)) === false)
  mkdirSync(SHOTS, { recursive: true })
  await page.setViewport(390, 844)
  await sleep(300)
  const overflow390 = await h.overflow()
  check('真后端·缺图面板 @390×844：无横向溢出', overflow390.docScroll <= overflow390.docClient, `scrollWidth=${overflow390.docScroll} clientWidth=${overflow390.clientWidth}`)
  const guideRects = await h.rects('.kb-adm-missing__guide .kb-btn')
  check('真后端·缺图面板 @390：引导按钮可见且可点', guideRects.length === 1 && guideRects[0].w > 0 && guideRects[0].h >= 24, JSON.stringify(guideRects))
  await page.screenshot(`${SHOTS}/io-missing-guide-390.png`)
  await page.setViewport(1280, 900)
  await sleep(200)

  /* 2) 点「改用选择文件夹」 */
  await h.resetInputClicks()
  const before = await h.evalIn(`Array.from(document.querySelectorAll('.kb-adm-file__name')).map(n => n.textContent)`)
  await h.clickSel('.kb-adm-missing__guide .kb-btn')
  await sleep(250)
  const clicks = await h.inputClicks()
  const folderIndex = await h.evalIn(`Array.from(document.querySelectorAll('input[type=file]')).findIndex(i => i.hasAttribute('webkitdirectory'))`)
  check(
    '真后端·点引导按钮：打开文件夹选择器',
    clicks.length === 1 && clicks[0].webkitdirectory === true && clicks[0].index === folderIndex,
    `clicks=${JSON.stringify(clicks)} folderIndex=${folderIndex}`,
  )
  const after = await h.evalIn(`({
    files: Array.from(document.querySelectorAll('.kb-adm-file__name')).map(n => n.textContent),
    modal: document.querySelectorAll('.kb-modal').length,
  })`)
  check('真后端·点引导按钮：已有选择被清空', after.files.length === 0 && after.modal === 0, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

  /* 3) 改选整个文件夹（docs/ 里带 images/） */
  const picked = await h.evalIn(`window.__H.setInputFiles(${folderIndex}, [
    { name: '${title}.md', path: 'docs/${title}.md', content: ${JSON.stringify(md)} },
    { name: '02-登录页.png', path: 'docs/images/02-登录页.png', content: 'PNGDATA', type: 'image/png' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 2", { timeout: 5000 })
  check('真后端·改选文件夹：拿到带相对路径的两条', JSON.stringify(picked) === JSON.stringify([`docs/${title}.md`, 'docs/images/02-登录页.png']), JSON.stringify(picked))
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 1", { timeout: 15000 })
  await sleep(400)
  const resolved = await h.evalIn(`document.querySelector('.kb-modal').innerText`)
  const resolvedMissing = await h.count('.kb-adm-missing')
  check(
    '真后端·改选文件夹后：缺图清零（真缺的那张除外）',
    resolvedMissing === 1 && /1 张图片找不到/.test(resolved) && /not-there-/.test(resolved),
    `missingBlocks=${resolvedMissing} text=${resolved.replace(/\n/g, ' | ').slice(0, 240)}`,
  )
  check('真后端·改选文件夹后：02-登录页.png 不再是缺图', !/02-登录页\.png\s*\|/.test(resolved), resolved.replace(/\n/g, ' | ').slice(0, 240))
  await h.clickText('导入 1 篇')
  await page.waitFor("document.querySelectorAll('.kb-modal').length === 0", { timeout: 20000 })
  await page.waitFor("document.querySelectorAll('.kb-adm-result').length > 0", { timeout: 20000 })
  const resultText = await h.text()
  check('真后端·改选文件夹后：图片真的上传', /图片 1 张/.test(resultText), resultText.replace(/\n/g, ' | ').slice(-260))

  /* 4) 图片可取回（走页面自己的 /api 通道） */
  const fetched = await h.evalIn(`(async () => {
    const list = await (await fetch('/api/notes?size=200&sort=updated')).json()
    const note = (list.items || []).find((n) => n.title === ${JSON.stringify(title)})
    if (!note) return { found: false }
    const detail = await (await fetch('/api/notes/' + note.id)).json()
    const ref = (/!\\[[^\\]]*\\]\\(([^)]+)\\)/.exec(detail.content || '') || [])[1] || ''
    const res = ref ? await fetch(ref) : null
    const bytes = res ? (await res.arrayBuffer()).byteLength : 0
    return { found: true, id: note.id, ref, status: res ? res.status : 0, bytes, hasRelative: (detail.content || '').includes('images/02-登录页.png') }
  })()`)
  check(
    '真后端·图片可取回且引用已重写',
    fetched.found && /^\/api\/attachments\/\d+$/.test(fetched.ref) && fetched.status === 200 && fetched.bytes > 0 && fetched.hasRelative === false,
    JSON.stringify(fetched),
  )

  /* 5) 自清理 */
  const cleaned = await h.evalIn(`(async () => {
    const list = await (await fetch('/api/notes?size=200&sort=updated')).json()
    const mine = (list.items || []).filter((n) => /^QA[- ]/.test(n.title))
    for (const note of mine) {
      const detail = await (await fetch('/api/notes/' + note.id)).json()
      const refs = [...(detail.content || '').matchAll(/!\\[[^\\]]*\\]\\(([^)]+)\\)/g)].map((m) => m[1])
      await fetch('/api/notes/' + note.id, { method: 'DELETE' })
      await fetch('/api/trash/notes/' + note.id, { method: 'DELETE' })
      for (const ref of refs) await fetch(ref, { method: 'DELETE' })
    }
    const after = await (await fetch('/api/notes?size=200&sort=updated')).json()
    return { removed: mine.length, left: (after.items || []).filter((n) => /^QA[- ]/.test(n.title)).length }
  })()`)
  check('真后端·自清理：QA 夹具清零', cleaned.left === 0, JSON.stringify(cleaned))
  console.log(`      cleanup: 真后端清理 ${cleaned.removed} 条 QA-*`)
}

async function main() {
/* --- next edit fragment --- */
    } else if (MODE === 'io-real') {
      await h.init()
      await phaseIoReal(page, h)
      const pageErrors = await h.errors()
      check('全局(io-real): 视图无 console 错误', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 300))
    } else if (MODE === 'io-images') {
/* --- next edit fragment --- */
/* ------------------------------------------------ 单篇导出改成 ZIP */

async function phaseExportZip(page, h) {
  console.log('\n—— io：单篇导出 ZIP ——')
  await h.mount('io', true)
  await page.waitFor("document.querySelectorAll('.kb-adm-io-row').length >= 2", { timeout: 10000 })

  const copy = await h.text()
  check(
    '单篇导出：卡片描述说明含正文+图片',
    /导出为 ZIP（含正文 \+ 这篇用到的图片，解压后图片能直接显示）/.test(copy),
    copy.split('\n').filter((l) => /ZIP|图片/.test(l)).join(' | ').slice(0, 240),
  )
  check('单篇导出：按钮文案是「导出 ZIP」', /导出 ZIP/.test(copy) && (await h.count('.kb-adm-io-row__control .kb-btn')) >= 1)
  check('单篇导出：不再有「导出 .md」按钮', !(await h.evalIn(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '导出 .md')`)))
  const subtitle = await h.evalIn(`document.querySelector('.kb-adm__sub').textContent`)
  check('页面副标题与实际行为一致（提到 ZIP 与图片）', /ZIP/.test(subtitle) && /图片/.test(subtitle), subtitle)

  const options = await h.evalIn(`Array.from(document.querySelectorAll('select option')).map(o => o.value).filter(v => v)`)
  check('可选择要导出的笔记', options.length >= 1, JSON.stringify(options))
  await h.evalIn(`(() => {
    const sel = document.querySelector('.kb-adm-io-row__control select')
    sel.value = ${JSON.stringify(options[0])}
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return sel.value
  })()`)
  await sleep(200)
  await h.resetCalls()
  await h.clickText('导出 ZIP')
  await sleep(200)
  const after = await h.calls()
  const last = after.anchorClicks[after.anchorClicks.length - 1] ?? ''
  check(
    '点「导出 ZIP」发起 /api/export/notes/{id}.zip',
    new RegExp(`^/api/export/notes/${options[0]}\\.zip$`).test(last),
    `href=${last} all=${JSON.stringify(after.anchorClicks)}`,
  )

  await h.resetCalls()
  await h.clickText('导出全部（ZIP）')
  await sleep(200)
  const allCalls = await h.calls()
  check('整库导出仍调 /api/export/all', allCalls.anchorClicks.includes('/api/export/all'), JSON.stringify(allCalls.anchorClicks))

  const dl = await h.evalIn(`(async () => {
    const res = await fetch('/api/export/notes/${options[0]}.zip')
    const buf = new Uint8Array(await res.arrayBuffer())
    return { status: res.status, len: buf.length, head: String.fromCharCode(buf[0], buf[1]), type: res.headers.get('content-type'), cd: res.headers.get('content-disposition') }
  })()`)
  check(
    '该 URL 返回合法 ZIP（前两字节 PK）',
    dl.status === 200 && dl.head === 'PK' && dl.len > 100 && /zip/.test(String(dl.type)) && /attachment/.test(String(dl.cd)),
    JSON.stringify(dl),
  )

  mkdirSync(SHOTS, { recursive: true })
  for (const size of [
    { name: 'desktop-1440', w: 1440, h: 900 },
    { name: 'laptop-1180', w: 1180, h: 800 },
    { name: 'tablet-900', w: 900, h: 700 },
    { name: 'phone-390', w: 390, h: 844 },
  ]) {
    await page.setViewport(size.w, size.h)
    await sleep(320)
    const ov = await h.overflow()
    check(`导出区 @${size.w}×${size.h}: 无横向溢出`, ov.docScroll <= ov.docClient, `scrollWidth=${ov.docScroll} clientWidth=${ov.docClient}`)
    const btn = await h.rects('.kb-adm-io-row__control .kb-btn')
    check(`导出按钮 @${size.w}: 可见可点`, btn.length === 1 && btn[0].w > 0 && btn[0].h >= 28, JSON.stringify(btn))
    if (size.w === 390) await page.screenshot(`${SHOTS}/io-export-zip-390.png`)
  }
  await page.setViewport(1280, 900)
  await sleep(150)
}

async function main() {
/* --- next edit fragment --- */
    } else if (MODE === 'export-zip') {
      await h.init()
      await phaseExportZip(page, h)
      const pageErrors = await h.errors()
      check('全局(export-zip): 视图无 console 错误', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 300))
    } else if (MODE === 'io-real') {
/* --- next edit fragment --- */
    calls: () => evalIn('JSON.parse(JSON.stringify(window.__H.calls))'),
    errors: () => evalIn('JSON.parse(JSON.stringify(window.__H.errors))'),
    inputClicks: () => evalIn('JSON.parse(JSON.stringify(window.__H.inputClicks()))'),
    resetInputClicks: () => evalIn('window.__H.resetInputClicks()'),
/* --- next edit fragment --- */
  /* 6) 四断点：缺图弹窗不产生横向溢出；390px 下明细可读 + 截图 */
  /* 引导按钮会清空选择并关掉弹窗（这正是它的行为）—— 重新选一遍再预览，供断点检查 */
  await h.evalIn(`window.__H.setInputFiles(1, [
    { name: '使用手册.md', path: 'docs/使用手册.md', content: 'x' },
    { name: '02-登录页.png', path: 'docs/images/02-登录页.png', content: 'PNG-A', type: 'image/png' },
    { name: 'logo.svg', path: 'docs/images/logo.svg', content: '<svg/>', type: 'image/svg+xml' }
  ])`)
  await page.waitFor("document.querySelectorAll('.kb-adm-file').length === 3", { timeout: 5000 })
  await h.clickText('预览导入内容')
  await page.waitFor("document.querySelectorAll('.kb-adm-missing').length === 1", { timeout: 8000 })
  await sleep(200)
  mkdirSync(SHOTS, { recursive: true })