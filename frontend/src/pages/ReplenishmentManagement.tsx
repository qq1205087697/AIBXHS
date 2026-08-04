import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, message, Space, Tag, Divider, Dropdown, Menu, Pagination, Row, Col } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, CheckOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, DownOutlined, RightOutlined, AppstoreOutlined, LinkOutlined, CloseCircleFilled, CloseCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { replenishmentOrdersApi, productsApi, productBindingsApi, storeGroupsApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import dayjs from 'dayjs'
import type { MenuProps } from 'antd'

// CSS样式：悬停删除图标
const styleSheet = `
  .product-select-wrapper:hover .product-clear-icon {
    opacity: 1 !important;
  }
  .product-clear-icon:hover {
    color: #333 !important;
  }
  /* 隐藏Select自带的下拉箭头 */
  .product-select-with-value .ant-select-arrow {
    display: none !important;
  }
`
// 注入样式
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style')
  styleElement.innerHTML = styleSheet
  if (!document.head.querySelector('style[data-product-clear-icon]')) {
    styleElement.setAttribute('data-product-clear-icon', 'true')
    document.head.appendChild(styleElement)
  }
}

const { TextArea } = Input

interface ReplenishmentOrder {
  id: number
  order_number: string
  platform?: string // 向后兼容
  store_group_id?: number // 新增
  store_group_name?: string // 新增
  status: string
  notes: string
  created_at: string
  creator_name: string
  approved_by?: number
  approver_name?: string
  approved_at?: string
  purchase_order_id?: number
  items: ReplenishmentOrderItem[]
}

interface ReplenishmentOrderItem {
  id: number
  product_id: number
  parent_product_id?: number | null
  product_name: string
  product_code: string
  quantity: number
  notes: string
}

interface Product {
  id: number
  name: string
  product_code: string
  purchase_price: number | null
  product_type?: string | string[]
}

interface FormItemState {
  key: string
  product_id: number | null
  quantity: number
  notes: string
  parent_product_id?: number | null
  parentKey?: string  // 配件行关联的成品行key
  base_quantity_per_product?: number  // 每1个成品需要的配件基础数量
}

const statusLabelMap: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
  purchased: '已采购',
  completed: '已完成',
  cancelled: '已取消',
  PENDING: '待审批',
  APPROVED: '已审批',
  PURCHASED: '已采购',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

const platformOptions = [
  { label: 'Amazon', value: 'amazon' },
  { label: 'eBay', value: 'ebay' },
  { label: 'Walmart', value: 'walmart' },
  { label: 'Shopify', value: 'shopify' },
  { label: 'Shopee', value: 'shopee' },
  { label: 'Lazada', value: 'lazada' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Temu', value: 'temu' },
  { label: '其他', value: 'other' },
]

const platformLabelMap: Record<string, string> = Object.fromEntries(platformOptions.map(p => [p.value, p.label]))

const platformColorMap: Record<string, string> = {
  amazon: 'orange',
  ebay: 'blue',
  walmart: 'yellow',
  shopify: 'green',
  shopee: 'red',
  lazada: 'purple',
  tiktok: 'cyan',
  temu: 'volcano',
  other: 'default',
}

const statusColorMap: Record<string, string> = {
  pending: 'orange',
  approved: 'blue',
  purchased: 'cyan',
  completed: 'green',
  cancelled: 'red',
}

const statusFilterOptions = [
  { label: '全部', value: '' },
  { label: '待审批', value: 'pending' },
  { label: '已审批', value: 'approved' },
  { label: '已采购', value: 'purchased' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
]

const platformFilterOptions = [
  { label: '全部平台', value: '' },
  ...platformOptions,
]

let itemKeyCounter = 0
const generateItemKey = () => `item_${Date.now()}_${++itemKeyCounter}`

const createEmptyFormItem = (): FormItemState => ({
  key: generateItemKey(),
  product_id: null,
  quantity: 1,
  notes: '',
  parent_product_id: null,
})

const ReplenishmentManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const { hasPermission, isAdmin } = useAuth()
  const [orders, setOrders] = useState<ReplenishmentOrder[]>([])
  const [productList, setProductList] = useState<Product[]>([])
  const [storeGroups, setStoreGroups] = useState<any[]>([]) // 店铺分组列表
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<ReplenishmentOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<ReplenishmentOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [platformFilter, setPlatformFilter] = useState<string | undefined>(undefined)
  const [groupFilter, setGroupFilter] = useState<number | undefined>(undefined) // 店铺分组筛选
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<FormItemState[]>([createEmptyFormItem()])
  const [expandedAccessories, setExpandedAccessories] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  // 产品搜索关键字（用于懒加载搜索）
  const [productSearchKeyword, setProductSearchKeyword] = useState('')
  // 产品分页状态（用于懒加载）
  const [productPagination, setProductPagination] = useState({ current: 1, pageSize: 50, total: 0, hasMore: true })
  // 产品搜索防抖定时器
  const productSearchTimeoutRef = useRef<number | null>(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [previewOrderInfo, setPreviewOrderInfo] = useState<Record<string, any>>({})
  const [previewPlatform, setPreviewPlatform] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  // 一键生成采购单弹窗
  const [convertModalOpen, setConvertModalOpen] = useState(false)
  const [convertForm] = Form.useForm()
  const [converting, setConverting] = useState(false)
  // 转换结果弹窗
  const [convertResultOpen, setConvertResultOpen] = useState(false)
  const [convertResult, setConvertResult] = useState<any>(null)

  useEffect(() => {
    fetchData()
    fetchStoreGroups()
  }, [])

  const fetchStoreGroups = async () => {
    try {
      const res = await storeGroupsApi.getList()
      if (res.data.success) {
        setStoreGroups(res.data.data || [])
      }
    } catch (e) {
      console.error('加载店铺分组失败', e)
    }
  }

  useEffect(() => {
    fetchData()
  }, [pagination.current, pagination.pageSize, filters])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await replenishmentOrdersApi.getList({
        page: pagination.current,
        page_size: pagination.pageSize,
        ...filters,
      })
      if (res.data.success) {
        setOrders(res.data.data)
        setPagination((prev) => ({ ...prev, total: res.data.total }))
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  const fetchProducts = async (keyword: string = '', page: number = 1, append: boolean = false) => {
    setProductsLoading(true)
    try {
      const res = await productsApi.getList({
        page: page,
        page_size: productPagination.pageSize,
        search: keyword || undefined, // 支持搜索参数
      })
      if (res.data.success) {
        const newProducts = res.data.data || []
        if (append) {
          // 滚动加载更多：追加到现有列表
          setProductList(prev => [...prev, ...newProducts])
        } else {
          // 搜索或首次加载：替换现有列表
          setProductList(newProducts)
        }
        setProductPagination(prev => ({
          ...prev,
          current: page,
          total: res.data.total || 0,
          hasMore: newProducts.length === prev.pageSize && page < Math.ceil((res.data.total || 0) / prev.pageSize)
        }))
      }
    } catch {
      message.error('获取产品列表失败')
    } finally {
      setProductsLoading(false)
    }
  }

  // 产品搜索处理函数（带防抖）
  const handleProductSearch = (keyword: string) => {
    setProductSearchKeyword(keyword)

    // 清除之前的定时器
    if (productSearchTimeoutRef.current) {
      clearTimeout(productSearchTimeoutRef.current)
    }

    // 设置新的定时器（300ms防抖）
    productSearchTimeoutRef.current = window.setTimeout(() => {
      // 重置分页，重新搜索
      setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))

      // 如果关键字为空，清空搜索状态并恢复初始产品列表
      if (!keyword || keyword.trim() === '') {
        fetchProducts('', 1, false)
      } else {
        fetchProducts(keyword, 1, false)
      }
    }, 300)
  }

  // 产品滚动加载处理函数（加载下一页）
  const handleProductScrollLoad = () => {
    if (productsLoading || !productPagination.hasMore) return

    const nextPage = productPagination.current + 1
    fetchProducts(productSearchKeyword, nextPage, true)
  }

  const handleSearch = useCallback((value: string) => {
    setSearchText(value)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      setFilters((prev) => {
        const next: Record<string, any> = { ...prev }
        if (value) {
          next.search = value
        } else {
          delete next.search
        }
        return next
      })
      setPagination((prev) => ({ ...prev, current: 1 }))
    }, 300)
  }, [])

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const handleStatusFilter = (value: string | undefined) => {
    setStatusFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (value) {
        next.status = value
      } else {
        delete next.status
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handlePlatformFilter = (value: string | undefined) => {
    setPlatformFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (value) {
        next.platform = value
      } else {
        delete next.platform
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleCreate = () => {
    setEditingOrder(null)
    setViewingOrder(null)
    const orderNumber = `RO${dayjs().format('YYYYMMDDHHmmss')}`
    form.setFieldsValue({
      order_number: orderNumber,
      store_group_id: undefined,
      notes: '',
    })
    setFormItems([createEmptyFormItem()])
    setExpandedAccessories(new Set())

    // 重置产品搜索状态
    setProductSearchKeyword('')
    setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
    fetchProducts('', 1, false)  // 恢复初始产品列表

    setModalOpen(true)
  }

  const handleView = async (order: ReplenishmentOrder) => {
    setViewingOrder(order)
    setEditingOrder(null)
    try {
      const res = await replenishmentOrdersApi.getDetail(order.id)
      if (res.data.success) {
        const detail = res.data.data
        form.setFieldsValue({
          order_number: detail.order_number,
          store_group_id: detail.store_group_id,
          platform: detail.platform || undefined,
          notes: detail.notes,
        })
        if (detail.items && detail.items.length > 0) {
          const orderProducts = detail.items.map((item: any) => ({
            id: Number(item.product_id),
            name: item.product_name || '',
            product_code: item.product_code || '',
          }))
          setProductList(orderProducts)
          const items = detail.items.map((item: any) => ({
            key: generateItemKey(),
            product_id: Number(item.product_id) || null,
            quantity: item.quantity,
            notes: item.notes || '',
            parent_product_id: item.parent_product_id ?? null,
          }))
          setFormItems(items)
        } else {
          setProductList([])
          setFormItems([createEmptyFormItem()])
        }
      }
    } catch {
      form.setFieldsValue({
        order_number: order.order_number,
        store_group_id: order.store_group_id,
        notes: order.notes,
      })
      setProductList([])
      setFormItems([createEmptyFormItem()])
    }
    setModalOpen(true)
  }

  const handleEdit = async (order: ReplenishmentOrder) => {
    setViewingOrder(null)
    setEditingOrder(order)
    try {
      const res = await replenishmentOrdersApi.getDetail(order.id)
      if (res.data.success) {
        const detail = res.data.data
        form.setFieldsValue({
          order_number: detail.order_number,
          store_group_id: detail.store_group_id,
          platform: detail.platform || undefined,
          notes: detail.notes,
        })
        if (detail.items && detail.items.length > 0) {
          const orderProducts = detail.items.map((item: any) => ({
            id: Number(item.product_id),
            name: item.product_name || '',
            product_code: item.product_code || '',
          }))
          setProductList(orderProducts)
          const items = detail.items.map((item: any) => ({
            key: generateItemKey(),
            product_id: Number(item.product_id) || null,
            quantity: item.quantity,
            notes: item.notes || '',
            parent_product_id: item.parent_product_id ?? null,
          }))
          setFormItems(items)
        } else {
          setFormItems([createEmptyFormItem()])
        }
      }
    } catch {
      form.setFieldsValue({
        order_number: order.order_number,
        store_group_id: order.store_group_id,
        notes: order.notes,
      })
      setFormItems([createEmptyFormItem()])
    }
    // 后台异步加载完整产品列表（不阻塞弹窗打开）
    setProductSearchKeyword('')
    setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
    fetchProducts('', 1, false)
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)

      const validItems = formItems.filter((item) => item.product_id != null && item.quantity > 0)
      if (validItems.length === 0) {
        message.warning('请至少添加一条补货明细')
        setSubmitting(false)
        return
      }
      const items = validItems.map((item) => ({
        product_id: item.product_id!,
        parent_product_id: item.parent_product_id || null,
        quantity: item.quantity,
        notes: item.notes || '',
      }))

      const payload: Record<string, any> = {
        order_number: values.order_number,
        store_group_id: values.store_group_id,
        notes: values.notes,
        items,
      }

      if (editingOrder) {
        await replenishmentOrdersApi.update(editingOrder.id, payload)
        message.success('补货单更新成功')
      } else {
        await replenishmentOrdersApi.create(payload)
        message.success('补货单创建成功')
      }

      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      const msg = e?.response?.data?.detail || e?.message || '操作失败'
      message.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此补货单吗？此操作不可恢复。',
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await replenishmentOrdersApi.delete(id)
          message.success('补货单删除成功')
          fetchData()
        } catch (e: any) {
          const msg = e?.response?.data?.detail || '删除失败'
          message.error(msg)
        }
      },
    })
  }

  const handleBatchDelete = () => {
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条补货单吗？此操作不可恢复。`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await replenishmentOrdersApi.batchDelete(selectedRowKeys as number[])
          if (res.data.success) {
            message.success(res.data.message || '批量删除成功')
            setSelectedRowKeys([])
            fetchData()
          }
        } catch (e: any) {
          const msg = e?.response?.data?.detail || '批量删除失败'
          message.error(msg)
        }
      },
    })
  }

  const handleAddFormItem = () => {
    setFormItems((prev) => [...prev, createEmptyFormItem()])
  }

  const handleRemoveFormItem = (key: string) => {
    setFormItems((prev) => {
      if (prev.length <= 1) return prev
      // 如果删除的是成品行，同时删除其配件行
      return prev.filter((item) => item.key !== key && item.parentKey !== key)
    })
    setExpandedAccessories((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const toggleAccessoryExpansion = (parentKey: string) => {
    setExpandedAccessories((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(parentKey)) {
        newSet.delete(parentKey)
      } else {
        newSet.add(parentKey)
      }
      return newSet
    })
  }

  const handleFormItemChange = (key: string, field: keyof FormItemState, value: any) => {
    setFormItems((prev) => {
      const updated = prev.map((item) => {
        if (item.key !== key) return item
        return { ...item, [field]: value }
      })

      // 成品数量变化时，同步更新其配件数量
      if (field === 'quantity') {
        const changedItem = updated.find((item) => item.key === key)
        if (changedItem && !changedItem.parentKey) {
          // 这是成品行，更新其配件
          return updated.map((item) => {
            if (item.parentKey !== key) return item
            const baseQty = item.base_quantity_per_product || 1
            return { ...item, quantity: (value || 0) * baseQty }
          })
        }
      }

      return updated
    })

    // 选择产品时自动带出配件
    if (field === 'product_id' && value) {
      fetchAccessoriesAndAdd(key, value)
    }
  }

  const fetchAccessoriesAndAdd = async (parentKey: string, productId: number) => {
    try {
      const res = await productBindingsApi.getByFinished(productId)
      if (res.data.success && res.data.data && res.data.data.length > 0) {
        const accessories = res.data.data
        // 获取当前成品行的数量
        setFormItems((prev) => {
          const parentItem = prev.find((item) => item.key === parentKey)
          if (!parentItem) return prev
          const parentQty = parentItem.quantity || 1

          // 检查是否已有该成品的配件
          const existingAccessoryKeys = new Set(
            prev.filter((item) => item.parentKey === parentKey).map((item) => item.product_id)
          )

          const accessoryItems: FormItemState[] = []
          for (const acc of accessories) {
            if (existingAccessoryKeys.has(acc.accessory_product_id)) continue
            accessoryItems.push({
              key: generateItemKey(),
              product_id: acc.accessory_product_id,
              quantity: parentQty * (acc.quantity || 1),
              notes: '',
              parent_product_id: productId,
              parentKey: parentKey,
              base_quantity_per_product: acc.quantity || 1,
            })
          }

          if (accessoryItems.length === 0) return prev

          // 在成品行后面插入配件行
          const parentIndex = prev.findIndex((item) => item.key === parentKey)
          const newItems = [...prev]
          newItems.splice(parentIndex + 1, 0, ...accessoryItems)
          return newItems
        })

        // 将配件产品信息添加到 productList 中，确保显示时能找到产品信息
        setProductList((prev) => {
          const newProducts = [...prev]
          for (const acc of accessories) {
            // 检查是否已存在该配件产品
            if (!newProducts.some((p) => p.id === acc.accessory_product_id)) {
              newProducts.push({
                id: acc.accessory_product_id,
                name: acc.accessory_name || '',
                product_code: acc.accessory_code || '',
                purchase_price: null,
              })
            }
          }
          return newProducts
        })

        setExpandedAccessories((prev) => new Set(prev).add(parentKey))
      }
    } catch (e) {
      console.error('获取成品配件失败:', e)
    }
  }

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await replenishmentOrdersApi.downloadTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '补货单模板_' + new Date().toISOString().split('T')[0] + '.xlsx')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success('模板下载成功')
    } catch (e: any) {
      console.error('下载模板失败', e)
      message.error('模板下载失败: ' + (e.message || '未知错误'))
    }
  }, [])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const res = await replenishmentOrdersApi.uploadPreview(file)
      if (res.data.success) {
        setPreviewItems(res.data.data || [])
        setPreviewOrderInfo(res.data.order_info || {})
        setPreviewPlatform(undefined)
        setPreviewModalOpen(true)
      } else {
        message.error(res.data.message || '文件解析失败')
      }
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '文件上传失败'
      message.error(errorMsg, 8)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleConfirmImport = () => {
    setPreviewModalOpen(false)
    handleCreate()
    setTimeout(() => {
      const newItems: FormItemState[] = []
      const newExpandedKeys = new Set<string>()
      for (const item of previewItems) {
        const parentKey = generateItemKey()
        // 成品行
        newItems.push({
          key: parentKey,
          product_id: item.product_id || null,
          quantity: item.quantity || 1,
          notes: item.notes || '',
          parent_product_id: null,
        })
        // 配件行
        const bindings = item.bindings || []
        if (bindings.length > 0) {
          newExpandedKeys.add(parentKey)
          for (const b of bindings) {
            newItems.push({
              key: generateItemKey(),
              product_id: b.accessory_product_id || null,
              quantity: (item.quantity || 1) * (b.qty || 1),
              notes: '',
              parent_product_id: item.product_id || null,
              parentKey: parentKey,
              base_quantity_per_product: b.qty || 1,
            })
          }
        }
      }
      if (newItems.length === 0) {
        newItems.push(createEmptyFormItem())
      }
      setFormItems(newItems)
      setExpandedAccessories(newExpandedKeys)
      message.success('导入成功，请选择平台后提交')
    }, 100)
  }

  // 选中的已审批补货单（只有已审批才能转采购单）
  const selectedApprovedOrders = orders.filter(
    (order) => selectedRowKeys.includes(order.id)
      && (order.status === 'approved' || order.status === 'APPROVED')
      && !order.purchase_order_id
  )

  // 审批补货单
  const handleApprove = async (order: ReplenishmentOrder) => {
    Modal.confirm({
      title: '确认审批',
      content: `确定要审批补货单 ${order.order_number} 吗？审批后才能转采购单。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await replenishmentOrdersApi.approve(order.id)
          if (res.data.success) {
            message.success('审批成功')
            fetchData()
          } else {
            message.error(res.data.message || '审批失败')
          }
        } catch (e: any) {
          const msg = e?.response?.data?.detail || e?.message || '审批失败'
          message.error(msg)
        }
      },
    })
  }

  // 取消审批补货单（管理员）
  const handleCancelApproval = async (order: ReplenishmentOrder) => {
    Modal.confirm({
      title: '取消审批',
      content: `确定要取消补货单 ${order.order_number} 的审批状态吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await replenishmentOrdersApi.cancelApproval(order.id)
          if (res.data.success) {
            message.success('取消审批成功')
            fetchData()
          } else {
            message.error(res.data.message || '取消审批失败')
          }
        } catch (e: any) {
          const msg = e?.response?.data?.detail || e?.message || '取消审批失败'
          message.error(msg)
        }
      },
    })
  }

  const handleSingleConvert = (order: ReplenishmentOrder) => {
    if (order.status !== 'approved' && order.status !== 'APPROVED') {
      message.warning('请先审批补货单，审批后才能转采购单')
      return
    }
    Modal.confirm({
      title: '确认转采购单',
      content: `确定要将补货单 ${order.order_number} 转为采购单吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await replenishmentOrdersApi.batchConvert({
            ids: [order.id],
          })
          if (res.data.success) {
            message.success('已生成采购单，采购单审批后补货单将自动变为已采购')
            fetchData()
          } else {
            message.error(res.data.message || '转采购单失败')
          }
        } catch (e: any) {
          const msg = e?.response?.data?.detail || e?.message || '转采购单失败'
          message.error(msg)
        }
      },
    })
  }

  const handleOpenConvert = () => {
    if (selectedApprovedOrders.length === 0) {
      message.warning('选中的补货单中没有可转采购单的（只有已审批且未关联采购单的才能转）')
      return
    }
    convertForm.resetFields()
    setConvertModalOpen(true)
    message.info(`已选 ${selectedApprovedOrders.length} 条补货单，同店铺分组将合并为同一张采购单`)
  }

  const handleBatchConvert = async () => {
    try {
      const values = await convertForm.validateFields()
      setConverting(true)
      const res = await replenishmentOrdersApi.batchConvert({
        ids: selectedApprovedOrders.map((o) => o.id),
        notes: values.notes,
      })
      if (res.data.success) {
        setConvertModalOpen(false)
        setConvertResult(res.data.data || res.data)
        setConvertResultOpen(true)
        setSelectedRowKeys([])
        fetchData()
      } else {
        message.error(res.data.message || '生成采购单失败')
      }
    } catch (e: any) {
      if (e.errorFields) return
      const msg = e?.response?.data?.detail || e?.message || '生成采购单失败'
      message.error(msg)
    } finally {
      setConverting(false)
    }
  }

  const columns: ColumnsType<ReplenishmentOrder> = [
    {
      title: '补货单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 170,
      render: (text: string, record: ReplenishmentOrder) => (
        <span
          style={{ color: '#1890ff', cursor: 'pointer' }}
          onClick={() => handleView(record)}
        >
          {text}
        </span>
      ),
    },
    {
      title: '店铺分组',
      dataIndex: 'store_group_name',
      key: 'store_group_name',
      width: 120,
      render: (name: string) => name || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => (
        <Tag color={statusColorMap[status] || 'default'}>
          {statusLabelMap[status] || status}
        </Tag>
      ),
    },
    {
      title: '明细数量',
      key: 'item_count',
      width: 90,
      align: 'center' as const,
      render: (_: any, record: any) => record.item_count || 0,
    },
    {
      title: '关联采购单',
      key: 'purchase_order',
      width: 150,
      render: (_: any, record: any) => record.purchase_order_number ? (
        <Tag color="blue">{record.purchase_order_number}</Tag>
      ) : '-',
    },
    {
      title: '创建人',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 100,
      render: (value: string) => value || '-',
    },
    {
      title: '审批人',
      dataIndex: 'approver_name',
      key: 'approver_name',
      width: 100,
      render: (value: string) => value || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      fixed: 'right',
      render: (_: any, record: ReplenishmentOrder) => {
        const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
          switch (key) {
            case 'view':
              handleView(record)
              break
            case 'edit':
              handleEdit(record)
              break
            case 'approve':
              handleApprove(record)
              break
            case 'delete':
              handleDelete(record.id)
              break
            case 'convert':
              handleSingleConvert(record)
              break
            case 'cancel-approval':
              handleCancelApproval(record)
              break
          }
        }

        const menuItems: MenuProps['items'] = []

        menuItems.push({
          key: 'view',
          label: (
            <span>
              <InfoCircleOutlined style={{ marginRight: 8 }} />
              查看
            </span>
          ),
        })

        if (record.status === 'pending' || record.status === 'PENDING') {
          menuItems.push({
            key: 'edit',
            label: (
              <span>
                <EditOutlined style={{ marginRight: 8 }} />
                编辑
              </span>
            ),
          })
        }

        // 转采购单：只有approved状态才能转
        if ((record.status === 'approved' || record.status === 'APPROVED') && !record.purchase_order_id) {
          menuItems.push({
            key: 'convert',
            label: (
              <span>
                <CheckOutlined style={{ marginRight: 8 }} />
                转采购单
              </span>
            ),
          })
        }

        menuItems.push({
          key: 'delete',
          label: (
            <span style={{ color: '#ff4d4f' }}>
              <DeleteOutlined style={{ marginRight: 8 }} />
              删除
            </span>
          ),
          style: { color: '#ff4d4f' },
        })

        // 取消审批选项：管理员且状态为已审批时显示
        if (isAdmin && (record.status === 'approved' || record.status === 'APPROVED')) {
          menuItems.push({
            key: 'cancel-approval',
            label: (
              <span>
                <CloseCircleOutlined style={{ marginRight: 8 }} />
                取消审批
              </span>
            ),
          })
        }

        const menu = <Menu onClick={handleMenuClick} items={menuItems} />

        return (
          <Space>
            {hasPermission('replenishment:approve') && (
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleApprove(record)}
                disabled={record.status !== 'pending' && record.status !== 'PENDING'}
              >
                审批
              </Button>
            )}
            <Dropdown overlay={menu} placement="bottomRight" trigger={['click']}>
              <Button size="small">
                操作
                <DownOutlined style={{ fontSize: 10, marginLeft: 4 }} />
              </Button>
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  const productOptions = productList.map((p) => ({
    label: `${p.product_code ? `[${p.product_code}] ` : ''}${p.name}`,
    value: p.id,
  }))

  // 如果正在加载更多，添加加载中提示
  if (productsLoading && productList.length > 0) {
    productOptions.push({
      label: <span style={{ color: '#999', fontSize: 12 }}>加载中...</span>,
      value: -1, // 使用-1作为加载项的标识
    } as any)
  }

  const formItemTotalQuantity = formItems.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Card
        loading={loading}
        title={
          <Space wrap size="middle">
            <Input
              placeholder="搜索补货单号..."
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 260 }}
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 140 }}
              value={statusFilter}
              onChange={handleStatusFilter}
              options={statusFilterOptions}
            />
            <Select
              placeholder="平台"
              allowClear
              style={{ width: 140 }}
              value={platformFilter}
              onChange={handlePlatformFilter}
              options={platformFilterOptions}
            />
          </Space>
        }
        extra={
          <Space>
            {hasPermission('replenishment:create') && (
              <>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  下载模板
                </Button>
                <Button icon={<UploadOutlined />} onClick={handleUploadClick} loading={uploading}>
                  导入Excel
                </Button>
              </>
            )}
            {(hasPermission('replenishment:convert') || hasPermission('replenishment:delete')) && (
              <Dropdown menu={{
                items: [
                  hasPermission('replenishment:convert') ? {
                    key: 'convert',
                    icon: <CheckOutlined />,
                    label: '批量生成采购单',
                    disabled: selectedApprovedOrders.length === 0,
                    onClick: handleOpenConvert,
                  } : null,
                  hasPermission('replenishment:delete') ? {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '批量删除',
                    danger: true,
                    disabled: selectedRowKeys.length === 0,
                    onClick: handleBatchDelete,
                  } : null,
                ].filter(Boolean) as any,
              }}>
                <Button>批量 <DownOutlined /></Button>
              </Dropdown>
            )}
            {hasPermission('replenishment:create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增补货单
              </Button>
            )}
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 16 }}
        styles={{ body: { flex: 1, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <Table
          dataSource={orders}
          columns={columns}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={false}
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys,
            onChange: (newSelectedRowKeys) => {
              setSelectedRowKeys(newSelectedRowKeys)
            },
          }}
        />
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8 }}>
        <Pagination
          current={pagination.current}
          pageSize={pagination.pageSize}
          total={pagination.total}
          showSizeChanger
          showQuickJumper
          showTotal={(total) => `共 ${total} 条`}
          onChange={(page, pageSize) =>
            setPagination((prev) => ({ ...prev, current: page, pageSize: pageSize || 20 }))
          }
        />
      </div>

      <Modal
        title={viewingOrder ? '查看补货单' : (editingOrder ? '编辑补货单' : '新增补货单')}
        open={modalOpen}
        onOk={viewingOrder ? () => setModalOpen(false) : handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText={viewingOrder ? '确定' : undefined}
        width={850}
        style={{ top: 20 }}
        styles={{ body: {
          maxHeight: 'calc(100vh - 180px)',
          overflow: 'auto',
          paddingRight: 8,
        } }}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="order_number" label="补货单号">
                <Input placeholder="自动生成" disabled />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="store_group_id"
                label="店铺分组"
                rules={[{ required: true, message: '请选择店铺分组' }]}
              >
                <Select
                  placeholder="请选择店铺分组"
                  options={storeGroups.map(g => ({ label: g.name, value: g.id }))}
                  disabled={!!viewingOrder}
                />
              </Form.Item>
            </Col>

          </Row>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} placeholder="请输入备注" disabled={!!viewingOrder} />
          </Form.Item>
        </Form>

        <Divider orientation="left">补货明细</Divider>

        {(() => {
          // 分离成品和配件
          const finishedItems = formItems.filter(item => !item.parentKey)
          const accessoryMap = new Map<string, FormItemState[]>()
          formItems.forEach(item => {
            if (item.parentKey) {
              if (!accessoryMap.has(item.parentKey)) {
                accessoryMap.set(item.parentKey, [])
              }
              accessoryMap.get(item.parentKey)!.push(item)
            }
          })

          // 渲染单个商品项的函数
          const renderItem = (item: FormItemState, isAccessory: boolean = false) => {
            const product = productList.find((p) => p.id === item.product_id)
            const hasAccessories = accessoryMap.has(item.key) && accessoryMap.get(item.key)!.length > 0
            const isExpanded = expandedAccessories.has(item.key)

            // 根据产品实际类型判断标签
            const productType = product?.product_type
            const typeList = Array.isArray(productType) ? productType : (productType ? productType.split(',') : [])
            const isFinishedProduct = typeList.includes('finished')

            return (
              <div key={item.key}>
                <div
                  style={{
                    marginBottom: isAccessory ? 0 : 16,
                    padding: 16,
                    borderRadius: 8,
                    background: isAccessory ? '#faf7f0' : '#ffffff',
                    border: isAccessory ? '1px dashed #d9d9d9' : '1px solid #e8e8e8',
                    marginLeft: isAccessory ? 40 : 0,
                    boxShadow: isAccessory ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
                  }}
                >
                  {/* 头部区域：标签 + 展开按钮 + 删除按钮 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isAccessory ? (
                        <Tag icon={<LinkOutlined />} color="orange" style={{ fontSize: 12 }}>
                          配件
                        </Tag>
                      ) : isFinishedProduct ? (
                        <Tag icon={<AppstoreOutlined />} color="blue" style={{ fontSize: 12 }}>
                          成品
                        </Tag>
                      ) : (
                        <Tag icon={<AppstoreOutlined />} color="default" style={{ fontSize: 12 }}>
                          商品
                        </Tag>
                      )}
                      {hasAccessories && !isAccessory && (
                        <Button
                          type="text"
                          size="small"
                          icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                          onClick={() => toggleAccessoryExpansion(item.key)}
                          style={{ padding: '0 4px', height: 22, fontSize: 12 }}
                        >
                          <Tag color="blue" style={{ fontSize: 11, marginRight: 0 }}>
                            {accessoryMap.get(item.key)!.length}个配件
                          </Tag>
                        </Button>
                      )}
                    </div>
                    {!viewingOrder && (
                      <Button
                        danger
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleRemoveFormItem(item.key)}
                        disabled={formItems.filter(i => !i.parentKey).length <= 1 && !item.parentKey}
                      />
                    )}
                  </div>

                  {/* 表单字段区域 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: 12, alignItems: 'end' }}>
                    <div>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>产品</div>
                      {isAccessory || viewingOrder ? (
                        <Input
                          value={product ? `${product.product_code ? `[${product.product_code}] ` : ''}${product.name}` : `产品#${item.product_id}`}
                          disabled
                          style={{ width: '100%', height: 32 }}
                        />
                      ) : (
                        <div className="product-select-wrapper" style={{ position: 'relative' }}>
                          <Select
                            className={item.product_id ? 'product-select-with-value' : ''}
                            placeholder="请选择产品"
                            showSearch
                            loading={productsLoading}
                            value={item.product_id}
                            onChange={(val) => {
                              // 防止选择加载中选项
                              if (val === -1) return
                              handleFormItemChange(item.key, 'product_id', val)
                            }}
                            onSearch={handleProductSearch}
                            filterOption={false} // 禁用本地过滤，使用后端搜索
                            onDropdownVisibleChange={(open) => {
                              if (open) {
                                // 下拉框打开时，如果有搜索关键字，清空并重新加载初始产品列表
                                if (productSearchKeyword) {
                                  setProductSearchKeyword('')
                                  setProductPagination({ current: 1, pageSize: 50, total: 0 })
                                  fetchProducts('', 1, false)
                                } else if (productList.length === 0) {
                                  // 如果没有搜索关键字且产品列表为空，加载初始产品列表
                                  fetchProducts('', 1, false)
                                }
                              }
                            }}
                            onPopupScroll={(e) => {
                              const target = e.target as HTMLDivElement
                              if (target.scrollTop + target.offsetHeight === target.scrollHeight) {
                                // 滚动到底部，加载更多
                                handleProductScrollLoad()
                              }
                            }}
                            options={productOptions}
                            style={{ width: '100%' }}
                            disabled={!!viewingOrder}
                            notFoundContent={
                              productsLoading ? <span>加载中...</span> :
                              productSearchKeyword ? <span>未找到匹配的产品</span> :
                              <span>暂无产品</span>
                            }
                          />
                          {/* 悬停删除图标 */}
                          {item.product_id && !viewingOrder && (
                            <div
                              className="product-clear-icon"
                              style={{
                                position: 'absolute',
                                right: 12,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                cursor: 'pointer',
                                opacity: 0,
                                transition: 'opacity 0.2s, color 0.2s',
                                color: '#999',
                                zIndex: 10,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleFormItemChange(item.key, 'product_id', null)
                                // 清空搜索状态并恢复初始产品列表
                                setProductSearchKeyword('')
                                setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
                                fetchProducts('', 1, false)
                              }}
                            >
                              <CloseCircleFilled style={{ fontSize: 14 }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>补货数量</div>
                      <InputNumber
                        min={1}
                        value={item.quantity}
                        onChange={(value) => handleFormItemChange(item.key, 'quantity', value || 0)}
                        style={{ width: '100%' }}
                        placeholder="数量"
                        disabled={!!viewingOrder}
                      />
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>备注</div>
                      <Input
                        value={item.notes}
                        onChange={(e) => handleFormItemChange(item.key, 'notes', e.target.value)}
                        placeholder="请输入备注"
                        disabled={!!viewingOrder}
                        style={{ width: '100%', height: 32, background: isAccessory ? '#fff' : '#fafafa' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          }

          // 遍历所有成品并渲染
          return finishedItems.map((item) => (
            <React.Fragment key={item.key}>
              {renderItem(item, false)}
              {/* 如果成品有配件且展开了，渲染配件 */}
              {accessoryMap.has(item.key) && expandedAccessories.has(item.key) &&
                accessoryMap.get(item.key)!.map((accessory) => renderItem(accessory, true))
              }
            </React.Fragment>
          ))
        })()}

        {!viewingOrder && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddFormItem}>
              添加产品
            </Button>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              合计数量：<span style={{ color: currentTheme.primary }}>{formItemTotalQuantity}</span>
            </span>
          </div>
        )}
      </Modal>

      <Modal
        title="预览导入数据"
        open={previewModalOpen}
        onOk={handleConfirmImport}
        onCancel={() => setPreviewModalOpen(false)}
        okText="确认导入"
        cancelText="取消"
        width={900}
      >
        <Table
          dataSource={previewItems}
          rowKey={(record, index) => String(index)}
          pagination={false}
          size="small"
          expandable={{
            rowExpandable: (record: any) => record.bindings && record.bindings.length > 0,
            expandedRowRender: (record: any) => (
              <div style={{ margin: 0 }}>
                {(!record.bindings || record.bindings.length === 0) ? (
                  <div style={{ padding: '12px 0', color: '#999' }}>无绑定配件</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#fafafa' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>配件编码</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>配件名称</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>绑定数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.bindings.map((b: any, bi: number) => (
                        <tr key={bi} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '6px 8px' }}>{b.code || '-'}</td>
                          <td style={{ padding: '6px 8px' }}>{b.name || '-'}</td>
                          <td style={{ padding: '6px 8px' }}>{b.qty || 0} × {(record.quantity || 0)} = {(b.qty || 0) * (record.quantity || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ),
          }}
          columns={[
            { title: '商品编码', dataIndex: 'product_code', key: 'product_code', width: 140 },
            { title: '商品名称', dataIndex: 'product_name', key: 'product_name', ellipsis: true },
            {
              title: '配件', dataIndex: 'bindings', key: 'bindings', width: 80,
              render: (v: any[]) => v && v.length > 0 ? <Tag color="orange">{v.length}个配件</Tag> : <span style={{ color: '#999' }}>-</span>,
            },
            { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 90 },
            { title: '备注', dataIndex: 'notes', key: 'notes', width: 140, render: (v: string) => v || '-' },
          ]}
        />
      </Modal>

      <Modal
        title="一键生成采购单"
        open={convertModalOpen}
        onOk={handleBatchConvert}
        onCancel={() => setConvertModalOpen(false)}
        confirmLoading={converting}
        okText="确认生成"
        cancelText="取消"
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>选中的补货单（{selectedApprovedOrders.length} 条）：</div>
          <Table
            dataSource={selectedApprovedOrders}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ y: 240 }}
            columns={[
              { title: '补货单号', dataIndex: 'order_number', key: 'order_number', width: 170 },
              {
                title: '店铺分组',
                dataIndex: 'store_group_name',
                key: 'store_group_name',
                width: 120,
                render: (name: string) => name || '-',
              },
              { title: '明细数', key: 'item_count', width: 80, align: 'center' as const, render: (_: any, r: ReplenishmentOrder) => r.items?.length || 0 },
            ]}
          />
        </div>
        <Form form={convertForm} layout="vertical">
          <Form.Item name="notes" label="备注">
            <TextArea rows={3} placeholder="请输入备注（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="生成采购单成功"
        open={convertResultOpen}
        onCancel={() => setConvertResultOpen(false)}
        footer={[<Button key="ok" type="primary" onClick={() => setConvertResultOpen(false)}>确定</Button>]}
        width={600}
      >
        <div style={{ marginBottom: 12 }}>
          已成功生成 {convertResult?.po_count || ''} 张采购单，采购单审批后补货单将自动变为已采购：
        </div>
        {convertResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.isArray(convertResult.purchase_order_numbers) ? (
              convertResult.purchase_order_numbers.map((num: string, idx: number) => (
                <Tag key={idx} color="green" style={{ fontSize: 14, padding: '4px 12px', width: 'fit-content' }}>{num}</Tag>
              ))
            ) : (
              <Tag color="green" style={{ fontSize: 14, padding: '4px 12px', width: 'fit-content' }}>
                {convertResult.purchase_order_number || '生成成功'}
              </Tag>
            )}
          </div>
        )}
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}

export default ReplenishmentManagement
