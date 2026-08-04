import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Table, Button, Modal, Form, Input, Select, InputNumber, Space, Card,
  Tag, message, Pagination, Divider, Dropdown, Menu, Popconfirm, DatePicker, Alert
} from 'antd'
import type { ColumnsType, MenuProps } from 'antd/es/table'
import {
  PlusOutlined, CheckOutlined, DownOutlined, ArrowLeftRight,
  InfoCircleOutlined, EditOutlined, SearchOutlined, DeleteOutlined,
  CloseOutlined, ReloadOutlined
} from '@ant-design/icons'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { stockTransfersApi, warehousesApi, storeGroupsApi } from '../api'
import { useNavigate } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'

interface StockTransferOrder {
  id: number
  order_number: string
  source_store_group_id: number
  target_store_group_id: number
  source_store_group_name: string
  target_store_group_name: string
  source_warehouse: string
  target_warehouse: string
  total_quantity: number
  total_amount: number
  status: string
  notes: string
  created_by: number | null
  creator_name: string
  confirmed_by: number | null
  confirmer_name: string
  confirmed_at: string | null
  created_at: string
}

interface TransferItem {
  id?: number
  product_id: number
  product_name: string
  product_code: string
  batch_id: number | null
  batch_number: string
  shelf_number: string
  target_shelf_number: string
  quantity: number
  unit_price: number
  total_price: number
  notes: string
}

interface StockTransferDetail extends StockTransferOrder {
  source_store_group_id: number
  target_store_group_id: number
  source_store_group_name: string
  target_store_group_name: string
  items: TransferItem[]
}

interface WarehouseProduct {
  product_id: number
  product_name: string
  product_code: string
  batch_number: string
  shelf_number: string
  current_quantity: number
  unit_price: number
  batch_id: number
  warehouse: string
}

interface WarehouseItem {
  id: number
  name: string
  code: string
  status: string
}

interface TransferFormItem {
  key: string
  product_id: number | null
  batch_id: number | null
  batch_number: string
  shelf_number: string
  target_shelf_number: string
  quantity: number
  unit_price: number
  current_quantity: number
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

const statusOptions = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '已审批', value: 'confirmed' },
  { label: '已取消', value: 'cancelled' },
]

let itemKeyCounter = 0
const generateItemKey = () => `item_${Date.now()}_${++itemKeyCounter}`

const createEmptyFormItem = (): TransferFormItem => ({
  key: generateItemKey(),
  product_id: null,
  batch_id: null,
  batch_number: '',
  shelf_number: '',
  target_shelf_number: '',
  quantity: 0,
  unit_price: 0,
  current_quantity: 0,
})

const StockTransferManagement: React.FC = () => {
  const { currentTheme: _ } = useTheme()
  const { user, hasPermission } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()

  const [orders, setOrders] = useState<StockTransferOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<StockTransferOrder | null>(null)
  const [viewingOrder, setViewingOrder] = useState<StockTransferOrder | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [sourceWhFilter, setSourceWhFilter] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})
  const searchTimeoutRef = useRef<number | null>(null)
  const [formItems, setFormItems] = useState<TransferFormItem[]>([createEmptyFormItem()])
  const [submitting, setSubmitting] = useState(false)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  const [sourceWarehouse, setSourceWarehouse] = useState<string>('')
  const [warehouseProducts, setWarehouseProducts] = useState<WarehouseProduct[]>([])
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [warehouseList, setWarehouseList] = useState<WarehouseItem[]>([])
  const [whProductsLoading, setWhProductsLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [storeGroups, setStoreGroups] = useState<any[]>([])

  useEffect(() => {
    fetchWarehouses()
    fetchStoreGroups()
  }, [])

  useEffect(() => {
    fetchOrders()
  }, [pagination.current, pagination.pageSize, filters])

  useEffect(() => {
    setFilters({
      status: statusFilter || undefined,
      source_warehouse: sourceWhFilter || undefined,
      search: searchText || undefined,
    })
  }, [statusFilter, sourceWhFilter, searchText, dateRange])

  const fetchWarehouses = async () => {
    try {
      const res = await warehousesApi.getList({ page_size: 100 })
      console.log('Warehouses loaded:', res.data.data)
      const allWarehouses = res.data.data || []
      setWarehouseList(allWarehouses)
      // 同时也更新 warehouses 为仓库名称数组，用于筛选
      setWarehouses(allWarehouses.map((w: WarehouseItem) => w.name))
    } catch (err) {
      console.error('获取仓库列表失败', err)
    }
  }

  const fetchStoreGroups = async () => {
    try {
      const res = await storeGroupsApi.getList()
      if (res.data.success) {
        setStoreGroups(res.data.data || [])
      }
    } catch (err) {
      console.error('获取店铺分组失败', err)
    }
  }

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = {
        page: pagination.current,
        page_size: pagination.pageSize,
      }
      if (filters.status) params.status = filters.status
      if (filters.source_warehouse) params.source_warehouse = filters.source_warehouse
      if (filters.search) params.search = filters.search
      if (filters.start_date) params.start_date = filters.start_date
      if (filters.end_date) params.end_date = filters.end_date

      const res = await stockTransfersApi.getList(params)
      setOrders(res.data.items || [])
      setPagination(prev => ({ ...prev, total: res.data.total || 0 }))
    } catch (err) {
      console.error('获取挪货申请列表失败', err)
      message.error('获取挪货申请列表失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchWarehouseProducts = async (warehouse: string) => {
    if (!warehouse) {
      setWarehouseProducts([])
      return
    }
    setWhProductsLoading(true)
    try {
      const res = await stockTransfersApi.getProductsByWarehouse(warehouse)
      setWarehouseProducts(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      console.error('获取仓库产品失败', err)
      setWarehouseProducts([])
    } finally {
      setWhProductsLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingOrder(null)
    setViewingOrder(null)
    setSourceWarehouse('')
    setWarehouseProducts([])
    const emptyItem = createEmptyFormItem()
    setFormItems([emptyItem])
    form.resetFields()
    form.setFieldsValue({ order_number: `NH${dayjs().format('YYYYMMDDHHmmss')}` })
    setModalOpen(true)
  }

  const handleEdit = async (record: StockTransferOrder) => {
    try {
      const res = await stockTransfersApi.getDetail(record.id)
      const detail: StockTransferDetail = res.data

      setEditingOrder(record)
      setViewingOrder(null)
      setSourceWarehouse(detail.source_warehouse)
      await fetchWarehouseProducts(detail.source_warehouse)

      form.setFieldsValue({
        order_number: detail.order_number,
        source_store_group_id: detail.source_store_group_id,
        target_store_group_id: detail.target_store_group_id,
        source_warehouse: detail.source_warehouse,
        target_warehouse: detail.target_warehouse,
        notes: detail.notes,
      })

      const items = detail.items.map(it => ({
        key: generateItemKey(),
        product_id: it.product_id,
        batch_id: it.batch_id,
        batch_number: it.batch_number,
        shelf_number: it.shelf_number,
        target_shelf_number: it.target_shelf_number,
        quantity: it.quantity,
        unit_price: it.unit_price,
        current_quantity: it.quantity,
      }))
      setFormItems(items.length > 0 ? items : [createEmptyFormItem()])

      setModalOpen(true)
    } catch (err) {
      console.error('获取挪货申请详情失败', err)
      message.error('获取挪货申请详情失败')
    }
  }

  const handleView = async (record: StockTransferOrder) => {
    try {
      const res = await stockTransfersApi.getDetail(record.id)
      const detail: StockTransferDetail = res.data

      setViewingOrder(record)
      setEditingOrder(null)
      setSourceWarehouse(detail.source_warehouse)
      fetchWarehouseProducts(detail.source_warehouse)

      form.setFieldsValue({
        order_number: detail.order_number,
        source_store_group_id: detail.source_store_group_id,
        target_store_group_id: detail.target_store_group_id,
        source_warehouse: detail.source_warehouse,
        target_warehouse: detail.target_warehouse,
        notes: detail.notes,
      })

      const items = detail.items.map(it => ({
        key: generateItemKey(),
        product_id: it.product_id,
        batch_id: it.batch_id,
        batch_number: it.batch_number,
        shelf_number: it.shelf_number,
        target_shelf_number: it.target_shelf_number,
        quantity: it.quantity,
        unit_price: it.unit_price,
        current_quantity: it.quantity,
      }))
      setFormItems(items)

      setModalOpen(true)
    } catch (err) {
      console.error('获取挪货申请详情失败', err)
      message.error('获取挪货申请详情失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await stockTransfersApi.delete(id)
      message.success('删除成功')
      fetchOrders()
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败')
    }
  }

  const handleConfirm = async (id: number) => {
    Modal.confirm({
      title: '确认审批',
      content: '确定要审批此挪货订单吗？此操作将自动转移库存。',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        setConfirmingId(id)
        try {
          await stockTransfersApi.confirm(id)
          message.success('审批成功')
          fetchOrders()
        } catch (err: any) {
          message.error(err?.response?.data?.detail || '审批失败')
        } finally {
          setConfirmingId(null)
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
      content: `确定要删除选中的 ${selectedRowKeys.length} 条挪货订单吗？此操作不可恢复。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(key => 
            stockTransfersApi.delete(Number(key))
          ))
          message.success('批量删除成功')
          setSelectedRowKeys([])
          fetchOrders()
        } catch (err: any) {
          const errorMsg = err?.response?.data?.detail || '批量删除失败，请稍后重试'
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
      content: `确定要审批选中的 ${draftCount} 条挪货订单吗？此操作将自动转移库存。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const draftOrders = orders
            .filter(order => 
              selectedRowKeys.includes(order.id) && order.status === 'draft'
            )
          
          for (const order of draftOrders) {
            await stockTransfersApi.confirm(order.id)
          }
          
          message.success('批量审批成功')
          setSelectedRowKeys([])
          fetchOrders()
        } catch (err: any) {
          const errorMsg = err?.response?.data?.detail || '批量审批失败，请稍后重试'
          message.error(errorMsg)
        }
      }
    })
  }

  const batchActionsMenu: MenuProps['items'] = [
    hasPermission('stock_transfer:confirm')
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
    hasPermission('stock_transfer:delete')
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

  const handleSourceWarehouseChange = (val: string) => {
    setSourceWarehouse(val)
    form.setFieldsValue({ source_warehouse: val })
    fetchWarehouseProducts(val)
    setFormItems([createEmptyFormItem()])
  }

  const handleFormItemChange = (key: string, field: string, value: any) => {
    setFormItems(prev =>
      prev.map(item => {
        if (item.key !== key) return item
        const updated = { ...item, [field]: value }
        if (field === 'product_id') {
          if (value != null) {
            const wp = warehouseProducts.find(
              p => p.batch_id === value || p.product_id === value
            )
            if (wp) {
              updated.batch_id = wp.batch_id
              updated.batch_number = wp.batch_number
              updated.shelf_number = wp.shelf_number
              updated.unit_price = wp.unit_price
              updated.current_quantity = wp.current_quantity
              updated.quantity = 0
              updated.target_shelf_number = ''
            }
          } else {
            updated.batch_id = null
            updated.batch_number = ''
            updated.shelf_number = ''
            updated.unit_price = 0
            updated.current_quantity = 0
            updated.quantity = 0
            updated.target_shelf_number = ''
          }
        }
        return updated
      }),
    )
  }

  const addFormItem = () => {
    setFormItems(prev => [...prev, createEmptyFormItem()])
  }

  const removeFormItem = (key: string) => {
    if (formItems.length <= 1) return
    setFormItems(prev => prev.filter(item => item.key !== key))
  }

  const resetFilters = () => {
    setSearchText('')
    setStatusFilter(undefined)
    setSourceWhFilter(undefined)
    setDateRange(null)
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleSubmit = async () => {
    const isViewing = !!viewingOrder
    if (isViewing) {
      setModalOpen(false)
      setViewingOrder(null)
      return
    }

    try {
      const values = await form.validateFields()
      const validItems = formItems.filter(it => it.product_id != null && it.quantity > 0)
      if (validItems.length === 0) {
        message.error('请至少添加一个商品')
        return
      }

      for (const it of validItems) {
        if (it.quantity > it.current_quantity) {
          message.error(`商品批次"${it.batch_number}"库存不足，当前库存${it.current_quantity}，申请数量${it.quantity}`)
          return
        }
      }

      setSubmitting(true)

      const payload = {
        order_number: values.order_number,
        source_store_group_id: values.source_store_group_id,
        target_store_group_id: values.target_store_group_id,
        source_warehouse: values.source_warehouse || null,
        target_warehouse: values.target_warehouse || null,
        notes: values.notes || '',
        items: validItems.map(it => ({
          product_id: it.product_id!,
          batch_id: it.batch_id,
          batch_number: it.batch_number,
          shelf_number: it.shelf_number,
          target_shelf_number: it.target_shelf_number || null,
          quantity: it.quantity,
          unit_price: it.unit_price,
          notes: '',
        })),
      }

      if (editingOrder) {
        await stockTransfersApi.update(editingOrder.id, payload)
        message.success('更新成功')
      } else {
        await stockTransfersApi.create(payload)
        message.success('创建成功')
      }

      setModalOpen(false)
      setEditingOrder(null)
      setViewingOrder(null)
      fetchOrders()
    } catch (err: any) {
      if (err?.errorFields) return
      message.error(err?.response?.data?.detail || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const columns: ColumnsType<StockTransferOrder> = [
    {
      title: '挪货单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 160,
      render: (text: string, record: StockTransferOrder) => (
        <span style={{ color: '#1890ff', cursor: 'pointer' }} onClick={() => handleView(record)}>
          {text}
        </span>
      ),
    },
    {
      title: '源店铺分组',
      dataIndex: 'source_store_group_name',
      key: 'source_store_group_name',
      width: 120,
      render: (text: string) => <Tag color="purple">{text || '-'}</Tag>,
    },
    {
      title: '目标店铺分组',
      dataIndex: 'target_store_group_name',
      key: 'target_store_group_name',
      width: 120,
      render: (text: string) => <Tag color="cyan">{text || '-'}</Tag>,
    },
    {
      title: '源仓库',
      dataIndex: 'source_warehouse',
      key: 'source_warehouse',
      width: 100,
      render: (text: string) => text ? <Tag color="blue">{text}</Tag> : '-',
    },
    {
      title: '目标仓库',
      dataIndex: 'target_warehouse',
      key: 'target_warehouse',
      width: 100,
      render: (text: string) => text ? <Tag color="green">{text}</Tag> : '-',
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
      render: (_: any, record: StockTransferOrder) => {
        const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
          switch (key) {
            case 'view': handleView(record); break
            case 'edit':
              if (record.status === 'draft') handleEdit(record)
              break
            case 'delete':
              if (record.status === 'draft' || isAdmin) {
                Modal.confirm({
                  title: isAdmin && record.status === 'confirmed' ? '强制删除' : '删除',
                  content: '删除后不可恢复，请谨慎操作',
                  okText: '确定',
                  cancelText: '取消',
                  onOk: () => handleDelete(record.id),
                })
              }
              break
          }
        }

        const menuItems: MenuProps['items'] = []
        if (hasPermission('stock_transfer:view')) {
          menuItems.push({
            key: 'view',
            label: <span><InfoCircleOutlined style={{ marginRight: 8 }} />详情</span>,
          })
        }
        if (hasPermission('stock_transfer:edit') && record.status === 'draft') {
          menuItems.push({
            key: 'edit',
            label: <span><EditOutlined style={{ marginRight: 8 }} />编辑</span>,
          })
        }
        if (hasPermission('stock_transfer:delete') && (record.status === 'draft' || isAdmin)) {
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
            {hasPermission('stock_transfer:confirm') && (
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
              <Button size="small">操作<DownOutlined style={{ fontSize: 10, marginLeft: 4 }} /></Button>
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  const productSelectOptions = warehouseProducts.map(wp => ({
    label: `[${wp.batch_number}] ${wp.product_name}${wp.shelf_number ? ` | 货架:${wp.shelf_number}` : ''} | 库存:${wp.current_quantity}`,
    value: wp.batch_id,
  }))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 24 }}>
      <Card
        loading={loading}
        title={
          <Space wrap size="middle">
            <Input
              placeholder="搜索单号/仓库"
              prefix={<SearchOutlined />}
              allowClear
              value={searchText}
              onChange={(e) => {
                const val = e.target.value
                if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
                searchTimeoutRef.current = window.setTimeout(() => {
                  setSearchText(val)
                  setPagination(prev => ({ ...prev, current: 1 }))
                }, 400)
              }}
              style={{ width: 200 }}
            />
            <Select
              placeholder="状态"
              value={statusFilter}
              onChange={(val) => { setStatusFilter(val); setPagination(prev => ({ ...prev, current: 1 })) }}
              options={statusOptions}
              style={{ width: 120 }}
              allowClear
            />
            <Select
              placeholder="源仓库"
              value={sourceWhFilter}
              onChange={(val) => { setSourceWhFilter(val); setPagination(prev => ({ ...prev, current: 1 })) }}
              options={[
                { label: '全部', value: '' },
                ...warehouseList.filter(w => w.status === 'active').map(w => ({ label: w.name, value: w.name })),
              ]}
              style={{ width: 150 }}
              allowClear
            />
            <DatePicker.RangePicker
              value={dateRange as any}
              onChange={(dates) => {
                setDateRange(dates as [Dayjs | null, Dayjs | null] | null)
                if (dates && dates[0] && dates[1]) {
                  setFilters(prev => ({
                    ...prev,
                    start_date: dates[0]!.format('YYYY-MM-DD'),
                    end_date: dates[1]!.format('YYYY-MM-DD'),
                  }))
                } else {
                  setFilters(prev => {
                    const { start_date, end_date, ...rest } = prev
                    return rest
                  })
                }
                setPagination(prev => ({ ...prev, current: 1 }))
              }}
              style={{ width: 260 }}
            />
            <Button onClick={resetFilters} icon={<ReloadOutlined />}>重置</Button>
          </Space>
        }
        extra={
          <Space>
            {(hasPermission('stock_transfer:confirm') || hasPermission('stock_transfer:delete')) && selectedRowKeys.length > 0 && (
              <Dropdown menu={{ items: batchActionsMenu }} trigger={['click']}>
                <Button type="primary">
                  批量操作 ({selectedRowKeys.length}) <DownOutlined />
                </Button>
              </Dropdown>
            )}
            {hasPermission('stock_transfer:create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增挪货申请
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
          loading={loading}
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
            setPagination(prev => ({ ...prev, current: page, pageSize: pageSize || 20 }))
          }
        />
      </div>

      <Modal
        title={viewingOrder ? '查看挪货申请' : (editingOrder ? '编辑挪货申请' : '新增挪货申请')}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false)
          setEditingOrder(null)
          setViewingOrder(null)
        }}
        confirmLoading={submitting}
        okText={viewingOrder ? '确定' : undefined}
        width={viewingOrder || editingOrder ? 800 : 900}
        style={{ top: 20 }}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflow: 'auto', paddingRight: 8 } }}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="order_number"
              label="挪货单号"
              rules={viewingOrder ? [] : [{ required: true, message: '请输入挪货单号' }]}
            >
              <Input placeholder="请输入挪货单号" disabled={true} />
            </Form.Item>
            <Form.Item
              name="source_store_group_id"
              label="源店铺分组"
              rules={viewingOrder ? [] : [{ required: true, message: '请选择源店铺分组' }]}
            >
              <Select
                placeholder="请选择源店铺分组"
                showSearch
                optionFilterProp="label"
                options={storeGroups.map(g => ({ label: g.name, value: g.id }))}
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="target_store_group_id"
              label="目标店铺分组"
              rules={viewingOrder ? [] : [{ required: true, message: '请选择目标店铺分组' }]}
            >
              <Select
                placeholder="请选择目标店铺分组"
                showSearch
                optionFilterProp="label"
                options={storeGroups.map(g => ({ label: g.name, value: g.id }))}
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
            <Form.Item
              name="source_warehouse"
              label="源仓库（可选）"
            >
              <Select
                placeholder="请选择源仓库（可选）"
                showSearch
                optionFilterProp="label"
                allowClear
                options={warehouseList.map(w => ({ label: w.name, value: w.name }))}
                onChange={(val) => handleSourceWarehouseChange(val)}
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="target_warehouse"
              label="目标仓库（可选）"
            >
              <Select
                placeholder="请选择目标仓库（可选）"
                showSearch
                optionFilterProp="label"
                allowClear
                options={warehouseList.map(w => ({ label: w.name, value: w.name }))}
                disabled={viewingOrder || (editingOrder?.status === 'confirmed')}
              />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" disabled={viewingOrder || (editingOrder?.status === 'confirmed')} />
          </Form.Item>

          <Divider orientation="left" plain>挪货商品（选择源仓库后显示可用库存）</Divider>
          {!sourceWarehouse && !viewingOrder && !editingOrder && (
            <Alert message="请先选择源仓库，然后选择要挪动的商品" type="info" showIcon style={{ marginBottom: 16 }} />
          )}
          {formItems.map((item, index) => {
            const currentWp = warehouseProducts.find(wp => wp.batch_id === item.batch_id)
            return (
              <div
                key={item.key}
                style={{
                  marginBottom: 16, padding: 12,
                  border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 2, minWidth: 200 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>商品（批次 + 货架号）</div>
                    <Select
                      placeholder="请选择商品批次"
                      showSearch
                      loading={whProductsLoading}
                      value={item.batch_id}
                      onChange={(val) => handleFormItemChange(item.key, 'product_id', val)}
                      filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                      }
                      options={productSelectOptions}
                      style={{ width: '100%' }}
                      disabled={viewingOrder || (editingOrder?.status === 'confirmed') || !sourceWarehouse}
                    />
                    {item.shelf_number && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                        当前货架号: <Tag>{item.shelf_number}</Tag>
                        {item.current_quantity > 0 && (
                          <span style={{ marginLeft: 8, color: '#52c41a' }}>可用库存: {item.current_quantity}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>数量</div>
                    <InputNumber
                      min={1}
                      max={item.current_quantity}
                      value={item.quantity}
                      onChange={(val) => handleFormItemChange(item.key, 'quantity', val || 0)}
                      style={{ width: '100%' }}
                      placeholder="数量"
                      disabled={viewingOrder || (editingOrder?.status === 'confirmed') || !item.batch_id}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ marginBottom: 4, fontSize: 12, color: '#999' }}>目标货架号</div>
                    <Input
                      placeholder="新货架号（可选）"
                      value={item.target_shelf_number}
                      onChange={(e) => handleFormItemChange(item.key, 'target_shelf_number', e.target.value)}
                      disabled={viewingOrder || (editingOrder?.status === 'confirmed') || !item.batch_id}
                    />
                  </div>
                  {!viewingOrder && (editingOrder?.status !== 'confirmed') && (
                    <div style={{ flex: 'none', paddingTop: 24 }}>
                      <Button
                        icon={<CloseOutlined />}
                        size="small"
                        danger
                        onClick={() => removeFormItem(item.key)}
                        disabled={formItems.length <= 1}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {!viewingOrder && (editingOrder?.status !== 'confirmed') && sourceWarehouse && (
            <Button type="dashed" onClick={addFormItem} block icon={<PlusOutlined />}>
              添加商品
            </Button>
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default StockTransferManagement