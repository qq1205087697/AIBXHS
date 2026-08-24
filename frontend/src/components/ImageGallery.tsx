import React, { useState } from 'react'
import { Button, Image } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

interface ImageGalleryProps {
  /** 图片URL数组 */
  images?: string[]
  /** 主图区域高度，默认 320 */
  height?: number
}

const ImageGallery: React.FC<ImageGalleryProps> = ({ images = [], height = 320 }) => {
  const [current, setCurrent] = useState(0)
  const [showArrows, setShowArrows] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)

  const imageList = images?.filter(Boolean) || []

  if (imageList.length === 0) {
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
        暂无图片
      </div>
    )
  }

  const handlePrev = () => {
    setCurrent((prev) => (prev > 0 ? prev - 1 : imageList.length - 1))
  }

  const handleNext = () => {
    setCurrent((prev) => (prev < imageList.length - 1 ? prev + 1 : 0))
  }

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height,
          background: '#f8f8f8',
          borderRadius: 4,
          overflow: 'hidden',
        }}
        onMouseEnter={() => setShowArrows(true)}
        onMouseLeave={() => setShowArrows(false)}
      >
        <Image
          src={imageList[current]}
          style={{ display: 'none' }}
          preview={{
            visible: previewVisible,
            onVisibleChange: setPreviewVisible,
            src: imageList[current],
          }}
        />
        <img
          src={imageList[current]}
          alt="产品图片"
          style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
          onClick={() => setPreviewVisible(true)}
        />
        {imageList.length > 1 && showArrows && (
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
      {imageList.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 12,
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          {imageList.map((url, idx) => (
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
                border:
                  idx === current
                    ? '2px solid #1890ff'
                    : '2px solid transparent',
              }}
            >
              <Image
                src={url}
                width={60}
                height={60}
                style={{ objectFit: 'cover' }}
                preview={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageGallery
