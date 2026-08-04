import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Table, Button, Modal, Input, Select,
  message, Space, Tag, Divider, Dropdown, Pagination, Spin, Menu,
} from 'antd'
import { DownOutlined, SearchOutlined, ReloadOutlined, CheckOutlined, InfoCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import { shipmentsApi, storeGroupsApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

// ===== Types =====
interface ShipmentItem {
  id: number
  product_id: number
  product_code: string
  product_name: string
  stock_quantity: number
  red_list?: string
  sea_freight?: string
  notes?: string
}

interface ShipmentOrder {
  id: number
  order_number: string
  store_group_id: number | null
  store_group_name: string
  total_quantity: number
  status: string
  notes: string | null
  created_by: number | null
  creator_name: string
  confirmed_by: number | null
  confirmer_name: string
  confirmed_at: string | null
  created_at: string
}

interface ShipmentOrderDetail extends ShipmentOrder {
  items: ShipmentItem[]
}

interface EditableItem {
  id: number
  product_id: number
  product_code: string
  product_name: string
  stock_quantity: number
  red_list: string
  sea_freight: string
  notes: string
}

// ===== Status Config =====
const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  cancelled: '已取消',
}

const statusColorMap: Record<string, string> = {
  draft: 'default',
  confirmed: 'blue',
  cancelled: 'red',
}

const statusFilterOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已确认', value: 'confirmed' },
  { label: '已取消', value: 'cancelled' },
]


// ===== Helpers =====
const formatTime = (t: string | null | undefined): string => {
  if (!t) return '-'
  return t
}

// ===== Main Component =====
const ShipmentManagement: React.FC = () => {
  const { currentTheme: _ } = useTheme()
  const { hasPermission } = useAuth()

  const canConfirm = hasPermission('shipment:confirm')
  const canDelete = hasPermission('shipment:delete')

  const [orders, setOrders] = useState<ShipmentOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [storeGroups, setStoreGroups] = useState<any[]>([])
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [storeGroupFilter, setStoreGroupFilter] = useState<number | undefined>(undefined)
  const [filters, setFilters] = useState<Record<string, any>>({})
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailOrder, setDetailOrder] = useState<ShipmentOrderDetail | null>(null)
  const [editableItems, setEditableItems] = useState<EditableItem[]>([])
  const [detailSaving, setDetailSaving] = useState(false)

  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const searchTimeoutRef = useRef<number | null>(null)

  // ===== Effects =====
  useEffect(() => {
    fetchStoreGroups()
  }, [])

  useEffect(() => {
    fetchOrders()
  }, [pagination.current, pagination.pageSize, filters])

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const res = await shipmentsApi.getList({
        page: pagination.current,
        page_size: pagination.pageSize,
        ...filters,
      })
      if (res.data.success) {
        setOrders(res.data.data)
        setPagination((prev) => ({ ...prev, total: res.data.total }))
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '获取发货单列表失败')
    } finally {
      setLoading(false)
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

  const fetchOrderDetail = async (id: number): Promise<ShipmentOrderDetail | null> => {
    setDetailLoading(true)
    try {
      const res = await shipmentsApi.getDetail(id)
      const detail: ShipmentOrderDetail = res.data
      return detail
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '获取发货单详情失败')
      return null
    } finally {
      setDetailLoading(false)
    }
  }

  // ===== Search & Filter Handlers =====
  const handleSearch = (value: string) => {
    setSearchText(value)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      setFilters((prev) => {
        const next = { ...prev }
        if (value) {
          next.search = value
        } else {
          delete next.search
        }
        return next
      })
      setPagination((prev) => ({ ...prev, current: 1 }))
    }, 300)
  }

  const handleReset = () => {
    setSearchText('')
    setStatusFilter(undefined)
    setStoreGroupFilter(undefined)
    setFilters({})
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleStatusFilter = (value: string | undefined) => {
    setStatusFilter(value)
    setFilters((prev) => {
      const next = { ...prev }
      if (value) {
        next.status = value
      } else {
        delete next.status
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleStoreGroupFilter = (value: number | undefined) => {
    setStoreGroupFilter(value)
    setFilters((prev) => {
      const next = { ...prev }
      if (value) {
        next.store_group_id = value
      } else {
        delete next.store_group_id
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  // ===== Detail Modal Handlers =====
  const handleView = async (order: ShipmentOrder) => {
    setDetailModalOpen(true)
    setDetailOrder(null)
    setEditableItems([])
    const detail = await fetchOrderDetail(order.id)
    if (detail) {
      setDetailOrder(detail)
      setEditableItems(detail.items.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
        stock_quantity: item.stock_quantity,
        red_list: item.red_list || '',
        sea_freight: item.sea_freight || '',
        notes: item.notes || '',
      })))
    }
  }

  const closeDetailModal = () => {
    setDetailModalOpen(false)
    setDetailOrder(null)
  }

  const handleDetailSave = async () => {
    if (!detailOrder) return
    setDetailSaving(true)
    try {
      if (detailOrder.status === 'draft') {
        const payload = {
          items: editableItems.map((item) => ({
            product_id: item.product_id,
            product_code: item.product_code,
            product_name: item.product_name,
            stock_quantity: item.stock_quantity,
            red_list: item.red_list || undefined,
            sea_freight: item.sea_freight || undefined,
            notes: item.notes || undefined,
          })),
        }
        const res = await shipmentsApi.update(detailOrder.id, payload)
        if (res.data.success) {
          message.success('保存成功')
          closeDetailModal()
          fetchOrders()
        }
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存失败')
    } finally {
      setDetailSaving(false)
    }
  }

  const updateEditableItem = (id: number, field: keyof EditableItem, value: any) => {
    setEditableItems((prev) => prev.map((item) => {
      if (item.id === id) {
        return { ...item, [field]: value }
      }
      return item
    }))
  }

  const handleConfirm = (order: ShipmentOrder) => {
    Modal.confirm({
      title: '确认发货单',
      content: `确定要确认发货单 ${order.order_number} 吗？确认后订单将不可编辑。`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setConfirmingId(order.id)
        try {
          const res = await shipmentsApi.confirm(order.id)
          if (res.data.success) {
            message.success('发货单已确认')
            fetchOrders()
          }
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '确认失败')
        } finally {
          setConfirmingId(null)
        }
      },
    })
  }

  const handleDelete = (order: ShipmentOrder) => {
    Modal.confirm({
      title: '删除发货单',
      content: `确定要删除发货单 ${order.order_number} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setConfirmingId(order.id)
        try {
          const res = await shipmentsApi.delete(order.id)
          if (res.data.success) {
            message.success('发货单已删除')
            fetchOrders()
          }
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '删除失败')
        } finally {
          setConfirmingId(null)
        }
      },
    })
  }

  // ===== Columns =====
  const columns: ColumnsType<ShipmentOrder> = [
    {
      title: '发货单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 180,
      render: (text: string, record: ShipmentOrder) => (
        <a
          style={{ color: '#1677ff', cursor: 'pointer' }}
          onClick={() => handleView(record)}
        >
          {text}
        </a>
      ),
    },
    {
      title: '店铺分组',
      dataIndex: 'store_group_name',
      key: 'store_group_name',
      width: 120,
      render: (text: string) => text || '-',
    },
    {
      title: '总数量',
      dataIndex: 'total_quantity',
      key: 'total_quantity',
      width: 100,
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
      title: '创建人',
      dataIndex: 'creator_name',
      key: 'creator_name',
      width: 100,
      render: (text: string) => text || '-',
    },
    {
      title: '确认人',
      dataIndex: 'confirmer_name',
      key: 'confirmer_name',
      width: 100,
      render: (text: string) => text || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
    },
    {
      title: '操作',
      key: 'operation',
      width: 160,
      fixed: 'right',
      render: (_: any, record: ShipmentOrder) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'view',
            label: (
              <span>
                <InfoCircleOutlined style={{ marginRight: 8 }} />
                详情
              </span>
            ),
          },
          { type: 'divider' },
          {
            key: 'delete',
            label: (
              <span style={{ color: '#ff4d4f' }}>
                <DeleteOutlined style={{ marginRight: 8 }} />
                删除
              </span>
            ),
            style: { color: '#ff4d4f' },
            disabled: !canDelete,
          },
        ]

        const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
          if (key === 'view') handleView(record)
          else if (key === 'delete') handleDelete(record)
        }

        const menu = <Menu onClick={handleMenuClick} items={menuItems} />

        return (
          <Space>
            {canConfirm && (
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleConfirm(record)}
                disabled={record.status !== 'draft' || confirmingId === record.id}
              >
                确认
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

  // Detail modal item columns (conditional on status)
  const getDetailItemColumns = (): ColumnsType<EditableItem> => {
    const status = detailOrder?.status
    const isDraft = status === 'draft'

    return [
      { title: '产品编码', dataIndex: 'product_code', key: 'product_code', width: 140 },
      { title: '产品名称', dataIndex: 'product_name', key: 'product_name', width: 200 },
      { title: '数量', dataIndex: 'stock_quantity', key: 'stock_quantity', width: 80 },
      {
        title: '红单',
        key: 'red_list',
        width: 120,
        render: (_: any, item: EditableItem) => {
          if (isDraft) {
            return (
              <Input
                size="small"
                value={item.red_list}
                onChange={(e) => updateEditableItem(item.id, 'red_list', e.target.value)}
                placeholder="红单"
              />
            )
          }
          return item.red_list || '-'
        },
      },
      {
        title: '海运',
        key: 'sea_freight',
        width: 120,
        render: (_: any, item: EditableItem) => {
          if (isDraft) {
            return (
              <Input
                size="small"
                value={item.sea_freight}
                onChange={(e) => updateEditableItem(item.id, 'sea_freight', e.target.value)}
                placeholder="海运"
              />
            )
          }
          return item.sea_freight || '-'
        },
      },
      {
        title: '备注',
        key: 'notes',
        width: 200,
        render: (_: any, item: EditableItem) => {
          if (isDraft) {
            return (
              <Input
                size="small"
                value={item.notes}
                onChange={(e) => updateEditableItem(item.id, 'notes', e.target.value)}
                placeholder="备注"
              />
            )
          }
          return item.notes || '-'
        },
      },
    ]
  }

  const isDetailEditable = detailOrder?.status === 'draft'

  return (
    <div style={{ marginLeft: 40, marginRight: 40, marginTop: 16 }}>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索发货单号/店铺分组/备注"
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 280 }}
          />
          <Select
            placeholder="状态筛选"
            value={statusFilter}
            onChange={handleStatusFilter}
            options={statusFilterOptions}
            allowClear
            style={{ width: 140 }}
          />
          <Select
            placeholder="店铺分组筛选"
            value={storeGroupFilter}
            onChange={handleStoreGroupFilter}
            options={storeGroups.map((sg) => ({ label: sg.name, value: sg.id }))}
            allowClear
            style={{ width: 160 }}
          />
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
        </Space>
        <Table
          columns={columns}
          dataSource={orders}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 'max-content' }}
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
          onChange={(page, pageSize) => setPagination((prev) => ({ ...prev, current: page, pageSize }))}
        />
      </div>

      {/* Detail Modal */}
      <Modal
        title="发货单详情"
        open={detailModalOpen}
        onCancel={closeDetailModal}
        footer={isDetailEditable ? [
          <Button key="close" onClick={closeDetailModal}>
            关闭
          </Button>,
          <Button key="save" type="primary" loading={detailSaving} onClick={handleDetailSave}>
            保存
          </Button>,
        ] : [
          <Button key="close" onClick={closeDetailModal}>
            关闭
          </Button>,
        ]}
        width={1000}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <Spin size="large" />
          </div>
        ) : detailOrder ? (
          <>
            {detailOrder.notes && (
              <div style={{ marginBottom: 16 }}>
                <strong>备注：</strong>{detailOrder.notes}
              </div>
            )}
            <Table
              columns={getDetailItemColumns()}
              dataSource={editableItems}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          </>
        ) : null}
      </Modal>
    </div>
  )
}

export default ShipmentManagement
