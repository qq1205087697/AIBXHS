import React, { useState, useEffect, useRef } from 'react'
import { Input, Button, Typography, message, Spin, List, Avatar } from 'antd'
import { Send, MessageSquare, Plus } from 'lucide-react'
import { chatApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'

const { Title, Text } = Typography

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatSession {
  id: number
  session_id: string
  title: string
  created_at: string
}

const ChatBot: React.FC = () => {
  const { currentTheme } = useTheme()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: '您好！我是跨境电商差评分析助手。\n\n您可以问我以下问题：\n- 帮我看看这周的差评\n- 查看 ASIN B09XYZ 最近 7 天的差评\n- 分析最近的差评核心问题',
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  const loadSessions = async () => {
    try {
      setLoadingSessions(true)
      const response = await chatApi.getSessions()
      setSessions(response.data)
    } catch (error) {
      console.error('加载会话失败:', error)
    } finally {
      setLoadingSessions(false)
    }
  }

  const loadSessionMessages = async (sid: string) => {
    try {
      setLoading(true)
      const response = await chatApi.getSessionMessages(sid)
      
      const loadedMessages: ChatMessage[] = response.data.map((msg: any) => ({
        id: msg.id.toString(),
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: new Date(msg.created_at)
      }))
      
      setSessionId(sid)
      setMessages(loadedMessages)
    } catch (error) {
      console.error('加载会话消息失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const createNewSession = () => {
    setSessionId(null)
    setMessages([
      {
        id: '1',
        role: 'assistant',
        content: '您好！我是跨境电商差评分析助手。\n\n您可以问我以下问题：\n- 帮我看看这周的差评\n- 查看 ASIN B09XYZ 最近 7 天的差评\n- 分析最近的差评核心问题',
        timestamp: new Date()
      }
    ])
  }

  useEffect(() => {
    loadSessions()
  }, [])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await chatApi.sendMessage(input, sessionId)

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.data.reply,
        timestamp: new Date()
      }

      setSessionId(response.data.session_id)
      setMessages(prev => [...prev, aiMessage])
      loadSessions()
    } catch (error: any) {
      console.error('发送消息失败:', error)
      const errorMsg = error.response?.data?.detail || error.message || '发送消息失败，请重试'
      message.error(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const renderMarkdown = (content: string) => {
    return content
      .replace(/^### (.*$)/gm, '<h3 style="margin: 8px 0; font-size: 16px; font-weight: 600;">$1</h3>')
      .replace(/^## (.*$)/gm, '<h2 style="margin: 10px 0; font-size: 18px; font-weight: 600;">$1</h2>')
      .replace(/^# (.*$)/gm, '<h1 style="margin: 12px 0; font-size: 20px; font-weight: 600;">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 600;">$1</strong>')
      .replace(/^\* (.*$)/gm, '<li style="margin: 4px 0;">$1</li>')
      .replace(/^\- (.*$)/gm, '<li style="margin: 4px 0;">$1</li>')
      .replace(/^\d+\. (.*$)/gm, '<li style="margin: 4px 0;">$1</li>')
      .replace(/(<li>.*?<\/li>\s*)+/g, (match) => {
        if (match.match(/^\d+\./)) {
          return '<ol style="padding-left: 20px; margin: 8px 0;">' + match + '</ol>'
        }
        return '<ul style="padding-left: 20px; margin: 8px 0; list-style-type: disc;">' + match + '</ul>'
      })
      .split('\n\n').map((p) => {
        if (!p.trim()) return ''
        if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol')) {
          return p
        }
        return '<p style="margin: 4px 0; line-height: 1.6;">' + p.replace(/\n/g, '<br>') + '</p>'
      }).join('')
  }

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      gap: '20px',
      padding: '24px', // 这里移除了特殊背景，因为MainLayout已经处理了
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      <div style={{ width: '280px', flexShrink: 0, height: '100%' }}>
        <div style={{ 
          height: '100%',
          borderRadius: '8px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'white',
          border: '1px solid #f0f0f0'
        }}>
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <Title level={5} style={{ margin: 0, fontSize: '16px' }}>会话历史</Title>
            <Button 
              type="text" 
              icon={<Plus size={16} />}
              onClick={createNewSession}
              style={{ color: currentTheme.primary }}
            >
              新会话
            </Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingSessions ? (
              <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                <Spin size="small" />
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 24px', color: '#999' }}>
                <MessageSquare size={40} style={{ marginBottom: '12px', opacity: 0.5 }} />
                <div>暂无会话记录</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>点击右上角创建新会话</div>
              </div>
            ) : (
              <List
                dataSource={sessions}
                renderItem={(session) => (
                  <List.Item
                    style={{ 
                      cursor: 'pointer',
                      backgroundColor: session.session_id === sessionId ? currentTheme.selectedBg : 'transparent',
                      padding: '12px 16px',
                      margin: '0',
                      borderBottom: '1px solid #f0f0f0',
                      transition: 'background-color 0.2s'
                    }}
                    onClick={() => loadSessionMessages(session.session_id)}
                  >
                    <List.Item.Meta
                      avatar={
                        <Avatar 
                          style={{ backgroundColor: currentTheme.avatarBg }}
                          icon={<MessageSquare size={14} />}
                        />
                      }
                      title={<Text strong style={{ fontSize: '13px' }}>{session.title}</Text>}
                      description={
                        <Text type="secondary" ellipsis style={{ fontSize: '11px' }}>
                          {new Date(session.created_at).toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </Text>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: '0', height: '100%' }}>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '8px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          backgroundColor: 'white',
          border: '1px solid #f0f0f0'
        }}>
          <div style={{
            padding: '16px 24px',
            borderBottom: '1px solid #f0f0f0',
            flexShrink: 0
          }}>
            <Title level={4} style={{ margin: 0, color: currentTheme.primary, fontSize: '18px' }}>
              跨境电商差评分析助手
            </Title>
            <Text type="secondary" style={{ fontSize: '13px', marginTop: '4px', display: 'block' }}>
              智能分析差评数据，提供专业改进建议
            </Text>
          </div>

          <div 
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              backgroundColor: '#fafafa',
              minHeight: 0,
              height: 0
            }}
          >
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: '16px',
                  gap: '10px',
                  animation: 'fadeIn 0.3s ease'
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: msg.role === 'user' ? currentTheme.userMessageBg : currentTheme.avatarBg,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    flexShrink: 0,
                    fontSize: '13px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                >
                  {msg.role === 'user' ? 'U' : 'AI'}
                </div>
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '14px 18px',
                    borderRadius: msg.role === 'user' 
                      ? '16px 16px 4px 16px' 
                      : '16px 16px 16px 4px',
                    backgroundColor: msg.role === 'user' ? currentTheme.userMessageBg : 'white',
                    color: msg.role === 'user' ? 'white' : '#333',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    border: msg.role === 'assistant' ? '1px solid #f0f0f0' : 'none'
                  }}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(msg.content)
                  }}
                />
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: currentTheme.avatarBg,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    flexShrink: 0,
                    fontSize: '13px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                >
                  AI
                </div>
                <div
                  style={{
                    padding: '14px 24px',
                    borderRadius: '16px 16px 16px 4px',
                    backgroundColor: 'white',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    border: '1px solid #f0f0f0'
                  }}
                >
                  <Spin size="small" tip="正在分析..." />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div 
            style={{ 
              padding: '16px 20px',
              backgroundColor: 'white',
              borderTop: '1px solid #f0f0f0',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexShrink: 0
            }}
          >
            <Input
              placeholder="输入您的问题..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={sendMessage}
              disabled={loading}
              style={{ 
                flex: 1,
                borderRadius: '8px',
                padding: '10px 16px',
                border: '1px solid #d9d9d9',
                boxShadow: 'none'
              }}
              size="large"
            />
            <Button
              type="primary"
              icon={<Send size={16} />}
              onClick={sendMessage}
              loading={loading}
              style={{ 
                borderRadius: '8px',
                padding: '0 24px',
                height: '40px',
                backgroundColor: currentTheme.primary,
                borderColor: currentTheme.primary
              }}
            >
              发送
            </Button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

export default ChatBot
