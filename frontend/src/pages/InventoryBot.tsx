import React, { useState, useEffect } from 'react'
import { Card, Row, Col, List, Button, Alert, Tag, Statistic, Divider, Space, Modal, Input } from 'antd'
import {
  Package,
  AlertTriangle,
  TrendingDown,
  Zap,
  CheckCircle,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  Send
} from 'lucide-react'
import axios from 'axios'
import { useTheme } from '../contexts/ThemeContext'

interface InventoryItem {
  id: string
  asin: string
  name: string
  currentStock: number
  safetyStock: number
  daysRemaining: number
  status: 'danger' | 'warning' | 'normal'
  suggestion: string
  category: 'out_of_stock' | 'overstock' | 'low_stock' | 'overstock'
}

interface ChatMessage {
  id: string
  type: 'user' | 'ai'
  content: string
  timestamp: Date
}

const InventoryBot: React.FC = () => {
  const { currentTheme } = useTheme()
  const [isExecuting, setIsExecuting] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [inventoryData, setInventoryData] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [chatVisible, setChatVisible] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => {
    fetchInventoryData()
  }, [])

  const fetchInventoryData = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/inventory/alerts')
      if (response.data.success) {
        setInventoryData(response.data.data)
      }
    } catch (error) {
      console.error('获取库存数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = (item: InventoryItem) => {
    setSelectedItem(item)
    Modal.confirm({
      title: '确认执行操作',
      content: (
        <div>
          <p><strong>商品：</strong>{item.name}</p>
          <p><strong>ASIN：</strong>{item.asin}</p>
          <p><strong>建议：</strong>{item.suggestion}</p>
          <Divider />
          <p style={{ color: '#faad14' }}>⚠️ 此操作将调用亚马逊API自动执行，请确认后继续。</p>
        </div>
      ),
      okText: '确认执行',
      cancelText: '取消',
      onOk: async () => {
        setIsExecuting(true)
        try {
          await axios.post('/api/inventory/execute', {
            asin: item.asin,
            action: item.category === 'low_stock' ? 'restock' : 'promotion'
          })
          Modal.success({ title: '操作成功', content: '已成功调用亚马逊API执行调价/促销操作！' })
        } catch (error) {
          Modal.error({ title: '操作失败', content: '调用API失败，请稍后重试。' })
        } finally {
          setIsExecuting(false)
        }
      }
    })
  }

  const handleChat = () => {
    setChatVisible(true)
    setChatMessages([
      {
        id: '1',
        type: 'ai',
        content: '您好！我是库存机器人，请问有什么关于库存管理的问题我可以帮您解答？',
        timestamp: new Date()
      }
    ])
  }

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: chatInput,
      timestamp: new Date()
    }

    setChatMessages(prev => [...prev, userMessage])
    setChatInput('')
    setChatLoading(true)

    try {
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: `根据您的问题 "${chatInput}"，我建议您：\n\n1. 定期检查库存水平\n2. 及时补货避免断货\n3. 促销清理冗余库存\n\n您可以点击具体的库存预警查看详细建议。`,
        timestamp: new Date()
      }
      setChatMessages(prev => [...prev, aiMessage])
    } catch (error) {
      console.error('AI回复失败:', error)
    } finally {
      setChatLoading(false)
    }
  }

  const getStatusIcon = (status: string) => {
    if (status === 'danger') return <AlertTriangle color="#cf1322" size={24} />
    if (status === 'warning') return <TrendingDown color="#faad14" size={24} />
    return <CheckCircle color="#52c41a" size={24} />
  }

  const getStatusColor = (status: string) => {
    if (status === 'danger') return 'red'
    if (status === 'warning') return 'orange'
    return 'green'
  }

  const dangerCount = inventoryData.filter(item => item.status === 'danger').length
  const warningCount = inventoryData.filter(item => item.status === 'warning').length

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <Package color={currentTheme.primary} size={32} style={{ marginRight: 12 }} />
          <h1 style={{ margin: 0 }}>宝鑫华盛AI - 库存机器人</h1>
          <Button 
            type="primary" 
            icon={<Send size={16} />} 
            onClick={handleChat}
            style={{ marginLeft: 'auto' }}
          >
            AI对话
          </Button>
        </div>
        <p style={{ color: '#666', margin: 0 }}>全天候库存监控，智能断货/冗余预警，自动生成解决方案</p>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card loading={loading}>
            <Statistic
              title="断货风险商品"
              value={dangerCount}
              valueStyle={{ color: '#cf1322' }}
              prefix={<AlertTriangle size={18} />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card loading={loading}>
            <Statistic
              title="库存冗余商品"
              value={warningCount}
              valueStyle={{ color: '#faad14' }}
              prefix={<TrendingDown size={18} />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card loading={loading}>
            <Statistic
              title="已自动处理"
              value={inventoryData.length}
              valueStyle={{ color: '#52c41a' }}
              prefix={<Zap size={18} />}
            />
          </Card>
        </Col>
      </Row>

      <Alert
        message="AI智能分析完成"
        description={`已扫描全部${inventoryData.length}个SKU，发现${inventoryData.length}个需要关注的库存问题。`}
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Row gutter={24}>
        <Col span={24}>
          <Card title="库存预警列表" loading={loading}>
            <List
              itemLayout="vertical"
              dataSource={inventoryData}
              renderItem={(item) => (
                <List.Item
                  key={item.id}
                  actions={[
                    <Button
                      type="primary"
                      icon={<Play size={16} />}
                      onClick={() => handleExecute(item)}
                      loading={isExecuting && selectedItem?.id === item.id}
                    >
                      执行建议
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    avatar={getStatusIcon(item.status)}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span>{item.name}</span>
                        <Tag color={getStatusColor(item.status)}>
                          {item.category === 'low_stock' || item.category === 'out_of_stock' ? '断货风险' : '库存冗余'}
                        </Tag>
                        <Tag color="blue">ASIN: {item.asin}</Tag>
                      </div>
                    }
                    description={
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Row gutter={24}>
                          <Col span={6}>
                            <Statistic
                              title="当前库存"
                              value={item.currentStock}
                              prefix={item.status === 'danger' ? <ArrowDownRight size={14} color="#cf1322" /> : item.status === 'warning' ? <ArrowUpRight size={14} color="#faad14" /> : null}
                            />
                          </Col>
                          <Col span={6}>
                            <Statistic title="安全库存" value={item.safetyStock} />
                          </Col>
                          <Col span={6}>
                            <Statistic
                              title="可售天数"
                              value={item.daysRemaining}
                              suffix="天"
                              valueStyle={{ color: item.daysRemaining < 10 ? '#cf1322' : '#52c41a' }}
                            />
                          </Col>
                        </Row>
                        <Divider style={{ margin: '12px 0' }} />
                        <Alert
                          message="AI 建议"
                          description={item.suggestion}
                          type={item.status === 'danger' ? 'error' : 'warning'}
                          showIcon
                        />
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="库存机器人 AI 对话"
        open={chatVisible}
        onCancel={() => setChatVisible(false)}
        footer={null}
        width={600}
      >
        <div style={{ height: 400, overflowY: 'auto', marginBottom: 16, padding: '16px', background: '#f5f5f5', borderRadius: 8 }}>
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 12
              }}
            >
              <div
                style={{
                  maxWidth: '70%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: msg.type === 'user' ? currentTheme.userMessageBg : 'white',
                  color: msg.type === 'user' ? 'white' : 'black',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div style={{ textAlign: 'center', padding: 8, color: '#666' }}>
              AI正在思考中...
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="请输入您的问题..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onPressEnter={sendChatMessage}
          />
          <Button type="primary" icon={<Send size={16} />} onClick={sendChatMessage} loading={chatLoading}>
            发送
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default InventoryBot
