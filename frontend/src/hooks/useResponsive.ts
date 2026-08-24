import { Grid } from 'antd'

const { useBreakpoint } = Grid

export interface ResponsiveInfo {
  /** 是否为手机布局（仅用于 MainLayout 的 Sider→Drawer 切换） */
  isMobileLayout: boolean
  /** 内容区始终保持桌面布局，不触发响应式缩窄 */
  isMobile: boolean   // 始终 false，保持桌面布局
  isTablet: boolean   // 始终 false
  isDesktop: boolean  // 始终 true
  isLargeScreen: boolean

  // 通用断点（保留真实值供 MainLayout 使用）
  xs: boolean
  sm: boolean
  md: boolean
  lg: boolean
  xl: boolean
  xxl: boolean

  // 便捷方法
  siderWidth: number
  contentMargin: number
  headerPadding: string
  cardPadding: number
  modalWidth: number | string
  tableScrollX: number | boolean
}

export function useResponsive(): ResponsiveInfo {
  const screens = useBreakpoint()

  const isMobileLayout = !!screens.xs && !screens.sm

  return {
    isMobileLayout,
    // 内容区始终保持桌面布局，通过横向滚动适配小屏
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isLargeScreen: !!screens.xl,

    xs: !!screens.xs,
    sm: !!screens.sm,
    md: !!screens.md,
    lg: !!screens.lg,
    xl: !!screens.xl,
    xxl: !!screens.xxl,

    siderWidth: isMobileLayout ? 0 : 200,
    contentMargin: 16,
    headerPadding: isMobileLayout ? '0 12px' : '0 24px',
    cardPadding: 24,
    modalWidth: isMobileLayout ? '95vw' : 1100,
    tableScrollX: false,
  }
}
