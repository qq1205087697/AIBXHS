import React from 'react'
import { Button, Result } from 'antd'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** 变化时自动清除错误状态（如路由路径），避免切换页面后仍停留在错误视图 */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 全局错误边界：捕获子树渲染错误，避免整站白屏。
 * 显示具体错误信息便于定位问题，并提供重试按钮（无需刷新页面）。
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] 页面渲染错误:', error, info.componentStack)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40 }}>
          <Result
            status="error"
            title="页面出现错误"
            subTitle={
              <div style={{ textAlign: 'left', maxWidth: 640, margin: '0 auto', wordBreak: 'break-all' }}>
                {this.state.error.message || String(this.state.error)}
              </div>
            }
            extra={
              <Button type="primary" onClick={() => this.setState({ error: null })}>
                重试
              </Button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
