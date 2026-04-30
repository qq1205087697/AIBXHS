import React, { useState } from 'react'
import { Layout, Menu, theme, Dropdown, Avatar, Space, Typography } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Home,
  Package,
  MessageSquare,
  Database,
  Bot,
  LogOut,
  User,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import ThemeSwitcher from '../ThemeSwitcher'

const { Header, Sider, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: React.ReactNode
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const { currentTheme } = useTheme()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  const menuItems = [
    {
      key: '/',
      icon: <Home size={20} />,
      label: 'AI聊天助手',
    },
    {
      key: '/dashboard',
      icon: <Database size={20} />,
      label: '数据看板',
    },
    {
      key: '/inventory',
      icon: <Package size={20} />,
      label: '库存机器人',
    },
    {
      key: '/review',
      icon: <MessageSquare size={20} />,
      label: '差评机器人',
    },
  ]

  const getPageTitle = () => {
    const pathMap: Record<string, string> = {
      '/': 'AI聊天助手',
      '/dashboard': '数据看板',
      '/inventory': '库存机器人',
      '/review': '差评机器人',
    }
    return pathMap[location.pathname] || '未知页面'
  }

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogOut size={16} />,
      label: '退出登录',
      onClick: () => {
        logout()
        navigate('/login')
      },
    },
  ]

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        style={{ height: '100%' }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Bot size={32} color={currentTheme.primary} />
          {!collapsed && <span style={{ marginLeft: 8, fontSize: 18, fontWeight: 'bold', color: currentTheme.primary }}>宝鑫华盛AI</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{
            height: 'calc(100% - 64px)',
            overflowY: 'auto',
            '--ant-menu-item-selected-bg': currentTheme.selectedBg,
            '--ant-menu-item-selected-color': currentTheme.primary,
            '--ant-menu-item-color': currentTheme.primary,
            '--ant-color-primary': currentTheme.primary,
          } as React.CSSProperties}
        />
      </Sider>
      <Layout style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Header style={{ padding: '0 24px', background: colorBgContainer, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, height: 64 }}>
          <Title level={4} style={{ margin: 0 }}>{getPageTitle()}</Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <ThemeSwitcher />
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar 
                  style={{ backgroundColor: currentTheme.avatarBg }}
                  icon={<User size={16} />}
                />
                <span>{user?.nickname || user?.username}</span>
              </Space>
            </Dropdown>
          </div>
        </Header>
        <Content
          style={{
            margin: '16px',
            padding: 0,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
