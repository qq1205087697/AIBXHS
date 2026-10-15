import React, { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Modal, Slider, Spin, Typography } from 'antd'
import { CaretRightOutlined, DownloadOutlined, FullscreenOutlined, MoreOutlined, PauseOutlined } from '@ant-design/icons'

const { Text } = Typography

const fmt = (s: number): string => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Material 风格音量图标：off=喇叭斜线（静音），否则喇叭+声波 */
const VolumeIcon: React.FC<{ off?: boolean }> = ({ off }) => (
  <span role="img" aria-label="volume" style={{ display: 'inline-flex', fontSize: 14, lineHeight: 1 }}>
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
      <path
        d={
          off
            ? 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z'
            : 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'
        }
      />
    </svg>
  </span>
)

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
  /** 可选下载回调：source=源视频 / result=超分结果 */
  onDownload?: (target: 'source' | 'result') => void
}> = ({ open, title, sourceUrl, resultUrl, onClose, onDownload }) => {
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [solo, setSolo] = useState<{ url: string; label: string } | null>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [volHover, setVolHover] = useState(false)
  const [speed, setSpeed] = useState(1)
  const masterRef = useRef<HTMLVideoElement | null>(null)
  const slaveRef = useRef<HTMLVideoElement | null>(null)
  const rafRef = useRef(0)
  const rangeRef = useRef<HTMLInputElement | null>(null)
  const timeTextRef = useRef<HTMLSpanElement | null>(null)

  // 打开弹窗：等两个视频都缓冲就绪（canplay）后才开始播放，保证起点同步。
  // 关闭时重置 playing/solo/ready，避免再次打开（可能换了视频）残留上一场的状态
  useEffect(() => {
    if (!open) {
      setReady(false)
      setPlaying(false)
      setSolo(null)
      setMuted(false)
      setVolume(1)
      setSpeed(1)
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
      const m = masterRef.current
      m?.play().catch(() => {
        // 浏览器拦截有声自动播放时：降级为静音播放兜底，避免卡在第一帧
        if (m) {
          m.muted = true
          setMuted(true)
          m.play().catch(() => {})
        }
      })
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

  // 声音：双屏默认播源视频音轨；单独全屏时切到对应视频的音轨；两路永远只有一路出声避免重叠
  useEffect(() => {
    if (!open) return
    const audibleSlave = solo?.label === '超分结果'
    if (masterRef.current) {
      masterRef.current.muted = muted || audibleSlave
      masterRef.current.volume = volume
    }
    if (slaveRef.current) {
      slaveRef.current.muted = !audibleSlave || muted
      slaveRef.current.volume = volume
    }
  }, [muted, volume, solo, open])

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

  // 倍速：只改主控播放速率，右视频由同步循环/ratechange 跟随
  const changeSpeed = (v: number) => {
    setSpeed(v)
    const m = masterRef.current
    if (m) m.playbackRate = v
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, position: 'relative' }}>
          {/* 音量 + 更多：悬浮在进度条末端上方，悬停音量时向左展开音量滑杆 */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              bottom: '100%',
              marginBottom: 2,
              zIndex: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onMouseEnter={() => setVolHover(true)}
            onMouseLeave={() => setVolHover(false)}
          >
            <div
              style={{
                width: volHover ? 72 : 0,
                opacity: volHover ? 1 : 0,
                overflow: 'hidden',
                transition: 'width 0.2s ease, opacity 0.2s ease',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                tooltip={{ open: false }}
                onChange={(v) => {
                  setVolume(v)
                  if (v > 0 && muted) setMuted(false)
                  else if (v === 0 && !muted) setMuted(true)
                }}
                className="volume-slider"
                style={{ margin: '0 6px', width: 60 }}
              />
            </div>
            <Button
              size="small"
              icon={<VolumeIcon off={muted || volume === 0} />}
              onClick={() => setMuted(!muted)}
              title={muted ? '开启声音' : '静音'}
            />
            <Dropdown
              trigger={['click']}
              menu={{
                selectedKeys: [String(speed)],
                onClick: ({ key }) => {
                  if (key === 'dl-source') onDownload?.('source')
                  else if (key === 'dl-result') onDownload?.('result')
                  else changeSpeed(Number(key))
                },
                items: [
                  { key: 'dl-source', icon: <DownloadOutlined />, label: '下载源视频' },
                  { key: 'dl-result', icon: <DownloadOutlined />, label: '下载超分结果', disabled: !resultUrl || !onDownload },
                  { type: 'divider' },
                  {
                    key: 'speed',
                    label: '播放速度',
                    children: [
                      { key: '0.5', label: '0.5x' },
                      { key: '0.75', label: '0.75x' },
                      { key: '1', label: '1.0x（正常）' },
                      { key: '1.25', label: '1.25x' },
                      { key: '1.5', label: '1.5x' },
                      { key: '2', label: '2.0x' },
                    ],
                  },
                ],
              }}
            >
              <Button size="small" icon={<MoreOutlined />} title="更多" />
            </Dropdown>
          </div>
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
