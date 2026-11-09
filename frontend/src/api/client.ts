/**
 * 统一 HTTP 传输层：同源凭据、结构化错误、401 全局回调。
 * 契约：错误响应形状 {"error":{"code","message"}}（PROTOTYPE.md §5）
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null

  constructor(status: number, code: string, message: string, field: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

/** 注册「会话失效 → 回登录页」回调（由 App 挂载时调用） */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** JSON 请求体 */
  body?: unknown
  /** multipart 请求体（与 body 互斥） */
  formData?: FormData
  signal?: AbortSignal
  /** 401 时不触发全局回登录页回调：用于会话探测与登录接口本身 */
  expectUnauthorized?: boolean
}

interface ErrorPayload {
  code: string
  message: string
  field: string | null
}

const FALLBACK_MESSAGE: Record<number, string> = {
  400: '请求参数有误',
  401: '登录状态已过期，请重新登录',
  403: '你没有权限做这个操作（这篇笔记可能在其他空间）',
  404: '请求的资源不存在',
  409: '与现有数据冲突',
  413: '文件超出大小限制',
  429: '操作过于频繁，请稍后再试',
  500: '服务端出错了',
}

async function readText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function parseErrorPayload(status: number, text: string): ErrorPayload {
  let code = `HTTP_${status}`
  let message = FALLBACK_MESSAGE[status] ?? `请求失败（HTTP ${status}）`
  let field: string | null = null

  if (text) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        const error = (parsed as { error?: unknown }).error
        if (error && typeof error === 'object') {
          const envelope = error as Record<string, unknown>
          if (typeof envelope.code === 'string' && envelope.code) code = envelope.code
          if (typeof envelope.message === 'string' && envelope.message) message = envelope.message
          if (typeof envelope.field === 'string' && envelope.field) field = envelope.field
        }
      }
    } catch {
      /* 非 JSON 错误体：保留按状态码推导的文案 */
    }
  }

  return { code, message, field }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal, expectUnauthorized = false } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  let payload: BodyInit | undefined

  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请确认后端是否正在运行')
  }

  if (!response.ok) {
    if (response.status === 401 && !expectUnauthorized) unauthorizedHandler?.()
    const text = await readText(response)
    const { code, message, field } = parseErrorPayload(response.status, text)
    throw new ApiError(response.status, code, message, field)
  }

  if (response.status === 204) return undefined as T


  const text = await readText(response)
  if (!text) return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', '服务端返回了无法解析的数据')
  }
}

/** 把任意异常转成可展示的中文文案 */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '未知错误'
}