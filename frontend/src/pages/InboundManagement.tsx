import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Space, Tag, Divider, Dropdown, Menu, Pagination } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, SearchOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, DownOutlined, AppstoreOutlined, LinkOutlined, RightOutlined, CloseCircleFilled } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { inboundOrdersApi, productsApi, warehousesApi, productBindingsApi } from '../api'
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

interface InboundOrder {
  id: number
  order_number: string
  inbound_type: string
  purchase_order_id: number | null
  warehouse: string
  handler: string
  inbound_date: string
  total_quantity: number
  total_amount: number
  status: string
  notes: string
  created_at: string
  confirmed_at: string
  confirmed_by: number | null
  creator_name: string
  confirmer_name: string
  items: InboundOrderItem[]
}

interface InboundOrderItem {
  id: number
  product_id: number
  product_name: string
  product_code: string
  quantity: number
  unit_price: number
  total_price: number
  batch_number: string
  production_date: string
  expiry_date: string
  warehouse: string
  shelf_number: string
  notes: string
  purchase_order_item_id?: number | null
  purchase_order_number?: string
}

interface Product {
  id: number
  name: string
  product_code: string
  purchase_price: number | null
  product_type?: string | string[]
}

interface ProductFormItem {
  key: string
  product_id: number | null
  quantity: number
  unit_price: number
  shelf_number?: string
  notes?: string
  purchase_order_item_ids?: number[]  // 关联的采购单明细ID（多选）
  parentKey?: string  // 配件行关联的成品行key
  base_quantity_per_product?: number  // 每1个成品需要的配件基础数量
}

interface PendingPurchaseItem {
  poi_id: number
  po_id: number
  order_number: string
  supplier: string
  po_status: string
  approved_at: string
  product_id: number
  ordered_qty: number
  received_quantity: number
  remaining_qty: number
  unit_price: number
  product_name: string
  product_code: string
  binding_qty?: number
  is_accessory_match?: boolean
  finished_name?: string
  finished_code?: string
}

interface WarehouseItem {
  id: number
  name: string
  code: string
  status: string
}

const inboundTypeLabels: Record<string, string> = {
  purchase: '采购入库',
  return: '退货入库',
  transfer: '调拨入库',
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

const inboundTypeOptions = [
  { label: '全部', value: '' },
  { label: '采购入库', value: 'purchase' },
  { label: '退货入库', value: 'return' },
  { label: '调拨入库', value: 'transfer' },
  { label: '盘点调整', value: 'adjustment' },
  { label: '其他', value: 'other' },
]

const statusOptions = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '已审批', value: 'confirmed' },
  { label: '已取消', value: 'cancelled' },
]

const createInboundTypeOptions = [
  { label: '采购入库', value: 'purchase' },
  { label: '退货入库', value: 'return' },
  { label: '调拨入库', value: 'transfer' },
  { label: '盘点调整', value: 'adjustment' },
  { label: '其他', value: 'other' },
]

let itemKeyCounter = 0
const generateItemKey = () => `item_${Date.now()}_${++itemKeyCounter}`

const createEmptyFormItem = (): ProductFormItem => ({
  key: generateItemKey(),
  product_id: null,
  quantity: 1,
  unit_price: 0,
  shelf_number: '',
  notes: '',
  purchase_order_item_ids: [],
})

const InboundManagement: React.FC = () => {
  const { currentTheme: _ } = useTheme()
  const { user, hasPermission } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const [orders, setOrders] = useState<InboundOrder[]>([])
  const [productList, setProductList] = useState<Product[]>([])
  const [warehouseList, setWarehouseList] = useState<WarehouseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  // 已关联采购单号映射: poi_id → order_number（查看/编辑时使用）
  const [linkedPOMap, setLinkedPOMap] = useState<Record<number, string>>({})
  const [editingOrder, setEditingOrder] = useState<InboundOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<InboundOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<ProductFormItem[]>([createEmptyFormItem()])
  const [submitting, setSubmitting] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  // 产品搜索关键字（用于懒加载搜索）
  const [productSearchKeyword, setProductSearchKeyword] = useState('')
  // 产品分页状态（用于懒加载）
  const [productPagination, setProductPagination] = useState({ current: 1, pageSize: 50, total: 0, hasMore: true })
  // 缓存每个产品的待收货采购单列表（按产品ID索引）
  const [pendingPurchaseMap, setPendingPurchaseMap] = useState<Record<number, PendingPurchaseItem[]>>({})
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [expandedAccessories, setExpandedAccessories] = useState<Set<string>>(new Set())
  // 跟踪自动添加的配件key，切换产品时清除旧配件
  const autoAddedKeysRef = useRef<Map<string, Set<string>>>(new Map())
  // 产品搜索防抖定时器
  const productSearchTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    fetchData()
    fetchProducts()
    fetchWarehouses()
  }, [pagination.current, pagination.pageSize, filters])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await inboundOrdersApi.getList({
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
      // 入库单产品选择时过滤掉含配件的成品
      const res = await productsApi.getList({
        page: page,
        page_size: productPagination.pageSize,
        exclude_finished_with_accessories: true,
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

  const fetchWarehouses = async (): Promise<WarehouseItem[]> => {
    try {
      const res = await warehousesApi.getList({ page_size: 100 })
      console.log('Warehouses loaded:', res.data.data)
      const list = res.data.data || []
      setWarehouseList(list)
      return list
    } catch (error) {
      console.error('Failed to load warehouses:', error)
      return []
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

  const handleTypeFilter = (value: string | undefined) => {
    setTypeFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (value) {
        next.inbound_type = value
      } else {
        delete next.inbound_type
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
    form.resetFields()
    setPendingPurchaseMap({})  // 清空采购单缓存
    setLinkedPOMap({})  // 清空已关联采购单映射

    // 重置产品搜索状态
    setProductSearchKeyword('')
    setProductPagination(prev => ({ ...prev, current: 1, hasMore: true }))
    fetchProducts('', 1, false)  // 恢复初始产品列表

    const orderNumber = `IN${dayjs().format('YYYYMMDDHHmmss')}`
    const handler = user?.nickname || user?.username || ''
    form.setFieldsValue({
      order_number: orderNumber,
      handler: handler,
    })
    setFormItems([createEmptyFormItem()])
    setExpandedAccessories(new Set())
    autoAddedKeysRef.current.clear()
    fetchWarehouses().then((list) => {
      // 默认选择最新创建的仓库
      if (list.length > 0 && !form.getFieldValue('warehouse')) {
        form.setFieldsValue({ warehouse: list[0].name })
      }
    })
    setModalOpen(true)
  }

  const handleView = async (order: InboundOrder) => {
    setViewingOrder(order)
    setEditingOrder(null)
    form.setFieldsValue({
      order_number: order.order_number,
      inbound_type: order.inbound_type,
      warehouse: order.warehouse,
      handler: order.handler,
      inbound_date: order.inbound_date ? dayjs(order.inbound_date) : undefined,
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
      // 去重产品列表
      const uniqueProducts = Array.from(new Map(orderProducts.map((p: any) => [p.id, p])).values())
      setProductList(uniqueProducts)
      // 收集已关联采购单号映射
      const newLinkedPOMap: Record<number, string> = {}
      for (const item of order.items) {
        if (item.purchase_order_item_id && item.purchase_order_number) {
          newLinkedPOMap[item.purchase_order_item_id] = item.purchase_order_number
        }
      }
      setLinkedPOMap(newLinkedPOMap)
      // 合并同产品的行（多采购单展开后需要合并回一行）
      const mergedMap = new Map<string, any>()
      for (const item of order.items) {
        const pid = Number(item.product_id)
        const mapKey = `${pid}_${item.unit_price}_${item.shelf_number || ''}_${item.notes || ''}`
        if (mergedMap.has(mapKey)) {
          const existing = mergedMap.get(mapKey)
          existing.quantity += item.quantity
          if (item.purchase_order_item_id) {
            existing.purchase_order_item_ids.push(item.purchase_order_item_id)
          }
        } else {
          mergedMap.set(mapKey, {
            key: generateItemKey(),
            product_id: pid || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            shelf_number: item.shelf_number || '',
            notes: item.notes || '',
            purchase_order_item_ids: item.purchase_order_item_id ? [item.purchase_order_item_id] : [],
          })
        }
      }
      setFormItems(Array.from(mergedMap.values()))
    } else {
      setProductList([])
      setFormItems([createEmptyFormItem()])
      setLinkedPOMap({})
    }
    fetchWarehouses()
    // 加载每个产品的待收货采购单，让关联采购单下拉框能正确显示
    if (order.items && order.items.length > 0) {
      order.items.forEach((item: any) => {
        if (item.product_id) {
          fetchPendingPurchaseItems(Number(item.product_id))
        }
      })
    }
    setModalOpen(true)
  }

  const handleEdit = async (order: InboundOrder) => {
    setViewingOrder(null)
    setEditingOrder(order)
    form.setFieldsValue({
      order_number: order.order_number,
      inbound_type: order.inbound_type,
      warehouse: order.warehouse,
      handler: order.handler,
      inbound_date: order.inbound_date ? dayjs(order.inbound_date) : undefined,
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
      // 去重产品列表
      const uniqueProducts = Array.from(new Map(orderProducts.map((p: any) => [p.id, p])).values())
      setProductList(uniqueProducts)
      // 收集已关联采购单号映射
      const newLinkedPOMap: Record<number, string> = {}
      for (const item of order.items) {
        if (item.purchase_order_item_id && item.purchase_order_number) {
          newLinkedPOMap[item.purchase_order_item_id] = item.purchase_order_number
        }
      }
      setLinkedPOMap(newLinkedPOMap)
      // 合并同产品的行（多采购单展开后需要合并回一行）
      const mergedMap = new Map<string, any>()
      for (const item of order.items) {
        const pid = Number(item.product_id)
        const mapKey = `${pid}_${item.unit_price}_${item.shelf_number || ''}_${item.notes || ''}`
        if (mergedMap.has(mapKey)) {
          const existing = mergedMap.get(mapKey)
          existing.quantity += item.quantity
          if (item.purchase_order_item_id) {
            existing.purchase_order_item_ids.push(item.purchase_order_item_id)
          }
        } else {
          mergedMap.set(mapKey, {
            key: generateItemKey(),
            product_id: pid || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            shelf_number: item.shelf_number || '',
            notes: item.notes || '',
            purchase_order_item_ids: item.purchase_order_item_id ? [item.purchase_order_item_id] : [],
          })
        }
      }
      setFormItems(Array.from(mergedMap.values()))
    } else {
      setFormItems([createEmptyFormItem()])
      setLinkedPOMap({})
    }
    // 后台异步加载完整产品列表（不阻塞弹窗打开）
    fetchProducts()
    fetchWarehouses()
    // 加载每个产品的待收货采购单，让关联采购单下拉框能正确显示
    if (order.items && order.items.length > 0) {
      order.items.forEach((item: any) => {
        if (item.product_id) {
          fetchPendingPurchaseItems(Number(item.product_id))
        }
      })
    }
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      const validItems = formItems.filter((item) => item.product_id != null && item.quantity > 0)
      if (validItems.length === 0) {
        message.warning('请至少添加一个完整的入库商品')
        return
      }

      // 展开多采购单项：一个产品关联多个采购单时，按采购单数量比例拆分为多条入库明细
      const expandedItems: any[] = []
      for (const item of validItems) {
        const poiIds = item.purchase_order_item_ids || []
        if (poiIds.length <= 1) {
          expandedItems.push({
            product_id: item.product_id!,
            quantity: item.quantity,
            unit_price: item.unit_price,
            shelf_number: item.shelf_number,
            notes: item.notes,
            purchase_order_item_id: poiIds[0] || undefined,
          })
        } else {
          // 多个采购单，按剩余数量比例分配入库数量
          const pendingItems = pendingPurchaseMap[item.product_id!] || []
          let remainingQty = item.quantity
          for (let i = 0; i < poiIds.length; i++) {
            const poiId = poiIds[i]
            const pendingItem = pendingItems.find((p: any) => p.poi_id === poiId)
            const poRemaining = pendingItem?.remaining_qty || 0
            const allocatedQty = i === poiIds.length - 1 ? remainingQty : Math.min(poRemaining, remainingQty)
            if (allocatedQty > 0) {
              expandedItems.push({
                product_id: item.product_id!,
                quantity: allocatedQty,
                unit_price: item.unit_price,
                shelf_number: item.shelf_number,
                notes: item.notes,
                purchase_order_item_id: poiId,
              })
            }
            remainingQty -= allocatedQty
            if (remainingQty <= 0) break
          }
        }
      }

      // 预检查采购单数量差异
      const checkItems = expandedItems.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        purchase_order_item_ids: item.purchase_order_item_id ? [item.purchase_order_item_id] : [],
      }))
      const diffCheckRes: any = await inboundOrdersApi.checkPurchaseDiff(checkItems)

      if (diffCheckRes.data.has_warning && diffCheckRes.data.warnings?.length > 0) {
        const warnings = diffCheckRes.data.warnings
        const warningLines = warnings.map((w: any) =>
          `${w.product_name} [采购单${w.purchase_order_number}]: 采购${w.ordered_qty}件, 已收${w.received_before}件, 剩余应收${w.remaining_qty}件, 实际入库${w.inbound_qty}件（${w.diff_type}${w.diff_amount}件）`
        )

        Modal.confirm({
          title: diffCheckRes.data.warning_message || '入库数量与采购单数量不一致',
          icon: <InfoCircleOutlined style={{ color: '#faad14' }} />,
          width: 600,
          content: (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              <p style={{ marginBottom: 8, color: '#666' }}>以下商品入库数量与采购单剩余应收数量不一致：</p>
              {warningLines.map((line: string, i: number) => (
                <div key={i} style={{ marginBottom: 4, fontSize: 13 }}>{line}</div>
              ))}
            </div>
          ),
          okText: '已知晓',
          cancelText: '返回修改',
          okButtonProps: { type: 'primary' },
          onOk: async () => {
            setSubmitting(true)
            try {
              // 保存入库单
              const payload: Record<string, any> = {
                order_number: values.order_number,
                inbound_type: values.inbound_type,
                warehouse: values.warehouse,
                handler: values.handler,
                notes: values.notes,
                items: expandedItems,
              }
              if (values.inbound_date) {
                payload.inbound_date = values.inbound_date.format('YYYY-MM-DD HH:mm:ss')
              }

              if (editingOrder) {
                await inboundOrdersApi.update(editingOrder.id, payload)
                message.success('入库订单更新成功')
              } else {
                await inboundOrdersApi.create(payload as any)
                message.success('入库订单创建成功')
              }

              // 发送差异通知给对应采购人员
              try {
                await inboundOrdersApi.notifyInboundDiff(values.order_number, warnings)
              } catch (notifyErr: any) {
                console.warn('发送差异通知失败:', notifyErr)
              }

              setModalOpen(false)
              fetchData()
            } catch (e: any) {
              const errorMsg = e.response?.data?.detail || e.message || '操作失败'
              message.error(errorMsg)
            } finally {
              setSubmitting(false)
            }
          },
          onCancel: () => {
            // 返回继续编辑，不做任何操作
          },
        })
        return
      }

      // 无差异，直接保存
      setSubmitting(true)

      if (editingOrder) {
        const payload: Record<string, any> = {
          order_number: values.order_number,
          inbound_type: values.inbound_type,
          warehouse: values.warehouse,
          handler: values.handler,
          notes: values.notes,
          items: expandedItems,
        }
        if (values.inbound_date) {
          payload.inbound_date = values.inbound_date.format('YYYY-MM-DD HH:mm:ss')
        }
        await inboundOrdersApi.update(editingOrder.id, payload)
        message.success('入库订单更新成功')
      } else {
        const payload: Record<string, any> = {
          order_number: values.order_number,
          inbound_type: values.inbound_type,
          warehouse: values.warehouse,
          handler: values.handler,
          notes: values.notes,
          items: expandedItems,
        }
        await inboundOrdersApi.create(payload as any)
        message.success('入库订单创建成功')
      }

      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      const errorMsg = e.response?.data?.detail || e.message || '操作失败'
      message.error(errorMsg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirm = async (id: number) => {
    Modal.confirm({
      title: '确认审批',
      content: '确定要审批此入库订单吗？此操作将自动更新库存。',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res: any = await inboundOrdersApi.confirm(id)
          if (res.data.warnings && res.data.warnings.length > 0) {
            // 有采购单数量差异，弹窗提醒
            const warningLines = res.data.warnings.map((w: any) =>
              `${w.product_name} [采购单${w.purchase_order_number}]: 采购${w.ordered_qty}件, 已收${w.received_before}件, 剩余应收${w.remaining_qty}件, 实际入库${w.inbound_qty}件（${w.diff_type}${w.diff_amount}件）`
            )
            Modal.warning({
              title: res.data.warning_message || '入库数量与采购单数量不一致',
              content: (
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  {warningLines.map((line: string, i: number) => (
                    <div key={i} style={{ marginBottom: 4 }}>{line}</div>
                  ))}
                </div>
              ),
              okText: '我已知晓',
              width: 600,
            })
          } else {
            message.success('入库订单已审批，库存已自动更新')
          }
          fetchData()
          fetchProducts()
        } catch (e: any) {
          const detail = e.response?.data?.detail || ''
          if (detail.includes('未处理的数量差异')) {
            Modal.error({
              title: '存在未处理的数量差异',
              content: (
                <div>
                  <p>{detail}</p>
                  <p style={{ color: '#1890ff', marginTop: 8 }}>请前往 KPI 页面点击「入库数量差异」卡片进行处理。</p>
                </div>
              ),
              okText: '知道了',
              width: 500,
            })
          } else {
            message.error(detail || '审批失败')
          }
        }
      },
    })
  }

  const handleDelete = async (id: number) => {
    try {
      await inboundOrdersApi.delete(id)
      message.success('入库订单删除成功')
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
      content: `确定要删除选中的 ${selectedRowKeys.length} 条入库订单吗？此操作不可恢复。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(key => 
            inboundOrdersApi.delete(Number(key))
          ))
          message.success('批量删除成功')
          setSelectedRowKeys([])
          fetchData()
        } catch (e: any) {
          const errorMsg = e.response?.data?.detail || e.message || '批量删除失败，请稍后重试'
          message.error(errorMsg)
        }
      }
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
      content: `确定要审批选中的 ${draftCount} 条入库订单吗？此操作将自动更新库存。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const promises = orders
            .filter(order => 
              selectedRowKeys.includes(order.id) && order.status === 'draft'
            )
            .map(order => inboundOrdersApi.confirm(order.id))
          
          await Promise.all(promises)
          message.success('批量审批成功')
          setSelectedRowKeys([])
          fetchData()
          fetchProducts()
        } catch (e: any) {
          const errorMsg = e.response?.data?.detail || e.message || '批量审批失败，请稍后重试'
          message.error(errorMsg)
        }
      }
    })
  }

  const batchActionsMenu: MenuProps['items'] = [
    hasPermission('inbound:confirm')
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
    hasPermission('inbound:delete')
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

  const handleAddFormItem = () => {
    setFormItems((prev) => [...prev, createEmptyFormItem()])
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
    autoAddedKeysRef.current.delete(key)
  }

  const handleFormItemChange = (key: string, field: keyof ProductFormItem, value: any) => {
    if (field === 'product_id') {
      // 清除之前为该成品自动添加的配件
      const prevAutoAdded = autoAddedKeysRef.current.get(key)
      if (prevAutoAdded && prevAutoAdded.size > 0) {
        setFormItems((prev) => prev.filter((item) => !prevAutoAdded.has(item.key)))
        autoAddedKeysRef.current.delete(key)
      }

      const product = productList.find((p) => p.id === value)
      const unitPrice = (product && product.purchase_price != null) ? product.purchase_price : 0

      // 选择商品时加载待收货采购单列表并自动匹配
      if (value) {
        // 检查当前行是否是配件行（有parentKey），配件行不自动选中采购单
        const isAccessory = formItems.find((item) => item.key === key)?.parentKey
        
        // 如果已有缓存的采购单数据，直接执行自动匹配
        if (pendingPurchaseMap[value]) {
          const pendingItems = pendingPurchaseMap[value]
          if (isAccessory) {
            // 配件行：只设置基本字段，不自动选中采购单
            setFormItems((prev) =>
              prev.map((item) => {
                if (item.key !== key) return item
                return { ...item, product_id: value, unit_price: unitPrice }
              }),
            )
          } else {
            // 成品行：自动选中第一个待收货采购单
            const matchedIds = pendingItems.length > 0 ? [pendingItems[0].poi_id] : []
            const matchedQty = pendingItems.length > 0 ? pendingItems[0].remaining_qty : 1
            setFormItems((prev) =>
              prev.map((item) => {
                if (item.key !== key) return item
                return { ...item, product_id: value, unit_price: unitPrice, quantity: matchedQty, purchase_order_item_ids: matchedIds }
              }),
            )
          }
        } else {
          // 没有缓存则先加载，加载完成后自动选中第一个采购单（仅成品行）
          fetchPendingPurchaseItems(value).then((loadedItems) => {
            if (loadedItems.length === 0 || isAccessory) return
            // 自动选中第一个待收货采购单，并设置数量为剩余待收数量
            const firstMatch = loadedItems[0]
            setFormItems((prev) =>
              prev.map((item) =>
                item.key === key ? { ...item, quantity: firstMatch.remaining_qty, purchase_order_item_ids: [firstMatch.poi_id] } : item
              ),
            )
          })
          // 先设置基本字段（采购单稍后自动匹配）
          setFormItems((prev) =>
            prev.map((item) => {
              if (item.key !== key) return item
              return { ...item, product_id: value, unit_price: unitPrice, purchase_order_item_ids: [] }
            }),
          )
        }
      } else {
        // 清空产品选择
        setFormItems((prev) =>
          prev.map((item) => {
            if (item.key !== key) return item
            return { ...item, product_id: value, unit_price: unitPrice, purchase_order_item_ids: [] }
          }),
        )
      }
      // 选择成品商品时，自动获取配件
      if (value) {
        fetchAccessoriesAndAdd(key, value)
      }
    } else if (field === 'quantity') {
      setFormItems((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item
          const updated = { ...item, quantity: value || 0 }
          // 数量变化时自动匹配采购单
          if (updated.product_id && pendingPurchaseMap[updated.product_id]) {
            const pendingItems = pendingPurchaseMap[updated.product_id]
            const qty = value || 0
            // 检查数量是否等于某个采购单的剩余数量
            const singleMatch = pendingItems.find((pp: any) => pp.remaining_qty === qty)
            if (singleMatch) {
              updated.purchase_order_item_ids = [singleMatch.poi_id]
            } else {
              // 检查数量是否等于多个采购单剩余数量之和
              let sum = 0
              const matchedIds: number[] = []
              for (const pp of pendingItems) {
                if (sum + pp.remaining_qty <= qty) {
                  sum += pp.remaining_qty
                  matchedIds.push(pp.poi_id)
                  if (sum === qty) break
                }
              }
              if (sum === qty && matchedIds.length > 0) {
                updated.purchase_order_item_ids = matchedIds
              }
              // 否则保持当前选择不变
            }
          }
          return updated
        }),
      )
      // 成品数量变化时，同步更新配件数量并自动匹配采购单
      setFormItems((prev) => {
        const changedItem = prev.find((item) => item.key === key)
        if (changedItem && !changedItem.parentKey) {
          return prev.map((item) => {
            if (item.parentKey !== key) return item
            const baseQty = item.base_quantity_per_product || 1
            const newQty = (value || 0) * baseQty
            const updated = { ...item, quantity: newQty }
            // 配件数量变化时也自动匹配采购单
            if (updated.product_id && pendingPurchaseMap[updated.product_id]) {
              const pendingItems = pendingPurchaseMap[updated.product_id]
              const singleMatch = pendingItems.find((pp: any) => pp.remaining_qty === newQty)
              if (singleMatch) {
                updated.purchase_order_item_ids = [singleMatch.poi_id]
              } else {
                let sum = 0
                const matchedIds: number[] = []
                for (const pp of pendingItems) {
                  if (sum + pp.remaining_qty <= newQty) {
                    sum += pp.remaining_qty
                    matchedIds.push(pp.poi_id)
                    if (sum === newQty) break
                  }
                }
                if (sum === newQty && matchedIds.length > 0) {
                  updated.purchase_order_item_ids = matchedIds
                }
              }
            }
            return updated
          })
        }
        return prev
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

  // 获取指定产品的待收货采购单列表（FIFO排序）
  const fetchPendingPurchaseItems = async (productId: number): Promise<PendingPurchaseItem[]> => {
    try {
      const res = await inboundOrdersApi.getPendingPurchaseItems(productId)
      if (res.data.success && res.data.data.length > 0) {
        const items: PendingPurchaseItem[] = res.data.data
        setPendingPurchaseMap(prev => ({ ...prev, [productId]: items }))
        return items
      } else {
        setPendingPurchaseMap(prev => ({ ...prev, [productId]: [] }))
        return []
      }
    } catch {
      // 查询失败不阻塞用户操作
      return []
    }
  }

  // 手动修改某个商品行的采购单关联（多选）
  const handlePurchaseOrderChange = (key: string, poiIds: number[]) => {
    setFormItems(prev => prev.map(item => {
      if (item.key !== key) return item
      const updated = { ...item, purchase_order_item_ids: poiIds }
      // 根据选中的采购单自动更新数量
      if (item.product_id && pendingPurchaseMap[item.product_id]) {
        const selectedRemaining = poiIds.reduce((sum, poiId) => {
          const pp = pendingPurchaseMap[item.product_id!]?.find((p: any) => p.poi_id === poiId)
          return sum + (pp?.remaining_qty || 0)
        }, 0)
        if (selectedRemaining > 0) {
          updated.quantity = selectedRemaining
        }
      }
      return updated
    }))
  }

  const fetchAccessoriesAndAdd = async (parentKey: string, productId: number) => {
    try {
      const res = await productBindingsApi.getByFinished(productId)
      if (res.data.success && res.data.data && res.data.data.length > 0) {
        const accessories = res.data.data
        const addedKeys: string[] = []
        const accessoryItems: ProductFormItem[] = []

        for (const acc of accessories) {
          const accessoryProduct = productList.find((p) => p.id === acc.accessory_product_id)
          const newItem = createEmptyFormItem()
          addedKeys.push(newItem.key)

          accessoryItems.push({
            ...newItem,
            product_id: acc.accessory_product_id,
            quantity: (acc.quantity || 1),
            unit_price: (accessoryProduct && accessoryProduct.purchase_price != null) ? accessoryProduct.purchase_price : 0,
            parentKey: parentKey,
            base_quantity_per_product: acc.quantity || 1,
          })
        }

        if (accessoryItems.length === 0) return

        setFormItems((prev) => {
          // 找到父项的位置
          const parentIndex = prev.findIndex((item) => item.key === parentKey)
          if (parentIndex === -1) return prev

          const parentItem = prev[parentIndex]
          const parentQty = parentItem.quantity || 1

          // 更新配件数量为 parentQty * base_quantity
          const finalAccessoryItems = accessoryItems.map(item => ({
            ...item,
            quantity: parentQty * (item.base_quantity_per_product || 1),
          }))

          const newItems = [...prev]
          newItems.splice(parentIndex + 1, 0, ...finalAccessoryItems)
          return newItems
        })

        if (addedKeys.length > 0) {
          autoAddedKeysRef.current.set(parentKey, new Set(addedKeys))
          setExpandedAccessories((prev) => new Set(prev).add(parentKey))
          // 为配件加载待收货采购单
          for (const acc of accessories) {
            fetchPendingPurchaseItems(acc.accessory_product_id)
          }
        }
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

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await inboundOrdersApi.downloadTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '入库单模板_' + new Date().toISOString().split('T')[0] + '.xlsx')
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
        const res = await inboundOrdersApi.uploadPreview(file)
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

  const handleConfirmImport = useCallback(() => {
    const newItems = previewItems.map((item) => {
      return {
        key: generateItemKey(),
        product_id: item.product_id || null,
        quantity: item.quantity || 1,
        unit_price: item.unit_price || 0,
        shelf_number: item.shelf_number || '',
        notes: item.notes || '',
        purchase_order_item_ids: [] as number[],
      }
    }).filter((item) => item.product_id != null)

    if (newItems.length === 0) {
      message.error('未找到匹配的产品，请检查产品编码')
      setPreviewModalOpen(false)
      return
    }

    // 为导入的商品加载待收货采购单，加载完成后自动匹配
    const productIds = [...new Set(newItems.map(i => i.product_id!).filter(Boolean))]
    Promise.all(productIds.map(pid => inboundOrdersApi.getPendingPurchaseItems(pid!)))
      .then(results => {
        const newPendingMap: Record<number, PendingPurchaseItem[]> = { ...pendingPurchaseMap }
        results.forEach((res, idx) => {
          const pid = productIds[idx]!
          if (res.data.success && res.data.data.length > 0) {
            newPendingMap[pid] = res.data.data
          } else {
            newPendingMap[pid] = []
          }
        })
        setPendingPurchaseMap(newPendingMap)
        // 根据数量自动匹配采购单
        setFormItems(prev => prev.map(item => {
          if (!item.product_id) return item
          const pendingItems = newPendingMap[item.product_id]
          if (!pendingItems || pendingItems.length === 0) return item
          const qty = item.quantity
          // 数量等于某个采购单的剩余 → 只选那一个
          const singleMatch = pendingItems.find((pp: any) => pp.remaining_qty === qty)
          if (singleMatch) {
            return { ...item, purchase_order_item_ids: [singleMatch.poi_id] }
          }
          // 数量等于多个采购单剩余之和 → 全选
          let sum = 0
          const matchedIds: number[] = []
          for (const pp of pendingItems) {
            if (sum + pp.remaining_qty <= qty) {
              sum += pp.remaining_qty
              matchedIds.push(pp.poi_id)
              if (sum === qty) break
            }
          }
          if (sum === qty && matchedIds.length > 0) {
            return { ...item, purchase_order_item_ids: matchedIds }
          }
          return item
        }))
      })
      .catch(() => {})

    setEditingOrder(null)
    const orderNumber = `IN${dayjs().format('YYYYMMDDHHmmss')}`
    const handler = user?.nickname || user?.username || ''
    form.setFieldsValue({
      order_number: orderNumber,
      handler: handler,
    })
    setFormItems(newItems)
    setPreviewModalOpen(false)
    setModalOpen(true)

    // 导入时默认选择最新创建的仓库
    fetchWarehouses().then((list) => {
      if (list.length > 0 && !form.getFieldValue('warehouse')) {
        form.setFieldsValue({ warehouse: list[0].name })
      }
    })

    message.success('导入成功，请填写入库订单信息')
  }, [previewItems, productList, user, form])

  const columns: ColumnsType<InboundOrder> = [
    {
      title: '入库单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 160,
      render: (text: string, record: InboundOrder) => (
        <span
          style={{ color: '#1890ff', cursor: 'pointer' }}
          onClick={() => handleView(record)}
        >
          {text}
        </span>
      ),
    },
    {
      title: '入库类型',
      dataIndex: 'inbound_type',
      key: 'inbound_type',
      width: 110,
      render: (type: string) => (
        <Tag>{inboundTypeLabels[type] || type}</Tag>
      ),
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
      title: '入库日期',
      dataIndex: 'inbound_date',
      key: 'inbound_date',
      width: 170,
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : '-',
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
      render: (_: any, record: InboundOrder) => {
        const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
          switch (key) {
            case 'view':
              handleView(record);
              break;
            case 'edit':
              if (record.status === 'draft') {
                handleEdit(record);
              }
              break;
            case 'delete':
              if (record.status === 'draft' || isAdmin) {
                Modal.confirm({
                  title: isAdmin && record.status === 'confirmed' 
                    ? '管理员强制删除已确认订单' 
                    : '确定删除该入库订单?',
                  content: isAdmin && record.status === 'confirmed'
                    ? '此操作将同时回滚库存变更，且不可恢复，请谨慎操作！'
                    : '删除后不可恢复，请谨慎操作',
                  okText: '确定',
                  cancelText: '取消',
                  onOk: () => handleDelete(record.id),
                });
              }
              break;
          }
        };

        const menuItems: MenuProps['items'] = [];

        if (hasPermission('inbound:view')) {
          menuItems.push({
            key: 'view',
            label: (
              <span>
                <InfoCircleOutlined style={{ marginRight: 8 }} />
                详情
              </span>
            ),
          });
        }

        if (hasPermission('inbound:edit') && record.status === 'draft') {
          menuItems.push({
            key: 'edit',
            label: (
              <span>
                <EditOutlined style={{ marginRight: 8 }} />
                编辑
              </span>
            ),
          });
        }

        if (hasPermission('inbound:delete') && (record.status === 'draft' || isAdmin)) {
          menuItems.push({
            key: 'delete',
            label: (
              <span style={{ color: '#ff4d4f' }}>
                <DeleteOutlined style={{ marginRight: 8 }} />
                {isAdmin && record.status === 'confirmed' ? '强制删除' : '删除'}
              </span>
            ),
            style: { color: '#ff4d4f' },
          });
        }

        const menu = <Menu onClick={handleMenuClick} items={menuItems} />;

        return (
          <Space>
            {hasPermission('inbound:confirm') && (
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
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
        );
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
              placeholder="搜索入库单号、仓库、经办人..."
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 300 }}
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <Select
              placeholder="入库类型"
              allowClear
              style={{ width: 140 }}
              value={typeFilter}
              onChange={handleTypeFilter}
              options={inboundTypeOptions}
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
            {hasPermission('inbound:create') && (
              <>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  下载模板
                </Button>
                <Button icon={<UploadOutlined />} onClick={handleUploadClick} loading={uploading}>
                  导入Excel
                </Button>
              </>
            )}
            {(hasPermission('inbound:confirm') || hasPermission('inbound:delete')) && selectedRowKeys.length > 0 && (
              <Dropdown menu={{ items: batchActionsMenu }} trigger={['click']}>
                <Button type="primary">
                  批量操作 ({selectedRowKeys.length}) <DownOutlined />
                </Button>
              </Dropdown>
            )}
            {hasPermission('inbound:create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增入库订单
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
        title={viewingOrder ? '查看入库订单' : (editingOrder ? '编辑入库订单' : '新增入库订单')}
        open={modalOpen}
        onOk={viewingOrder ? () => setModalOpen(false) : handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          setViewingOrder(null);
          setEditingOrder(null);
        }}
        confirmLoading={submitting}
        okText={viewingOrder ? '确定' : undefined}
        width={viewingOrder || editingOrder ? 640 : 800}
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
              label="入库单号"
              rules={viewingOrder ? [] : [{ required: true, message: '请输入入库单号' }]}
            >
              <Input placeholder="请输入入库单号" disabled={true} />
            </Form.Item>
            <Form.Item
              name="inbound_type"
              label="入库类型"
              rules={viewingOrder ? [] : [{ required: true, message: '请选择入库类型' }]}
            >
              <Select 
                placeholder="请选择入库类型" 
                options={createInboundTypeOptions} 
                disabled={!!viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="warehouse" label="仓库" rules={[{ required: true, message: '请选择仓库' }]}>
              <Select
                placeholder="请选择仓库"
                disabled={!!viewingOrder || (editingOrder?.status === 'confirmed')}
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
          {(editingOrder || viewingOrder) && (
            <Form.Item name="inbound_date" label="入库日期">
              <DatePicker style={{ width: '100%' }} showTime placeholder="请选择入库日期时间" disabled={true} />
            </Form.Item>
          )}
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" disabled={!!viewingOrder || (editingOrder?.status === 'confirmed')} />
          </Form.Item>

          <Divider orientation="left" plain>入库商品</Divider>
          {(() => {
            const finishedItems = formItems.filter(item => !item.parentKey)
            const accessoryMap = new Map<string, ProductFormItem[]>()
            formItems.forEach(item => {
              if (item.parentKey) {
                if (!accessoryMap.has(item.parentKey)) {
                  accessoryMap.set(item.parentKey, [])
                }
                accessoryMap.get(item.parentKey)!.push(item)
              }
            })

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

            const isDisabled = !!viewingOrder || (editingOrder?.status === 'confirmed')

            const renderItem = (item: ProductFormItem, isAccessory: boolean = false) => {
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

                    {/* Row 1: 商品 + 数量 + 单价 + 合计 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
                      <div style={{ minWidth: 0 }}> {/* 添加 minWidth: 0 防止内容溢出 */}
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>
                          {!isAccessory && <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>}商品
                        </div>
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
                            options={productOptions}
                            style={{ width: '100%' }}
                            disabled={isDisabled}
                            status={item.product_id == null && !viewingOrder && !isAccessory ? 'error' : undefined}
                            notFoundContent={
                              productsLoading ? <span>加载中...</span> :
                              productSearchKeyword ? <span>未找到匹配的商品</span> :
                              <span>暂无商品</span>
                            }
                          />
                          {/* 悬停删除图标 */}
                          {item.product_id && !isDisabled && (
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
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>
                          {!isAccessory && <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>}数量
                        </div>
                        <InputNumber
                          min={1}
                          value={item.quantity}
                          onChange={(val) => handleFormItemChange(item.key, 'quantity', val || 1)}
                          style={{ width: '100%' }}
                          placeholder="数量"
                          disabled={isDisabled}
                          status={item.quantity <= 0 && !viewingOrder && !isAccessory ? 'error' : undefined}
                        />
                      </div>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>单价</div>
                        <InputNumber
                          min={0}
                          precision={2}
                          prefix="¥"
                          value={item.unit_price}
                          onChange={(val) => handleFormItemChange(item.key, 'unit_price', val || 0)}
                          style={{ width: '100%' }}
                          placeholder="单价"
                          disabled={isDisabled}
                        />
                      </div>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>合计</div>
                        <InputNumber
                          value={item.quantity * item.unit_price}
                          precision={2}
                          prefix="¥"
                          style={{ width: '100%' }}
                          disabled
                        />
                      </div>
                    </div>

                    {/* Row 2: 关联采购单 */}
                    {item.product_id && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>
                          关联采购单
                          {(item.purchase_order_item_ids?.length || 0) > 0 && (
                            <span style={{ color: '#52c41a', marginLeft: 8, fontWeight: 'normal' }}>
                              (已选{(item.purchase_order_item_ids?.length || 0)}个采购单)
                            </span>
                          )}
                        </div>
                        <Select
                          mode="multiple"
                          value={item.purchase_order_item_ids || []}
                          onChange={(val) => handlePurchaseOrderChange(item.key, val)}
                          placeholder="无待收货采购单或手动选择"
                          allowClear
                          style={{ width: '100%' }}
                          disabled={isDisabled}
                          options={[
                            // 待收货采购单选项
                            ...(pendingPurchaseMap[item.product_id!] || []).map((pp: PendingPurchaseItem) => ({
                              label: pp.is_accessory_match && pp.finished_name
                                ? `${pp.order_number} | ${pp.approved_at ? pp.approved_at.split(' ')[0] : ''} | 成品: ${pp.finished_code || ''} ${pp.finished_name} | 采购${pp.ordered_qty}件 已收${pp.received_quantity}件 剩余${pp.remaining_qty}件`
                                : `${pp.order_number} | ${pp.approved_at ? pp.approved_at.split(' ')[0] : ''} | 采购${pp.ordered_qty}件 已收${pp.received_quantity}件 剩余${pp.remaining_qty}件`,
                              value: pp.poi_id,
                            })),
                            // 已关联但不在待收货列表中的采购单（查看/编辑时）
                            ...(item.purchase_order_item_ids || [])
                              .filter(id => !(pendingPurchaseMap[item.product_id!] || []).some((pp: PendingPurchaseItem) => pp.poi_id === id))
                              .map(id => ({
                                label: `${linkedPOMap[id] || `采购单#${id}`} | 已关联`,
                                value: id,
                              })),
                          ]}
                          notFoundContent={<span style={{ color: '#999', fontSize: 12 }}>该产品暂无待收货的采购单</span>}
                        />
                      </div>
                    )}

                    {/* Row 3: 货架号 + 备注 */}
                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>货架号</div>
                        <Input
                          value={item.shelf_number}
                          onChange={(e) => handleFormItemChange(item.key, 'shelf_number', e.target.value)}
                          placeholder="请输入货架号"
                          disabled={isDisabled}
                        />
                      </div>
                      <div>
                        <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 500 }}>备注</div>
                        <Input
                          value={item.notes}
                          onChange={(e) => handleFormItemChange(item.key, 'notes', e.target.value)}
                          placeholder="请输入备注"
                          disabled={isDisabled}
                          style={{ background: isAccessory ? '#fff' : '#fafafa' }}
                        />
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
          rowKey={(_record, index) => (index ?? 0).toString()}
          columns={[
            {
              title: '商品编码',
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
              title: '货架号',
              dataIndex: 'shelf_number',
              key: 'shelf_number',
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

export default InboundManagement