/**
 * 导入导出的前端契约层（docs/IMPORT-IMAGES.md §6 / §8）。
 *
 * 为什么单独一个文件：本轮新增的响应字段（imagesImported / missingImages）
 * 不能加进 `@/api/types`（Lead 冻结、且 §11 未授权），所以在这里做类型增补；
 * 顺带把「相对路径 filename」「拖拽文件夹递归」这些可独立测试的逻辑收敛到一处。
 */
import type { FolderNode, ImportPreviewResponse, ImportResult } from '@/api/types'

/* ---------------------------------------------------------------- 类型增补 */

/** 契约 §6.2：找不到的图片引用（preview 与导入结果都会给） */
export interface MissingImage {
  sourceFile: string
  title: string
  /** 引用出现在第几行（1 起） */
  line: number
  /** 正文里写的路径 */
  target: string
  /** 文件集合里没有这个路径 / 路径非法 / 不支持的图片类型 / 暂不支持引用式写法 / 超过单文件上限 */
  reason: string
}

export interface ImportPreview extends ImportPreviewResponse {
  /** preview 阶段是「如果现在导入会上传几张」 */
  imagesImported?: number
  missingImages?: MissingImage[]
}

export interface ImportSummary extends ImportResult {
  imagesImported?: number
  missingImages?: MissingImage[]
}

/* ------------------------------------------------------- 文件类型与体积 */

/** 与后端 AttachmentTypes 白名单对齐（png/jpg/jpeg/gif/webp/bmp/avif/svg；tiff/heic 不在白名单内） */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg']
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown']
export const ZIP_EXTENSIONS = ['.zip']

/** 单个附件上限（API.md §7：20 MB），图片超限时服务端会计入 missingImages */
export const IMAGE_LIMIT_BYTES = 20 * 1024 * 1024
/** 一批导入的总量提示阈值（契约 §9：总量 200 MB 由服务端裁决） */
export const BATCH_LIMIT_BYTES = 200 * 1024 * 1024

export const IMPORT_ACCEPT = [
  ...MARKDOWN_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...ZIP_EXTENSIONS,
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
  'application/zip',
].join(',')

export type FileKind = 'markdown' | 'image' | 'zip' | 'other'

export function extensionOf(name: string): string {
  const match = /(\.[a-z0-9]+)$/i.exec(String(name ?? ''))
  return match ? match[1].toLowerCase() : ''
}

export function kindOf(name: string): FileKind {
  const ext = extensionOf(name)
  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (ZIP_EXTENSIONS.includes(ext)) return 'zip'
  return 'other'
}

export function isImage(name: string): boolean {
  return kindOf(name) === 'image'
}

export interface BatchSummary {
  markdown: number
  image: number
  zip: number
  totalBytes: number
}

export function summarize(files: File[]): BatchSummary {
  const summary: BatchSummary = { markdown: 0, image: 0, zip: 0, totalBytes: 0 }
  for (const file of files) {
    const kind = kindOf(file.name)
    if (kind === 'markdown') summary.markdown += 1
    else if (kind === 'image') summary.image += 1
    else if (kind === 'zip') summary.zip += 1
    summary.totalBytes += file.size || 0
  }
  return summary
}

/** 单文件体积提示（'' = 没问题） */
export function fileSizeWarning(file: File, formatBytes: (n: number) => string): string {
  const kind = kindOf(file.name)
  if (kind === 'image' && file.size > IMAGE_LIMIT_BYTES) {
    return `超过单文件 ${formatBytes(IMAGE_LIMIT_BYTES)} 上限，服务端会记为缺图`
  }
  if (kind === 'zip' && file.size > BATCH_LIMIT_BYTES) {
    return `超过 ${formatBytes(BATCH_LIMIT_BYTES)} 上限，服务端会拒绝`
  }
  if (kind === 'markdown' && file.size > 20 * 1024 * 1024) return '文件较大，导入可能需要更久'
  return ''
}

/* ------------------------------------------------------------ 相对路径 */

/**
 * 提交时 multipart 的 filename（契约 §2）：
 * 文件夹选择用 `webkitRelativePath`（形如 `docs/images/a.png`），多选只有文件名。
 */
export function relativePathOf(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return path && path.length > 0 ? path : file.name
}

/**
 * 构造 multipart。`targetFolderId` 是「导入到哪一级目录」：
 * 不传/空 = 现有行为（按文件自带目录或未分类）；传 id = 以该目录为根，子目录挂在其下。
 */
export function buildImportFormData(files: File[], targetFolderId?: number | null): FormData {
  const form = new FormData()
  if (targetFolderId != null) form.append('targetFolderId', String(targetFolderId))
  for (const file of files) form.append('file', file, relativePathOf(file))
  return form
}

/** 目录下拉选项：value 是 id，label 带层级缩进，path 是完整路径（确认弹窗里回显）。 */
export interface FolderOption {
  value: string
  label: string
  path: string
}

export function flattenFolderOptions(tree: FolderNode[], depth = 0, parentPath = ''): FolderOption[] {
  const options: FolderOption[] = []
  for (const node of tree) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name
    options.push({ value: String(node.id), label: `${'\u3000'.repeat(depth)}${node.name}`, path })
    options.push(...flattenFolderOptions(node.children, depth + 1, path))
  }
  return options
}

/* --------------------------------------------------- 拖拽（文件 + 文件夹） */

/** `webkitGetAsEntry()` 返回的对象形状（只声明用到的部分，便于用假对象测试递归） */
export interface DroppedEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  /** 形如 `/docs/images/a.png`；拖拽文件夹时它是唯一能还原相对路径的来源 */
  fullPath?: string
  file?: (onFile: (file: File) => void, onError?: (error: unknown) => void) => void
  createReader?: () => {
    readEntries: (onEntries: (entries: DroppedEntry[]) => void, onError?: (error: unknown) => void) => void
  }
}

const MAX_DEPTH = 16
const MAX_ENTRIES = 20000

function readDirectory(entry: DroppedEntry): Promise<DroppedEntry[]> {
  const reader = entry.createReader?.()
  if (!reader) return Promise.resolve([])
  // readEntries 一次最多返回 100 条，必须循环读到空
  return new Promise((resolve) => {
    const collected: DroppedEntry[] = []
    const pump = () => {
      reader.readEntries(
        (batch) => {
          if (!batch || batch.length === 0 || collected.length >= MAX_ENTRIES) return resolve(collected)
          collected.push(...batch)
          pump()
        },
        () => resolve(collected),
      )
    }
    pump()
  })
}

function fileOf(entry: DroppedEntry): Promise<File | null> {
  const readFile = entry.file
  if (!readFile) return Promise.resolve(null)
  return new Promise((resolve) => {
    readFile(
      (file) => {
        // 拖拽进来的 File 没有 webkitRelativePath，用 entry.fullPath 还原相对路径。
        // 注意要判断**原始属性**是否为空，不能拿 relativePathOf()（它会回退到 name，永远非空）。
        const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        if (entry.fullPath && !raw) {
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: entry.fullPath.replace(/^\/+/, ''),
              configurable: true,
            })
          } catch {
            /* 无法补路径时按文件名提交 */
          }
        }
        resolve(file)
      },
      () => resolve(null),
    )
  })
}

/** 递归收集一个拖拽条目下的全部文件（文件夹按相对路径保留层级） */
export async function collectEntryFiles(entry: DroppedEntry, depth = 0): Promise<File[]> {
  if (!entry || depth > MAX_DEPTH) return []
  if (entry.isFile) {
    const file = await fileOf(entry)
    return file ? [file] : []
  }
  if (entry.isDirectory) {
    const children = await readDirectory(entry)
    const nested = await Promise.all(children.map((child) => collectEntryFiles(child, depth + 1)))
    return nested.flat()
  }
  return []
}

/**
 * 从 drop 事件取文件：优先 webkitGetAsEntry() 递归（可带文件夹），
 * 拿不到条目（或递归结果为空）时退回 dataTransfer.files。
 */
export async function collectDroppedFiles(
  dataTransfer: DataTransfer | null,
  fallback: FileList | null,
): Promise<File[]> {
  const entries: DroppedEntry[] = []
  const items = dataTransfer?.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null })
        .webkitGetAsEntry
      const entry = getter ? getter.call(item) : null
      if (entry) entries.push(entry)
    }
  }
  if (entries.length === 0) return fallback ? Array.from(fallback) : []

  const groups = await Promise.all(entries.map((entry) => collectEntryFiles(entry)))
  const files = groups.flat()
  if (files.length === 0 && fallback) return Array.from(fallback)
  return files
}
