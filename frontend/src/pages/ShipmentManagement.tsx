import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Table, Button, Modal, Input, Select,
  message, Space, Tag, Divider, Dropdown, Pagination, Spin, Menu,
} from 'antd'
import { DownOutlined, SearchOutlined, ReloadOutlined, CheckOutlined, InfoCircleOutlined, DeleteOutlined, ExclamationCircleOutlined, ExportOutlined, ImportOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import { shipmentsApi, storeGroupsApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useResponsive } from '../hooks/useResponsive'
import './management-responsive.css'

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
  sku?: string
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
  outbound_order_id: number | null
  outbound_order_number: string | null
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
  sku: string
}

// ===== Status Config =====
const statusLabelMap: Record<string, string> = {
  draft: '待运营确认',
  confirmed: '已确认',
  cancelled: '已取消',
}

const statusColorMap: Record<string, string> = {
  draft: 'orange',
  confirmed: 'blue',
  cancelled: 'red',
}

const statusFilterOptions = [
  { label: '待运营确认', value: 'draft' },
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
  const res = useResponsive()

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
  const [detailValidated, setDetailValidated] = useState(false)

  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const [detailSelectedRowKeys, setDetailSelectedRowKeys] = useState<number[]>([])
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importOrderId, setImportOrderId] = useState<number | null>(null)
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
    setDetailValidated(false)
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
        sku: item.sku || '',
      })))
    }
  }

  const closeDetailModal = () => {
    setDetailModalOpen(false)
    setDetailOrder(null)
    setDetailValidated(false)
  }

  const handleDetailSave = async () => {
    if (!detailOrder) return

    // 检查红单+海运是否等于总数
    const mismatchItems = editableItems.filter(item => {
      const redNum = parseInt(item.red_list) || 0
      const seaNum = parseInt(item.sea_freight) || 0
      return redNum + seaNum !== item.stock_quantity
    })

    if (mismatchItems.length > 0) {
      setDetailValidated(true)
      message.error(`有 ${mismatchItems.length} 行的红单+海运数量不等于总数，请修正后再保存`)
      return
    }

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

  // 选中全部红单：将选中的行红单填充为该行数量，同时清空海运
  const handleFillAllRedList = () => {
    if (detailSelectedRowKeys.length === 0) {
      message.warning('请先勾选要操作的行')
      return
    }
    setEditableItems((prev) => prev.map((item) => {
      if (detailSelectedRowKeys.includes(item.id)) {
        return { ...item, red_list: String(item.stock_quantity), sea_freight: '' }
      }
      return item
    }))
    message.success(`已为选中的 ${detailSelectedRowKeys.length} 行填充红单数量`)
  }

  // 选中全部海运：将选中的行海运填充为该行数量，同时清空红单
  const handleFillAllSeaFreight = () => {
    if (detailSelectedRowKeys.length === 0) {
      message.warning('请先勾选要操作的行')
      return
    }
    setEditableItems((prev) => prev.map((item) => {
      if (detailSelectedRowKeys.includes(item.id)) {
        return { ...item, sea_freight: String(item.stock_quantity), red_list: '' }
      }
      return item
    }))
    message.success(`已为选中的 ${detailSelectedRowKeys.length} 行填充海运数量`)
  }

  // 导出发货单明细
  const handleExportDetail = async (order: ShipmentOrder) => {
    try {
      const res = await shipmentsApi.exportDetail(order.id)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // 优先使用后端返回的文件名（单号+日期格式）
      const disposition: string = res.headers['content-disposition'] || ''
      const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/)
      link.download = match ? decodeURIComponent(match[1].trim().replace(/^["']|["']$/g, '')) : `发货单_${order.order_number}_${new Date().toISOString().slice(0, 10)}.xlsx`
      link.click()
      window.URL.revokeObjectURL(url)
      message.success('导出成功')
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '导出失败')
    }
  }

  // 导入发货单明细
  const handleImportDetail = (orderId: number) => {
    setImportOrderId(orderId)
    fileInputRef.current?.click()
  }

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !importOrderId) return
    setImporting(true)
    try {
      const res = await shipmentsApi.importDetail(importOrderId, file)
      if (res.data.success) {
        message.success('导入成功')
        // 重新加载详情
        const detail = await fetchOrderDetail(importOrderId)
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
            sku: item.sku || '',
          })))
        }
        fetchOrders()
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '导入失败')
    } finally {
      setImporting(false)
      setImportOrderId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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
      responsive: ['md'],
      width: 120,
      render: (text: string) => text || '-',
    },
    {
      title: '总数量',
      dataIndex: 'total_quantity',
      key: 'total_quantity',
      responsive: ['md'],
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
      title: '关联出库单',
      dataIndex: 'outbound_order_number',
      key: 'outbound_order_number',
      responsive: ['md'],
      width: 140,
      render: (text: string) => text || '-',
    },
    {
      title: '创建人',
      dataIndex: 'creator_name',
      key: 'creator_name',
      responsive: ['md'],
      width: 100,
      render: (text: string) => text || '-',
    },
    {
      title: '确认人',
      dataIndex: 'confirmer_name',
      key: 'confirmer_name',
      responsive: ['md'],
      width: 100,
      render: (text: string) => text || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      responsive: ['md'],
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
          {
            key: 'export',
            label: (
              <span>
                <ExportOutlined style={{ marginRight: 8 }} />
                导出
              </span>
            ),
          },
          {
            key: 'import',
            label: (
              <span>
                <ImportOutlined style={{ marginRight: 8 }} />
                导入
              </span>
            ),
            disabled: record.status !== 'draft',
          },
          {
            key: 'convert-outbound',
            label: (
              <span>
                <ExportOutlined style={{ marginRight: 8 }} />
                转出库单
              </span>
            ),
            disabled: record.status !== 'confirmed' || !!record.outbound_order_id,
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
          else if (key === 'export') handleExportDetail(record)
          else if (key === 'import') handleImportDetail(record.id)
          else if (key === 'convert-outbound') handleConvertOutbound(record)
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
      { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 120 },
      { title: '产品名称', dataIndex: 'product_name', key: 'product_name', width: 200 },
      { title: '数量', dataIndex: 'stock_quantity', key: 'stock_quantity', width: 80 },
      {
        title: '红单',
        key: 'red_list',
        width: 140,
        render: (_: any, item: EditableItem) => {
          const redNum = parseInt(item.red_list) || 0
          const seaNum = parseInt(item.sea_freight) || 0
          const total = redNum + seaNum
          const mismatch = total !== item.stock_quantity
          const showError = mismatch && detailValidated
          const mismatchText = total > item.stock_quantity ? '红单+海运超出数量' : '红单+海运不足数量'
          if (isDraft) {
            return (
              <div>
                <Input
                  size="small"
                  value={item.red_list}
                  status={showError ? 'error' : undefined}
                  onChange={(e) => {
                    // 只允许输入数字
                    const val = e.target.value.replace(/[^\d]/g, '')
                    updateEditableItem(item.id, 'red_list', val)
                  }}
                  placeholder="红单"
                />
                {showError && (
                  <div style={{ color: '#ff4d4f', fontSize: 11, marginTop: 2 }}>
                    {mismatchText}
                  </div>
                )}
              </div>
            )
          }
          return item.red_list || '-'
        },
      },
      {
        title: '海运',
        key: 'sea_freight',
        width: 140,
        render: (_: any, item: EditableItem) => {
          const redNum = parseInt(item.red_list) || 0
          const seaNum = parseInt(item.sea_freight) || 0
          const total = redNum + seaNum
          const mismatch = total !== item.stock_quantity
          const showError = mismatch && detailValidated
          const mismatchText = total > item.stock_quantity ? '红单+海运超出数量' : '红单+海运不足数量'
          if (isDraft) {
            return (
              <div>
                <Input
                  size="small"
                  value={item.sea_freight}
                  status={showError ? 'error' : undefined}
                  onChange={(e) => {
                    // 只允许输入数字
                    const val = e.target.value.replace(/[^\d]/g, '')
                    updateEditableItem(item.id, 'sea_freight', val)
                  }}
                  placeholder="海运"
                />
                {showError && (
                  <div style={{ color: '#ff4d4f', fontSize: 11, marginTop: 2 }}>
                    {mismatchText}
                  </div>
                )}
              </div>
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

  // ===== Batch Operations =====
  const handleBatchConfirm = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的发货单')
      return
    }
    const availableCount = orders.filter(
      o => selectedRowKeys.includes(o.id) && o.status === 'draft'
    ).length
    if (availableCount === 0) {
      message.warning('选中的发货单中没有可确认的（需为草稿状态）')
      return
    }
    Modal.confirm({
      title: '批量确认',
      icon: <ExclamationCircleOutlined />,
      content: `确定要确认选中的 ${availableCount} 条草稿发货单吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await shipmentsApi.batchConfirm(selectedRowKeys)
          if (res.data.success) {
            message.success(`成功确认 ${res.data.confirmed_count} 条发货单`)
            setSelectedRowKeys([])
            fetchOrders()
          }
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量确认失败')
        }
      },
    })
  }

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的发货单')
      return
    }
    Modal.confirm({
      title: '批量删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除选中的 ${selectedRowKeys.length} 条发货单吗？此操作不可撤销。`,
      okText: '确定',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await shipmentsApi.batchDelete(selectedRowKeys)
          if (res.data.success) {
            message.success(`成功删除 ${res.data.deleted_count} 条发货单`)
            setSelectedRowKeys([])
            fetchOrders()
          }
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量删除失败')
        }
      },
    })
  }

  const handleBatchConvertOutbound = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的发货单')
      return
    }
    const availableCount = orders.filter(
      o => selectedRowKeys.includes(o.id) && o.status === 'confirmed' && !o.outbound_order_id
    ).length
    if (availableCount === 0) {
      message.warning('选中的发货单中没有可转出库单的（需为已确认且未关联出库单）')
      return
    }
    Modal.confirm({
      title: '转出库单',
      icon: <ExclamationCircleOutlined />,
      content: `确定要将选中的 ${availableCount} 条已确认发货单转为出库单吗？同店铺分组的发货单将合并为一张出库单。`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await shipmentsApi.batchConvertOutbound(selectedRowKeys)
          if (res.data.success) {
            message.success(res.data.message || '转出库单成功')
            setSelectedRowKeys([])
            fetchOrders()
          }
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '转出库单失败')
        }
      },
    })
  }

  // 单行转出库单
  const handleConvertOutbound = (order: ShipmentOrder) => {
    if (order.status !== 'confirmed') {
      message.warning('只有已确认状态的发货单才能转出库单')
      return
    }
    if (order.outbound_order_id) {
      message.warning('该发货单已关联出库单，不能重复转换')
      return
    }
    Modal.confirm({
      title: '转出库单',
      icon: <ExclamationCircleOutlined />,
      content: `确定要将发货单 ${order.order_number} 转为出库单吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await shipmentsApi.batchConvertOutbound([order.id])
          if (res.data.success) {
            message.success(res.data.message || '转出库单成功')
            fetchOrders()
          }
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '转出库单失败')
        }
      },
    })
  }

  return (
        <div className="shipment-page">
      <Card style={{ marginBottom: 16 }}>
        <div className="page-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div className="filter-item">
              <Input
                placeholder="搜索发货单号/店铺分组/备注"
                value={searchText}
                onChange={(e) => handleSearch(e.target.value)}
                prefix={<SearchOutlined />}
                allowClear
                style={{ width: 280 }}
              />
            </div>
            <div className="filter-item">
              <Select
                placeholder="状态筛选"
                value={statusFilter}
                onChange={handleStatusFilter}
                options={statusFilterOptions}
                allowClear
                style={{ width: 140 }}
              />
            </div>
            <div className="filter-item">
              <Select
                placeholder="店铺分组筛选"
                value={storeGroupFilter}
                onChange={handleStoreGroupFilter}
                options={storeGroups.map((sg) => ({ label: sg.name, value: sg.id }))}
                allowClear
                style={{ width: 160 }}
              />
            </div>
          </div>
          <div className="action-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
            <Dropdown
              menu={{
                items: [
                  canConfirm ? {
                    key: 'batch-confirm',
                    label: '批量确认',
                    icon: <CheckOutlined />,
                  } : null,
                  {
                    key: 'batch-convert-outbound',
                    label: '转出库单',
                    icon: <ExportOutlined />,
                  },
                  canDelete ? {
                    key: 'batch-delete',
                    label: '批量删除',
                    icon: <DeleteOutlined />,
                    danger: true,
                  } : null,
                ].filter(Boolean),
                onClick: ({ key }) => {
                  if (key === 'batch-confirm') handleBatchConfirm()
                  else if (key === 'batch-delete') handleBatchDelete()
                  else if (key === 'batch-convert-outbound') handleBatchConvertOutbound()
                },
              }}
              trigger={['click']}
            >
              <Button>
                批量 <DownOutlined />
              </Button>
            </Dropdown>
          </div>
        </div>
        <div className="responsive-table-wrapper">
        <Table
          columns={columns}
          dataSource={orders}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 'max-content' }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as number[]),
          }}
        />
        </div>
      </Card>
      <div className="pagination-wrapper">
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
        className="responsive-modal"
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
        width={res.isMobile ? '95vw' : 1000}
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
            {isDetailEditable && (
              <div style={{ marginBottom: 12 }}>
                <Space>
                  <Button size="small" onClick={handleFillAllRedList}>选中全部红单</Button>
                  <Button size="small" onClick={handleFillAllSeaFreight}>选中全部海运</Button>
                </Space>
              </div>
            )}
            <Table
              columns={getDetailItemColumns()}
              dataSource={editableItems}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
              rowSelection={isDetailEditable ? {
                selectedRowKeys: detailSelectedRowKeys,
                onChange: (keys) => setDetailSelectedRowKeys(keys as number[]),
              } : undefined}
            />
          </>
        ) : null}
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleImportFileChange}
      />
      {importing && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', zIndex: 9999 }}>
          <Spin size="large" tip="导入中..." />
        </div>
      )}
    </div>
  )
}

export default ShipmentManagement
