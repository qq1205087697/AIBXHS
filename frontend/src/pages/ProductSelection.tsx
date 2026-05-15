import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, Select, message, Popconfirm, Space, Tag,
  InputNumber, Tooltip, Progress, Statistic, Row, Col, Typography, Drawer, Descriptions
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined,
  RobotOutlined, EyeOutlined, ThunderboltOutlined, BarChartOutlined,
  AlertOutlined, RiseOutlined, StarOutlined, FireOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { productSelectionApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'

const { Text, Title } = Typography

interface ProductSelectionItem {
  id: number
  tenant_id: number
  product_title: string
  url: string
  asin: string
  image_url: string
  rating: number | null
  review_count: number | null
  keywords: string
  price: number | null
  commission: number | null
  first_leg_cost: number | null
  last_mile_cost: number | null
  weight_kg: number | null
  cost_at_15_profit: number | null
  product_type: string
  monthly_sales: number | null
  traffic_trend: string
  seasonality: string
  infringement_analysis: string
  traffic_score: number | null
  sales_score: number | null
  rating_score: number | null
  penalty_factor: number | null
  composite_score: number | null
  created_at: string
  updated_at: string
}

const PRODUCT_TYPE_OPTIONS = [
  { label: '电子产品', value: '电子产品' },
  { label: '家居用品', value: '家居用品' },
  { label: '服装鞋帽', value: '服装鞋帽' },
  { label: '运动户外', value: '运动户外' },
  { label: '美妆个护', value: '美妆个护' },
  { label: '玩具游戏', value: '玩具游戏' },
  { label: '汽车配件', value: '汽车配件' },
  { label: '宠物用品', value: '宠物用品' },
  { label: '办公用品', value: '办公用品' },
  { label: '食品饮料', value: '食品饮料' },
  { label: '其他', value: '其他' },
]

const getScoreColor = (score: number | null): string => {
  if (score === null) return '#d9d9d9'
  if (score >= 8) return '#52c41a'
  if (score >= 6) return '#faad14'
  return '#ff4d4f'
}

const getScoreTag = (score: number | null, label: string) => {
  if (score === null) return <Tag color="default">-</Tag>
  return (
    <Tooltip title={label}>
      <Tag color={score >= 8 ? 'success' : score >= 6 ? 'warning' : 'error'}>
        {score.toFixed(1)}
      </Tag>
    </Tooltip>
  )
}

const ProductSelection: React.FC = () => {
  const { currentTheme } = useTheme()
  const [items, setItems] = useState<ProductSelectionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ProductSelectionItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<ProductSelectionItem | null>(null)
  const [form] = Form.useForm()
  const [searchForm] = Form.useForm()
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState({
    asin_search: '',
    keyword_search: '',
    title_search: '',
    product_type: undefined as string | undefined,
  })
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  useEffect(() => {
    fetchData()
  }, [pagination.current, pagination.pageSize, filters])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await productSelectionApi.getList({
        page: pagination.current,
        page_size: pagination.pageSize,
        ...filters,
      })
      if (res.data.success) {
        setItems(res.data.data)
        setPagination(prev => ({ ...prev, total: res.data.total }))
      }
    } catch (e) {
      message.error('获取数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    const values = await searchForm.validateFields()
    setFilters(values)
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleReset = () => {
    searchForm.resetFields()
    setFilters({ asin_search: '', keyword_search: '', title_search: '', product_type: undefined })
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleCreate = () => {
    setEditingItem(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleEdit = (item: ProductSelectionItem) => {
    setEditingItem(item)
    form.setFieldsValue({
      product_title: item.product_title,
      url: item.url || '',
      asin: item.asin || '',
      image_url: item.image_url || '',
      rating: item.rating,
      review_count: item.review_count,
      keywords: item.keywords || '',
      price: item.price,
      commission: item.commission,
      first_leg_cost: item.first_leg_cost,
      last_mile_cost: item.last_mile_cost,
      weight_kg: item.weight_kg,
      cost_at_15_profit: item.cost_at_15_profit,
      product_type: item.product_type || undefined,
      monthly_sales: item.monthly_sales,
      traffic_trend: item.traffic_trend || '',
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingItem) {
        await productSelectionApi.update(editingItem.id, values)
        message.success('更新成功')
      } else {
        await productSelectionApi.create(values)
        message.success('创建成功')
      }
      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.response?.data?.detail) {
        message.error(e.response.data.detail)
      } else if (!e.errorFields) {
        message.error('操作失败')
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await productSelectionApi.delete(id)
      message.success('删除成功')
      fetchData()
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleAnalyze = async (id: number) => {
    setAnalyzing(true)
    try {
      const res = await productSelectionApi.analyze(id)
      if (res.data.success) {
        message.success('AI分析完成')
        fetchData()
      } else {
        message.error('AI分析失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'AI分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleBatchAnalyze = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要分析的产品')
      return
    }
    setAnalyzing(true)
    try {
      const res = await productSelectionApi.batchAnalyze(selectedRowKeys as number[])
      if (res.data.success) {
        const successCount = res.data.data.filter((d: any) => d.success).length
        message.success(`批量分析完成，成功 ${successCount}/${res.data.data.length} 条`)
        setSelectedRowKeys([])
        fetchData()
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '批量分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleViewDetail = (item: ProductSelectionItem) => {
    setDetailItem(item)
    setDetailOpen(true)
  }

  const columns: ColumnsType<ProductSelectionItem> = [
    {
      title: '产品标题',
      dataIndex: 'product_title',
      key: 'product_title',
      width: 220,
      ellipsis: true,
      fixed: 'left',
      render: (text: string, record: ProductSelectionItem) => (
        <Tooltip title={text}>
          <a onClick={() => handleViewDetail(record)} style={{ color: currentTheme.primary }}>
            {text}
          </a>
        </Tooltip>
      ),
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      key: 'asin',
      width: 110,
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'product_type',
      key: 'product_type',
      width: 100,
      render: (text: string) => text ? <Tag>{text}</Tag> : '-',
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 90,
      sorter: true,
      render: (price: number | null) => price != null ? `$${price.toFixed(2)}` : '-',
    },
    {
      title: '佣金',
      dataIndex: 'commission',
      key: 'commission',
      width: 80,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '头程',
      dataIndex: 'first_leg_cost',
      key: 'first_leg_cost',
      width: 80,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '尾程',
      dataIndex: 'last_mile_cost',
      key: 'last_mile_cost',
      width: 80,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '重量(kg)',
      dataIndex: 'weight_kg',
      key: 'weight_kg',
      width: 85,
      render: (val: number | null) => val != null ? val : '-',
    },
    {
      title: '15%毛利成本',
      dataIndex: 'cost_at_15_profit',
      key: 'cost_at_15_profit',
      width: 110,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '评分',
      dataIndex: 'rating',
      key: 'rating',
      width: 70,
      render: (val: number | null) => val != null ? <StarOutlined style={{ color: '#faad14', marginRight: 4 }} /> : null,
    },
    {
      title: '评论数',
      dataIndex: 'review_count',
      key: 'review_count',
      width: 80,
    },
    {
      title: '月销量',
      dataIndex: 'monthly_sales',
      key: 'monthly_sales',
      width: 80,
      sorter: true,
    },
    {
      title: '流量趋势',
      dataIndex: 'traffic_trend',
      key: 'traffic_trend',
      width: 90,
      ellipsis: true,
    },
    {
      title: '综合评分',
      dataIndex: 'composite_score',
      key: 'composite_score',
      width: 100,
      sorter: true,
      render: (score: number | null) => {
        if (score === null) return <Tag color="default">未分析</Tag>
        return (
          <Progress
            percent={score * 10}
            size="small"
            format={() => score.toFixed(1)}
            strokeColor={getScoreColor(score)}
            style={{ minWidth: 80 }}
          />
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_: any, record: ProductSelectionItem) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)} />
          </Tooltip>
          <Tooltip title="AI分析">
            <Button
              size="small"
              icon={<RobotOutlined />}
              loading={analyzing}
              onClick={() => handleAnalyze(record.id)}
              type={record.composite_score === null ? 'primary' : 'default'}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: ProductSelectionItem) => ({
      disabled: record.composite_score !== null,
    }),
  }

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Card
        loading={loading}
        title={
          <Form form={searchForm} layout="inline" style={{ margin: 0 }}>
            <Form.Item name="asin_search" label="ASIN">
              <Input placeholder="搜索ASIN" style={{ width: 140 }} allowClear />
            </Form.Item>
            <Form.Item name="keyword_search" label="关键词">
              <Input placeholder="搜索关键词" style={{ width: 140 }} allowClear />
            </Form.Item>
            <Form.Item name="title_search" label="产品标题">
              <Input placeholder="搜索标题" style={{ width: 160 }} allowClear />
            </Form.Item>
            <Form.Item name="product_type" label="类型">
              <Select
                placeholder="选择类型"
                options={PRODUCT_TYPE_OPTIONS}
                style={{ width: 130 }}
                allowClear
              />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
                <Button onClick={handleReset}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        }
        extra={
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={handleBatchAnalyze}
              loading={analyzing}
              disabled={selectedRowKeys.length === 0}
              type={selectedRowKeys.length > 0 ? 'primary' : 'default'}
              ghost
            >
              批量AI分析 ({selectedRowKeys.length})
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新增选品
            </Button>
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
          <Table
            rowSelection={rowSelection}
            dataSource={items}
            columns={columns}
            rowKey="id"
            scroll={{ x: 2000, y: 'calc(100vh - 350px)' }}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: total => `共 ${total} 条`,
              onChange: (page, pageSize) =>
                setPagination(prev => ({ ...prev, current: page, pageSize: pageSize || 20 })),
            }}
            sticky={{ offsetHeader: 0 }}
          />
        </div>
      </Card>

      <Modal
        title={editingItem ? '编辑选品' : '新增选品'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={800}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="product_title"
                label="产品标题"
                rules={[{ required: true, message: '请输入产品标题' }]}
              >
                <Input placeholder="请输入产品标题" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="asin" label="ASIN">
                <Input placeholder="请输入ASIN" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="url" label="URL">
                <Input placeholder="请输入产品URL" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="image_url" label="图片链接">
                <Input placeholder="请输入图片链接" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="price" label="价格">
                <InputNumber style={{ width: '100%' }} placeholder="价格" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="commission" label="佣金">
                <InputNumber style={{ width: '100%' }} placeholder="佣金" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="weight_kg" label="重量(kg)">
                <InputNumber style={{ width: '100%' }} placeholder="重量" min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="first_leg_cost" label="头程">
                <InputNumber style={{ width: '100%' }} placeholder="头程费用" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="last_mile_cost" label="尾程">
                <InputNumber style={{ width: '100%' }} placeholder="尾程费用" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cost_at_15_profit" label="15%毛利时成本">
                <InputNumber style={{ width: '100%' }} placeholder="成本" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="rating" label="评分">
                <InputNumber style={{ width: '100%' }} placeholder="评分" min={0} max={5} precision={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="review_count" label="评论数">
                <InputNumber style={{ width: '100%' }} placeholder="评论数" min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="monthly_sales" label="近一个月销量">
                <InputNumber style={{ width: '100%' }} placeholder="月销量" min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="product_type" label="类型">
                <Select placeholder="请选择类型" options={PRODUCT_TYPE_OPTIONS} allowClear />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="traffic_trend" label="流量趋势">
                <Input placeholder="如：上升、下降、平稳" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="keywords" label="关键词">
                <Input placeholder="请输入关键词" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Drawer
        title="选品详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={700}
      >
        {detailItem && (
          <div>
            <Title level={4} style={{ marginBottom: 16 }}>{detailItem.product_title}</Title>

            <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="ASIN">{detailItem.asin || '-'}</Descriptions.Item>
              <Descriptions.Item label="类型">
                {detailItem.product_type ? <Tag>{detailItem.product_type}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="价格">
                {detailItem.price != null ? `$${detailItem.price.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="佣金">
                {detailItem.commission != null ? `$${detailItem.commission.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="头程">
                {detailItem.first_leg_cost != null ? `$${detailItem.first_leg_cost.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="尾程">
                {detailItem.last_mile_cost != null ? `$${detailItem.last_mile_cost.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="重量(kg)">{detailItem.weight_kg ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="15%毛利时成本">
                {detailItem.cost_at_15_profit != null ? `$${detailItem.cost_at_15_profit.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="评分">
                {detailItem.rating != null ? (
                  <span><StarOutlined style={{ color: '#faad14' }} /> {detailItem.rating}</span>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="评论数">{detailItem.review_count ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="近一个月销量">{detailItem.monthly_sales ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="流量趋势">{detailItem.traffic_trend || '-'}</Descriptions.Item>
              <Descriptions.Item label="关键词" span={2}>{detailItem.keywords || '-'}</Descriptions.Item>
              <Descriptions.Item label="URL" span={2}>
                {detailItem.url ? (
                  <a href={detailItem.url} target="_blank" rel="noopener noreferrer">
                    {detailItem.url}
                  </a>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>

            {detailItem.composite_score !== null ? (
              <>
                <Title level={5}>
                  <BarChartOutlined style={{ marginRight: 8 }} />
                  AI 分析结果
                </Title>
                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title="综合评分"
                        value={detailItem.composite_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.composite_score) }}
                        suffix="/10"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title="流量评分"
                        value={detailItem.traffic_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.traffic_score) }}
                        suffix="/10"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title="销量评分"
                        value={detailItem.sales_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.sales_score) }}
                        suffix="/10"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title="星级评分"
                        value={detailItem.rating_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.rating_score) }}
                        suffix="/10"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title="惩罚因子"
                        value={detailItem.penalty_factor ?? 0}
                        precision={1}
                        valueStyle={{ color: detailItem.penalty_factor && detailItem.penalty_factor > 1 ? '#ff4d4f' : '#52c41a' }}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card size="small" title={<span><AlertOutlined /> 季节性判断</span>} style={{ marginBottom: 12 }}>
                  <Text>{detailItem.seasonality || '-'}</Text>
                </Card>

                <Card size="small" title={<span><AlertOutlined /> 侵权分析</span>}>
                  <Text>{detailItem.infringement_analysis || '-'}</Text>
                </Card>
              </>
            ) : (
              <Card style={{ textAlign: 'center', padding: 48 }}>
                <RobotOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
                <br />
                <Text type="secondary">暂未进行AI分析</Text>
                <br />
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  onClick={() => {
                    setDetailOpen(false)
                    handleAnalyze(detailItem.id)
                  }}
                  style={{ marginTop: 16 }}
                  loading={analyzing}
                >
                  开始AI分析
                </Button>
              </Card>
            )}

            <div style={{ marginTop: 16, color: '#999', fontSize: 12 }}>
              创建时间：{detailItem.created_at}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

export default ProductSelection