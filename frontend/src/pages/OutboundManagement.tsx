import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Popconfirm, Space, Tag, Divider, Alert, Dropdown, Menu, Pagination, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, SearchOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, MoreOutlined, DownOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { outboundOrdersApi, productsApi, inventoryBatchesApi, warehousesApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type { MenuProps } from 'antd'
const { RangePicker } = DatePicker

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
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OutboundOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<OutboundOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<OutboundFormItem[]>([createEmptyFormItem()])
  const [submitting, setSubmitting] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)

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

  // 使用 Form watch 监听出库类型变化
  const watchOutboundType = Form.useWatch('outbound_type', form)

  useEffect(() => {
    fetchData()
    fetchProducts()
    fetchWarehouses()
  }, [pagination.current, pagination.pageSize, filters])

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

  const fetchProducts = async () => {
    setProductsLoading(true)
    try {
      const res = await productsApi.getList({ page: 1, page_size: 100 })
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
    fetchProducts()
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
    fetchProducts()
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
    })
    setProductBatchesMap({})
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
    fetchProducts()
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

    setEditingOrder(null)
    setViewingOrder(null)
    const orderNumber = `OUT${dayjs().format('YYYYMMDDHHmmss')}`
    const handler = user?.nickname || user?.username || ''
    form.setFieldsValue({
      order_number: orderNumber,
      handler: handler,
      outbound_date: dayjs(),
    })
    setFormItems(newItems)
    setPreviewModalOpen(false)
    setModalOpen(true)
    message.success('导入成功，请填写出库订单信息')
  }, [previewItems, productList, user, form, fetchProductBatches])

  const handleAddFormItem = () => {
    setFormItems((prev) => [...prev, createEmptyFormItem()])
  }

  const handleRemoveFormItem = (key: string) => {
    setFormItems((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((item) => item.key !== key)
    })
  }

  const handleFormItemChange = (key: string, field: keyof OutboundFormItem, value: any) => {
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        const updated = { ...item, [field]: value }
        if (field === 'product_id') {
          const product = productList.find((p) => p.id === value)
          if (product && product.purchase_price != null) {
            updated.unit_price = product.purchase_price
          }
          if (value != null) {
            fetchProductBatches(value)
          }
        }
        return updated
      }),
    )
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
    const insufficient = totalStock < item.quantity

    return (
      <div style={{ marginTop: 8 }}>
        <Alert
          type={batchesLoading ? 'info' : insufficient ? 'warning' : 'success'}
          showIcon
          message={
            <Space>
              <span>当前库存: <strong>{batchesLoading ? '加载中...' : totalStock}</strong></span>
              {item.quantity > 0 && !batchesLoading && insufficient && (
                <Tag color="error">库存不足，缺 {item.quantity - totalStock}</Tag>
              )}
              {item.quantity > 0 && !batchesLoading && !insufficient && (
                <Tag color="success">库存充足</Tag>
              )}
            </Space>
          }
          description={
            safeBatches.length > 0 ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>批次库存明细：</div>
                <Space wrap size={[8, 4]}>
                  {safeBatches.map((batch, index) => (
                    <Tag key={`${batch.batch_number}-${index}`} color="blue" style={{ fontSize: 11 }}>
                      {batch.batch_number}: {batch.current_quantity || batch.quantity}
                    </Tag>
                  ))}
                </Space>
              </div>
            ) : null
          }
          style={{ padding: '8px 12px' }}
        />
        {!viewingOrder && item.quantity > 0 && !batchesLoading && !insufficient && (
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
          <Form.Item name="outbound_date" label="出库日期">
            <DatePicker style={{ width: '100%' }} showTime placeholder="请选择出库日期时间" disabled={true} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" disabled={viewingOrder || (editingOrder?.status === 'confirmed')} />
          </Form.Item>

          <Divider orientation="left" plain>出库商品</Divider>
          {formItems.map((item, index) => {
            const product = productList.find((p) => p.id === item.product_id)
            return (
              <div
                key={item.key}
                style={{
                  marginBottom: 16,
                  padding: 12,
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  background: '#fafafa',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: 3 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>商品</div>
                    <Select
                      placeholder="请选择商品"
                      showSearch
                      loading={productsLoading}
                      value={item.product_id}
                      onChange={(val) => handleFormItemChange(item.key, 'product_id', val)}
                      filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                      }
                      options={productList.map((p) => ({
                        label: `${p.product_code ? `[${p.product_code}] ` : ''}${p.name}`,
                        value: p.id,
                      }))}
                      style={{ width: '100%' }}
                      disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>数量</div>
                    <InputNumber
                      min={1}
                      value={item.quantity}
                      onChange={(val) => handleFormItemChange(item.key, 'quantity', val || 1)}
                      style={{ width: '100%' }}
                      placeholder="数量"
                      disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>单价</div>
                    <InputNumber
                      min={0}
                      precision={2}
                      value={item.unit_price}
                      onChange={(val) => handleFormItemChange(item.key, 'unit_price', val || 0)}
                      style={{ width: '100%' }}
                      placeholder="单价"
                      prefix="¥"
                      disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                    />
                  </div>
                  <div style={{ flex: 'none', paddingTop: 22 }}>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveFormItem(item.key)}
                      disabled={formItems.length <= 1 || viewingOrder || (editingOrder?.status === 'confirmed')}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <div style={{ width: '100%' }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>备注</div>
                  <Input
                    value={item.notes}
                    onChange={(e) => handleFormItemChange(item.key, 'notes', e.target.value)}
                    placeholder="请输入备注"
                    disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                  />
                </div>
                {/* 报废类型时显示批次选择 */}
        {!viewingOrder && (!editingOrder || editingOrder.status !== 'confirmed') && watchOutboundType === 'scrap' && item.product_id && (
          <div style={{ width: '100%', marginTop: 8 }}>
            <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>
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
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>出库扣减批次：</div>
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
            )
          })}
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