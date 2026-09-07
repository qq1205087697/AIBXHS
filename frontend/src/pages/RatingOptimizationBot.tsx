import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Input, Select, Space, Tag, message, Modal, Descriptions, Spin, Row, Col, Pagination, Radio, Checkbox, Dropdown, Upload as AntUpload, Tooltip } from 'antd'
import {
  Search,
  RefreshCw,
  Eye,
  Upload,
  Sparkles,
} from 'lucide-react'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { productPageInfoApi } from '../api'
import { useAuth } from '../contexts/AuthContext'

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
  gross_margin?: number | null
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
  const { hasPermission } = useAuth()
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
  // 图片上传文件列表（多张，不覆盖）
  const [uploadedImages, setUploadedImages] = useState<any[]>([])
  const [aiWriting, setAiWriting] = useState(false)
  // 同步锁：防止用户快速连续点击 AI 编写导致并发请求
  const aiWritingLockRef = useRef(false)

  // 开广告表单
  const [adVisible, setAdVisible] = useState(false)
  const [adForm, setAdForm] = useState({
    ad_type: [] as string[],             // 广告选择（多选）：auto/manual/related
    keyword_asin_source: 'operation',   // 广告关键词ASIN来源：operation/h10，默认运营填写
    bid_strategy: '',                    // 竞价策略
    sku: '',                              // SKU
    site: '',                             // 站点
    // 手动竞价（弹出子表单）
    manual_exact_bid: '',                // 精准竞价
    manual_broad_bid: '',                // 广泛竞价
    manual_phrase_bid: '',               // 词组竞价
    // 关联竞价（弹出子表单）
    related_exact_bid: '',               // 关联精准竞价
    related_expanded_bid: '',            // 关联扩展竞价
    strongest_related_asin: '',          // 最强关联竞品ASIN
    key_keyword: '',                    // 最关键的关键词
    limit_word: '',                     // 限定词
    ad_asin: '',                         // 广告ASIN
    ad_keyword: '',                      // 广告关键词
  })
  // 手动竞价/关联竞价子表单弹窗
  const [manualBidVisible, setManualBidVisible] = useState(false)
  const [relatedBidVisible, setRelatedBidVisible] = useState(false)

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

      const params = {
        page: currentPage,
        page_size: pageSize,
        asin_search: asinSearch || undefined,
        sku_search: skuSearch || undefined,
        store_filter: storeFilter || undefined,
        rating_status: ratingStatusValue,
        low_score: ratingStatusFilter === 'low_score' ? true : undefined,
      }
      console.log('[DEBUG] fetchData 请求参数:', JSON.stringify(params))
      const res = await productPageInfoApi.getList(params)
      console.log('[DEBUG] fetchData 响应状态:', res.status, '响应数据:', JSON.stringify(res.data).substring(0, 500))
      if (res.data.success) {
        setData(res.data.data)
        setTotal(res.data.total)
        dataCache.current.set(cacheKey, { data: res.data.data, total: res.data.total })
      } else {
        console.error('[DEBUG] fetchData success=false:', res.data)
        message.error(res.data.message || '获取数据失败')
      }
      setLoading(false)
    } catch (error: any) {
      console.error('[DEBUG] 获取评分数据失败:', error)
      console.error('[DEBUG] 错误详情:', {
        message: error?.message,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        responseData: error?.response?.data,
        requestURL: error?.config?.url,
        requestParams: error?.config?.params,
      })
      setLoading(false)
      message.error(`获取评分数据失败: ${error?.response?.status || ''} ${error?.message || ''}`)
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
              <Radio.Button value="low_score"><Tooltip title="低于60分记录">低分</Tooltip></Radio.Button>
              <Radio.Button value="unrated">未评分</Radio.Button>
            </Radio.Group>
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
              搜索
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              刷新
            </Button>
          </Space>
          {hasPermission('robot:rating:import') && (
            <Button
              icon={<Upload size={14} />}
              onClick={handleImportClick}
              loading={importing}
              title="只支持Excel表格（.xlsx/.xls），需包含SKU和店铺列"
            >
              导入表格
            </Button>
          )}
          {hasPermission('robot:rating:import') && lastImportIds.length > 0 && (
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
                  setUploadedImages([])
                  setEditVisible(true)
                }}
              >
                编辑基础信息
              </Button>
              {hasPermission('robot:rating:ad') && (
                <Button
                  onClick={() => {
                    // 打开开广告表单，预填SKU和站点信息
                    setAdForm({
                    ad_type: [],
                    keyword_asin_source: 'operation',
                    bid_strategy: '',
                    sku: selectedRecord.sku || '',
                    site: '',
                    manual_exact_bid: '',
                    manual_broad_bid: '',
                    manual_phrase_bid: '',
                    related_exact_bid: '',
                    related_expanded_bid: '',
                    strongest_related_asin: '',
                    key_keyword: selectedRecord.keywords || '',
                    limit_word: '',
                    ad_asin: selectedRecord.asin || '',
                    ad_keyword: '',
                  })
                    setAdVisible(true)
                  }}
                >
                  开广告
                </Button>
              )}
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
                <Descriptions.Item label="参考关键词" span={2}>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                    {selectedRecord.traffic_keywords || '暂无'}
                  </div>
                </Descriptions.Item>

                <Descriptions.Item label={<>标题评分 <Tooltip title="满分15分。星拓反查流量词中前五流量词对比评分，标题包含的流量词越多得分越高"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color="blue">{selectedRecord.title_rating ?? '字段为空'}/15</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>描述评分 <Tooltip title="满分10分。星拓反查流量词中前五流量词对比评分，描述包含的流量词越多得分越高"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color="blue">{selectedRecord.description_rating ?? '字段为空'}/10</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>关键词评分 <Tooltip title="满分10分。星拓反查流量词中前五流量词对比评分，关键词包含的流量词越多得分越高"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color="blue">{selectedRecord.keywords_rating ?? '字段为空'}/10</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>图片评分 <Tooltip title="满分15分。星拓反查流量词中前五流量词对比评分，图片数量越多得分越高"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color="blue">{selectedRecord.image_rating ?? '字段为空'}/15</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>星级评分 <Tooltip title="满分10分。5星=10分，4-4.9星=8分，0星=6分，0.1-3.9星=0分"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Space>
                    <span>{selectedRecord.star_rating ?? '字段为空'}</span>
                    <Tag color="blue">{selectedRecord.star_rating_score ?? '字段为空'}/10</Tag>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label={<>广告 <Tooltip title="满分10分。按广告数量计分：≥3个=10分，2个=8分，1个=6分，0个或空=0分"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color="blue">
                    {selectedRecord.has_ad !== null && selectedRecord.has_ad >= 3 ? '10/10' : selectedRecord.has_ad === 2 ? '8/10' : selectedRecord.has_ad === 1 ? '6/10' : '0/10'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>A+页面 <Tooltip title="满分10分。高级A+=10分，普通A+=5分，无A+=0分"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color={selectedRecord.has_aplus === 2 ? 'green' : selectedRecord.has_aplus === 1 ? 'blue' : 'default'}>
                    {selectedRecord.has_aplus === 2 ? '10/10' : selectedRecord.has_aplus === 1 ? '5/10' : '0/10'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>视频 <Tooltip title="满分5分。含有视频即得5分，无视频为0分"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
                  <Tag color="blue">
                    {selectedRecord.has_video ? '5/5' : '0/5'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={<>竞品价格 <Tooltip title="满分15分。按价格排名计分：第1名=15分，第2名=12分，第3名=8分，第4名=4分，第5名及以后=0分"><QuestionCircleOutlined style={{ color: '#999', fontSize: 12, cursor: 'help' }} /></Tooltip></>} span={1}>
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
                <Descriptions.Item label="毛利率" span={2}>
                  {selectedRecord.gross_margin !== null && selectedRecord.gross_margin !== undefined ? (
                    <Tag color={selectedRecord.gross_margin >= 30 ? 'green' : selectedRecord.gross_margin >= 15 ? 'blue' : 'red'}>
                      {selectedRecord.gross_margin.toFixed(2)}%
                    </Tag>
                  ) : (
                    <span style={{ color: '#999' }}>暂无毛利率</span>
                  )}
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

      {/* 开广告弹窗 */}
      <Modal
        title="开广告"
        open={adVisible}
        onCancel={() => setAdVisible(false)}
        width={720}
        footer={[
          <Button key="cancel" onClick={() => setAdVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" onClick={async () => {
            // 校验必填项
            if (adForm.ad_type.length === 0) { message.warning('请选择广告选择'); return }
            if (!adForm.sku) { message.warning('请填写SKU'); return }
            if (!adForm.site) { message.warning('请选择站点'); return }

            // 生成字典输出到终端
            const adDict = {
              ad_type: adForm.ad_type,
              keyword_asin_source: adForm.keyword_asin_source,
              bid_strategy: adForm.bid_strategy,
              sku: adForm.sku,
              site: adForm.site,
              manual_exact_bid: adForm.manual_exact_bid,
              manual_broad_bid: adForm.manual_broad_bid,
              manual_phrase_bid: adForm.manual_phrase_bid,
              related_exact_bid: adForm.related_exact_bid,
              related_expanded_bid: adForm.related_expanded_bid,
              strongest_related_asin: adForm.strongest_related_asin,
              key_keyword: adForm.key_keyword,
              limit_word: adForm.limit_word,
              ad_asin: adForm.ad_asin,
              ad_keyword: adForm.ad_keyword,
            }
            console.log('开广告提交内容字典：', adDict)

            // 调用后端接口发送到飞书 webhook
            try {
              const res = await productPageInfoApi.adSubmit(adDict)
              if (res.data.success) {
                message.success('广告配置已提交')
                setAdVisible(false)
              } else {
                message.error(res.data.message || '提交失败')
              }
            } catch (error: any) {
              console.error('开广告提交失败:', error)
              message.error(error?.response?.data?.message || error?.message || '提交失败')
            }
          }}>提交</Button>,
        ]}
      >
        {(() => {
          const hasManual = adForm.ad_type.includes('manual')
          const hasRelated = adForm.ad_type.includes('related')
          const hasManualOrRelated = hasManual || hasRelated
          const isH10 = adForm.keyword_asin_source === 'h10'
          const isOperation = adForm.keyword_asin_source === 'operation'
          // 手动竞价子表单填写状态摘要
          const manualBidSummary = [
            adForm.manual_exact_bid && `精准:${adForm.manual_exact_bid}`,
            adForm.manual_broad_bid && `广泛:${adForm.manual_broad_bid}`,
            adForm.manual_phrase_bid && `词组:${adForm.manual_phrase_bid}`,
          ].filter(Boolean).join(' / ') || '未填写（点击设置）'
          // 关联竞价子表单填写状态摘要
          const relatedBidSummary = [
            adForm.related_exact_bid && `精准:${adForm.related_exact_bid}`,
            adForm.related_expanded_bid && `扩展:${adForm.related_expanded_bid}`,
          ].filter(Boolean).join(' / ') || '未填写（点击设置）'
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              <div>
                <div style={{ marginBottom: 4 }}><span style={{ color: '#ff4d4f' }}>*</span> 广告选择</div>
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  value={adForm.ad_type}
                  onChange={(v) => setAdForm({ ...adForm, ad_type: v })}
                  placeholder="请选择广告类型（可多选）"
                  options={[
                    { label: '自动', value: 'auto' },
                    { label: '手动', value: 'manual' },
                    { label: '关联', value: 'related' },
                  ]}
                />
              </div>

              {/* 广告关键词ASIN来源：仅当包含手动或关联时出现 */}
              {hasManualOrRelated && (
                <div>
                  <div style={{ marginBottom: 4 }}>广告关键词ASIN来源</div>
                  <Select
                    style={{ width: '100%' }}
                    value={adForm.keyword_asin_source || undefined}
                    onChange={(v) => setAdForm({ ...adForm, keyword_asin_source: v })}
                    placeholder="请选择ASIN来源"
                    options={[
                      { label: '运营填写', value: 'operation' },
                      { label: 'H10查询', value: 'h10' },
                    ]}
                  />
                </div>
              )}

              <div>
                <div style={{ marginBottom: 4 }}>竞价策略</div>
                <Select
                  style={{ width: '100%' }}
                  value={adForm.bid_strategy || undefined}
                  onChange={(v) => setAdForm({ ...adForm, bid_strategy: v })}
                  placeholder="请选择竞价策略"
                  options={[
                    { label: '动态竞价-仅降低', value: 'dynamic_down' },
                    { label: '动态竞价-提高和降低', value: 'dynamic_up_down' },
                    { label: '固定竞价', value: 'fixed' },
                  ]}
                />
              </div>
              <div>
                <div style={{ marginBottom: 4 }}><span style={{ color: '#ff4d4f' }}>*</span> SKU</div>
                <Input
                  value={adForm.sku}
                  onChange={(e) => setAdForm({ ...adForm, sku: e.target.value })}
                  placeholder="请填写SKU"
                />
              </div>
              <div>
                <div style={{ marginBottom: 4 }}><span style={{ color: '#ff4d4f' }}>*</span> 站点</div>
                <Select
                  style={{ width: '100%' }}
                  value={adForm.site || undefined}
                  onChange={(v) => setAdForm({ ...adForm, site: v })}
                  placeholder="请选择站点"
                  showSearch
                  optionFilterProp="label"
                  options={[
                    'Knana SC [德国]', 'Knana SC [法国]', 'Knana SC [美国]', 'Knana SC [加拿大]', 'Knana SC [英国]',
                    'F SC [德国]', 'F SC [法国]', 'F SC [美国]', 'F SC [加拿大]', 'F SC [英国]',
                    'G SC [德国]', 'G SC [法国]', 'G SC [美国]', 'G SC [加拿大]', 'G SC [英国]',
                    'E SC [德国]', 'E SC [法国]', 'E SC [美国]', 'E SC [加拿大]', 'E SC [英国]',
                    'D SC [德国]', 'D SC [法国]', 'D SC [美国]', 'D SC [加拿大]', 'D SC [英国]',
                    'A SC [德国]', 'A SC [法国]', 'A SC [美国]', 'A SC [加拿大]', 'A SC [英国]',
                    'B SC [德国]', 'B SC [法国]', 'B SC [美国]', 'B SC [加拿大]', 'B SC [英国]',
                    'C SC [德国]', 'C SC [法国]', 'C SC [美国]', 'C SC [加拿大]', 'C SC [英国]',
                  ].map(s => ({ label: s, value: s }))}
                />
              </div>

              {/* 手动竞价：仅当广告选择包含手动时出现 */}
              {hasManual && (
                <div>
                  <div style={{ marginBottom: 4 }}>手动竞价</div>
                  <Input
                    value={manualBidSummary}
                    readOnly
                    onClick={() => setManualBidVisible(true)}
                    placeholder="点击设置手动竞价"
                    style={{ cursor: 'pointer', color: manualBidSummary.startsWith('未填写') ? '#999' : undefined }}
                    suffix={<span style={{ color: '#999', fontSize: 12 }}>点击配置</span>}
                  />
                  <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
                    对应竞价未填写则不开
                  </div>
                </div>
              )}

              {/* 关联竞价：仅当广告选择包含关联时出现 */}
              {hasRelated && (
                <div>
                  <div style={{ marginBottom: 4 }}>关联竞价</div>
                  <Input
                    value={relatedBidSummary}
                    readOnly
                    onClick={() => setRelatedBidVisible(true)}
                    placeholder="点击设置关联竞价"
                    style={{ cursor: 'pointer', color: relatedBidSummary.startsWith('未填写') ? '#999' : undefined }}
                    suffix={<span style={{ color: '#999', fontSize: 12 }}>点击配置</span>}
                  />
                  <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
                    对应竞价未填写则不开
                  </div>
                </div>
              )}

              {/* 最强关联竞品ASIN：仅当来源为H10查询时显示 */}
              {isH10 && (
                <div>
                  <div style={{ marginBottom: 4 }}>最强关联竞品ASIN</div>
                  <Input
                    value={adForm.strongest_related_asin}
                    onChange={(e) => setAdForm({ ...adForm, strongest_related_asin: e.target.value })}
                    placeholder="如 B08XXXXXXX"
                  />
                </div>
              )}

              {/* 最关键的关键词：仅当来源=H10查询 且 包含关联时显示 */}
              {isH10 && hasRelated && (
                <div>
                  <div style={{ marginBottom: 4 }}>最关键的关键词</div>
                  <Input
                    value={adForm.key_keyword}
                    onChange={(e) => setAdForm({ ...adForm, key_keyword: e.target.value })}
                    placeholder="请填写最关键的关键词"
                  />
                </div>
              )}

              {/* 限定词：仅当来源=H10查询 且 包含关联时显示 */}
              {isH10 && hasRelated && (
                <div>
                  <div style={{ marginBottom: 4 }}>限定词</div>
                  <Input
                    value={adForm.limit_word}
                    onChange={(e) => setAdForm({ ...adForm, limit_word: e.target.value })}
                    placeholder="请填写限定词"
                  />
                </div>
              )}

              {/* 广告ASIN：仅当来源=运营填写 且 包含关联时显示 */}
              {isOperation && hasRelated && (
                <div>
                  <div style={{ marginBottom: 4 }}>广告ASIN</div>
                  <Input
                    value={adForm.ad_asin}
                    onChange={(e) => setAdForm({ ...adForm, ad_asin: e.target.value })}
                    placeholder="如 B08XXXXXXX"
                  />
                </div>
              )}

              {/* 广告关键词：仅当来源=运营填写 且 包含手动时显示 */}
              {isOperation && hasManual && (
                <div>
                  <div style={{ marginBottom: 4 }}>广告关键词</div>
                  <Input
                    value={adForm.ad_keyword}
                    onChange={(e) => setAdForm({ ...adForm, ad_keyword: e.target.value })}
                    placeholder="请填写广告关键词"
                  />
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* 手动竞价子表单弹窗 */}
      <Modal
        title="手动竞价配置"
        open={manualBidVisible}
        onCancel={() => setManualBidVisible(false)}
        width={480}
        footer={[
          <Button key="cancel" onClick={() => setManualBidVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" onClick={() => {
            setManualBidVisible(false)
            message.success('手动竞价已保存')
          }}>保存</Button>,
        ]}
      >
        <div style={{ marginBottom: 12, color: '#999', fontSize: 12 }}>
          以下竞价均为非必填，未填写的竞价类型将不会开启
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4 }}>精准竞价</div>
            <Input
              value={adForm.manual_exact_bid}
              onChange={(e) => setAdForm({ ...adForm, manual_exact_bid: e.target.value })}
              placeholder="如 0.85"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>广泛竞价</div>
            <Input
              value={adForm.manual_broad_bid}
              onChange={(e) => setAdForm({ ...adForm, manual_broad_bid: e.target.value })}
              placeholder="如 0.75"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>词组竞价</div>
            <Input
              value={adForm.manual_phrase_bid}
              onChange={(e) => setAdForm({ ...adForm, manual_phrase_bid: e.target.value })}
              placeholder="如 0.65"
            />
          </div>
        </div>
      </Modal>

      {/* 关联竞价子表单弹窗 */}
      <Modal
        title="关联竞价配置"
        open={relatedBidVisible}
        onCancel={() => setRelatedBidVisible(false)}
        width={480}
        footer={[
          <Button key="cancel" onClick={() => setRelatedBidVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" onClick={() => {
            setRelatedBidVisible(false)
            message.success('关联竞价已保存')
          }}>保存</Button>,
        ]}
      >
        <div style={{ marginBottom: 12, color: '#999', fontSize: 12 }}>
          以下竞价均为非必填，未填写的竞价类型将不会开启
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4 }}>关联精准竞价</div>
            <Input
              value={adForm.related_exact_bid}
              onChange={(e) => setAdForm({ ...adForm, related_exact_bid: e.target.value })}
              placeholder="如 0.85"
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>关联扩展竞价</div>
            <Input
              value={adForm.related_expanded_bid}
              onChange={(e) => setAdForm({ ...adForm, related_expanded_bid: e.target.value })}
              placeholder="如 0.75"
            />
          </div>
        </div>
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
            const fieldValue = editField === 'image'
              ? uploadedImages.map(f => f.name).join(', ')
              : (editForm[editField as keyof typeof editForm] as string)
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
                { label: '图片', value: 'image' },
              ]}
            />
          </div>
          <div>
            {editField === 'image' ? (
              <div>
                <AntUpload
                  listType="picture-card"
                  multiple
                  fileList={uploadedImages}
                  beforeUpload={(file) => {
                    // 校验图片名：去除扩展名后必须为纯数字
                    const name = file.name.replace(/\.[^.]+$/, '')
                    if (!/^\d+$/.test(name)) {
                      message.error('上传失败，图片命名不规范，请重新上传')
                      return AntUpload.LIST_IGNORE
                    }
                    return false
                  }}
                  onChange={({ fileList }) => {
                    setUploadedImages(fileList)
                    setEditDirty(fileList.length > 0)
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20 }}>+</div>
                    <div style={{ fontSize: 12 }}>上传图片</div>
                  </div>
                </AntUpload>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  图片命名规范：以数字命名，数字则代表第几张图片替换
                </div>
              </div>
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
          {editField !== 'image' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                icon={<Sparkles size={14} />}
                loading={aiWriting}
                disabled={
                  !((editForm[editField as keyof typeof editForm] as string) || '').trim() ||
                  !((editForm.title || '').trim()) ||
                  !((editForm.keywords || '').trim())
                }
                onClick={async () => {
                  // 同步锁：立即拦截重复点击（React 状态更新是异步的，loading 来不及生效）
                  if (aiWritingLockRef.current) return
                  if (!selectedRecord) return
                  const currentContent = (editForm[editField as keyof typeof editForm] as string) || ''
                  if (!currentContent.trim()) {
                    message.warning('字段内容为空，无法进行AI编写')
                    return
                  }
                  if (!(editForm.title || '').trim() || !(editForm.keywords || '').trim()) {
                    message.warning('标题或关键词原始内容为空，无法进行AI编写')
                    return
                  }
                  aiWritingLockRef.current = true
                  setAiWriting(true)
                  try {
                    const res = await productPageInfoApi.aiWrite({
                      item_id: selectedRecord.id,
                      field_type: editField,
                      content: currentContent,
                    })
                    if (res.data.success) {
                      const generated = res.data.data.content
                      const fieldLabelMap: Record<string, string> = {
                        title: '标题', product_description: '产品描述',
                        keywords: '关键词', bullet_points: '五点描述',
                      }
                      Modal.confirm({
                        title: 'AI 编写建议',
                        content: (
                          <div>
                            <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
                              以下为 AI 生成的{fieldLabelMap[editField] || editField}内容，是否采纳并覆盖原内容？
                            </div>
                            <div style={{
                              padding: 12, background: '#f5f5f5', borderRadius: 6,
                              maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap',
                              border: '1px solid #e8e8e8',
                            }}>
                              {generated}
                            </div>
                          </div>
                        ),
                        okText: '采纳',
                        cancelText: '取消',
                        onOk: () => {
                          setEditForm({ ...editForm, [editField]: generated })
                          setEditDirty(true)
                          message.success('已采纳 AI 生成内容')
                        },
                      })
                    } else {
                      message.error(res.data.message || 'AI编写失败')
                    }
                  } catch (error: any) {
                    console.error('AI编写失败:', error)
                    message.error(error?.response?.data?.message || error?.message || 'AI编写失败')
                  } finally {
                    aiWritingLockRef.current = false
                    setAiWriting(false)
                  }
                }}
              >
                AI编写
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default RatingOptimizationBot