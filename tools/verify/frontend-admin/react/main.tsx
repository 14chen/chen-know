import type { NoteListItem } from '@/api/types'
import * as ioApi from '@/api/io'
import type { ViewContext, ViewProps } from '@/views/types'
/* --- next edit fragment --- */
interface HarnessApi {
  ready: boolean
  init: () => Promise<number>
  io: typeof ioApi
  mount: (viewId: string, isAdmin: boolean) => Promise<boolean>
/* --- next edit fragment --- */
const api: HarnessApi = {
  ready: false,
  io: ioApi,
  async init() {
/* --- next edit fragment --- */
  setFiles: (names: { name: string; content: string }[]) => void
  dropFiles: (names: { name: string; content: string }[]) => void
  /** 往第 index 个 <input type=file> 注入文件（可带 webkitRelativePath，模拟「选择文件夹」） */
  setInputFiles: (
    index: number,
    specs: { name: string; path?: string; content: string; type?: string }[],
  ) => string[]
}
/* --- next edit fragment --- */
  setFiles(fileSpecs) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!input) throw new Error('no file input')
    const transfer = new DataTransfer()
    for (const spec of fileSpecs) {
      transfer.items.add(new File([spec.content], spec.name, { type: 'text/markdown' }))
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  },
  setInputFiles(index, specs) {
    const inputs = document.querySelectorAll('input[type="file"]')
    const input = inputs[index] as HTMLInputElement | undefined
    if (!input) throw new Error(`no file input at index ${index}`)
    const files = specs.map((spec) => {
      const file = new File([spec.content], spec.name, { type: spec.type ?? 'text/markdown' })
      if (spec.path) {
        Object.defineProperty(file, 'webkitRelativePath', { value: spec.path, configurable: true })
      }
      return file
    })
    // 直接注入 files（DataTransfer 会克隆 File、丢掉自定义的 webkitRelativePath）
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return files.map((file) => ioApi.relativePathOf(file))
  },
/* --- next edit fragment --- */
/* 拦截 <a>.click()：断言「浏览器导航下载」的目标 URL，而不真的触发下载 */
const originalAnchorClick = HTMLAnchorElement.prototype.click
HTMLAnchorElement.prototype.click = function patchedClick(this: HTMLAnchorElement) {
  calls.anchorClicks.push(this.getAttribute('href') ?? '')
}

/* 拦截 <input type=file>.click()：断言「打开文件夹选择器」真的点到了哪个 input */
const inputClicks: { index: number; webkitdirectory: boolean; multiple: boolean; connected: boolean }[] = []
const originalInputClick = HTMLInputElement.prototype.click
HTMLInputElement.prototype.click = function patchedInputClick(this: HTMLInputElement) {
  if (this.type === 'file') {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
    const index = inputs.indexOf(this)
    inputClicks.push({
      index,
      webkitdirectory: this.hasAttribute('webkitdirectory'),
      multiple: this.hasAttribute('multiple'),
      connected: this.isConnected,
    })
    // 不真的打开原生对话框（headless 下会挂住）：只记录，不转发
    return
  }
  return originalInputClick.call(this)
}

/* --- next edit fragment --- */
  setFiles: (names: { name: string; content: string }[]) => void
  dropFiles: (names: { name: string; content: string }[]) => void
  /** 被点过的 <input type=file>（用于断言「改用选择文件夹」真的打开了文件夹选择器） */
  inputClicks: () => { index: number; webkitdirectory: boolean; multiple: boolean; connected: boolean }[]
  resetInputClicks: () => void
/* --- next edit fragment --- */
  queueConfirm(results) {
/* --- next edit fragment --- */
  queueConfirm(results) {
    confirmResults = [...results]
  },
  inputClicks: () => inputClicks.slice(),
  resetInputClicks() {
    inputClicks.length = 0
  },