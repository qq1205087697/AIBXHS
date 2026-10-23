import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import RatingOptimizationBot from '../pages/RatingOptimizationBot'

// 需要常驻缓存（keep-alive）的页面路由
const KEEP_ALIVE_PATHS: Record<string, () => ReactNode> = {
  '/rating-optimization': () => <RatingOptimizationBot />,
}

/**
 * 页面缓存宿主：渲染在 MainLayout 内容区（与 children 并列、位置稳定），
 * 被缓存的页面首次进入时挂载，之后切换路由仅隐藏（display:none）不卸载，
 * 从而保留用户的筛选、搜索、分页等操作状态，切回时无需重新刷新。
 */
export default function KeepAliveHost() {
  const location = useLocation()
  const activePath = Object.keys(KEEP_ALIVE_PATHS).find((p) => location.pathname === p)
  const [mountedPaths, setMountedPaths] = useState<string[]>([])

  useEffect(() => {
    if (activePath) {
      // 去重放在函数式更新内部：StrictMode 下 effect 会双重调用，
      // 闭包中的 mountedPaths 是旧值，仅靠外层 includes 判断会重复追加
      setMountedPaths((prev) => (prev.includes(activePath) ? prev : [...prev, activePath]))
    }
  }, [activePath])

  if (mountedPaths.length === 0) return null

  return (
    <>
      {mountedPaths.map((path) => {
        const active = location.pathname === path
        return (
          <div
            key={path}
            style={{
              display: active ? 'flex' : 'none',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
            }}
          >
            {KEEP_ALIVE_PATHS[path]()}
          </div>
        )
      })}
    </>
  )
}
