import React, { useEffect, useRef, useState } from 'react'
import { Modal, Select, message } from 'antd'
import { productsApi, aiCreationApi } from '../api'

interface ProductOption {
  id: number
  product_code: string
  name: string
}

/** 绑定视频至产品详情（AI视频页 / 高清处理页共用），选择产品后写入产品 videos 列表 */
const BindProductModal: React.FC<{
  open: boolean
  videoUrl: string
  onClose: () => void
}> = ({ open, videoUrl, onClose }) => {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productId, setProductId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const searchTimer = useRef<number | null>(null)

  const fetchProducts = async (kw: string) => {
    try {
      const res = await productsApi.getList({
        search: kw || undefined,
        page: 1,
        page_size: 50,
        product_type: 'finished',
      })
      const payload: any = res.data?.data
      const items: any[] = Array.isArray(payload) ? payload : payload?.items || []
      setProducts(items.map((p) => ({ id: p.id, product_code: p.product_code || '', name: p.name || '' })))
    } catch {
      message.error('获取产品列表失败')
    }
  }

  useEffect(() => {
    if (open) {
      setProductId(null)
      setProducts([])
      fetchProducts('')
    }
  }, [open])

  const handleSearch = (kw: string) => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => fetchProducts(kw), 300)
  }

  const handleOk = async () => {
    if (!productId || !videoUrl) {
      message.warning('请先选择产品')
      return
    }
    setSubmitting(true)
    try {
      await aiCreationApi.bindProductVideo(productId, videoUrl)
      message.success('视频已绑定至产品详情')
      onClose()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '绑定失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="绑定至产品"
      okText="确定"
      cancelText="取消"
      centered
      confirmLoading={submitting}
      okButtonProps={{ disabled: !productId }}
      onOk={handleOk}
      onCancel={onClose}
    >
      <Select
        showSearch
        allowClear
        filterOption={false}
        placeholder="搜索产品编码 / 品名"
        style={{ width: '100%' }}
        value={productId ?? undefined}
        onSearch={handleSearch}
        onChange={(v) => setProductId(v ?? null)}
        notFoundContent="无匹配产品"
        options={products.map((p) => ({
          value: p.id,
          label: p.product_code ? `[${p.product_code}] ${p.name}` : p.name,
        }))}
      />
    </Modal>
  )
}

export default BindProductModal
