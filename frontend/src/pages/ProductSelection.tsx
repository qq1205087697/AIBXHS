import React, { useState, useEffect, useMemo } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, message, Popconfirm, Space, Tag, Alert,
  InputNumber, Tooltip, Progress, Statistic, Row, Col, Typography, Drawer, Descriptions, Image, Dropdown
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined,
  RobotOutlined, EyeOutlined, ThunderboltOutlined, BarChartOutlined,
  AlertOutlined, RiseOutlined, StarOutlined, StarFilled, FireOutlined, MoreOutlined, QuestionCircleOutlined, ReloadOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { productSelectionApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'

const { Text, Title } = Typography

interface ProductSelectionItem {
  id: number
  tenant_id: number
  product_title: string
  url: string
  asin: string
  image_url: string
  rating: number | null
  review_count: number | null
  keywords: string
  price: number | null
  commission: number | null
  first_leg_cost: number | null
  last_mile_cost: number | null
  weight_kg: number | null
  cost_at_15_profit: number | null
  product_type: string
  site: string
  monthly_sales: number | null
  traffic_trend: string
  seasonality: string
  infringement_analysis: string
  traffic_score: number | null
  sales_score: number | null
  rating_score: number | null
  penalty_factor: number | null
  composite_score: number | null
  created_at: string
  updated_at: string
}

const getScoreColor = (score: number | null, max: number = 100): string => {
  if (score === null) return '#d9d9d9'
  const ratio = score / max
  if (ratio >= 0.8) return '#52c41a'
  if (ratio >= 0.6) return '#faad14'
  return '#ff4d4f'
}

const getScoreTag = (score: number | null, label: string, max: number = 100) => {
  if (score === null) return <Tag color="default">-</Tag>
  const ratio = score / max
  return (
    <Tooltip title={label}>
      <Tag color={ratio >= 0.8 ? 'success' : ratio >= 0.6 ? 'warning' : 'error'}>
        {score.toFixed(1)}
      </Tag>
    </Tooltip>
  )
}

const ProductSelection: React.FC = () => {
  const { currentTheme } = useTheme()
  const [items, setItems] = useState<ProductSelectionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set())
  const [recalcing, setRecalcing] = useState(false)
  const [analyzeModal, setAnalyzeModal] = useState<{
    open: boolean;
    mode: 'single' | 'batch';
    targetId?: number;
    targetItem?: ProductSelectionItem | null;
    targetIds?: number[];
    targetItems?: ProductSelectionItem[];
  }>({ open: false, mode: 'single', targetItems: [] })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ProductSelectionItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<ProductSelectionItem | null>(null)
  const [chartHover, setChartHover] = useState<{ x: number; y: number; month: string; value: number; rect: DOMRect | null } | null>(null)
  const [form] = Form.useForm()
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [typeOptions, setTypeOptions] = useState<{ label: string; value: string }[]>([])
  const [dateOptions, setDateOptions] = useState<{ label: string; value: string }[]>([])
  const [siteOptions, setSiteOptions] = useState<{ label: string; value: string }[]>([])
  const [searchText, setSearchText] = useState('')
  const [datesInitialized, setDatesInitialized] = useState(false)
  const [productTypeFilter, setProductTypeFilter] = useState<string | undefined>(undefined)
  const [siteFilter, setSiteFilter] = useState<string | undefined>(undefined)
  const [dateFilter, setDateFilter] = useState<string | undefined>(undefined)
  const [localSort, setLocalSort] = useState<{ field: string | null; order: 'ascend' | 'descend' | null }>({
    field: null, order: null,
  })
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  useEffect(() => {
    fetchData()
    fetchTypes()
    fetchDates()
    fetchSites()
  }, [pagination.current, pagination.pageSize, searchText, productTypeFilter, siteFilter, dateFilter])

  const fetchTypes = async () => {
    try {
      const res = await productSelectionApi.getTypes()
      if (res.data.success) {
        const types: string[] = res.data.data
        setTypeOptions(types.map(t => ({ label: t, value: t })))
      }
    } catch {}
  }

  const fetchDates = async () => {
    try {
      const res = await productSelectionApi.getDates()
      if (res.data.success) {
        const dates: string[] = res.data.data
        setDateOptions(dates.map(d => ({ label: d, value: d })))
        // 仅首次加载时默认选中最新日期
        if (dates.length > 0 && !datesInitialized) {
          setDateFilter(dates[0])
          setDatesInitialized(true)
        }
      }
    } catch {}
  }

  const fetchSites = async () => {
    try {
      const res = await productSelectionApi.getSites()
      if (res.data.success) {
        const sites: string[] = res.data.data
        setSiteOptions(sites.map(s => ({ label: s, value: s })))
      }
    } catch {}
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await productSelectionApi.getList({
        page: pagination.current,
        page_size: pagination.pageSize,
        search: searchText || undefined,
        product_type: productTypeFilter,
        site: siteFilter,
        date_filter: dateFilter,
      })
      if (res.data.success) {
        setItems(res.data.data)
        setPagination(prev => ({ ...prev, total: res.data.total }))
      }
    } catch (e) {
      message.error('获取数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearchText(value)
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleReset = () => {
    setSearchText('')
    setProductTypeFilter(undefined)
    setSiteFilter(undefined)
    setDateFilter(undefined)
    setLocalSort({ field: null, order: null })
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  // 前端排序：纯内存操作，不请求后端
  const sortedItems = useMemo(() => {
    if (!localSort.field || !localSort.order) return items
    return [...items].sort((a, b) => {
      const av = (a as any)[localSort.field!]
      const bv = (b as any)[localSort.field!]
      if (av == null && bv == null) return 0
      if (av == null) return localSort.order === 'ascend' ? -1 : 1
      if (bv == null) return localSort.order === 'ascend' ? 1 : -1
      if (typeof av === 'string' && typeof bv === 'string') {
        return localSort.order === 'ascend' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const an = Number(av) || 0
      const bn = Number(bv) || 0
      return localSort.order === 'ascend' ? an - bn : bn - an
    })
  }, [items, localSort])

  const handleCreate = () => {
    setEditingItem(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleEdit = (item: ProductSelectionItem) => {
    setEditingItem(item)
    form.setFieldsValue({
      product_title: item.product_title,
      url: item.url || '',
      asin: item.asin || '',
      image_url: item.image_url || '',
      rating: item.rating,
      review_count: item.review_count,
      keywords: item.keywords || '',
      price: item.price,
      commission: item.commission,
      first_leg_cost: item.first_leg_cost,
      last_mile_cost: item.last_mile_cost,
      weight_kg: item.weight_kg,
      cost_at_15_profit: item.cost_at_15_profit,
      product_type: item.product_type || undefined,
      monthly_sales: item.monthly_sales,
      traffic_trend: item.traffic_trend || '',
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingItem) {
        await productSelectionApi.update(editingItem.id, values)
        message.success('更新成功')
      } else {
        await productSelectionApi.create(values)
        message.success('创建成功')
      }
      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.response?.data?.detail) {
        message.error(e.response.data.detail)
      } else if (!e.errorFields) {
        message.error('操作失败')
      }
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await productSelectionApi.delete(id)
      message.success('删除成功')
      fetchData()
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleAnalyze = (id: number) => {
    const item = items.find(i => i.id === id)
    setAnalyzeModal({ open: true, mode: 'single', targetId: id, targetItem: item || null })
  }

  const handleBatchAnalyze = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要分析的产品')
      return
    }
    const ids = selectedRowKeys as number[]
    const targetItems = items.filter(i => ids.includes(i.id))
    setAnalyzeModal({ open: true, mode: 'batch', targetIds: ids, targetItems })
  }

  // 执行单条AI分析
  const doSingleAnalyze = async () => {
    if (!analyzeModal.targetId) return
    const id = analyzeModal.targetId
    setAnalyzingIds(prev => new Set(prev).add(id))
    setAnalyzeModal(prev => ({ ...prev, open: false }))
    try {
      const res = await productSelectionApi.analyze(id)
      if (res.data.success) {
        message.success('AI分析完成')
        fetchData()
      } else {
        message.error('AI分析失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'AI分析失败')
    } finally {
      setAnalyzingIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  // 执行批量AI分析（可跳过已分析的）
  const doBatchAnalyze = async (skipExisting: boolean = false) => {
    if (!analyzeModal.targetIds?.length) return
    let ids = analyzeModal.targetIds
    if (skipExisting) {
      ids = ids.filter(id => {
        const item = analyzeModal.targetItems?.find(i => i.id === id)
        return !(item?.seasonality || item?.infringement_analysis)
      })
      if (ids.length === 0) {
        message.info('所有选中的产品都已进行过AI分析')
        setAnalyzeModal(prev => ({ ...prev, open: false }))
        return
      }
    }
    setAnalyzingIds(new Set(ids))
    setAnalyzeModal(prev => ({ ...prev, open: false }))
    try {
      const res = await productSelectionApi.batchAnalyze(ids)
      if (res.data.success) {
        const successCount = res.data.data.filter((d: any) => d.success).length
        message.success(`批量分析完成，成功 ${successCount}/${res.data.data.length} 条`)
        setSelectedRowKeys([])
        fetchData()
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '批量分析失败')
    } finally {
      setAnalyzingIds(new Set())
    }
  }

  // 详情抽屉内的分析按钮也走弹窗确认
  const handleDetailAnalyze = () => {
    if (!detailItem) return
    setAnalyzeModal({ open: true, mode: 'single', targetId: detailItem.id, targetItem: detailItem })
  }

  const handleRecalcScores = async () => {
    setRecalcing(true)
    try {
      const res = await productSelectionApi.recalcScores()
      if (res.data.success) {
        message.success(`重新计算完成，共 ${res.data.data} 条记录`)
        fetchData()
      } else {
        message.error('重新计算失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '重新计算失败')
    } finally {
      setRecalcing(false)
    }
  }

  const handleViewDetail = (item: ProductSelectionItem) => {
    setDetailItem(item)
    setDetailOpen(true)
  }

  const columns: ColumnsType<ProductSelectionItem> = [
    {
      title: '产品标题',
      dataIndex: 'product_title',
      key: 'product_title',
      width: 220,
      fixed: 'left',
      sorter: true,
      render: (text: string, record: ProductSelectionItem) => (
        <Tooltip
          placement="right"
          overlayStyle={{ maxWidth: 360, fontSize: 13 }}
          title={
            <div style={{ padding: 4 }}>
              <div style={{ color: '#fff', lineHeight: 1.6 }}>{text}</div>
            </div>
          }
        >
          <a
            onClick={() => handleViewDetail(record)}
            style={{
              color: currentTheme.primary,
              display: 'inline-block',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'middle',
            }}
          >
            {text}
          </a>
        </Tooltip>
      ),
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      key: 'asin',
      width: 110,
      ellipsis: true,
      sorter: true,
    },
    {
      title: '综合评分',
      dataIndex: 'composite_score',
      key: 'composite_score',
      width: 100,
      sorter: true,
      render: (score: number | null) => {
        if (score === null) return <Tag color="default">未分析</Tag>
        return (
          <Progress
            percent={score}
            size="small"
            format={() => score.toFixed(1)}
            strokeColor={getScoreColor(score)}
            style={{ minWidth: 80 }}
          />
        )
      },
    },
    {
      title: '图片',
      dataIndex: 'image_url',
      key: 'image_url',
      width: 70,
      render: (url: string) => url ? (
        <Image
          src={url}
          alt=""
          width={48}
          height={48}
          style={{ objectFit: 'cover', borderRadius: 4 }}
          preview={{ mask: <EyeOutlined /> }}
        />
      ) : '-',
    },
    {
      title: '类型',
      dataIndex: 'product_type',
      key: 'product_type',
      width: 100,
      sorter: true,
      render: (text: string) => text ? <Tag>{text}</Tag> : '-',
    },
    {
      title: '站点',
      dataIndex: 'site',
      key: 'site',
      width: 90,
      sorter: true,
      render: (text: string) => text || '-',
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 90,
      sorter: true,
      render: (price: number | null) => price != null ? `$${price.toFixed(2)}` : '-',
    },
    {
      title: '佣金',
      dataIndex: 'commission',
      key: 'commission',
      width: 80,
      sorter: true,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '头程',
      dataIndex: 'first_leg_cost',
      key: 'first_leg_cost',
      width: 80,
      sorter: true,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '尾程',
      dataIndex: 'last_mile_cost',
      key: 'last_mile_cost',
      width: 80,
      sorter: true,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '重量(kg)',
      dataIndex: 'weight_kg',
      key: 'weight_kg',
      width: 85,
      sorter: true,
      render: (val: number | null) => val != null ? val : '-',
    },
    {
      title: '15%毛利成本',
      dataIndex: 'cost_at_15_profit',
      key: 'cost_at_15_profit',
      width: 110,
      sorter: true,
      render: (val: number | null) => val != null ? `$${val.toFixed(2)}` : '-',
    },
    {
      title: '评分',
      dataIndex: 'rating',
      key: 'rating',
      width: 100,
      sorter: true,
      render: (val: number | null) => {
        if (val == null) return '-'
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            <StarFilled style={{ color: '#faad14', fontSize: 13 }} />
            <span style={{ marginLeft: 4, fontSize: 13 }}>{val}</span>
          </span>
        )
      },
    },
    {
      title: '评论数',
      dataIndex: 'review_count',
      key: 'review_count',
      width: 80,
      sorter: true,
    },
    {
      title: '月销量',
      dataIndex: 'monthly_sales',
      key: 'monthly_sales',
      width: 80,
      sorter: true,
    },
    {
      title: '流量趋势',
      dataIndex: 'traffic_trend',
      key: 'traffic_trend',
      width: 220,
      render: (val: string) => {
        if (!val) return '-'
        let data: Record<string, number | null> | null = null
        try { data = JSON.parse(val.replace(/'/g, '"').replace(/\bNone\b/g, 'null')) } catch {}
        if (!data || typeof data !== 'object') return <span style={{ fontSize: 12 }}>{val}</span>

        // 解析后保留所有月份，处理 None 值
        const entries = Object.entries(data)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => [k, typeof v === 'number' ? v : null] as [string, number | null])

        const validValues = entries.map(([, v]) => v).filter((v): v is number => v != null)
        if (validValues.length === 0) return '-'

        const maxVal = Math.max(...validValues)
        const minVal = Math.min(...validValues)
        const range = maxVal - minVal || 1

        // 折线图参数 - 展示全部数据
        const pointGap = 16
        const padX = 10
        const padY = 4
        const chartH = 36
        const totalW = entries.length * pointGap + padX * 2

        // 生成折线路径和点坐标
        let pathD = ''
        let areaD = ''
        const points: { x: number; y: number; month: string; value: number | null }[] = []

        entries.forEach(([month, value], i) => {
          const x = padX + i * pointGap
          if (value == null) {
            points.push({ x, y: chartH / 2, month, value: null })
            return
          }
          const y = chartH - padY - ((value - minVal) / range) * (chartH - padY * 2)
          points.push({ x, y, month, value })

          if (!pathD) {
            pathD = `M ${x} ${y}`
            areaD = `M ${x} ${chartH} L ${x} ${y}`
          } else {
            // 检查前一个点是否为空值（断开路径）
            const prev = entries[i - 1]
            const prevVal = prev ? prev[1] : null
            if (prevVal == null || typeof prevVal !== 'number') {
              pathD += ` M ${x} ${y}`
              areaD += ` L ${x} ${chartH} M ${x} ${y}`
            } else {
              pathD += ` L ${x} ${y}`
              areaD += ` L ${x} ${y}`
            }
          }
        })
        areaD += ` L ${padX + (entries.length - 1) * pointGap} ${chartH} Z`

        const isLastValid = entries.length > 0 && entries[entries.length - 1][1] != null

        return (
          <Tooltip
            color="#fff"
            title={
              <div style={{ maxWidth: 280, color: '#333' }}>
                <div style={{ marginBottom: 6, fontWeight: 500, borderBottom: '1px solid #eee', paddingBottom: 4 }}>月度流量趋势</div>
                {entries.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', lineHeight: '20px', fontSize: 12 }}>
                    <span>{k}</span>
                    <span style={{ color: v == null ? '#999' : '#1677ff', fontWeight: v == null ? 400 : 500 }}>
                      {v == null ? '无数据' : v.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            }
          >
            <div style={{ display: 'inline-block', lineHeight: 1 }}>
              <svg width={totalW} height={chartH} style={{ verticalAlign: 'middle', overflow: 'visible' }}>
                {/* 渐变填充区域 */}
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1677ff" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#1677ff" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* 面积填充 */}
                <path d={areaD} fill="url(#areaGrad)" />

                {/* 折线 */}
                <path d={pathD} fill="none" stroke="#1677ff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />

                {/* 数据点 */}
                {points.map(({ x, y, month, value }, i) => {
                  if (value == null) {
                    return (
                      <line key={month} x1={x - 3} y1={chartH / 2} x2={x + 3} y2={chartH / 2}
                        stroke="#d9d9d9" strokeWidth={1.5} strokeDasharray="2 2" />
                    )
                  }
                  const isLast = i === points.length - 1
                  return (
                    <g key={month}>
                      <circle cx={x} cy={y} r={isLast ? 3.5 : 2} fill="#fff" stroke="#1677ff" strokeWidth={isLast ? 2 : 1.2} />
                    </g>
                  )
                })}

                {/* 最新数值标签 */}
                {isLastValid && (() => {
                  const lastPoint = points[points.length - 1]
                  const lastEntry = entries[entries.length - 1]
                  const val = lastEntry[1]
                  if (val == null) return null
                  const label = val >= 10000 ? `${(val / 10000).toFixed(1)}w` : String(val)
                  return (
                    <text x={lastPoint.x} y={lastPoint.y - 7} textAnchor="middle" fill="#1677ff" fontSize={9} fontWeight={600}>
                      {label}
                    </text>
                  )
                })()}
              </svg>
            </div>
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_: any, record: ProductSelectionItem) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'analyze',
                  icon: <RobotOutlined />,
                  label: 'AI分析',
                  onClick: () => handleAnalyze(record.id),
                },
                { key: 'edit', icon: <EditOutlined />, label: '编辑', onClick: () => handleEdit(record) },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: (
                    <Popconfirm title="确定删除?" onConfirm={(e) => { e?.stopPropagation(); handleDelete(record.id) }}>
                      <span onClick={e => e.stopPropagation()}>删除</span>
                    </Popconfirm>
                  ),
                  danger: true,
                },
              ],
            }}
            trigger={['click']}
          >
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: () => ({}),
  }

  return (
    <>
      <style>{`
        .ps-table .ant-table-thead > tr > th {
          text-align: center;
        }
      `}</style>
      <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Card
        loading={loading}
        title={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', padding: '4px 0' }}>
            <Space wrap size="middle">
              <Input
                placeholder="搜索ASIN、产品标题、关键词..."
                prefix={<SearchOutlined />}
                allowClear
                style={{ width: 360 }}
                value={searchText}
                onChange={(e) => handleSearch(e.target.value)}
              />
              <Select
                placeholder="产品类型"
                options={typeOptions}
                allowClear
                style={{ width: 140 }}
                value={productTypeFilter}
                onChange={(v) => { setProductTypeFilter(v); setPagination(prev => ({ ...prev, current: 1 })) }}
              />
              <Select
                placeholder="站点"
                options={siteOptions}
                allowClear
                style={{ width: 120 }}
                value={siteFilter}
                onChange={(v) => { setSiteFilter(v); setPagination(prev => ({ ...prev, current: 1 })) }}
              />
              <Select
                placeholder="选品日期"
                options={dateOptions}
                allowClear
                style={{ width: 150 }}
                value={dateFilter}
                onChange={(v) => { setDateFilter(v); setPagination(prev => ({ ...prev, current: 1 })) }}
              />
              <Button onClick={handleReset}>重置</Button>
            </Space>
          </div>
        }
        extra={
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={handleBatchAnalyze}
              loading={analyzingIds.size > 0}
              disabled={selectedRowKeys.length === 0}
              type={selectedRowKeys.length > 0 ? 'primary' : 'default'}
              ghost
            >
              批量AI分析 ({selectedRowKeys.length})
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRecalcScores}
              loading={recalcing}
            >
              重新计算分数
            </Button>
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
          <Table
            className="ps-table"
            rowSelection={rowSelection}
            dataSource={sortedItems}
            columns={columns}
            rowKey="id"
            scroll={{ x: 2200, y: 'calc(100vh - 350px)' }}
            onChange={(pagination, _, sorter) => {
              setPagination(prev => ({ ...prev, current: pagination.current, pageSize: pagination.pageSize || 20 }))
              if (sorter && !Array.isArray(sorter) && sorter.columnKey) {
                setLocalSort({
                  field: sorter.columnKey as string,
                  order: sorter.order as 'ascend' | 'descend' | null,
                })
              } else {
                setLocalSort({ field: null, order: null })
              }
            }}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: total => `共 ${total} 条`,
            }}
            sticky={{ offsetHeader: 0 }}
          />
        </div>
      </Card>

      <Modal
        title={editingItem ? '编辑选品' : '新增选品'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={800}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="product_title"
                label="产品标题"
                rules={[{ required: true, message: '请输入产品标题' }]}
              >
                <Input placeholder="请输入产品标题" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="asin" label="ASIN">
                <Input placeholder="请输入ASIN" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="url" label="URL">
                <Input placeholder="请输入产品URL" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="image_url" label="图片链接">
                <Input placeholder="请输入图片链接" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="price" label="价格">
                <InputNumber style={{ width: '100%' }} placeholder="价格" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="commission" label="佣金">
                <InputNumber style={{ width: '100%' }} placeholder="佣金" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="weight_kg" label="重量(kg)">
                <InputNumber style={{ width: '100%' }} placeholder="重量" min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="first_leg_cost" label="头程">
                <InputNumber style={{ width: '100%' }} placeholder="头程费用" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="last_mile_cost" label="尾程">
                <InputNumber style={{ width: '100%' }} placeholder="尾程费用" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cost_at_15_profit" label="15%毛利时成本">
                <InputNumber style={{ width: '100%' }} placeholder="成本" min={0} precision={2} prefix="$" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="rating" label="评分">
                <InputNumber style={{ width: '100%' }} placeholder="评分" min={0} max={5} precision={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="review_count" label="评论数">
                <InputNumber style={{ width: '100%' }} placeholder="评论数" min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="monthly_sales" label="近一个月销量">
                <InputNumber style={{ width: '100%' }} placeholder="月销量" min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="product_type" label="类型">
                <Select placeholder="选择类型" options={typeOptions} allowClear />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="traffic_trend" label="流量趋势">
                <Input placeholder="如：上升、下降、平稳" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="keywords" label="关键词">
                <Input placeholder="请输入关键词" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Drawer
        title="选品详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={860}
      >
        {detailItem && (
          <div>
            <Title level={4} style={{ marginBottom: 8 }}>{detailItem.product_title}</Title>
            {detailItem.image_url && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <Image
                  src={detailItem.image_url}
                  alt={detailItem.product_title}
                  style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, objectFit: 'contain' }}
                  preview
                />
              </div>
            )}

            <Descriptions bordered column={3} size="small" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="ASIN">
                <span style={{ fontFamily: 'monospace', fontSize: 13, whiteSpace: 'nowrap' }}>{detailItem.asin || '-'}</span>
              </Descriptions.Item>
              <Descriptions.Item label="类型">
                {detailItem.product_type ? <Tag>{detailItem.product_type}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="站点">
                {detailItem.site || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="价格">
                {detailItem.price != null ? `$${detailItem.price.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="佣金">
                {detailItem.commission != null ? `$${detailItem.commission.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="头程">
                {detailItem.first_leg_cost != null ? `$${detailItem.first_leg_cost.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="尾程">
                {detailItem.last_mile_cost != null ? `$${detailItem.last_mile_cost.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="重量(kg)">{detailItem.weight_kg ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="15%毛利成本">
                {detailItem.cost_at_15_profit != null ? `$${detailItem.cost_at_15_profit.toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="评分">
                {detailItem.rating != null ? (
                  <span><StarFilled style={{ color: '#faad14' }} /> {detailItem.rating}</span>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="评论数">{detailItem.review_count ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="月销量">{detailItem.monthly_sales ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="关键词" span={3}>
                <Text type="secondary" style={{ fontSize: 12 }}>{detailItem.keywords || '-'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="URL" span={3}>
                {detailItem.url ? (
                  <a href={detailItem.url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all', fontSize: 12 }}>
                    {detailItem.url}
                  </a>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* 流量趋势折线图 - 独立区块 */}
            {(() => {
              const val = detailItem.traffic_trend
              if (!val) return null
              let data: Record<string, number | null> | null = null
              try { data = JSON.parse(val.replace(/'/g, '"').replace(/\bNone\b/g, 'null')) } catch {}
              if (!data || typeof data !== 'object') return null

              const entries = Object.entries(data)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([k, v]) => [k, typeof v === 'number' ? v : null] as [string, number | null])

              const validValues = entries.map(([, v]) => v).filter((v): v is number => v != null)
              if (validValues.length === 0) return null

              const maxVal = Math.max(...validValues)
              const minVal = Math.min(...validValues)
              const range = maxVal - minVal || 1

              // 图表尺寸 - 更高更宽
              const pointGap = 52
              const padX = 30
              const padY = 16
              const leftW = 60 // Y轴区域宽度
              const bottomH = 28 // X轴区域高度
              const chartH = 200
              const chartInnerH = chartH - padY - bottomH
              const totalW = Math.max(700, entries.length * pointGap + padX + leftW + 60)

              let pathD = ''
              let areaD = ''
              const points: { x: number; y: number; month: string; value: number | null }[] = []

              entries.forEach(([month, value], i) => {
                const x = leftW + padX + i * pointGap
                if (value == null) {
                  points.push({ x, y: chartH / 2, month, value: null })
                  return
                }
                const y = padY + chartInnerH - ((value - minVal) / range) * chartInnerH
                points.push({ x, y, month, value })

                if (!pathD) {
                  pathD = `M ${x} ${y}`
                  areaD = `M ${x} ${chartH - bottomH} L ${x} ${y}`
                } else {
                  const prev = entries[i - 1]
                  const prevVal = prev ? prev[1] : null
                  if (prevVal == null || typeof prevVal !== 'number') {
                    pathD += ` M ${x} ${y}`
                    areaD += ` L ${x} ${chartH - bottomH} M ${x} ${y}`
                  } else {
                    pathD += ` L ${x} ${y}`
                    areaD += ` L ${x} ${y}`
                  }
                }
              })
              areaD += ` L ${leftW + padX + (entries.length - 1) * pointGap} ${chartH - bottomH} Z`

              // Y轴刻度（4档）
              const yTicks = [0, 1, 2, 3, 4].map(i => ({
                val: minVal + (range / 4) * i,
                y: padY + chartInnerH - (chartInnerH / 4) * i,
              }))

              // 网格线
              const gridLines = yTicks.slice(0, -1).map(t => t.y)

              const formatNum = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(Math.round(n))

              return (
                <Card size="small" title={<span><RiseOutlined style={{ marginRight: 6 }} />流量趋势</span>} style={{ marginBottom: 16, overflow: 'visible' }}>
                  <div id="detail-chart-container" style={{ position: 'relative', overflow: 'visible' }}>
                    <svg width={totalW} height={chartH} style={{ verticalAlign: 'middle', overflow: 'visible', display: 'block' }}>
                      <defs>
                        <linearGradient id="detailAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1677ff" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="#1677ff" stopOpacity="0.01" />
                        </linearGradient>
                      </defs>

                      {/* 网格线 */}
                      {gridLines.map((gy, i) => (
                        <line key={`g${i}`} x1={leftW} y1={gy} x2={totalW - 10} y2={gy}
                          stroke="#f0f0f0" strokeWidth={1} strokeDasharray="3 3" />
                      ))}

                      {/* X轴基线 */}
                      <line x1={leftW} y1={chartH - bottomH} x2={totalW - 10} y2={chartH - bottomH}
                        stroke="#e8e8e8" strokeWidth={1} />

                      {/* Y轴 */}
                      <line x1={leftW} y1={padY} x2={leftW} y2={chartH - bottomH}
                        stroke="#e8e8e8" strokeWidth={1} />

                      {/* Y轴刻度文字 */}
                      {yTicks.map((t, i) => (
                        <text key={`yt${i}`} x={leftW - 6} y={t.y + 4} textAnchor="end"
                          fill="#999" fontSize={10}>{formatNum(t.val)}</text>
                      ))}

                      {/* X轴月份标签 */}
                      {entries.map(([month], i) => (
                        <text key={`xt${i}`} x={leftW + padX + i * pointGap} y={chartH - bottomH + 14}
                          textAnchor="middle" fill="#999" fontSize={10}>
                          {month}
                        </text>
                      ))}

                      {/* 面积填充 */}
                      <path d={areaD} fill="url(#detailAreaGrad)" />

                      {/* 折线 */}
                      <path d={pathD} fill="none" stroke="#1677ff" strokeWidth={2.5}
                        strokeLinecap="round" strokeLinejoin="round" />

                      {/* 数据点 + hover热区 */}
                      {points.map(({ x, y, month, value }, i) => {
                        if (value == null) {
                          return <line key={month} x1={x - 5} y1={chartH / 2} x2={x + 5} y2={chartH / 2}
                            stroke="#d9d9d9" strokeWidth={2} strokeDasharray="3 3" />
                        }
                        const isLast = i === points.length - 1
                        return (
                          <g key={month}>
                            <circle cx={x} cy={y} r={isLast ? 6 : 4} fill="#fff" stroke="#1677ff"
                              strokeWidth={isLast ? 2.5 : 1.5} />
                            {isLast && (
                              <>
                                <rect x={x - 24} y={y - 26} width={48} height={20} rx={4}
                                  fill="#1677ff" opacity={0.92} />
                                <text x={x} y={y - 12} textAnchor="middle" fill="#fff"
                                  fontSize={10} fontWeight={600}>{formatNum(value)}</text>
                              </>
                            )}
                            <circle cx={x} cy={y} r={18} fill="transparent" style={{ cursor: 'pointer' }}
                              onMouseEnter={() => {
                                const container = document.getElementById('detail-chart-container')
                                setChartHover({ x, y, month, value, rect: container?.getBoundingClientRect() || null })
                              }}
                              onMouseLeave={() => setChartHover(null)}
                            />
                          </g>
                        )
                      })}
                    </svg>

                    {/* fixed定位tooltip - 完全脱离文档流，不被任何容器裁剪 */}
                    {chartHover && chartHover.rect && (
                      <div style={{
                        position: 'fixed',
                        left: chartHover.rect.left + chartHover.x,
                        top: chartHover.rect.top + chartHover.y - 56,
                        transform: 'translateX(-50%)',
                        zIndex: 10000,
                        pointerEvents: 'none',
                      }}>
                        <div style={{
                          background: '#fff',
                          border: '1px solid #e8e8e8',
                          borderRadius: 8,
                          padding: '8px 14px',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                        }}>
                          <div style={{ color: '#666', fontSize: 12, fontWeight: 500 }}>{chartHover.month}</div>
                          <div style={{ color: '#1677ff', fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                            {chartHover.value.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })()}

            {detailItem.seasonality || detailItem.infringement_analysis ? (
              <>
                <Title level={5}>
                  <BarChartOutlined style={{ marginRight: 8 }} />
                  得分详情
                </Title>
                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title={<>
                          综合评分
                          <Tooltip title={
                            <div style={{ maxWidth: 260 }}>
                              <div><strong>计算公式</strong></div>
                              <div style={{ marginTop: 4 }}>惩罚因子 × 流量评分 × 0.6 + 销量评分 × 5 × 0.4</div>
                              <div style={{ marginTop: 8 }}><strong>满分：100</strong></div>
                              <div>流量权重60%，销量权重40%</div>
                            </div>
                          }><QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} /></Tooltip>
                        </>}
                        value={detailItem.composite_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.composite_score) }}
                        suffix="/100"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title={<>
                          流量评分
                          <Tooltip title={
                            <div style={{ maxWidth: 280 }}>
                              <div><strong>基于流量趋势数据公式计算，满分100</strong></div>
                              <div style={{ marginTop: 6 }}>
                                <div>• 趋势方向强度（25分）：近3月/前3月均值比</div>
                                <div>• 趋势一致性（10分）：近6月上涨月数占比</div>
                                <div>• 相对增长倍数（20分）：最新值/历史最低</div>
                                <div>• 月均增长率（10分）：4个月复合增长率</div>
                                <div>• 趋势连续性（15分）：连续上涨月数阶梯</div>
                                <div>• 波动惩罚（10分）：CV越小分数越高</div>
                              </div>
                            </div>
                          }><QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} /></Tooltip>
                        </>}
                        value={detailItem.traffic_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.traffic_score) }}
                        suffix="/100"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title={<>
                          销量评分
                          <Tooltip title={
                            <div style={{ maxWidth: 240 }}>
                              <div><strong>根据月销量查表得分，满分20</strong></div>
                              <div style={{ marginTop: 6 }}>
                                <div>0件 → 0分 | 1件 → 6分 | 2件 → 9分</div>
                                <div>3-4件 → 12分 | 5-9件 → 15分</div>
                                <div>10-19件 → 18分 | ≥20件 → 20分</div>
                              </div>
                            </div>
                          }><QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} /></Tooltip>
                        </>}
                        value={detailItem.sales_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.sales_score, 20) }}
                        suffix="/20"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title={<>
                          星级评分
                          <Tooltip title={
                            <div style={{ maxWidth: 260 }}>
                              <div><strong>根据产品评分+评论数查表，满分20</strong></div>
                              <div style={{ marginTop: 6 }}>
                                <div>评论≤3条：4.8+→16 | 4.5+→14 | 4.2+→12</div>
                                <div>评论4-10条：4.7+→14 | 4.4+→11 | 4.1+→8</div>
                                <div>评论&gt;10条：4.7+→18 | 4.5+→15 | 4.3+→12 | 4.0+→9</div>
                                <div>无评分时默认20分</div>
                              </div>
                            </div>
                          }><QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} /></Tooltip>
                        </>}
                        value={detailItem.rating_score ?? 0}
                        precision={1}
                        valueStyle={{ color: getScoreColor(detailItem.rating_score, 20) }}
                        suffix="/20"
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic
                        title={<>
                          惩罚因子
                          <Tooltip title={
                            <div style={{ maxWidth: 240 }}>
                              <div><strong>根据星级评分阶梯取值，范围0.50~1.00</strong></div>
                              <div style={{ marginTop: 6 }}>
                                <div>星级≥16 → 1.00（无惩罚）</div>
                                <div>星级≥12 → 0.95（轻微）</div>
                                <div>星级≥8 → 0.85（中等）</div>
                                <div>星级≥4 → 0.70（较重）</div>
                                <div>星级&lt;4 → 0.50（严重）</div>
                              </div>
                              <div style={{ marginTop: 6 }}>乘以综合评分中的流量部分</div>
                            </div>
                          }><QuestionCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 12 }} /></Tooltip>
                        </>}
                        value={detailItem.penalty_factor ?? 0}
                        precision={2}
                        valueStyle={{ color: detailItem.penalty_factor && detailItem.penalty_factor > 1 ? '#ff4d4f' : '#52c41a' }}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card size="small" title={<span><AlertOutlined /> 季节性判断</span>} style={{ marginBottom: 12 }}>
                  {(() => {
                    try {
                      const seasData = typeof detailItem.seasonality === 'string'
                        ? JSON.parse(detailItem.seasonality)
                        : detailItem.seasonality
                      if (seasData && typeof seasData === 'object') {
                        return (
                          <div>
                            <div style={{ marginBottom: 8, display: 'flex', gap: 16 }}>
                              <Tag color={seasData['是否季节性'] === '是' ? 'blue' : 'default'}>
                                {seasData['是否季节性'] || '-'}
                              </Tag>
                              <span>强度：<strong>{seasData['季节性强度'] || '-'}</strong></span>
                            </div>
                            {seasData['高峰期']?.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                高峰期：
                                {seasData['高峰期'].map((m: string, i: number) => (
                                  <Tag key={i} color="processing" style={{ marginLeft: 4 }}>{m}</Tag>
                                ))}
                              </div>
                            )}
                            {seasData['分析理由'] && (
                              <Text type="secondary" style={{ fontSize: 13 }}>{seasData['分析理由']}</Text>
                            )}
                          </div>
                        )
                      }
                    } catch {}
                    return <Text>{detailItem.seasonality || '-'}</Text>
                  })()}
                </Card>

                <Card size="small" title={<span><AlertOutlined /> 侵权分析</span>} style={{ marginBottom: 0 }}>
                  {(() => {
                    try {
                      const infrData = typeof detailItem.infringement_analysis === 'string'
                        ? JSON.parse(detailItem.infringement_analysis)
                        : detailItem.infringement_analysis
                      if (infrData && typeof infrData === 'object') {
                        return (
                          <div>
                            <div style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
                              <Tag color={infrData['总体风险等级'] === '低' ? 'green' : infrData['总体风险等级'] === '高' ? 'red' : 'orange'}>
                                风险等级：{infrData['总体风险等级']}
                              </Tag>
                              <span>评分：<strong>{infrData['总体风险评分']}</strong>/100</span>
                            </div>
                            {infrData['侵权类型分析'] && Object.entries(infrData['侵权类型分析']).map(([type, info]: [string, any]) => {
                              const riskColor = (info?.风险评分 || 0) >= 70 ? 'red' : (info?.风险评分 || 0) >= 40 ? 'orange' : 'green'
                              return (
                                <div key={type} style={{
                                  marginBottom: 8, padding: '8px 12px',
                                  background: '#fafafa', borderRadius: 6, borderLeft: `3px solid ${riskColor === 'red' ? '#ff4d4f' : riskColor === 'orange' ? '#faad14' : '#52c41a'}`
                                }}>
                                  <div style={{ fontWeight: 500, marginBottom: 4 }}>
                                    {type}
                                    <Tag color={riskColor} style={{ marginLeft: 8 }}>{info?.是否可能侵权}</Tag>
                                    <span style={{ marginLeft: 8, fontSize: 13 }}>评分: {info?.风险评分}</span>
                                  </div>
                                  {info?.证据?.length > 0 && (
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#666' }}>
                                      {info.证据.map((e: string, i: number) => <li key={i}>{e}</li>)}
                                    </ul>
                                  )}
                                </div>
                              )
                            })}
                            {infrData['最终结论总结'] && (
                              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591' }}>
                                <strong>结论：</strong>{infrData['最终结论总结']}
                              </div>
                            )}
                          </div>
                        )
                      }
                    } catch {}
                    return <Text>{detailItem.infringement_analysis || '-'}</Text>
                  })()}
                </Card>
              </>
            ) : (
              <Card style={{ textAlign: 'center', padding: 48 }}>
                <RobotOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
                <br />
                <Text type="secondary">暂未进行AI分析</Text>
                <br />
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  onClick={() => {
                    setDetailOpen(false)
                    handleDetailAnalyze()
                  }}
                  style={{ marginTop: 16 }}
                  loading={analyzingIds.has(detailItem.id)}
                >
                  开始AI分析
                </Button>
              </Card>
            )}

            <div style={{ marginTop: 16, color: '#999', fontSize: 12 }}>
              创建时间：{detailItem.created_at}
            </div>
          </div>
        )}
      </Drawer>

      {/* AI分析确认弹窗 */}
      <Modal
        title={analyzeModal.mode === 'batch' ? '批量AI分析' : 'AI分析确认'}
        open={analyzeModal.open}
        onCancel={() => setAnalyzeModal(prev => ({ ...prev, open: false }))}
        footer={null}
        width={520}
        destroyOnHidden
      >
        {analyzeModal.mode === 'single' && analyzeModal.targetItem && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>产品：</Text>
              <Text>{analyzeModal.targetItem.product_title || analyzeModal.targetItem.asin}</Text>
            </div>

            {(analyzeModal.targetItem.seasonality || analyzeModal.targetItem.infringement_analysis) && (
              <Alert
                message="该产品已存在AI分析数据（侵权分析 + 季节性分析），重新分析将覆盖原有结果"
                type="warning"
                showIcon
                style={{ marginBottom: 20 }}
              />
            )}

            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <Space>
                <Button onClick={() => setAnalyzeModal(prev => ({ ...prev, open: false }))}>取消</Button>
                <Button type="primary" icon={<RobotOutlined />} loading={analyzingIds.has(analyzeModal.targetId!)} onClick={doSingleAnalyze}>
                  确认分析
                </Button>
              </Space>
            </div>
          </div>
        )}

        {analyzeModal.mode === 'batch' && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text>已选择 <Text strong>{analyzeModal.targetIds?.length}</Text> 条产品进行AI分析</Text>
            </div>

            {/* 统计已分析/未分析数量 */}
            {analyzeModal.targetItems && (() => {
              const analyzed = analyzeModal.targetItems!.filter(i => i.seasonality || i.infringement_analysis).length
              const unanalyzed = (analyzeModal.targetItems?.length || 0) - analyzed
              return (
                <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                  <Tag color="green">已分析：{analyzed}</Tag>
                  <Tag color="blue">未分析：{unanalyzed}</Tag>
                </div>
              )
            })()}

            {(analyzeModal.targetItems?.some(i => i.seasonality || i.infringement_analysis)) && (
              <Alert
                message={`其中 ${analyzeModal.targetItems?.filter(i => i.seasonality || i.infringement_analysis).length} 条已有AI分析数据`}
                description="可选择「跳过已分析的」仅对未分析的产品执行"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <div style={{ textAlign: 'right', marginTop: 20 }}>
              <Space>
                <Button onClick={() => setAnalyzeModal(prev => ({ ...prev, open: false }))}>取消</Button>
                {analyzeModal.targetItems?.some(i => i.seasonality || i.infringement_analysis) && (
                  <Button icon={<RobotOutlined />} loading={analyzingIds.size > 0} onClick={() => doBatchAnalyze(true)}>
                    跳过已分析的
                  </Button>
                )}
                <Button type="primary" icon={<RobotOutlined />} loading={analyzingIds.size > 0} onClick={() => doBatchAnalyze(false)}>
                  全部重新分析
                </Button>
              </Space>
            </div>
          </div>
        )}
      </Modal>
      </div>
    </>
  )
}

export default ProductSelection