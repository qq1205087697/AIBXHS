import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Input, Button, Typography, message, Spin, List, Avatar, Popconfirm, Empty, Dropdown } from 'antd'
import { Send, MessageSquare, Plus, Package, Trash2, StopCircle, ChevronRight, MessageCircle, Zap, BarChart3, Bot, ChevronUp } from 'lucide-react'
import { chatApi, chatStreamApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useStreamingChat, ChatMessage } from '../hooks/useStreamingChat'
import MarkdownRenderer from '../components/common/MarkdownRenderer'

const { Title, Text } = Typography

interface ChatSession {
  id: number
  session_id: string
  title: string
  created_at: string
  message_count?: number
}

const CHAT_CONFIGS = {
  review: {
    title: '差评分析助手',
    subtitle: '智能分析差评数据，提供专业改进建议',
    color: '#1890ff',
    welcome: '您好！我是跨境电商差评分析助手。\n\n您可以问我以下问题：\n- 帮我看看这周的差评\n- 查看 ASIN B09XYZ 最近 7 天的差评\n- 分析最近的差评核心问题',
    placeholder: '输入差评相关问题...',
    icon: MessageSquare,
  },
  inventory: {
    title: '库存分析助手',
    subtitle: '智能分析库存数据，提供断货预警和补货建议',
    color: '#722ed1',
    welcome: '您好！我是库存AI分析助手。\n\n您可以问我以下问题：\n- 哪些商品有断货风险？\n- 需要补货的商品有哪些？\n- 帮我分析一下库存状况\n- 低库存商品有哪些？',
    placeholder: '输入库存相关问题，如：哪些商品有断货风险？',
    icon: Package,
  },
}

// 推荐问题
const RECOMMENDED_QUESTIONS = {
  review: [
    {
      title: '帮我分析本月差评',
      desc: '智能分析本月差评数据，发现核心问题',
      icon: MessageCircle,
    },
    {
      title: '查看上周差评趋势',
      desc: '分析近一周差评变化情况',
      icon: BarChart3,
    },
    {
      title: '哪些商品差评最多？',
      desc: '找出差评数量最多的商品',
      icon: Zap,
    },
  ],
  inventory: [
    {
      title: '哪些商品有断货风险？',
      desc: '识别即将断货的商品',
      icon: Zap,
    },
    {
      title: '需要补货的商品',
      desc: '分析需要立即补货的商品',
      icon: Package,
    },
    {
      title: '库存健康度分析',
      desc: '全面分析当前库存状况',
      icon: BarChart3,
    },
  ],
}

// 单条消息组件
const ChatMessageItem = React.memo(({ msg, userMessageBg, assistantColor }: {
  msg: ChatMessage;
  userMessageBg: string;
  assistantColor: string;
}) => (
  <div
    style={{
      display: 'flex',
      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
      marginBottom: '24px',
      gap: '12px',
    }}
  >
    {msg.role === 'assistant' && (
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          backgroundColor: 'white',
          border: '1px solid #e5e5e5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}
      >
        <img 
          src="/tank-avatar.png" 
          alt="AI助手" 
          style={{ width: '24px', height: '24px', objectFit: 'contain' }}
        />
      </div>
    )}
    <div
      style={{
        maxWidth: '70%',
        padding: '16px 20px',
        borderRadius: msg.role === 'user'
          ? '20px 20px 4px 20px'
          : '20px 20px 20px 4px',
        backgroundColor: msg.role === 'user' ? userMessageBg : '#ffffff',
        color: msg.role === 'user' ? 'white' : '#1a1a1a',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }}
    >
      {msg.role === 'user' ? (
        <span style={{ fontSize: '15px', lineHeight: '1.6' }}>{msg.content}</span>
      ) : (
        <MarkdownRenderer content={msg.content} />
      )}
      {msg.isStreaming && (
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '18px',
          backgroundColor: '#1a1a1a',
          marginLeft: '4px',
          animation: 'blink 1s infinite'
        }} />
      )}
    </div>
  </div>
))
ChatMessageItem.displayName = 'ChatMessageItem'

// 推荐问题卡片组件 - 白色黑色边框风格
const RecommendCard = ({ 
  question, 
  onClick, 
  config 
}: { 
  question: any, 
  onClick: () => void,
  config?: any 
}) => {
  const Icon = question.icon
  return (
    <div
      onClick={onClick}
      style={{
        padding: '16px 20px',
        backgroundColor: 'white',
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        border: '1px solid #1a1a1a',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#f5f5f5'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'white'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon size={16} color='#1a1a1a' />
        </div>
        <div>
          <Text strong style={{ fontSize: '14px', color: '#1a1a1a', display: 'block', marginBottom: '2px' }}>
            {question.title}
          </Text>
          <Text style={{ fontSize: '12px', color: '#8e8e93', display: 'block' }}>
            {question.desc}
          </Text>
        </div>
      </div>
    </div>
  )
}

const ChatBot: React.FC = () => {
  const { currentTheme } = useTheme()
  const [chatType, setChatType] = useState<'review' | 'inventory'>('review')
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  const isUserScrollingRef = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const config = CHAT_CONFIGS[chatType]
  const recommendedQuestions = RECOMMENDED_QUESTIONS[chatType]

  // 使用流式聊天Hook
  const {
    messages,
    isStreaming,
    streamingContent,
    sendMessage: sendStreamingMessage,
    stopStreaming,
    clearMessages,
    setMessages
  } = useStreamingChat({
    onError: (error) => message.error(error),
    onComplete: (sid) => {
      setSessionId(sid)
      loadSessions()
    }
  })

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowScrollToBottom(false)
    isUserScrollingRef.current = false
  }, [])

  // 监听用户手动滚动
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isNearBottom = (scrollHeight - scrollTop - clientHeight) <= 100
      isUserScrollingRef.current = !isNearBottom
      setShowScrollToBottom(!isNearBottom)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // 仅在用户未手动滚动时自动滚到底部
  useEffect(() => {
    if (!isUserScrollingRef.current) {
      scrollToBottom()
    }
  }, [messages, streamingContent, scrollToBottom])

  // 切换机器人类型时重置
  useEffect(() => {
    if (chatType) {
      clearMessages()
      setSessionId(null)
      loadSessions()
    }
  }, [chatType])

  const loadSessions = async () => {
    try {
      setLoadingSessions(true)
      const response = await chatApi.getSessions(chatType)
      setSessions(response.data || [])
    } catch (error) {
      console.error('加载会话失败:', error)
    } finally {
      setLoadingSessions(false)
    }
  }

  const loadSessionMessages = useCallback(async (sid: string) => {
    if (loadingRef.current) return
    loadingRef.current = true
    
    try {
      setLoadingMessages(true)
      const response = await chatApi.getSessionMessages(sid)

      const loadedMessages: ChatMessage[] = (response.data || []).map((msg: any) => ({
        id: msg.id?.toString() || Date.now().toString(),
        role: (msg.role === 'user' || msg.role === 'assistant') ? msg.role : 'assistant',
        content: msg.content || '',
        timestamp: msg.created_at ? new Date(msg.created_at) : new Date()
      }))

      setSessionId(sid)
      setMessages(loadedMessages)
    } catch (error) {
      console.error('加载会话消息失败:', error)
      message.error('加载历史消息失败')
    } finally {
      setLoadingMessages(false)
      loadingRef.current = false
    }
  }, [setMessages])

  const resetChat = useCallback(() => {
    setSessionId(null)
    clearMessages()
  }, [clearMessages])

  const handleSendMessage = useCallback(async (text?: string) => {
    const messageText = text || input
    if (!messageText.trim() || isStreaming) return
    if (!text) setInput('')
    await sendStreamingMessage(messageText, sessionId || undefined, chatType)
  }, [input, isStreaming, sessionId, chatType, sendStreamingMessage])

  const handleDelete = useCallback(async (sid: string) => {
    try {
      await chatApi.deleteSession(sid)
      message.success('删除成功')
      if (sid === sessionId) {
        clearMessages()
        setSessionId(null)
      }
      loadSessions()
    } catch (error) {
      message.error('删除失败')
    }
  }, [sessionId, clearMessages, loadSessions])

  const displayMessages = useMemo(() => {
    if (isStreaming && streamingContent) {
      return [
        ...messages,
        {
          id: 'streaming',
          role: 'assistant' as const,
          content: streamingContent,
          timestamp: new Date(),
          isStreaming: true
        }
      ]
    }
    return messages
  }, [messages, isStreaming, streamingContent])

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }, [handleSendMessage])

  const messageList = useMemo(() => {
    return displayMessages.map(msg => (
      <ChatMessageItem
        key={msg.id}
        msg={msg}
        userMessageBg={currentTheme.userMessageBg}
        assistantColor={config.color}
      />
    ))
  }, [displayMessages, currentTheme.userMessageBg, config.color])

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      backgroundColor: '#f7f7f8',
      overflow: 'hidden'
    }}>
      {/* 左侧边栏 */}
      <div style={{ 
        width: '260px', 
        flexShrink: 0, 
        height: '100%', 
        backgroundColor: '#ffffff',
        borderRight: '1px solid #e5e5e5',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* 新对话按钮 */}
        <div style={{ padding: '12px' }}>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            onClick={resetChat}
            block
            style={{
              borderRadius: '12px',
              height: '44px',
              fontWeight: 500,
              backgroundColor: '#1a1a1a',
              borderColor: '#1a1a1a',
            }}
          >
            新建对话
          </Button>
        </div>

        {/* 对话历史 */}
        <div style={{ 
          padding: '8px 12px', 
          flex: 1, 
          overflowY: 'auto',
        }}>
          <Text type="secondary" style={{ 
            fontSize: '12px', 
            padding: '8px 4px', 
            display: 'block',
            fontWeight: 500,
            color: '#8e8e93'
          }}>
            对话
          </Text>
          
          {loadingSessions ? (
            <div style={{ textAlign: 'center', padding: '40px 24px' }}>
              <Spin size="small" />
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 24px', color: '#c7c7cc' }}>
              <Empty 
                image={Empty.PRESENTED_IMAGE_SIMPLE} 
                description="暂无对话"
                style={{ margin: 0 }}
              />
            </div>
          ) : (
            <List
              dataSource={sessions}
              itemLayout="horizontal"
              split={false}
              renderItem={(session) => (
                <div
                  style={{
                    cursor: 'pointer',
                    backgroundColor: session.session_id === sessionId ? '#f5f5f5' : 'transparent',
                    padding: '12px',
                    marginBottom: '4px',
                    borderRadius: '10px',
                    transition: 'background-color 0.15s',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => {
                    if (session.session_id !== sessionId) {
                      e.currentTarget.style.backgroundColor = '#fafafa'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (session.session_id !== sessionId) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  }}
                  onClick={() => loadSessionMessages(session.session_id)}
                >
                  <div style={{ 
                    flex: 1, 
                    overflow: 'hidden',
                    marginRight: '8px',
                  }}>
                    <Text 
                      ellipsis 
                      style={{ 
                        fontSize: '14px', 
                        color: '#1a1a1a',
                        fontWeight: session.session_id === sessionId ? 500 : 400,
                      }}
                    >
                      {session.title}
                    </Text>
                    <Text 
                      type="secondary" 
                      ellipsis 
                      style={{ 
                        fontSize: '12px', 
                        display: 'block',
                        marginTop: '2px',
                        color: '#8e8e93',
                      }}
                    >
                      {new Date(session.created_at).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </Text>
                  </div>
                  <Popconfirm
                    title="删除对话"
                    description="确定要删除此对话吗？"
                    onConfirm={(e) => {
                      e?.stopPropagation()
                      handleDelete(session.session_id)
                    }}
                    okText="确定"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<Trash2 size={14} />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ 
                        opacity: 0,
                        transition: 'opacity 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0'
                      }}
                    />
                  </Popconfirm>
                </div>
              )}
            />
          )}
        </div>

        {/* 底部切换 */}
        <div style={{ 
          padding: '12px', 
          borderTop: '1px solid #f0f0f0',
        }}>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'review',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <MessageSquare size={16} />
                      <span>差评分析</span>
                    </div>
                  ),
                  onClick: () => setChatType('review'),
                },
                {
                  key: 'inventory',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BarChart3 size={16} />
                      <span>库存分析</span>
                    </div>
                  ),
                  onClick: () => setChatType('inventory'),
                },
              ],
              selectedKeys: [chatType],
              className: 'chat-type-dropdown',
            }}
            placement="top"
          >
            <Button
              type="text"
              icon={<config.icon size={16} />}
              block
              style={{
                borderRadius: '10px',
                height: '40px',
                textAlign: 'left',
                padding: '0 12px',
                color: '#1a1a1a',
              }}
            >
              <span style={{ marginLeft: '8px' }}>
                {config.title.replace('助手', '')}
              </span>
              <ChevronUp size={14} style={{ float: 'right', marginTop: '3px', color: '#c7c7cc' }} />
            </Button>
          </Dropdown>
        </div>
      </div>

      {/* 右侧聊天区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: '0', height: '100%' }}>
        {/* 消息列表区域 */}
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '40px',
            backgroundColor: '#f7f7f8',
            minHeight: 0,
            height: 0,
          }}
        >
          <React.Fragment>
            <div style={{
              maxWidth: '900px',
              margin: '0 auto',
            }}>
              {/* 加载历史消息时显示 */}
              {loadingMessages && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
                  <Spin size="large" tip="加载历史消息中..." />
                </div>
              )}

              {/* 欢迎页面 */}
              {!loadingMessages && displayMessages.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: '60px' }}>
                  {/* 大Logo - 白色背景黑色图标 */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    marginBottom: '32px',
                    gap: '16px',
                  }}>
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '16px',
                      backgroundColor: 'white',
                      border: '1px solid #e5e5e5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <img 
                        src="/tank-logo.png" 
                        alt="坦克引擎" 
                        style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <Title level={2} style={{ margin: 0, fontSize: '32px', fontWeight: 700, color: '#1a1a1a' }}>
                        坦克引擎
                      </Title>
                      <Text style={{ fontSize: '14px', color: '#8e8e93' }}>
                        {config.subtitle}
                      </Text>
                    </div>
                  </div>

                  {/* 推荐问题 */}
                  <div style={{ marginTop: '48px' }}>
                    <Text style={{ 
                      fontSize: '14px', 
                      color: '#8e8e93', 
                      display: 'block',
                      marginBottom: '16px',
                      fontWeight: 500,
                    }}>
                      推荐
                    </Text>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: '12px',
                    }}>
                      {recommendedQuestions.map((q, index) => (
                        <RecommendCard
                          key={index}
                          question={q}
                          config={config}
                          onClick={() => handleSendMessage(q.title)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 消息列表 - 拓宽显示 */}
            {!loadingMessages && displayMessages.length > 0 && (
              <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                {messageList}

                {/* 流式生成中提示 */}
                {isStreaming && !streamingContent && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '12px',
                        backgroundColor: 'white',
                        border: '1px solid #e5e5e5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                      }}
                    >
                      <img 
          src="/tank-avatar.png" 
          alt="AI助手" 
          style={{ width: '24px', height: '24px', objectFit: 'contain' }}
        />
                    </div>
                    <div
                      style={{
                        padding: '16px 24px',
                        borderRadius: '20px 20px 20px 4px',
                        backgroundColor: 'white',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Spin size="small" />
                        <span style={{ color: '#666', fontSize: '15px' }}>正在思考中...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </React.Fragment>
        </div>

        {/* 输入区域 */}
        <div
          style={{
            padding: '24px 40px 40px',
            backgroundColor: '#f7f7f8',
            flexShrink: 0,
          }}
        >
          <div style={{
            maxWidth: '700px',
            margin: '0 auto',
            position: 'relative',
          }}>
            {/* 回到底部按钮 */}
            {showScrollToBottom && (
              <div style={{
                position: 'absolute',
                top: '-50px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
              }}>
                <Button
                  icon={<ChevronRight size={16} style={{ transform: 'rotate(90deg)' }} />}
                  onClick={scrollToBottom}
                  style={{
                    borderRadius: '50%',
                    width: '40px',
                    height: '40px',
                    minWidth: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'white',
                    border: '1px solid #e5e5e5',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                />
              </div>
            )}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '20px',
              padding: '12px',
              boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              border: '1px solid #e5e5e5',
            }}>
              <Input.TextArea
                placeholder="给坦克引擎发消息"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={isStreaming || loadingMessages}
                autoSize={{ minRows: 1, maxRows: 8 }}
                style={{
                  border: 'none',
                  boxShadow: 'none',
                  resize: 'none',
                  fontSize: '15px',
                  padding: '8px 8px 4px',
                }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0 4px',
              }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {/* 没有文件上传功能，所以这里留空 */}
                </div>
                {isStreaming ? (
                  <Button
                    className="chat-action-button"
                    icon={<StopCircle size={18} color="#1a1a1a" />}
                    onClick={stopStreaming}
                    style={{
                      borderRadius: '10px',
                      padding: '0 12px',
                      height: '40px',
                      width: '40px',
                      minWidth: '40px',
                      backgroundColor: 'white',
                      border: '1px solid #e5e5e5',
                      color: '#1a1a1a',
                    }}
                  />
                ) : (
                  <Button
                    className="chat-action-button"
                    icon={<Send size={18} color="#1a1a1a" />}
                    onClick={handleSendMessage}
                    disabled={!input.trim() || loadingMessages}
                    style={{
                      borderRadius: '10px',
                      padding: '0 12px',
                      height: '40px',
                      width: '40px',
                      minWidth: '40px',
                      backgroundColor: 'white',
                      border: '1px solid #e5e5e5',
                      color: '#1a1a1a',
                    }}
                  />
                )}
              </div>
            </div>
            <Text type="secondary" style={{ 
              fontSize: '12px', 
              color: '#8e8e93', 
              textAlign: 'center', 
              display: 'block', 
              marginTop: '12px' 
            }}>
              坦克引擎可能会生成错误信息，请仔细检查重要内容。
            </Text>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .ant-input:focus,
        .ant-input-focused,
        .ant-input:focus-visible,
        .ant-input-affix-wrapper-focused,
        .ant-input-affix-wrapper:focus {
          box-shadow: none !important;
          border-color: transparent !important;
          outline: none !important;
        }
        .chat-action-button:hover {
          border-color: #1a1a1a !important;
          color: #1a1a1a !important;
          background-color: white !important;
        }
        .chat-type-dropdown .ant-dropdown-menu-item-selected {
          background-color: #f5f5f5 !important;
          color: #1a1a1a !important;
        }
      `}</style>
    </div>
  )
}

export default ChatBot
