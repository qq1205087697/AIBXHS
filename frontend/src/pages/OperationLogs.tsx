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
}

const actionLabels: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  confirm: '审批',
  cancel: '取消',
}

const moduleColorMap: Record<string, string> = {
  inbound: 'blue',
  outbound: 'orange',
  purchase: 'purple',
  product: 'green',
  stock_transfer: 'magenta',
}

const actionColorMap: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  confirm: 'cyan',
  cancel: 'default',
}

const moduleOptions = [
  { label: '全部', value: '' },
  { label: '入库管理', value: 'inbound' },
  { label: '出库管理', value: 'outbound' },
  { label: '采购管理', value: 'purchase' },
  { label: '产品管理', value: 'product' },
  { label: '挪货管理', value: 'stock_transfer' },
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

  const renderJson = (data: any) => {
    if (data === null || data === undefined) {
      return <Text type="secondary">无数据</Text>
    }
    try {
      const formatted = typeof data === 'string' ? JSON.stringify(JSON.parse(data), null, 2) : JSON.stringify(data, null, 2)
      return (
        <pre
          style={{
            background: currentTheme.primaryBg,
            padding: '12px 16px',
            borderRadius: 6,
            maxHeight: 300,
            overflow: 'auto',
            fontSize: 13,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {formatted}
        </pre>
      )
    } catch {
      return (
        <pre
          style={{
            background: currentTheme.primaryBg,
            padding: '12px 16px',
            borderRadius: 6,
            maxHeight: 300,
            overflow: 'auto',
            fontSize: 13,
            margin: 0,
          }}
        >
          {String(data)}
        </pre>
      )
    }
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
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
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
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 16 }}
        styles={{ body: { flex: 1, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={false}
          tableLayout="fixed"
          sticky={{ offsetHeader: 0 }}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => showDetail(record),
          })}
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
              {renderJson(selectedLog.before_data)}
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>变更后数据</Text>
              {renderJson(selectedLog.after_data)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default OperationLogs
