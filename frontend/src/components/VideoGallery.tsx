import React, { useState } from 'react'
import { Button } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

interface VideoGalleryProps {
  /** 视频URL数组 */
  videos?: string[]
  /** 主视频区域高度，默认 320 */
  height?: number
}

/** 产品视频轮播：与 ImageGallery 同构——大区域单视频预览 + 悬停左右切换 + 底部缩略图 */
const VideoGallery: React.FC<VideoGalleryProps> = ({ videos = [], height = 320 }) => {
  const [current, setCurrent] = useState(0)
  const [showArrows, setShowArrows] = useState(false)

  const videoList = videos?.filter(Boolean) || []

  if (videoList.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height,
          background: '#f0f0f0',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
        }}
      >
        暂无视频
      </div>
    )
  }

  const handlePrev = () => {
    setCurrent((prev) => (prev > 0 ? prev - 1 : videoList.length - 1))
  }

  const handleNext = () => {
    setCurrent((prev) => (prev < videoList.length - 1 ? prev + 1 : 0))
  }

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height,
          background: '#000',
          borderRadius: 4,
          overflow: 'hidden',
        }}
        onMouseEnter={() => setShowArrows(true)}
        onMouseLeave={() => setShowArrows(false)}
      >
        {/* key=current：切换时重挂载，上一个视频自动停止播放 */}
        <video
          key={current}
          src={videoList[current]}
          controls
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
        {videoList.length > 1 && showArrows && (
          <>
            <Button
              shape="circle"
              icon={<LeftOutlined />}
              onClick={handlePrev}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                opacity: 0.8,
                zIndex: 2,
              }}
            />
            <Button
              shape="circle"
              icon={<RightOutlined />}
              onClick={handleNext}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                opacity: 0.8,
                zIndex: 2,
              }}
            />
          </>
        )}
      </div>
      {videoList.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          {videoList.map((url, idx) => (
            <div
              key={`${url}-${idx}`}
              onClick={() => setCurrent(idx)}
              style={{
                width: 60,
                height: 60,
                flexShrink: 0,
                borderRadius: 4,
                overflow: 'hidden',
                cursor: 'pointer',
                background: '#000',
                border:
                  idx === current
                    ? '2px solid #1890ff'
                    : '2px solid transparent',
              }}
            >
              {/* #t=0.1 强制展示首帧作为缩略图，不加载完整视频 */}
              <video
                src={`${url}#t=0.1`}
                preload="metadata"
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default VideoGallery
