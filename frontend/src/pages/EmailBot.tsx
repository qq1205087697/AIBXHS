import React, { useState, useEffect, useCallback } from 'react'
import { Card, Row, Col, List, Button, Tag, Divider, Space, Avatar, Modal, Pagination, message, Input, Form, Select, Statistic, Checkbox, Dropdown, Empty, Image } from 'antd'
import type { MenuProps } from 'antd'
import { Mail, Eye, Search, FileEdit, FileText, XCircle, Repeat, Truck, HelpCircle, Palette, MessageCircle, AlertCircle, ChevronDown } from 'lucide-react'
import { emailsApi } from '../api'
import dayjs from 'dayjs'
import { useAuth } from '../contexts/AuthContext'
import { useResponsive } from '../hooks/useResponsive'

interface EmailItem {
  id: string
  tenant_id: string
  store_id: string
  store_name: string
  site: string
  language: string
  mail_subject: string
  mail_content: string
  mail_content_chinese: string
  // 邮件完整上下文（all_mail_content 解析后的对话列表，role: customer=买家 / seller=卖家）
  mail_context: { time: string; role: string; content: string }[]
  buyer_mail_number: string
  ai_reply_content: string
  order_num: string
  asin: string
  ai_reply_content_tran: string
  main_image_url: string
  main_image_thumb_url: string
  reply_date: string
  follow_up_status: number
  need_reply: number
  reply_text: string
  reply_text_time: string
  importance_level: string
}

// 渲染邮件上下文对话气泡（customer=买家 左侧蓝色，seller=卖家 右侧绿色；无解析数据时回退原文）
const renderMailConversation = (mailContext: EmailItem['mail_context'], fallback: string) => {
  if (mailContext && mailContext.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mailContext.map((msg, idx) => {
          const isCustomer = msg.role === 'customer'
          return (
            <div key={idx} style={{ display: 'flex', justifyContent: isCustomer ? 'flex-start' : 'flex-end' }}>
              <div
                style={{
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isCustomer ? 'flex-start' : 'flex-end',
                }}
              >
                <span style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                  {isCustomer ? '买家' : '卖家'} · {msg.time || '时间未知'}
                </span>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    backgroundColor: isCustomer ? '#e6f4ff' : '#f6ffed',
                    border: `1px solid ${isCustomer ? '#bae0ff' : '#b7eb8f'}`,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: '#333',
                  }}
                >
                  {msg.content || '（空内容）'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return <div style={{ whiteSpace: 'pre-wrap' }}>{fallback || '暂无内容'}</div>
}

const EmailBot: React.FC = () => {
  const { hasPermission } = useAuth()
  const res = useResponsive()
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null)
  const [emails, setEmails] = useState<EmailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const [buyerMailSearch, setBuyerMailSearch] = useState('')
  const [storeNameSearch, setStoreNameSearch] = useState('')
  const [followUpFilter, setFollowUpFilter] = useState<number | undefined>(0)
  const [mailSubjectFilter, setMailSubjectFilter] = useState<string>('')
  const [replyModalVisible, setReplyModalVisible] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [form] = Form.useForm()
  const [storeNames, setStoreNames] = useState<string[]>([])
  const [unfollowedCount, setUnfollowedCount] = useState<number>(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [aiReplyGenerating, setAiReplyGenerating] = useState(false)
  const [aiReplyResult, setAiReplyResult] = useState<{ reply_text: string; reply_text_chinese: string } | null>(null)
  const [reRunLoading, setReRunLoading] = useState(false)

  const fetchStoreNames = useCallback(async () => {
    try {
      const response = await emailsApi.getStoreNames()
      if (response.data.success) {
        setStoreNames(response.data.data)
      }
    } catch (error) {
      console.error('获取店铺名称失败:', error)
    }
  }, [])

  const fetchUnfollowedCount = useCallback(async () => {
    try {
      const response = await emailsApi.getUnfollowedCount()
      if (response.data.success) {
        setUnfollowedCount(response.data.data.total || 0)
      }
    } catch (error) {
      console.error('获取未跟进数量失败:', error)
    }
  }, [])

  useEffect(() => {
    fetchStoreNames()
    fetchUnfollowedCount()
  }, [fetchStoreNames, fetchUnfollowedCount])

  useEffect(() => {
    fetchEmailData()
  }, [currentPage, pageSize, buyerMailSearch, storeNameSearch, followUpFilter, mailSubjectFilter])

  const fetchEmailData = async () => {
    try {
      setLoading(true)
      const params = {
        page: currentPage,
        page_size: pageSize,
        buyer_mail_number_search: buyerMailSearch || undefined,
        store_name_search: storeNameSearch || undefined,
        follow_up_status: followUpFilter,
        mail_subject: mailSubjectFilter || undefined,
        sort_by: 'reply_date',
        sort_order: 'desc',
      }
      const response = await emailsApi.getList(params)
      if (response.data.success) {
        setEmails(response.data.data)
        setTotal(response.data.total)
        fetchUnfollowedCount()
      }
    } catch (error) {
      console.error('获取邮件数据失败:', error)
      message.error('获取邮件数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleBuyerMailChange = (value: string) => {
    setBuyerMailSearch(value)
    if (value && storeNameSearch) {
      setStoreNameSearch('')
    }
    setCurrentPage(1)
  }

  const handleStoreNameChange = (value: string) => {
    setStoreNameSearch(value)
    if (value && buyerMailSearch) {
      setBuyerMailSearch('')
    }
    setCurrentPage(1)
  }

  const handleFollowUpFilterChange = (value: number | undefined) => {
    setFollowUpFilter(value)
    setCurrentPage(1)
  }

  const handleMailSubjectFilterChange = (value: string) => {
    setMailSubjectFilter(value)
    setCurrentPage(1)
  }

  const getSubjectIcon = (subject: string): { icon: React.ReactNode; color: string } => {
    const s = subject || ''
    if (s.includes('修改订单')) return { icon: <FileEdit size={16} />, color: '#fa8c16' }
    if (s.includes('发票') || s.includes('invoice')) return { icon: <FileText size={16} />, color: '#52c41a' }
    if (s.includes('取消订单')) return { icon: <XCircle size={16} />, color: '#f5222d' }
    if (s.includes('退货') || s.includes('换货')) return { icon: <Repeat size={16} />, color: '#722ed1' }
    if (s.includes('配送') || s.includes('追踪') || s.includes('物流')) return { icon: <Truck size={16} />, color: '#1890ff' }
    if (s.includes('商品定制')) return { icon: <Palette size={16} />, color: '#13c2c2' }
    if (s.includes('商品') && (s.includes('问答') || s.includes('详细'))) return { icon: <MessageCircle size={16} />, color: '#eb2f96' }
    if (s.includes('买家问题') || s.includes('其他')) return { icon: <HelpCircle size={16} />, color: '#faad14' }
    return { icon: <Mail size={16} />, color: '#1890ff' }
  }

  const subjectOptions = [
    '修改订单',
    '发票请求',
    '取消订单',
    '退货和换货',
    '配送和追踪',
    '商品定制',
    '商品详细问答',
    '其他-买家问题',
  ]

  const handleViewEmail = (email: EmailItem) => {
    setSelectedEmail(email)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handleSizeChange = (_current: number, size: number) => {
    setPageSize(size)
    setCurrentPage(1)
  }

  const handleResetSearch = () => {
    setBuyerMailSearch('')
    setStoreNameSearch('')
    setFollowUpFilter(undefined)
    setMailSubjectFilter('')
    setCurrentPage(1)
  }

  const handleConfirmFollowUp = async (email: EmailItem) => {
    try {
      const response = await emailsApi.updateFollowUp(email.id, 1)
      if (response.data.success) {
        message.success('已标记为已跟进')
        fetchEmailData()
        fetchUnfollowedCount()
        if (selectedEmail?.id === email.id) {
          setSelectedEmail({ ...selectedEmail, follow_up_status: 1 })
        }
      }
    } catch (error) {
      console.error('更新跟进状态失败:', error)
      message.error('更新跟进状态失败')
    }
  }

  const handleOpenNeedReply = () => {
    form.resetFields()
    setReplyText('')
    setAiReplyResult(null)
    setReplyModalVisible(true)
  }

  const handleSubmitNeedReply = async (values: any) => {
    if (!selectedEmail) return
    try {
      const response = await emailsApi.updateNeedReply(selectedEmail.id, 1, values.replyText)
      if (response.data.success) {
        message.success('已标记为需要回复')
        setReplyModalVisible(false)
        fetchEmailData()
        fetchUnfollowedCount()
        // 需要重新获取完整的邮件信息，包含新的时间
        const detailResponse = await emailsApi.getById(selectedEmail.id)
        if (detailResponse.data.success) {
          setSelectedEmail(detailResponse.data.data)
        }
      }
    } catch (error) {
      console.error('更新需要回复状态失败:', error)
      message.error('更新需要回复状态失败')
    }
  }

  // 点击AI回复：根据对话记录和邮件上下文自动生成新回复，直接写入回复框，中文翻译显示在右侧
  const handleGenerateAiReply = async () => {
    if (!selectedEmail || aiReplyGenerating) return
    setAiReplyGenerating(true)
    try {
      const response = await emailsApi.aiReply(selectedEmail.id, '')
      if (response.data.success) {
        const result = response.data.data
        setAiReplyResult(result)
        form.setFieldsValue({ replyText: result.reply_text })
        setReplyText(result.reply_text)
        message.success('AI回复已生成并填入')
      }
    } catch (error) {
      console.error('AI生成回复失败:', error)
      message.error('AI生成回复失败，请重试')
    } finally {
      setAiReplyGenerating(false)
    }
  }

  const handleReRunRobot = async () => {
    if (!selectedEmail) return
    setReRunLoading(true)
    try {
      const response = await emailsApi.reRunRobot(selectedEmail.id)
      if (response.data.success) {
        message.success('重新运行成功')
        // 刷新数据
        const detailResponse = await emailsApi.getById(selectedEmail.id)
        if (detailResponse.data.success) {
          setSelectedEmail(detailResponse.data.data)
        }
      }
    } catch (error) {
      console.error('重新运行失败:', error)
      message.error('重新运行失败，请重试')
    } finally {
      setReRunLoading(false)
    }
  }

  const handleSelectAll = () => {
    setSelectedIds(emails.map(e => e.id))
  }

  const handleDeselectAll = () => {
    setSelectedIds([])
  }

  const handleToggleSelect = (emailId: string) => {
    setSelectedIds(prev =>
      prev.includes(emailId) ? prev.filter(id => id !== emailId) : [...prev, emailId]
    )
  }

  const handleBatchFollowUp = async (followUpStatus: number) => {
    if (selectedIds.length === 0) {
      message.warning('请先选择邮件')
      return
    }
    try {
      const response = await emailsApi.batchUpdateFollowUp(selectedIds, followUpStatus)
      if (response.data.success) {
        message.success(`已将 ${response.data.count} 封邮件标记为已跟进`)
        setSelectedIds([])
        fetchEmailData()
        fetchUnfollowedCount()
      }
    } catch (error) {
      console.error('批量更新失败:', error)
      message.error('批量更新失败，请重试')
    }
  }

  const getSiteName = (site: string): string => {
    const siteMap: Record<string, string> = {
      'amazon_us': '美国',
      'amazon_uk': '英国',
      'amazon_de': '德国',
      'amazon_jp': '日本',
      'amazon_au': '澳洲',
      'amazon_fr': '法国',
      'amazon_it': '意大利',
      'amazon_es': '西班牙',
      'amazon_ca': '加拿大',
      'amazon_in': '印度',
      'amazon_mx': '墨西哥',
      'amazon_br': '巴西',
      'amazon_nl': '荷兰',
      'amazon_se': '瑞典',
      'amazon_pl': '波兰',
      'amazon_be': '比利时',
      'amazon_tr': '土耳其',
      'amazon_ae': '阿联酋',
      'amazon_sa': '沙特',
      'amazon_sg': '新加坡',
      'amazon_eg': '埃及',
    }
    return siteMap[site] || site
  }

  const getFollowUpTag = (status: number) => {
    if (status === 1) {
      return <Tag color="green">已跟进</Tag>
    }
    return <Tag color="default">未跟进</Tag>
  }

  const getNeedReplyTag = (status: number, text: string, followUpStatus: number = 0) => {
    if (status === 1 && followUpStatus !== 1) {
      return <Tag color="blue">已提交回复，等待机器人跟进</Tag>
    }
    return null
  }

  if (!hasPermission('robot:email:view')) {
    return (
      <div style={{ padding: 24, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Empty
          description="您没有查看邮件机器人的权限"
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '24px' }}>
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={[24, 12]} align="middle">
            <Col xs={24} md={8}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <AlertCircle size={24} color="#fa8c16" />
                <Statistic
                  title="未跟进邮件"
                  value={unfollowedCount}
                  valueStyle={{ color: '#fa8c16', fontSize: 28, fontWeight: 'bold' }}
                />
              </div>
            </Col>
            <Col xs={24} md={16}>
              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} sm={12} md={6}>
                  <Input
                    placeholder="搜索买家邮件号"
                    prefix={<Search size={16} />}
                    value={buyerMailSearch}
                    onChange={(e) => handleBuyerMailChange(e.target.value)}
                    allowClear
                  />
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Select
                    placeholder="选择账号"
                    value={storeNameSearch || undefined}
                    onChange={handleStoreNameChange}
                    allowClear
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                    style={{ width: '100%' }}
                  >
                    {storeNames.map(name => (
                      <Select.Option key={name} value={name}>{name}</Select.Option>
                    ))}
                  </Select>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Select
                    placeholder="选择跟进状态"
                    value={followUpFilter}
                    onChange={handleFollowUpFilterChange}
                    allowClear
                    style={{ width: '100%' }}
                  >
                    <Select.Option value={0}>未跟进</Select.Option>
                    <Select.Option value={1}>已跟进</Select.Option>
                  </Select>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Select
                    placeholder="选择邮件主题"
                    value={mailSubjectFilter || undefined}
                    onChange={handleMailSubjectFilterChange}
                    allowClear
                    style={{ width: '100%' }}
                  >
                    {subjectOptions.map(s => (
                      <Select.Option key={s} value={s}>{s}</Select.Option>
                    ))}
                  </Select>
                </Col>
                <Col xs={24} sm={24} md={2}>
                  <Button onClick={handleResetSearch} block>重置</Button>
                </Col>
              </Row>
            </Col>
          </Row>
        </Card>

        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Mail size={20} />
              <span style={{ fontWeight: 600 }}>邮件列表</span>
              <Checkbox
                checked={selectedIds.length === emails.length && emails.length > 0}
                indeterminate={selectedIds.length > 0 && selectedIds.length < emails.length}
                onChange={(e) => e.target.checked ? handleSelectAll() : handleDeselectAll()}
                style={{ fontWeight: 'normal' }}
              >
                全选 ({selectedIds.length})
              </Checkbox>
              {hasPermission('robot:email:manage') && (
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'followed',
                        label: '标记为已跟进',
                        onClick: () => handleBatchFollowUp(1),
                        disabled: selectedIds.length === 0,
                      },
                    ],
                  }}
                  disabled={selectedIds.length === 0}
                >
                  <Button disabled={selectedIds.length === 0}>
                    <Space>
                      变更状态
                      <ChevronDown size={14} />
                    </Space>
                  </Button>
                </Dropdown>
              )}
            </div>
          }
          loading={loading}
        >
          <List
            itemLayout="horizontal"
            dataSource={emails}
            style={{ width: '100%', overflow: 'hidden' }}
            renderItem={(item) => (
              <List.Item
                style={{ width: '100%', display: 'flex', alignItems: 'center' }}
                actions={[
                  <Button
                    type="primary"
                    icon={<Eye size={16} />}
                    onClick={() => handleViewEmail(item)}
                  >
                    查看详情
                  </Button>
                ]}
              >
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  onChange={() => handleToggleSelect(item.id)}
                  style={{ marginRight: 12, flexShrink: 0 }}
                />
                <List.Item.Meta
                  avatar={
                    (() => {
                      const { icon, color } = getSubjectIcon(item.mail_subject)
                      return <Avatar style={{ backgroundColor: color }}>{icon}</Avatar>
                    })()
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
                      <span style={{ fontWeight: 'bold', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.mail_subject || '无主题'}
                      </span>
                      <Tag color={item.importance_level === 'urgent' ? 'red' : item.importance_level === 'medium' ? 'orange' : 'blue'}>
                        {item.importance_level === 'urgent' ? '紧急' : item.importance_level === 'medium' ? '中等' : '一般'}
                      </Tag>
                      <Tag color="geekblue">{item.store_name || '未找到账号'}</Tag>
                      {getFollowUpTag(item.follow_up_status)}
                      {getNeedReplyTag(item.need_reply, item.reply_text, item.follow_up_status)}
                    </div>
                  }
                  description={
                    <Space direction="vertical" style={{ width: '100%', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: '#666', flexShrink: 0 }}>
                          买家: {item.buyer_mail_number || '未知'}
                        </span>
                        <span style={{ color: '#666', flexShrink: 0 }}>
                          · 站点: {getSiteName(item.site)}
                        </span>
                        <span style={{ color: '#666', flexShrink: 0 }}>
                          · {dayjs(item.reply_date).format('YYYY-MM-DD')}
                        </span>
                      </div>
                      {item.mail_content && (
                        <p style={{ margin: 0, color: '#333', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {item.mail_content}
                        </p>
                      )}
                      {item.mail_content_chinese && (
                        <p style={{ margin: 0, color: '#666', fontSize: '13px', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {item.mail_content_chinese}
                        </p>
                      )}
                      {!item.mail_content && !item.mail_content_chinese && (
                        <p style={{ margin: 0, color: '#999' }}>暂无内容</p>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#666' }}>共 {total} 条记录</span>
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={total}
              pageSizeOptions={['10', '20', '50', '100']}
              showSizeChanger
              showQuickJumper
              showTotal={(t) => `共 ${t} 条`}
              onChange={handlePageChange}
              onShowSizeChange={handleSizeChange}
            />
          </div>
        </Card>
      </div>

      {selectedEmail && (
        <Modal
          title="邮件详情"
          open={!!selectedEmail}
          onCancel={() => setSelectedEmail(null)}
          footer={[
            <Space key="actions">
            {hasPermission('robot:email:manage') && (
              <Button
                type="primary"
                onClick={() => handleConfirmFollowUp(selectedEmail)}
                disabled={selectedEmail.follow_up_status === 1}
              >
                确认跟进
              </Button>
            )}
            {hasPermission('robot:email:manage') && (
              <Button
                type="default"
                onClick={handleOpenNeedReply}
                disabled={selectedEmail.need_reply === 1 || selectedEmail.follow_up_status === 1}
              >
                需要回复
              </Button>
            )}
              {selectedEmail.need_reply === 1 &&
                selectedEmail.follow_up_status === 0 &&
                selectedEmail.reply_text_time &&
                dayjs().diff(dayjs(selectedEmail.reply_text_time), 'hour') > 24 && (
                <Button
                  type="dashed"
                  loading={reRunLoading}
                  onClick={handleReRunRobot}
                >
                  重新运行机器人
                </Button>
              )}
              <Button key="close" onClick={() => setSelectedEmail(null)}>
                关闭
              </Button>
            </Space>,
          ]}
          width={res.isMobile ? '95vw' : 800}
          styles={{ body: { maxHeight: '60vh', overflowY: 'auto', padding: '16px 24px' } }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>基本信息</h3>
                <p style={{ margin: '4px 0' }}><strong>账号名称：</strong>{selectedEmail.store_name || '未找到账号'}</p>
                <p style={{ margin: '4px 0' }}><strong>买家邮箱：</strong>{selectedEmail.buyer_mail_number}</p>
                <p style={{ margin: '4px 0' }}><strong>邮件主题：</strong>{selectedEmail.mail_subject || '无主题'}</p>
                <p style={{ margin: '4px 0' }}><strong>订单编号：</strong>{selectedEmail.order_num || '无'}</p>
                <p style={{ margin: '4px 0', position: 'relative' }}>
                  <strong>ASIN：</strong>{selectedEmail.asin || '无'}
                  {selectedEmail.main_image_url && (
                    <span style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
                      <Image
                        src={selectedEmail.main_image_thumb_url || selectedEmail.main_image_url}
                        fallback={selectedEmail.main_image_url}
                        width={72}
                        height={72}
                        style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                      />
                    </span>
                  )}
                </p>
                <p style={{ margin: '4px 0' }}><strong>回复日期：</strong>{dayjs(selectedEmail.reply_date).format('YYYY年MM月DD日')}</p>
              </div>
              <Space direction="vertical" align="end">
                {getFollowUpTag(selectedEmail.follow_up_status)}
                {getNeedReplyTag(selectedEmail.need_reply, selectedEmail.reply_text, selectedEmail.follow_up_status)}
              </Space>
            </div>

            {selectedEmail.need_reply === 1 && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <div>
                  <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>提交回复信息</h3>
                  <Card type="inner" style={{ padding: '12px' }}>
                    <p style={{ margin: '4px 0' }}><strong>回复内容：</strong>{selectedEmail.reply_text}</p>
                    <p style={{ margin: '4px 0' }}><strong>提交时间：</strong>{dayjs(selectedEmail.reply_text_time).format('YYYY年MM月DD日 HH:mm')}</p>
                  </Card>
                </div>
              </>
            )}

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>邮件内容（对话记录）</h3>
              <Card type="inner" style={{ padding: '12px' }}>
                {renderMailConversation(selectedEmail.mail_context, selectedEmail.mail_content)}
              </Card>
            </div>

            {selectedEmail.mail_content_chinese && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>邮件内容（中文翻译）</h3>
                <Card type="inner" style={{ padding: '12px', whiteSpace: 'pre-wrap' }}>{selectedEmail.mail_content_chinese}</Card>
              </div>
            )}

            <Divider style={{ margin: '8px 0' }} />

            {selectedEmail.ai_reply_content ? (
              <div>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>🤖 AI回复内容（已回复）</h3>
                <Card type="inner" style={{ padding: '12px', backgroundColor: '#f6ffed', whiteSpace: 'pre-wrap' }}>
                  {selectedEmail.ai_reply_content}
                </Card>
                {selectedEmail.ai_reply_content_tran && (
                  <div style={{ marginTop: 8 }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#666' }}>AI回复中文翻译：</h4>
                    <Card type="inner" style={{ padding: '12px', backgroundColor: '#fff7e6', whiteSpace: 'pre-wrap', color: '#666' }}>
                      {selectedEmail.ai_reply_content_tran}
                    </Card>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '12px', background: '#fff7e6', borderRadius: 8 }}>
                <p style={{ margin: 0, color: '#fa8c16' }}>暂无AI回复内容</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      <Modal
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 32 }}>
            <span>填写回复</span>
            {hasPermission('robot:email:reply') && (
              <Button
                type="primary"
                size="small"
                loading={aiReplyGenerating}
                onClick={handleGenerateAiReply}
              >
                🤖 AI回复
              </Button>
            )}
          </div>
        }
        open={replyModalVisible}
        onCancel={() => setReplyModalVisible(false)}
        footer={null}
        zIndex={1060}
        width={res.isMobile ? '95vw' : 860}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmitNeedReply}
        >
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item
                name="replyText"
                label="回复内容"
                rules={[{ required: true, message: '请填写回复内容' }]}
              >
                <Input.TextArea
                  rows={8}
                  placeholder="请填写需要回复的内容，或点击右上角「AI回复」自动生成..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item label="中文翻译（参考）">
                <div
                  style={{
                    background: '#fff7e6',
                    border: '1px solid #ffd591',
                    borderRadius: 8,
                    padding: 12,
                    whiteSpace: 'pre-wrap',
                    color: '#666',
                    fontSize: 13,
                    lineHeight: 1.6,
                    height: 200,
                    overflowY: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {aiReplyGenerating
                    ? 'AI正在生成回复，请稍候...'
                    : aiReplyResult?.reply_text_chinese
                      ? aiReplyResult.reply_text_chinese
                      : '点击右上角「AI回复」按钮，将根据对话记录自动生成回复并填入左侧输入框，对应的中文翻译会显示在这里'}
                </div>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setReplyModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">提交</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default EmailBot
