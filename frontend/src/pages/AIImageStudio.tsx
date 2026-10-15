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
} from 'antd'
import {
  UploadOutlined,
  PictureOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  DownloadOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload'
import {
  aiImageApi,
  aiCreationApi,
  AIImageTask,
  AIImageResultItem,
  AmazonProductAnalysisResult,
} from '../api'

const { Text, Title } = Typography
const { TextArea } = Input

const MAX_IMAGES = 5
const GEN_TYPE_LABELS: Record<string, string> = {
  white_background: '白底图',
  scene: '场景图',
  closeup: '特写图',
  selling_point: '卖点图',
  aplus: 'A+图',
}
const GEN_TYPE_DESCRIPTIONS: Record<string, string> = {
  white_background: '电商主图标准白底，突出商品主体',
  scene: '商品置于真实使用场景中',
  closeup: '细节特写，突出质感与做工',
  selling_point: '卖点信息图，图文结合',
  aplus: '亚马逊 A+ 页面横幅图',
}
const STATUS_COLORS: Record<string, string> = {
  排队中: 'default',
  生成中: 'processing',
  已完成: 'success',
  部分完成: 'warning',
  失败: 'error',
}

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
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    'white_background',
    'scene',
    'closeup',
  ])
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageCount, setImageCount] = useState(1)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ===== 右栏任务状态 =====
  const [tasks, setTasks] = useState<AIImageTask[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pageSize = 10

  const fetchTasks = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const { data } = await aiImageApi.listTasks(page, pageSize)
        setTasks(data.items || [])
        setTotal(data.total || 0)
      } catch (e: any) {
        if (!silent) message.error(e?.response?.data?.detail || '获取任务列表失败')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page],
  )

  // 有进行中任务时 5 秒轮询
  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === '排队中' || t.status === '生成中')
    if (hasActive && !timerRef.current) {
      timerRef.current = setInterval(() => fetchTasks(true), 5000)
    } else if (!hasActive && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [tasks, fetchTasks])

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

  // ===== 提交生成任务 =====
  const handleSubmit = async () => {
    const files = fileList.map((f) => f.originFileObj).filter(Boolean) as File[]
    if (!files.length) {
      message.warning('请至少上传一张参考图')
      return
    }
    if (!selectedTypes.length) {
      message.warning('请至少选择一种生成类型')
      return
    }
    setSubmitting(true)
    try {
      const firstFile = files[0]
      const baseName = firstFile.name.replace(/\.[^.]+$/, '')
      await aiImageApi.createTask(files, {
        title: baseName,
        generation_types: selectedTypes,
        aspect_ratio: aspectRatio,
        image_count: imageCount,
        product_info: productInfo,
        prompt: extraPrompt,
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

  // ===== 渲染 =====
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
          <Space
            style={{ position: 'absolute', top: 6, right: 6 }}
            size={4}
          >
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

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16}>
        {/* 左栏：生成表单 */}
        <Col xs={24} lg={9}>
          <Card
            title={
              <Space>
                <PictureOutlined />
                <span>商品套图生成</span>
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size={14}>
              <div>
                <Text strong>参考图（1~{MAX_IMAGES} 张，首张为主参考）</Text>
                <Upload.Dragger
                  multiple
                  accept="image/*"
                  maxCount={MAX_IMAGES}
                  fileList={fileList}
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

              <div>
                <Text strong>生成类型（可多选）</Text>
                <div style={{ marginTop: 8 }}>
                  {Object.entries(GEN_TYPE_LABELS).map(([key, label]) => (
                    <Tag.CheckableTag
                      key={key}
                      checked={selectedTypes.includes(key)}
                      onChange={(checked) =>
                        setSelectedTypes((prev) =>
                          checked ? [...prev, key] : prev.filter((t) => t !== key),
                        )
                      }
                      style={{
                        border: '1px solid #d9d9d9',
                        padding: '4px 12px',
                        fontSize: 13,
                      }}
                    >
                      <Tooltip title={GEN_TYPE_DESCRIPTIONS[key]}>{label}</Tooltip>
                    </Tag.CheckableTag>
                  ))}
                </div>
              </div>

              <Row gutter={12}>
                <Col span={12}>
                  <Text strong>输出比例</Text>
                  <Select
                    style={{ width: '100%', marginTop: 8 }}
                    value={aspectRatio}
                    onChange={setAspectRatio}
                    options={[
                      { value: '1:1', label: '1:1（方形，1248×1248）' },
                      { value: '3:4', label: '3:4（竖版，1088×1440）' },
                      { value: '4:3', label: '4:3（横版，1440×1088）' },
                      { value: '9:16', label: '9:16（全屏竖版）' },
                      { value: '16:9', label: '16:9（全屏横版）' },
                    ]}
                  />
                </Col>
                <Col span={12}>
                  <Text strong>每种类型张数</Text>
                  <div style={{ marginTop: 8 }}>
                    <InputNumber
                      min={1}
                      max={4}
                      value={imageCount}
                      onChange={(v) => setImageCount(v || 1)}
                      style={{ width: '100%' }}
                    />
                  </div>
                </Col>
              </Row>

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
              >
                立即生成（{selectedTypes.length} 类 × {imageCount} 张）
              </Button>
            </Space>
          </Card>
        </Col>

        {/* 右栏：任务列表 */}
        <Col xs={24} lg={15}>
          <Card
            title={
              <Space>
                <span>生成记录</span>
                {(total > 0) && <Text type="secondary">共 {total} 条</Text>}
              </Space>
            }
            extra={
              <Button icon={<ReloadOutlined />} onClick={() => fetchTasks()} size="small">
                刷新
              </Button>
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
                {tasks.map((task) => (
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
                          {task.aspect_ratio} · {task.image_count}/类 · {task.created_at}
                          {task.creator_name ? ` · ${task.creator_name}` : ''}
                        </Text>
                      </Space>
                    }
                    extra={
                      <Popconfirm
                        title="确定删除该记录？"
                        onConfirm={() => handleDelete(task.id)}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <Space wrap size={4}>
                        {task.generation_types.map((t) => (
                          <Tag key={t}>{GEN_TYPE_LABELS[t] || t}</Tag>
                        ))}
                        {task.cost_seconds != null && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            耗时 {formatCost(task.cost_seconds)}
                          </Text>
                        )}
                      </Space>
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
                      <Row gutter={[12, 12]}>
                        {(task.result_images || []).map((item) =>
                          renderResultItem(item, task),
                        )}
                      </Row>
                    </Space>
                  </Card>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default AIImageStudio
