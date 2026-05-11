import React, { useState, useEffect } from 'react'
import { Card, Row, Col, List, Typography, Empty, Spin, Button, Tag } from 'antd'
import {
  MessageSquare,
  Package,
  Bot,
  Bell,
  ChevronRight,
  AlertTriangle,
  Clock,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { reviewsApi, notificationsApi } from '../api'

const { Title, Text } = Typography

interface ReviewItem {
  id: string
  status: 'new' | 'read' | 'processing' | 'resolved'
  importanceLevel?: string
  asin?: string
  rating?: number
}

interface Notification {
  id: number
  type: string
  title: string
  content: string
  link: string
  is_read: boolean
  created_at: string
}

interface TodoItem {
  id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  type: 'review' | 'inventory' | 'other'
  path: string
  count: number
}

const Home: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [notifLoading, setNotifLoading] = useState(false)
  
  const isHighLevel = (level?: string | null) => {
    return level === 'high' || level === '严重'
  }
  
  const isMediumLevel = (level?: string | null) => {
    return level === 'medium' || level === '中等'
  }
  
  const isLowLevel = (level?: string | null) => {
    return level === 'low' || level === '轻微'
  }
  
  // 标记通知为已读
  const markNotificationAsRead = async (id: number) => {
    try {
      // 这里可以调用后端API标记为已读
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    } catch (e) {
      console.error('标记已读失败', e)
    }
  }
  
  // 处理通知点击
  const handleNotificationClick = (notification: Notification) => {
    // 先标记为已读
    if (!notification.is_read) {
      markNotificationAsRead(notification.id)
    }
    
    // 跳转到对应页面
    if (notification.link) {
      navigate(notification.link)
    } else if (notification.title.includes('差评')) {
      navigate('/review')
    }
  }

  // 生成待办事项列表
  const todoList: TodoItem[] = []
  
  // 添加待处理差评到待办
  const highReviews = reviews.filter(r => isHighLevel(r.importanceLevel) && r.status !== 'resolved')
  const mediumReviews = reviews.filter(r => isMediumLevel(r.importanceLevel) && r.status !== 'resolved')
  const lowReviews = reviews.filter(r => isLowLevel(r.importanceLevel) && r.status !== 'resolved')

  if (highReviews.length > 0) {
    todoList.push({
      id: 'todo-high-review',
      title: '处理严重差评',
      description: `有 ${highReviews.length} 条严重差评需要处理`,
      priority: 'high',
      type: 'review',
      path: '/review',
      count: highReviews.length
    })
  }
  
  if (mediumReviews.length > 0) {
    todoList.push({
      id: 'todo-medium-review',
      title: '处理中等差评',
      description: `有 ${mediumReviews.length} 条中等差评需要处理`,
      priority: 'medium',
      type: 'review',
      path: '/review',
      count: mediumReviews.length
    })
  }
  
  if (lowReviews.length > 0) {
    todoList.push({
      id: 'todo-low-review',
      title: '处理轻微差评',
      description: `有 ${lowReviews.length} 条轻微差评需要处理`,
      priority: 'low',
      type: 'review',
      path: '/review',
      count: lowReviews.length
    })
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return '早上好'
    if (hour < 18) return '下午好'
    return '晚上好'
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [reviewsRes] = await Promise.all([
        reviewsApi.getList({ page_size: 100 })
      ])

      if (reviewsRes.data.success) {
        const data = reviewsRes.data.data
        
        // 去重
        const uniqueReviews = data.filter((item: ReviewItem, index: number, self: ReviewItem[]) => 
          index === self.findIndex((t) => t.id === item.id)
        )
        
        setReviews(uniqueReviews)
      }
    } catch (error) {
      console.error('获取数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchNotifications = async () => {
    setNotifLoading(true)
    try {
      const res = await notificationsApi.getList({ page: 1, page_size: 10 })
      if (res.data.success) setNotifications(res.data.data)
    } catch (e) {
      console.error('获取通知失败:', e)
    } finally {
      setNotifLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
    
    // 每30秒自动刷新通知
    const interval = setInterval(fetchNotifications, 30000)
    
    return () => clearInterval(interval)
  }, [])

  const reviewStats = {
    high: {
      unhandled: reviews.filter(r => isHighLevel(r.importanceLevel) && r.status !== 'resolved').length,
      handled: reviews.filter(r => isHighLevel(r.importanceLevel) && r.status === 'resolved').length
    },
    medium: {
      unhandled: reviews.filter(r => isMediumLevel(r.importanceLevel) && r.status !== 'resolved').length,
      handled: reviews.filter(r => isMediumLevel(r.importanceLevel) && r.status === 'resolved').length
    },
    low: {
      unhandled: reviews.filter(r => isLowLevel(r.importanceLevel) && r.status !== 'resolved').length,
      handled: reviews.filter(r => isLowLevel(r.importanceLevel) && r.status === 'resolved').length
    }
  }

  const modules = [
    {
      id: 'review',
      title: '差评机器人',
      icon: <MessageSquare size={32} />,
      color: '#cf1322',
      description: '智能分析差评，快速响应客户反馈',
      path: '/review',
      stats: reviewStats
    },
    {
      id: 'inventory',
      title: '库存机器人',
      icon: <Package size={32} />,
      color: '#faad14',
      description: '实时监控库存，智能预警提醒',
      path: '/inventory',
      stats: null
    },
    {
      id: 'chat',
      title: 'AI聊天助手',
      icon: <Bot size={32} />,
      color: '#1890ff',
      description: '智能问答，高效解决问题',
      path: '/chat',
      stats: null
    }
  ]

  const renderReviewStats = (stats: any) => {
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fff2f0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>严重</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#cf1322' }}>{stats.high.unhandled}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fffbe6', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>中等</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>{stats.medium.unhandled}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#e6f7ff', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>轻微</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>{stats.low.unhandled}</div>
            </div>
          </Col>
        </Row>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <Title level={3} style={{ marginBottom: 24 }}>{user?.username || '用户'}，{getGreeting()}！</Title>

        <Row gutter={[24, 24]}>
          {modules.map(module => (
            <Col xs={24} sm={12} md={12} lg={8} key={module.id}>
              <Card
                loading={loading}
                onClick={() => navigate(module.path)}
                style={{
                  height: '100%',
                  cursor: 'pointer',
                  borderLeft: `4px solid ${module.color}`,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  transition: 'all 0.3s'
                }}
                styles={{ body: { padding: 24 } }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      background: `${module.color}15`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: module.color
                    }}>
                      {module.icon}
                    </div>
                    <div>
                      <Title level={4} style={{ margin: 0, marginBottom: 4 }}>{module.title}</Title>
                      <Text type="secondary" style={{ fontSize: 13 }}>{module.description}</Text>
                    </div>
                  </div>
                  <ChevronRight size={20} color="#999" />
                </div>

                {module.stats && renderReviewStats(module.stats)}
              </Card>
            </Col>
          ))}
        </Row>

        {/* 待办事项区域 */}
        {todoList.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Clock size={20} color="#1890ff" />
              <Title level={4} style={{ margin: 0 }}>待办事项</Title>
            </div>
            <Row gutter={[16, 16]}>
              {todoList.map(todo => (
                <Col xs={24} sm={12} md={8} key={todo.id}>
                  <Card
                    hoverable
                    onClick={() => navigate(todo.path)}
                    style={{
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                      border: '1px solid #f0f0f0'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Text strong style={{ fontSize: 15 }}>{todo.title}</Text>
                          <Tag color={
                            todo.priority === 'high' ? 'red' :
                            todo.priority === 'medium' ? 'orange' : 'blue'
                          }>
                            {todo.count}条
                          </Tag>
                        </div>
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                          {todo.description}
                        </Text>
                      </div>
                      <AlertTriangle size={16} color={
                        todo.priority === 'high' ? '#cf1322' :
                        todo.priority === 'medium' ? '#faad14' : '#1890ff'
                      } />
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}
      </div>

      <div style={{
        width: 360,
        borderLeft: '1px solid #f0f0f0',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fff',
          display: 'flex',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={20} color="#1890ff" />
            <Title level={5} style={{ margin: 0 }}>通知栏</Title>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notifLoading && notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin />
            </div>
          ) : notifications.length === 0 ? (
            <Empty
              description="暂无通知"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 64 }}
            />
          ) : (
            <List
              dataSource={notifications}
              renderItem={item => (
                <List.Item
                  style={{
                    padding: '16px 24px',
                    background: item.is_read ? 'transparent' : '#e6f7ff',
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                  onClick={() => handleNotificationClick(item)}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {!item.is_read && (
                        <div style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#1890ff',
                          flexShrink: 0
                        }} />
                      )}
                      <Text strong style={{ fontSize: 14 }}>{item.title}</Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      {item.content}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                      {new Date(item.created_at).toLocaleString('zh-CN')}
                    </Text>
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default Home
