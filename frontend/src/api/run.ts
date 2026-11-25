/** P2 运行生命周期：异步启动 / 进度 / 取消（同步 POST /run 仍是默认）。 */
import { request } from './client'

export interface RunProgress {
  runId: number
  status: string
  stage: string
  stageLabel: string
  done: number
  total: number
  cancelled: boolean
  startedAt: string
  finishedAt: string | null
}

export interface AsyncStart {
  runId: number
  status: string
}

export function startRunAsync(module: 'briefing' | 'weekly', signal?: AbortSignal): Promise<AsyncStart> {
  return request<AsyncStart>(`/api/${module}/run?async=true`, { method: 'POST', signal })
}

export function getProgress(module: 'briefing' | 'weekly', runId: number, signal?: AbortSignal): Promise<RunProgress> {
  return request<RunProgress>(`/api/runs/${module}/${runId}/progress`, { signal })
}

export function cancelRun(module: 'briefing' | 'weekly', runId: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/runs/${module}/${runId}/cancel`, { method: 'POST' })
}

export function isTerminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}
