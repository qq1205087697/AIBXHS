import React, { useRef, useState } from 'react'
import { Button, Image, message } from 'antd'
import { UploadOutlined, DeleteOutlined, LoadingOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { uploadApi } from '../api'

interface TosUploadProps {
  /** 当前URL值 */
  value?: string
  /** 值变化回调 */
  onChange?: (value: string | undefined) => void
  /** 上传类型：image / video */
  type: 'image' | 'video'
  /** 已上传文件大小限制（字节），默认图片 10MB / 视频 200MB */
  maxSize?: number
  /** 占位提示文字 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义文件名（如产品编码），不含扩展名 */
  customName?: string
}

/**
 * 火山引擎 TOS 文件上传组件
 *
 * - type="image"：图片上传，显示缩略图预览
 * - type="video"：视频上传，显示视频预览
 *
 * 上传成功后将返回的URL写入父表单（受控组件，配合 Form.Item 使用）。
 */
const TosUpload: React.FC<TosUploadProps> = ({
  value,
  onChange,
  type,
  maxSize,
  placeholder,
  disabled,
  customName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // 默认大小限制
  const defaultMaxSize = type === 'image' ? 10 * 1024 * 1024 : 200 * 1024 * 1024
  const maxBytes = maxSize ?? defaultMaxSize

  // 允许的扩展名
  const accept =
    type === 'image'
      ? '.jpg,.jpeg,.png,.gif,.webp,.bmp'
      : '.mp4,.mov,.avi,.wmv,.flv,.mkv,.webm'

  const allowedExt =
    type === 'image'
      ? ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      : ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.webm']

  const handleClick = () => {
    if (disabled || uploading) return
    inputRef.current?.click()
  }

  const validateFile = (file: File): boolean => {
    if (file.size > maxBytes) {
      const mb = Math.floor(maxBytes / 1024 / 1024)
      message.error(`文件大小不能超过 ${mb}MB`)
      return false
    }
    const fileName = file.name.toLowerCase()
    const matched = allowedExt.some((ext) => fileName.endsWith(ext))
    if (!matched) {
      message.error(`不支持的文件格式，允许：${allowedExt.join(', ')}`)
      return false
    }
    return true
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 重置 input，允许重复选择同一文件
    e.target.value = ''

    if (!validateFile(file)) return

    setUploading(true)
    try {
      const res =
        type === 'image'
          ? await uploadApi.uploadImage(file, customName)
          : await uploadApi.uploadVideo(file, customName)

      // 兼容两种后端返回格式：{ data: { url } } 或 { url }
      const payload = res?.data
      const url = payload?.data?.url || payload?.url

      if (url) {
        onChange?.(url)
        message.success(`${type === 'image' ? '图片' : '视频'}上传成功`)
      } else {
        console.error('上传响应异常：', payload)
        message.error('上传失败：未获取到URL')
      }
    } catch (e: any) {
      const errMsg = e?.response?.data?.detail || e?.message || '上传失败'
      message.error(errMsg)
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = () => {
    onChange?.(undefined)
  }

  // 渲染已上传内容预览
  const renderPreview = () => {
    if (!value) return null
    if (type === 'image') {
      return (
        <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
          <Image
            src={value}
            width={100}
            height={100}
            style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
            placeholder={
              <div
                style={{
                  width: 100,
                  height: 100,
                  background: '#f0f0f0',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LoadingOutlined />
              </div>
            }
          />
          {!disabled && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={handleRemove}
              style={{ position: 'absolute', top: -8, right: -8, borderRadius: '50%' }}
            />
          )}
        </div>
      )
    }
    // 视频预览
    return (
      <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
        <video
          key={value}
          src={value}
          controls
          style={{ width: 200, maxHeight: 150, borderRadius: 4, background: '#000' }}
        />
        {!disabled && (
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={handleRemove}
            style={{ position: 'absolute', top: -8, right: -8, borderRadius: '50%' }}
          />
        )}
      </div>
    )
  }

  return (
    <div>
      {!value && (
        <Button
          icon={uploading ? <LoadingOutlined /> : type === 'image' ? <UploadOutlined /> : <VideoCameraOutlined />}
          loading={uploading}
          disabled={disabled || uploading}
          onClick={handleClick}
        >
          {uploading
            ? '上传中...'
            : placeholder || (type === 'image' ? '上传图片' : '上传视频')}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {renderPreview()}
    </div>
  )
}

export default TosUpload
