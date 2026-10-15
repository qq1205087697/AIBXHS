import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Card,
  Button,
  Tag,
  Typography,
  Space,
  message,
  Empty,
  Select,
  Row,
  Col,
  Input,
  InputNumber,
  Tooltip,
  Image,
  Popconfirm,
  Spin,
  Badge,
  Upload,
  Radio,
  Pagination,
  Checkbox,
  Switch,
} from 'antd'
import {
  UploadOutlined,
  PictureOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  BulbOutlined,
  SearchOutlined,
  CopyOutlined,
  MinusOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload'
import {
  aiImageApi,
  aiCreationApi,
  AIImageTask,
  AIImageResultItem,
  AmazonProductAnalysisResult,
} from '../api'

const { Text } = Typography
const { TextArea } = Input

const MAX_IMAGES = 5

/** A+ 类型（单选） */
const APLUS_OPTIONS = [
  { value: 'aplus_advanced', label: '高级A+', size: '1464×600', desc: '超宽幅品牌横幅，A+ 页面顶部大图' },
  { value: 'aplus_normal', label: '普通A+', size: '970×600', desc: '标准 A+ 页面横幅' },
  { value: 'aplus_mobile', label: '手机A+', size: '600×450', desc: '移动端 A+ 图，小屏浏览' },
] as const

/** 主副图类型（多选） */
const MAIN_TYPE_LABELS: Record<string, string> = {
  selling_point: '卖点图',
  white_background: '白底图',
  scene: '场景图',
  closeup: '特写图',
  closeup_white: '特写白底图',
}
const MAIN_TYPE_DESCRIPTIONS: Record<string, string> = {
  selling_point: '商品置于卖点匹配的场景，配文字排版展示卖点',
  white_background: '商品精修后放置于纯白色背景',
  scene: '商品置于卖点匹配的使用场景中',
  closeup: '与卖点匹配的局部特写细节',
  closeup_white: '白底局部特写细节',
}

/** 兼容 v1 旧记录的类型标签 */
const LEGACY_TYPE_LABELS: Record<string, string> = {
  ...MAIN_TYPE_LABELS,
  aplus: 'A+图',
}

const STATUS_COLORS: Record<string, string> = {
  排队中: 'default',
  生成中: 'processing',
  已完成: 'success',
  部分完成: 'warning',
  失败: 'error',
}

const BRAND_DEFAULTS = {
  country: 'US 美国',
  language: '英语',
  platform: '亚马逊',
}

type BrandSettings = typeof BRAND_DEFAULTS

/** AI 分析结构化结果 → 商品信息文本（供提示词模板拼接） */
const analysisToText = (r: AmazonProductAnalysisResult): string =>
  [
    `品名：${r.product_name_cn || r.product_name_en || ''}`,
    r.product_type ? `类型：${r.product_type}` : '',
    r.material?.length ? `材质：${r.material.join('、')}` : '',
    r.colors?.length ? `颜色：${r.colors.join('、')}` : '',
    r.selling_points?.length ? `核心卖点：${r.selling_points.join('；')}` : '',
    r.usage_scenarios?.length ? `使用场景：${r.usage_scenarios.join('、')}` : '',
    r.target_audience?.length ? `目标人群：${r.target_audience.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

const formatCost = (sec: number | null): string => {
  if (!sec) return '-'
  if (sec < 60) return `${sec}秒`
  return `${Math.floor(sec / 60)}分${sec % 60}秒`
}

const AIImageStudio: React.FC = () => {
  // ===== 左栏表单状态 =====
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [productInfo, setProductInfo] = useState('')
  // v2 分组：A+（单选，空=不生成）与主副图（多选）独立设置
  const [aplusType, setAplusType] = useState<string>('')
  const [aplusCount, setAplusCount] = useState(1)
  const [mainEnabled, setMainEnabled] = useState(true)
  const [selectedMainTypes, setSelectedMainTypes] = useState<string[]>([
    'white_background',
    'scene',
  ])
  const [mainCounts, setMainCounts] = useState<Record<string, number>>({
    white_background: 1,
    scene: 1,
  })
  const [mainAspectRatio, setMainAspectRatio] = useState('1:1')
  const [brand, setBrand] = useState<BrandSettings>({ ...BRAND_DEFAULTS })
  const [extraPrompt, setExtraPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ===== 右栏生成记录状态 =====
  const [tasks, setTasks] = useState<AIImageTask[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pageSize = 10

  const fetchTasks = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const { data } = await aiImageApi.listTasks(page, pageSize, keyword)
        setTasks(data.items || [])
        setTotal(data.total || 0)
      } catch (e: any) {
        if (!silent) message.error(e?.response?.data?.detail || '获取任务列表失败')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page, keyword],
  )

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // 有进行中任务时 5 秒轮询
  useEffect(() => {
    const active = tasks.filter(
      (t) =>
        (t.status === '排队中' || t.status === '生成中') &&
        (!statusFilter || t.status === statusFilter),
    )
    if (active.length && !timerRef.current) {
      timerRef.current = setInterval(() => fetchTasks(true), 5000)
    } else if (!active.length && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [tasks, fetchTasks, statusFilter])

  // ===== AI 分析商品信息 =====
  const handleAnalyze = async () => {
    const files = fileList.map((f) => f.originFileObj).filter(Boolean) as File[]
    if (!files.length) {
      message.warning('请先上传参考图')
      return
    }
    setAnalyzing(true)
    try {
      const { data } = await aiCreationApi.analyzeProduct(files)
      if (data?.success && data.data) {
        setProductInfo(analysisToText(data.data))
        message.success('AI 分析完成，商品信息已填充')
      } else {
        message.error('AI 分析未返回结果')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'AI 分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  // ===== 提交生成任务（v2 分组参数）=====
  const handleSubmit = async () => {
    const files = fileList.map((f) => f.originFileObj).filter(Boolean) as File[]
    if (!files.length) {
      message.warning('请至少上传一张参考图')
      return
    }
    const activeMainTypes = mainEnabled ? selectedMainTypes : []
    if (!aplusType && !activeMainTypes.length) {
      message.warning('请在「A+图设置」或「主副图设置」中至少选择一种类型')
      return
    }
    setSubmitting(true)
    try {
      const firstFile = files[0]
      const baseName = firstFile.name.replace(/\.[^.]+$/, '')
      await aiImageApi.createTask(files, {
        title: baseName,
        aplus_type: aplusType || undefined,
        main_types: activeMainTypes.length
          ? Object.fromEntries(activeMainTypes.map((t) => [t, mainCounts[t] || 1]))
          : undefined,
        main_aspect_ratio: activeMainTypes.length ? mainAspectRatio : undefined,
        image_count: aplusType ? aplusCount : 1,
        product_info: productInfo,
        prompt: extraPrompt,
        brand_settings: {
          ...Object.fromEntries(
            Object.entries(brand).filter(([, v]) => v !== ''),
          ),
        },
      })
      message.success('任务已提交，正在后台生成')
      setFileList([])
      setPage(1)
      fetchTasks()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '提交任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (taskId: number) => {
    try {
      await aiImageApi.deleteTask(taskId)
      message.success('已删除')
      fetchTasks(true)
    } catch {
      message.error('删除失败')
    }
  }

  /** 一键做同款：把历史任务的参数回填到左侧表单 */
  const handleReuse = (task: AIImageTask) => {
    if (task.aplus_type) setAplusType(task.aplus_type)
    else setAplusType('')
    setAplusCount(task.image_count || 1)
    if (Array.isArray(task.main_types)) {
      setSelectedMainTypes(task.main_types)
      setMainCounts((m) => {
        const next = { ...m }
        for (const t of task.main_types!) if (next[t] == null) next[t] = 1
        return next
      })
    } else if (task.main_types && typeof task.main_types === 'object') {
      const keys = Object.keys(task.main_types)
      setSelectedMainTypes(keys)
      setMainCounts((m) => {
        const next = { ...m }
        for (const [t, c] of Object.entries(Object(task.main_types) as Record<string, number>))
          next[t] = c
        return next
      })
    }
    else if (!task.aplus_type) {
      // v1 旧记录：从 generation_types 里取主副图类型
      const legacy = (task.generation_types || []).filter((t) => MAIN_TYPE_LABELS[t])
      setSelectedMainTypes(legacy.length ? legacy : ['white_background', 'scene'])
    }
    setMainAspectRatio(task.main_aspect_ratio || task.aspect_ratio || '1:1')
    if (task.brand_settings) setBrand({ ...BRAND_DEFAULTS, ...task.brand_settings })
    setProductInfo(task.product_info || '')
    setExtraPrompt(task.prompt || '')
    message.success('参数已回填到左侧表单（参考图需重新上传）')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDownload = async (url: string, name: string) => {
    try {
      const { data } = await aiCreationApi.proxyImage(url)
      const blobUrl = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
  }


  // ===== 渲染：结果图（大图预览画廊）=====
  const renderResultItem = (item: AIImageResultItem, task: AIImageTask) => {
    const name = `${task.title || '套图'}-${item.label}${item.seq > 0 ? `-${item.seq + 1}` : ''}`
    if (item.status === '已完成' && item.url) {
      return (
        <div key={`${item.type}-${item.seq}`} style={{ position: 'relative' }}>
          <Image
            src={item.url}
            alt={name}
            style={{ borderRadius: 6, objectFit: 'cover', width: '100%', maxHeight: 220 }}
          />
          <Space style={{ position: 'absolute', top: 6, right: 6 }} size={4}>
            <Tooltip title="下载">
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => handleDownload(item.url!, `${name}.png`)}
              />
            </Tooltip>
          </Space>
          <Text style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            {item.label}
            {item.seq > 0 ? ` #${item.seq + 1}` : ''}
          </Text>
        </div>
      )
    }
    if (item.status === '失败') {
      return (
        <div
          key={`${item.type}-${item.seq}`}
          style={{
            border: '1px dashed #ffccc7',
            borderRadius: 6,
            padding: 16,
            textAlign: 'center',
            background: '#fff1f0',
            minHeight: 120,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <Tag color="error">失败</Tag>
          <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
            {item.error || '生成失败'}
          </Text>
        </div>
      )
    }
    return (
      <div
        key={`${item.type}-${item.seq}`}
        style={{
          border: '1px dashed #d9d9d9',
          borderRadius: 6,
          padding: 16,
          textAlign: 'center',
          minHeight: 120,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Spin size="small" />
        <Tag color={item.status === '生成中' ? 'processing' : 'default'}>
          {item.label}
          {item.seq > 0 ? ` #${item.seq + 1}` : ''} · {item.status}
        </Tag>
      </div>
    )
  }

  /** 历史卡片的类型标签（v2 分组 + v1 兼容） */
  const renderTypeTags = (task: AIImageTask) => {
    const tags: string[] = []
    if (task.aplus_type) {
      const a = APLUS_OPTIONS.find((o) => o.value === task.aplus_type)
      tags.push(a ? a.label : task.aplus_type)
    }
    if (Array.isArray(task.main_types) && task.main_types.length) {
      tags.push(...task.main_types.map((t) => MAIN_TYPE_LABELS[t] || t))
    } else if (task.main_types && typeof task.main_types === 'object') {
      tags.push(
        ...Object.keys(task.main_types).map((t) => MAIN_TYPE_LABELS[t] || t),
      )
    }
    if (!tags.length) {
      tags.push(...(task.generation_types || []).map((t) => LEGACY_TYPE_LABELS[t] || t))
    }
    return tags.map((t) => <Tag key={t}>{t}</Tag>)
  }

  /** 历史卡片的品牌设置摘要 */
  const renderBrandSummary = (task: AIImageTask): React.ReactNode => {
    const bs = task.brand_settings
    if (!bs) return null
    const nodes: React.ReactNode[] = []
    if (bs.main_color) {
      nodes.push(
        <Space size={4} key="color">
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: bs.main_color, border: '1px solid #d9d9d9' }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{bs.main_color}</Text>
        </Space>,
      )
    }
    if (bs.font_style && bs.font_style !== '智能字体风格') {
      nodes.push(<Tag key="font" style={{ fontSize: 12 }}>字体：{bs.font_style}</Tag>)
    }
    if (bs.country) nodes.push(<Tag key="country" style={{ fontSize: 12 }}>{bs.country}</Tag>)
    if (bs.language) nodes.push(<Tag key="lang" style={{ fontSize: 12 }}>{bs.language}</Tag>)
    if (bs.platform) nodes.push(<Tag key="platform" style={{ fontSize: 12 }}>{bs.platform}</Tag>)
    if (bs.custom_text) {
      nodes.push(
        <Tooltip key="custom" title={bs.custom_text}>
          <Tag style={{ fontSize: 12 }}>自定义…</Tag>
        </Tooltip>,
      )
    }
    return nodes.length ? <Space wrap size={4}>{nodes}</Space> : null
  }

  return (
    <>
    <style>
      {`
        /* 生成按钮固定在左栏滚动区底部：按钮是 Space 最后一个 child，
           antd 会包一层 .ant-space-item（高度收缩，sticky 直接写在按钮上无效），
           故对最后一个 item wrapper 设 sticky；底衬渐变避免按钮透字。 */
        .aiimg-form-space > .ant-space-item:last-child {
          position: sticky;
          bottom: 0;
          z-index: 2;
        }
        .aiimg-form-space > .ant-space-item:last-child > .ant-space-item {
          background: linear-gradient(to top, #fff 70%, rgba(255, 255, 255, 0));
          padding-top: 6px;
        }
      `}
    </style>
    <div style={{ height: '100%', overflow: 'hidden', padding: 24, boxSizing: 'border-box' }}>
      <Row gutter={16} style={{ height: '100%', alignItems: 'stretch' }}>
        {/* 左栏：生成表单（栏内独立滚动，AICreationCenter 同模式） */}
        <Col xs={24} lg={9} style={{ height: '100%', flex: '0 0 400px', maxWidth: '100%' }}>
          <Card
            title={
              <Space>
                <PictureOutlined />
                <span>商品套图生成</span>
              </Space>
            }
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
          >
            <Space direction="vertical" className="aiimg-form-space" style={{ width: '100%' }} size={14}>
              <div>
                <Text strong>参考图（1~{MAX_IMAGES} 张，首张为主参考）</Text>
                <Upload.Dragger
                  multiple
                  accept="image/*"
                  maxCount={MAX_IMAGES}
                  fileList={fileList}
                  showUploadList={false}
                  beforeUpload={() => false}
                  onChange={({ fileList: fl }) => setFileList(fl.slice(-MAX_IMAGES))}
                  style={{ marginTop: 8 }}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined />
                  </p>
                  <p className="ant-upload-text">点击或拖拽上传商品参考图</p>
                  <p className="ant-upload-hint">JPEG/PNG/WebP，单张 ≤ 10M</p>
                </Upload.Dragger>
                {fileList.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
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
                          onClick={() =>
                            setFileList((prev) => prev.filter((x) => x.uid !== f.uid))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Space>
                  <Text strong>商品信息</Text>
                  <Button
                    size="small"
                    icon={<BulbOutlined />}
                    loading={analyzing}
                    onClick={handleAnalyze}
                  >
                    AI 分析
                  </Button>
                </Space>
                <TextArea
                  rows={4}
                  maxLength={2500}
                  showCount
                  value={productInfo}
                  onChange={(e) => setProductInfo(e.target.value)}
                  placeholder="填写商品卖点、材质、适用场景等；或点击「AI 分析」从参考图自动提取"
                  style={{ marginTop: 8 }}
                />
              </div>

              <Row gutter={12}>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>销售国家/地区</Text>
                  <Select
                    style={{ width: '100%', marginTop: 4 }}
                    size="small"
                    value={brand.country}
                    onChange={(v) => setBrand((b) => ({ ...b, country: v }))}
                    showSearch
                    options={[
                      'US 美国', 'CA 加拿大', 'UK 英国', 'DE 德国', 'FR 法国',
                      'IT 意大利', 'ES 西班牙', 'JP 日本', 'AU 澳大利亚',
                    ].map((s) => ({ value: s, label: s }))}
                  />
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>生成图片语言</Text>
                  <Select
                    style={{ width: '100%', marginTop: 4 }}
                    size="small"
                    value={brand.language}
                    onChange={(v) => setBrand((b) => ({ ...b, language: v }))}
                    showSearch
                    options={['英语', '德语', '法语', '意大利语', '西班牙语', '日语'].map(
                      (s) => ({ value: s, label: s }),
                    )}
                  />
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>发布平台</Text>
                  <Select
                    style={{ width: '100%', marginTop: 4 }}
                    size="small"
                    value={brand.platform}
                    onChange={(v) => setBrand((b) => ({ ...b, platform: v }))}
                    options={['亚马逊', 'eBay', '独立站', 'Temu', 'Shein'].map(
                      (s) => ({ value: s, label: s }),
                    )}
                  />
                </Col>
              </Row>

              {/* ===== A+图设置（单选） ===== */}
              <Card
                size="small"
                type="inner"
                title="A+图设置"
                extra={
                  <Radio.Group
                    size="small"
                    value={aplusType || 'none'}
                    onChange={(e) => setAplusType(e.target.value === 'none' ? '' : e.target.value)}
                  >
                    <Radio.Button value="none">不生成</Radio.Button>
                  </Radio.Group>
                }
              >
                <Radio.Group
                  value={aplusType}
                  onChange={(e) => setAplusType(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <Space direction="vertical" style={{ width: '100%' }} size={6}>
                    {APLUS_OPTIONS.map((o) => (
                      <Radio key={o.value} value={o.value} style={{ width: '100%' }}>
                        <Space size={6}>
                          <Text strong={aplusType === o.value}>{o.label}</Text>
                          <Tag style={{ fontSize: 12 }}>{o.size}</Tag>
                        </Space>
                        <div style={{ paddingLeft: 24 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>{o.desc}</Text>
                        </div>
                      </Radio>
                    ))}
                  </Space>
                </Radio.Group>
                {aplusType && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>生成张数</Text>
                    <InputNumber
                      min={1}
                      max={4}
                      value={aplusCount}
                      onChange={(v) => setAplusCount(v || 1)}
                      style={{ width: '100%', marginTop: 4 }}
                    />
                  </div>
                )}
              </Card>

              {/* ===== 主副图设置（开关 + 行式勾选 + 每类型独立张数 + 比例按钮组） ===== */}
              <Card
                size="small"
                type="inner"
                title={
                  <Space>
                    <span>主副图设置</span>
                    <Tooltip title="不生成主副图时可关闭此区块">
                      <Switch
                        size="small"
                        checked={mainEnabled}
                        onChange={(v) => setMainEnabled(v)}
                      />
                    </Tooltip>
                  </Space>
                }
              >
                {mainEnabled && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>生成类型（多选）</Text>
                    <div style={{ marginTop: 8 }}>
                      {Object.entries(MAIN_TYPE_LABELS).map(([key, label]) => {
                        const checked = selectedMainTypes.includes(key)
                        return (
                          <div key={key} style={{ marginBottom: 4 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 10px',
                                borderRadius: 6,
                                background: checked ? '#f6f0ff' : 'transparent',
                                border: checked ? '1px solid #d3adf7' : '1px solid transparent',
                                cursor: 'pointer',
                              }}
                              onClick={() =>
                                setSelectedMainTypes((prev) =>
                                  checked ? prev.filter((t) => t !== key) : [...prev, key],
                                )
                              }
                            >
                              <Space size={8}>
                                <Checkbox checked={checked} />
                                <Tooltip title={MAIN_TYPE_DESCRIPTIONS[key]}>
                                  <Text strong={checked}>{label}</Text>
                                </Tooltip>
                              </Space>
                              {checked && (
                                <Space size={2} onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<MinusOutlined />}
                                    disabled={(mainCounts[key] || 1) <= 1}
                                    onClick={() =>
                                      setMainCounts((m) => ({
                                        ...m,
                                        [key]: Math.max(1, (m[key] || 1) - 1),
                                      }))
                                    }
                                  />
                                  <Text strong style={{ minWidth: 18, textAlign: 'center' }}>
                                    {mainCounts[key] || 1}
                                  </Text>
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<PlusOutlined />}
                                    disabled={(mainCounts[key] || 1) >= 4}
                                    onClick={() =>
                                      setMainCounts((m) => ({
                                        ...m,
                                        [key]: Math.min(4, (m[key] || 1) + 1),
                                      }))
                                    }
                                  />
                                </Space>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>生成比例</Text>
                      <Select
                        style={{ width: '100%', marginTop: 6 }}
                        value={mainAspectRatio}
                        onChange={setMainAspectRatio}
                        size="small"
                        options={[
                          { value: '1:1', label: '1:1（方形）' },
                          { value: '2:3', label: '2:3（竖版照片）' },
                          { value: '3:2', label: '3:2（横版照片）' },
                          { value: '3:4', label: '3:4（竖版标准）' },
                          { value: '4:3', label: '4:3（横版标准）' },
                          { value: '9:16', label: '9:16（全屏竖版）' },
                          { value: '16:9', label: '16:9（全屏横版）' },
                          { value: '21:9', label: '21:9（超宽）' },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </Card>

              <div>
                <Text strong>附加要求（可选）</Text>
                <TextArea
                  rows={2}
                  maxLength={500}
                  value={extraPrompt}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                  placeholder="如：圣诞居家主题场景、杯身朝向镜头等"
                  style={{ marginTop: 8 }}
                />
              </div>

              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={submitting}
                onClick={handleSubmit}
                block
                size="large"
                style={{
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 2,
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
                }}
              >
                立即生成（
                {[
                  aplusType && `A+×${aplusCount}`,
                  mainEnabled &&
                    selectedMainTypes.length &&
                    `主副图×${selectedMainTypes.reduce((a, t) => a + (mainCounts[t] || 1), 0)}`,
                ]
                  .filter(Boolean)
                  .join(' + ') || '未选择类型'}
                ）
              </Button>
            </Space>
          </Card>
        </Col>

        {/* 右栏：生成记录 */}
        <Col xs={24} lg={15} style={{ height: '100%', flex: 1, minWidth: 0 }}>
          <Card
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
            title={
              <Space>
                <span>生成记录</span>
                {total > 0 && <Text type="secondary">共 {total} 条</Text>}
              </Space>
            }
            extra={
              <Space>
                <Input
                  size="small"
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索产品名 / 编码"
                  style={{ width: 180 }}
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value)
                    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                    searchTimerRef.current = setTimeout(() => {
                      setPage(1)
                      fetchTasks(true)
                    }, 300)
                  }}
                />
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={statusFilter || 'all'}
                  onChange={(v) => {
                    setStatusFilter(v === 'all' ? '' : v)
                    setPage(1)
                  }}
                  options={[
                    { value: 'all', label: '全部状态' },
                    ...Object.keys(STATUS_COLORS).map((s) => ({ value: s, label: s })),
                  ]}
                />
                <Button icon={<ReloadOutlined />} onClick={() => fetchTasks()} size="small" />
              </Space>
            }
          >
            {loading && !tasks.length ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <Spin />
              </div>
            ) : !tasks.length ? (
              <Empty description="暂无生成记录，先在左侧提交一个任务吧" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                {tasks
                  .filter((t) => !statusFilter || t.status === statusFilter)
                  .map((task) => (
                    <Card
                      key={task.id}
                      size="small"
                      title={
                        <Space wrap>
                          <Badge
                            status={
                              task.status === '已完成'
                                ? 'success'
                                : task.status === '失败'
                                  ? 'error'
                                  : task.status === '部分完成'
                                    ? 'warning'
                                    : 'processing'
                            }
                            text={<Text strong>{task.title || `任务 #${task.id}`}</Text>}
                          />
                          <Tag color={STATUS_COLORS[task.status] || 'default'}>
                            {task.status}
                          </Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {task.aplus_type || task.main_types?.length
                              ? ''
                              : `${task.aspect_ratio} · `}
                            {task.image_count}/类 · {task.created_at}
                            {task.creator_name ? ` · ${task.creator_name}` : ''}
                          </Text>
                        </Space>
                      }
                      extra={
                        <Space>
                          <Tooltip title="一键做同款：参数回填到左侧表单">
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => handleReuse(task)}
                            >
                              做同款
                            </Button>
                          </Tooltip>
                          <Popconfirm
                            title="确定删除该记录？"
                            onConfirm={() => handleDelete(task.id)}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      }
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <Space wrap size={4}>
                          {renderTypeTags(task)}
                          {(task.aplus_type || task.main_types?.length) && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {task.main_aspect_ratio || task.aspect_ratio} · {task.image_count}/类
                            </Text>
                          )}
                          {task.cost_seconds != null && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              耗时 {formatCost(task.cost_seconds)}
                            </Text>
                          )}
                        </Space>
                        {renderBrandSummary(task)}
                        {task.error_message && (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {task.error_message}
                          </Text>
                        )}
                        {task.product_info && (
                          <Tooltip title={task.product_info}>
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, display: 'block' }}
                              ellipsis={{ tooltip: task.product_info }}
                            >
                              商品信息：{task.product_info}
                            </Text>
                          </Tooltip>
                        )}
                        <Image.PreviewGroup>
                          <Row gutter={[12, 12]}>
                            {(task.result_images || []).map((item) =>
                              renderResultItem(item, task),
                            )}
                          </Row>
                        </Image.PreviewGroup>
                      </Space>
                    </Card>
                  ))}
              </Space>
            )}
            {total > pageSize && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={total}
                  onChange={(p: number) => setPage(p)}
                  showSizeChanger={false}
                />
              </div>
            )}
          </Card>
        </Col>
      </Row>

    </div>
    </>
  )
}

export default AIImageStudio
