import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Popconfirm, Space, Tag, Divider, Dropdown, Menu, Pagination } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, CheckOutlined, SearchOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, MoreOutlined, DownOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { inboundOrdersApi, productsApi, warehousesApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type { MenuProps } from 'antd'
const { RangePicker } = DatePicker

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
}

interface Product {
  id: number
  name: string
  product_code: string
  purchase_price: number | null
}

interface ProductFormItem {
  key: string
  product_id: number | null
  quantity: number
  unit_price: number
  shelf_number?: string
  notes?: string
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
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

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
    const orderNumber = `IN${dayjs().format('YYYYMMDDHHmmss')}`
    const handler = user?.nickname || user?.username || ''
    form.setFieldsValue({
      order_number: orderNumber,
      handler: handler,
    })
    setFormItems([createEmptyFormItem()])
    fetchProducts()
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleView = (order: InboundOrder) => {
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
    // 加载入库明细
    if (order.items && order.items.length > 0) {
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        shelf_number: item.shelf_number || '',
        notes: item.notes || '',
      }))
      setFormItems(items)
    } else {
      setFormItems([createEmptyFormItem()])
    }
    fetchProducts()
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleEdit = (order: InboundOrder) => {
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
    // 加载入库明细
    if (order.items && order.items.length > 0) {
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        shelf_number: item.shelf_number || '',
        notes: item.notes || '',
      }))
      setFormItems(items)
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

      const validItems = formItems.filter((item) => item.product_id != null && item.quantity > 0)
      const items = validItems.map((item) => ({
        product_id: item.product_id!,
        quantity: item.quantity,
        unit_price: item.unit_price,
        shelf_number: item.shelf_number,
        notes: item.notes,
      }))

      if (editingOrder) {
        if (validItems.length === 0) {
          message.warning('请至少添加一个完整的入库商品')
          setSubmitting(false)
          return
        }
        const payload: Record<string, any> = {
          order_number: values.order_number,
          inbound_type: values.inbound_type,
          warehouse: values.warehouse,
          handler: values.handler,
          notes: values.notes,
          items,
        }
        if (values.inbound_date) {
          payload.inbound_date = values.inbound_date.format('YYYY-MM-DD HH:mm:ss')
        }
        await inboundOrdersApi.update(editingOrder.id, payload)
        message.success('入库订单更新成功')
      } else {
        if (validItems.length === 0) {
          message.warning('请至少添加一个完整的入库商品')
          setSubmitting(false)
          return
        }
        const payload: Record<string, any> = {
          order_number: values.order_number,
          inbound_type: values.inbound_type,
          warehouse: values.warehouse,
          handler: values.handler,
          notes: values.notes,
          items,
        }
        await inboundOrdersApi.create(payload as any)
        message.success('入库订单创建成功')
      }

      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      // 显示更详细的错误信息
      const errorMsg = e.response?.data?.detail || e.message || '操作失败'
      message.error(errorMsg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirm = async (id: number) => {
    try {
      await inboundOrdersApi.confirm(id)
      message.success('入库订单已审批，库存已自动更新')
      fetchData()
      fetchProducts() // 同时刷新产品列表，确保库存数量更新
    } catch {
      message.error('审批失败')
    }
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
      return prev.filter((item) => item.key !== key)
    })
  }

  const handleFormItemChange = (key: string, field: keyof ProductFormItem, value: any) => {
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        const updated = { ...item, [field]: value }
        if (field === 'product_id') {
          const product = productList.find((p) => p.id === value)
          updated.unit_price = product?.purchase_price || 0
        }
        return updated
      }),
    )
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
    if (!productList.length) {
      message.warning('请等待产品列表加载完成')
      return
    }
    const newItems = previewItems.map((item) => {
      const product = productList.find(
        (p) =>
          p.product_code === item.product_code ||
          p.name === item.product_name
      )
      return {
        key: generateItemKey(),
        product_id: product?.id || null,
        quantity: item.quantity || 1,
        unit_price: item.unit_price || (product?.purchase_price || 0),
        shelf_number: item.shelf_number || '',
        notes: item.notes || '',
      }
    }).filter((item) => item.product_id != null)

    if (newItems.length === 0) {
      message.error('未找到匹配的产品，请检查产品编码')
      setPreviewModalOpen(false)
      return
    }

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
          {(editingOrder || viewingOrder) && (
            <Form.Item name="inbound_date" label="入库日期">
              <DatePicker style={{ width: '100%' }} showTime placeholder="请选择入库日期时间" disabled={true} />
            </Form.Item>
          )}
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" disabled={viewingOrder || (editingOrder?.status === 'confirmed')} />
          </Form.Item>

          <Divider orientation="left" plain>入库商品</Divider>
          {formItems.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                marginBottom: 16,
                padding: 12,
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                background: '#fafafa',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 2 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>
                    <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>商品
                  </div>
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
                    status={item.product_id == null && !viewingOrder ? 'error' : undefined}
                  />
                  </div>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>
                    <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>数量
                  </div>
                  <InputNumber
                    min={1}
                    value={item.quantity}
                    onChange={(val) => handleFormItemChange(item.key, 'quantity', val || 1)}
                    style={{ width: '100%' }}
                    placeholder="数量"
                    disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                    status={item.quantity <= 0 && !viewingOrder ? 'error' : undefined}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>单价</div>
                  <InputNumber
                    min={0}
                    precision={2}
                    value={item.unit_price}
                    style={{ width: '100%' }}
                    placeholder="单价"
                    disabled
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>合计</div>
                  <InputNumber
                    min={0}
                    precision={2}
                    value={item.quantity * item.unit_price}
                    style={{ width: '100%' }}
                    disabled
                  />
                </div>
                {!viewingOrder && (!editingOrder || editingOrder.status !== 'confirmed') && (
                  <div style={{ flex: 'none', paddingTop: 22 }}>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveFormItem(item.key)}
                      disabled={formItems.length <= 1}
                    >
                      删除
                    </Button>
                  </div>
                )}
              </div>
              <div style={{ width: '100%' }}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>货架号</div>
                <Input
                  value={item.shelf_number}
                  onChange={(e) => handleFormItemChange(item.key, 'shelf_number', e.target.value)}
                  placeholder="请输入货架号"
                  disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
                />
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
            </div>
          ))}
          
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
          rowKey={(record, index) => index.toString()}
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