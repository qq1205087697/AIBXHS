import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

// 日期选择器面板（月份/星期/今天按钮）中文化依赖 dayjs 语言包
dayjs.locale('zh-cn')
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { setupImagePreviewSwitch } from './utils/previewSwitch'
import App from './App.tsx'
import './index.css'

// 图片预览左右切换按钮贴图定位（配合 index.css 的 --preview-switch-* 变量）
setupImagePreviewSwitch()

const ThemedApp: React.FC = () => {
  const { currentTheme } = useTheme()
  return (
    <ConfigProvider
      locale={zhCN}
      getPopupContainer={() => document.body}
      theme={{
        token: {
          colorPrimary: currentTheme.primary,
          colorPrimaryHover: currentTheme.primary,
          colorPrimaryActive: currentTheme.primary,
        },
        components: {
          Button: {
            colorPrimary: currentTheme.primary,
            colorPrimaryHover: currentTheme.primary,
            colorPrimaryActive: currentTheme.primary,
          },
        },
      }}
    >
      <AntdApp>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <ThemedApp />
  </ThemeProvider>,
)
