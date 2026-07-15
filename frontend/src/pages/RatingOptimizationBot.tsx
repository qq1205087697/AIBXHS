import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Input, Select, Space, Tag, message, Modal, Descriptions, Spin, Row, Col, Pagination, Radio, Checkbox, Dropdown } from 'antd'
import {
  Search,
  RefreshCw,
  Eye,
  Upload,
} from 'lucide-react'
import { productPageInfoApi } from '../api'

interface RatingItem {
  id: number
  tenant_id?: number
  asin?: string | null
  sku?: string | null
  store?: string | null
  store_original?: string | null
  title?: string | null
  keywords?: string | null
  product_description?: string | null
  bullet_points?: string | null
  price?: string | null
  image_count?: number | null
  title_rating?: string | null
  description_rating?: string | null
  keywords_rating?: string | null
  image_rating?: string | null
  star_rating?: number | null
  star_rating_score?: number | null
  competitor_price?: string | null
  competitor_price_rank: number
  competitor_price_score: number
  has_ad: boolean
  has_aplus: number
  has_video: boolean
  rating_status?: number
  total_score: number
  traffic_keywords?: string | null
}

interface RatingDetail extends RatingItem {
  // RatingItem已包含所有字段，RatingDetail暂时保留用于类型兼容
}

// 缓存结构
interface CacheData {
  data: RatingItem[]
  total: number
}

const RatingOptimizationBot: React.FC = () => {
  const [data, setData] = useState<RatingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 搜索条件
  const [asinSearch, setAsinSearch] = useState('')
  const [skuSearch, setSkuSearch] = useState('')
  const [storeFilter, setStoreFilter] = useState<string | undefined>(undefined)
  const [ratingStatusFilter, setRatingStatusFilter] = useState<string>('all') // 'all', 'rated', 'unrated'
  const [storeList, setStoreList] = useState<{ label: string; value: string }[]>([])

  // 数据缓存 - 按筛选类型缓存
  const dataCache = useRef<Map<string, CacheData>>(new Map())

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<RatingDetail | null>(null)
  const [detailTab, setDetailTab] = useState<'product' | 'score'>('product')

  // 批量选择
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // 排行榜
  const [rankingData, setRankingData] = useState<{ top10: any[]; bottom10: any[] }>({ top10: [], bottom10: [] })
  const [rankingExpanded, setRankingExpanded] = useState(false)

  // 计算当前页全选状态
  const currentPageIds = data.map(item => item.id)
  const isAllSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.includes(id))
  const currentPageSelectedCount = currentPageIds.filter(id => selectedIds.includes(id)).length

  // 根据分页数计算卡片列宽
  const getColSpan = () => {
    if (pageSize <= 20) return 6   // 每行 4 个，卡片更大
    if (pageSize <= 40) return 4   // 每行 6 个
    return null // 40以上使用固定宽度
  }

  useEffect(() => {
    fetchData()
    fetchStoreList()
  }, [currentPage, pageSize, ratingStatusFilter])

  const fetchData = async (forceRefresh = false) => {
    // 生成缓存键
    const cacheKey = `${ratingStatusFilter}-${currentPage}-${pageSize}`

    // 检查缓存，非强制刷新时先显示缓存数据
    if (!forceRefresh && dataCache.current.has(cacheKey)) {
      const cached = dataCache.current.get(cacheKey)!
      setData(cached.data)
      setTotal(cached.total)
      // 后台静默刷新，不显示loading
      refreshData(cacheKey)
      return
    }

    setLoading(true)
    try {
      let ratingStatusValue: number | undefined = undefined
      if (ratingStatusFilter === 'rated') ratingStatusValue = 1
      else if (ratingStatusFilter === 'unrated') ratingStatusValue = 0

      const res = await productPageInfoApi.getList({
        page: currentPage,
        page_size: pageSize,
        asin_search: asinSearch || undefined,
        sku_search: skuSearch || undefined,
        store_filter: storeFilter || undefined,
        rating_status: ratingStatusValue,
      })
      if (res.data.success) {
        setData(res.data.data)
        setTotal(res.data.total)
        // 更新缓存
        dataCache.current.set(cacheKey, { data: res.data.data, total: res.data.total })
      }
      setLoading(false)
    } catch (error) {
      console.error('获取评分数据失败:', error)
      setLoading(false)
      message.error('获取评分数据失败')
    }
  }

  // 后台静默刷新数据
  const refreshData = async (cacheKey: string) => {
    try {
      let ratingStatusValue: number | undefined = undefined
      if (ratingStatusFilter === 'rated') ratingStatusValue = 1
      else if (ratingStatusFilter === 'unrated') ratingStatusValue = 0

      const res = await productPageInfoApi.getList({
        page: currentPage,
        page_size: pageSize,
        asin_search: asinSearch || undefined,
        sku_search: skuSearch || undefined,
        store_filter: storeFilter || undefined,
        rating_status: ratingStatusValue,
      })
      if (res.data.success) {
        setData(res.data.data)
        setTotal(res.data.total)
        dataCache.current.set(cacheKey, { data: res.data.data, total: res.data.total })
      }
    } catch (error) {
      console.error('后台刷新数据失败:', error)
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

  const fetchRanking = async () => {
    try {
      console.log('[DEBUG] 调用排行榜API...')
      const res = await productPageInfoApi.getRanking()
      console.log('[DEBUG] 排行榜响应:', res.data)
      if (res.data.success) {
        setRankingData(res.data.data)
        console.log('[DEBUG] top10:', res.data.data.top10)
        console.log('[DEBUG] bottom10:', res.data.data.bottom10)
      }
    } catch (error) {
      console.error('[DEBUG] 获取排行榜失败:', error)
    }
  }

  const handleSearch = () => {
    setCurrentPage(1)
    // 清空缓存，搜索条件变化后需要重新获取
    dataCache.current.clear()
    fetchData(true)
  }

  const handleRefresh = () => {
    setCurrentPage(1)
    dataCache.current.clear()
    fetchData(true)
  }

  // 导入Excel
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      message.error('只支持Excel表格文件（.xlsx/.xls）')
      return
    }

    setImporting(true)
    try {
      const res = await productPageInfoApi.importExcel(file)
      if (res.data.success) {
        message.success(res.data.message)
        dataCache.current.clear()
        fetchData(true)
      } else {
        message.error(res.data.message || '导入失败')
      }
    } catch (error) {
      console.error('导入Excel失败:', error)
      message.error('导入失败，请检查文件格式')
    } finally {
      setImporting(false)
      // 清空file input，允许重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleViewDetail = async (record: RatingItem) => {
    // 调用详情API获取完整数据（包含traffic_keywords等字段）
    setDetailVisible(true)
    setDetailTab('product')
    setSelectedRecord(record) // 先显示列表数据，快速响应
    try {
      const res = await productPageInfoApi.getById(record.id)
      if (res.data.success) {
        setSelectedRecord(res.data.data)
      }
    } catch (error) {
      console.error('获取详情失败:', error)
    }
  }

  const handleDeleteCompetitor = async (competitorLine: string) => {
    if (!selectedRecord) return
    console.log('[DEBUG] 准备删除竞品:', competitorLine, '产品ID:', selectedRecord.id)
    try {
      const res = await productPageInfoApi.deleteCompetitor(selectedRecord.id, competitorLine)
      console.log('[DEBUG] API响应:', res.data)
      if (res.data.success) {
        message.success('删除成功，已重新排名')
        // 更新当前详情数据
        setSelectedRecord({
          ...selectedRecord,
          competitor_price: res.data.data.competitor_price,
          competitor_price_rank: res.data.data.competitor_price_rank,
          competitor_price_score: res.data.data.competitor_price_score,
          total_score: res.data.data.total_score,
        })
        // 刷新列表数据
        fetchData()
      } else {
        message.error(res.data.message || '删除竞品失败')
      }
    } catch (error: any) {
      console.error('[DEBUG] 删除竞品失败:', error)
      console.error('[DEBUG] 错误详情:', error?.response?.data)
      message.error(error?.response?.data?.message || '删除竞品失败')
    }
  }

  // 批量选择处理
  const handleSelectItem = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id])
    } else {
      setSelectedIds(selectedIds.filter(i => i !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 选中当前页所有数据（保留之前选中的其他页数据）
      const newIds = [...new Set([...selectedIds, ...currentPageIds])]
      setSelectedIds(newIds)
    } else {
      // 取消当前页所有数据（保留之前选中的其他页数据）
      setSelectedIds(selectedIds.filter(id => !currentPageIds.includes(id)))
    }
  }

  const handleSubmitRating = async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择数据')
      return
    }

    setLoading(true)
    try {
      const res = await productPageInfoApi.submitRating(selectedIds)
      if (res.data.success) {
        message.success(`成功提交 ${res.data.data.count} 条数据到飞书`)
        // 清空选中状态
        setSelectedIds([])
      } else {
        message.error(res.data.message || '提交失败')
      }
      setLoading(false)
    } catch (error: any) {
      console.error('提交评分失败:', error)
      message.error(error?.response?.data?.message || '提交评分失败')
      setLoading(false)
    }
  }

  const handleDeleteRecords = async () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择数据')
      return
    }

    Modal.confirm({
      title: '确认删除',
      content: `确定要删除已选中的 ${selectedIds.length} 条记录吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true)
        try {
          const res = await productPageInfoApi.deleteRecords(selectedIds)
          if (res.data.success) {
            message.success(`成功删除 ${res.data.data.count} 条数据`)
            setSelectedIds([])
            dataCache.current.clear()
            fetchData(true)
          } else {
            message.error(res.data.message || '删除失败')
          }
          setLoading(false)
        } catch (error: any) {
          console.error('删除记录失败:', error)
          message.error(error?.response?.data?.message || '删除失败')
          setLoading(false)
        }
      },
    })
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* 操作栏：全选 + 操作下拉 */}
      <Card size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '8px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Checkbox
              checked={isAllSelected}
              indeterminate={currentPageSelectedCount > 0 && currentPageSelectedCount < currentPageIds.length}
              onChange={(e) => handleSelectAll(e.target.checked)}
            >
              全选当前页 ({currentPageSelectedCount}/{currentPageIds.length})
            </Checkbox>
            <span style={{ marginLeft: 16, color: '#666' }}>
              已选择 <span style={{ color: '#1890ff', fontWeight: 600 }}>{selectedIds.length}</span> 条
            </span>
          </div>
          <Dropdown
            disabled={selectedIds.length === 0}
            menu={{
              items: [
                {
                  key: 'submit',
                  label: '提交评分',
                  onClick: handleSubmitRating,
                },
                {
                  key: 'delete',
                  label: '删除记录',
                  danger: true,
                  onClick: handleDeleteRecords,
                },
              ],
            }}
          >
            <Button type="primary" disabled={selectedIds.length === 0}>
              操作
            </Button>
          </Dropdown>
        </div>
      </Card>

      {/* 搜索栏 */}
      <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <Radio.Group
              value={ratingStatusFilter}
              onChange={(e) => {
                // 切换筛选时不清空选中状态，保留跨页选择
                dataCache.current.clear()
                setRatingStatusFilter(e.target.value)
                setCurrentPage(1)
              }}
            >
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="rated">已评分</Radio.Button>
              <Radio.Button value="unrated">未评分</Radio.Button>
            </Radio.Group>
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
              搜索
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              刷新
            </Button>
          </Space>
          <Button
            icon={<Upload size={14} />}
            onClick={handleImportClick}
            loading={importing}
            title="只支持Excel表格（.xlsx/.xls），需包含SKU和店铺列"
          >
            导入表格
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </Card>

      {/* 排行榜 */}
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={
          <Button
            type="link"
            onClick={() => {
              if (!rankingExpanded) fetchRanking()
              setRankingExpanded(!rankingExpanded)
            }}
            style={{ padding: 0, fontSize: 14, fontWeight: 600 }}
          >
            {rankingExpanded ? '收起排行榜 ▲' : '展开排行榜 ▼'}
          </Button>
        }
      >
        {rankingExpanded && (
          <Row gutter={16}>
            <Col span={12}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#1890ff' }}>评分前十</div>
              {rankingData.top10.length === 0 ? (
                <div style={{ color: '#999', fontSize: 12 }}>暂无已评分记录</div>
              ) : (
                <div style={{ maxHeight: 360, overflow: 'auto' }}>
                  {rankingData.top10.map((item, index) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        marginBottom: 4,
                        background: index === 0 ? '#fff7e6' : '#fafafa',
                        borderRadius: 4,
                        cursor: 'pointer',
                        border: '1px solid #f0f0f0',
                      }}
                      onClick={() => {
                        handleViewDetail({ ...item, store_original: item.store_original } as RatingItem)
                      }}
                    >
                      <Space>
                        <Tag color={index < 3 ? 'gold' : 'default'} style={{ margin: 0 }}>
                          {index + 1}
                        </Tag>
                        <span style={{ fontSize: 13 }}>{item.sku || '-'}</span>
                        <span style={{ fontSize: 12, color: '#999' }}>{item.asin || '-'}</span>
                      </Space>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#52c41a' }}>
                        {item.total_score}分
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Col>
            <Col span={12}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#ff4d4f' }}>倒数前十</div>
              {rankingData.bottom10.length === 0 ? (
                <div style={{ color: '#999', fontSize: 12 }}>暂无已评分记录</div>
              ) : (
                <div style={{ maxHeight: 360, overflow: 'auto' }}>
                  {rankingData.bottom10.map((item, index) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        marginBottom: 4,
                        background: index === 0 ? '#fff2f0' : '#fafafa',
                        borderRadius: 4,
                        cursor: 'pointer',
                        border: '1px solid #f0f0f0',
                      }}
                      onClick={() => {
                        handleViewDetail({ ...item, store_original: item.store_original } as RatingItem)
                      }}
                    >
                      <Space>
                        <Tag color={index < 3 ? 'red' : 'default'} style={{ margin: 0 }}>
                          {index + 1}
                        </Tag>
                        <span style={{ fontSize: 13 }}>{item.sku || '-'}</span>
                        <span style={{ fontSize: 12, color: '#999' }}>{item.asin || '-'}</span>
                      </Space>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#ff4d4f' }}>
                        {item.total_score}分
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Col>
          </Row>
        )}
      </Card>

      {/* 数据卡片列表 */}
      <Card
        style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingBottom: 56 }}
        bodyStyle={{ padding: 16 }}
      >
        <Spin spinning={loading}>
          {pageSize <= 40 ? (
            <Row gutter={[16, 16]}>
              {data.map((item) => (
                <Col key={item.id} span={getColSpan()!}>
                  <Card
                    hoverable
                    style={{
                      borderRadius: 12,
                      border: selectedIds.includes(item.id) ? '2px solid #1890ff' : '1px solid #e8e8e8',
                      cursor: 'pointer',
                      minHeight: 80,
                      width: '100%',
                      position: 'relative',
                    }}
                    bodyStyle={{ padding: 12 }}
                    onClick={() => handleViewDetail(item)}
                  >
                    {/* 复选框 */}
                    <Checkbox
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) => {
                        e.stopPropagation()
                        handleSelectItem(item.id, e.target.checked)
                      }}
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 10,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {/* 第一行：SKU + 价格 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginLeft: 24 }}>
                      <span style={{ fontSize: 13, color: '#666' }}>SKU: {item.sku || '-'}</span>
                      <span style={{ fontSize: 15, fontWeight: 600, color: '#52c41a' }}>{item.price || '-'}</span>
                    </div>
                    {/* 第二行：ASIN + 店铺 + 评分 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginLeft: 24 }}>
                      <span style={{ color: '#1890ff' }}>{item.asin || '-'}</span>
                      <span style={{ color: '#888' }}>{item.store || '-'}</span>
                      <Tag
                        color={item.total_score >= 80 ? 'green' : item.total_score >= 60 ? 'orange' : 'red'}
                        style={{ margin: 0 }}
                      >
                        {item.total_score}
                      </Tag>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          ) : (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
                maxHeight: 'calc(100vh - 280px)',
                overflowY: 'auto',
              }}
            >
              {data.map((item) => (
                <Card
                  key={item.id}
                  hoverable
                  style={{
                    borderRadius: 12,
                    border: selectedIds.includes(item.id) ? '2px solid #1890ff' : '1px solid #e8e8e8',
                    cursor: 'pointer',
                    width: 160,
                    minWidth: 160,
                    position: 'relative',
                  }}
                  bodyStyle={{ padding: 12 }}
                  onClick={() => handleViewDetail(item)}
                >
                  {/* 复选框 */}
                  <Checkbox
                    checked={selectedIds.includes(item.id)}
                    onChange={(e) => {
                      e.stopPropagation()
                      handleSelectItem(item.id, e.target.checked)
                    }}
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      zIndex: 10,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {/* 第一行：SKU + 价格 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginLeft: 24 }}>
                    <span style={{ fontSize: 13, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>SKU: {item.sku || '-'}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#52c41a' }}>{item.price || '-'}</span>
                  </div>
                  {/* 第二行：ASIN + 店铺 + 评分 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginLeft: 24 }}>
                    <span style={{ color: '#1890ff' }}>{item.asin}</span>
                    <span style={{ color: '#888' }}>{item.store || '-'}</span>
                    <Tag
                      color={item.total_score >= 80 ? 'green' : item.total_score >= 60 ? 'orange' : 'red'}
                      style={{ margin: 0 }}
                    >
                      {item.total_score}
                    </Tag>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Spin>
      </Card>

      {/* 固定翻页器 */}
      <div
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          background: '#fff',
          padding: '8px 16px',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 100,
        }}
      >
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          showQuickJumper
          pageSizeOptions={['20', '40', '60', '100']}
          showTotal={(t) => `共 ${t} 条`}
          onChange={(page, size) => {
            setCurrentPage(page)
            setPageSize(size)
          }}
        />
      </div>

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
        {selectedRecord && (
          <>
            {/* 切换按钮 */}
            <Space style={{ marginBottom: 16 }}>
              <Button
                type={detailTab === 'product' ? 'primary' : 'default'}
                onClick={() => setDetailTab('product')}
              >
                产品信息详情
              </Button>
              <Button
                type={detailTab === 'score' ? 'primary' : 'default'}
                onClick={() => setDetailTab('score')}
              >
                评分详情
              </Button>
            </Space>

            {/* 产品信息详情 */}
            {detailTab === 'product' && (
              <Descriptions bordered column={2} size="small">
                <Descriptions.Item label="ASIN" span={1}>
                  {(() => {
                    const store = selectedRecord.store_original || ''
                    let urlPrefix = ''
                    if (store.includes('US') || store.includes('USA')) {
                      urlPrefix = 'https://www.amazon.com/dp/'
                    } else if (store.includes('DE')) {
                      urlPrefix = 'https://www.amazon.de/dp/'
                    } else if (store.includes('UK')) {
                      urlPrefix = 'https://www.amazon.co.uk/dp/'
                    }
                    const asinUrl = selectedRecord.asin && urlPrefix ? `${urlPrefix}${selectedRecord.asin}` : ''
                    return asinUrl ? (
                      <a href={asinUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1890ff' }}>
                        {selectedRecord.asin}
                      </a>
                    ) : (
                      selectedRecord.asin || '字段为空'
                    )
                  })()}
                </Descriptions.Item>
                <Descriptions.Item label="SKU" span={1}>{selectedRecord.sku || '字段为空'}</Descriptions.Item>
                <Descriptions.Item label="店铺" span={1}>{selectedRecord.store || '字段为空'}</Descriptions.Item>
                <Descriptions.Item label="价格" span={1}>{selectedRecord.price || '字段为空'}</Descriptions.Item>
                <Descriptions.Item label="图片数" span={2}>{selectedRecord.image_count ?? '字段为空'}</Descriptions.Item>

                <Descriptions.Item label="标题" span={2}>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
                    {selectedRecord.title || '字段为空'}
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="产品描述" span={2}>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                    {selectedRecord.product_description || '字段为空'}
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="关键词" span={2}>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                    {selectedRecord.keywords || '字段为空'}
                  </div>
                </Descriptions.Item>
                <Descriptions.Item label="五点描述" span={2}>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {selectedRecord.bullet_points || '字段为空'}
                  </div>
                </Descriptions.Item>
              </Descriptions>
            )}

            {/* 评分详情 */}
            {detailTab === 'score' && (
              <>
                {/* 评分标准提示 */}
                <div style={{ marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 4, border: '1px solid #91d5ff', fontSize: 12, color: '#096dd9' }}>
                  评分标准：标题、描述、关键词、图片均为星拓反查流量词中前五流量词对比评分，广告与视频均为含有即得分，A+区分普通和高级，价格按排名得分
                </div>
                {/* 检测空白字段 */}
                {(() => {
                  const emptyFields = []
                  if (!selectedRecord.asin) emptyFields.push('ASIN')
                  if (!selectedRecord.sku) emptyFields.push('SKU')
                  if (!selectedRecord.store) emptyFields.push('店铺')
                  if (!selectedRecord.price) emptyFields.push('价格')
                  if (!selectedRecord.title) emptyFields.push('标题')
                  if (!selectedRecord.product_description) emptyFields.push('产品描述')
                  if (!selectedRecord.keywords) emptyFields.push('关键词')
                  if (!selectedRecord.bullet_points) emptyFields.push('五点描述')
                  if (selectedRecord.image_count === null || selectedRecord.image_count === undefined) emptyFields.push('图片数')

                  if (emptyFields.length > 0) {
                    return (
                      <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 4, border: '1px solid #ffd591' }}>
                        <span style={{ color: '#fa8c16', fontWeight: 500 }}>⚠️ 含有空白字段，暂无评分</span>
                        <div style={{ marginTop: 4, color: '#8c8c8c', fontSize: 12 }}>
                          空白字段：{emptyFields.join('、')}
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}

                <Descriptions bordered column={2} size="small">
                <Descriptions.Item label="总分" span={2} style={{ background: '#fafafa' }}>
                  <Tag
                    color={selectedRecord.total_score >= 80 ? 'green' : selectedRecord.total_score >= 60 ? 'orange' : 'red'}
                    style={{ fontSize: 18, padding: '4px 16px', fontWeight: 600 }}
                  >
                    {selectedRecord.total_score}/100
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="参考流量词" span={2}>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                    {selectedRecord.traffic_keywords || '暂无'}
                  </div>
                </Descriptions.Item>

                <Descriptions.Item label="标题评分" span={1}>
                  <Tag color="blue">{selectedRecord.title_rating ?? '字段为空'}/15</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="描述评分" span={1}>
                  <Tag color="blue">{selectedRecord.description_rating ?? '字段为空'}/10</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="关键词评分" span={1}>
                  <Tag color="blue">{selectedRecord.keywords_rating ?? '字段为空'}/10</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="图片评分" span={1}>
                  <Tag color="blue">{selectedRecord.image_rating ?? '字段为空'}/15</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="星级评分" span={1}>
                  <Space>
                    <span>{selectedRecord.star_rating ?? '字段为空'}</span>
                    <Tag color="blue">{selectedRecord.star_rating_score ?? '字段为空'}/10</Tag>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="广告" span={1}>
                  <Tag color="blue">
                    {selectedRecord.has_ad ? '10/10' : '0/10'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="A+页面" span={1}>
                  <Tag color={selectedRecord.has_aplus === 2 ? 'green' : selectedRecord.has_aplus === 1 ? 'blue' : 'default'}>
                    {selectedRecord.has_aplus === 2 ? '10/10' : selectedRecord.has_aplus === 1 ? '5/10' : '0/10'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="视频" span={1}>
                  <Tag color="blue">
                    {selectedRecord.has_video ? '5/5' : '0/5'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="竞品价格" span={1}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      如该产品不是竞品则可点击删除，重新排名计算得分
                    </span>
                    {selectedRecord.competitor_price ? (
                      <>
                        {selectedRecord.competitor_price.split('\n').map((line, idx) => {
                          const trimmedLine = line.trim()
                          if (!trimmedLine) return null
                          // 解析ASIN部分，用于生成链接
                          const sepIdx = Math.max(trimmedLine.indexOf(':'), trimmedLine.indexOf('：'))
                          const asinPart = sepIdx > 0 ? trimmedLine.substring(0, sepIdx).trim() : ''
                          const pricePart = sepIdx > 0 ? trimmedLine.substring(sepIdx + 1).trim() : ''
                          // 根据店铺生成Amazon链接（用store_original，即原始店铺名）
                          const store = selectedRecord.store_original || ''
                          let urlPrefix = ''
                          if (store.includes('US') || store.includes('USA')) {
                            urlPrefix = 'https://www.amazon.com/dp/'
                          } else if (store.includes('DE')) {
                            urlPrefix = 'https://www.amazon.de/dp/'
                          } else if (store.includes('UK')) {
                            urlPrefix = 'https://www.amazon.co.uk/dp/'
                          }
                          const asinUrl = asinPart && urlPrefix ? `${urlPrefix}${asinPart}` : ''
                          return (
                            <Tag
                              key={idx}
                              closable
                              onClose={(e) => {
                                e.preventDefault()
                                handleDeleteCompetitor(trimmedLine)
                              }}
                              style={{ marginBottom: 4 }}
                            >
                              {asinUrl ? (
                                <a href={asinUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1890ff', textDecoration: 'underline' }}>{asinPart}</a>
                              ) : (
                                asinPart || trimmedLine
                              )}
                              {pricePart && sepIdx > 0 ? `：${pricePart}` : (!asinPart ? '' : '')}
                            </Tag>
                          )
                        })}
                      </>
                    ) : (
                      <span style={{ color: '#999' }}>无竞品价格</span>
                    )}
                    {selectedRecord.competitor_price_rank > 0 && (
                      <Tag color={selectedRecord.competitor_price_rank === 1 ? 'green' : selectedRecord.competitor_price_rank <= 3 ? 'blue' : 'default'}>
                        第{selectedRecord.competitor_price_rank}名 {selectedRecord.competitor_price_score}/15
                      </Tag>
                    )}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}

export default RatingOptimizationBot