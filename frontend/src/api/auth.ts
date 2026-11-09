import { ApiError, request } from './client'
import type { User } from './types'

/** GET /api/auth/me —— 401 视为「未登录」，不作为错误抛出 */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<User | null> {
  try {
    return await request<User>('/api/auth/me', { expectUnauthorized: true, signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/** POST /api/auth/login —— 成功后服务端下发 KB_SESSION Cookie */
export function login(username: string, password: string): Promise<User> {
  return request<User>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    expectUnauthorized: true,
  })
}

/** POST /api/auth/logout —— 204 */
export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST', expectUnauthorized: true })
}

/** POST /api/auth/register 请求体（API.md §1） */
export interface RegisterRequest {
  username: string
  displayName: string
  password: string
  /** 库中已有用户时必填；首位用户可省略（免邀请码并成为 admin） */
  inviteCode?: string
}

/**
 * POST /api/auth/register —— 201 只创建账号，**不下发会话**（API.md §1）。
 * 调用方必须在成功后自行再调一次 `login()` 才能进入已登录状态。
 */
export function register(payload: RegisterRequest): Promise<User> {
  return request<User>('/api/auth/register', {
    method: 'POST',
    body: payload,
    expectUnauthorized: true,
  })
}
