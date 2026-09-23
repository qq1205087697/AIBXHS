import React, { useEffect, useRef, useState } from 'react'
import {
  Card,
  Button,
  Spin,
  Tag,
  Typography,
  Space,
  Divider,
  Tabs,
  message,
  Empty,
  Modal,
  Select,
  Row,
  Col,
  Input,
  Slider,
  Segmented,
  Tooltip,
  Pagination,
  Image,
  Dropdown,
} from 'antd'
import {
  UploadOutlined,
  ClearOutlined,
  PictureOutlined,
  BulbOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
  DeleteOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  UpOutlined,
  DownOutlined,
  FormOutlined,
  MoreOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload'
import { useTheme } from '../contexts/ThemeContext'
import {
  aiCreationApi,
  productsApi,
  AmazonProductAnalysisResult,
  VideoConcept,
  VideoMarket,
  VideoDuration,
  VideoRatio,
  VideoModel,
  VideoResolution,
  VoiceoverLanguage,
  AIVideoTask,
} from '../api'

const { Text } = Typography
const { TextArea } = Input

const MAX_IMAGES = 9
const MAX_PROMPT_LENGTH = 4000
const PRODUCT_PAGE_SIZE = 8

interface ProductOptionItem {
  id: number
  product_code: string
  name: string
  images: string[]
}

const MARKET_OPTIONS: { label: string; value: VideoMarket }[] = [
  { label: '美国', value: 'US' },
  { label: '加拿大', value: 'CA' },
  { label: '澳大利亚', value: 'AU' },
  { label: '英国', value: 'UK' },
  { label: '德国', value: 'DE' },
  { label: '奥地利', value: 'AT' },
  { label: '瑞士', value: 'CH' },
  { label: '法国', value: 'FR' },
  { label: '西班牙', value: 'ES' },
  { label: '墨西哥', value: 'MX' },
  { label: '意大利', value: 'IT' },
  { label: '日本', value: 'JP' },
  { label: '韩国', value: 'KR' },
  { label: '巴西', value: 'BR' },
  { label: '中东', value: 'ME' },
  { label: '东南亚', value: 'SEA' },
]

const getMarketLabel = (m: VideoMarket): string =>
  MARKET_OPTIONS.find((opt) => opt.value === m)?.label || m

// 目标市场 → 默认口播语言（口播语言选“自动”时生效）
const MARKET_LANGUAGE_NAME: Record<VideoMarket, string> = {
  US: '英语',
  CA: '英语',
  AU: '英语',
  UK: '英语（英式拼写）',
  DE: '德语',
  AT: '德语',
  CH: '德语',
  FR: '法语',
  ES: '西班牙语',
  MX: '西班牙语',
  IT: '意大利语',
  JP: '日语',
  KR: '韩语',
  BR: '葡萄牙语',
  ME: '阿拉伯语',
  SEA: '英语（按平台可切换泰语/越南语/印尼语）',
  CN: '中文',
}

const VOICEOVER_LANGUAGE_LABELS: Record<Exclude<VoiceoverLanguage, 'auto'>, string> = {
  English: '英语',
  German: '德语',
  French: '法语',
  Spanish: '西班牙语',
  Italian: '意大利语',
  Japanese: '日语',
  Korean: '韩语',
  Portuguese: '葡萄牙语',
  Arabic: '阿拉伯语',
}

const VOICEOVER_LANGUAGE_OPTIONS: { label: string; value: VoiceoverLanguage }[] = [
  { label: '自动（跟随目标市场）', value: 'auto' },
  ...(Object.keys(VOICEOVER_LANGUAGE_LABELS) as Exclude<VoiceoverLanguage, 'auto'>[]).map((value) => ({
    label: `${value} ${VOICEOVER_LANGUAGE_LABELS[value]}`,
    value,
  })),
]

const MODEL_OPTIONS: { label: string; desc: string; value: VideoModel }[] = [
  { label: 'MiniMax H3', desc: '适合批量测款与日常上新', value: 'minimax-h3' },
  { label: 'MiniMax H3-Lite', desc: '生成更快，成本更低', value: 'minimax-h3-lite' },
]

// 视频分辨率档位：0.3 / 0.5 为 megapixels 档位，768P 即 0.98 满画幅
const RESOLUTION_OPTIONS: { label: string; value: VideoResolution; desc: string }[] = [
  { label: '0.3', value: '0.3', desc: '草稿档，生成最快' },
  { label: '0.5', value: '0.5', desc: '标准档' },
  { label: '768P', value: '768P', desc: '满画幅，画质最好' },
]

// MiniMax H3 仅支持 5 / 10 / 15 秒三档时长
const DURATION_MARKS: Record<number, React.ReactNode> = {
  5: '5',
  10: '10',
  15: '15',
}

// 参考图片中的视频比例样式：小方块图标 + 文字，4 个一行
const RATIO_OPTIONS: { label: string; value: VideoRatio; w: number; h: number; dashed?: boolean }[] = [
  { label: '自适应', value: 'auto', w: 26, h: 26, dashed: true },
  { label: '9:16', value: '9:16', w: 15, h: 26 },
  { label: '16:9', value: '16:9', w: 26, h: 15 },
  { label: '1:1', value: '1:1', w: 22, h: 22 },
  { label: '4:3', value: '4:3', w: 26, h: 20 },
  { label: '3:4', value: '3:4', w: 20, h: 26 },
  { label: '21:9', value: '21:9', w: 28, h: 12 },
]

interface ProductDraft {
  product_name_cn: string
  product_size: string
  target_audience: string
  details: string
}

const AICreationCenter: React.FC = () => {
  const { currentTheme } = useTheme()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [result, setResult] = useState<AmazonProductAnalysisResult | null>(null)
  const [concepts, setConcepts] = useState<VideoConcept[] | null>(null)
  const [conceptsDirty, setConceptsDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [market, setMarket] = useState<VideoMarket>('US')
  const [voiceoverLanguage, setVoiceoverLanguage] = useState<VoiceoverLanguage>('auto')
  const [duration, setDuration] = useState<VideoDuration>(15)
  const [ratio, setRatio] = useState<VideoRatio>('9:16')
  const [model, setModel] = useState<VideoModel>('minimax-h3')
  const [resolution, setResolution] = useState<VideoResolution>('768P')
  const [promptText, setPromptText] = useState('')
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [planRefreshLeft, setPlanRefreshLeft] = useState(2)
  const [productInfoExpanded, setProductInfoExpanded] = useState(false)
  const [draftProduct, setDraftProduct] = useState<ProductDraft | null>(null)
  const [productDraftDirty, setProductDraftDirty] = useState(false)
  const [history, setHistory] = useState<AIVideoTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [previewTask, setPreviewTask] = useState<AIVideoTask | null>(null)
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null)
  const localInputRef = useRef<HTMLInputElement>(null)
  const [uploadAreaHover, setUploadAreaHover] = useState(false)
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [productSearchText, setProductSearchText] = useState('')
  const [productKeyword, setProductKeyword] = useState('')
  const [productOptions, setProductOptions] = useState<ProductOptionItem[]>([])
  const [productTotal, setProductTotal] = useState(0)
  const [productPage, setProductPage] = useState(1)
  const [productLoading, setProductLoading] = useState(false)
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([])

  // 追加本地图片文件（校验类型与数量上限）—— 改图后方案失效，需重新生成
  const appendFiles = (files: File[]) => {
    const images = files.filter((f) => f.type?.startsWith('image/'))
    if (images.length < files.length) {
      message.error('存在非图片文件，已自动忽略')
    }
    if (images.length > 0) setConceptsDirty(true)
    setFileList((prev) => {
      const remain = MAX_IMAGES - prev.length
      if (images.length > remain) {
        message.warning(`最多上传 ${MAX_IMAGES} 张图片`)
      }
      const accepted = images.slice(0, Math.max(0, remain))
      const items: UploadFile[] = accepted.map((f, i) => ({
        uid: `local-${Date.now()}-${i}-${f.name}`,
        name: f.name,
        status: 'done',
        thumbUrl: URL.createObjectURL(f),
        originFileObj: f,
      }))
      return [...prev, ...items]
    })
  }

  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) appendFiles(files)
    e.target.value = ''
  }

  const handleRemoveImage = (uid: string) => {
    setConceptsDirty(true)
    setFileList((prev) => {
      const target = prev.find((f) => f.uid === uid)
      if (target?.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(target.thumbUrl)
      return prev.filter((f) => f.uid !== uid)
    })
  }

  const handleClear = () => {
    fileList.forEach((f) => {
      if (f.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(f.thumbUrl)
    })
    setFileList([])
    setResult(null)
    setConcepts(null)
    setConceptsDirty(false)
    setPromptText('')
    setPlanRefreshLeft(2)
    setPlanModalOpen(false)
  }

  // 当前生效的口播语言名称：指定语言优先，否则跟随目标市场
  const resolveVoiceoverLanguageName = (): string =>
    voiceoverLanguage === 'auto'
      ? MARKET_LANGUAGE_NAME[market]
      : VOICEOVER_LANGUAGE_LABELS[voiceoverLanguage]

  const getRatioLabel = (r: VideoRatio): string =>
    RATIO_OPTIONS.find((opt) => opt.value === r)?.label || r

  const getModelLabel = (m: VideoModel): string =>
    MODEL_OPTIONS.find((opt) => opt.value === m)?.label || m

  // 目标语言展示：「自动」跟随市场，否则显示语言中文名
  const getVoiceoverLabel = (item: AIVideoTask): string => {
    const lang = item.voiceover_language
    if (!lang || lang === '自动') {
      return `自动（${MARKET_LANGUAGE_NAME[item.market] || '英语'}）`
    }
    return VOICEOVER_LANGUAGE_LABELS[lang as Exclude<VoiceoverLanguage, 'auto'>] || lang
  }

  // 提示词摘要：最多 30 字，超出省略
  const truncatePrompt = (p: string): string => (p.length > 30 ? `${p.slice(0, 30)}…` : p)

  // 分镜文本：新方案输出 [镜头X]：时间码 | 标签 + [内容]：画面描述；口播：台词
  const formatShotText = (shot: VideoConcept['storyboard'][0], idx: number): string => {
    const numText = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'][idx] || String(idx + 1)
    const head = `[镜头${numText}]：${shot.timestamp}${shot.shot_purpose ? ` | ${shot.shot_purpose}` : ''}`
    const desc =
      shot.description ||
      [
        shot.shot_type,
        shot.camera_movement,
        shot.character_action,
        shot.character_expression,
        shot.product_action,
        shot.product_position,
        shot.composition,
        shot.environment,
      ]
        .filter(Boolean)
        .join('，')
    const content = `[内容]：${desc}${shot.voiceover ? `；口播：${shot.voiceover}` : ''}`
    return `${head}\n${content}`
  }

  const formatSelectedConcept = (concept: VideoConcept): string => {
    const lines: string[] = []
    lines.push(`[目标语言]：${resolveVoiceoverLanguageName()}口播`)
    lines.push(`[情节]：${concept.story}`)
    lines.push(`[模特]：${concept.character}`)
    lines.push(`[环境]：${concept.environment}`)
    lines.push(`[音乐]：${concept.music}`)
    lines.push(`[分镜]：`)
    concept.storyboard.forEach((shot, idx) => {
      lines.push(formatShotText(shot, idx))
    })
    return lines.join('\n')
  }

  // ===== 生成历史（后端任务表）：进入页面拉取，未完成的任务每 15 秒轮询一次 =====
  const loadTasks = async () => {
    setTasksLoading(true)
    try {
      const resp = await aiCreationApi.listVideoTasks(20)
      setHistory(resp.data.data || [])
    } catch {
      // 拉取失败时保留原有列表，避免界面闪烁
    } finally {
      setTasksLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [])

  useEffect(() => {
    const running = history.some((t) => t.status === '排队中' || t.status === '生成中')
    if (!running) return
    const timer = window.setInterval(loadTasks, 15000)
    return () => window.clearInterval(timer)
  }, [history])

  // 收集所有图片为 File：本地文件直接用，产品图片 URL 需下载转 File
  const collectFiles = async (): Promise<File[]> => {
    const files: File[] = []
    for (const f of fileList) {
      if (f.originFileObj instanceof File) {
        files.push(f.originFileObj)
      } else if (f.url || f.thumbUrl) {
        try {
          const resp = await fetch(f.url || f.thumbUrl!)
          const blob = await resp.blob()
          files.push(new File([blob], f.name || `image-${f.uid}.jpg`, { type: blob.type || 'image/jpeg' }))
        } catch {
          // 单张图片下载失败时跳过
        }
      }
    }
    return files
  }

  // 生成三套方案（新方案）：一次调用完成商品分析 + 3 套口播方案
  const handleGeneratePlans = async (
    isRefresh = false,
    confirmedCard?: string,
    productForState?: AmazonProductAnalysisResult,
  ) => {
    const files = await collectFiles()

    if (files.length === 0) {
      message.warning('请先上传商品图片')
      return
    }
    if (isRefresh && planRefreshLeft <= 0) {
      return
    }

    setLoading(true)

    try {
      const res = await aiCreationApi.generateVoiceoverPlans(files, {
        duration,
        target_market: getMarketLabel(market),
        voiceover_language: voiceoverLanguage,
        aspect_ratio: ratio,
        product_name: productForState?.product_name_cn || result?.product_name_cn || '',
        avoid_types:
          isRefresh && concepts
            ? concepts.map((c) => c.marketing_goal).filter(Boolean)
            : undefined,
        confirmed_card: confirmedCard,
      })
      if (res.data?.success && res.data?.data) {
        setResult(productForState || res.data.data.product)
        setConcepts(res.data.data.concepts)
        setConceptsDirty(false)
        // 每次打开弹窗时商品信息默认收起
        setProductInfoExpanded(false)
        setDraftProduct(null)
        setProductDraftDirty(false)
        setPlanModalOpen(true)
        if (isRefresh) {
          setPlanRefreshLeft((n) => n - 1)
        } else {
          setPlanRefreshLeft(2)
        }
        message.success(isRefresh ? '已重新生成 3 套方案' : '已生成 3 套方案，请选择一套')
      } else {
        message.error('方案生成异常，请稍后重试')
      }
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.message || '方案生成失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // 选择方案：只填入提示词，不写入生成历史（历史仅在点「立即生成」时记录）
  const handleSelectPlan = (idx: number) => {
    if (!concepts || !concepts[idx]) return
    const concept = concepts[idx]
    setPromptText(formatSelectedConcept(concept))
    setPlanModalOpen(false)
    message.success(`已选择方案 ${['一', '二', '三'][idx]}，提示词已填入`)
  }

  // 立即生成：提交 MiniMax H3 视频生成任务，任务状态与成片由后端轮询回写
  const handleGenerateVideo = async () => {
    if (fileList.length === 0) {
      message.warning('请先上传商品图片')
      return
    }
    if (!promptText.trim()) {
      message.warning('请先生成或填写视频提示词')
      return
    }
    const title = result?.product_name_cn || result?.product_name_en || '视频生成任务'
    const files = await collectFiles()
    if (files.length === 0) {
      message.warning('参考图片读取失败，请重新上传')
      return
    }
    setLoading(true)
    try {
      const resp = await aiCreationApi.generateVideo(files, {
        prompt: promptText,
        duration,
        resolution,
        ratio,
        model,
        market,
        voiceover_language: voiceoverLanguage,
        title,
      })
      const task = resp.data.data
      setHistory((prev) => [task, ...prev.filter((t) => t.id !== task.id)].slice(0, 20))
      setActiveHistoryId(task.id)
      message.success('视频生成任务已提交，生成中（约 25~40 分钟）')
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '提交视频生成任务失败')
    } finally {
      setLoading(false)
    }
  }

  // 编辑：把该条历史的参考图、提示词与全部参数回填到左侧方案
  // 左侧已有内容时先确认，避免误覆盖
  const applyRestore = (item: AIVideoTask) => {
    // 替换上传区图片前先释放旧的 blob 地址
    fileList.forEach((f) => {
      if (f.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(f.thumbUrl)
    })
    setFileList(
      (item.images || []).map((url, i) => ({
        uid: `history-${item.id}-${i}`,
        name: `参考图${i + 1}.jpg`,
        status: 'done' as const,
        url,
        thumbUrl: url,
      }))
    )
    setMarket(item.market)
    setModel(item.model)
    setResolution(item.resolution)
    setDuration(item.duration)
    setRatio(item.ratio)
    if (item.voiceover_language) {
      setVoiceoverLanguage(
        (item.voiceover_language === '自动' ? 'auto' : item.voiceover_language) as VoiceoverLanguage
      )
    }
    setPromptText(item.prompt)
    setActiveHistoryId(item.id)
    // 图片与参数已换，原方案失效，需重新生成
    setConceptsDirty(true)
    message.success('已填入该历史的参考图、提示词与参数')
  }

  const restoreHistory = (item: AIVideoTask) => {
    const hasExisting = fileList.length > 0 || promptText.trim().length > 0
    if (!hasExisting) {
      applyRestore(item)
      return
    }
    Modal.confirm({
      title: '覆盖当前内容？',
      content: '左侧已上传的参考图和已填写的提示词、参数将被该历史记录覆盖，确定继续吗？',
      okText: '覆盖',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => applyRestore(item),
    })
  }

  const removeHistory = async (id: number) => {
    setActiveHistoryId((prev) => (prev === id ? null : prev))
    setHistory((prev) => prev.filter((h) => h.id !== id))
    try {
      await aiCreationApi.deleteVideoTask(id)
    } catch {
      message.error('删除失败，请稍后重试')
    }
  }

  const handleClearHistory = async () => {
    const ids = history.map((h) => h.id)
    setHistory([])
    setActiveHistoryId(null)
    await Promise.allSettled(ids.map((id) => aiCreationApi.deleteVideoTask(id)))
  }

  // ===== 商品信息编辑（默认收起，展开后可改，保存后重新生成方案）=====
  const buildDetailsText = (p: AmazonProductAnalysisResult): string =>
    [
      `[卖点描述] ${(p.selling_points || []).join('；')}`,
      `[材质描述] ${(p.material || []).join('；')}`,
      `[使用方式] ${(p.usage_methods || []).join('；')}`,
      `[产品类目] ${p.amazon_category || ''}`,
    ].join('\n')

  // 解析多行描述：[标签]内容，按标签回填到对应字段
  const parseDetailsText = (text: string) => {
    const parsed = { selling_points: [] as string[], material: [] as string[], usage_methods: [] as string[], amazon_category: '' }
    text.split('\n').forEach((raw) => {
      const line = raw.trim()
      if (!line) return
      const matched = line.match(/^[[【](.+?)[\]】]\s*(.*)$/)
      const label = matched ? matched[1] : ''
      const content = matched ? matched[2] : line
      if (!content) return
      const items = content.split(/[；;]/).map((s) => s.trim()).filter(Boolean)
      if (label.includes('材质')) parsed.material.push(...items)
      else if (label.includes('使用')) parsed.usage_methods.push(...items)
      else if (label.includes('类目')) parsed.amazon_category = content
      else parsed.selling_points.push(...items)
    })
    return parsed
  }

  const startEditProduct = () => {
    if (!result) return
    setDraftProduct({
      product_name_cn: result.product_name_cn || result.product_name_en || '',
      product_size: result.product_size || '',
      target_audience: (result.target_audience || []).join('、'),
      details: buildDetailsText(result),
    })
    setProductDraftDirty(false)
    setProductInfoExpanded(true)
  }

  const cancelEditProduct = () => {
    setProductInfoExpanded(false)
    setDraftProduct(null)
    setProductDraftDirty(false)
  }

  const updateDraft = (patch: Partial<ProductDraft>) => {
    setDraftProduct((prev) => (prev ? { ...prev, ...patch } : prev))
    setProductDraftDirty(true)
  }

  // 保存编辑后的商品信息，并据此重新生成方案
  const handleSaveProductAndRefresh = async () => {
    if (!result || !draftProduct) return
    const parsed = parseDetailsText(draftProduct.details)
    const merged: AmazonProductAnalysisResult = {
      ...result,
      product_name_cn: draftProduct.product_name_cn,
      product_size: draftProduct.product_size,
      target_audience: draftProduct.target_audience.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean),
      selling_points: parsed.selling_points,
      material: parsed.material,
      usage_methods: parsed.usage_methods,
      amazon_category: parsed.amazon_category || result.amazon_category,
    }
    setResult(merged)
    // 已确认的商品信息（含人工补充的名称/尺寸/受众）一并交给 AI 直接采用
    const confirmedCard = [
      merged.product_name_cn ? `[产品名称] ${merged.product_name_cn}` : '',
      merged.product_size ? `[产品尺寸] ${merged.product_size}` : '',
      merged.target_audience?.length ? `[目标受众] ${merged.target_audience.join('、')}` : '',
      buildDetailsText(merged),
    ]
      .filter(Boolean)
      .join('\n')
    cancelEditProduct()
    await handleGeneratePlans(false, confirmedCard, merged)
  }

  // 从产品管理选择图片（只列成品，配件/耗材不作为视频参考图）
  const fetchProductOptions = async (page: number, keyword: string) => {
    setProductLoading(true)
    try {
      const res = await productsApi.getList({
        search: keyword || undefined,
        page,
        page_size: PRODUCT_PAGE_SIZE,
        product_type: 'finished',
      })
      if (res.data?.success && res.data?.data) {
        // 兼容两种返回结构：data 为数组 或 data 为 { items, total, page }
        const payload: any = res.data.data
        const items: any[] = Array.isArray(payload) ? payload : payload?.items || []
        const total = Array.isArray(payload) ? (res.data.total ?? items.length) : (payload?.total ?? 0)
        const curPage = Array.isArray(payload) ? (res.data.page ?? page) : (payload?.page ?? page)
        setProductOptions(
          items.map((p) => ({
            id: p.id,
            product_code: p.product_code || '',
            name: p.name || '',
            images: Array.from(
              new Set([...(p.images || []), ...(p.main_image ? [p.main_image] : [])])
            ).filter(Boolean) as string[],
          }))
        )
        setProductTotal(total)
        setProductPage(curPage)
      } else {
        message.error('获取产品列表失败')
      }
    } catch (err: any) {
      message.error(err.response?.data?.detail || '获取产品列表失败')
    } finally {
      setProductLoading(false)
    }
  }

  const openProductModal = () => {
    setSelectedImageUrls([])
    setProductSearchText('')
    setProductKeyword('')
    setProductModalOpen(true)
    fetchProductOptions(1, '')
  }

  const toggleProductImage = (url: string) => {
    setSelectedImageUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    )
  }

  const handleConfirmProductImages = () => {
    if (selectedImageUrls.length === 0) {
      message.warning('请先勾选产品图片')
      return
    }
        setFileList((prev) => {
      const existUrls = new Set(prev.map((f) => f.url || f.thumbUrl).filter(Boolean))
      const freshUrls = selectedImageUrls.filter((url) => !existUrls.has(url))
      const remain = MAX_IMAGES - prev.length
      if (freshUrls.length > remain) {
        message.warning(`最多上传 ${MAX_IMAGES} 张图片`)
      }
      const urls = freshUrls.slice(0, Math.max(0, remain))
      if (urls.length > 0) setConceptsDirty(true)
      const items: UploadFile[] = urls.map((url, i) => ({
        uid: `pm-${Date.now()}-${i}`,
        name: url.split('/').pop() || 'product-image',
        status: 'done',
        url,
        thumbUrl: url,
      }))
      return [...prev, ...items]
    })
    setSelectedImageUrls([])
    setProductModalOpen(false)
    message.success('已添加所选产品图片')
  }

  const renderProductModal = () => (
    <Modal
      title="从产品管理选择图片"
      open={productModalOpen}
      onCancel={() => setProductModalOpen(false)}
      width={860}
      footer={[
        <Button key="cancel" onClick={() => setProductModalOpen(false)}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          disabled={selectedImageUrls.length === 0}
          onClick={handleConfirmProductImages}
        >
          确认{selectedImageUrls.length > 0 ? `（已选 ${selectedImageUrls.length} 张）` : ''}
        </Button>,
      ]}
    >
      <Input.Search
        placeholder="搜索产品编码 / 品名 / SKU"
        allowClear
        enterButton
        value={productSearchText}
        onChange={(e) => setProductSearchText(e.target.value)}
        onSearch={(v) => {
          setProductKeyword(v)
          fetchProductOptions(1, v)
        }}
        style={{ marginBottom: 12 }}
      />
      {productLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin />
        </div>
      ) : productOptions.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到相关产品" />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '52vh', overflowY: 'auto' }}>
            {productOptions.map((p) => (
              <div key={p.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 13, flexShrink: 0 }}>{p.product_code}</Text>
                  <Text style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </Text>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {p.images.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>该产品暂无图片</Text>
                  ) : (
                    p.images.map((url) => {
                      const checked = selectedImageUrls.includes(url)
                      return (
                        <div
                          key={url}
                          onClick={() => toggleProductImage(url)}
                          style={{
                            position: 'relative',
                            width: 64,
                            height: 64,
                            cursor: 'pointer',
                            border: `2px solid ${checked ? currentTheme.primary : '#f0f0f0'}`,
                            borderRadius: 6,
                            overflow: 'hidden',
                          }}
                        >
                          <img alt="" src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {checked && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                right: 0,
                                width: 18,
                                height: 18,
                                background: currentTheme.primary,
                                color: '#fff',
                                fontSize: 11,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderBottomLeftRadius: 6,
                              }}
                            >
                              ✓
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              size="small"
              current={productPage}
              total={productTotal}
              pageSize={PRODUCT_PAGE_SIZE}
              onChange={(p) => fetchProductOptions(p, productKeyword)}
            />
          </div>
        </>
      )}
    </Modal>
  )

  // 分镜完整展示：全部镜头 + 画面内容 + 口播台词
  const renderStoryboard = (concept: VideoConcept) => {
    const numTexts = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四']
    return (
      <div>
        {concept.storyboard.map((shot, sidx) => {
          const desc =
            shot.description ||
            [
              shot.shot_type,
              shot.camera_movement,
              shot.character_action,
              shot.character_expression,
              shot.product_action,
              shot.product_position,
              shot.composition,
              shot.environment,
            ]
              .filter(Boolean)
              .join('，')
          const legacyFields = [
            shot.voiceover_cn ? `口播中文：${shot.voiceover_cn}` : '',
            shot.sound ? `音效：${shot.sound}` : '',
          ].filter(Boolean)
          return (
            <div key={sidx} style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.7 }}>
              <Text strong>
                {`[镜头${numTexts[sidx] || sidx + 1}]：${shot.timestamp}${shot.shot_purpose ? ` | ${shot.shot_purpose}` : ''}`}
              </Text>
              {desc && <div>[内容]：{desc}</div>}
              {shot.voiceover && <div>[口播]：{shot.voiceover}</div>}
              {legacyFields.map((line, i) => (
                <div key={i} style={{ color: 'rgba(0,0,0,0.45)' }}>{line}</div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  const renderConceptField = (label: string, content: React.ReactNode, color: string) => (
    <div style={{ marginBottom: 10 }}>
      <Tag color={color} style={{ marginBottom: 4 }}>{label}</Tag>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: 'rgba(0,0,0,0.85)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}
      >
        {content}
      </div>
    </div>
  )

  const renderRatioGrid = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {RATIO_OPTIONS.map((opt) => {
        const active = ratio === opt.value
        return (
          <div
            key={opt.value}
            onClick={() => !loading && setRatio(opt.value)}
            style={{
              border: `1px solid ${active ? currentTheme.primary : '#e8e8e8'}`,
              background: active ? currentTheme.selectedBg : '#fafafa',
              borderRadius: 8,
              padding: '8px 0 6px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <div style={{ height: 28, display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  width: opt.w,
                  height: opt.h,
                  border: `1.5px ${opt.dashed ? 'dashed' : 'solid'} ${active ? currentTheme.primary : '#bfbfbf'}`,
                  borderRadius: 3,
                }}
              />
            </div>
            <span style={{ fontSize: 12, marginTop: 2, color: active ? currentTheme.primary : '#666' }}>
              {opt.label}
            </span>
          </div>
        )
      })}
    </div>
  )

  const renderPlanModal = () => {
    return (
      <Modal
        title="商品信息"
        open={planModalOpen}
        onCancel={() => setPlanModalOpen(false)}
        footer={null}
        width={1200}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        {/* 商品信息：默认收起，展开后可编辑并刷新方案 */}
        {result && (
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
              }}
            >
              <Space size={[8, 8]} wrap style={{ minWidth: 0 }}>
                <Text strong style={{ fontSize: 15 }}>
                  {result.product_name_cn || result.product_name_en || '产品信息卡'}
                </Text>
                {(result.target_audience || []).slice(0, 2).map((t, i) => (
                  <Tag key={i} color="blue">{t}</Tag>
                ))}
                <Tag color="purple">{getMarketLabel(market)} · {resolveVoiceoverLanguageName()}口播</Tag>
                <Tag color="cyan">{getRatioLabel(ratio)}</Tag>
              </Space>
              <Button
                type="link"
                size="small"
                style={{ flexShrink: 0, color: currentTheme.primary, paddingInlineEnd: 0 }}
                icon={productInfoExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={productInfoExpanded ? cancelEditProduct : startEditProduct}
              >
                {productInfoExpanded ? '收起商品信息' : '展开商品信息'}
              </Button>
            </div>

            {productInfoExpanded && draftProduct && (
              <div style={{ borderTop: '1px solid #f0f0f0', padding: 16 }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>产品名称</div>
                    <Input
                      value={draftProduct.product_name_cn}
                      onChange={(e) => updateDraft({ product_name_cn: e.target.value })}
                      placeholder="请输入产品名称"
                    />
                  </Col>
                  <Col span={12}>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>产品尺寸</div>
                    <Input
                      value={draftProduct.product_size}
                      onChange={(e) => updateDraft({ product_size: e.target.value })}
                      placeholder="例如：30.5'D x 27'W x 30'H"
                    />
                  </Col>
                </Row>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>目标受众</div>
                  <Input
                    value={draftProduct.target_audience}
                    onChange={(e) => updateDraft({ target_audience: e.target.value })}
                    placeholder="多个受众用、分隔"
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>卖点描述</div>
                  <Input.TextArea
                    rows={5}
                    value={draftProduct.details}
                    onChange={(e) => updateDraft({ details: e.target.value })}
                    style={{ fontFamily: 'inherit' }}
                  />
                </div>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button onClick={cancelEditProduct}>取消</Button>
                  <Button
                    type="primary"
                    disabled={!productDraftDirty || loading}
                    onClick={handleSaveProductAndRefresh}
                  >
                    保存并刷新提示词方案
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text strong style={{ fontSize: 15 }}>推荐方案</Text>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            disabled={planRefreshLeft <= 0 || loading}
            onClick={() => handleGeneratePlans(true)}
          >
            换一换{planRefreshLeft > 0 ? `（剩 ${planRefreshLeft} 次）` : '（次数已用完）'}
          </Button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin tip={result ? '正在生成方案，请稍候...' : '正在识别商品信息并生成方案，请稍候...'} />
          </div>
        )}

        {!loading && concepts && (
          <Row gutter={16}>
            {concepts.map((concept, idx) => (
              <Col span={8} key={idx}>
                <Card
                  type="inner"
                  title={
                    <div>
                      <Text strong style={{ fontSize: 14 }}>方案{['一', '二', '三'][idx]}：{concept.concept_title}</Text>
                      <div style={{ marginTop: 6 }}>
                        <Tag color="orange">{concept.marketing_goal}</Tag>
                      </div>
                    </div>
                  }
                  bodyStyle={{ padding: 0 }}
                >
                  <div style={{ height: 460, display: 'flex', flexDirection: 'column' }}>
                    {/* 内容区独立滚动，按钮固定 */}
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 16 }}>
                      {renderConceptField('情节', concept.story, 'purple')}
                      {renderConceptField(
                        '模特',
                        [
                          concept.character,
                          concept.creative_strategy?.age,
                          concept.creative_strategy?.persona_identity,
                          concept.creative_strategy?.persona_role,
                        ]
                          .filter(Boolean)
                          .join('；'),
                        'cyan'
                      )}
                      {renderConceptField('环境', concept.environment, 'green')}
                      {renderConceptField('音乐', concept.music, 'orange')}
                      {renderConceptField('分镜', renderStoryboard(concept), 'geekblue')}
                    </div>

                    {/* 固定底部按钮：白色背景盖住滚动内容，浅色底 + 主题色边框 */}
                    <div
                      style={{
                        flexShrink: 0,
                        padding: 12,
                        background: '#fff',
                        borderTop: '1px solid #f0f0f0',
                        position: 'relative',
                        zIndex: 1,
                      }}
                    >
                      <Button
                        block
                        onClick={() => handleSelectPlan(idx)}
                        style={{
                          background: currentTheme.selectedBg,
                          borderColor: currentTheme.primary,
                          color: currentTheme.primary,
                        }}
                      >
                        选择此方案
                      </Button>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Modal>
    )
  }

  const renderHistoryCard = () => (
    <Card
      title={
        <Space>
          <HistoryOutlined />
          <span>生成历史</span>
        </Space>
      }
      extra={
        history.length > 0 ? (
          <Button type="text" size="small" icon={<ClearOutlined />} onClick={handleClearHistory}>
            清空
          </Button>
        ) : null
      }
      style={{ flex: 1, minWidth: 0 }}
      bodyStyle={{ padding: 16 }}
    >
      {history.length === 0 ? (
        tasksLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin />
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成历史" />
        )
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {history.map((item) => (
            <div
              key={item.id}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: hoverId === item.id ? '#f5f5f5' : 'transparent',
                border: `1px solid ${activeHistoryId === item.id ? currentTheme.primary : '#f0f0f0'}`,
                marginBottom: 6,
              }}
              onMouseEnter={() => setHoverId(item.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              {/* 第一行：左上角参考图缩略图 + 标题 + 编辑 + 更多 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {item.images.length > 0 && (
                  <Image.PreviewGroup>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {item.images.slice(0, 3).map((url, i) => (
                        <Image
                          key={`${item.id}-${i}`}
                          src={url}
                          width={32}
                          height={32}
                          style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
                          preview={{ mask: false }}
                        />
                      ))}
                      {item.images.length > 3 && (
                        <span style={{ fontSize: 12, color: '#999', alignSelf: 'center' }}>
                          +{item.images.length - 3}
                        </span>
                      )}
                    </div>
                  </Image.PreviewGroup>
                )}
                <Text strong ellipsis style={{ fontSize: 13, flex: '0 1 auto', minWidth: 0 }}>
                  {item.title}
                </Text>
                {/* 生成中：紧贴标题右侧转圈；已完成：紧贴标题右侧显示生成总耗时 */}
                {item.status === '排队中' || item.status === '生成中' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <Spin size="small" />
                    <Text type="secondary" style={{ fontSize: 12 }}>生成中</Text>
                  </span>
                ) : item.status === '已完成' && item.cost_seconds != null ? (
                  <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                    耗时 {item.cost_seconds} 秒
                  </Text>
                ) : null}
                <div style={{ flex: 1 }} />
                <Button icon={<FormOutlined />} onClick={() => restoreHistory(item)}>
                  编辑
                </Button>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'delete',
                        label: '删除记录',
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => removeHistory(item.id),
                      },
                    ],
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} />
                </Dropdown>
              </div>

              {/* 第二行：时间 + 参数 + 提示词摘要（30 字，悬停看全文） */}
              <div style={{ marginTop: 2 }}>
                <Tooltip
                  title={item.prompt}
                  overlayStyle={{ maxWidth: 560 }}
                  overlayInnerStyle={{
                    maxWidth: 560,
                    width: 560,
                    maxHeight: 420,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    lineHeight: 1.7,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.created_at} · {item.creator_name || '-'} · {getMarketLabel(item.market)} · {getModelLabel(item.model)} · {item.resolution} · {item.duration}秒 · {getRatioLabel(item.ratio)} · {truncatePrompt(item.prompt)}
                  </Text>
                </Tooltip>
              </div>

              {/* 成片小窗：悬停时循环播放，点击打开全屏弹窗 */}
              {item.video_url && (
                <video
                  src={item.video_url}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => {
                    e.currentTarget.play().catch(() => {})
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.pause()
                  }}
                  onClick={() => setPreviewTask(item)}
                  style={{
                    width: 220,
                    maxHeight: 200,
                    marginTop: 8,
                    background: '#000',
                    borderRadius: 6,
                    display: 'block',
                    cursor: 'pointer',
                    objectFit: 'cover',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  const renderSpeechTab = () => (
    <div style={{ display: 'flex', gap: 16, height: '100%', alignItems: 'stretch' }}>
      {/* 左侧：图片上传 + 参数 + 提示词（独立滚动），立即生成按钮固定在底部 */}
      <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 4 }}>
        <Card
          title={
            <Space>
              <PictureOutlined />
              <span>多视角白底商品&amp;实拍图</span>
            </Space>
          }
          extra={
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={fileList.length === 0 && !result}
            >
              清空
            </Button>
          }
        >
          {/* 上传区域：图片填充在区域内，数量多时区域自动撑高，悬停按钮固定在底部 */}
          {fileList.length < MAX_IMAGES ? (
            <div
              onMouseEnter={() => setUploadAreaHover(true)}
              onMouseLeave={() => setUploadAreaHover(false)}
              style={{
                border: `1px dashed ${uploadAreaHover ? currentTheme.primary : '#d9d9d9'}`,
                borderRadius: 8,
                background: '#fafafa',
                padding: '20px 16px 12px',
                textAlign: 'center',
              }}
            >
              {fileList.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      background: currentTheme.selectedBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <PictureOutlined style={{ fontSize: 22, color: currentTheme.primary }} />
                  </div>
                  <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>上传商品图片</div>
                </div>
              )}

              {fileList.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, textAlign: 'left' }}>
                  {fileList.map((f) => (
                    <div key={f.uid} style={{ position: 'relative', width: 80, height: 80 }}>
                      <img
                        alt={f.name}
                        src={f.thumbUrl || f.url}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                      />
                      <Button
                        danger
                        size="small"
                        shape="circle"
                        icon={<DeleteOutlined style={{ fontSize: 10 }} />}
                        style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, minWidth: 20 }}
                        onClick={() => handleRemoveImage(f.uid)}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* 固定高度按钮行：悬停时显示，点击区域本身不触发上传 */}
              <div style={{ height: 32, marginTop: 6, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {uploadAreaHover && (
                  <Space size={12}>
                    <Button
                      type="primary"
                      size="small"
                      icon={<UploadOutlined />}
                      onClick={() => localInputRef.current?.click()}
                    >
                      本地上传
                    </Button>
                    <Button size="small" icon={<AppstoreOutlined />} onClick={openProductModal}>
                      从产品管理选择
                    </Button>
                  </Space>
                )}
              </div>
            </div>
          ) : (
            <div
              onMouseEnter={() => setUploadAreaHover(true)}
              onMouseLeave={() => setUploadAreaHover(false)}
              style={{
                border: '1px dashed #d9d9d9',
                borderRadius: 8,
                background: '#fafafa',
                padding: '20px 16px 12px',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {fileList.map((f) => (
                  <div key={f.uid} style={{ position: 'relative', width: 80, height: 80 }}>
                    <img
                      alt={f.name}
                      src={f.thumbUrl || f.url}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                    />
                    <Button
                      danger
                      size="small"
                      shape="circle"
                      icon={<DeleteOutlined style={{ fontSize: 10 }} />}
                      style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, minWidth: 20 }}
                      onClick={() => handleRemoveImage(f.uid)}
                    />
                  </div>
                ))}
              </div>
              {uploadAreaHover && (
                <div style={{ marginTop: 8, textAlign: 'center', color: '#999', fontSize: 12 }}>
                  已达 {MAX_IMAGES} 张上限
                </div>
              )}
            </div>
          )}

          <input
            ref={localInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleLocalFileSelect}
          />

          <Divider style={{ margin: '12px 0' }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            已上传 {fileList.length}/{MAX_IMAGES}
          </Text>
        </Card>

        <Card
          title={
            <Space>
              <VideoCameraOutlined />
              <span>视频提示词</span>
            </Space>
          }
          style={{ marginTop: 16 }}
          bodyStyle={{ padding: 16 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <Text strong style={{ flexShrink: 0 }}>目标市场：</Text>
            <Select<VideoMarket>
              value={market}
              onChange={setMarket}
              style={{ flex: 1, minWidth: 0 }}
              disabled={loading}
              options={MARKET_OPTIONS}
              showSearch
              optionFilterProp="label"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <Text strong style={{ flexShrink: 0 }}>口播语言：</Text>
            <Select<VoiceoverLanguage>
              value={voiceoverLanguage}
              onChange={setVoiceoverLanguage}
              style={{ flex: 1, minWidth: 0 }}
              disabled={loading}
              options={VOICEOVER_LANGUAGE_OPTIONS}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <TextArea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={11}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder={'点击右下角"生成方案"，AI 将自动识别商品信息并生成 3 套视频方案，选择一套后自动填入；也可直接在此编辑提示词'}
              style={{ fontFamily: 'monospace', fontSize: 13, paddingBottom: 44, resize: 'none' }}
            />
            <Button
              type="primary"
              size="small"
              icon={<BulbOutlined />}
              onClick={() => {
                // 参考图有删改或无结果时重新生成；结果未变时直接回看，不重复调用 AI
                if (concepts && concepts.length > 0 && !conceptsDirty) {
                  setProductInfoExpanded(false)
                  setDraftProduct(null)
                  setProductDraftDirty(false)
                  setPlanModalOpen(true)
                } else {
                  handleGeneratePlans(false)
                }
              }}
              loading={loading}
              style={{ position: 'absolute', right: 12, bottom: 10 }}
            >
              {concepts && !conceptsDirty ? '查看方案' : '生成方案'}
            </Button>
          </div>

          <Divider style={{ margin: '16px 0 12px' }} />

          <Text strong style={{ display: 'block', marginBottom: 8 }}>视频模型</Text>
          <Select<VideoModel>
            value={model}
            onChange={setModel}
            style={{ width: '100%' }}
            disabled={loading}
            options={MODEL_OPTIONS.map((opt) => ({
              value: opt.value,
              label: (
                <span>
                  {opt.label}
                  <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>{opt.desc}</span>
                </span>
              ),
            }))}
          />

          <Text strong style={{ display: 'block', margin: '16px 0 8px' }}>视频分辨率</Text>
          <Segmented
            block
            value={resolution}
            onChange={(v) => setResolution(v as VideoResolution)}
            disabled={loading}
            options={RESOLUTION_OPTIONS.map((opt) => ({
              value: opt.value,
              label: (
                <Tooltip title={opt.desc}>
                  <span>{opt.label}</span>
                </Tooltip>
              ),
            }))}
          />

          <Text strong style={{ display: 'block', margin: '16px 0 4px' }}>生成设置</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>视频时长（5 / 10 / 15 秒）</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Slider
              min={5}
              max={15}
              step={null}
              value={duration}
              onChange={(v: number) => {
                if (v !== duration) {
                  setDuration(v as VideoDuration)
                  // 时长影响分镜结构，改后方案需重新生成
                  setConceptsDirty(true)
                }
              }}
              disabled={loading}
              marks={DURATION_MARKS}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Text strong style={{ flexShrink: 0, width: 48, textAlign: 'right' }}>
              {duration}秒
            </Text>
          </div>

          <Text type="secondary" style={{ display: 'block', fontSize: 12, margin: '12px 0 8px' }}>
            视频比例
          </Text>
          {renderRatioGrid()}
        </Card>
        </div>

        {/* 固定在左栏底部的立即生成按钮（不随左侧滚动） */}
        <div style={{ flexShrink: 0, paddingTop: 12, background: '#fff' }}>
          <Button
            type="primary"
            block
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={handleGenerateVideo}
            disabled={loading}
          >
            立即生成
          </Button>
        </div>
      </div>

      {/* 右侧：生成历史 + 参考图片（独立滚动） */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {renderHistoryCard()}
      </div>

      {renderPlanModal()}
      {renderProductModal()}

      {/* 成片全屏预览：左侧视频，右侧参数 */}
      <Modal
        open={!!previewTask}
        onCancel={() => setPreviewTask(null)}
        footer={null}
        width="90vw"
        centered
        destroyOnClose
        styles={{ body: { padding: 0 } }}
        title={previewTask?.title}
      >
        {previewTask && (
          <div style={{ display: 'flex', height: '78vh' }}>
            {/* 左侧：视频播放区 */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {previewTask.video_url && (
                <video
                  src={previewTask.video_url}
                  controls
                  autoPlay
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )}
            </div>
            {/* 右侧：参数面板 */}
            <div
              style={{
                width: 320,
                flexShrink: 0,
                overflowY: 'auto',
                padding: '20px 24px',
                borderLeft: '1px solid #f0f0f0',
                background: '#fff',
              }}
            >
              {[
                { label: '任务ID：', value: previewTask.h3_prompt_id || '-' },
                { label: '生成状态：', value: previewTask.status },
                { label: '生成者：', value: previewTask.creator_name || '-' },
                { label: '视频模型：', value: getModelLabel(previewTask.model) },
                { label: '视频分辨率：', value: previewTask.resolution },
                { label: '视频长度：', value: `${previewTask.duration} 秒` },
                { label: '视频比例：', value: getRatioLabel(previewTask.ratio) },
                { label: '销售国家/地区：', value: getMarketLabel(previewTask.market) },
                { label: '目标语言：', value: getVoiceoverLabel(previewTask) },
              ].map((row) => (
                <div key={row.label} style={{ marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 13, display: 'block' }}>{row.label}</Text>
                  <Text style={{ fontSize: 13, wordBreak: 'break-all' }}>{row.value}</Text>
                </div>
              ))}

              {/* 原始参考图 */}
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ fontSize: 13, display: 'block' }}>原始参考图：</Text>
                {previewTask.images.length > 0 ? (
                  <Image.PreviewGroup>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {previewTask.images.map((url, i) => (
                        <Image
                          key={`preview-${previewTask.id}-${i}`}
                          src={url}
                          width={40}
                          height={40}
                          style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
                          preview={{ mask: false }}
                        />
                      ))}
                    </div>
                  </Image.PreviewGroup>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
                )}
              </div>

              {/* 提示词描述 */}
              <div>
                <Text strong style={{ fontSize: 13, display: 'block' }}>提示词描述：</Text>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: '30vh',
                    overflowY: 'auto',
                  }}
                >
                  {previewTask.prompt || '-'}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )

  return (
    <div style={{ height: '100%', overflow: 'hidden', padding: 24, boxSizing: 'border-box' }}>
      <Tabs
        className="ai-creation-tabs"
        defaultActiveKey="speech"
        items={[
          {
            key: 'speech',
            label: '口播带货',
            children: renderSpeechTab(),
          },
          {
            key: 'image-to-video',
            label: '图转视频',
            children: (
              <Card styles={{ body: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 480 } }}>
                <Empty description="图转视频功能开发中，敬请期待" />
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}

export default AICreationCenter