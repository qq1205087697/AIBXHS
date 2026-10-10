import React, { useEffect, useRef, useState } from 'react'
import { Button, Modal, Spin, Typography } from 'antd'
import { CaretRightOutlined, FullscreenOutlined, PauseOutlined } from '@ant-design/icons'

const { Text } = Typography

const fmt = (s: number): string => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 视频对比播放器：左右并排同步播放。
 *  左源视频为主控，右超分结果通过 rAF 逐帧循环同步：
 *  偏差>0.3s 直接 seek；0.04~0.3s 用 playbackRate 微调渐进追赶；
 *  底部横跨进度条控制两边进度，两侧各有独立全屏按钮。 */
const CompareVideoModal: React.FC<{
  open: boolean
  title: string
  sourceUrl: string
  resultUrl?: string
  onClose: () => void
}> = ({ open, title, sourceUrl, resultUrl, onClose }) => {
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [solo, setSolo] = useState<{ url: string; label: string } | null>(null)
  const masterRef = useRef<HTMLVideoElement | null>(null)
  const slaveRef = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef(0)
  const rangeRef = useRef<HTMLInputElement | null>(null)
  const timeTextRef = useRef<HTMLSpanElement | null>(null)

  // 打开弹窗：等两个视频都缓冲就绪（canplay）后才开始播放，保证起点同步
  useEffect(() => {
    if (!open) {
      setReady(false)
      return
    }
    let cancelled = false
    const waitCanplay = (v: HTMLVideoElement | null) =>
      new Promise<void>((resolve) => {
        if (!v || v.readyState >= 2) return resolve()
        const done = () => {
          v.removeEventListener('canplay', done)
          v.removeEventListener('error', done)
          resolve()
        }
        v.addEventListener('canplay', done)
        v.addEventListener('error', done)
        window.setTimeout(done, 15000) // 兜底：超时也开播，避免一直转圈
      })
    Promise.all([waitCanplay(masterRef.current), waitCanplay(slaveRef.current)]).then(() => {
      if (cancelled) return
      setReady(true)
      masterRef.current?.play().catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // 同步 + 自定义进度条驱动循环（仅弹窗打开期间运行）
  useEffect(() => {
    if (!open) return
    const loop = () => {
      const m = masterRef.current
      const s = slaveRef.current
      if (m) {
        // 进度条与时间文本直接操作 DOM，避免每帧重渲染
        if (rangeRef.current && isFinite(m.duration) && m.duration > 0) {
          rangeRef.current.max = String(m.duration)
          rangeRef.current.value = String(m.currentTime)
        }
        if (timeTextRef.current) {
          timeTextRef.current.textContent = `${fmt(m.currentTime)} / ${fmt(m.duration)}`
        }
      }
      if (m && s && !m.paused && !m.ended) {
        const diff = s.currentTime - m.currentTime
        if (Math.abs(diff) > 0.3) {
          try {
            s.currentTime = m.currentTime
          } catch {
            /* 元数据未就绪时忽略 */
          }
          s.playbackRate = m.playbackRate
        } else if (Math.abs(diff) > 0.04) {
          s.playbackRate = Math.min(2, Math.max(0.25, 1 - diff * 0.5))
        } else {
          s.playbackRate = m.playbackRate
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [open])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const hardSync = () => {
    const m = masterRef.current
    const s = slaveRef.current
    if (m && s) {
      try {
        s.currentTime = m.currentTime
      } catch {
        /* ignore */
      }
      s.playbackRate = m.playbackRate
    }
  }

  const togglePlay = () => {
    const m = masterRef.current
    if (!m) return
    if (m.paused) m.play().catch(() => {})
    else m.pause()
  }

  // 单视频全屏小按钮
  const fsBtn = (label: string, style: React.CSSProperties) => (
    <Button
      size="small"
      icon={<FullscreenOutlined />}
      style={{ position: 'absolute', zIndex: 3, ...style }}
      onClick={() => {
        const url = label === 'source' ? sourceUrl : resultUrl
        if (url) setSolo({ url, label: label === 'source' ? '源视频' : '超分结果' })
      }}
    />
  )

  return (
    <Modal open={open} title={title} footer={null} onCancel={onClose} width="90vw" centered destroyOnClose>
      <div style={{ position: 'relative' }}>
        {!ready && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.55)',
            }}
          >
            <Spin tip="视频加载中，两边就绪后自动开始播放..." />
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <video
              ref={masterRef}
              src={sourceUrl}
              muted
              loop
              playsInline
              onPlay={() => {
                setPlaying(true)
                slaveRef.current?.play().catch(() => {})
              }}
              onPause={() => {
                setPlaying(false)
                const s = slaveRef.current
                if (s) {
                  s.pause()
                  hardSync()
                }
              }}
              onSeeking={hardSync}
              onRateChange={() => {
                const s = slaveRef.current
                if (s && masterRef.current) s.playbackRate = masterRef.current.playbackRate
              }}
              style={{ width: '100%', maxHeight: '70vh', background: '#000', borderRadius: 6 }}
            />
            {fsBtn('source', { top: 10, right: 10 })}
            <Text type="secondary" style={{ fontSize: 12 }}>
              源视频（左侧）
            </Text>
          </div>
          {resultUrl && (
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <video
                ref={slaveRef}
                src={resultUrl}
                muted
                loop
                playsInline
                style={{ width: '100%', maxHeight: '70vh', background: '#000', borderRadius: 6 }}
              />
              {fsBtn('result', { top: 10, right: 10 })}
              <Text type="secondary" style={{ fontSize: 12 }}>
                超分结果（右侧）
              </Text>
            </div>
          )}
        </div>

        {/* 横跨两个视频的自定义进度条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <Button size="small" icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={togglePlay} />
          <input
            ref={rangeRef}
            type="range"
            min={0}
            max={100}
            step={0.05}
            defaultValue={0}
            onChange={(e) => {
              const m = masterRef.current
              if (m) {
                try {
                  m.currentTime = Number(e.target.value)
                } catch {
                  /* ignore */
                }
              }
            }}
            style={{ flex: 1 }}
          />
          <span ref={timeTextRef} style={{ fontSize: 12, color: '#888', minWidth: 90, textAlign: 'right' }}>
            0:00 / 0:00
          </span>
        </div>
      </div>

      {/* 单视频全屏播放 */}
      <Modal
        open={!!solo}
        title={solo ? `${solo.label} · 全屏播放` : ''}
        footer={null}
        onCancel={() => setSolo(null)}
        width="90vw"
        centered
        destroyOnClose
      >
        {solo && (
          <video src={solo.url} controls autoPlay muted loop playsInline style={{ width: '100%', maxHeight: '78vh', background: '#000', borderRadius: 6 }} />
        )}
      </Modal>
    </Modal>
  )
}

export default CompareVideoModal
