import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Input, Select, Space, Tag, message, Modal, Descriptions, Spin, Row, Col, Pagination, Radio, Checkbox, Dropdown, Upload as AntUpload } from 'antd'
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
  has_ad: number | null
  has_aplus: number
  has_video: boolean
  rating_status?: number
  total_score: number
  traffic_keywords?: string | null
  updated_at?: string | null
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

  // 编辑基础信息
  const [editVisible, setEditVisible] = useState(false)
  const [editForm, setEditForm] = useState({ title: '', product_description: '', keywords: '', bullet_points: '', image_count: '' })
  const [editField, setEditField] = useState<string>('title')
  const [editDirty, setEditDirty] = useState(false)

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
    fetchData(true)
  }, [currentPage, pageSize, ratingStatusFilter])

  useEffect(() => {
    fetchStoreList()
  }, [])

  const fetchData = async (forceRefresh = false) => {
    const cacheKey = `${ratingStatusFilter}-${asinSearch}-${skuSearch}-${storeFilter}-${currentPage}-${pageSize}`

    if (!forceRefresh && dataCache.current.has(cacheKey)) {
      const cached = dataCache.current.get(cacheKey)!
      setData(cached.data)
      setTotal(cached.total)
      return
    }

    setLoading(true)
    try {
      let ratingStatusValue: number | undefined = undefined
      if (ratingStatusFilter === 'rated') ratingStatusValue = 1
      else if (ratingStatusFilter === 'unrated') ratingStatusValue = 0
      else if (ratingStatusFilter === 'low_score') ratingStatusValue = 1

      const res = await productPageInfoApi.getList({
        page: currentPage,
        page_size: pageSize,
        asin_search: asinSearch || undefined,
        sku_search: skuSearch || undefined,
        store_filter: storeFilter || undefined,
        rating_status: ratingStatusValue,
        low_score: ratingStatusFilter === 'low_score' ? true : undefined,
      })
      if (res.data.success) {
        setData(res.data.data)
        setTotal(res.data.total)
        dataCache.current.set(cacheKey, { data: res.data.data, total: res.data.total })
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

  const fetchRanking = async () => {
    try {
      const res = await productPageInfoApi.getRanking()
      if (res.data.success) {
        setRankingData(res.data.data)
      }
    } catch (error) {
      console.error('获取排行榜失败:', error)
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
  const [lastImportIds, setLastImportIds] = useState<number[]>([])

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
        setLastImportIds(res.data.data?.import_ids || [])
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

  // 取消导入
  const handleCancelImport = async () => {
    if (lastImportIds.length === 0) return
    Modal.confirm({
      title: '确认取消导入',
      content: `将删除最近导入的 ${lastImportIds.length} 条记录，是否继续？`,
      onOk: async () => {
        try {
          const res = await productPageInfoApi.cancelImport(lastImportIds)
          if (res.data.success) {
            message.success(res.data.message)
            setLastImportIds([])
            dataCache.current.clear()
            fetchData(true)
          } else {
            message.error(res.data.message || '取消导入失败')
          }
        } catch (error) {
          message.error('取消导入失败')
        }
      },
    })
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
              <Radio.Button value="low_score">低分</Radio.Button>
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
          {lastImportIds.length > 0 && (
            <Button
              danger
              onClick={handleCancelImport}
            >
              取消导入
            </Button>
          )}
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
                    {/* 第一行：SKU */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginLeft: 24 }}>
                      <span style={{ fontSize: 13, color: '#666' }}>SKU: {item.sku || '-'}</span>
                    </div>
                    {/* 第二行：ASIN + 店铺 + 评分 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginLeft: 24 }}>
                      <span style={{ color: '#1890ff' }}>{item.asin || '-'}</span>
                      <span style={{ color: '#888' }}>{item.store || '-'}</span>
                      <Tag
                        color={item.total_score >= 80 ? 'green' : item.total_score >= 60 ? 'orange' : 'red'}
                        style={{ margin: 0, fontSize: 14, fontWeight: 600, padding: '2px 8px' }}
                      >
                        {item.total_score}分
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
                  {/* 第一行：SKU */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginLeft: 24 }}>
                    <span style={{ fontSize: 13, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>SKU: {item.sku || '-'}</span>
                  </div>
                  {/* 第二行：ASIN + 店铺 + 评分 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginLeft: 24 }}>
                    <span style={{ color: '#1890ff' }}>{item.asin}</span>
                    <span style={{ color: '#888' }}>{item.store || '-'}</span>
                    <Tag
                      color={item.total_score >= 80 ? 'green' : item.total_score >= 60 ? 'orange' : 'red'}
                      style={{ margin: 0, fontSize: 14, fontWeight: 600, padding: '2px 8px' }}
                    >
                      {item.total_score}分
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
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 40 }}>
            <span>产品页面详情</span>
            {selectedRecord?.updated_at && (
              <span style={{ fontSize: 12, color: '#999', fontWeight: 'normal' }}>
                最近更新：{new Date(selectedRecord.updated_at).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        }
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
              <Button
                onClick={() => {
                  setEditForm({
                    title: selectedRecord.title || '',
                    product_description: selectedRecord.product_description || '',
                    keywords: selectedRecord.keywords || '',
                    bullet_points: selectedRecord.bullet_points || '',
                    image_count: selectedRecord.image_count?.toString() || '',
                  })
                  setEditField('title')
                  setEditDirty(false)
                  setEditVisible(true)
                }}
              >
                编辑基础信息
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
                    } else if (store.includes('CA')) {
                      urlPrefix = 'https://www.amazon.ca/dp/'
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
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    {selectedRecord.bullet_points ? (
                      selectedRecord.bullet_points.split('\n').map((line, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 4 }}>
                          <span style={{ color: '#000', marginRight: 6, fontSize: 14, lineHeight: '20px' }}>●</span>
                          <span style={{ whiteSpace: 'pre-wrap' }}>{line}</span>
                        </div>
                      ))
                    ) : (
                      <span>字段为空</span>
                    )}
                  </div>
                </Descriptions.Item>
              </Descriptions>
            )}

            {/* 评分详情 */}
            {detailTab === 'score' && (
              <>
                {/* 评分标准提示 */}
                <div style={{ marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 4, border: '1px solid #91d5ff', fontSize: 12, color: '#096dd9' }}>
                  评分标准：标题、描述、关键词、图片均为星拓反查流量词中前五流量词对比评分，广告按数量得分（{'≥3'}为10分，2为8分，1为6分），视频为含有即得分，A+区分普通和高级，价格按排名得分
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
                    {selectedRecord.has_ad !== null && selectedRecord.has_ad >= 3 ? '10/10' : selectedRecord.has_ad === 2 ? '8/10' : selectedRecord.has_ad === 1 ? '6/10' : '0/10'}
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
                          } else if (store.includes('CA')) {
                            urlPrefix = 'https://www.amazon.ca/dp/'
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

                {/* 产品建议 */}
                {(() => {
                  const suggestions: string[] = []
                  const titleScore = selectedRecord.title_rating ? parseFloat(selectedRecord.title_rating) : 0
                  const descScore = selectedRecord.description_rating ? parseFloat(selectedRecord.description_rating) : 0
                  const keywordsScore = selectedRecord.keywords_rating ? parseFloat(selectedRecord.keywords_rating) : 0
                  const imageScore = selectedRecord.image_rating ? parseFloat(selectedRecord.image_rating) : 0
                  const starRating = selectedRecord.star_rating ?? 0
                  const hasAd = selectedRecord.has_ad ?? 0
                  const hasAplus = selectedRecord.has_aplus ?? 0
                  const hasVideo = selectedRecord.has_video

                  if (titleScore < 9) suggestions.push('标题加入参考流量词')
                  if (descScore < 6) suggestions.push('描述加入参考流量词')
                  if (keywordsScore < 6) suggestions.push('关键词加入参考流量词')
                  if (imageScore < 12) suggestions.push('添加图片')
                  if (starRating === 0) suggestions.push('上直评')
                  else if (starRating < 3) suggestions.push('更换SKU重新创建链接')
                  if (hasAd < 8) suggestions.push('新开广告')
                  if (hasAplus === 0) suggestions.push('上传A+')
                  else if (hasAplus === 5) suggestions.push('上传高级A+')
                  if (!hasVideo) suggestions.push('上传视频')

                  if (suggestions.length === 0) return null
                  return (
                    <div style={{ marginTop: 12, padding: '10px 12px', background: '#fff7e6', borderRadius: 4, border: '1px solid #ffd591' }}>
                      <div style={{ fontWeight: 500, color: '#fa8c16', marginBottom: 6 }}>产品建议</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {suggestions.map((s, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
                            <span style={{ color: '#fa8c16', marginRight: 6, fontSize: 14, lineHeight: '20px' }}>●</span>
                            <span style={{ color: '#595959', fontSize: 13 }}>{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </>
            )}
          </>
        )}
      </Modal>

      {/* 编辑基础信息弹窗 */}
      <Modal
        title="编辑基础信息"
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setEditVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" disabled={!editDirty} onClick={() => {
            if (!selectedRecord) return
            const fieldLabelMap: Record<string, string> = {
              title: '标题',
              product_description: '产品描述',
              keywords: '关键词',
              bullet_points: '五点描述',
              image: '图片',
            }
            const fieldValue = editForm[editField as keyof typeof editForm] as string
            const confirmModal = Modal.confirm({
              title: '确认提交',
              content: (
                <div>
                  <div>提交后是否需要重新提交评分？</div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>点击"是"，提交修改请求以及重新评分；点击"否"仅提交修改请求</div>
                </div>
              ),
              footer: (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button onClick={() => confirmModal.destroy()}>取消提交</Button>
                  <Button type="primary" onClick={async () => {
                    confirmModal.destroy()
                    try {
                      const res = await productPageInfoApi.submitEdit({
                        item_id: selectedRecord.id,
                        store: selectedRecord.store_original || selectedRecord.store || '',
                        field_type: fieldLabelMap[editField] || editField,
                        sku: selectedRecord.sku || '',
                        content: fieldValue,
                        reset_rating: false,
                      })
                      if (res.data.success) {
                        message.success('提交成功')
                        setEditVisible(false)
                      } else {
                        message.error(res.data.message || '提交失败')
                      }
                    } catch (error: any) {
                      console.error('提交失败:', error)
                      message.error(error?.response?.data?.message || error?.message || '提交失败')
                    }
                  }}>否</Button>
                  <Button type="primary" danger onClick={async () => {
                    confirmModal.destroy()
                    try {
                      const res = await productPageInfoApi.submitEdit({
                        item_id: selectedRecord.id,
                        store: selectedRecord.store_original || selectedRecord.store || '',
                        field_type: fieldLabelMap[editField] || editField,
                        sku: selectedRecord.sku || '',
                        content: fieldValue,
                        reset_rating: true,
                      })
                      if (res.data.success) {
                        message.success('提交成功')
                        setEditVisible(false)
                        dataCache.current.clear()
                        fetchData(true)
                      } else {
                        message.error(res.data.message || '提交失败')
                      }
                    } catch (error: any) {
                      console.error('提交失败:', error)
                      message.error(error?.response?.data?.message || error?.message || '提交失败')
                    }
                  }}>是</Button>
                </div>
              ),
            })
          }}>提交</Button>,
        ]}
        width={640}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ marginBottom: 6 }}>选择字段</div>
            <Select
              value={editField}
              onChange={(val) => setEditField(val)}
              style={{ width: '100%' }}
              options={[
                { label: '标题', value: 'title' },
                { label: '产品描述', value: 'product_description' },
                { label: '关键词', value: 'keywords' },
                { label: '五点描述', value: 'bullet_points' },
                { label: '图片（待开发）', value: 'image', disabled: true },
              ]}
            />
          </div>
          <div>
            {editField === 'image' ? (
              <AntUpload
                listType="picture-card"
                beforeUpload={() => false}
                maxCount={1}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20 }}>+</div>
                  <div style={{ fontSize: 12 }}>上传图片</div>
                </div>
              </AntUpload>
            ) : (
              <Input.TextArea
                value={editForm[editField as keyof typeof editForm] as string}
                onChange={(e) => {
                  setEditForm({ ...editForm, [editField]: e.target.value })
                  setEditDirty(true)
                }}
                rows={6}
                placeholder={`请输入${editField === 'title' ? '标题' : editField === 'product_description' ? '产品描述' : editField === 'keywords' ? '关键词' : '五点描述'}`}
              />
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default RatingOptimizationBot