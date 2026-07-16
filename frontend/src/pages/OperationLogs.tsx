import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Select, DatePicker, Input, Space, Tag, Modal, Button, Descriptions, Typography, Pagination } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { operationLogsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const { RangePicker } = DatePicker
const { Text } = Typography

interface OperationLog {
  id: number
  user_id: number | null
  username: string
  module: string
  action: string
  target_type: string
  target_id: number | null
  target_name: string
  before_data: any
  after_data: any
  summary: string
  created_at: string
}

const moduleLabels: Record<string, string> = {
  inbound: '入库管理',
  outbound: '出库管理',
  purchase: '采购管理',
  product: '产品管理',
  stock_transfer: '挪货管理',
  replenishment: '补货管理',
  shipment: '发货管理',
}

const actionLabels: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  confirm: '审批',
  cancel: '取消',
  batch_import: '批量导入',
  export: '导出',
}

const moduleColorMap: Record<string, string> = {
  inbound: 'blue',
  outbound: 'orange',
  purchase: 'purple',
  product: 'green',
  stock_transfer: 'magenta',
  replenishment: 'volcano',
  shipment: 'cyan',
}

const actionColorMap: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  confirm: 'cyan',
  cancel: 'default',
  batch_import: 'purple',
  export: 'geekblue',
}

const fieldLabels: Record<string, Record<string, string>> = {
  product: {
    product_code: '产品编码',
    name: '产品名称',
    name_en: '英文名称',
    product_type: '产品类型',
    product_attribute: '产品属性',
    category: '分类',
    brand: '品牌',
    purchase_price: '采购价',
    sale_price: '销售价',
    main_image: '主图',
    weight: '重量',
    length: '长度',
    width: '宽度',
    height: '高度',
    status: '状态',
    is_robot_monitored: '机器人监控',
    local_quantity: '本地库存',
    local_warehouse: '本地仓库',
    local_inbound_date: '本地入库日期',
    local_stock_age: '本地库存龄',
  },
  platform_product: {
    platform: '平台',
    sku: 'SKU',
    asin: 'ASIN',
    spu: 'SPU',
    title: '标题',
    title_en: '英文标题',
    image_url: '图片地址',
    currency: '货币',
    price: '价格',
    cost_price: '成本价',
    status: '状态',
    product_id: '产品ID',
    platform_product_id: '平台产品ID',
    store_id: '店铺ID',
  },
  order: {
    order_number: '订单号',
    type: '类型',
    status: '状态',
    total_amount: '总金额',
    total_quantity: '总数量',
    supplier: '供应商',
    warehouse: '仓库',
    remark: '备注',
    items: '商品项',
  },
  inbound: {
    order_number: '入库单号',
    warehouse: '仓库',
    supplier: '供应商',
    total_quantity: '总数量',
    total_amount: '总金额',
    status: '状态',
    remark: '备注',
    items_count: '商品项数',
  },
  outbound: {
    order_number: '出库单号',
    warehouse: '仓库',
    customer: '客户',
    total_quantity: '总数量',
    total_amount: '总金额',
    status: '状态',
    remark: '备注',
    items_count: '商品项数',
  },
  purchase: {
    order_number: '采购单号',
    supplier: '供应商',
    warehouse: '仓库',
    total_quantity: '总数量',
    total_amount: '总金额',
    status: '状态',
    remark: '备注',
    items_count: '商品项数',
    expected_date: '期望日期',
  },
  stock_transfer: {
    order_number: '挪货单号',
    source_warehouse: '源仓库',
    target_warehouse: '目标仓库',
    total_quantity: '总数量',
    status: '状态',
    remark: '备注',
    items_count: '商品项数',
  },
  replenishment: {
    order_number: '补货单号',
    单号: '单号',
    platform: '所属平台',
    所属平台: '所属平台',
    items_count: '明细数量',
    明细数量: '明细数量',
    status: '状态',
    notes: '备注',
  },
  shipment: {
    order_number: '发货单号',
    store_group_id: '店铺分组ID',
    store_group_name: '店铺分组',
    total_quantity: '总数量',
    status: '状态',
    notes: '备注',
    items_count: '商品项数',
  },
  inventory: {
    warehouse: '仓库',
    product_id: '产品ID',
    product_code: '产品编码',
    product_name: '产品名称',
    quantity: '库存数量',
    available_quantity: '可用数量',
    locked_quantity: '锁定数量',
    safety_stock: '安全库存',
    unit_cost: '单位成本',
  },
  default: {
    id: 'ID',
    name: '名称',
    code: '编码',
    status: '状态',
    quantity: '数量',
    price: '价格',
    amount: '金额',
    cost: '成本',
    total: '总计',
    date: '日期',
    time: '时间',
    created_at: '创建时间',
    updated_at: '更新时间',
    type: '类型',
    remark: '备注',
    warehouse: '仓库',
    supplier: '供应商',
    customer: '客户',
    count: '数量',
    source: '来源',
    target: '目标',
    product_id: '产品ID',
    product_name: '产品名称',
    product_code: '产品编码',
    sku: 'SKU',
    asin: 'ASIN',
  },
}

const moduleOptions = [
  { label: '全部', value: '' },
  { label: '入库管理', value: 'inbound' },
  { label: '出库管理', value: 'outbound' },
  { label: '采购管理', value: 'purchase' },
  { label: '产品管理', value: 'product' },
  { label: '挪货管理', value: 'stock_transfer' },
  { label: '补货管理', value: 'replenishment' },
  { label: '发货管理', value: 'shipment' },
]

const actionOptions = [
  { label: '全部', value: '' },
  { label: '创建', value: 'create' },
  { label: '更新', value: 'update' },
  { label: '删除', value: 'delete' },
  { label: '审批', value: 'confirm' },
  { label: '取消', value: 'cancel' },
]

const OperationLogs: React.FC = () => {
  const { currentTheme } = useTheme()
  const [logs, setLogs] = useState<OperationLog[]>([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({})

  const [moduleFilter, setModuleFilter] = useState<string | undefined>(undefined)
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [searchText, setSearchText] = useState('')
  const searchTimeoutRef = useRef<number | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedLog, setSelectedLog] = useState<OperationLog | null>(null)

  useEffect(() => {
    fetchLogs()
  }, [pagination.current, pagination.pageSize, filters])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await operationLogsApi.getList({
        page: pagination.current,
        page_size: pagination.pageSize,
        ...filters,
      })
      if (res.data.success) {
        setLogs(res.data.data)
        setPagination((prev) => ({ ...prev, total: res.data.total }))
      }
    } catch (e) {
      console.error('获取操作日志失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleModuleFilter = (value: string | undefined) => {
    setModuleFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (value) {
        next.module = value
      } else {
        delete next.module
      }
      return next
    })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleActionFilter = (value: string | undefined) => {
    setActionFilter(value)
    setFilters((prev) => {
      const next: Record<string, any> = { ...prev }
      if (value) {
        next.action = value
      } else {
        delete next.action
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

  const handleSearchChange = useCallback((value: string) => {
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
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const handleReset = () => {
    setModuleFilter(undefined)
    setActionFilter(undefined)
    setDateRange(null)
    setSearchText('')
    setFilters({})
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const showDetail = (record: OperationLog) => {
    setSelectedLog(record)
    setDetailOpen(true)
  }

  const getFieldLabel = (key: string, targetType: string | null, module: string | null) => {
    // 优先使用 target_type 的标签
    if (targetType && fieldLabels[targetType]?.[key]) {
      return fieldLabels[targetType][key]
    }
    // 其次使用 module 的标签
    if (module && fieldLabels[module]?.[key]) {
      return fieldLabels[module][key]
    }
    // 最后使用默认标签
    return fieldLabels.default[key] || key
  }

  const renderData = (data: any, title: string) => {
    if (data === null || data === undefined) {
      return (
        <div style={{ background: currentTheme.primaryBg, padding: 12, borderRadius: 6 }}>
          <Text type="secondary">无数据</Text>
        </div>
      )
    }

    let parsedData = data
    try {
      if (typeof data === 'string') {
        parsedData = JSON.parse(data)
      }
    } catch {
      // 不是 JSON 字符串，保持原样
    }

    if (!parsedData || typeof parsedData !== 'object') {
      return (
        <div style={{ background: currentTheme.primaryBg, padding: 12, borderRadius: 6 }}>
          <Text>{String(parsedData)}</Text>
        </div>
      )
    }

    const entries = Object.entries(parsedData)
    if (entries.length === 0) {
      return (
        <div style={{ background: currentTheme.primaryBg, padding: 12, borderRadius: 6 }}>
          <Text type="secondary">无数据</Text>
        </div>
      )
    }

    return (
      <div style={{ background: currentTheme.primaryBg, borderRadius: 6, overflow: 'hidden' }}>
        <Descriptions column={1} size="small" bordered>
          {entries.map(([key, value]) => (
            <Descriptions.Item
              key={key}
              label={
                <span style={{ fontWeight: 500 }}>
                  {getFieldLabel(key, selectedLog?.target_type, selectedLog?.module)}
                </span>
              }
            >
              {value === null || value === undefined ? (
                <Text type="secondary">-</Text>
              ) : typeof value === 'boolean' ? (
                <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag>
              ) : (
                <Text>{String(value)}</Text>
              )}
            </Descriptions.Item>
          ))}
        </Descriptions>
      </div>
    )
  }

  const columns: ColumnsType<OperationLog> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
    },
    {
      title: '操作时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (val: string) => dayjs(val).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: '模块',
      dataIndex: 'module',
      key: 'module',
      width: 110,
      render: (val: string) => (
        <Tag color={moduleColorMap[val] || 'default'}>{moduleLabels[val] || val}</Tag>
      ),
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      width: 90,
      render: (val: string) => (
        <Tag color={actionColorMap[val] || 'default'}>{actionLabels[val] || val}</Tag>
      ),
    },
    {
      title: '目标',
      key: 'target',
      width: 160,
      render: (_: any, record: OperationLog) => {
        if (!record.target_name) return <Text type="secondary">-</Text>
        const typeLabel: Record<string, string> = {
          product: '产品',
          order: '订单',
          inventory: '库存',
          user: '用户',
        }
        return (
          <Space size={4}>
            {record.target_type && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {typeLabel[record.target_type] || record.target_type}
              </Text>
            )}
            <Text>{record.target_name}</Text>
          </Space>
        )
      },
    },
    {
      title: '操作摘要',
      dataIndex: 'summary',
      key: 'summary',
      ellipsis: true,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_: any, record: OperationLog) => (
        <Button type="link" size="small" onClick={() => showDetail(record)}>
          详情
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Card
        loading={loading}
        title={
          <Space wrap size="middle">
            <Select
              placeholder="选择模块"
              allowClear
              style={{ width: 140 }}
              value={moduleFilter}
              onChange={handleModuleFilter}
              options={moduleOptions}
            />
            <Select
              placeholder="操作类型"
              allowClear
              style={{ width: 140 }}
              value={actionFilter}
              onChange={handleActionFilter}
              options={actionOptions}
            />
            <RangePicker
              placeholder={['开始日期', '结束日期']}
              value={dateRange}
              onChange={handleDateRangeChange}
              style={{ width: 300 }}
            />
            <Input
              placeholder="搜索日志内容"
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => handleSearchChange(e.target.value)}
              allowClear
              style={{ width: 200 }}
            />
          </Space>
        }
        extra={
          <Button onClick={handleReset}>重置</Button>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 16, minHeight: 0 }}
        styles={{ body: { flex: 1, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 } }}
      >
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          scroll={{ x: 1200, y: 'calc(100vh - 380px)' }}
          pagination={false}
          tableLayout="fixed"
          sticky={{ offsetHeader: 0 }}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => showDetail(record),
          })}
        />
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8, flexShrink: 0 }}>
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
        title="操作日志详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        {selectedLog && (
          <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
            <Descriptions.Item label="ID">{selectedLog.id}</Descriptions.Item>
            <Descriptions.Item label="操作时间">
              {dayjs(selectedLog.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="用户">{selectedLog.username}</Descriptions.Item>
            <Descriptions.Item label="用户ID">{selectedLog.user_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="模块">
              <Tag color={moduleColorMap[selectedLog.module] || 'default'}>
                {moduleLabels[selectedLog.module] || selectedLog.module}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="操作类型">
              <Tag color={actionColorMap[selectedLog.action] || 'default'}>
                {actionLabels[selectedLog.action] || selectedLog.action}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="目标类型">{selectedLog.target_type || '-'}</Descriptions.Item>
            <Descriptions.Item label="目标ID">{selectedLog.target_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="目标名称" span={2}>
              {selectedLog.target_name || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="操作摘要" span={2}>
              {selectedLog.summary || '-'}
            </Descriptions.Item>
          </Descriptions>
        )}

        {selectedLog && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>变更前数据</Text>
              {renderData(selectedLog.before_data, '变更前')}
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>变更后数据</Text>
              {renderData(selectedLog.after_data, '变更后')}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default OperationLogs
