import React, { useState } from 'react'
import {
  Card,
  Upload,
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
} from 'antd'
import {
  UploadOutlined,
  ClearOutlined,
  PictureOutlined,
  BulbOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { UploadFile, UploadProps } from 'antd/es/upload'
import {
  aiCreationApi,
  AmazonProductAnalysisResult,
  VideoConcept,
  VideoMarket,
  VideoDuration,
} from '../api'

const { Text } = Typography
const { Option } = Select
const { TextArea } = Input

const MAX_IMAGES = 9
const MAX_PROMPT_LENGTH = 4000

const MARKET_OPTIONS: { label: string; value: VideoMarket }[] = [
  { label: '美国', value: 'US' },
  { label: '英国', value: 'UK' },
  { label: '加拿大', value: 'CA' },
  { label: '澳大利亚', value: 'AU' },
  { label: '德国', value: 'DE' },
  { label: '法国', value: 'FR' },
  { label: '日本', value: 'JP' },
  { label: '中国', value: 'CN' },
]

const DURATION_OPTIONS: { label: string; value: VideoDuration }[] = [
  { label: '15 秒', value: 15 },
  { label: '30 秒', value: 30 },
  { label: '45 秒', value: 45 },
  { label: '60 秒', value: 60 },
]

const AICreationCenter: React.FC = () => {
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [result, setResult] = useState<AmazonProductAnalysisResult | null>(null)
  const [concepts, setConcepts] = useState<VideoConcept[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [market, setMarket] = useState<VideoMarket>('US')
  const [duration, setDuration] = useState<VideoDuration>(30)
  const [promptText, setPromptText] = useState('')
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [planRefreshLeft, setPlanRefreshLeft] = useState(2)

  const beforeUpload: UploadProps['beforeUpload'] = (file, currentFiles) => {
    const isImage = file.type?.startsWith('image/')
    if (!isImage) {
      message.error(`${file.name} 不是图片文件，请上传图片`)
      return Upload.LIST_IGNORE
    }
    const total = fileList.length + currentFiles.length
    if (total > MAX_IMAGES) {
      message.warning(`最多上传 ${MAX_IMAGES} 张图片`)
      return Upload.LIST_IGNORE
    }
    return false
  }

  const handleChange: UploadProps['onChange'] = ({ fileList: newFileList }) => {
    setFileList(newFileList)
  }

  const handleClear = () => {
    setFileList([])
    setResult(null)
    setConcepts(null)
    setPromptText('')
    setPlanRefreshLeft(2)
    setPlanModalOpen(false)
  }

  const getMarketLanguage = (m: VideoMarket): string => {
    const map: Record<VideoMarket, string> = {
      US: '整个视频使用英语来进行口播',
      UK: '整个视频使用英语来进行口播',
      CA: '整个视频使用英语来进行口播',
      AU: '整个视频使用英语来进行口播',
      DE: '整个视频使用德语来进行口播',
      FR: '整个视频使用法语来进行口播',
      JP: '整个视频使用日语来进行口播',
      CN: '整个视频使用中文来进行口播',
    }
    return map[m] || `整个视频使用 ${m} 市场语言来进行口播`
  }

  const buildProductDescription = (): string => {
    if (!result) return ''
    const parts: string[] = []
    if (result.product_name_en) parts.push(result.product_name_en)
    if (result.product_name_cn) parts.push(`(${result.product_name_cn})`)
    if (result.material?.length) parts.push(`材质：${result.material.join('、')}`)
    if (result.colors?.length) parts.push(`颜色：${result.colors.join('、')}`)
    if (result.product_components?.length) parts.push(`包含：${result.product_components.join('、')}`)
    return parts.join('，')
  }

  const formatShotText = (shot: VideoConcept['storyboard'][0], idx: number): string => {
    const numText = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'][idx] || String(idx + 1)
    const details = [
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
    return `[镜头${numText}]：${shot.timestamp} | ${shot.shot_purpose}，${details}，模特说：${shot.voiceover}`
  }

  const formatSelectedConcept = (concept: VideoConcept): string => {
    const lines: string[] = []
    lines.push(`[目标语言]：${getMarketLanguage(market)}`)
    lines.push(`[情节]：${concept.story}`)
    lines.push(`[模特]：${concept.character}`)
    lines.push(`[产品描述]：${buildProductDescription()}`)
    lines.push(`[环境]：${concept.environment}`)
    lines.push(`[音乐]：${concept.music}`)
    lines.push(`[分镜]：`)
    concept.storyboard.forEach((shot, idx) => {
      lines.push(formatShotText(shot, idx))
    })
    return lines.join('\n')
  }

  // 生成三套方案：未识别商品时自动识别，然后生成创意并弹窗选择
  const handleGeneratePlans = async (isRefresh = false) => {
    const files: File[] = []
    fileList.forEach((f) => {
      if (f.originFileObj instanceof File) files.push(f.originFileObj)
    })

    if (files.length === 0) {
      message.warning('请先上传商品图片')
      return
    }
    if (isRefresh && planRefreshLeft <= 0) {
      return
    }

    setLoading(true)

    try {
      let product = result
      if (!product) {
        const res = await aiCreationApi.analyzeProduct(files)
        if (res.data?.success && res.data?.data) {
          product = res.data.data
          setResult(product)
        } else {
          message.error('商品信息识别异常，请稍后重试')
          return
        }
      }

      const previous = isRefresh && concepts ? concepts : undefined
      const res = await aiCreationApi.generateVideoConcepts(product, market, duration, previous)
      if (res.data?.success && res.data?.data) {
        setConcepts(res.data.data)
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

  const handleSelectPlan = (idx: number) => {
    if (!concepts || !concepts[idx]) return
    setPromptText(formatSelectedConcept(concepts[idx]))
    setPlanModalOpen(false)
    message.success(`已选择方案 ${['一', '二', '三'][idx]}，提示词已填入`)
  }

  const renderConceptField = (label: string, content: React.ReactNode, color: string) => (
    <div style={{ marginBottom: 10 }}>
      <Tag color={color} style={{ marginBottom: 4 }}>{label}</Tag>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,0.85)' }}>
        {content}
      </div>
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
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {/* 商品信息摘要 */}
        {result && (
          <div style={{ marginBottom: 16 }}>
            <Space size={[8, 8]} wrap>
              <Text strong style={{ fontSize: 15 }}>
                {result.product_name_cn || result.product_name_en || '未知商品'}
              </Text>
              {(result.target_audience || []).slice(0, 2).map((t, i) => (
                <Tag key={i} color="blue">{t}</Tag>
              ))}
              <Tag color="purple">{market} · {getMarketLanguage(market).replace('整个视频使用', '').replace('来进行口播', '')}口播</Tag>
            </Space>
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
                  bodyStyle={{ padding: 16, minHeight: 420, maxHeight: 520, overflow: 'auto' }}
                >
                  {renderConceptField('情节', concept.story, 'purple')}
                  {renderConceptField(
                    '模特',
                    `${concept.character}；${concept.creative_strategy.age}，${concept.creative_strategy.persona_identity}，${concept.creative_strategy.persona_role}`,
                    'cyan'
                  )}
                  {renderConceptField('环境', concept.environment, 'green')}
                  {renderConceptField('音乐', concept.music, 'orange')}
                  {renderConceptField(
                    '分镜',
                    <div>
                      {concept.storyboard.slice(0, 3).map((shot, sidx) => (
                        <div key={sidx} style={{ marginBottom: 6, fontSize: 12 }}>
                          <Text strong>{shot.timestamp}</Text> | {shot.shot_purpose}：{shot.shot_type}
                        </div>
                      ))}
                      {concept.storyboard.length > 3 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>... 共 {concept.storyboard.length} 个镜头</Text>
                      )}
                    </div>,
                    'geekblue'
                  )}

                  <Button
                    type="primary"
                    block
                    onClick={() => handleSelectPlan(idx)}
                  >
                    选择此方案
                  </Button>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Modal>
    )
  }

  const renderSpeechTab = () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {/* 左侧：图片上传 */}
      <Card
        title={
          <Space>
            <PictureOutlined />
            <span>商品素材</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已上传 {fileList.length}/{MAX_IMAGES}
            </Text>
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
        style={{ width: 420, flexShrink: 0 }}
        bodyStyle={{ minHeight: 320 }}
      >
        <Upload
          listType="picture-card"
          fileList={fileList}
          multiple
          beforeUpload={beforeUpload}
          onChange={handleChange}
          accept="image/*"
        >
          {fileList.length >= MAX_IMAGES ? null : (
            <div>
              <UploadOutlined />
              <div style={{ marginTop: 8 }}>上传图片</div>
            </div>
          )}
        </Upload>

        <Divider />
        <Text type="secondary" style={{ fontSize: 12 }}>
          上传多视角白底商品图或实拍图，AI 将自动识别商品信息并生成视频方案
        </Text>
      </Card>

      {/* 右侧：视频提示词 */}
      <Card
        title={
          <Space>
            <VideoCameraOutlined />
            <span>视频提示词</span>
          </Space>
        }
        style={{ flex: 1, minWidth: 0 }}
      >
        <Space style={{ marginBottom: 12 }} size={16}>
          <Space>
            <Text strong>目标市场：</Text>
            <Select<VideoMarket>
              value={market}
              onChange={setMarket}
              style={{ width: 120 }}
              disabled={loading}
            >
              {MARKET_OPTIONS.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Space>
          <Space>
            <Text strong>视频时长：</Text>
            <Select<VideoDuration>
              value={duration}
              onChange={setDuration}
              style={{ width: 120 }}
              disabled={loading}
            >
              {DURATION_OPTIONS.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Space>
        </Space>

        <TextArea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={16}
          maxLength={MAX_PROMPT_LENGTH}
          showCount
          placeholder={'点击下方"生成方案"，AI 将自动识别商品信息并生成 3 套视频方案，选择一套后自动填入；也可直接在此编辑提示词'}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <Button
            type="primary"
            icon={<BulbOutlined />}
            onClick={() => handleGeneratePlans(false)}
            loading={loading}
            size="large"
          >
            {promptText ? '换个方案' : '生成方案'}
          </Button>
        </div>
      </Card>

      {renderPlanModal()}
    </div>
  )

  return (
    <div style={{ padding: 24, minWidth: 1280 }}>
      <Tabs
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
