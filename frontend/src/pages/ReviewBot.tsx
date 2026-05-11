import React, { useState, useEffect } from 'react'
import { Card, Row, Col, List, Button, Alert, Tag, Statistic, Divider, Space, Avatar, Modal, Checkbox, Pagination, message, Input, Select, DatePicker, Dropdown, MenuProps } from 'antd'
import {
  MessageSquare,
  AlertTriangle,
  Star,
  Languages,
  Bell,
  Eye,
  CheckSquare,
  PlayCircle,
  Search,
  ChevronDown,
} from 'lucide-react'
import { reviewsApi } from '../api'
import dayjs, { Dayjs } from 'dayjs'
import { useTheme } from '../contexts/ThemeContext'
const { RangePicker } = DatePicker

interface ReviewItem {
  id: string
  asin: string
  productName: string
  title?: string
  rating: number
  originalText: string
  translatedText: string
  keyPoints: string[]
  topics: string[]
  suggestions: string[]
  date: string
  status: 'new' | 'read' | 'processing' | 'resolved'
  author: string
  isNew?: boolean
  importanceLevel?: string
  returnRate?: number
}

const ReviewBot: React.FC = () => {
  const { currentTheme } = useTheme()
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [batchModalVisible, setBatchModalVisible] = useState(false)
  const [batchAction, setBatchAction] = useState<'analyze' | 'status' | null>(null)
  const [batchStatus, setBatchStatus] = useState<'new' | 'processing' | 'resolved'>('processing')

  // 搜索和排序状态
  const [asinSearch, setAsinSearch] = useState('')
  const [productNameSearch, setProductNameSearch] = useState('')
  const [skuSearch, setSkuSearch] = useState('')
  const [sortBy, setSortBy] = useState('time')
  const [sortOrder, setSortOrder] = useState('desc')
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null])
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [importanceLevelFilter, setImportanceLevelFilter] = useState<string | undefined>(undefined)

  useEffect(() => {
    fetchReviewData()
  }, [currentPage, pageSize, asinSearch, productNameSearch, skuSearch, sortBy, sortOrder, dateRange, statusFilter, importanceLevelFilter])

  const fetchReviewData = async () => {
    try {
      setLoading(true)
      const params = {
        page: currentPage,
        page_size: pageSize,
        asin_search: asinSearch || undefined,
        product_name_search: productNameSearch || undefined,
        sku_search: skuSearch || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        start_date: dateRange?.[0]?.format('YYYY-MM-DD') || undefined,
        end_date: dateRange?.[1]?.format('YYYY-MM-DD') || undefined,
        status: statusFilter,
        importance_level: importanceLevelFilter,
      }
      const response = await reviewsApi.getList(params)
      if (response.data.success) {
        // 根据id去重，避免重复数据
        const uniqueReviews = response.data.data.filter((item: ReviewItem, index: number, self: ReviewItem[]) =>
          index === self.findIndex((t) => t.id === item.id)
        ).map((item: ReviewItem) => ({
          ...item,
          // 确保 importanceLevel 是 null 而不是 undefined（只有真的为空才设为 null）
          importanceLevel: item.importanceLevel || null
        }))
        setReviews(uniqueReviews)
        setTotal(response.data.total)
      }
    } catch (error) {
      console.error('获取差评数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewReview = async (review: ReviewItem) => {
    setSelectedReview(review)
    if (review.status === 'new') {
      try {
        await reviewsApi.updateStatus(review.id, 'read')
        setReviews(reviews.map(r => r.id === review.id ? { ...r, status: 'read', isNew: false } : r))
      } catch (error) {
        console.error('更新状态失败:', error)
      }
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(reviews.map(r => r.id))
    } else {
      setSelectedIds([])
    }
  }

  const handleSelect = (reviewId: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, reviewId])
    } else {
      setSelectedIds(selectedIds.filter(id => id !== reviewId))
    }
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    setSelectedIds([])
  }

  const handleSizeChange = (_current: number, size: number) => {
    setPageSize(size)
    setCurrentPage(1)
    setSelectedIds([])
  }

  const handleBatchAnalyze = async () => {
    setBatchModalVisible(false)
    setAnalyzing(true)
    try {
      const response = await reviewsApi.batchAnalyze(selectedIds)

      if (response.data.success) {
        message.success(response.data.message)
        setSelectedIds([])
      } else {
        message.error('批量分析失败')
      }
    } catch (error) {
      console.error('批量分析失败:', error)
      if ((error as any)?.code === 'ECONNABORTED' || (error as any)?.message?.includes('timeout')) {
        message.success('分析任务已提交，后台正在处理中，请稍后刷新查看')
        setSelectedIds([])
      } else {
        message.error('批量分析失败，请重试')
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const handleBatchUpdateStatus = async () => {
    setBatchModalVisible(false)
    try {
      // 逐个更新状态
      await Promise.all(
        selectedIds.map(id => reviewsApi.updateStatus(id, batchStatus))
      )
      setReviews(prev => prev.map(r => 
        selectedIds.includes(r.id) ? { ...r, status: batchStatus } : r
      ))
      // 更新选中项的状态
      if (selectedReview && selectedIds.includes(selectedReview.id)) {
        setSelectedReview(prev => prev ? { ...prev, status: batchStatus } : null)
      }
      message.success(`已批量标记为${batchStatus === 'new' ? '未读' : batchStatus === 'read' ? '已读' : '已处理'}`)
      setSelectedIds([])
    } catch (error) {
      console.error('批量更新失败:', error)
      message.error('批量更新失败，请重试')
    }
  }

  const handleBatchConfirm = () => {
    if (batchAction === 'analyze') {
      handleBatchAnalyze()
    } else if (batchAction === 'status') {
      handleBatchUpdateStatus()
    }
  }

  const statusMenuItems: MenuProps['items'] = [
    {
      key: 'new',
      label: '变更为未读',
      onClick: () => {
        setBatchAction('status')
        setBatchStatus('new')
        setBatchModalVisible(true)
      },
    },
    {
      key: 'read',
      label: '变更为已读',
      onClick: () => {
        setBatchAction('status')
        setBatchStatus('read')
        setBatchModalVisible(true)
      },
    },
    {
      key: 'resolved',
      label: '变更为已处理',
      onClick: () => {
        setBatchAction('status')
        setBatchStatus('resolved')
        setBatchModalVisible(true)
      },
    },
  ]

  const handleResetSearch = () => {
    setAsinSearch('')
    setProductNameSearch('')
    setSkuSearch('')
    setSortBy('time')
    setSortOrder('desc')
    setDateRange([null, null])
    setStatusFilter(undefined)
    setImportanceLevelFilter(undefined)
    setCurrentPage(1)
  }

  const getStatusBadge = (status: string, isNew?: boolean) => {
    if (isNew) {
      return <Tag color="red">新差评</Tag>
    }
    const statusMap: Record<string, { color: string; text: string }> = {
      new: { color: 'gray', text: '未查看' },
      read: { color: 'blue', text: '已读' },
      processing: { color: 'orange', text: '处理中' },
      resolved: { color: 'green', text: '已解决' },
    }
    const s = statusMap[status] || statusMap.read
    return <Tag color={s.color}>{s.text}</Tag>
  }

  const getImportanceBadge = (level?: string | null) => {
    if (!level) {
      return <Tag color="default">待分析</Tag>
    }
    const map: Record<string, { color: string; text: string }> = {
      high: { color: 'red', text: '严重' },
      medium: { color: 'orange', text: '中等' },
      low: { color: 'blue', text: '轻微' },
    }
    const l = map[level] || map.medium
    return <Tag color={l.color}>{l.text}</Tag>
  }

  const handleUpdateImportance = async (id: string, level: string | undefined) => {
    try {
      await reviewsApi.updateImportance(id, level)
      setReviews(prev => prev.map(r => r.id === id ? { ...r, importanceLevel: level || null } : r))
      if (selectedReview?.id === id) {
        setSelectedReview(prev => prev ? { ...prev, importanceLevel: level || null } : null)
      }
      message.success('重要性等级已更新')
    } catch (e) {
      message.error('更新失败')
    }
  }

  const handleMarkAsRead = async () => {
    if (!selectedReview) return
    try {
      await reviewsApi.updateStatus(selectedReview.id, 'read')
      setReviews(prev => prev.map(r => r.id === selectedReview.id ? { ...r, status: 'read' } : r))
      setSelectedReview(prev => prev ? { ...prev, status: 'read' } : null)
      message.success('已标记为已读')
    } catch (e) {
      message.error('标记失败')
    }
  }

  const handleMarkAsResolved = async () => {
    if (!selectedReview) return
    try {
      await reviewsApi.updateStatus(selectedReview.id, 'resolved')
      setReviews(prev => prev.map(r => r.id === selectedReview.id ? { ...r, status: 'resolved' } : r))
      setSelectedReview(prev => prev ? { ...prev, status: 'resolved' } : null)
      message.success('已标记为已处理')
    } catch (e) {
      message.error('标记失败')
    }
  }

  const getRatingStars = (rating: number) => {
    return Array(5).fill(0).map((_, i) => (
      <Star
        key={i}
        size={16}
        fill={i < rating ? '#faad14' : '#d9d9d9'}
        color={i < rating ? '#faad14' : '#d9d9d9'}
      />
    ))
  }

  const hasSelected = selectedIds.length > 0

  // 计算统计数据 - 按重要性等级分组
  const importanceStats = {
    high: {
      unviewed: reviews.filter(r => r.importanceLevel === 'high' && r.status !== 'resolved').length,
      viewed: reviews.filter(r => r.importanceLevel === 'high' && r.status === 'resolved').length
    },
    medium: {
      unviewed: reviews.filter(r => r.importanceLevel === 'medium' && r.status !== 'resolved').length,
      viewed: reviews.filter(r => r.importanceLevel === 'medium' && r.status === 'resolved').length
    },
    low: {
      unviewed: reviews.filter(r => r.importanceLevel === 'low' && r.status !== 'resolved').length,
      viewed: reviews.filter(r => r.importanceLevel === 'low' && r.status === 'resolved').length
    }
  }

  const renderImportanceCard = (level: 'high' | 'medium' | 'low', title: string, color: string) => {
    const stats = importanceStats[level]
    return (
      <Col xs={24} sm={12} md={8}>
        <Card>
          <div style={{ 
            textAlign: 'center',
            marginBottom: 12
          }}>
            <span style={{ fontSize: '16px', fontWeight: 600, color }}>{title}</span>
          </div>
          <Row gutter={16}>
            <Col flex={1}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: 4 }}>未处理</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#faad14' }}>
                  {stats.unviewed}
                </div>
              </div>
            </Col>
            <Col flex={1}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: 4 }}>已处理</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#52c41a' }}>
                  {stats.viewed}
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      </Col>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '24px' }}>
        {/* 统计卡片区域 - 按重要性等级展示 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }} wrap={true}>
          {renderImportanceCard('high', '严重等级', '#cf1322')}
          {renderImportanceCard('medium', '中等等级', '#faad14')}
          {renderImportanceCard('low', '轻微等级', '#1890ff')}
        </Row>

        {/* 搜索和排序区域 */}
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={12} md={3}>
              <Input
                placeholder="搜索ASIN"
                prefix={<Search size={16} />}
                value={asinSearch}
                onChange={(e) => { setAsinSearch(e.target.value); setCurrentPage(1) }}
                allowClear
              />
            </Col>
            <Col xs={24} sm={12} md={3}>
              <Input
                placeholder="搜索产品名"
                prefix={<Search size={16} />}
                value={productNameSearch}
                onChange={(e) => { setProductNameSearch(e.target.value); setCurrentPage(1) }}
                allowClear
              />
            </Col>
            <Col xs={24} sm={12} md={4}>
              <RangePicker
                value={dateRange}
                onChange={(dates) => { setDateRange(dates); setCurrentPage(1) }}
                style={{ width: '100%' }}
                placeholder={['开始日期', '结束日期']}
              />
            </Col>
            <Col xs={24} sm={12} md={3}>
              <Select
                value={statusFilter}
                onChange={(value) => { 
                  setStatusFilter(value || undefined)
                  setCurrentPage(1) 
                }}
                style={{ width: '100%' }}
                placeholder="状态筛选"
                allowClear
                options={[
                  { value: 'new', label: '未读' },
                  { value: 'read', label: '已读' },
                  { value: 'resolved', label: '已处理' },
                ]}
              />
            </Col>
            <Col xs={24} sm={12} md={3}>
              <Select
                value={importanceLevelFilter}
                onChange={(value) => { 
                  setImportanceLevelFilter(value || undefined)
                  setCurrentPage(1) 
                }}
                style={{ width: '100%' }}
                placeholder="重要等级筛选"
                allowClear
                options={[
                  { value: 'high', label: '严重' },
                  { value: 'medium', label: '中等' },
                  { value: 'low', label: '轻微' },
                ]}
              />
            </Col>
            <Col xs={24} sm={24} md={8}>
              <Space>
                <Select
                  value={sortBy}
                  onChange={(value) => { setSortBy(value); setCurrentPage(1) }}
                  style={{ width: 120 }}
                  options={[
                    { value: 'time', label: '时间排序' },
                    { value: 'return_rate', label: '退货率排序' },
                    { value: 'review_count', label: '差评数排序' },
                  ]}
                />
                <Select
                  value={sortOrder}
                  onChange={(value) => { setSortOrder(value); setCurrentPage(1) }}
                  style={{ width: 100 }}
                  options={[
                    { value: 'desc', label: '降序' },
                    { value: 'asc', label: '升序' },
                  ]}
                />
                <Button onClick={handleResetSearch}>重置</Button>
              </Space>
            </Col>
          </Row>
        </Card>

        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontWeight: 600 }}>差评列表</span>
              <Checkbox
                checked={selectedIds.length === reviews.length && reviews.length > 0}
                indeterminate={selectedIds.length > 0 && selectedIds.length < reviews.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
                style={{ '--ant-checkbox-color': currentTheme.primary, fontWeight: 'normal' } as React.CSSProperties}
              >
                <span style={{ fontWeight: 'normal' }}>全选 ({selectedIds.length})</span>
              </Checkbox>
            </div>
          }
          loading={loading}
          extra={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button
                disabled={!hasSelected}
                onClick={() => {
                  setBatchAction('analyze')
                  setBatchModalVisible(true)
                }}
                style={{ borderColor: currentTheme.primary, color: currentTheme.primary }}
              >
                AI分析选中
              </Button>
              <Dropdown menu={{ items: statusMenuItems }} disabled={!hasSelected}>
                <Button>
                  变更状态 <ChevronDown size={16} style={{ marginLeft: 4 }} />
                </Button>
              </Dropdown>
            </div>
          }
        >
          <List
            itemLayout="horizontal"
            dataSource={reviews}
            style={{ width: '100%', overflow: 'hidden' }}
            renderItem={(item) => (
              <List.Item
                style={{ width: '100%' }}
                actions={[
                  <Button
                    type="primary"
                    icon={<Eye size={16} />}
                    onClick={() => handleViewReview(item)}
                    style={{ backgroundColor: currentTheme.primary, borderColor: currentTheme.primary }}
                  >
                    查看详情
                  </Button>
                ]}
              >
                <Checkbox
                  checked={selectedIds.includes(item.id)}
                  onChange={(e) => handleSelect(item.id, e.target.checked)}
                  style={{ marginRight: 12, flexShrink: 0, '--ant-checkbox-color': currentTheme.primary } as React.CSSProperties}
                />
                <List.Item.Meta
                  avatar={<Avatar style={{ backgroundColor: currentTheme.avatarBg, flexShrink: 0 }}>{item.author[0]}</Avatar>}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
                      <span style={{ fontWeight: 'bold', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title || item.originalText?.substring(0, 50) + (item.originalText?.length > 50 ? '...' : '')}
                      </span>
                      <span style={{ color: '#666', fontSize: '13px' }}>({item.productName} · ASIN: {item.asin})</span>
                      {/* 显示退货率标签 */}
                      {(() => {
                        const rate = item.returnRate;
                        // 检查是否是有效的数值
                        if (rate !== undefined && rate !== null && !isNaN(Number(rate))) {
                          const numRate = Number(rate);
                          const color = numRate > 15 ? 'error' : numRate > 10 ? 'warning' : 'success';
                          return (
                            <Tag key="return-rate" color={color}>
                              退货率: {numRate.toFixed(2)}%
                            </Tag>
                          );
                        }
                        return null;
                      })()}
                      {getImportanceBadge(item.importanceLevel)}
                      {getStatusBadge(item.status, item.isNew)}
                    </div>
                  }
                  description={
                    <Space direction="vertical" style={{ width: '100%', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Space style={{ flexShrink: 0 }}>{getRatingStars(item.rating)}</Space>
                        <span style={{ marginLeft: 16, color: '#666', flexShrink: 0 }}>
                          {item.author} · {dayjs(item.date).format('YYYY-MM-DD HH:mm')}
                        </span>
                      </div>
                      <p style={{ margin: 0, color: '#333', wordBreak: 'break-word' }}>{item.originalText}</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Array.isArray(item.keyPoints) && item.keyPoints.map((point, idx) => (
                          <Tag key={idx} color={currentTheme.primary} style={{ flexShrink: 0 }}>{point}</Tag>
                        ))}
                      </div>
                      {Array.isArray(item.suggestions) && item.suggestions.length > 0 && (
                        <div>
                          <div style={{ fontSize: '12px', color: '#666', marginBottom: 4 }}>🤖 AI处理建议：</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {item.suggestions.map((suggestion, idx) => (
                              <Tag key={`suggestion-${idx}`} color="blue" style={{ flexShrink: 0 }}>{suggestion}</Tag>
                            ))}
                          </div>
                        </div>
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

      {selectedReview && (
        <Modal
          title="差评详情"
          open={!!selectedReview}
          onCancel={() => setSelectedReview(null)}
          footer={[
            <Button key="close" onClick={() => setSelectedReview(null)}>关闭</Button>,
            selectedReview?.status !== 'read' && selectedReview?.status !== 'resolved' && (
              <Button 
                key="read" 
                onClick={handleMarkAsRead}
              >
                标记为已读
              </Button>
            ),
            selectedReview?.status !== 'resolved' && (
              <Button 
                key="resolve" 
                type="primary" 
                onClick={handleMarkAsResolved}
                style={{ backgroundColor: currentTheme.primary, borderColor: currentTheme.primary }}
              >
                标记为已处理
              </Button>
            ),
          ]}
          width={800}
          styles={{ body: { maxHeight: '60vh', overflowY: 'auto', padding: '16px 24px' } }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>商品信息</h3>
                <p style={{ margin: '4px 0' }}><strong>商品：</strong>{selectedReview.productName}</p>
                <p style={{ margin: '4px 0' }}><strong>ASIN：</strong>{selectedReview.asin}</p>
                {/* 显示退货率 */}
                {(() => {
                  const rate = selectedReview.returnRate;
                  if (rate !== undefined && rate !== null && !isNaN(Number(rate))) {
                    const numRate = Number(rate);
                    const color = numRate > 15 ? 'error' : numRate > 10 ? 'warning' : 'success';
                    return (
                      <p key="return-rate" style={{ margin: '4px 0' }}>
                        <strong>退货率：</strong>
                        <Tag color={color}>
                          {numRate.toFixed(2)}%
                        </Tag>
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
              <div style={{ textAlign: 'right' }}>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>评分</h3>
                <Space>{getRatingStars(selectedReview.rating)}</Space>
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 13, color: '#666', marginRight: 8 }}>重要性：</span>
                  <Select
                    size="small"
                    value={selectedReview.importanceLevel || undefined}
                    onChange={(v) => handleUpdateImportance(selectedReview.id, v)}
                    style={{ width: 110 }}
                    options={[
                      { value: undefined, label: '⏳ 待分析' },
                      { value: 'high', label: '🔴 严重' },
                      { value: 'medium', label: '🟠 中等' },
                      { value: 'low', label: '🔵 轻微' },
                    ]}
                  />
                </div>
              </div>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Languages size={18} /> 原文（英文）
              </h3>
              <Card type="inner" style={{ padding: '12px' }}>{selectedReview.originalText}</Card>
            </div>

            <div>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Languages size={18} /> AI翻译（中文）
              </h3>
              <Card type="inner" style={{ padding: '12px' }}>{selectedReview.translatedText || '暂无翻译'}</Card>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>🏷️ 问题分类</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Array.isArray(selectedReview.topics) && selectedReview.topics.map((topic, idx) => (
                  <Tag key={idx} color="blue">{topic}</Tag>
                ))}
              </div>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>🤖 AI 核心诉求提炼</h3>
              <List
                dataSource={Array.isArray(selectedReview.keyPoints) ? selectedReview.keyPoints : []}
                style={{ margin: 0 }}
                renderItem={(point) => (
                  <List.Item style={{ padding: '4px 0', minHeight: 'auto' }}>
                    <Tag color={currentTheme.primary} style={{ fontSize: 13, padding: '4px 12px' }}>{point}</Tag>
                  </List.Item>
                )}
              />
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>💡 AI 处理建议</h3>
              {Array.isArray(selectedReview.suggestions) && selectedReview.suggestions.length > 0 ? (
                <List
                  dataSource={selectedReview.suggestions}
                  style={{ margin: 0 }}
                  renderItem={(suggestion) => (
                    <List.Item style={{ padding: '4px 0', minHeight: 'auto' }}>
                      <Alert
                        message={suggestion}
                        type="info"
                        showIcon
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Alert
                  message="暂无AI建议"
                  description="请先对该评论进行AI分析"
                  type="warning"
                  showIcon
                />
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 批量操作确认弹窗 */}
      <Modal
        title={batchAction === 'analyze' ? '确认AI分析' : '确认批量标记'}
        open={batchModalVisible}
        onOk={handleBatchConfirm}
        onCancel={() => setBatchModalVisible(false)}
        confirmLoading={analyzing}
        okText="确认"
        cancelText="取消"
      >
        {batchAction === 'analyze' ? (
          <div>
            <p>您确定要对选中的 <strong>{selectedIds.length}</strong> 条差评进行AI分析吗？</p>
            <p style={{ color: '#999', fontSize: '12px' }}>注意：分析过程可能需要一些时间，请耐心等待。</p>
          </div>
        ) : (
          <div>
            <p>您确定要将选中的 <strong>{selectedIds.length}</strong> 条差评标记为 <strong>{batchStatus === 'new' ? '未读' : batchStatus === 'read' ? '已读' : '已处理'}</strong> 吗？</p>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default ReviewBot
