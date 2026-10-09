import React, { useEffect, useRef, useState } from 'react'
import { Card, Button, Spin, Tag, Typography, Space, Input, Empty, Modal, Pagination, message } from 'antd'
import { DeleteOutlined, SearchOutlined, VideoCameraOutlined, LinkOutlined } from '@ant-design/icons'
import BindProductModal from '../components/BindProductModal'
import CompareVideoModal from '../components/CompareVideoModal'
import { aiCreationApi, VideoUpscaleTask } from '../api'

const { Text } = Typography

const PAGE_SIZE_DEFAULT = 20

// 耗时格式化：60 秒内显示「N 秒」，超过显示「N 分 M 秒」
const formatCost = (s?: number | null): string => {
  if (s == null) return '-'
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

const UpscaleCenter: React.FC = () => {
  const [tasks, setTasks] = useState<VideoUpscaleTask[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState('')
  const keywordTimerRef = useRef<number | null>(null)
  const [previewTask, setPreviewTask] = useState<VideoUpscaleTask | null>(null)
  const [bindOpen, setBindOpen] = useState(false)
  const [bindUrl, setBindUrl] = useState('')

  const loadTasks = async (p = page, size = pageSize, kw = keyword) => {
    setLoading(true)
    try {
      const resp = await aiCreationApi.listUpscaleTasks(p, size, kw)
      setTasks(resp.data.data.items || [])
      setTotal(resp.data.data.total || 0)
    } catch {
      // 拉取失败时保留原列表
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 有进行中的任务时每 15 秒轮询刷新
  useEffect(() => {
    const hasPending = tasks.some((t) => t.status === '排队中' || t.status === '处理中')
    if (!hasPending) return
    const timer = window.setInterval(() => loadTasks(), 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, page, pageSize, keyword])

  const handleKeywordChange = (kw: string) => {
    setKeyword(kw)
    if (keywordTimerRef.current) window.clearTimeout(keywordTimerRef.current)
    keywordTimerRef.current = window.setTimeout(() => {
      setPage(1)
      loadTasks(1, pageSize, kw)
    }, 300)
  }

  const removeTask = (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后不可恢复，确定要删除该条超分记录吗？',
      centered: true,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await aiCreationApi.deleteUpscaleTask(id)
          if (tasks.length <= 1 && page > 1) {
            setPage(page - 1)
            loadTasks(page - 1)
          } else {
            loadTasks()
          }
        } catch {
          message.error('删除失败，请稍后重试')
        }
      },
    })
  }

  const targetRes = (t: VideoUpscaleTask): string => {
    if (!t.source_width || !t.source_height || !t.scale) return '-'
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2)
    return `${even(t.source_width * t.scale)}×${even(t.source_height * t.scale)}`
  }

  const videoCell = (url: string, task: VideoUpscaleTask) => (
    <video
      src={url}
      muted
      loop
      playsInline
      preload="metadata"
      onClick={() => setPreviewTask(task)}
      style={{
        width: '100%',
        maxHeight: 170,
        background: '#000',
        borderRadius: 6,
        display: 'block',
        cursor: 'pointer',
        objectFit: 'cover',
      }}
    />
  )

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'hidden' }}>
      <Card
        title={
          <Space>
            <VideoCameraOutlined />
            <span>高清处理</span>
          </Space>
        }
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        styles={{
          body: {
            flex: 1,
            minHeight: 0,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
        extra={
          tasks.length > 0 || keyword ? (
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined style={{ color: '#999' }} />}
              placeholder="搜索任务标题"
              style={{ width: 190 }}
              value={keyword}
              onChange={(e) => handleKeywordChange(e.target.value)}
            />
          ) : null
        }
      >
        {tasks.length === 0 ? (
          <Empty
            description={loading ? <Spin /> : '暂无超分任务，可在「AI视频」生成历史的「更多」菜单中提交变高清'}
          />
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 12,
              }}
            >
            {tasks.map((item) => (
              <div
                key={item.id}
                style={{
                  border: `1px solid #f0f0f0`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  minWidth: 0,
                }}
              >
                {/* 第一行：标题 + 状态/耗时 + 操作 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong ellipsis style={{ fontSize: 13, flex: '0 1 auto', minWidth: 0 }}>
                    {item.title}
                  </Text>
                  {item.status === '排队中' || item.status === '处理中' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <Spin size="small" />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.status}
                      </Text>
                    </span>
                  ) : item.status === '失败' ? (
                    <Tag color="error" style={{ flexShrink: 0, marginRight: 0 }}>
                      失败
                    </Tag>
                  ) : item.status === '已完成' && item.cost_seconds != null ? (
                    <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                      耗时 {formatCost(item.cost_seconds)}
                    </Text>
                  ) : null}
                  <div style={{ flex: 1 }} />
                  {item.source_video_url && (
                    <Button
                      size="small"
                      icon={<LinkOutlined />}
                      onClick={() => {
                        // 优先绑定超分结果，无结果时绑定源视频
                        setBindUrl(item.video_url || item.source_video_url)
                        setBindOpen(true)
                      }}
                    >
                      绑定至产品
                    </Button>
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeTask(item.id)}
                  />
                </div>

                {/* 第二行：参数 */}
                <div style={{ marginTop: 2 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.created_at} · {item.creator_name || '-'} · 放大{' '}
                    {item.scale ? `×${item.scale}` : '-'} ·{' '}
                    {item.source_width && item.source_height
                      ? `${item.source_width}×${item.source_height}`
                      : '-'}{' '}
                    → {targetRes(item)}
                  </Text>
                </div>

                {/* 失败原因 */}
                {item.status === '失败' && item.error_message && (
                  <div style={{ marginTop: 2 }}>
                    <Text
                      type="danger"
                      style={{ fontSize: 12, display: 'block' }}
                      ellipsis={{ tooltip: item.error_message }}
                    >
                      失败原因：{item.error_message}
                    </Text>
                  </div>
                )}

                {/* 视频区：源视频 + 超分结果并排，悬停时源视频立即播放，超分视频缓冲就绪后对齐进度再播放 */}
                <div
                  style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}
                  onMouseEnter={(e) => {
                    const videos = Array.from(e.currentTarget.querySelectorAll('video'))
                    const m = videos[0]
                    const s = videos[1]
                    m?.play().catch(() => {})
                    if (s && m) {
                      const startSlave = () => {
                        try {
                          s.currentTime = m.currentTime
                        } catch {
                          /* ignore */
                        }
                        s.play().catch(() => {})
                      }
                      if (s.readyState >= 2) {
                        startSlave()
                      } else {
                        // 未就绪：等缓冲后自动对齐开播；移开时通过 signal 取消
                        const ac = new AbortController()
                        s.addEventListener('canplay', startSlave, { once: true, signal: ac.signal })
                        ;(s as HTMLVideoElement & { _hoverAbort?: AbortController })._hoverAbort = ac
                      }
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.querySelectorAll('video').forEach((v) => {
                      ;(v as HTMLVideoElement & { _hoverAbort?: AbortController })._hoverAbort?.abort()
                      v.pause()
                    })
                  }}
                >
                  {item.source_video_url && (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {videoCell(item.source_video_url, item)}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        源视频
                      </Text>
                    </div>
                  )}
                  {item.video_url && (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {videoCell(item.video_url, item)}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        超分结果
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
        {total > 0 && (
          <div style={{ marginTop: 12, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              size="small"
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              showQuickJumper
              showTotal={(t) => `共 ${t} 条`}
              pageSizeOptions={[10, 20, 50, 100]}
              onChange={(p, s) => {
                if (s !== pageSize) {
                  setPageSize(s)
                  setPage(1)
                  loadTasks(1, s)
                } else {
                  setPage(p)
                  loadTasks(p)
                }
              }}
            />
          </div>
        )}
      </Card>

      {/* 全屏对比预览：专用对比器，rAF 逐帧同步 + 拖动进度条即时跟随 */}
      <CompareVideoModal
        open={!!previewTask}
        title={previewTask ? `${previewTask.title} · 对比播放` : ''}
        sourceUrl={previewTask?.source_video_url || ''}
        resultUrl={previewTask?.video_url}
        onClose={() => setPreviewTask(null)}
      />

      {/* 绑定至产品（与 AI视频页共用） */}
      <BindProductModal
        open={bindOpen}
        videoUrl={bindUrl}
        onClose={() => setBindOpen(false)}
      />
    </div>
  )
}

export default UpscaleCenter
