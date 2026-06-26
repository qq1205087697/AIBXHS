import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import App from './App.tsx'
import './index.css'

const ThemedApp: React.FC = () => {
  const { currentTheme } = useTheme()
  return (
    <ConfigProvider
      locale={zhCN}
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
        <App />
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>,
)
