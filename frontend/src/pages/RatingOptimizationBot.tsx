import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Input, Select, Space, Tag, message, Modal, Descriptions, Spin } from 'antd'
import {
  Star,
  Search,
  RefreshCw,
  Eye,
} from 'lucide-react'
import { productPageInfoApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'

interface RatingItem {
  id: number
  asin: string
  sku: string
  store: string
  title: string
  price: string
  image_count: number
  title_rating: string | null
  description_rating: string | null
  keywords_rating: string | null
  image_rating: string | null
}

interface RatingDetail extends RatingItem {
  keywords: string
  product_description: string | null
  bullet_points: string | null
}

const RatingOptimizationBot: React.FC = () => {
  const { currentTheme } = useTheme()
  const [data, setData] = useState<RatingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 搜索条件
  const [asinSearch, setAsinSearch] = useState('')
  const [skuSearch, setSkuSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState<string | undefined>(undefined)
  const [storeList, setStoreList] = useState<{ label: string; value: string }[]>([])

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<RatingDetail | null>(null)

  useEffect(() => {
    fetchData()
    fetchStoreList()
  }, [currentPage, pageSize])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await productPageInfoApi.getList({
        page: currentPage,
        page_size: pageSize,
        asin_search: asinSearch || undefined,
        sku_search: skuSearch || undefined,
        store_filter: storeFilter || undefined,
      })
      if (res.data.success) {
        setData(res.data.data)
        setTotal(res.data.total)
      }
      setLoading(false)
    } catch (error) {
      console.error('获取评分数据失败:', error)
      setLoading(false)
      message.error('获取评分数据失败')
    }
  }

  const fetchStoreList = async () => {
    try {
      const res = await productPageInfoApi.getStoreOptions()
      if (res.data.success) {
        setStoreList(res.data.data)
      }
    } catch (error) {
      console.error('获取店铺列表失败:', error)
    }
  }

  const handleSearch = () => {
    setCurrentPage(1)
    fetchData()
  }

  const handleViewDetail = async (record: RatingItem) => {
    setSelectedRecord(null)
    setDetailVisible(true)
    setDetailLoading(true)
    try {
      const res = await productPageInfoApi.getById(record.id)
      if (res.data.success) {
        setSelectedRecord(res.data.data)
      }
      setDetailLoading(false)
    } catch (error) {
      console.error('获取详情失败:', error)
      setDetailLoading(false)
      message.error('获取详情失败')
    }
  }

  // 将字符串评分转为数字（用于排序和颜色判断）
  const parseScore = (val: string | null): number | null => {
    if (!val) return null
    const num = parseFloat(val)
    return isNaN(num) ? null : num
  }

  const getScoreTag = (score: string | null) => {
    const val = parseScore(score)
    if (val === null) return <Tag>暂无</Tag>
    if (val >= 4.5) return <Tag color="green">{score}</Tag>
    if (val >= 3.5) return <Tag color="orange">{score}</Tag>
    return <Tag color="red">{score}</Tag>
  }

  const getAvgScore = (record: RatingItem): number | null => {
    const scores = [
      record.title_rating,
      record.description_rating,
      record.keywords_rating,
      record.image_rating,
    ].map(parseScore).filter((s): s is number => s !== null)
    if (scores.length === 0) return null
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    return Math.round(avg * 100) / 100
  }

  const columns = [
    {
      title: 'ASIN',
      dataIndex: 'asin',
      key: 'asin',
      width: 140,
      ellipsis: true,
    },
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 140,
      ellipsis: true,
    },
    {
      title: '店铺',
      dataIndex: 'store',
      key: 'store',
      width: 120,
      ellipsis: true,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 100,
    },
    {
      title: '总评分',
      key: 'total_rating',
      width: 110,
      align: 'center' as const,
      render: (_: any, record: RatingItem) => (
        <Space>
          <Star size={14} color={currentTheme.primary} />
          {getScoreTag(getAvgScore(record)?.toString())}
        </Space>
      ),
      sorter: (a: RatingItem, b: RatingItem) =>
        (getAvgScore(a) ?? 0) - (getAvgScore(b) ?? 0),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      align: 'center' as const,
      render: (_: any, record: RatingItem) => (
        <Button
          type="link"
          size="small"
          icon={<Eye size={14} />}
          onClick={() => handleViewDetail(record)}
        >
          查看详情
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* 搜索栏 */}
      <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
        <Space wrap>
          <Input
            placeholder="搜索 ASIN"
            prefix={<Search size={14} />}
            allowClear
            value={asinSearch}
            onChange={(e) => setAsinSearch(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 180 }}
          />
          <Input
            placeholder="搜索 SKU"
            prefix={<Search size={14} />}
            allowClear
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 180 }}
          />
          <Select
            placeholder="选择店铺"
            allowClear
            value={storeFilter}
            onChange={(v) => setStoreFilter(v)}
            options={storeList}
            style={{ width: 180 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
            搜索
          </Button>
          <Button icon={<RefreshCw size={14} />} onClick={() => { setCurrentPage(1); fetchData() }}>
            刷新
          </Button>
        </Space>
      </Card>

      {/* 数据表格 */}
      <Card
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
        bodyStyle={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <Table<RatingItem>
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (page, size) => {
              setCurrentPage(page)
              setPageSize(size)
            },
          }}
          scroll={{ x: 980, y: 'calc(100vh - 320px)' }}
          size="middle"
          style={{ flex: 1, overflow: 'hidden' }}
        />
      </Card>

      {/* 查看详情弹窗 */}
      <Modal
        title="产品页面详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>关闭</Button>,
        ]}
        width={720}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : selectedRecord ? (
          <Descriptions bordered column={2} size="middle">
            <Descriptions.Item label="ASIN" span={1}>{selectedRecord.asin}</Descriptions.Item>
            <Descriptions.Item label="SKU" span={1}>{selectedRecord.sku}</Descriptions.Item>
            <Descriptions.Item label="店铺" span={1}>{selectedRecord.store}</Descriptions.Item>
            <Descriptions.Item label="价格" span={1}>{selectedRecord.price}</Descriptions.Item>

            <Descriptions.Item label="标题" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
                {selectedRecord.title || '-'}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="产品描述" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                {selectedRecord.product_description || '-'}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="关键词" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                {selectedRecord.keywords || '-'}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="五点描述" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                {selectedRecord.bullet_points || '-'}
              </div>
            </Descriptions.Item>

            <Descriptions.Item label="图片数" span={1}>{selectedRecord.image_count}</Descriptions.Item>
            <Descriptions.Item label="价格" span={1}>{selectedRecord.price}</Descriptions.Item>

            <Descriptions.Item label="标题评分" span={1}>{getScoreTag(selectedRecord.title_rating)}</Descriptions.Item>
            <Descriptions.Item label="描述评分" span={1}>{getScoreTag(selectedRecord.description_rating)}</Descriptions.Item>
            <Descriptions.Item label="冠军词评分" span={1}>{getScoreTag(selectedRecord.keywords_rating)}</Descriptions.Item>
            <Descriptions.Item label="图片评分" span={1}>{getScoreTag(selectedRecord.image_rating)}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>
    </div>
  )
}

export default RatingOptimizationBot