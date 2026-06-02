import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Popconfirm, Space, Tag, Divider, Dropdown, Menu, Pagination } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, CheckOutlined, DownloadOutlined, UploadOutlined, InfoCircleOutlined, MoreOutlined, DownOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { purchaseOrdersApi, productsApi, warehousesApi } from '../api'
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
  supplier: string
  contact_person: string
  contact_phone: string
  expected_date: string
  total_amount: number
  status: string
  notes: string
  created_at: string
  approved_at: string
  approved_by: number | null
  creator_name: string
  approver_name: string
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
  completed: '已完成',
  cancelled: '已取消',
}

const statusColorMap: Record<string, string> = {
  draft: 'default',
  pending: 'processing',
  approved: 'blue',
  ordered: 'cyan',
  partial_received: 'orange',
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
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
]

let itemKeyCounter = 0
const generateItemKey = () => `item_${Date.now()}_${++itemKeyCounter}`

const createEmptyFormItem = (): FormItemState => ({
  key: generateItemKey(),
  product_id: null,
  quantity: 1,
  unit_price: 0,
})

const PurchaseManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [productList, setProductList] = useState<Product[]>([])
  const [warehouseList, setWarehouseList] = useState<WarehouseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<FormItemState[]>([createEmptyFormItem()])
  const [submitting, setSubmitting] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  useEffect(() => {
    fetchData()
    fetchProducts()
    fetchWarehouses()
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
      console.log('Warehouses loaded:', res.data.data) // 调试信息
      setWarehouseList(res.data.data || []) // 不过滤状态，显示所有仓库
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
      const next: Record<string, any> = { ...prev, status: value }
      if (!value) {
        delete next.status
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
    })
    setFormItems([createEmptyFormItem()])
    fetchProducts()
    fetchWarehouses()
    setModalOpen(true)
  }

  const handleView = (order: PurchaseOrder) => {
    setViewingOrder(order)
    setEditingOrder(null)
    form.setFieldsValue({
      order_number: order.order_number,
      warehouse: (order as any).warehouse,
      notes: order.notes,
    })
    // 加载采购明细
    if (order.items && order.items.length > 0) {
      const items = order.items.map((item: any) => ({
        key: generateItemKey(),
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
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

  const handleEdit = (order: PurchaseOrder) => {
    setViewingOrder(null)
    setEditingOrder(order)
    form.setFieldsValue({
      order_number: order.order_number,
      warehouse: (order as any).warehouse,
      notes: order.notes,
    })
    setFormItems([createEmptyFormItem()])
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
          warehouse: values.warehouse,
          notes: values.notes,
        }
        await purchaseOrdersApi.update(editingOrder.id, payload)
        message.success('采购订单更新成功')
      } else {
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
        }))
        const payload: Record<string, any> = {
          order_number: values.order_number,
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
      message.error('操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprove = async (id: number) => {
    try {
      await purchaseOrdersApi.update(id, { status: 'approved' })
      message.success('审批成功')
      fetchData()
    } catch {
      message.error('审批失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await purchaseOrdersApi.delete(id)
      message.success('采购订单删除成功')
      fetchData()
    } catch {
      message.error('删除失败')
    }
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

  const handleFormItemChange = (key: string, field: keyof FormItemState, value: any) => {
    setFormItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        const updated = { ...item, [field]: value }
        if (field === 'product_id') {
          const product = productList.find((p) => p.id === value)
          if (product && product.purchase_price != null) {
            updated.unit_price = product.purchase_price
          }
        }
        return updated
      }),
    )
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
        setPreviewItems(res.data.data || [])
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
    // 打开新增弹窗
    handleCreate()
    // 延迟设置数据，确保弹窗已打开
    setTimeout(() => {
      const newItems = previewItems.map((item) => ({
        ...createEmptyFormItem(),
        product_id: item.product_id,
        quantity: item.quantity || 1,
        unit_price: item.unit_price || 0,
      }))
      setFormItems(newItems)
      
      // 从预览数据中提取仓库（取第一个有值的仓库）
      const warehouseFromImport = previewItems.find(item => item.warehouse)?.warehouse || ''
      if (warehouseFromImport) {
        form.setFieldsValue({ warehouse: warehouseFromImport })
      }
      
      message.success('导入成功')
    }, 100)
  }

  const columns: ColumnsType<PurchaseOrder> = [
    {
      title: '采购单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 160,
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
      title: '总金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 120,
      render: (amount: number) => amount != null ? `¥${amount.toFixed(2)}` : '-',
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
    },
    {
      title: '审批者',
      dataIndex: 'approver_name',
      key: 'approver_name',
      width: 100,
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
              if (record.status === 'draft') {
                handleDelete(record.id)
              }
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

        if (hasPermission('purchase:delete') && record.status === 'draft') {
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
            {(hasPermission('purchase:confirm') || hasPermission('purchase:delete')) && selectedRowKeys.length > 0 && (
              <Dropdown menu={{ items: batchActionsMenu }} trigger={['click']}>
                <Button type="primary">
                  批量操作 ({selectedRowKeys.length}) <DownOutlined />
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
          <Form.Item
            name="order_number"
            label="采购单号"
          >
            <Input placeholder="请输入采购单号" disabled />
          </Form.Item>
          <Form.Item
            name="warehouse"
            label="收货仓库"
            rules={[{ required: true, message: '请选择仓库' }]}
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
          <Form.Item name="notes" label="备注">
            <TextArea rows={3} placeholder="请输入备注" disabled={!!viewingOrder} />
          </Form.Item>
        </Form>

        <Divider orientation="left">采购商品明细</Divider>

        {/* 表头标签 */}
        <div 
          style={{ 
            display: 'grid', 
            gridTemplateColumns: viewingOrder ? '2fr 1fr 1fr' : '2fr 1fr 1fr auto', 
            gap: 8, 
            marginBottom: 8, 
            padding: '0 12px',
            color: '#666',
            fontSize: 12,
            fontWeight: 500
          }}
        >
          <div>产品</div>
          <div>数量</div>
          <div>单价</div>
          {!viewingOrder && <div>操作</div>}
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {formItems.map((item, _index) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: '10px 12px',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                backgroundColor: '#fafafa',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: viewingOrder ? '2fr 1fr 1fr' : '2fr 1fr 1fr auto', gap: 8, flex: 1, alignItems: 'center' }}>
                <Select
                  placeholder="请选择产品"
                  showSearch
                  loading={productsLoading}
                  value={item.product_id}
                  onChange={(value) => handleFormItemChange(item.key, 'product_id', value)}
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                  options={productOptions}
                  style={{ width: '100%' }}
                  disabled={!!viewingOrder}
                />
                <InputNumber
                  placeholder="数量"
                  min={1}
                  value={item.quantity}
                  onChange={(value) => handleFormItemChange(item.key, 'quantity', value || 0)}
                  style={{ width: '100%' }}
                  disabled={!!viewingOrder}
                />
                <InputNumber
                  placeholder="单价"
                  min={0}
                  precision={2}
                  prefix="¥"
                  value={item.unit_price}
                  onChange={(value) => handleFormItemChange(item.key, 'unit_price', value || 0)}
                  style={{ width: '100%' }}
                  disabled={!!viewingOrder}
                />
                {!viewingOrder && (
                  <Button
                    icon={<DeleteOutlined />}
                    danger
                    onClick={() => handleRemoveFormItem(item.key)}
                    disabled={formItems.length <= 1}
                  />
                )}
              </div>
            </div>
          ))}
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
        width={800}
      >
        <Table
          dataSource={previewItems}
          rowKey={(record, index) => String(index)}
          pagination={false}
          size="small"
          columns={[
            { title: '商品编码', dataIndex: 'product_code', key: 'product_code' },
            { title: '商品名称', dataIndex: 'product_name', key: 'product_name' },
            { title: '收货仓库', dataIndex: 'warehouse', key: 'warehouse', render: (v: string) => v || '-' },
            { title: '数量', dataIndex: 'quantity', key: 'quantity' },
            { title: '单价', dataIndex: 'unit_price', key: 'unit_price', render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-' },
            { title: '小计', key: 'total', render: (_: any, record: any) => `¥${((record.quantity || 0) * (record.unit_price || 0)).toFixed(2)}` },
          ]}
        />
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