import React, { useRef, useState, useEffect } from 'react'
import { Button, Image, message } from 'antd'
import { DeleteOutlined, LoadingOutlined, PlusOutlined } from '@ant-design/icons'
import { uploadApi } from '../api'

interface ImagesUploadProps {
  /** 当前图片URL数组 */
  value?: string[]
  /** 值变化回调 */
  onChange?: (value: string[]) => void
  /** 最大数量，默认9 */
  maxCount?: number
  /** 占位提示文字 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义文件名（如产品编码），不含扩展名；也可传入函数动态生成 */
  customName?: string | ((file: File, index: number) => string)
}

const ImagesUpload: React.FC<ImagesUploadProps> = ({
  value = [],
  onChange,
  maxCount = 9,
  placeholder,
  disabled,
  customName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const activeIndexRef = useRef<number | null>(null)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [previewImages, setPreviewImages] = useState<string[]>(value || [])

  useEffect(() => {
    setPreviewImages(value || [])
  }, [value])

  const defaultMaxSize = 10 * 1024 * 1024
  const accept = '.jpg,.jpeg,.png,.gif,.webp,.bmp'
  const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

  const validateFile = (file: File): boolean => {
    if (file.size > defaultMaxSize) {
      message.error('图片大小不能超过 10MB')
      return false
    }
    const fileName = file.name.toLowerCase()
    const matched = allowedExt.some((ext) => fileName.endsWith(ext))
    if (!matched) {
      message.error(`不支持的图片格式，允许：${allowedExt.join(', ')}`)
      return false
    }
    return true
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    let targetIndex = activeIndexRef.current ?? previewImages.length
    if (targetIndex < 0) targetIndex = 0
    if (targetIndex > previewImages.length) targetIndex = previewImages.length

    // 数量校验
    if (targetIndex >= previewImages.length) {
      if (previewImages.length + fileList.length > maxCount) {
        message.warning(`最多上传 ${maxCount} 张图片`)
        activeIndexRef.current = null
        return
      }
    } else if (fileList.length > maxCount) {
      message.warning(`最多上传 ${maxCount} 张图片`)
      activeIndexRef.current = null
      return
    }

    setUploadingIndex(targetIndex)
    const newImages = [...previewImages]
    let successCount = 0

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      if (!validateFile(file)) continue

      try {
        // 生成自定义文件名：函数形式直接调用，字符串形式追加时间戳和序号避免覆盖
        let uploadCustomName: string | undefined
        if (typeof customName === 'function') {
          uploadCustomName = customName(file, i)
        } else if (customName) {
          uploadCustomName = `${customName}_${Date.now()}_${i}`
        }
        const res = await uploadApi.uploadImage(file, uploadCustomName)
        const payload = res?.data
        const url = payload?.data?.url || payload?.url

        if (url) {
          const idx = targetIndex + i
          const oldUrl = idx >= 0 && idx < newImages.length ? newImages[idx] : undefined
          if (idx >= 0 && idx < newImages.length) {
            newImages[idx] = url
          } else {
            newImages.push(url)
          }
          successCount++
          if (oldUrl && oldUrl !== url) {
            uploadApi.deleteFile(oldUrl).catch(() => {})
          }
        } else {
          message.error(`第 ${i + 1} 张图片上传失败：未获取到URL`)
        }
      } catch (e: any) {
        const errMsg = e?.response?.data?.detail || e?.message || '上传失败'
        message.error(`第 ${i + 1} 张图片${errMsg}`)
      }
    }

    setPreviewImages(newImages)
    onChange?.(newImages)
    if (successCount > 0) {
      message.success(`成功上传 ${successCount} 张图片`)
    }
    setUploadingIndex(null)
    activeIndexRef.current = null
    e.target.value = ''
  }

  const handleRemove = (index: number) => {
    const removedUrl = previewImages[index]
    const newImages = previewImages.filter((_, i) => i !== index)
    setPreviewImages(newImages)
    onChange?.(newImages)
    if (removedUrl) {
      uploadApi.deleteFile(removedUrl).catch(() => {})
    }
  }

  const handleAdd = () => {
    if (previewImages.length >= maxCount) {
      message.warning(`最多上传 ${maxCount} 张图片`)
      return
    }
    activeIndexRef.current = previewImages.length
    setUploadingIndex(previewImages.length)
    inputRef.current?.click()
  }

  const handleReplace = (index: number) => {
    if (disabled) return
    activeIndexRef.current = index
    setUploadingIndex(index)
    inputRef.current?.click()
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {previewImages.map((url, index) => (
          <div
            key={`${url}-${index}`}
            style={{
              position: 'relative',
              width: 100,
              height: 100,
              borderRadius: 4,
              border: '1px solid #f0f0f0',
              overflow: 'hidden',
            }}
          >
            <Image
              src={url}
              width={100}
              height={100}
              style={{ objectFit: 'cover' }}
              placeholder={
                <div
                  style={{
                    width: 100,
                    height: 100,
                    background: '#f0f0f0',
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
              <>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemove(index)}
                  style={{ position: 'absolute', top: -8, right: -8, borderRadius: '50%' }}
                />
                <div
                  onClick={() => handleReplace(index)}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 24,
                    background: 'rgba(0,0,0,0.5)',
                    color: '#fff',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {uploadingIndex === index ? <LoadingOutlined /> : '替换'}
                </div>
              </>
            )}
          </div>
        ))}
        {previewImages.length < maxCount && !disabled && (
          <div
            onClick={handleAdd}
            style={{
              width: 100,
              height: 100,
              borderRadius: 4,
              border: '1px dashed #d9d9d9',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#999',
            }}
          >
            {uploadingIndex === previewImages.length ? <LoadingOutlined /> : <PlusOutlined />}
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {placeholder || '上传图片'}
            </div>
            <div style={{ fontSize: 11 }}>
              {previewImages.length}/{maxCount}
            </div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFileChange(e)}
      />
    </div>
  )
}

export default ImagesUpload
