import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Popconfirm, Space, Tag, Divider, Dropdown, Menu, Pagination, Row, Col } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, CheckOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, MoreOutlined, DownOutlined, MinusCircleOutlined, AppstoreOutlined, LinkOutlined, RightOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { purchaseOrdersApi, productsApi, warehousesApi, productBindingsApi, storeGroupsApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type { MenuProps } from 'antd'
const { RangePicker } = DatePicker
const { TextArea } = Input

interface PurchaseOrder {
  id: number
  order_number: string
  platform?: string // 向后兼容
  store_group_id?: number // 新增
  store_group_name?: string // 新增
  total_amount: number
  status: string
  notes: string
  created_at: string
  approved_at: string
  approved_by: number | null
  creator_name: string
  approver_name: string
  total_ordered?: number
  total_received?: number
  items: PurchaseOrderItem[]
}

interface PurchaseOrderItem {
  id: number
  product_id: number
  product_name: string
  product_code: string
  quantity: number
  received_quantity: number
  unit_price: number
  total_price: number
  notes: string
  supplier?: string
}

interface Product {
  id: number
  name: string
  product_code: string
  purchase_price: number | null
}

interface FormItemState {
    key: string
    product_id: number | null
    quantity: number
    unit_price: number
    parentKey?: string  // 配件行关联的成品行key
    base_quantity_per_product?: number  // 每1个成品需要的配件基础数量
    supplier?: string  // 供应商
    notes?: string  // 备注
}

interface WarehouseItem {
    id: number
    name: string
    code: string
    status: string
}

const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已审批',
  ordered: '已下单',
  partial_received: '部分收货',
  pending_reshipment: '待补发',
  completed: '已完成',
  cancelled: '已取消',
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
  draft: 'default',
  pending: 'processing',
  approved: 'blue',
  ordered: 'cyan',
  partial_received: 'orange',
  pending_reshipment: 'purple',
  completed: 'success',
  cancelled: 'error',
}

const statusFilterOptions = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '待审批', value: 'pending' },
  { label: '已审批', value: 'approved' },
  { label: '已下单', value: 'ordered' },
  { label: '部分收货', value: 'partial_received' },
  { label: '待补发', value: 'pending_reshipment' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
]

let itemKeyCounter = 0
const generateItemKey = () => `item_${Date.now()}_${++itemKeyCounter}_${Math.random().toString(36).substr(2, 9)}`

const createEmptyFormItem = (): FormItemState => ({
  key: generateItemKey(),
  product_id: null,
  quantity: 1,
  unit_price: 0,
  supplier: '',
  notes: '',
})

const PurchaseManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const { hasPermission, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [productList, setProductList] = useState<Product[]>([])
  const [warehouseList, setWarehouseList] = useState<WarehouseItem[]>([])
  const [storeGroups, setStoreGroups] = useState<any[]>([]) // 店铺分组列表
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [groupFilter, setGroupFilter] = useState<number | undefined>(undefined) // 店铺分组筛选
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<FormItemState[]>([createEmptyFormItem()])
  const [submitting, setSubmitting] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [previewOrderInfo, setPreviewOrderInfo] = useState<Record<string, any>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  // 入库详情弹窗
  const [stockDetailModalOpen, setStockDetailModalOpen] = useState(false)
  const [stockDetailOrder, setStockDetailOrder] = useState<PurchaseOrder | null>(null)
  const [expandedAccessories, setExpandedAccessories] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchData()
    fetchProducts()
    fetchWarehouses()
    fetchStoreGroups()
  }, [pagination.current, pagination.pageSize, filters])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await purchaseOrdersApi.getList({
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

  const fetchProducts = async () => {
    setProductsLoading(true)
    try {
      const res = await productsApi.getList({ page: 1, page_size: 500 })
      if (res.data.success) {
        setProductList(res.data.data || [])
      }
    } catch {
      message.error('获取产品列表失败')
    } finally {
      setProductsLoading(false)
    }
  }

  const fetchWarehouses = async () => {
    try {
      const res = await warehousesApi.getList({ page_size: 100 })
      console.log('Warehouses loaded:', res.data.data) // 调试信息
      setWarehouseList(res.data.data || []) // 不过滤状态，显示所有仓库
    } catch (error) {
      console.error('Failed to load warehouses:', error)
    }
  }

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
      const next: Record<string, any> = { ...prev, status: value }
      if (!value) {
        delete next.status
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleGroupFilter = (value: number | undefined) => {
    setGroupFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (value) {
        next.store_group_id = value
      } else {
        delete next.store_group_id
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleDateRangeChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    setDateRange(dates)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (dates && dates[0] && dates[1]) {
        next.start_date = dates[0].format('YYYY-MM-DD')
        next.end_date = dates[1].format('YYYY-MM-DD')
      } else {
        delete next.start_date
        delete next.end_date
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleCreate = () => {
    setEditingOrder(null)
    setViewingOrder(null)
    const orderNumber = `PO${dayjs().format('YYYYMMDDHHmmss')}`
    form.setFieldsValue({
      order_number: orderNumber,
      store_group_id: undefined,
      warehouse: undefined,
      notes: '',
    })
    setFormItems([createEmptyFormItem()])
    setExpandedAccessories(new Set())
    fetchProducts()
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleView = async (order: PurchaseOrder) => {
    setViewingOrder(order)
    setEditingOrder(null)
    form.setFieldsValue({
      order_number: order.order_number,
      store_group_id: (order as any).store_group_id || undefined,
      warehouse: (order as any).warehouse,
      notes: order.notes,
    })
    // 用订单中的产品信息构建选项（后端已返回product_name和product_code）
    if (order.items && order.items.length > 0) {
      const orderProducts = order.items.map((item: any) => ({
        id: Number(item.product_id),
        name: item.product_name || '',
        product_code: item.product_code || '',
        purchase_price: item.unit_price || null,
      }))
      setProductList(orderProducts)
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: Number(item.product_id) || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        supplier: item.supplier || '',
        notes: item.notes || '',
      }))
      setFormItems(items)
    } else {
      setProductList([])
      setFormItems([createEmptyFormItem()])
    }
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleEdit = async (order: PurchaseOrder) => {
    setViewingOrder(null)
    setEditingOrder(order)
    form.setFieldsValue({
      order_number: order.order_number,
      store_group_id: (order as any).store_group_id || undefined,
      warehouse: (order as any).warehouse,
      notes: order.notes,
    })
    // 用订单中的产品信息构建选项，同时后台加载完整列表供编辑时选择新商品
    if (order.items && order.items.length > 0) {
      const orderProducts = order.items.map((item: any) => ({
        id: Number(item.product_id),
        name: item.product_name || '',
        product_code: item.product_code || '',
        purchase_price: item.unit_price || null,
      }))
      setProductList(orderProducts)
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: Number(item.product_id) || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        supplier: item.supplier || '',
        notes: item.notes || '',
      }))
      setFormItems(items)
    } else {
      setFormItems([createEmptyFormItem()])
    }
    // 后台异步加载完整产品列表（不阻塞弹窗打开）
    fetchProducts()
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)

      const validItems = formItems.filter((item) => item.product_id != null && item.quantity > 0)
      if (validItems.length === 0) {
        message.warning('请至少添加一个采购商品')
        setSubmitting(false)
        return
      }
      const items = validItems.map((item) => ({
        product_id: item.product_id!,
        quantity: item.quantity,
        unit_price: item.unit_price,
        supplier: item.supplier || '',
        notes: item.notes || '',
      }))

      if (editingOrder) {
        const payload: Record<string, any> = {
          order_number: values.order_number,
          store_group_id: values.store_group_id || null,
          warehouse: values.warehouse,
          notes: values.notes,
          items,
        }
        await purchaseOrdersApi.update(editingOrder.id, payload)
        message.success('采购订单更新成功')
      } else {
        const payload: Record<string, any> = {
          order_number: values.order_number,
          store_group_id: values.store_group_id || null,
          warehouse: values.warehouse,
          notes: values.notes,
          items,
        }
        await purchaseOrdersApi.create(payload as any)
        message.success('采购订单创建成功')
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

  const handleApprove = async (id: number) => {
    console.log('handleApprove called, id:', id)
    Modal.confirm({
      title: '确认审批',
      content: '确定要审批此采购订单吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await purchaseOrdersApi.update(id, { status: 'approved' })
          message.success('审批成功')
          fetchData()
        } catch {
          message.error('审批失败')
        }
      },
    })
  }

  const handleCancelApproval = async (id: number) => {
    Modal.confirm({
      title: '取消审批',
      content: '确定要取消此采购订单的审批状态吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await purchaseOrdersApi.cancelApproval(id)
          message.success('取消审批成功')
          fetchData()
        } catch {
          message.error('取消审批失败')
        }
      },
    })
  }

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此采购订单吗？此操作不可恢复。',
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await purchaseOrdersApi.delete(id)
          message.success('采购订单删除成功')
          fetchData()
        } catch {
          message.error('删除失败')
        }
      },
    })
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的订单')
      return
    }
    Modal.confirm({
      title: '批量删除确认',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条采购订单吗？此操作不可恢复。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(key => 
            purchaseOrdersApi.delete(Number(key))
          ))
          message.success('批量删除成功')
          setSelectedRowKeys([])
          fetchData()
        } catch {
          message.error('批量删除失败，请稍后重试')
        }
      }
    })
  }

  const handleBatchApprove = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要审批的订单')
      return
    }
    const draftOrPendingCount = orders.filter(
      order => selectedRowKeys.includes(order.id) && 
               (order.status === 'draft' || order.status === 'pending')
    ).length
    
    if (draftOrPendingCount === 0) {
      message.warning('选中的订单中没有可审批的订单')
      return
    }

    Modal.confirm({
      title: '批量审批确认',
      content: `确定要审批选中的 ${draftOrPendingCount} 条采购订单吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const promises = orders
            .filter(order => 
              selectedRowKeys.includes(order.id) && 
              (order.status === 'draft' || order.status === 'pending')
            )
            .map(order => purchaseOrdersApi.update(order.id, { status: 'approved' }))
          
          await Promise.all(promises)
          message.success('批量审批成功')
          setSelectedRowKeys([])
          fetchData()
        } catch {
          message.error('批量审批失败，请稍后重试')
        }
      }
    })
  }

  const batchActionsMenu: MenuProps['items'] = [
    hasPermission('purchase:confirm')
      ? {
          key: 'approve',
          label: (
            <span>
              <CheckOutlined style={{ marginRight: 8 }} />
              批量审批
            </span>
          ),
          disabled: selectedRowKeys.length === 0,
          onClick: handleBatchApprove,
        }
      : null,
    hasPermission('purchase:delete')
      ? {
          key: 'delete',
          label: (
            <span style={{ color: '#ff4d4f' }}>
              <DeleteOutlined style={{ marginRight: 8 }} />
              批量删除
            </span>
          ),
          disabled: selectedRowKeys.length === 0,
          onClick: handleBatchDelete,
        }
      : null,
  ].filter(Boolean) as any

  const handleAddFormItem = () => {
    setFormItems((prev) => [...prev, createEmptyFormItem()])
  }

  const fetchAccessoriesAndAdd = async (parentKey: string, productId: number) => {
    try {
      const res = await productBindingsApi.getByFinished(productId)
      if (res.data.success && res.data.data && res.data.data.length > 0) {
        const accessories = res.data.data
        setFormItems((prev) => {
          const parentItem = prev.find((item) => item.key === parentKey)
          if (!parentItem) return prev
          const parentQty = parentItem.quantity || 1
          // 检查该成品下是否已有相同配件（只检查同一成品下，不同成品的相同配件应该分开显示）
          const existingAccessoryKeys = new Set(
            prev.filter((item) => item.parentKey === parentKey).map((item) => item.product_id)
          )
          const accessoryItems: FormItemState[] = []
          for (const acc of accessories) {
            if (existingAccessoryKeys.has(acc.accessory_product_id)) continue
            const accessoryProduct = productList.find((p) => p.id === acc.accessory_product_id)
            accessoryItems.push({
              key: generateItemKey(),
              product_id: acc.accessory_product_id,
              quantity: parentQty * (acc.quantity || 1),
              unit_price: (accessoryProduct && accessoryProduct.purchase_price != null) ? accessoryProduct.purchase_price : (acc.unit_price || 0),
              parentKey: parentKey,
              base_quantity_per_product: acc.quantity || 1,
            })
          }
          if (accessoryItems.length === 0) return prev
          const parentIndex = prev.findIndex((item) => item.key === parentKey)
          const newItems = [...prev]
          newItems.splice(parentIndex + 1, 0, ...accessoryItems)
          return newItems
        })
        setExpandedAccessories((prev) => new Set(prev).add(parentKey))
      }
    } catch (e) {
      console.error('获取成品配件失败:', e)
    }
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

  const handleRemoveFormItem = (key: string) => {
    setFormItems((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((item) => item.key !== key && item.parentKey !== key)
    })
    setExpandedAccessories((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const handleFormItemChange = (key: string, field: keyof FormItemState, value: any) => {
    setFormItems((prev) => {
      let updated = prev.map((item) => {
        if (item.key !== key) return item
        const updatedItem = { ...item, [field]: value }
        if (field === 'product_id') {
          const product = productList.find((p) => p.id === value)
          if (product && product.purchase_price != null) {
            updatedItem.unit_price = product.purchase_price
          }
        }
        return updatedItem
      })
      if (field === 'quantity') {
        const changedItem = updated.find((item) => item.key === key)
        if (changedItem && !changedItem.parentKey) {
          updated = updated.map((item) => {
            if (item.parentKey !== key) return item
            const baseQty = item.base_quantity_per_product || 1
            return { ...item, quantity: (value || 0) * baseQty }
          })
        }
      }
      return updated
    })
    if (field === 'product_id' && value) {
      fetchAccessoriesAndAdd(key, value)
    }
  }

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await purchaseOrdersApi.downloadTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '采购单模板_' + new Date().toISOString().split('T')[0] + '.xlsx')
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
      const res = await purchaseOrdersApi.uploadPreview(file)
      if (res.data.success) {
        // 处理配件数据：计算初始数量（成品数量 × 绑定比例）
        const items = (res.data.data || []).map((item: any) => ({
          ...item,
          bindings: (item.bindings || []).map((b: any) => ({
            ...b,
            calcQty: (item.quantity || 0) * (b.qty || 0), // 自动计算的配件数量
            editableQty: (item.quantity || 0) * (b.qty || 0), // 用户可编辑的数量
          })),
        }))
        setPreviewItems(items)
        setPreviewOrderInfo(res.data.order_info || {})
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

  // 更新某行数量时，同步更新所有配件的计算数量
  const updatePreviewQuantity = (index: number, newQty: number) => {
    setPreviewItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      return {
        ...item,
        quantity: newQty,
        bindings: (item.bindings || []).map((b: any) => ({
          ...b,
          calcQty: newQty * b.qty,
          editableQty: b.userEdited ? b.editableQty : newQty * b.qty,
        })),
      }
    }))
  }

  // 手动编辑配件数量
  const updateBindingQty = (rowIndex: number, bindIndex: number, qty: number) => {
    setPreviewItems(prev => prev.map((item, i) => {
      if (i !== rowIndex) return item
      const newBindings = [...(item.bindings || [])]
      newBindings[bindIndex] = { ...newBindings[bindIndex], editableQty: qty, userEdited: true }
      return { ...item, bindings: newBindings }
    }))
  }

  // 删除某个配件
  const removeBinding = (rowIndex: number, bindIndex: number) => {
    setPreviewItems(prev => prev.map((item, i) => {
      if (i !== rowIndex) return item
      const newBindings = (item.bindings || []).filter((_: any, j: number) => j !== bindIndex)
      return { ...item, bindings: newBindings }
    }))
  }

  // 计算某行成品自身的总价（不含配件）
  const calcRowTotal = (item: any) => {
    return (item.quantity || 0) * (item.unit_price || 0)
  }

  // 计算某行总价（含配件），用于底部合计
  const calcRowTotalWithBindings = (item: any) => {
    let total = (item.quantity || 0) * (item.unit_price || 0)
    for (const b of (item.bindings || [])) {
      total += (b.editableQty || 0) * (b.unit_price || 0)
    }
    return total
  }

  const handleConfirmImport = () => {
    setPreviewModalOpen(false)
    // 打开新增弹窗
    handleCreate()
    // 延迟设置数据，确保弹窗已打开
    setTimeout(() => {
      const newItems: FormItemState[] = []
      const newExpandedKeys = new Set<string>()
      for (const item of previewItems) {
        const parentKey = generateItemKey()
        newItems.push({
          key: parentKey,
          product_id: item.product_id || null,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          supplier: item.supplier || '',
          notes: item.notes || '',
        })
        const bindings = item.bindings || []
        if (bindings.length > 0) {
          newExpandedKeys.add(parentKey)
          for (const b of bindings) {
            const accessoryProduct = productList.find((p) => p.id === b.accessory_product_id)
            newItems.push({
              key: generateItemKey(),
              product_id: b.accessory_product_id || null,
              quantity: (item.quantity || 1) * (b.qty || 1),
              unit_price: (accessoryProduct && accessoryProduct.purchase_price != null) ? accessoryProduct.purchase_price : (b.unit_price || 0),
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

      // 从预览数据中提取仓库和订单级字段
      const warehouseFromImport = previewItems.find(item => item.warehouse)?.warehouse || ''
      const formValues: Record<string, any> = {}
      if (warehouseFromImport) formValues.warehouse = warehouseFromImport
      if (previewOrderInfo.store_group_id) formValues.store_group_id = previewOrderInfo.store_group_id
      if (previewOrderInfo.notes) formValues.notes = previewOrderInfo.notes
      if (Object.keys(formValues).length > 0) {
        form.setFieldsValue(formValues)
      }

      message.success('导入成功')
    }, 100)
  }

  const columns: ColumnsType<PurchaseOrder> = [
    {
      title: '采购单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 200,
      render: (text: string, record: PurchaseOrder) => (
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
      title: '总金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 120,
      render: (amount: number) => amount != null ? `¥${amount.toFixed(2)}` : '-',
    },
    {
      title: '入库进度',
      dataIndex: 'stock_progress',
      key: 'stock_progress',
      width: 110,
      render: (_: any, record: PurchaseOrder) => {
        const ordered = record.total_ordered || 0
        const received = record.total_received || 0
        const pending = ordered - received
        const isComplete = pending <= 0
        return (
          <span
            style={{ color: isComplete ? '#52c41a' : '#1890ff', cursor: 'pointer', fontWeight: 500, textDecoration: 'underline' }}
            onClick={() => { setStockDetailOrder(record); setStockDetailModalOpen(true) }}
          >
            {received}/{ordered}
          </span>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={statusColorMap[status] || 'default'}>
          {statusLabelMap[status] || status}
        </Tag>
      ),
    },
    {
      title: '发起者',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 100,
      render: (value: string) => value || '-',
    },
    {
      title: '审批者',
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
      title: '审批时间',
      dataIndex: 'approved_at',
      key: 'approved_at',
      width: 170,
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_: any, record: PurchaseOrder) => {
        const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
          switch (key) {
            case 'view':
              handleView(record)
              break
            case 'edit':
              handleEdit(record)
              break
            case 'delete':
              handleDelete(record.id)
              break
            case 'cancel-approval':
              handleCancelApproval(record.id)
              break
          }
        }

        const menuItems: MenuProps['items'] = []

        if (hasPermission('purchase:view')) {
          menuItems.push({
            key: 'view',
            label: (
              <span>
                <InfoCircleOutlined style={{ marginRight: 8 }} />
                详情
              </span>
            ),
          })
        }

        if (hasPermission('purchase:edit') && (record.status === 'draft' || record.status === 'pending')) {
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

        if (hasPermission('purchase:delete')) {
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
        }

        // 取消审批选项：管理员且状态为已审批时显示
        if (isAdmin && record.status === 'approved') {
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
            {hasPermission('purchase:confirm') && (
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleApprove(record.id)}
                disabled={record.status !== 'draft' && record.status !== 'pending'}
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
    label: `${p.product_code} - ${p.name}`,
    value: p.id,
  }))

  const formItemTotalAmount = formItems.reduce((sum, item) => {
    return sum + item.quantity * item.unit_price
  }, 0)

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Card
        loading={loading}
        title={
          <Space wrap size="middle">
            <Input
              placeholder="搜索采购单号..."
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 280 }}
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
              placeholder="店铺分组"
              allowClear
              style={{ width: 160 }}
              value={groupFilter}
              onChange={handleGroupFilter}
              options={storeGroups.map(g => ({ label: g.name, value: g.id }))}
            />
            <RangePicker
              placeholder={['开始日期', '结束日期']}
              value={dateRange}
              onChange={handleDateRangeChange}
              style={{ width: 300 }}
            />
          </Space>
        }
        extra={
          <Space>
            {hasPermission('purchase:create') && (
              <>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  下载模板
                </Button>
                <Button icon={<UploadOutlined />} onClick={handleUploadClick} loading={uploading}>
                  导入Excel
                </Button>
              </>
            )}
            {(hasPermission('purchase:confirm') || hasPermission('purchase:delete')) && (
              <Dropdown menu={{ items: batchActionsMenu }} trigger={['click']}>
                <Button>
                  批量操作{selectedRowKeys.length > 0 ? ` (${selectedRowKeys.length})` : ''} <DownOutlined />
                </Button>
              </Dropdown>
            )}
            {hasPermission('purchase:create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增采购订单
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
          scroll={{ x: 1300 }}
          pagination={false}
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys,
            onChange: (newSelectedRowKeys) => {
              setSelectedRowKeys(newSelectedRowKeys)
            }
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
        title={viewingOrder ? '查看采购订单' : (editingOrder ? '编辑采购订单' : '新增采购订单')}
        open={modalOpen}
        onOk={viewingOrder ? () => setModalOpen(false) : handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText={viewingOrder ? '确定' : undefined}
        width={800}
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
              <Form.Item
                name="order_number"
                label="采购单号"
              >
                <Input placeholder="请输入采购单号" disabled />
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
            <Col span={8}>
              <Form.Item
                name="warehouse"
                label="收货仓库"
              >
                <Select
                  placeholder="请选择仓库"
                  showSearch
                  optionFilterProp="label"
                  options={warehouseList.map(w => ({ label: w.name, value: w.name }))}
                  disabled={!!viewingOrder}
                  notFoundContent={
                hasPermission('warehouse:create') ? (
                  <Button
                    type="link"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setModalOpen(false)
                      navigate('/warehouses')
                    }}
                  >
                    暂无仓库，点击新增
                  </Button>
                ) : '暂无仓库'
              }
            />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="备注">
            <TextArea rows={3} placeholder="请输入备注" disabled={!!viewingOrder} />
          </Form.Item>
        </Form>

        <Divider orientation="left">采购商品明细</Divider>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(() => {
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

          const renderItem = (item: FormItemState, isAccessory: boolean = false) => {
            const hasAccessories = accessoryMap.has(item.key) && accessoryMap.get(item.key)!.length > 0
            const isExpanded = expandedAccessories.has(item.key)

            return (
              <div key={item.key}>
                <div style={{
                  marginBottom: isAccessory ? 0 : 16,
                  padding: 16,
                  borderRadius: 8,
                  background: isAccessory ? '#faf7f0' : '#ffffff',
                  border: isAccessory ? '1px dashed #d9d9d9' : '1px solid #e8e8e8',
                  marginLeft: isAccessory ? 40 : 0,
                  boxShadow: isAccessory ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
                }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isAccessory ? (
                        <Tag icon={<LinkOutlined />} color="orange" style={{ fontSize: 12 }}>配件</Tag>
                      ) : hasAccessories ? (
                        <Tag icon={<AppstoreOutlined />} color="blue" style={{ fontSize: 12 }}>成品</Tag>
                      ) : (
                        <Tag icon={<AppstoreOutlined />} color="default" style={{ fontSize: 12 }}>商品</Tag>
                      )}
                      {hasAccessories && !isAccessory && (
                        <Button type="text" size="small"
                          icon={isExpanded ? <DownOutlined /> : <RightOutlined />}
                          onClick={() => toggleAccessoryExpansion(item.key)}
                          style={{ padding: '0 4px', height: 22, fontSize: 12 }}>
                          <Tag color="blue" style={{ fontSize: 11, marginRight: 0 }}>
                            {accessoryMap.get(item.key)!.length}个配件
                          </Tag>
                        </Button>
                      )}
                    </div>
                    {!viewingOrder && (
                      <Button danger type="text" size="small" icon={<DeleteOutlined />}
                        onClick={() => handleRemoveFormItem(item.key)}
                        disabled={formItems.filter(i => !i.parentKey).length <= 1 && !item.parentKey} />
                    )}
                  </div>

                  {/* Form fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}> {/* 添加 minWidth: 0 防止内容溢出 */}
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>商品</div>
                      <Select placeholder="请选择商品" showSearch loading={productsLoading}
                        value={item.product_id}
                        onChange={(val) => handleFormItemChange(item.key, 'product_id', val)}
                        filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
                        options={productOptions}
                        style={{ width: '100%' }}
                        disabled={!!viewingOrder} />
                    </div>
                    <div style={{ minWidth: 0 }}> {/* 添加 minWidth: 0 防止内容溢出 */}
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>供应商</div>
                      <Input placeholder="请输入供应商"
                        value={item.supplier || ''}
                        onChange={(e) => handleFormItemChange(item.key, 'supplier', e.target.value)}
                        style={{ width: '100%' }}
                        disabled={!!viewingOrder} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
                    <div>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>数量</div>
                      <InputNumber min={1} value={item.quantity}
                        onChange={(val) => handleFormItemChange(item.key, 'quantity', val || 1)}
                        style={{ width: '100%' }} placeholder="数量"
                        disabled={!!viewingOrder} />
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>单价</div>
                      <InputNumber min={0} precision={2} prefix="¥" value={item.unit_price}
                        onChange={(val) => handleFormItemChange(item.key, 'unit_price', val || 0)}
                        style={{ width: '100%' }} placeholder="单价"
                        disabled={!!viewingOrder} />
                    </div>
                    <div>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>备注</div>
                      <Input placeholder="请输入备注"
                        value={item.notes || ''}
                        onChange={(e) => handleFormItemChange(item.key, 'notes', e.target.value)}
                        style={{ width: '100%' }}
                        disabled={!!viewingOrder} />
                    </div>
                  </div>
                </div>
              </div>
            )
          }

          return finishedItems.map((item) => (
            <React.Fragment key={item.key}>
              {renderItem(item, false)}
              {accessoryMap.has(item.key) && expandedAccessories.has(item.key) &&
                accessoryMap.get(item.key)!.map((accessory) => renderItem(accessory, true))
              }
            </React.Fragment>
          ))
        })()}
        </div>

        {!viewingOrder && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddFormItem}>
              添加商品
            </Button>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              合计金额：<span style={{ color: currentTheme.primary }}>¥{formItemTotalAmount.toFixed(2)}</span>
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
            expandedRowRender: (record: any, index: number) => {
              const bindings = record.bindings || []
              if (bindings.length === 0) {
                return <div style={{ padding: '12px 0', color: '#999' }}>无绑定配件</div>
              }
              return (
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', color: '#666' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>配件编码</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>配件名称</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, width: 80 }}>绑定比例</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, width: 120 }}>采购数量</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 100 }}>单价</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 80 }}>合计</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, width: 60 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bindings.map((b: any, bi: number) => (
                      <tr key={bi}>
                        <td style={{ padding: '6px 8px' }}><Tag size="small" color="orange">{b.code}</Tag></td>
                        <td style={{ padding: '6px 8px' }}>{b.name || '-'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: '#999' }}>×{b.qty}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <InputNumber
                            size="small"
                            min={0}
                            value={b.editableQty}
                            onChange={(val: number | null) => updateBindingQty(index!, bi, val || 0)}
                            style={{ width: 90 }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{b.unit_price != null ? `¥${b.unit_price.toFixed(2)}` : '-'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ff4d4f', fontWeight: 500 }}>
                          ¥{((b.editableQty || 0) * (b.unit_price || 0)).toFixed(2)}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <Button type="link" size="small" danger icon={<MinusCircleOutlined />} onClick={() => removeBinding(index!, bi)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            },
            rowExpandable: (record: any) => (record.bindings && record.bindings.length > 0),
          }}
          columns={[
            { title: '商品编码', dataIndex: 'product_code', key: 'product_code', width: 140 },
            { title: '商品名称', dataIndex: 'product_name', key: 'product_name', ellipsis: true },
            {
              title: '配件',
              dataIndex: 'bindings',
              key: 'bindings',
              width: 80,
              render: (v: any[]) => v && v.length > 0 ? (
                <Tag color="orange">{v.length}个配件</Tag>
              ) : <span style={{ color: '#999' }}>-</span>
            },
            { title: '收货仓库', dataIndex: 'warehouse', key: 'warehouse', width: 90, render: (v: string) => v || '-' },
            {
              title: '数量',
              dataIndex: 'quantity',
              key: 'quantity',
              width: 90,
              render: (_: any, record: any, index: number) => (
                <InputNumber
                  size="small"
                  min={1}
                  value={record.quantity}
                  onChange={(val: number | null) => val && val > 0 && updatePreviewQuantity(index, val)}
                  style={{ width: 70 }}
                />
              )
            },
            { title: '单价', dataIndex: 'unit_price', key: 'unit_price', width: 90, render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-' },
            {
              title: '合计',
              key: 'total',
              width: 120,
              render: (_: any, record: any) => {
                const total = calcRowTotal(record)
                return <span style={{ color: '#ff4d4f', fontWeight: 600 }}>¥{total.toFixed(2)}</span>
              }
            },
          ]}
          summary={() => {
            const grandTotal = previewItems.reduce((sum, item) => sum + calcRowTotalWithBindings(item), 0)
            return (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell colSpan={6} style={{ textAlign: 'right', fontWeight: 700, paddingTop: 12 }}>
                    合计（含配件）：
                  </Table.Summary.Cell>
                  <Table.Summary.Cell style={{ fontWeight: 700, color: '#ff4d4f', paddingTop: 12 }}>
                    ¥{grandTotal.toFixed(2)}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )
          }}
        />
      </Modal>

      <Modal
        title={`入库详情 - ${stockDetailOrder?.order_number || ''}`}
        open={stockDetailModalOpen}
        onCancel={() => setStockDetailModalOpen(false)}
        footer={null}
        width={700}
      >
        {stockDetailOrder && (
          <Table
            dataSource={[
              ...stockDetailOrder.items.map((item: any) => ({
                ...item,
                pending: item.quantity - item.received_quantity,
                isSummary: false,
              })),
              {
                id: '__summary__',
                product_name: '合计',
                product_code: '',
                quantity: stockDetailOrder.items.reduce((s: number, item: any) => s + (item.quantity || 0), 0),
                received_quantity: stockDetailOrder.items.reduce((s: number, item: any) => s + (item.received_quantity || 0), 0),
                pending: stockDetailOrder.items.reduce((s: number, item: any) => s + (item.quantity || 0), 0) - stockDetailOrder.items.reduce((s: number, item: any) => s + (item.received_quantity || 0), 0),
                isSummary: true,
              },
            ]}
            rowKey="id"
            pagination={false}
            size="small"
            rowClassName={(record) => record.isSummary ? 'summary-row' : ''}
            columns={[
              { title: '产品', dataIndex: 'product_name', key: 'product_name', ellipsis: true,
                render: (name: string, record: any) => (
                  <div style={{ fontWeight: record.isSummary ? 700 : 400 }}>
                    <div>{name}</div>
                    {record.product_code && <div style={{ fontSize: 11, color: '#999' }}>{record.product_code}</div>}
                  </div>
                ),
              },
              { title: '采购量', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'center' as const,
                render: (v: number, record: any) => <span style={{ fontWeight: record.isSummary ? 700 : 400 }}>{v}</span>,
              },
              { title: '已入库', dataIndex: 'received_quantity', key: 'received_quantity', width: 80, align: 'center' as const,
                render: (v: number, record: any) => <span style={{ color: v > 0 ? '#52c41a' : '#999', fontWeight: record.isSummary ? 700 : 400 }}>{v}</span>,
              },
              { title: '待入库', dataIndex: 'pending', key: 'pending', width: 80, align: 'center' as const,
                render: (v: number, record: any) => <span style={{ color: v > 0 ? '#fa8c16' : '#52c41a', fontWeight: record.isSummary ? 700 : (v > 0 ? 500 : 400) }}>{v}</span>,
              },
              {
                title: '进度',
                key: 'progress',
                width: 120,
                render: (_: any, record: any) => {
                  if (record.isSummary) return null
                  const pct = record.quantity > 0 ? Math.round((record.received_quantity / record.quantity) * 100) : 100
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#52c41a' : '#1890ff', borderRadius: 4, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#999', minWidth: 32 }}>{pct}%</span>
                    </div>
                  )
                },
              },
            ]}
          />
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

export default PurchaseManagement
