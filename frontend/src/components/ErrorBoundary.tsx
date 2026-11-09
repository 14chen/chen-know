import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export interface ErrorBoundaryProps {
  children: ReactNode
  /** 出错时的降级 UI；reset 清掉错误状态并重新挂载子树 */
  fallback: (error: Error, reset: () => void) => ReactNode
  /** 变化时自动清除错误状态（路由/重试次数变化） */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 渲染期错误兜底：视图组件抛错时只替换主区，不影响外壳与其余导航。
 * 生命周期错误无法用 hook 捕获，因此这里必须是 class 组件。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kb] 视图渲染失败：', error, info.componentStack)
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      return this.props.fallback(error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}
