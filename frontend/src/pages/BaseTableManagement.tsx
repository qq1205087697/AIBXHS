import React, { useState, useEffect } from 'react'
import { Card, Table, Input, Select, message, Space, Tag, Pagination, Statistic, Spin, Empty, Typography, Tooltip } from 'antd'
import { SearchOutlined, DatabaseOutlined, ShoppingCartOutlined, CheckSquareOutlined, WarningOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { baseTableApi } from '../api'

const { Text } = Typography

// 表头在纵向滚动容器内吸附固定
const tableScrollStyle = `
  .base-table-scroll .ant-table-content {
    overflow: visible !important;
  }
  .base-table-scroll .ant-table-thead > tr > th {
    position: sticky !important;
    top: 0;
    z-index: 2;
  }
  .base-table-scroll::-webkit-scrollbar {
    width: 8px;
  }
  .base-table-scroll::-webkit-scrollbar-thumb {
    background: #d9d9d9;
    border-radius: 4px;
  }
`

interface GroupQty {
  name: string
  qty: number
}

interface BaseTableItem {
  product_id: number
  product_code: string
  name: string
  product_type: string
  in_stock_qty: number
  to_purchase_qty: number
  to_inbound_qty: number
  need_sku?: boolean
  in_stock_groups: GroupQty[]
  to_purchase_groups: GroupQty[]
  to_inbound_groups: GroupQty[]
}

interface WarehouseStock {
  store_group_name: string
  warehouse: string
  qty: number
}

interface ReplenishmentDetail {
  order_id: number
  order_number: string
  store_group_name: string
  status: string
  pending_qty: number
}

interface PurchaseDetail {
  order_id: number
  order_number: string
  store_group_name: string
  supplier: string
  warehouse: string
  status: string
  pending_qty: number
}

interface ProductDetail {
  warehouses?: WarehouseStock[]
  replenishments?: ReplenishmentDetail[]
  purchases?: PurchaseDetail[]
}

const replenishStatusLabel: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
}

const replenishStatusColor: Record<string, string> = {
  pending: 'processing',
  approved: 'blue',
}

const purchaseStatusLabel: Record<string, string> = {
  draft: '待审批',  // 草稿即待审批（转采购单后初始状态，审批通过变为已审批）
  pending: '待审批',
  approved: '已审批',
  purchased: '已采购',
  partial_received: '部分收货',
  pending_reshipment: '待补发',
}

const purchaseStatusColor: Record<string, string> = {
  draft: 'gold',
  pending: 'gold',
  approved: 'blue',
  purchased: 'geekblue',
  partial_received: 'orange',
  pending_reshipment: 'purple',
}

const issueOptions = [
  { label: '全部产品', value: 'all' },
  { label: '有库存', value: 'in_stock' },
  { label: '补货未采购', value: 'to_purchase' },
  { label: '采购未入库', value: 'to_inbound' },
  { label: '任一在途', value: 'any_pending' },
  { label: '缺平台SKU', value: 'no_sku' },
]

const productTypeOptions = [
  { label: '全部类型', value: '' },
  { label: '成品', value: 'finished' },
  { label: '配件', value: 'accessory' },
]

const BaseTableManagement: React.FC = () => {
  const [items, setItems] = useState<BaseTableItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState<{
    page: number
    pageSize: number
    issue: string
    keyword: string
    product_type: string
    sort_by?: string
    sort_order?: string
  }>({ page: 1, pageSize: 20, issue: 'all', keyword: '', product_type: '' })
  const [total, setTotal] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [stats, setStats] = useState({ in_stock_total: 0, to_purchase_total: 0, to_inbound_total: 0, no_sku_total: 0 })
  const [expandedKeys, setExpandedKeys] = useState<number[]>([])
  const [detailMap, setDetailMap] = useState<Record<number, ProductDetail>>({})
  const [detailLoadingKeys, setDetailLoadingKeys] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await baseTableApi.getSummary({
          page: query.page,
          page_size: query.pageSize,
          issue: query.issue,
          keyword: query.keyword || undefined,
          product_type: query.product_type || undefined,
          sort_by: query.sort_by || undefined,
          sort_order: query.sort_order,
        })
        if (cancelled) return
        if (res.data.success) {
          setItems(res.data.data.items || [])
          setStats(res.data.data.stats || { in_stock_total: 0, to_purchase_total: 0, to_inbound_total: 0, no_sku_total: 0 })
          setTotal(res.data.data.total || 0)
        }
      } catch (err: any) {
        if (!cancelled) message.error(err?.response?.data?.detail || '获取底表数据失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [query])

  const loadDetail = async (productId: number) => {
    if (detailMap[productId] || detailLoadingKeys.includes(productId)) return
    setDetailLoadingKeys(prev => [...prev, productId])
    try {
      const [whRes, repRes, purRes] = await Promise.all([
        baseTableApi.getProductWarehouses(productId),
        baseTableApi.getProductReplenishmentOrders(productId),
        baseTableApi.getProductPurchaseOrders(productId),
      ])
      setDetailMap(prev => ({
        ...prev,
        [productId]: {
          warehouses: whRes.data.data || [],
          replenishments: repRes.data.data || [],
          purchases: purRes.data.data || [],
        },
      }))
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '获取明细失败')
    } finally {
      setDetailLoadingKeys(prev => prev.filter(k => k !== productId))
    }
  }

  const handleExpand = (expanded: boolean, record: BaseTableItem) => {
    setExpandedKeys(prev => (expanded ? [...prev, record.product_id] : prev.filter(k => k !== record.product_id)))
    if (expanded) loadDetail(record.product_id)
  }

  const handleSearch = (value: string) => {
    setSearchText(value)
    setQuery(prev => (prev.keyword === value && prev.page === 1 ? prev : { ...prev, keyword: value, page: 1 }))
  }

  const handleIssueChange = (value: string) => {
    setQuery(prev => (prev.issue === value && prev.page === 1 ? prev : { ...prev, issue: value, page: 1 }))
  }

  const handleProductTypeChange = (value: string) => {
    setQuery(prev => (prev.product_type === value && prev.page === 1 ? prev : { ...prev, product_type: value, page: 1 }))
  }

  const renderOrderNumber = (text: string) => (
    <span style={{ color: '#1890ff', cursor: 'pointer' }}>{text}</span>
  )

  // 状态列：按店铺分组显示数量标签，如 [B欧: 600] [C英: 300]
  const renderGroupQtyCell = (qty: number, groups: GroupQty[] | undefined, color: string) => {
    if (qty <= 0) {
      return <Text style={{ fontSize: 13, color: '#999' }}>0</Text>
    }
    if (!groups || groups.length === 0) {
      return <Text style={{ fontSize: 13, fontWeight: 'bold' }}>{qty}</Text>
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
        {groups.map((g) => (
          <Tag key={g.name} color={color} style={{ fontSize: 12, margin: 0 }}>
            {g.name}: {g.qty}
          </Tag>
        ))}
      </div>
    )
  }

  const renderDetailSection = (record: BaseTableItem) => {
    const detail = detailMap[record.product_id]
    if (!detail) {
      return (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {record.in_stock_qty > 0 && (
          <div style={{ width: 280 }}>
            <Text strong style={{ fontSize: 13 }}>库存分布（店铺分组 / 仓库）</Text>
            {detail.warehouses && detail.warehouses.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                {detail.warehouses.map((w, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}>
                    <Text style={{ fontSize: 12 }}>
                      {w.store_group_name}
                      <Text type="secondary" style={{ fontSize: 12 }}> / {w.warehouse}</Text>
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{w.qty}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无数据</Text></div>
            )}
          </div>
        )}
        {record.to_purchase_qty > 0 && (
          <div style={{ width: 340 }}>
            <Text strong style={{ fontSize: 13 }}>补货未采购明细</Text>
            {detail.replenishments && detail.replenishments.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                {detail.replenishments.map((r) => (
                  <div key={r.order_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}>
                    {renderOrderNumber(r.order_number)}
                    <Text type="secondary" style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                      {r.store_group_name}
                    </Text>
                    <Tag color={replenishStatusColor[r.status] || 'default'} style={{ fontSize: 11 }}>
                      {replenishStatusLabel[r.status] || r.status}
                    </Tag>
                    <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{r.pending_qty}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无数据</Text></div>
            )}
          </div>
        )}
        {record.to_inbound_qty > 0 && (
          <div style={{ width: 420 }}>
            <Text strong style={{ fontSize: 13 }}>采购未入库明细</Text>
            {detail.purchases && detail.purchases.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                {detail.purchases.map((p) => (
                  <div key={p.order_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}>
                    {renderOrderNumber(p.order_number)}
                    <Text type="secondary" style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.store_group_name}{p.supplier ? ` / ${p.supplier}` : ''}{p.warehouse ? ` / ${p.warehouse}` : ''}
                    </Text>
                    <Tag color={purchaseStatusColor[p.status] || 'default'} style={{ fontSize: 11 }}>
                      {purchaseStatusLabel[p.status] || p.status}
                    </Tag>
                    <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{p.pending_qty}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无数据</Text></div>
            )}
          </div>
        )}
      </div>
    )
  }

  const columns: ColumnsType<BaseTableItem> = [
    {
      title: '产品编码',
      dataIndex: 'product_code',
      key: 'product_code',
      width: 150,
      align: 'center',
      sorter: true,
      render: (text: string) => <Text strong style={{ fontSize: 13 }}>{text}</Text>,
    },
    {
      title: '产品名称',
      dataIndex: 'name',
      key: 'name',
      minWidth: 200,
      align: 'center',
      ellipsis: true,
      render: (text: string, record: BaseTableItem) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <span title={text} style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
          {record.need_sku && (
            <Tooltip title="该商品有库存但无平台SKU，请通知仓库在商品详情中添加平台信息">
              <Tag color="red" style={{ fontSize: 12, margin: 0, flexShrink: 0 }}>缺平台SKU</Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'product_type',
      key: 'product_type',
      width: 90,
      align: 'center',
      render: (type: string) => (
        <Tag color={type === 'accessory' ? 'cyan' : 'geekblue'} style={{ fontSize: 12 }}>
          {type === 'accessory' ? '配件' : '成品'}
        </Tag>
      ),
    },
    {
      title: '已入库',
      dataIndex: 'in_stock_qty',
      key: 'in_stock_qty',
      width: 150,
      align: 'center',
      sorter: true,
      render: (qty: number, record: BaseTableItem) => renderGroupQtyCell(qty, record.in_stock_groups, 'green'),
    },
    {
      title: '补货未采购',
      dataIndex: 'to_purchase_qty',
      key: 'to_purchase_qty',
      width: 160,
      align: 'center',
      sorter: true,
      render: (qty: number, record: BaseTableItem) => renderGroupQtyCell(qty, record.to_purchase_groups, 'orange'),
    },
    {
      title: '采购未入库',
      dataIndex: 'to_inbound_qty',
      key: 'to_inbound_qty',
      width: 160,
      align: 'center',
      sorter: true,
      render: (qty: number, record: BaseTableItem) => renderGroupQtyCell(qty, record.to_inbound_groups, 'blue'),
    },
    {
      title: '总计',
      dataIndex: 'total_qty',
      key: 'total_qty',
      width: 110,
      align: 'center',
      sorter: true,
      render: (_: any, record: BaseTableItem) => {
        const total = record.in_stock_qty + record.to_purchase_qty + record.to_inbound_qty
        return <Text strong style={{ fontSize: 13, color: total > 0 ? '#262626' : '#bfbfbf' }}>{total}</Text>
      },
    },
  ]

  // 统计卡片定义：点击直接筛选对应类别，再次点击取消筛选
  const statCards: { title: string; value: number; color: string; icon: React.ReactNode; issue: string }[] = [
    { title: '已入库总量', value: stats.in_stock_total, color: '#52c41a', icon: <DatabaseOutlined />, issue: 'in_stock' },
    { title: '补货未采购总量', value: stats.to_purchase_total, color: '#fa8c16', icon: <CheckSquareOutlined />, issue: 'to_purchase' },
    { title: '采购未入库总量', value: stats.to_inbound_total, color: '#1890ff', icon: <ShoppingCartOutlined />, issue: 'to_inbound' },
    { title: '平台信息缺失', value: stats.no_sku_total, color: '#ff4d4f', icon: <WarningOutlined />, issue: 'no_sku' },
  ]

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{tableScrollStyle}</style>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        {statCards.map((c) => {
          const active = query.issue === c.issue
          return (
            <Card
              key={c.issue}
              style={{
                flex: 1,
                cursor: 'pointer',
                borderColor: active ? c.color : undefined,
                borderWidth: active ? 2 : 1,
                transition: 'box-shadow 0.2s',
              }}
              styles={{ body: { padding: '12px 24px' } }}
              onClick={() => setQuery(prev => ({ ...prev, issue: prev.issue === c.issue ? 'all' : c.issue, page: 1 }))}
              hoverable
            >
              <Statistic title={c.title} value={c.value} valueStyle={{ color: c.color }} prefix={c.icon} />
            </Card>
          )
        })}
      </div>

      <Card
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 16 }}
        styles={{ body: { flex: 1, minHeight: 0, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
        title={
          <Space wrap size="middle">
            <Input
              placeholder="搜索产品编码、名称（回车搜索）"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 240 }}
              value={searchText}
              onChange={(e) => {
                const v = e.target.value
                setSearchText(v)
                if (v === '') handleSearch('')
              }}
              onPressEnter={(e) => handleSearch((e.target as HTMLInputElement).value)}
            />
            <Select
              value={query.issue}
              style={{ width: 140 }}
              options={issueOptions}
              onChange={handleIssueChange}
            />
            <Select
              value={query.product_type}
              style={{ width: 120 }}
              options={productTypeOptions}
              onChange={handleProductTypeChange}
            />
          </Space>
        }
      >
        <div className="base-table-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <Table
            dataSource={items}
            columns={columns}
            rowKey="product_id"
            loading={loading}
            pagination={false}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpand: handleExpand,
              expandedRowRender: (record) => renderDetailSection(record),
              rowExpandable: (record) =>
                record.in_stock_qty > 0 || record.to_purchase_qty > 0 || record.to_inbound_qty > 0,
            }}
            onChange={(_pagination, _filters, sorterObj: any) => {
              setQuery(prev => {
                const nextSorter = sorterObj && sorterObj.field && sorterObj.order
                  ? {
                      sort_by: sorterObj.field as string,
                      sort_order: sorterObj.order === 'ascend' ? 'asc' : 'desc',
                    }
                  : { sort_by: undefined, sort_order: undefined }
                if (prev.sort_by === nextSorter.sort_by && prev.sort_order === nextSorter.sort_order && prev.page === 1) {
                  return prev
                }
                return { ...prev, ...nextSorter, page: 1 }
              })
            }}
            locale={{
              emptyText: <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </div>
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8 }}>
        <Pagination
          current={query.page}
          pageSize={query.pageSize}
          total={total}
          showSizeChanger
          showQuickJumper
          showTotal={(t) => `共 ${t} 条`}
          onChange={(page, pageSize) =>
            setQuery(prev =>
              prev.page === page && prev.pageSize === pageSize
                ? prev
                : { ...prev, page, pageSize: pageSize || 20 },
            )
          }
        />
      </div>
    </div>
  )
}

export default BaseTableManagement
