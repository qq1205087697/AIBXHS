import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Popconfirm, Space, Tag, Divider, Alert, Dropdown, Menu, Pagination, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, SearchOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, MoreOutlined, DownOutlined, RightOutlined, AppstoreOutlined, LinkOutlined, CloseCircleFilled } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { outboundOrdersApi, productsApi, inventoryBatchesApi, warehousesApi, productBindingsApi, storeGroupsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type { MenuProps } from 'antd'
const { RangePicker } = DatePicker

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

interface OutboundOrder {
  id: number
  order_number: string
  outbound_type: string
  warehouse: string
  handler: string
  outbound_date: string
  total_quantity: number
  total_amount: number
  status: string
  notes: string
  created_at: string
  confirmed_at: string
  confirmed_by: number | null
  creator_name: string
  confirmer_name: string
  store_group_id?: number
  store_group_name?: string
  items: OutboundOrderItem[]
}

interface OutboundOrderItem {
  id: number
  product_id: number
  product_name: string
  product_code: string
  quantity: number
  unit_price: number
  total_price: number
  batch_id: number | null
  batch_number: string
  batch_details: Array<{ batch_id: number; batch_number: string; quantity: number; unit_price: number; warehouse: string; inbound_date: string }> | null
  notes: string
}

interface Product {
  id: number
  name: string
  product_code: string
  purchase_price: number | null
  product_type?: string | string[]
}

interface OutboundFormItem {
  key: string
  product_id: number | null
  quantity: number
  unit_price: number
  notes: string
  batch_number?: string
  batch_details?: Array<{ batch_id: number; batch_number: string; quantity: number; unit_price: number; warehouse: string; inbound_date: string }> | null
  selected_batch_id?: number | null  // 报废时用户选择的批次
  selected_batch_number?: string  // 报废时用户选择的批次号
  parentKey?: string  // 标识是否是配件，以及所属的成品key
  base_quantity_per_product?: number  // 每1个成品需要的配件基础数量
}

interface BatchInfo {
  batch_number: string
  current_quantity: number
  quantity?: number  // 兼容性字段
  unit_price: number
  warehouse: string
  inbound_date: string
  stock_age: number
}

interface DeductionItem {
  product_name: string
  product_code: string
  quantity: number
  batch_number: string
  batch_id: number
  batch_details: Array<{ batch_id: number; batch_number: string; quantity: number; unit_price: number }> | null
}

const outboundTypeLabels: Record<string, string> = {
  sale: '销售出库',
  return_supplier: '退货供应商',
  transfer: '调拨出库',
  scrap: '报废',
  adjustment: '盘点调整',
  other: '其他',
}

const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  confirmed: '已审批',
  cancelled: '已取消',
}

const statusColorMap: Record<string, string> = {
  draft: 'default',
  confirmed: 'success',
  cancelled: 'error',
}

const outboundTypeOptions = [
  { label: '全部', value: '' },
  { label: '销售出库', value: 'sale' },
  { label: '退货供应商', value: 'return_supplier' },
  { label: '调拨出库', value: 'transfer' },
  { label: '报废', value: 'scrap' },
  { label: '盘点调整', value: 'adjustment' },
  { label: '其他', value: 'other' },
]

const createOutboundTypeOptions = [
  { label: '销售出库', value: 'sale' },
  { label: '退货供应商', value: 'return_supplier' },
  { label: '调拨出库', value: 'transfer' },
  { label: '报废', value: 'scrap' },
  { label: '盘点调整', value: 'adjustment' },
  { label: '其他', value: 'other' },
]

const statusOptions = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '已审批', value: 'confirmed' },
  { label: '已取消', value: 'cancelled' },
]

let itemKeyCounter = 0
const generateItemKey = () => `item_${Date.now()}_${++itemKeyCounter}`

const createEmptyFormItem = (): OutboundFormItem => ({
  key: generateItemKey(),
  product_id: null,
  quantity: 0,
  unit_price: 0,
  notes: '',
  selected_batch_id: null,
  selected_batch_number: '',
})

const OutboundManagement: React.FC = () => {
  const { currentTheme: _ } = useTheme()
  const { user, hasPermission } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const [orders, setOrders] = useState<OutboundOrder[]>([])
  const [productList, setProductList] = useState<Product[]>([])
  const [warehouseList, setWarehouseList] = useState<{ id: number; name: string; code: string; status: string }[]>([])
  const [storeGroups, setStoreGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OutboundOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<OutboundOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined)
  const [groupFilter, setGroupFilter] = useState<number | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<OutboundFormItem[]>([createEmptyFormItem()])
  const [submitting, setSubmitting] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  // 产品搜索关键字（用于懒加载搜索）
  const [productSearchKeyword, setProductSearchKeyword] = useState('')
  // 产品分页状态（用于懒加载）
  const [productPagination, setProductPagination] = useState({ current: 1, pageSize: 50, total: 0, hasMore: true })
  // 产品搜索防抖定时器
  const productSearchTimeoutRef = useRef<number | null>(null)

  const [productBatchesMap, setProductBatchesMap] = useState<Record<number, BatchInfo[]>>({})
  const [batchesLoading, setBatchesLoading] = useState(false)

  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [deductionResults, setDeductionResults] = useState<DeductionItem[]>([])
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const autoAddedKeysRef = useRef<Map<string, Set<string>>>(new Map()) // 父级item key -> 自动添加的配件item keys
  const [expandedAccessories, setExpandedAccessories] = useState<Set<string>>(new Set()) // 存储展开配件的成品key

  // 使用 Form watch 监听出库类型变化
  const watchOutboundType = Form.useWatch('outbound_type', form)

  useEffect(() => {
    fetchData()
    fetchProducts()
    fetchWarehouses()
    fetchStoreGroups()
  }, [pagination.current, pagination.pageSize, filters])

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

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await outboundOrdersApi.getList({
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

  const fetchWarehouses = async () => {
    try {
      const res = await warehousesApi.getList({ page_size: 100 })
      console.log('Warehouses loaded:', res.data.data)
      setWarehouseList(res.data.data || [])
    } catch (error) {
      console.error('Failed to load warehouses:', error)
    }
  }

  const fetchProductBatches = useCallback(async (productId: number) => {
    if (productBatchesMap[productId]) return
    setBatchesLoading(true)
    try {
      const res = await inventoryBatchesApi.getProductBatches(productId)
      if (res.data && res.data.success) {
        let batches: BatchInfo[] = []
        const rawData = res.data.data
        // 确保数据是数组
        if (Array.isArray(rawData)) {
          batches = rawData
        }
        setProductBatchesMap((prev) => ({ ...prev, [productId]: batches }))
      } else {
        // 确保即使API响应有问题，也设置空数组
        setProductBatchesMap((prev) => ({ ...prev, [productId]: [] }))
      }
    } catch (error) {
      console.error('获取产品批次失败:', error)
      // 出错时也设置空数组
      setProductBatchesMap((prev) => ({ ...prev, [productId]: [] }))
    } finally {
      setBatchesLoading(false)
    }
  }, [productBatchesMap])

  const getTotalStockForProduct = useCallback((productId: number): number => {
    const batches = productBatchesMap[productId]
    // 安全处理：确保 batches 是数组
    if (!Array.isArray(batches)) {
      return 0
    }
    return batches.reduce((sum, b) => sum + (b.current_quantity || b.quantity || 0), 0)
  }, [productBatchesMap])

  const handleSearch = useCallback((value: string) => {
    setSearchText(value)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      setFilters((prev) => {
        const next = { ...prev, search: value }
        if (!value) {
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
      const next = { ...prev, status: value }
      if (!value) {
        delete next.status
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleTypeFilter = (value: string | undefined) => {
    setTypeFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev, outbound_type: value }
      if (!value) {
        delete next.outbound_type
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
    const orderNumber = `OUT${dayjs().format('YYYYMMDDHHmmss')}`
    const handler = user?.nickname || user?.username || ''
    form.setFieldsValue({
      order_number: orderNumber,
      handler: handler,
      outbound_date: dayjs(),
    })
    setFormItems([createEmptyFormItem()])
    setProductBatchesMap({})
    setExpandedAccessories(new Set()) // 重置展开状态
    autoAddedKeysRef.current.clear() // 重置配件映射

    // 重置产品搜索状态
    setProductSearchKeyword('')
    setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
    fetchProducts('', 1, false)  // 恢复初始产品列表

    fetchWarehouses()
    setModalOpen(true)
  }

  const handleView = (order: OutboundOrder) => {
    setViewingOrder(order)
    setEditingOrder(null)
    form.setFieldsValue({
      order_number: order.order_number,
      outbound_type: order.outbound_type,
      warehouse: order.warehouse,
      handler: order.handler,
      outbound_date: order.outbound_date ? dayjs(order.outbound_date) : undefined,
      notes: order.notes,
      store_group_id: order.store_group_id || undefined,
    })
    // 加载出库明细
    if (order.items && order.items.length > 0) {
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        notes: item.notes || '',
        batch_number: item.batch_number,
        batch_details: item.batch_details || null,
      }))
      setFormItems(items)
    } else {
      setFormItems([createEmptyFormItem()])
    }
    setProductBatchesMap({})
    setExpandedAccessories(new Set()) // 重置展开状态
    autoAddedKeysRef.current.clear() // 重置配件映射
    // 后台异步加载完整产品列表（不阻塞弹窗打开）
    setProductSearchKeyword('')
    setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
    fetchProducts('', 1, false)
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleEdit = (order: OutboundOrder) => {
    setViewingOrder(null)
    setEditingOrder(order)
    form.setFieldsValue({
      order_number: order.order_number,
      outbound_type: order.outbound_type,
      warehouse: order.warehouse,
      handler: order.handler,
      outbound_date: order.outbound_date ? dayjs(order.outbound_date) : undefined,
      notes: order.notes,
      store_group_id: order.store_group_id || undefined,
    })
    setProductBatchesMap({})
    setExpandedAccessories(new Set()) // 重置展开状态
    autoAddedKeysRef.current.clear() // 重置配件映射
    // 加载出库明细
    if (order.items && order.items.length > 0) {
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        notes: item.notes || '',
        selected_batch_id: item.batch_id,
        selected_batch_number: item.batch_number,
      }))
      setFormItems(items)
      // 为每个产品加载批次信息
      const productIds = items.map((item) => item.product_id).filter((id): id is number => id !== null)
      Promise.all(productIds.map((pid) => fetchProductBatches(pid)))
    } else {
      setFormItems([createEmptyFormItem()])
    }
    // 后台异步加载完整产品列表（不阻塞弹窗打开）
    setProductSearchKeyword('')
    setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
    fetchProducts('', 1, false)
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)

      if (editingOrder) {
        const payload: Record<string, any> = {
          order_number: values.order_number,
          outbound_type: values.outbound_type,
          warehouse: values.warehouse,
          handler: values.handler,
          notes: values.notes,
          store_group_id: values.store_group_id || null,
        }
        if (values.outbound_date) {
          payload.outbound_date = values.outbound_date.format('YYYY-MM-DD HH:mm:ss')
        }
        await outboundOrdersApi.update(editingOrder.id, payload)
        message.success('出库订单更新成功')
      } else {
        const validItems = formItems.filter((item) => item.product_id != null && item.quantity > 0)
        if (validItems.length === 0) {
          message.warning('请至少添加一个出库商品')
          setSubmitting(false)
          return
        }

        // 验证：如果是报废类型，每个商品必须选择批次
        if (watchOutboundType === 'scrap') {
          const itemsWithoutBatch = validItems.filter((item) => !item.selected_batch_id)
          if (itemsWithoutBatch.length > 0) {
            message.error('报废类型的出库单必须为每个商品选择指定批次')
            setSubmitting(false)
            return
          }
        }

        const items = validItems.map((item) => ({
          product_id: item.product_id!,
          quantity: item.quantity,
          unit_price: item.unit_price,
          notes: item.notes,
          selected_batch_id: item.selected_batch_id,
          selected_batch_number: item.selected_batch_number,
        }))
        const payload: Record<string, any> = {
          order_number: values.order_number,
          outbound_type: values.outbound_type,
          warehouse: values.warehouse,
          handler: values.handler,
          notes: values.notes,
          store_group_id: values.store_group_id || null,
          items,
        }
        if (values.outbound_date) {
          payload.outbound_date = values.outbound_date.format('YYYY-MM-DD HH:mm:ss')
        }
        await outboundOrdersApi.create(payload)
        message.success('出库订单创建成功')
      }

      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      message.error('操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirm = async (id: number) => {
    Modal.confirm({
      title: '确认审批',
      content: '确定要审批此出库订单吗？此操作将自动扣减库存。',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          setConfirmingId(id)
          const res = await outboundOrdersApi.confirm(id)
          const deductionResultsRaw = res.data?.data?.deduction_results || res.data?.deduction_results || []

          // 将 API 返回的 deduction_results 展平为 DeductionItem 列表
          const flatResults: DeductionItem[] = []
          if (Array.isArray(deductionResultsRaw)) {
            deductionResultsRaw.forEach((dr: any) => {
              if (dr.details && dr.details.length > 0) {
                flatResults.push({
                  product_name: dr.product_name || `产品#${dr.product_id}`,
                  product_code: dr.product_code || '',
                  quantity: dr.details.reduce((sum: number, d: any) => sum + d.quantity, 0),
                  batch_number: dr.details[0].batch_number || '',
                  batch_id: dr.details[0].batch_id || 0,
                  batch_details: dr.details.length > 1 ? dr.details : null,
                })
              }
            })
          }

          if (flatResults.length > 0) {
            setDeductionResults(flatResults)
            setConfirmModalOpen(true)
          } else {
            message.success('出库订单已审批，库存已扣减')
          }
          fetchData()
        } catch {
          message.error('审批失败')
        } finally {
          setConfirmingId(null)
        }
      },
    })
  }

  const handleDelete = async (id: number) => {
    try {
      await outboundOrdersApi.delete(id)
      message.success('出库订单删除成功')
      fetchData()
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '删除失败'
      message.error(errorMsg)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的订单')
      return
    }
    Modal.confirm({
      title: '批量删除确认',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条出库订单吗？此操作不可恢复。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(key =>
            outboundOrdersApi.delete(Number(key))
          ))
          message.success('批量删除成功')
          setSelectedRowKeys([])
          fetchData()
        } catch (e: any) {
          const errorMsg = e.response?.data?.detail || e.message || '批量删除失败，请稍后重试'
          message.error(errorMsg)
        }
      },
    })
  }

  const handleBatchConfirm = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要审批的订单')
      return
    }
    const draftCount = orders.filter(
      order => selectedRowKeys.includes(order.id) && order.status === 'draft'
    ).length
    
    if (draftCount === 0) {
      message.warning('选中的订单中没有可审批的订单')
      return
    }

    Modal.confirm({
      title: '批量审批确认',
      content: `确定要审批选中的 ${draftCount} 条出库订单吗？此操作将自动扣减库存。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const draftOrders = orders
            .filter(order => 
              selectedRowKeys.includes(order.id) && order.status === 'draft'
            )
          
          for (const order of draftOrders) {
            await outboundOrdersApi.confirm(order.id)
          }
          
          message.success('批量审批成功')
          setSelectedRowKeys([])
          fetchData()
        } catch (e: any) {
          const errorMsg = e.response?.data?.detail || e.message || '批量审批失败，请稍后重试'
          message.error(errorMsg)
        }
      }
    })
  }

  const batchActionsMenu: MenuProps['items'] = [
    hasPermission('outbound:confirm')
      ? {
          key: 'confirm',
          label: (
            <span>
              <CheckOutlined style={{ marginRight: 8 }} />
              批量审批
            </span>
          ),
          onClick: handleBatchConfirm,
        }
      : null,
    hasPermission('outbound:delete')
      ? {
          key: 'delete',
          label: (
            <span style={{ color: '#ff4d4f' }}>
              <DeleteOutlined style={{ marginRight: 8 }} />
              批量删除
            </span>
          ),
          onClick: handleBatchDelete,
        }
      : null,
  ].filter(Boolean) as any

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await outboundOrdersApi.downloadTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '出库单模板_' + new Date().toISOString().split('T')[0] + '.xlsx')
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

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setUploading(true)
      try {
        const res = await outboundOrdersApi.uploadPreview(file)
        if (res.data.success) {
          setPreviewItems(res.data.data || [])
          setPreviewModalOpen(true)
        } else {
          message.error(res.data.message || '预览失败')
        }
      } catch (e: any) {
        const errorMsg = e.response?.data?.detail || e.message || '预览失败'
        message.error(errorMsg, 8)
      } finally {
        setUploading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    []
  )

  const handleConfirmImport = useCallback(async () => {
    if (!productList.length) {
      message.warning('请等待产品列表加载完成')
      return
    }
    const newItems = previewItems.map((item) => {
      const product = productList.find(
        (p) =>
          p.product_code === item.product_code ||
          p.name === item.product_name ||
          p.id === item.product_id
      )
      return {
        key: generateItemKey(),
        product_id: product?.id || null,
        quantity: item.quantity || 1,
        unit_price: item.unit_price || (product?.purchase_price || 0),
        notes: item.notes || '',
      }
    }).filter((item) => item.product_id != null)

    if (newItems.length === 0) {
      message.error('未找到匹配的产品，请检查 SKU')
      setPreviewModalOpen(false)
      return
    }

    // 为每个导入的产品加载库存批次信息
    const productIds = newItems.map((item) => item.product_id as number)
    await Promise.all(productIds.map((pid) => fetchProductBatches(pid)))

    // 先获取所有需要添加的配件信息
    const accessoriesToAdd: Array<{ parentKey: string, items: OutboundFormItem[] }> = []
    for (const item of newItems) {
      const product = productList.find((p) => p.id === item.product_id)
      if (product) {
        const productType = product.product_type
        const typeList = Array.isArray(productType) ? productType : (productType ? productType.split(',') : [])
        if (typeList.includes('finished')) {
          // 直接获取配件信息，而不是通过fetchAccessoriesAndAdd
          try {
            const res = await productBindingsApi.getByFinished(item.product_id as number)
            if (res.data.success && res.data.data && res.data.data.length > 0) {
              const accessories = res.data.data
              const accessoryItems: OutboundFormItem[] = []
              
              for (const acc of accessories) {
                const accessoryProduct = productList.find((p) => p.id === acc.accessory_product_id)
                const newItem = createEmptyFormItem()
                // 配件数量 = 每1个成品需要的配件数量 * 成品数量
                const accessoryQuantity = acc.quantity * (item.quantity || 1)
                accessoryItems.push({
                  ...newItem,
                  product_id: acc.accessory_product_id,
                  quantity: accessoryQuantity,
                  unit_price: (accessoryProduct && accessoryProduct.purchase_price != null) ? accessoryProduct.purchase_price : 0,
                  notes: `[自动带出配件] ${acc.accessory_name || ''}`,
                  parentKey: item.key, // 设置parentKey，标识这是配件
                  base_quantity_per_product: acc.quantity, // 保存每1个成品需要的配件基础数量
                })
              }
              
              accessoriesToAdd.push({
                parentKey: item.key,
                items: accessoryItems,
              })
            }
          } catch (e) {
            console.error('获取成品配件失败:', e)
          }
        }
      }
    }

    // 构建排序后的formItems
    const finalItems: OutboundFormItem[] = []
    const newExpandedKeys = new Set(expandedAccessories)
    const accessoryMapForSort = new Map<string, OutboundFormItem[]>()
    
    // 先把所有配件存到映射中
    for (const { parentKey, items } of accessoriesToAdd) {
      accessoryMapForSort.set(parentKey, items)
      
      const addedKeys = new Set<string>()
      for (const item of items) {
        addedKeys.add(item.key)
        // 加载配件批次库存
        fetchProductBatches(item.product_id as number)
      }
      autoAddedKeysRef.current.set(parentKey, addedKeys)
      newExpandedKeys.add(parentKey)
    }
    
    // 按顺序添加成品，然后添加对应的配件
    for (const item of newItems) {
      finalItems.push(item)
      // 查找该成品对应的配件并添加
      const accessories = accessoryMapForSort.get(item.key)
      if (accessories) {
        finalItems.push(...accessories)
      }
    }

    setEditingOrder(null)
    setViewingOrder(null)
    const orderNumber = `OUT${dayjs().format('YYYYMMDDHHmmss')}`
    const handler = user?.nickname || user?.username || ''
    form.setFieldsValue({
      order_number: orderNumber,
      handler: handler,
      outbound_date: dayjs(),
    })
    
    // 设置状态
    setExpandedAccessories(newExpandedKeys)
    setFormItems(finalItems)
    setPreviewModalOpen(false)
    setModalOpen(true)
    message.success('导入成功，请填写出库订单信息')
  }, [previewItems, productList, user, form, fetchProductBatches, expandedAccessories])

  const handleAddFormItem = () => {
    setFormItems((prev) => [...prev, createEmptyFormItem()])
  }

  const handleRemoveFormItem = (key: string) => {
    // 清除该item关联的自动添加配件记录
    autoAddedKeysRef.current.delete(key)
    // 如果该item本身是自动添加的配件，从其父项记录中移除
    for (const [parentKey, childKeys] of autoAddedKeysRef.current.entries()) {
      if (childKeys.has(key)) {
        childKeys.delete(key)
        break
      }
    }
    setFormItems((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((item) => item.key !== key)
    })
  }

  const handleFormItemChange = (key: string, field: keyof OutboundFormItem, value: any) => {
    if (field === 'product_id') {
      // 清除之前为该成品自动添加的配件
      const prevAutoAdded = autoAddedKeysRef.current.get(key)
      if (prevAutoAdded && prevAutoAdded.size > 0) {
        setFormItems((prev) => prev.filter((item) => !prevAutoAdded.has(item.key)))
        autoAddedKeysRef.current.delete(key)
      }

      const product = productList.find((p) => p.id === value)
      const unitPrice = (product && product.purchase_price != null) ? product.purchase_price : 0

      setFormItems((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item
          return { ...item, product_id: value, unit_price: unitPrice }
        }),
      )

      if (value != null) {
        fetchProductBatches(value)
        // 判断是否是成品，自动带出配件
        const productType = product?.product_type
        const typeList = Array.isArray(productType) ? productType : (productType ? productType.split(',') : [])
        if (typeList.includes('finished')) {
          fetchAccessoriesAndAdd(key, value as number)
        }
      }
    } else if (field === 'quantity') {
      setFormItems((prev) => {
        // 首先找到当前被修改的成品项
        const updatedItem = prev.find(item => item.key === key)
        
        // 如果是成品且有配件，需要更新配件数量
        const hasAccessories = autoAddedKeysRef.current.has(key)
        
        if (hasAccessories && updatedItem) {
          const finishedQuantity = value || 0
          const accessoryKeys = autoAddedKeysRef.current.get(key)!
          
          return prev.map(item => {
            if (item.key === key) {
              // 更新成品数量
              return { ...item, quantity: finishedQuantity }
            }
            // 如果是该成品的配件，更新数量
            if (accessoryKeys.has(item.key) && item.base_quantity_per_product) {
              return { 
                ...item, 
                quantity: item.base_quantity_per_product * finishedQuantity 
              }
            }
            return item
          })
        } else {
          // 不是成品，正常更新
          return prev.map(item => {
            if (item.key !== key) return item
            return { ...item, quantity: value || 0 }
          })
        }
      })
    } else {
      setFormItems((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item
          return { ...item, [field]: value }
        }),
      )
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

  const fetchAccessoriesAndAdd = async (parentKey: string, productId: number): Promise<string[]> => {
    console.log('fetchAccessoriesAndAdd called', { parentKey, productId })
    try {
      const res = await productBindingsApi.getByFinished(productId)
      console.log('productBindingsApi response', res)
      
      if (res.data.success && res.data.data && res.data.data.length > 0) {
        const accessories = res.data.data
        const addedKeys: string[] = []
        const accessoryItems: OutboundFormItem[] = []

        // 先构建所有配件项
        for (const acc of accessories) {
          const accessoryProduct = productList.find((p) => p.id === acc.accessory_product_id)
          console.log('accessoryProduct', accessoryProduct)
          
          const newItem = createEmptyFormItem()
          addedKeys.push(newItem.key)
          
          accessoryItems.push({
            ...newItem,
            product_id: acc.accessory_product_id,
            quantity: acc.quantity,
            unit_price: (accessoryProduct && accessoryProduct.purchase_price != null) ? accessoryProduct.purchase_price : 0,
            notes: `[自动带出配件] ${acc.accessory_name || ''}`,
            parentKey: parentKey, // 设置parentKey，标识这是配件
            base_quantity_per_product: acc.quantity, // 保存每1个成品需要的配件基础数量
          })
        }

        console.log('accessoryItems to add', accessoryItems)

        // 一次性更新formItems，把配件放在成品后面
        setFormItems((prev) => {
          console.log('prev formItems', prev)
          // 找到父项的位置
          const parentIndex = prev.findIndex((item) => item.key === parentKey)
          console.log('parentIndex', parentIndex)
          
          if (parentIndex === -1) return prev
          
          const newItems = [...prev]
          // 插入到父项后面
          for (let i = accessoryItems.length - 1; i >= 0; i--) {
            const accessory = accessoryItems[i]
            console.log('Trying to add accessory', accessory)
            // 检查是否已经存在 - 只检查已添加的配件，不检查其他
            const exists = newItems.some(item => item.key === accessory.key)
            if (!exists) {
              newItems.splice(parentIndex + 1, 0, accessory)
            } else {
              console.log('Accessory already exists with key', accessory.key)
            }
          }
          console.log('newItems after adding accessories', newItems)
          return newItems
        })

        if (addedKeys.length > 0) {
          autoAddedKeysRef.current.set(parentKey, new Set(addedKeys))
          console.log('autoAddedKeysRef set', autoAddedKeysRef.current)
          // 自动展开新添加的配件
          setExpandedAccessories((prev) => new Set(prev).add(parentKey))
          console.log('expandedAccessories after add', new Set(Array.from(expandedAccessories)).add(parentKey))
          // 为配件加载批次库存
          for (const acc of accessories) {
            fetchProductBatches(acc.accessory_product_id)
          }
        }
        return addedKeys
      }
    } catch (e) {
      console.error('获取成品配件失败:', e)
    }
    return []
  }

  const columns: ColumnsType<OutboundOrder> = [
    {
      title: '出库单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 160,
      render: (text: string, record: OutboundOrder) => (
        <span
          style={{ color: '#1890ff', cursor: 'pointer' }}
          onClick={() => handleView(record)}
        >
          {text}
        </span>
      ),
    },
    {
      title: '出库类型',
      dataIndex: 'outbound_type',
      key: 'outbound_type',
      width: 110,
      render: (type: string) => (
        <Tag>{outboundTypeLabels[type] || type}</Tag>
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
      title: '仓库',
      dataIndex: 'warehouse',
      key: 'warehouse',
      width: 120,
    },
    {
      title: '发起者',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 100,
    },
    {
      title: '审批者',
      dataIndex: 'confirmer_name',
      key: 'confirmer_name',
      width: 100,
    },
    {
      title: '出库日期',
      dataIndex: 'outbound_date',
      key: 'outbound_date',
      width: 120,
    },
    {
      title: '总数量',
      dataIndex: 'total_quantity',
      key: 'total_quantity',
      width: 90,
    },
    {
      title: '总金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 100,
      render: (amount: number) => amount != null ? `¥${amount.toFixed(2)}` : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => (
        <Tag color={statusColorMap[status] || 'default'}>
          {statusLabelMap[status] || status}
        </Tag>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 200,
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
    },
    {
      title: '审批时间',
      dataIndex: 'confirmed_at',
      key: 'confirmed_at',
      width: 170,
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_: any, record: OutboundOrder) => {
        const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
          switch (key) {
            case 'view':
              handleView(record)
              break
            case 'edit':
              if (record.status === 'draft') {
                handleEdit(record)
              }
              break
            case 'delete':
              if (record.status === 'draft' || isAdmin) {
                Modal.confirm({
                  title: isAdmin && record.status === 'confirmed' 
                    ? '管理员强制删除已确认订单' 
                    : '确定删除该出库订单?',
                  content: isAdmin && record.status === 'confirmed'
                    ? '此操作将同时回滚库存变更，且不可恢复，请谨慎操作！'
                    : '删除后不可恢复，请谨慎操作',
                  okText: '确定',
                  cancelText: '取消',
                  onOk: () => handleDelete(record.id),
                });
              }
              break
          }
        }

        const menuItems: MenuProps['items'] = []

        if (hasPermission('outbound:view')) {
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

        if (hasPermission('outbound:edit') && record.status === 'draft') {
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

        if (hasPermission('outbound:delete') && (record.status === 'draft' || isAdmin)) {
          menuItems.push({
            key: 'delete',
            label: (
              <span style={{ color: '#ff4d4f' }}>
                <DeleteOutlined style={{ marginRight: 8 }} />
                {isAdmin && record.status === 'confirmed' ? '强制删除' : '删除'}
              </span>
            ),
            style: { color: '#ff4d4f' },
          })
        }

        const menu = <Menu onClick={handleMenuClick} items={menuItems} />

        return (
          <Space>
            {hasPermission('outbound:confirm') && (
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={confirmingId === record.id}
                onClick={() => handleConfirm(record.id)}
                disabled={record.status !== 'draft'}
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

  const renderProductStockInfo = (item: OutboundFormItem) => {
    // 查看订单详情时不显示库存信息
    if (viewingOrder) return null
    
    if (item.product_id == null) return null
    const batches = productBatchesMap[item.product_id]
    // 安全处理：确保 batches 是数组
    const safeBatches = Array.isArray(batches) ? batches : []
    const totalStock = getTotalStockForProduct(item.product_id)
    
    // 计算同一张出库单中该产品的总数量（包括自动带出的配件和手动添加的）
    const totalQuantityInOrder = formItems
      .filter((formItem) => formItem.product_id === item.product_id)
      .reduce((sum, formItem) => sum + (formItem.quantity || 0), 0)
    
    const insufficient = totalStock < totalQuantityInOrder

    return (
      <div style={{ marginTop: 8 }}>
        <Alert
          type={batchesLoading ? 'info' : insufficient ? 'warning' : 'success'}
          showIcon
          message={
            <Space>
              <span>当前库存: <strong>{batchesLoading ? '加载中...' : totalStock}</strong></span>
              {totalQuantityInOrder > 0 && !batchesLoading && insufficient && (
                <Tag color="error">库存不足，缺 {totalQuantityInOrder - totalStock}</Tag>
              )}
              {totalQuantityInOrder > 0 && !batchesLoading && !insufficient && (
                <Tag color="success">库存充足</Tag>
              )}
            </Space>
          }
          description={
            <div style={{ marginTop: 4 }}>
              {totalQuantityInOrder > item.quantity && (
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                  本单合计出库: <strong>{totalQuantityInOrder}</strong> 件（含其他行）
                </div>
              )}
              {safeBatches.length > 0 ? (
                <div>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>批次库存明细：</div>
                  <Space wrap size={[8, 4]}>
                    {safeBatches.map((batch, index) => (
                      <Tag key={`${batch.batch_number}-${index}`} color="blue" style={{ fontSize: 11 }}>
                        {batch.batch_number}: {batch.current_quantity || batch.quantity}
                      </Tag>
                    ))}
                  </Space>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#999' }}>暂无批次库存数据</div>
              )}
            </div>
          }
          style={{ padding: '8px 12px' }}
        />
        {!viewingOrder && totalQuantityInOrder > 0 && !batchesLoading && !insufficient && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#1890ff' }}>
            <CheckOutlined style={{ marginRight: 4 }} />
            将按FIFO规则优先出库最早批次
          </div>
        )}
      </div>
    )
  }

  const deductionColumns: ColumnsType<DeductionItem> = [
    {
      title: '商品名称',
      dataIndex: 'product_name',
      key: 'product_name',
    },
    {
      title: '商品编码',
      dataIndex: 'product_code',
      key: 'product_code',
    },
    {
      title: '出库数量',
      dataIndex: 'quantity',
      key: 'quantity',
    },
    {
      title: '扣减批次',
      dataIndex: 'batch_number',
      key: 'batch_number',
      render: (batch: string, record: DeductionItem) => {
        const extraCount = record.batch_details ? record.batch_details.length - 1 : 0
        return (
          <Space size={4}>
            <Tag color="blue">{batch || '-'}</Tag>
            {extraCount > 0 && (
              <Tooltip
                title={
                  <div>
                    {record.batch_details!.map((d, i) => (
                      <div key={i}>
                        批次 <strong>{d.batch_number}</strong>: 扣减 {d.quantity} 件
                      </div>
                    ))}
                  </div>
                }
              >
                <Tag color="orange" style={{ cursor: 'pointer' }}>+{extraCount}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Card
        loading={loading}
        title={
          <Space wrap size="middle">
            <Input
              placeholder="搜索出库单号、仓库、经办人..."
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 300 }}
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <Select
              placeholder="出库类型"
              allowClear
              style={{ width: 140 }}
              value={typeFilter}
              onChange={handleTypeFilter}
              options={outboundTypeOptions}
            />
            <Select
              placeholder="店铺分组"
              allowClear
              style={{ width: 140 }}
              value={groupFilter}
              onChange={handleGroupFilter}
              options={storeGroups.map(g => ({ label: g.name, value: g.id }))}
            />
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 120 }}
              value={statusFilter}
              onChange={handleStatusFilter}
              options={statusOptions}
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
            {hasPermission('outbound:create') && (
              <>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  下载模板
                </Button>
                <Button icon={<UploadOutlined />} onClick={handleUploadClick} loading={uploading}>
                  导入Excel
                </Button>
              </>
            )}
            {(hasPermission('outbound:confirm') || hasPermission('outbound:delete')) && selectedRowKeys.length > 0 && (
              <Dropdown menu={{ items: batchActionsMenu }} trigger={['click']}>
                <Button type="primary">
                  批量操作 ({selectedRowKeys.length}) <DownOutlined />
                </Button>
              </Dropdown>
            )}
            {hasPermission('outbound:create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增出库订单
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
          scroll={{ x: 1500 }}
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
        title={viewingOrder ? '查看出库订单' : (editingOrder ? '编辑出库订单' : '新增出库订单')}
        open={modalOpen}
        onOk={viewingOrder ? () => setModalOpen(false) : handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText={viewingOrder ? '确定' : undefined}
        width={viewingOrder ? 900 : (editingOrder ? 640 : 900)}
        style={{ top: 20 }}
        styles={{ body: {
          maxHeight: 'calc(100vh - 180px)',
          overflow: 'auto',
          paddingRight: 8,
        } }}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="order_number"
              label="出库单号"
              rules={viewingOrder ? [] : [{ required: true, message: '请输入出库单号' }]}
            >
              <Input placeholder="请输入出库单号" disabled={true} />
            </Form.Item>
            <Form.Item
              name="outbound_type"
              label="出库类型"
              rules={viewingOrder ? [] : [{ required: true, message: '请选择出库类型' }]}
            >
              <Select
                placeholder="请选择出库类型"
                options={createOutboundTypeOptions}
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="warehouse" label="仓库" rules={[{ required: true, message: '请选择仓库' }]}>
              <Select
                placeholder="请选择仓库"
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                allowClear
                showSearch
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
                options={warehouseList.map(w => ({ label: `${w.name} (${w.code})`, value: w.name }))}
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
            <Form.Item name="handler" label="经办人">
              <Input placeholder="请输入经办人" disabled={true} />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="store_group_id" label="店铺分组">
              <Select
                placeholder="请选择店铺分组（可选）"
                allowClear
                options={storeGroups.map(g => ({ label: g.name, value: g.id }))}
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
            <Form.Item name="outbound_date" label="出库日期">
              <DatePicker style={{ width: '100%' }} showTime placeholder="请选择出库日期时间" disabled={true} />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" disabled={viewingOrder || (editingOrder?.status === 'confirmed')} />
          </Form.Item>

          <Divider orientation="left" plain>出库商品</Divider>
          {(() => {
            console.log('Rendering items, formItems:', formItems)
            console.log('expandedAccessories:', expandedAccessories)
            
            // 分离成品和配件
            const finishedItems = formItems.filter(item => !item.parentKey)
            const accessoryMap = new Map<string, OutboundFormItem[]>()
            formItems.forEach(item => {
              if (item.parentKey) {
                if (!accessoryMap.has(item.parentKey)) {
                  accessoryMap.set(item.parentKey, [])
                }
                accessoryMap.get(item.parentKey)!.push(item)
              }
            })
            console.log('finishedItems:', finishedItems)
            console.log('accessoryMap:', accessoryMap)

            // 渲染单个商品项的函数
            const renderItem = (item: OutboundFormItem, isAccessory: boolean = false) => {
              const product = productList.find((p) => p.id === item.product_id)
              const hasAccessories = accessoryMap.has(item.key) && accessoryMap.get(item.key)!.length > 0
              const isExpanded = expandedAccessories.has(item.key)

              // 根据产品实际类型判断标签
              const productType = product?.product_type
              const typeList = Array.isArray(productType) ? productType : (productType ? productType.split(',') : [])
              const isFinishedProduct = typeList.includes('finished')
              const isAccessoryProduct = typeList.includes('accessory')

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
                        {isFinishedProduct ? (
                          <Tag icon={<AppstoreOutlined />} color="blue" style={{ fontSize: 12 }}>
                            成品
                          </Tag>
                        ) : isAccessoryProduct ? (
                          <Tag icon={<LinkOutlined />} color="orange" style={{ fontSize: 12 }}>
                            配件
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
                      <Button
                        danger
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleRemoveFormItem(item.key)}
                        disabled={
                          (formItems.filter(i => !i.parentKey).length <= 1 && !item.parentKey) ||
                          viewingOrder ||
                          (editingOrder?.status === 'confirmed')
                        }
                      />
                    </div>

                    {/* 表单字段区域 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>商品</div>
                        <div className="product-select-wrapper" style={{ position: 'relative' }}>
                          <Select
                            className={item.product_id ? 'product-select-with-value' : ''}
                            placeholder="请选择商品"
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
                            options={[
                              ...productList.map((p) => ({
                                label: `${p.product_code ? `[${p.product_code}] ` : ''}${p.name}`,
                                value: p.id,
                              })),
                              // 如果正在加载更多，添加加载中提示
                              ...(productsLoading && productList.length > 0 ? [{
                                label: <span style={{ color: '#999', fontSize: 12 }}>加载中...</span>,
                                value: -1,
                              } as any] : []),
                            ]}
                            style={{ width: '100%' }}
                            disabled={viewingOrder || (editingOrder?.status === 'confirmed') || isAccessory}
                            notFoundContent={
                              productsLoading ? <span>加载中...</span> :
                              productSearchKeyword ? <span>未找到匹配的商品</span> :
                              <span>暂无商品</span>
                            }
                          />
                          {/* 悬停删除图标 */}
                          {item.product_id && !viewingOrder && !(editingOrder?.status === 'confirmed') && !isAccessory && (
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
                      </div>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>数量</div>
                        <InputNumber
                          min={1}
                          value={item.quantity}
                          onChange={(val) => handleFormItemChange(item.key, 'quantity', val || 1)}
                          style={{ width: '100%' }}
                          placeholder="数量"
                          disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                        />
                      </div>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>单价</div>
                        <InputNumber
                          min={0}
                          precision={2}
                          value={item.unit_price}
                          onChange={(val) => handleFormItemChange(item.key, 'unit_price', val || 0)}
                          style={{ width: '100%' }}
                          placeholder="单价"
                          prefix="¥"
                          disabled={viewingOrder || (editingOrder?.status === 'confirmed') || isAccessory}
                        />
                      </div>
                    </div>

                    {/* 备注 */}
                    <div style={{ marginTop: 12 }}>
                      <Input
                        value={item.notes}
                        onChange={(e) => handleFormItemChange(item.key, 'notes', e.target.value)}
                        placeholder="请输入备注"
                        disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                        size="small"
                        style={{ background: isAccessory ? '#fff' : '#fafafa' }}
                      />
                    </div>

                    {/* 报废类型时显示批次选择 */}
                    {!viewingOrder && (!editingOrder || editingOrder.status !== 'confirmed') && watchOutboundType === 'scrap' && item.product_id && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>
                          指定批次 <span style={{ color: '#ff4d4f' }}>*</span>
                        </div>
                        <Select
                          placeholder="请选择出库批次"
                          showSearch
                          value={item.selected_batch_id}
                          onChange={(batchId, option) => {
                            const batchNumber = typeof option === 'object' && option ? (option as any).batchNumber : ''
                            handleFormItemChange(item.key, 'selected_batch_id', batchId)
                            handleFormItemChange(item.key, 'selected_batch_number', batchNumber)
                          }}
                          filterOption={(input, option) =>
                            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                          }
                          options={(() => {
                            const batches = productBatchesMap[item.product_id]
                            if (!Array.isArray(batches) || batches.length === 0) return []
                            return batches.map((b) => ({
                              label: `${b.batch_number} (库存: ${b.current_quantity || b.quantity}件)`,
                              value: (b as any).id || (b as any).batch_id,
                              batchNumber: b.batch_number,
                            }))
                          })()}
                          style={{ width: '100%' }}
                        />
                      </div>
                    )}
                    {(viewingOrder || editingOrder?.status === 'confirmed') && item.batch_details && item.batch_details.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 500 }}>出库扣减批次：</div>
                        <Space wrap size={[4, 4]}>
                          {item.batch_details.map((bd, bi) => (
                            <Tag key={bi} color={bi === 0 ? 'blue' : 'orange'} style={{ fontSize: 11 }}>
                              {bd.batch_number}: {bd.quantity} 件
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {renderProductStockInfo(item)}
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
          {!viewingOrder && (!editingOrder || editingOrder.status !== 'confirmed') && (
            <Button
              type="dashed"
              onClick={handleAddFormItem}
              icon={<PlusOutlined />}
              style={{ width: '100%' }}
            >
              添加商品
            </Button>
          )}
        </Form>
      </Modal>

      <Modal
        title="出库审批 - 库存扣减详情"
        open={confirmModalOpen}
        onCancel={() => setConfirmModalOpen(false)}
        footer={
          <Button type="primary" onClick={() => setConfirmModalOpen(false)}>
            知道了
          </Button>
        }
        width={700}
      >
        <Alert
          type="success"
          message="出库订单已审批"
          description="以下批次库存已按FIFO规则自动扣减，请核对。"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Table
          dataSource={deductionResults}
          columns={deductionColumns}
          rowKey={(record, index) => `${record.batch_id || index}`}
          pagination={false}
          size="small"
        />
      </Modal>

      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".xlsx,.xls"
        onChange={handleFileChange}
      />

      <Modal
        title="导入预览"
        open={previewModalOpen}
        onOk={handleConfirmImport}
        onCancel={() => setPreviewModalOpen(false)}
        width={800}
      >
        <Table
          dataSource={previewItems}
          pagination={false}
          rowKey={(record, index) => index.toString()}
          columns={[
            {
              title: 'SKU',
              dataIndex: 'product_code',
              key: 'product_code',
            },
            {
              title: '商品名称',
              dataIndex: 'product_name',
              key: 'product_name',
            },
            {
              title: '数量',
              dataIndex: 'quantity',
              key: 'quantity',
            },
            {
              title: '备注',
              dataIndex: 'notes',
              key: 'notes',
            },
          ]}
        />
      </Modal>
    </div>
  )
}

export default OutboundManagement