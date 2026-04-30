import React, { useState, useEffect } from 'react'
import { Card, Row, Col, List, Button, Alert, Tag, Statistic, Divider, Space, Avatar, Modal, Checkbox, Pagination, message, Input, Select } from 'antd'
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
} from 'lucide-react'
import axios from 'axios'
import dayjs from 'dayjs'
import { useTheme } from '../contexts/ThemeContext'

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

  // 搜索和排序状态
  const [asinSearch, setAsinSearch] = useState('')
  const [productNameSearch, setProductNameSearch] = useState('')
  const [skuSearch, setSkuSearch] = useState('')
  const [sortBy, setSortBy] = useState('time')
  const [sortOrder, setSortOrder] = useState('desc')

  useEffect(() => {
    fetchReviewData()
  }, [currentPage, pageSize, asinSearch, productNameSearch, skuSearch, sortBy, sortOrder])

  const fetchReviewData = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/reviews/', {
        params: {
          page: currentPage,
          page_size: pageSize,
          asin_search: asinSearch || undefined,
          product_name_search: productNameSearch || undefined,
          sku_search: skuSearch || undefined,
          sort_by: sortBy,
          sort_order: sortOrder
        }
      })
      if (response.data.success) {
        // 根据id去重，避免重复数据
        const uniqueReviews = response.data.data.filter((item: ReviewItem, index: number, self: ReviewItem[]) =>
          index === self.findIndex((t) => t.id === item.id)
        )
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
        await axios.put(`/api/reviews/${review.id}/status`, {
          status: 'read'
        })
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
    if (selectedIds.length === 0) {
      message.warning('请至少选择一条评论')
      return
    }

    setAnalyzing(true)
    try {
      const response = await axios.post('/api/reviews/analyze/batch', selectedIds, {
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (response.data.success) {
        message.success(response.data.message)
        await fetchReviewData()
      } else {
        message.error('批量分析失败')
      }
    } catch (error) {
      console.error('批量分析失败:', error)
      message.error('批量分析失败，请重试')
    } finally {
      setAnalyzing(false)
      setSelectedIds([])
    }
  }

  const handleResetSearch = () => {
    setAsinSearch('')
    setProductNameSearch('')
    setSkuSearch('')
    setSortBy('time')
    setSortOrder('desc')
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

  // 计算统计数据
  const today = dayjs().startOf('day')
  const thisMonth = dayjs().startOf('month')
  const todayNewCount = reviews.filter(r => dayjs(r.date).isAfter(today) && r.isNew).length
  const pendingCount = reviews.filter(r => r.status === 'new' || r.status === 'read').length
  const thisMonthCount = reviews.filter(r => dayjs(r.date).isAfter(thisMonth)).length
  const resolvedCount = reviews.filter(r => r.status === 'resolved').length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '24px' }}>
        {/* 统计卡片区域 */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }} wrap={true}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日新增差评"
                value={todayNewCount}
                valueStyle={{ color: '#cf1322' }}
                prefix={<AlertTriangle size={18} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="待处理差评"
                value={pendingCount}
                valueStyle={{ color: '#faad14' }}
                prefix={<Bell size={18} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="本月差评总数"
                value={thisMonthCount}
                valueStyle={{ color: currentTheme.primary }}
                prefix={<MessageSquare size={18} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="已解决"
                value={resolvedCount}
                valueStyle={{ color: '#3f8600' }}
                prefix={<CheckSquare size={18} />}
              />
            </Card>
          </Col>
        </Row>

        {/* 搜索和排序区域 */}
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={12} md={8} lg={6}>
              <Input
                placeholder="搜索ASIN"
                prefix={<Search size={16} />}
                value={asinSearch}
                onChange={(e) => { setAsinSearch(e.target.value); setCurrentPage(1) }}
                allowClear
              />
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Input
                placeholder="搜索产品名"
                prefix={<Search size={16} />}
                value={productNameSearch}
                onChange={(e) => { setProductNameSearch(e.target.value); setCurrentPage(1) }}
                allowClear
              />
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Input
                placeholder="搜索SKU"
                prefix={<Search size={16} />}
                value={skuSearch}
                onChange={(e) => { setSkuSearch(e.target.value); setCurrentPage(1) }}
                allowClear
              />
            </Col>
            <Col xs={24} sm={12} md={24} lg={6}>
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
          title="差评列表"
          loading={loading}
          extra={
            <div style={{ display: 'flex', gap: 12 }}>
              <Checkbox
                checked={selectedIds.length === reviews.length && reviews.length > 0}
                indeterminate={selectedIds.length > 0 && selectedIds.length < reviews.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
                style={{ '--ant-checkbox-color': currentTheme.primary } as React.CSSProperties}
              >
                全选 ({selectedIds.length})
              </Checkbox>
              <Button
                icon={<PlayCircle size={16} />}
                onClick={handleBatchAnalyze}
                disabled={!hasSelected || analyzing}
                loading={analyzing}
                style={{ backgroundColor: 'white', borderColor: currentTheme.primary, color: currentTheme.primary }}
              >
                {analyzing ? '分析中...' : `AI分析选中项 (${selectedIds.length})`}
              </Button>
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
            <Button key="process" type="primary" style={{ backgroundColor: currentTheme.primary, borderColor: currentTheme.primary }}>标记为处理中</Button>,
          ]}
          width={800}
          bodyStyle={{ maxHeight: '60vh', overflowY: 'auto', padding: '16px 24px' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>商品信息</h3>
                <p style={{ margin: '4px 0' }}><strong>商品：</strong>{selectedReview.productName}</p>
                <p style={{ margin: '4px 0' }}><strong>ASIN：</strong>{selectedReview.asin}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h3 style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>评分</h3>
                <Space>{getRatingStars(selectedReview.rating)}</Space>
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
    </div>
  )
}

export default ReviewBot
