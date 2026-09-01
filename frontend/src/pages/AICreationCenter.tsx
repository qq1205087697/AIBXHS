import React, { useState } from 'react'
import {
  Card,
  Upload,
  Button,
  Spin,
  Alert,
  Tag,
  Descriptions,
  Typography,
  Space,
  Divider,
  Progress,
  message,
  Empty,
  Tooltip,
  Steps,
  Collapse,
  Badge,
  Select,
  Row,
  Col,
  Input,
} from 'antd'
import {
  UploadOutlined,
  ClearOutlined,
  RocketOutlined,
  PictureOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  BulbOutlined,
  VideoCameraOutlined,
  CopyOutlined,
  ReloadOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import type { UploadFile, UploadProps } from 'antd/es/upload'
import {
  aiCreationApi,
  AmazonProductAnalysisResult,
  VideoConcept,
  VideoPrompt,
  VideoMarket,
  VideoDuration,
} from '../api'
import { useTheme } from '../contexts/ThemeContext'

const { Title, Text, Paragraph } = Typography
const { Step } = Steps
const { Panel } = Collapse
const { Option } = Select
const { TextArea } = Input

const MAX_IMAGES = 9

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
  const { currentTheme } = useTheme()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [result, setResult] = useState<AmazonProductAnalysisResult | null>(null)
  const [concepts, setConcepts] = useState<VideoConcept[] | null>(null)
  const [prompts, setPrompts] = useState<VideoPrompt[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingConcepts, setLoadingConcepts] = useState(false)
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [market, setMarket] = useState<VideoMarket>('US')
  const [duration, setDuration] = useState<VideoDuration>(30)
  const [selectedConceptIndex, setSelectedConceptIndex] = useState<number | null>(null)

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
    setPrompts(null)
    setSelectedConceptIndex(null)
    setCurrentStep(0)
  }

  const handleAnalyze = async () => {
    if (fileList.length === 0) {
      message.warning('请至少上传一张图片')
      return
    }

    const files = fileList
      .map((f) => f.originFileObj)
      .filter((f): f is File => f instanceof File)

    if (files.length === 0) {
      message.warning('没有可分析的图片')
      return
    }

    setLoading(true)
    setResult(null)
    setConcepts(null)
    setPrompts(null)
    setCurrentStep(0)

    try {
      const res = await aiCreationApi.analyzeProduct(files)
      if (res.data?.success && res.data?.data) {
        setResult(res.data.data)
        setCurrentStep(1)
        message.success('产品信息识别完成')
      } else {
        message.error('分析结果异常，请稍后重试')
      }
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.message || '分析失败'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateConcepts = async (isRefresh = false) => {
    if (!result) {
      message.warning('请先完成产品信息识别')
      return
    }

    setLoadingConcepts(true)
    setSelectedConceptIndex(null)
    if (!isRefresh) {
      setConcepts(null)
      setPrompts(null)
    } else {
      setPrompts(null)
    }
    setCurrentStep(1)

    try {
      const previous = isRefresh && concepts ? concepts : undefined
      const res = await aiCreationApi.generateVideoConcepts(result, market, duration, previous)
      if (res.data?.success && res.data?.data) {
        setConcepts(res.data.data)
        setCurrentStep(2)
        message.success(isRefresh ? '已重新生成 3 套视频创意' : '已生成 3 套视频创意')
      } else {
        message.error('视频创意生成异常')
      }
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.message || '视频创意生成失败'
      message.error(msg)
    } finally {
      setLoadingConcepts(false)
    }
  }

  const handleGeneratePrompts = async () => {
    if (!result || !concepts || concepts.length !== 3) {
      message.warning('请先完成视频创意生成')
      return
    }

    setLoadingPrompts(true)
    setPrompts(null)

    try {
      const res = await aiCreationApi.generateVideoPrompts(result, concepts)
      if (res.data?.success && res.data?.data) {
        setPrompts(res.data.data)
        setCurrentStep(3)
        message.success('已生成 3 套最终视频提示词')
      } else {
        message.error('视频提示词生成异常')
      }
    } catch (error: any) {
      const msg = error.response?.data?.detail || error.message || '视频提示词生成失败'
      message.error(msg)
    } finally {
      setLoadingPrompts(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板')
    })
  }

  const renderTagList = (items?: string[], color?: string) => {
    if (!items || items.length === 0) return <Text type="secondary">-</Text>
    return (
      <Space size={[8, 8]} wrap>
        {items.map((item, idx) => (
          <Tag key={idx} color={color || currentTheme.primary} style={{ margin: 0 }}>
            {item}
          </Tag>
        ))}
      </Space>
    )
  }

  const renderList = (items?: string[]) => {
    if (!items || items.length === 0) return <Text type="secondary">-</Text>
    return (
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        {items.map((item, idx) => (
          <li key={idx}>
            <Text>{item}</Text>
          </li>
        ))}
      </ul>
    )
  }

  const renderProductProfile = () => {
    if (!result) return null
    return (
      <div>
        <Descriptions
          bordered
          column={2}
          size="small"
          labelStyle={{ fontWeight: 600, width: 140 }}
        >
          <Descriptions.Item label="中文名称" span={1}>
            {result.product_name_cn || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="英文名称" span={1}>
            {result.product_name_en || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="产品类型" span={1}>
            {result.product_type || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Amazon 类目" span={1}>
            {result.amazon_category || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="置信度" span={1}>
            <Tooltip title={`置信度: ${getConfidencePercent(result.confidence).toFixed(0)}%`}>
              <Progress
                percent={getConfidencePercent(result.confidence)}
                size="small"
                status="active"
                style={{ width: 160 }}
              />
            </Tooltip>
          </Descriptions.Item>
          <Descriptions.Item label="可见文字" span={1}>
            {renderTagList(result.visible_text, 'default')}
          </Descriptions.Item>
        </Descriptions>

        <Divider orientation="left">核心信息</Divider>
        <Descriptions
          bordered
          column={1}
          size="small"
          labelStyle={{ fontWeight: 600, width: 140 }}
        >
          <Descriptions.Item label="目标受众">
            {renderTagList(result.target_audience, 'blue')}
          </Descriptions.Item>
          <Descriptions.Item label="卖点">
            {renderList(result.selling_points)}
          </Descriptions.Item>
          <Descriptions.Item label="材质">
            {renderTagList(result.material, 'cyan')}
          </Descriptions.Item>
          <Descriptions.Item label="使用场景">
            {renderList(result.usage_scenarios)}
          </Descriptions.Item>
          <Descriptions.Item label="使用方式">
            {renderList(result.usage_methods)}
          </Descriptions.Item>
          <Descriptions.Item label="产品组成">
            {renderList(result.product_components)}
          </Descriptions.Item>
          <Descriptions.Item label="颜色">
            {renderTagList(result.colors, 'purple')}
          </Descriptions.Item>
          <Descriptions.Item label="关键词">
            {renderTagList(result.keywords, 'green')}
          </Descriptions.Item>
        </Descriptions>

        {result.uncertain_information && result.uncertain_information.length > 0 && (
          <>
            <Divider orientation="left">无法从图片确认的信息</Divider>
            <Alert
              type="warning"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message="以下信息无法从图片中确认，请人工补充核实"
              description={renderList(result.uncertain_information)}
            />
          </>
        )}
      </div>
    )
  }

  const renderConceptControls = () => {
    if (!result) return null
    return (
      <Card style={{ marginTop: 24 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Space>
              <Text strong>目标市场：</Text>
              <Select<VideoMarket>
                value={market}
                onChange={setMarket}
                style={{ width: 120 }}
                disabled={loadingConcepts}
              >
                {MARKET_OPTIONS.map((opt) => (
                  <Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col>
            <Space>
              <Text strong>视频时长：</Text>
              <Select<VideoDuration>
                value={duration}
                onChange={setDuration}
                style={{ width: 120 }}
                disabled={loadingConcepts}
              >
                {DURATION_OPTIONS.map((opt) => (
                  <Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              {concepts && (
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => handleGenerateConcepts(true)}
                  loading={loadingConcepts}
                >
                  重新生成创意
                </Button>
              )}
              <Button
                type="primary"
                icon={<BulbOutlined />}
                onClick={() => handleGenerateConcepts(false)}
                loading={loadingConcepts}
              >
                {concepts ? '换一批创意' : '生成 3 套视频创意'}
              </Button>
            </Space>
          </Col>
        </Row>

        {loadingConcepts && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Spin tip={`正在根据 ${market} 市场 / ${duration} 秒时长生成动态创意，请稍候...`} />
          </div>
        )}
      </Card>
    )
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

  const handleSelectConcept = (idx: number) => {
    setSelectedConceptIndex(idx)
    message.success(`已选择方案 ${idx + 1}`)
  }

  const renderConceptField = (label: string, content: React.ReactNode, color: string) => (
    <div style={{ marginBottom: 12 }}>
      <Tag color={color} style={{ marginBottom: 6 }}>{label}</Tag>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,0.85)' }}>
        {content}
      </div>
    </div>
  )

  const renderConcepts = () => {
    if (!concepts) return null
    return (
      <div style={{ marginTop: 24 }}>
        <Divider orientation="left">
          <Space>
            <BulbOutlined />
            <span>推荐方案（3 个动态差异化方向，点击选择）</span>
          </Space>
        </Divider>

        <Row gutter={16}>
          {concepts.map((concept, idx) => {
            const isSelected = selectedConceptIndex === idx
            return (
              <Col span={8} key={idx}>
                <Card
                  type="inner"
                  title={
                    <div>
                      <Text strong style={{ fontSize: 16 }}>方案{['一', '二', '三'][idx]}：{concept.concept_title}</Text>
                      <div style={{ marginTop: 6 }}>
                        <Tag color="blue">{concept.marketing_goal}</Tag>
                      </div>
                    </div>
                  }
                  bodyStyle={{ padding: 16, minHeight: 480, maxHeight: 560, overflow: 'auto' }}
                  style={{
                    borderColor: isSelected ? currentTheme.primary : undefined,
                    boxShadow: isSelected ? `0 0 0 2px ${currentTheme.primary}` : undefined,
                  }}
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
                        <Paragraph key={sidx} style={{ marginBottom: 6, fontSize: 12 }}>
                          <Text strong>{shot.timestamp}</Text> | {shot.shot_purpose}：{shot.shot_type}
                        </Paragraph>
                      ))}
                      {concept.storyboard.length > 3 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>... 共 {concept.storyboard.length} 个镜头</Text>
                      )}
                    </div>,
                    'geekblue'
                  )}

                  <Button
                    type={isSelected ? 'primary' : 'default'}
                    block
                    icon={isSelected ? <CheckOutlined /> : undefined}
                    onClick={() => handleSelectConcept(idx)}
                  >
                    {isSelected ? '已选择' : '选择此方案'}
                  </Button>
                </Card>
              </Col>
            )
          })}
        </Row>

        {selectedConceptIndex !== null && concepts[selectedConceptIndex] && (
          <Card style={{ marginTop: 24 }} title="已选方案输出">
            <TextArea
              value={formatSelectedConcept(concepts[selectedConceptIndex])}
              rows={16}
              readOnly
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button
                icon={<CopyOutlined />}
                onClick={() => handleCopy(formatSelectedConcept(concepts[selectedConceptIndex]))}
              >
                复制文本
              </Button>
            </div>
          </Card>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Button
            type="primary"
            size="large"
            icon={<VideoCameraOutlined />}
            onClick={handleGeneratePrompts}
            loading={loadingPrompts}
          >
            {loadingPrompts ? '生成最终 Prompt 中...' : '生成 3 套 AI 视频生成 Prompt'}
          </Button>
        </div>
      </div>
    )
  }

  const renderPrompts = () => {
    if (!prompts) return null
    return (
      <div style={{ marginTop: 24 }}>
        <Divider orientation="left">
          <Space>
            <VideoCameraOutlined />
            <span>最终视频提示词（可直接用于 Sora / Runway / Pika 等）</span>
          </Space>
        </Divider>

        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {prompts.map((prompt, idx) => (
            <Card
              key={idx}
              type="inner"
              title={
                <Space>
                  <Badge count={idx + 1} style={{ backgroundColor: currentTheme.primary }} />
                  <Text strong>{prompt.concept_title}</Text>
                </Space>
              }
              extra={
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopy(prompt.final_prompt)}
                >
                  复制
                </Button>
              }
            >
              <Paragraph
                style={{
                  maxHeight: 360,
                  overflow: 'auto',
                  background: '#f6f8fa',
                  padding: 12,
                  borderRadius: 6,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {prompt.final_prompt}
              </Paragraph>
            </Card>
          ))}
        </Space>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, minWidth: 1280 }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 8 }}>
          <RocketOutlined style={{ marginRight: 8, color: currentTheme.primary }} />
          AI 创作中心
        </Title>
        <Text type="secondary">
          上传商品图片 → 识别产品信息 → 生成 3 套动态差异化带货视频创意 → 输出 3 套最终 AI 视频提示词。
        </Text>
      </div>

      <Steps current={currentStep} style={{ marginBottom: 32 }}>
        <Step title="上传图片" description="最多 9 张" />
        <Step title="产品信息识别" description="Amazon 产品画像" />
        <Step title="视频创意策略" description="3 个动态差异化方向" />
        <Step title="最终视频提示词" description="3 套 Prompt" />
      </Steps>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* 左侧：图片上传 */}
        <Card
          title={
            <Space>
              <PictureOutlined />
              <span>图片上传</span>
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
              disabled={fileList.length === 0 && !result && !loading}
            >
              清空
            </Button>
          }
          style={{ width: 420, flexShrink: 0 }}
          bodyStyle={{ minHeight: 360 }}
        >
          <Upload
            listType="picture-card"
            fileList={fileList}
            multiple
            beforeUpload={beforeUpload}
            onChange={handleChange}
            accept="image/*"
            disabled={loading}
          >
            {fileList.length >= MAX_IMAGES ? null : (
              <div>
                <UploadOutlined />
                <div style={{ marginTop: 8 }}>上传图片</div>
              </div>
            )}
          </Upload>

          <Divider />

          <Button
            type="primary"
            size="large"
            icon={<RocketOutlined />}
            onClick={handleAnalyze}
            loading={loading}
            disabled={fileList.length === 0}
            block
          >
            {loading ? 'AI 分析中...' : '开始识别产品信息'}
          </Button>

          {loading && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Spin tip="正在调用 GPT 分析图片，请稍候..." />
            </div>
          )}
        </Card>

        {/* 右侧：分析结果与视频创作 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card
            title={
              <Space>
                <CheckCircleOutlined />
                <span>产品画像</span>
              </Space>
            }
          >
            {!result && !loading && (
              <Empty description="上传图片并点击开始识别，产品画像将展示在这里" />
            )}
            {result && renderProductProfile()}
          </Card>

          {renderConceptControls()}
          {renderConcepts()}
          {renderPrompts()}
        </div>
      </div>
    </div>
  )
}

function getConfidencePercent(value: number): number {
  if (value === undefined || value === null) return 0
  if (value <= 1) return Math.round(value * 100)
  return Math.min(Math.round(value), 100)
}

export default AICreationCenter
