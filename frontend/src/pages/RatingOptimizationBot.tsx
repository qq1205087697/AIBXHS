import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Input, Select, Space, Tag, message, Modal, Drawer, Spin, Row, Col, Pagination, Radio, Checkbox, Dropdown, Tooltip } from 'antd'
import {
  Search,
  RefreshCw,
  Database,
  Sparkles,
  Edit2,
} from 'lucide-react'
import { CopyOutlined, TrophyOutlined } from '@ant-design/icons'
import { productPageInfoApi, operationLogsApi } from '../api'
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
  product_description_rating?: string | null
  star?: string | null
  star_rating?: string | null
  ad_rating?: string | null
  aplus_rating?: string | null
  video_rating?: string | null
  listing_suggestions?: string | null
  competitor_price?: string | null
  competitor_price_rank: number
  competitor_price_score: number
  rating_status?: number
  total_score: number
  traffic_keywords?: string | null
  updated_at?: string | null
  gross_margin?: number | null
  main_image_url?: string | null
  main_image_thumb_url?: string | null
}

interface RatingDetail extends RatingItem {
  // RatingItem已包含所有字段，RatingDetail暂时保留用于类型兼容
}

// 缓存结构
interface CacheData {
  data: RatingItem[]
  total: number
}

// AI建议基础信息固定字段：含有Listing建议时全部生成
const AI_BASIC_FIELDS: Array<{ key: 'title' | 'product_description' | 'keywords' | 'bullet_points'; label: string }> = [
  { key: 'title', label: '标题' },
  { key: 'product_description', label: '产品描述' },
  { key: 'keywords', label: '关键词' },
  { key: 'bullet_points', label: '五点描述' },
]

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
  // 详情抽屉内部视图：detail=详情 log=操作日志 ai=AI建议
  const [detailView, setDetailView] = useState<'detail' | 'log' | 'ai'>('detail')
  // 详情数据加载中（排行榜等入口传入精简数据时，等待详情接口返回）
  const [detailLoading, setDetailLoading] = useState(false)
  // AI建议
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false)
  const [aiSuggestData, setAiSuggestData] = useState<Partial<Record<'title' | 'product_description' | 'keywords' | 'bullet_points', string>> | null>(null)
  const [aiCheckedFields, setAiCheckedFields] = useState<string[]>([])
  // 旧AI建议内容（从最近一次AI建议操作日志读取；null=日志中无旧建议，不显示导入按钮）
  const [aiOldSuggestData, setAiOldSuggestData] = useState<Partial<Record<'title' | 'product_description' | 'keywords' | 'bullet_points', string>> | null>(null)
  const [aiCheckAd, setAiCheckAd] = useState(true)
  // 已提交应用的基础信息字段和广告区（应用后从视图中隐藏，页面不关闭）
  const [submittedFields, setSubmittedFields] = useState<string[]>([])
  const [adSubmitted, setAdSubmitted] = useState(false)

  // 图片预览（详情主图点击放大）
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState('')

  // 开广告表单
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

  // 参考关键词编辑弹窗
  const [keywordEditVisible, setKeywordEditVisible] = useState(false)
  const [keywordEditValue, setKeywordEditValue] = useState('')
  const [keywordEditSaving, setKeywordEditSaving] = useState(false)

  // 竞品价格新增弹窗
  const [competitorAddVisible, setCompetitorAddVisible] = useState(false)
  const [competitorForm, setCompetitorForm] = useState({ asin: '', price: '' })
  const [competitorSaving, setCompetitorSaving] = useState(false)

  // 操作日志
  const [logList, setLogList] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)

  // 排行榜
  const [rankingData, setRankingData] = useState<{ top10: any[]; bottom10: any[] }>({ top10: [], bottom10: [] })
  const [rankingModalOpen, setRankingModalOpen] = useState(false)

  // 计算当前页全选状态
  const currentPageIds = data.map(item => item.id)
  const isAllSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.includes(id))
  const currentPageSelectedCount = currentPageIds.filter(id => selectedIds.includes(id)).length

  // 卡片列宽：统一每行 4 个（与20条/页一致）
  const getColSpan = () => 6

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
        rated_no_video: ratingStatusFilter === 'rated_no_video' ? true : undefined,
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

  // 刷新库存：以库存机器人最新快照数据为来源，比对补全ASIN/品名并新增缺失的SKU
  const [refreshingInventory, setRefreshingInventory] = useState(false)

  const handleRefreshInventory = async () => {
    setRefreshingInventory(true)
    try {
      const res = await productPageInfoApi.refreshInventory()
      if (res.data.success) {
        message.success(res.data.message)
        dataCache.current.clear()
        fetchData(true)
      } else {
        message.error(res.data.message || '刷新库存失败')
      }
    } catch (error) {
      console.error('刷新库存失败:', error)
      message.error('刷新库存失败')
    } finally {
      setRefreshingInventory(false)
    }
  }

  const handleViewDetail = async (record: RatingItem) => {
    // 打开时重置到详情视图，避免上次残留在编辑/广告/日志/AI建议视图显示空字段
    setDetailView('detail')
    setDetailVisible(true)
    setDetailTab('product')
    // 排行榜等入口传入的是精简数据（无title等基础信息字段），先等详情接口返回再显示，避免字段空白
    const isSparseRecord = record.title === undefined
    if (isSparseRecord) {
      setDetailLoading(true)
    } else {
      setSelectedRecord(record) // 先显示列表数据，快速响应
    }
    try {
      const res = await productPageInfoApi.getById(record.id)
      if (res.data.success) {
        setSelectedRecord(res.data.data)
      } else if (isSparseRecord) {
        // 详情获取失败时回退显示精简数据
        setSelectedRecord(record)
      }
    } catch (error) {
      console.error('获取详情失败:', error)
      if (isSparseRecord) setSelectedRecord(record)
    } finally {
      if (isSparseRecord) setDetailLoading(false)
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

  // 参考关键词编辑
  const handleOpenKeywordEdit = () => {
    if (!selectedRecord) return
    setKeywordEditValue(selectedRecord.traffic_keywords || '')
    setKeywordEditVisible(true)
  }

  const handleSaveKeywordEdit = async () => {
    if (!selectedRecord) return
    if (keywordEditSaving) return
    setKeywordEditSaving(true)
    try {
      const res = await productPageInfoApi.updateTrafficKeywords(selectedRecord.id, keywordEditValue)
      if (res.data.success) {
        message.success('参考关键词已更新')
        setSelectedRecord({
          ...selectedRecord,
          traffic_keywords: res.data.data?.traffic_keywords ?? keywordEditValue,
        })
        // 同步更新列表中的数据
        setData(prev => prev.map(item => item.id === selectedRecord.id ? { ...item, traffic_keywords: res.data.data?.traffic_keywords ?? keywordEditValue } : item))
        dataCache.current.clear()
        setKeywordEditVisible(false)
      } else {
        message.error(res.data.message || '更新参考关键词失败')
      }
    } catch (error: any) {
      message.error(error?.response?.data?.message || '更新参考关键词失败')
    } finally {
      setKeywordEditSaving(false)
    }
  }

  // 竞品价格新增
  const handleOpenCompetitorAdd = () => {
    setCompetitorForm({ asin: '', price: '' })
    setCompetitorAddVisible(true)
  }

  const handleSaveCompetitorAdd = async () => {
    if (!selectedRecord) return
    if (competitorSaving) return
    const asin = competitorForm.asin.trim()
    const price = competitorForm.price.trim()
    if (!asin || !price) {
      message.warning('ASIN和价格均为必填项')
      return
    }
    setCompetitorSaving(true)
    try {
      const res = await productPageInfoApi.addCompetitor(selectedRecord.id, asin, price)
      if (res.data.success) {
        message.success('竞品添加成功，已重新排名')
        setSelectedRecord({
          ...selectedRecord,
          competitor_price: res.data.data.competitor_price,
          competitor_price_rank: res.data.data.competitor_price_rank,
          competitor_price_score: res.data.data.competitor_price_score,
          total_score: res.data.data.total_score,
        })
        fetchData()
        setCompetitorAddVisible(false)
      } else {
        message.error(res.data.message || '添加竞品失败')
      }
    } catch (error: any) {
      message.error(error?.response?.data?.message || '添加竞品失败')
    } finally {
      setCompetitorSaving(false)
    }
  }

  // 其他建议：根据评分规则计算（满分10分）
  // 图片评分≤6→新增产品图片；星级评分≤6→增加直评数量；广告评分≤6→新开广告
  // A+评分=5→上传高级A+；A+评分=0→上传普通或高级A+；视频评分=0→上传产品视频
  const getOtherSuggestions = (record: any): string[] => {
    if (!record) return []
    const suggestions: string[] = []
    const toScore = (v: any): number => {
      const n = parseFloat(v)
      return isNaN(n) ? 0 : n
    }
    if (toScore(record.image_rating) <= 6) suggestions.push('新增产品图片')
    if (toScore(record.star_rating) <= 6) suggestions.push('增加直评数量')
    if (toScore(record.ad_rating) <= 6) suggestions.push('新开广告')
    const aplusScore = toScore(record.aplus_rating)
    if (aplusScore === 5) suggestions.push('上传高级A+')
    if (aplusScore === 0) suggestions.push('上传普通或高级A+')
    if (toScore(record.video_rating) === 0) suggestions.push('上传产品视频')
    return suggestions
  }

  // 操作日志查看
  const handleOpenLog = async () => {
    if (!selectedRecord) return
    setDetailView('log')
    setLogLoading(true)
    try {
      const res = await operationLogsApi.getList({
        page: 1,
        page_size: 50,
        module: 'page_optimization',
        target_id: selectedRecord.id,
      })
      if (res.data.success) {
        setLogList(res.data.data || [])
      }
    } catch (error) {
      console.error('获取操作日志失败:', error)
    } finally {
      setLogLoading(false)
    }
  }

  // 运行AI建议：含有Listing建议时对全部基础信息字段并发生成（复用单个点击生成的aiWrite逻辑）
  const runAiSuggest = async (record: RatingDetail) => {
    if (!(record?.listing_suggestions || '').trim()) return
    const fields = AI_BASIC_FIELDS
    setAiSuggestLoading(true)
    try {
      const contentMap: Record<string, string> = {
        title: record.title || '',
        product_description: (record as any).product_description || '',
        keywords: record.keywords || '',
        bullet_points: (record as any).bullet_points || '',
      }
      // 存在Listing建议时随请求一起发送，AI按建议优化内容
      const listingSuggestion = ((record as any).listing_suggestions || '').trim()
      const results = await Promise.all(fields.map(f =>
        productPageInfoApi.aiWrite({
          item_id: record.id,
          field_type: f.key,
          content: contentMap[f.key],
          ...(listingSuggestion ? { suggestion: listingSuggestion } : {}),
        })
          .then(res => [f.key, {
            content: res.data?.success ? (res.data.data?.content || '') : '',
            hits: (res.data?.data?.forbidden_hits || []) as string[],
          }] as const)
      ))
      const data = Object.fromEntries(results.map(([k, v]) => [k, v.content])) as Partial<Record<'title' | 'product_description' | 'keywords' | 'bullet_points', string>>
      setAiSuggestData(data)
      // 生成完成后默认全选所有字段
      setAiCheckedFields(AI_BASIC_FIELDS.map(f => f.key))
      // 生成完成后记录到操作日志
      try {
        await productPageInfoApi.aiSuggestLog(record.id, data)
      } catch (e) {
        console.error('记录AI建议日志失败:', e)
      }
      message.success('AI建议生成完成')
      // 禁用词命中提示（代码层校验结果）
      const hitMap = results.filter(([, v]) => v.hits.length > 0)
      if (hitMap.length > 0) {
        const labelOf = (k: string) => AI_BASIC_FIELDS.find(f => f.key === k)?.label || k
        message.warning(
          `以下生成内容命中禁用词，请检查后再应用：${hitMap.map(([k, v]) => `${labelOf(k)}（${v.hits.join('、')}）`).join('；')}`,
          6,
        )
      }
    } catch (error) {
      console.error('AI建议生成失败:', error)
      message.error('AI建议生成失败')
    } finally {
      setAiSuggestLoading(false)
    }
  }

  // 打开AI建议视图：先获取完整详情（列表数据缺少产品描述/五点描述字段），再读取最近一次AI建议日志提取旧建议内容（不自动生成，由按钮触发）
  const handleOpenAiSuggest = async () => {
    if (!selectedRecord) return
    setDetailView('ai')
    // 重置应用状态和AI建议内容（每次打开为全新视图，避免残留上一个产品的生成结果）
    setSubmittedFields([])
    setAdSubmitted(false)
    setAiSuggestData(null)
    setAiCheckedFields([])
    setAiOldSuggestData(null)
    // 广告区表单不做预填，仅SKU预填当前产品
    setAdForm({
      ad_type: [],
      keyword_asin_source: '',
      bid_strategy: '',
      sku: selectedRecord.sku || '',
      site: '',
      manual_exact_bid: '',
      manual_broad_bid: '',
      manual_phrase_bid: '',
      related_exact_bid: '',
      related_expanded_bid: '',
      strongest_related_asin: '',
      key_keyword: '',
      limit_word: '',
      ad_asin: '',
      ad_keyword: '',
    })
    let record = selectedRecord
    try {
      const detailRes = await productPageInfoApi.getById(selectedRecord.id)
      if (detailRes.data.success) {
        record = detailRes.data.data
        setSelectedRecord(record)
      }
    } catch (error) {
      console.error('获取产品详情失败:', error)
    }
    // 读取最近一次AI建议日志，提取旧建议内容：有内容才显示"导入旧Listing内容"按钮
    let oldData: Partial<Record<'title' | 'product_description' | 'keywords' | 'bullet_points', string>> | null = null
    try {
      const res = await operationLogsApi.getList({
        page: 1,
        page_size: 1,
        module: 'page_optimization',
        target_id: selectedRecord.id,
        target_type: 'ai_suggest',
      })
      if (res.data.success) {
        const logs = Array.isArray(res.data.data) ? res.data.data : []
        let after = logs.length > 0 ? logs[0]?.after_data : null
        if (typeof after === 'string') {
          try { after = JSON.parse(after) } catch { after = null }
        }
        if (after && typeof after === 'object') {
          const restored: Partial<Record<'title' | 'product_description' | 'keywords' | 'bullet_points', string>> = {}
          AI_BASIC_FIELDS.forEach(f => {
            const v = (after as any)[f.key]
            if (typeof v === 'string' && v) restored[f.key] = v
          })
          if (Object.keys(restored).length > 0) oldData = restored
        }
      }
    } catch (error) {
      console.error('读取AI建议日志失败:', error)
    }
    setAiOldSuggestData(oldData)
  }

  // 导入旧Listing内容：把最近一次AI建议日志中的旧建议内容载入AI生成内容区
  const handleImportOldSuggest = () => {
    if (!aiOldSuggestData || aiSuggestLoading) return
    setAiSuggestData(aiOldSuggestData)
    setAiCheckedFields(AI_BASIC_FIELDS.filter(f => !!aiOldSuggestData[f.key]).map(f => f.key))
    message.success('已载入旧建议')
  }

  // 应用AI建议：勾选的基础信息字段AI内容逐字段提交到编辑基础信息地址；勾选广告→提交到开广告地址
  const handleAiSuggestApply = async () => {
    if (!selectedRecord) return
    // 应用前统一校验所有勾选项的必填项，有缺失则提示并阻止提交
    const missing: string[] = []
    const checkedBasicFields = AI_BASIC_FIELDS.filter(f => aiCheckedFields.includes(f.key))
    if (hasBasicSuggest && checkedBasicFields.length > 0) {
      for (const f of checkedBasicFields) {
        const content = aiSuggestData?.[f.key]
        if (!content || !content.trim()) missing.push(`基础信息区-${f.label}内容为空`)
      }
    }
    if (aiCheckAd && hasAdSuggest) {
      if (adForm.ad_type.length === 0) missing.push('广告区-请选择广告类型')
      if (!adForm.sku) missing.push('广告区-请填写SKU')
      if (!adForm.site) missing.push('广告区-请选择站点')
    }
    if (missing.length > 0) {
      message.warning(`存在缺少的必填项：${missing.join('、')}`)
      return
    }
    try {
      const submittedKeys: string[] = []
      // 基础信息区：勾选的字段AI内容逐字段提交到编辑基础信息地址（空内容已在校验拦截）
      if (hasBasicSuggest && checkedBasicFields.length > 0 && aiSuggestData) {
        for (const f of checkedBasicFields) {
          const res = await productPageInfoApi.submitEdit({
            item_id: selectedRecord.id,
            store: selectedRecord.store_original || selectedRecord.store || '',
            field_type: f.label,
            sku: selectedRecord.sku || '',
            content: aiSuggestData[f.key] || '',
            reset_rating: false,
          })
          if (!res.data.success) {
            message.error(res.data.message || `提交${f.label}失败`)
            return
          }
          submittedKeys.push(f.key)
        }
      }
      // 广告区：仅当勾选且出现"新开广告"建议时提交到开广告地址（必填项已在应用前统一校验）
      let adJustSubmitted = false
      if (aiCheckAd && hasAdSuggest) {
        const res = await productPageInfoApi.adSubmit({ ...adForm, item_id: selectedRecord.id })
        if (!res.data.success) {
          message.error(res.data.message || '广告配置提交失败')
          return
        }
        adJustSubmitted = true
      }
      // 应用成功：页面不关闭，已提交的字段/广告区从视图中隐藏
      if (submittedKeys.length > 0) {
        setSubmittedFields(prev => [...prev, ...submittedKeys])
        setAiCheckedFields(prev => prev.filter(k => !submittedKeys.includes(k)))
      }
      if (adJustSubmitted) setAdSubmitted(true)
      message.success('AI建议已应用')
      dataCache.current.clear()
      fetchData(true)
    } catch (error: any) {
      console.error('应用AI建议失败:', error)
      message.error(error?.response?.data?.message || error?.message || '应用失败')
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

  // 开广告表单（开广告视图与AI建议广告区共用，共享 adForm 状态）
  const renderAdForm = () => {
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px 24px' }}>
        <div>
          <div style={{ marginBottom: 4 }}><span style={{ color: '#ff4d4f' }}>*</span> 广告选择</div>
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            value={adForm.ad_type}
            onChange={(v) => setAdForm(prev => ({ ...prev, ad_type: v }))}
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
              onChange={(v) => setAdForm(prev => ({ ...prev, keyword_asin_source: v }))}
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
            onChange={(v) => setAdForm(prev => ({ ...prev, bid_strategy: v }))}
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
            onChange={(e) => setAdForm(prev => ({ ...prev, sku: e.target.value }))}
            placeholder="请填写SKU"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4 }}><span style={{ color: '#ff4d4f' }}>*</span> 站点</div>
          <Select
            style={{ width: '100%' }}
            value={adForm.site || undefined}
            onChange={(v) => setAdForm(prev => ({ ...prev, site: v }))}
            placeholder="请选择站点"
            showSearch
            optionFilterProp="label"
            options={[
              'A SC [德国]', 'A SC [法国]', 'A SC [意大利]', 'A SC [西班牙]', 'A SC [荷兰]', 'A SC [比利时]', 'A SC [美国]', 'A SC [加拿大]', 'A SC [英国]',
              'B SC [德国]', 'B SC [法国]', 'B SC [意大利]', 'B SC [西班牙]', 'B SC [荷兰]', 'B SC [比利时]', 'B SC [美国]', 'B SC [加拿大]', 'B SC [英国]',
              'C SC [德国]', 'C SC [法国]', 'C SC [意大利]', 'C SC [西班牙]', 'C SC [荷兰]', 'C SC [比利时]', 'C SC [美国]', 'C SC [加拿大]', 'C SC [英国]',
              'D SC [德国]', 'D SC [法国]', 'D SC [意大利]', 'D SC [西班牙]', 'D SC [荷兰]', 'D SC [比利时]', 'D SC [美国]', 'D SC [加拿大]', 'D SC [英国]',
              'E SC [德国]', 'E SC [法国]', 'E SC [意大利]', 'E SC [西班牙]', 'E SC [荷兰]', 'E SC [比利时]', 'E SC [美国]', 'E SC [加拿大]', 'E SC [英国]',
              'F SC [德国]', 'F SC [法国]', 'F SC [意大利]', 'F SC [西班牙]', 'F SC [荷兰]', 'F SC [比利时]', 'F SC [美国]', 'F SC [加拿大]', 'F SC [英国]',
              'G SC [德国]', 'G SC [法国]', 'G SC [意大利]', 'G SC [西班牙]', 'G SC [荷兰]', 'G SC [比利时]', 'G SC [美国]', 'G SC [加拿大]', 'G SC [英国]',
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
              onChange={(e) => setAdForm(prev => ({ ...prev, strongest_related_asin: e.target.value }))}
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
              onChange={(e) => setAdForm(prev => ({ ...prev, key_keyword: e.target.value }))}
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
              onChange={(e) => setAdForm(prev => ({ ...prev, limit_word: e.target.value }))}
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
              onChange={(e) => setAdForm(prev => ({ ...prev, ad_asin: e.target.value }))}
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
              onChange={(e) => setAdForm(prev => ({ ...prev, ad_keyword: e.target.value }))}
              placeholder="请填写广告关键词"
            />
          </div>
        )}
      </div>
    )
  }

  // AI建议视图：基础信息区仅在含有Listing建议时显示（全部基础信息字段生成AI内容），广告区仅在"其他建议"出现"新开广告"时显示
  const hasAdSuggest = selectedRecord ? getOtherSuggestions(selectedRecord).includes('新开广告') : false
  const hasBasicSuggest = !!(selectedRecord?.listing_suggestions || '').trim()
  // 基础信息区当前显示的字段（已应用提交的从视图中隐藏）
  const visibleBasicFields = AI_BASIC_FIELDS.filter(f => !submittedFields.includes(f.key))

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* 排行榜入口（点击弹窗显示） */}
      <Card size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '6px 16px' }}>
        <Button
          type="link"
          icon={<TrophyOutlined />}
          onClick={() => {
            setRankingModalOpen(true)
            fetchRanking()
          }}
          style={{ padding: 0, fontSize: 14, fontWeight: 600 }}
        >
          排行榜
        </Button>
      </Card>

      {/* 搜索栏 */}
      <Card size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '12px 16px' }}>
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
              <Radio.Button value="rated_no_video"><Tooltip title="已评分但无视频记录">无视频</Tooltip></Radio.Button>
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
              icon={<Database size={14} />}
              onClick={handleRefreshInventory}
              loading={refreshingInventory}
              disabled={refreshingInventory}
              title="根据库存机器人最新快照数据，比对补全ASIN和品名，并新增缺失的SKU"
            >
              刷新库存
            </Button>
          )}
        </div>
      </Card>

      {/* 操作栏：全选 + 操作下拉（位于搜索栏下方） */}
      <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '8px 16px' }}>
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

      {/* 数据卡片列表 */}
      <Card
        className="rating-list-card"
        style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}
        bodyStyle={{ padding: 16 }}
      >
        <Spin spinning={loading}>
          {/* 列表区域自适应填满剩余高度，条数多时内部滚动 */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
            <Row gutter={[16, 16]}>
              {data.map((item) => {
                // 评分分级：0-30 红（仅低分预警用红）/ 30-60 琥珀 / 60+ 绿
                const scoreLevel = item.total_score <= 30 ? 'low' : item.total_score <= 60 ? 'medium' : 'high'
                const scoreColor = scoreLevel === 'low' ? '#e5484d' : scoreLevel === 'medium' ? '#d97706' : '#059669'
                const scoreText = scoreLevel === 'low' ? '低于均值' : scoreLevel === 'medium' ? '表现一般' : '表现良好'
                return (
                  <Col key={item.id} span={getColSpan()}>
                    <Card
                      className={`rating-card${selectedIds.includes(item.id) ? ' is-selected' : ''}`}
                      style={{ cursor: 'pointer', width: '100%' }}
                      bodyStyle={{ padding: '13px 16px' }}
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
                          top: 14,
                          left: 12,
                          zIndex: 10,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      {/* 主体区：主图 + 信息区（店铺标签在SKU行右侧，分数在ASIN行右侧） */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 22 }}>
                        {/* 主图：缩略图+懒加载，失败回退原图 */}
                        {item.main_image_url ? (
                          <img
                            src={item.main_image_thumb_url || item.main_image_url}
                            alt="主图"
                            loading="lazy"
                            onError={(e) => {
                              const img = e.currentTarget
                              const original = item.main_image_url || ''
                              if (item.main_image_thumb_url && img.src !== original) {
                                img.dataset.fallback = '1'
                                img.src = original
                              }
                            }}
                            style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: '#f5f7fa', border: '1px solid #ebeef3' }}
                          />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f5f7fa', border: '1px solid #ebeef3', color: '#bbb', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            无图
                          </div>
                        )}
                        {/* 中间信息区：SKU 深灰主信息 / ASIN 中灰次信息，各带复制图标 */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {/* 行1：SKU + 复制图标 | 店铺标签 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
                            <span style={{ color: '#64748b', fontWeight: 500, flexShrink: 0 }}>SKU:</span>
                            <span style={{ color: '#1f2937', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.sku || '-'}</span>
                            <CopyOutlined
                              className="rating-copy-btn"
                              style={{ flexShrink: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard?.writeText(item.sku || '')
                                message.success('已复制SKU')
                              }}
                            />
                            <span style={{ flex: 1 }} />
                            <span className="rating-site-tag">{item.store || '-'}</span>
                          </div>
                          {/* 行2：ASIN + 复制图标 | 评分数字 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
                            <span style={{ color: '#64748b', fontWeight: 500, flexShrink: 0 }}>ASIN:</span>
                            <span style={{ color: '#6b7280', letterSpacing: 0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.asin || '-'}</span>
                            <CopyOutlined
                              className="rating-copy-btn"
                              style={{ flexShrink: 0 }}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard?.writeText(item.asin || '')
                                message.success('已复制ASIN')
                              }}
                            />
                            <span style={{ flex: 1 }} />
                            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2, flexShrink: 0 }}>
                              <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: scoreColor, fontVariantNumeric: 'tabular-nums' }}>{item.total_score}</span>
                              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>分</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* 底部：细进度条（4px、最宽200px）+ 评级小字 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 22, marginTop: 8 }}>
                        <div className="rating-progress-track" style={{ flex: 1, maxWidth: 200, height: 4 }}>
                          <div className={`rating-progress-fill rating-fill-${scoreLevel}`} style={{ width: `${Math.min(item.total_score, 100)}%` }} />
                        </div>
                        <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{scoreText}</span>
                      </div>
                    </Card>
                  </Col>
                )
              })}
            </Row>
          </div>
        </Spin>
      </Card>

      {/* 底部翻页器（常规流布局，不悬浮遮挡内容） */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          paddingTop: 8,
        }}
      >
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          showQuickJumper
          pageSizeOptions={['20', '40']}
          showTotal={(t) => `共 ${t} 条`}
          onChange={(page, size) => {
            if (size !== pageSize) {
              // 切换每页条数时重置到第1页
              setCurrentPage(1)
            } else {
              setCurrentPage(page)
            }
            setPageSize(size)
          }}
        />
      </div>

      {/* 查看详情抽屉（从右侧滑出） */}
      <Drawer
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
        onClose={() => {
          setDetailVisible(false)
          setDetailView('detail')
        }}
        footer={
          detailView === 'ai' ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setDetailView('detail')}>取消</Button>
              <Button
                type="primary"
                disabled={aiSuggestLoading || !aiSuggestData || (aiCheckedFields.length === 0 && !(hasAdSuggest && aiCheckAd && !adSubmitted)) || (visibleBasicFields.length === 0 && (!hasAdSuggest || adSubmitted))}
                onClick={handleAiSuggestApply}
              >
                应用
              </Button>
            </div>
          ) : (
            <div style={{ textAlign: 'right' }}>
              <Button onClick={() => {
                setDetailVisible(false)
                setDetailView('detail')
              }}>关闭</Button>
            </div>
          )
        }
        width={720}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <Spin size="large" />
          </div>
        ) : (
        <>
        {selectedRecord && (
          <>
            {/* 切换按钮：四个视图平级切换（无返回键） */}
            <Space style={{ marginBottom: 16 }}>
              <Button
                type={detailView === 'detail' && detailTab === 'product' ? 'primary' : 'default'}
                onClick={() => { setDetailView('detail'); setDetailTab('product') }}
              >
                产品信息详情
              </Button>
              <Button
                type={detailView === 'detail' && detailTab === 'score' ? 'primary' : 'default'}
                onClick={() => { setDetailView('detail'); setDetailTab('score') }}
              >
                评分详情
              </Button>
              <Button
                type={detailView === 'log' ? 'primary' : 'default'}
                onClick={handleOpenLog}
              >
                操作日志
              </Button>
              <Tooltip title={selectedRecord?.rating_status === 1 ? undefined : '请先给产品提交评分'}>
                <span style={{ display: 'inline-flex' }}>
                  <Button
                    type={detailView === 'ai' ? 'primary' : 'default'}
                    icon={<Sparkles size={14} />}
                    disabled={aiSuggestLoading || selectedRecord?.rating_status !== 1}
                    onClick={handleOpenAiSuggest}
                  >
                    {aiSuggestLoading ? 'AI建议生成中...' : '查看AI建议'}
                  </Button>
                </span>
              </Tooltip>
            </Space>
          </>
        )}
        {selectedRecord && detailView === 'detail' && (
          <>
            {/* 产品信息详情 */}
            {detailTab === 'product' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 1. 基础信息网格：左侧字段 + 右侧主图 */}
                <div className="product-info-grid">
                  <div className="product-info-fields">
                    <div className="product-field-item">
                      <span className="product-field-label">ASIN</span>
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
                          <a href={asinUrl} target="_blank" rel="noopener noreferrer" className="product-field-value product-asin-link">
                            {selectedRecord.asin}
                          </a>
                        ) : (
                          <span className="product-field-value">{selectedRecord.asin || '字段为空'}</span>
                        )
                      })()}
                    </div>
                    <div className="product-field-item">
                      <span className="product-field-label">SKU</span>
                      <span className="product-field-value">{selectedRecord.sku || '字段为空'}</span>
                    </div>
                    <div className="product-field-item">
                      <span className="product-field-label">店铺</span>
                      <span className="product-field-value">{selectedRecord.store || '字段为空'}</span>
                    </div>
                    <div className="product-field-item">
                      <span className="product-field-label">价格</span>
                      <span className="product-field-value">{selectedRecord.price || '字段为空'}</span>
                    </div>
                  </div>
                  <div className="product-main-img-wrap">
                    {selectedRecord.main_image_url ? (
                      <img
                        src={selectedRecord.main_image_url}
                        alt="主图"
                        className="product-main-img"
                        onClick={() => {
                          setPreviewImage(selectedRecord.main_image_url || '')
                          setPreviewOpen(true)
                        }}
                      />
                    ) : (
                      <div
                        className="product-main-img"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12, cursor: 'default' }}
                      >
                        未找到
                      </div>
                    )}
                    <span className="product-img-count">
                      {selectedRecord.main_image_url
                        ? (selectedRecord.image_count !== null && selectedRecord.image_count !== undefined ? `共 ${selectedRecord.image_count} 张图片` : '')
                        : '未在产品库中找到'}
                    </span>
                  </div>
                </div>

                {/* 2. 标题 */}
                <div className="product-content-block">
                  <div className="product-block-header">标题</div>
                  <div className="product-block-body">
                    <div className="product-title-text" style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>
                      {selectedRecord.title || '字段为空'}
                    </div>
                  </div>
                </div>

                {/* 3. 产品描述 */}
                <div className="product-content-block">
                  <div className="product-block-header">产品描述</div>
                  <div className="product-block-body" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                    {selectedRecord.product_description || '字段为空'}
                  </div>
                </div>

                {/* 4. 关键词（保持原样式：纯文本，不拆分、不着色） */}
                <div className="product-content-block">
                  <div className="product-block-header">关键词</div>
                  <div className="product-block-body" style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                    {selectedRecord.keywords || '字段为空'}
                  </div>
                </div>

                {/* 5. 五点描述：圆点列表 */}
                <div className="product-content-block">
                  <div className="product-block-header">五点描述</div>
                  <div className="product-block-body" style={{ maxHeight: 200, overflow: 'auto' }}>
                    {selectedRecord.bullet_points ? (
                      <ul className="product-bullet-list">
                        {selectedRecord.bullet_points.split('\n').filter(l => l.trim()).map((line, idx) => (
                          <li key={idx} style={{ whiteSpace: 'pre-wrap' }}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>字段为空</span>
                    )}
                  </div>
                </div>
              </div>
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

                {/* 评分详情主体：总览 → 细分评分网格 → 参考关键词 → 竞品价格（与卡片设计语言统一） */}
                {(() => {
                  const r = selectedRecord
                  // /10 分制分级：<=3 低分红 / <=6 中分橙 / >6 高分绿；空值用中性文本样式
                  const badgeCls = (val: unknown) => {
                    const n = typeof val === 'number' ? val : parseFloat(String(val ?? ''))
                    if (Number.isNaN(n)) return 'rating-badge-text'
                    return n <= 3 ? 'rating-badge-low' : n <= 6 ? 'rating-badge-medium' : 'rating-badge-high'
                  }
                  const badge = (val: string | number | null | undefined, unit = '/10') =>
                    val === null || val === undefined || val === '' ? (
                      <span className="rating-badge rating-badge-text">字段为空</span>
                    ) : (
                      <span className={`rating-badge ${badgeCls(val)}`}>{val}{unit}</span>
                    )
                  // 参考关键词拆分为独立标签
                  const keywordList = (r.traffic_keywords || '').split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean)
                  // 竞品价格按行解析（ASIN: 价格），根据店铺生成 Amazon 链接
                  const store = r.store_original || ''
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
                  const competitorRows = (r.competitor_price ? r.competitor_price.split('\n') : [])
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => {
                      const sepIdx = Math.max(line.indexOf(':'), line.indexOf('：'))
                      const asin = sepIdx > 0 ? line.substring(0, sepIdx).trim() : ''
                      const price = sepIdx > 0 ? line.substring(sepIdx + 1).trim() : ''
                      return { line, asin, price, url: asin && urlPrefix ? `${urlPrefix}${asin}` : '' }
                    })

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* 1. 数据总览：总分（按分值配色）+ 毛利率（蓝色强调） */}
                      <div className="rating-overview-row">
                        <div className="rating-overview-card">
                          <div className="rating-overview-label">总分</div>
                          <div className="rating-overview-value" style={{ color: r.total_score <= 30 ? '#e5484d' : r.total_score <= 60 ? '#d97706' : '#059669' }}>
                            {r.total_score}
                            <span className="rating-overview-unit">/100</span>
                          </div>
                        </div>
                        <div className="rating-overview-card">
                          <div className="rating-overview-label">毛利率</div>
                          {r.gross_margin !== null && r.gross_margin !== undefined ? (
                            <div className="rating-overview-value" style={{ color: '#1890ff' }}>
                              {r.gross_margin.toFixed(2)}
                              <span className="rating-overview-unit">%</span>
                            </div>
                          ) : (
                            <div style={{ fontSize: 14, color: '#9ca3af', padding: '7px 0' }}>暂无毛利率</div>
                          )}
                        </div>
                      </div>

                      {/* 2. 细分评分网格：圆角小徽章自动匹配分值颜色 */}
                      <div className="rating-score-grid">
                        <div className="rating-score-item"><span className="rating-score-item-label">标题评分</span>{badge(r.title_rating)}</div>
                        <div className="rating-score-item"><span className="rating-score-item-label">五点描述评分</span>{badge(r.description_rating)}</div>
                        <div className="rating-score-item"><span className="rating-score-item-label">产品描述评分</span>{badge(r.product_description_rating)}</div>
                        <div className="rating-score-item"><span className="rating-score-item-label">关键词评分</span>{badge(r.keywords_rating)}</div>
                        <div className="rating-score-item"><span className="rating-score-item-label">图片评分</span>{badge(r.image_rating)}</div>
                        <div className="rating-score-item">
                          <span className="rating-score-item-label">星级评分</span>
                          {r.star !== null && r.star !== undefined && r.star !== '' ? (
                            <span className="rating-badge rating-badge-text">
                              {r.star} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({r.star_rating ?? '-'}/10)</span>
                            </span>
                          ) : (
                            <span className="rating-badge rating-badge-text">字段为空</span>
                          )}
                        </div>
                        <div className="rating-score-item"><span className="rating-score-item-label">广告评分</span>{badge(r.ad_rating)}</div>
                        <div className="rating-score-item"><span className="rating-score-item-label">A+评分</span>{badge(r.aplus_rating)}</div>
                        <div className="rating-score-item"><span className="rating-score-item-label">视频评分</span>{badge(r.video_rating)}</div>
                      </div>

                      {/* 3. 参考关键词：圆角小标签 + 弱化编辑按钮 */}
                      <div className="rating-info-block">
                        <div className="rating-block-label">参考关键词</div>
                        <div className="rating-block-content">
                          <div className="rating-block-row">
                            <div className="rating-keyword-tags" style={{ flex: 1, minWidth: 0 }}>
                              {keywordList.length > 0 ? (
                                keywordList.map((k, i) => <span key={i} className="rating-keyword-tag">{k}</span>)
                              ) : (
                                <span style={{ color: '#9ca3af' }}>暂无</span>
                              )}
                            </div>
                            <Button type="text" size="small" icon={<Edit2 size={13} />} onClick={handleOpenKeywordEdit} style={{ color: '#1890ff', flexShrink: 0 }}>
                              编辑
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* 4. 竞品价格：行式列表 + 删除按钮，排名信息沉淀到底部 */}
                      <div className="rating-info-block">
                        <div className="rating-block-label">竞品价格</div>
                        <div className="rating-block-content">
                          <div className="rating-block-tip">如该产品不是竞品则可点击删除，重新排名计算得分</div>
                          <div className="rating-block-row">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {competitorRows.length > 0 ? (
                                <div className="rating-competitor-list">
                                  {competitorRows.map((row, idx) => (
                                    <div key={idx} className="rating-competitor-item">
                                      {row.url ? (
                                        <a className="rating-competitor-asin" href={row.url} target="_blank" rel="noopener noreferrer">{row.asin}</a>
                                      ) : (
                                        <span style={{ color: row.asin ? '#1f2937' : '#6b7280' }}>{row.asin || row.line}</span>
                                      )}
                                      {row.price && <span className="rating-competitor-price">：{row.price}</span>}
                                      <button className="rating-del-btn" title="删除该竞品" onClick={() => handleDeleteCompetitor(row.line)}>×</button>
                                    </div>
                                  ))}
                                  {r.competitor_price_rank > 0 && (
                                    <div className="rating-competitor-rank">
                                      <span>第{r.competitor_price_rank}名</span>
                                      <span className="rating-rank-badge">{r.competitor_price_score}/10</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: '#9ca3af' }}>无竞品价格</span>
                              )}
                            </div>
                            <Button type="text" size="small" icon={<Edit2 size={13} />} onClick={handleOpenCompetitorAdd} style={{ color: '#1890ff', flexShrink: 0 }}>
                              编辑
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* 产品建议：极浅蓝底 + 圆点列表（与整体冷调风格统一） */}
                {(() => {
                  const listingText = (selectedRecord?.listing_suggestions || '').trim()
                  const others = getOtherSuggestions(selectedRecord)
                  const listingItems = listingText ? listingText.split('\n').map(s => s.trim()).filter(Boolean) : []

                  if (!listingText && others.length === 0) return null
                  return (
                    <div className="rating-suggest-block">
                      <div className="rating-suggest-title">产品建议</div>
                      {listingItems.length > 0 && (
                        <>
                          <div className="rating-suggest-subtitle">Listing建议：</div>
                          <ul className="rating-suggest-list">
                            {listingItems.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </>
                      )}
                      {others.length > 0 && (
                        <>
                          <div className="rating-suggest-subtitle" style={{ marginTop: listingItems.length > 0 ? 12 : 0 }}>其他建议：</div>
                          <ul className="rating-suggest-list">
                            {others.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </>
                      )}
                    </div>
                  )
                })()}
              </>
            )}
          </>
        )}

        {/* 操作日志视图（与详情页设计语言统一的区块结构） */}
        {selectedRecord && detailView === 'log' && (
          <Spin spinning={logLoading}>
            {logList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>暂无操作记录</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {logList.map((log) => (
                  <div key={log.id} className="product-content-block">
                    {/* 区块头：操作类型标签 + 目标 + 时间 */}
                    <div className="product-block-header-flex">
                      <Space size={6}>
                        <Tag color="gold" style={{ marginInlineEnd: 0 }}>页面优化</Tag>
                        <Tag color={log.action === 'create' ? 'green' : log.action === 'update' ? 'blue' : 'red'} style={{ marginInlineEnd: 0 }}>
                          {log.action === 'create' ? '创建' : log.action === 'update' ? '更新' : '删除'}
                        </Tag>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                          {({ basic_info: '基础信息', traffic_keywords: '参考关键词', competitor_price: '竞品价格', ad_submit: '开广告', optimize_submit: '一键优化', ai_suggest: 'AI建议' } as Record<string, string>)[log.target_type] || log.target_type || ''}
                        </span>
                      </Space>
                      <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>{log.created_at}</span>
                    </div>
                    {/* 区块体：摘要 + 操作人 + 变更内容 */}
                    <div className="product-block-body">
                      <div style={{ fontSize: 13, color: '#1f2937', marginBottom: 4 }}>{log.summary || ''}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>操作人：{log.username || '-'}</div>
                      {(() => {
                        let afterData = log.after_data
                        if (typeof afterData === 'string') {
                          try { afterData = JSON.parse(afterData) } catch { /* keep */ }
                        }
                        if (afterData && typeof afterData === 'object' && Object.keys(afterData).length > 0) {
                          return (
                            <div className="log-detail-box">
                              {Object.entries(afterData).map(([k, v]) => (
                                <div key={k} style={{ display: 'flex', gap: 4 }}>
                                  <span style={{ color: '#9ca3af', flexShrink: 0 }}>{k}：</span>
                                  <span style={{ color: '#4b5563', wordBreak: 'break-all' }}>
                                    {Array.isArray(v) ? v.join('、') : String(v)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                        }
                        return null
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Spin>
        )}

        {/* AI建议视图 */}
        {selectedRecord && detailView === 'ai' && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Checkbox
                checked={((hasBasicSuggest ? (visibleBasicFields.length === 0 || visibleBasicFields.every(f => aiCheckedFields.includes(f.key))) : true)) && ((hasAdSuggest && !adSubmitted) ? aiCheckAd : true)}
                indeterminate={!(((hasBasicSuggest ? (visibleBasicFields.length === 0 || visibleBasicFields.every(f => aiCheckedFields.includes(f.key))) : true)) && ((hasAdSuggest && !adSubmitted) ? aiCheckAd : true)) && ((hasBasicSuggest && visibleBasicFields.length > 0 && aiCheckedFields.length > 0) || (hasAdSuggest && !adSubmitted && aiCheckAd))}
                onChange={(e) => {
                  if (hasBasicSuggest && visibleBasicFields.length > 0) setAiCheckedFields(e.target.checked ? visibleBasicFields.map(f => f.key) : [])
                  setAiCheckAd(e.target.checked && hasAdSuggest && !adSubmitted)
                }}
              >
                全选
              </Checkbox>
            </div>

            {/* 区域一：基础信息区（左侧AI生成内容可勾选可编辑 / 右侧原始内容，仅当含有Listing建议时显示，已应用提交的字段从视图中隐藏） */}
            {hasBasicSuggest && visibleBasicFields.length > 0 && (() => {
              const originalMap: Record<string, string> = {
                title: selectedRecord.title || '',
                product_description: (selectedRecord as any).product_description || '',
                bullet_points: (selectedRecord as any).bullet_points || '',
                keywords: selectedRecord.keywords || '',
              }
              const allChecked = visibleBasicFields.every(f => aiCheckedFields.includes(f.key))
              const someChecked = aiCheckedFields.some(k => visibleBasicFields.some(f => f.key === k)) && !allChecked
              return (
                <div className="product-content-block" style={{ marginBottom: 12 }}>
                  <div className="product-block-header-flex">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      onChange={(e) => setAiCheckedFields(e.target.checked ? visibleBasicFields.map(f => f.key) : aiCheckedFields.filter(k => !visibleBasicFields.some(f => f.key === k)))}
                    >
                      基础信息
                    </Checkbox>
                    <Space size={8}>
                      {aiOldSuggestData && (
                        <Button size="small" disabled={aiSuggestLoading} onClick={handleImportOldSuggest}>
                          导入旧Listing内容
                        </Button>
                      )}
                      <Button
                        size="small"
                        type="primary"
                        loading={aiSuggestLoading}
                        onClick={() => selectedRecord && runAiSuggest(selectedRecord)}
                      >
                        生成新Listing内容
                      </Button>
                    </Space>
                  </div>
                  <div className="product-block-body">
                  <Row gutter={16}>
                    <Col span={12}>
                      <div className="ai-column-title">AI生成内容（可勾选可编辑）</div>
                      {aiSuggestLoading ? (
                        <div style={{ textAlign: 'center', padding: 32 }}>
                          <Spin />
                          <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>AI建议生成中...</div>
                        </div>
                      ) : aiSuggestData ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {visibleBasicFields.map(f => (
                            <div key={f.key}>
                              <div style={{ marginBottom: 2 }}>
                                <Checkbox
                                  checked={aiCheckedFields.includes(f.key)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setAiCheckedFields(prev => [...prev, f.key])
                                    } else {
                                      setAiCheckedFields(prev => prev.filter(k => k !== f.key))
                                    }
                                  }}
                                >
                                  <span style={{ fontSize: 12, color: '#666' }}>{f.label}</span>
                                </Checkbox>
                              </div>
                              <Input.TextArea
                                value={aiSuggestData[f.key] || ''}
                                onChange={(e) => setAiSuggestData(prev => ({ ...(prev || {}), [f.key]: e.target.value }))}
                                autoSize={{ minRows: 2, maxRows: 6 }}
                                placeholder="生成失败或为空"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: '#999', textAlign: 'center', padding: 32 }}>暂无AI建议</div>
                      )}
                    </Col>
                    <Col span={12}>
                      <div className="ai-column-title">原始内容</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {visibleBasicFields.map(f => (
                          <div key={f.key}>
                            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 2 }}>{f.label}</div>
                            <div style={{ background: '#f5f7fa', padding: 8, borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>
                              {originalMap[f.key] || '字段为空'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Col>
                  </Row>
                  </div>
                </div>
              )
            })()}

            {/* 区域二：广告区（仅当出现"新开广告"建议且未应用提交时显示） */}
            {hasAdSuggest && !adSubmitted && (
              <div className="product-content-block">
                <div className="product-block-header-flex">
                  <Checkbox checked={aiCheckAd} onChange={(e) => setAiCheckAd(e.target.checked)}>广告</Checkbox>
                </div>
                <div className="product-block-body">{renderAdForm()}</div>
              </div>
            )}

            {/* 两个区域都无可显示项时提示 */}
            {(!hasBasicSuggest || visibleBasicFields.length === 0) && (!hasAdSuggest || adSubmitted) && (
              <div style={{ color: '#999', textAlign: 'center', padding: 48 }}>
                {hasBasicSuggest || hasAdSuggest ? '勾选的内容已全部应用' : '该产品无需要优化的建议项'}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </Drawer>

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

      {/* 图片预览弹窗 */}
      <Modal
        open={previewOpen}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        width={600}
      >
        <img src={previewImage} alt="预览" style={{ width: '100%' }} />
      </Modal>
      {/* 参考关键词编辑弹窗 */}
      <Modal
        title="编辑参考关键词"
        open={keywordEditVisible}
        onCancel={() => setKeywordEditVisible(false)}
        width={560}
        footer={[
          <Button key="cancel" onClick={() => setKeywordEditVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={keywordEditSaving} onClick={handleSaveKeywordEdit}>确定</Button>,
        ]}
      >
        <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>每个关键词请使用空格分隔</div>
        <Input.TextArea
          value={keywordEditValue}
          onChange={(e) => setKeywordEditValue(e.target.value)}
          rows={6}
          placeholder="请输入关键词，多个关键词使用空格分隔"
        />
      </Modal>
      {/* 竞品价格新增弹窗 */}
      <Modal
        title="编辑竞品价格"
        open={competitorAddVisible}
        onCancel={() => setCompetitorAddVisible(false)}
        width={480}
        footer={[
          <Button key="cancel" onClick={() => setCompetitorAddVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={competitorSaving} onClick={handleSaveCompetitorAdd}>确定</Button>,
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#ff4d4f' }}>*</span> ASIN
            </div>
            <Input
              value={competitorForm.asin}
              onChange={(e) => setCompetitorForm({ ...competitorForm, asin: e.target.value })}
              placeholder="请输入竞品ASIN"
            />
          </div>
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#ff4d4f' }}>*</span> 价格
            </div>
            <Input
              value={competitorForm.price}
              onChange={(e) => setCompetitorForm({ ...competitorForm, price: e.target.value })}
              placeholder="请输入竞品价格"
            />
          </div>
        </div>
      </Modal>

      {/* 排行榜弹窗 */}
      <Modal
        title="评分排行榜"
        open={rankingModalOpen}
        onCancel={() => setRankingModalOpen(false)}
        footer={null}
        width={900}
      >
        <Row gutter={16}>
          {/* 评分前十 */}
          <Col span={12}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>评分前十</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rankingData.top10.length === 0 && (
                <div style={{ color: '#999', textAlign: 'center', padding: 16 }}>暂无已评分记录</div>
              )}
              {rankingData.top10.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setRankingModalOpen(false)
                    handleViewDetail({ ...item, store_original: item.store_original } as RatingItem)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: index === 0 ? '#fff7e6' : '#fafafa',
                    cursor: 'pointer',
                  }}
                >
                  <Tag color={index < 3 ? 'gold' : 'default'} style={{ marginRight: 0, minWidth: 32, textAlign: 'center' }}>
                    {index + 1}
                  </Tag>
                  <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.sku}
                  </span>
                  <span style={{ color: '#666', fontSize: 12 }}>{item.store}</span>
                  <span style={{ color: '#999', fontSize: 12 }}>{item.asin}</span>
                  <span style={{ fontWeight: 700, color: '#52c41a', minWidth: 40, textAlign: 'right' }}>{item.total_score}</span>
                </div>
              ))}
            </div>
          </Col>
          {/* 倒数前十 */}
          <Col span={12}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>倒数前十</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rankingData.bottom10.length === 0 && (
                <div style={{ color: '#999', textAlign: 'center', padding: 16 }}>暂无已评分记录</div>
              )}
              {rankingData.bottom10.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setRankingModalOpen(false)
                    handleViewDetail({ ...item, store_original: item.store_original } as RatingItem)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: index === 0 ? '#fff2f0' : '#fafafa',
                    cursor: 'pointer',
                  }}
                >
                  <Tag color={index < 3 ? 'red' : 'default'} style={{ marginRight: 0, minWidth: 32, textAlign: 'center' }}>
                    {index + 1}
                  </Tag>
                  <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.sku}
                  </span>
                  <span style={{ color: '#666', fontSize: 12 }}>{item.store}</span>
                  <span style={{ color: '#999', fontSize: 12 }}>{item.asin}</span>
                  <span style={{ fontWeight: 700, color: '#ff4d4f', minWidth: 40, textAlign: 'right' }}>{item.total_score}</span>
                </div>
              ))}
            </div>
          </Col>
        </Row>
      </Modal>
    </div>
  )
}

export default RatingOptimizationBot