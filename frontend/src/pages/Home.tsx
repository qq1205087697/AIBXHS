import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Card, Row, Col, Typography, Select, Empty, Modal, Table, Button, Radio, Tag, message, Spin, Space } from 'antd'
import { MessageSquare, Package, Bot, ChevronRight, Mail, Clock, AlertTriangle, Ship, ClipboardList } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { reviewsApi, inventoryApi, emailsApi, dashboardApi, inboundOrdersApi, shipmentsApi } from '../api'
import { useResponsive } from '../hooks/useResponsive'

const { Title, Text } = Typography

interface ReviewStats {
  high: { unhandled: number; handled: number }
  medium: { unhandled: number; handled: number }
  low: { unhandled: number; handled: number }
}

const DEFAULT_REVIEW_STATS: ReviewStats = {
  high: { unhandled: 0, handled: 0 },
  medium: { unhandled: 0, handled: 0 },
  low: { unhandled: 0, handled: 0 },
}

const Home: React.FC = () => {
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const [reviewStats, setReviewStats] = useState<ReviewStats>(DEFAULT_REVIEW_STATS)
  const [inventoryStats, setInventoryStats] = useState<{ red: number; yellow: number; green: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [emailStats, setEmailStats] = useState<{ urgent: number; medium: number; normal: number; total: number }>({ urgent: 0, medium: 0, normal: 0, total: 0 })
  const [overduePurchaseCount, setOverduePurchaseCount] = useState(0)
  const [purchaseOrderStatusCounts, setPurchaseOrderStatusCounts] = useState<Record<string, number>>({})
  const [realPendingDiffCount, setRealPendingDiffCount] = useState(0) // 实际待处理差异条数（处理完成后才清零）
  const [pendingShipmentCount, setPendingShipmentCount] = useState(0) // 待运营填写的发货单数
  const [confirmedShipmentCount, setConfirmedShipmentCount] = useState(0) // 已确认发货单数
  const [cancelledShipmentCount, setCancelledShipmentCount] = useState(0) // 已取消发货单数
  const [pendingReplenishmentCount, setPendingReplenishmentCount] = useState(0) // 补货单待审批数量
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [diffItems, setDiffItems] = useState<any[]>([])
  const [diffLoading, setDiffLoading] = useState(false)
  const [resolutions, setResolutions] = useState<Record<number, string>>({})
  const [selectedDiffKeys, setSelectedDiffKeys] = useState<React.Key[]>([])
  const [filterBot, setFilterBot] = useState<string | undefined>(undefined)
  const fetchedRef = useRef(false) // 防止 StrictMode 双重挂载导致重复请求
  const resp = useResponsive()
  
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return '早上好'
    if (hour < 18) return '下午好'
    return '晚上好'
  }

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true
      fetchData()
    }
  }, [])

  const loadReviewStats = async () => {
    try {
      const response = await reviewsApi.getStats()
      if (response.data.success) {
        const data = response.data.data || {}
        setReviewStats({
          high: {
            unhandled: data.high?.unviewed || 0,
            handled: data.high?.viewed || 0,
          },
          medium: {
            unhandled: data.medium?.unviewed || 0,
            handled: data.medium?.viewed || 0,
          },
          low: {
            unhandled: data.low?.unviewed || 0,
            handled: data.low?.viewed || 0,
          },
        })
      }
    } catch (error) {
      console.error('????????:', error)
    }
  }

  const loadEmailStats = async () => {
    try {
      const response = await emailsApi.getUnfollowedCount()
      if (response.data.success) {
        setEmailStats(response.data.data)
      }
    } catch (error) {
      console.error('????????:', error)
    }
  }

  const loadInventoryStats = async () => {
    try {
      const response = await inventoryApi.getOverview()
      if (response.data.success) {
        const data = response.data.data
        setInventoryStats({
          red: data.red_count || 0,
          yellow: data.yellow_count || 0,
          green: data.green_count || 0,
        })
      }
    } catch (error) {
      console.error('????????:', error)
    }
  }

  const loadPurchaseStats = async () => {
    try {
      const response = await dashboardApi.getStats()
      if (response.data.success) {
        const data = response.data.data || {}
        setOverduePurchaseCount(data.overduePurchaseOrdersCount || 0)
        setPurchaseOrderStatusCounts(data.purchaseOrderStatusCounts || {})
        setPendingReplenishmentCount(data.pendingReplenishmentCount || 0)
      }
    } catch (error) {
      console.error('????????:', error)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    Promise.allSettled([
      loadReviewStats(),
      loadEmailStats(),
      loadInventoryStats(),
      loadPurchaseStats(),
      loadInboundDiffCount(),
      loadPendingShipmentCount(),
    ]).finally(() => {
      setLoading(false)
    })
  }

  const loadInboundDiffCount = async () => {
    try {
      const diffRes: any = await inboundOrdersApi.getPendingDiffItems()
      if (diffRes?.data?.success) {
        const items = diffRes.data.data || []
        setRealPendingDiffCount(items.length)
      }
    } catch (e) {
      console.error('??????????:', e)
    }
  }

  const loadPendingShipmentCount = async () => {
    try {
      const res = await shipmentsApi.getKpiCount()
      if (res.data.success) {
        setPendingShipmentCount(res.data.pending_shipments || 0)
        setConfirmedShipmentCount(res.data.confirmed_shipments || 0)
        setCancelledShipmentCount(res.data.cancelled_shipments || 0)
      }
    } catch (e) {
      console.error('加载发货单KPI失败:', e)
    }
  }

  const allBots = useMemo(() => [
    {
      id: 'review',
      title: '差评机器人',
      requiredPermission: 'robot:review:kpi',
      icon: <MessageSquare size={32} />,
      color: '#cf1322',
      description: '智能分析差评，快速响应客户反馈',
      path: '/review',
      stats: reviewStats,
      hasPending: reviewStats.high.unhandled + reviewStats.medium.unhandled + reviewStats.low.unhandled > 0,
      priority: reviewStats.high.unhandled > 0 ? 0 : reviewStats.medium.unhandled > 0 ? 1 : 2,
    },
    {
      id: 'inventory',
      title: '库存机器人',
      requiredPermission: 'robot:inventory:kpi',
      icon: <Package size={32} />,
      color: '#faad14',
      description: '实时监控库存，智能预警提醒',
      path: '/inventory',
      stats: inventoryStats,
      hasPending: inventoryStats ? inventoryStats.red + inventoryStats.yellow + inventoryStats.green > 0 : false,
      priority: inventoryStats && inventoryStats.red > 0 ? 0 : inventoryStats && inventoryStats.yellow > 0 ? 1 : 2,
    },
    {
      id: 'chat',
      title: 'AI聊天助手',
      requiredPermission: 'chat:kpi',
      icon: <Bot size={32} />,
      color: '#1890ff',
      description: '智能问答，高效解决问题',
      path: '/chat',
      stats: null,
      hasPending: false,
      priority: 3,
    },
    {
      id: 'email',
      title: '邮件机器人',
      requiredPermission: 'robot:email:kpi',
      icon: <Mail size={32} />,
      color: '#722ed1',
      description: '智能邮件处理，及时跟进客户邮件',
      path: '/email',
      stats: 'email' as const,
      hasPending: emailStats.urgent + emailStats.medium + emailStats.normal > 0,
      priority: emailStats.urgent > 0 ? 0 : emailStats.medium > 0 ? 1 : 2,
    },
    {
      id: 'overdue_purchase',
      title: '超期采购单',
      requiredPermission: 'purchase:overdue_kpi',
      icon: <Clock size={32} />,
      color: '#cf1322',
      description: '审批超过14天未入库的采购单提醒',
      path: '/purchase',
      stats: overduePurchaseCount,
      hasPending: overduePurchaseCount > 0,
      priority: 0,
    },
    {
      id: 'purchase_status',
      title: '采购单状态',
      requiredPermission: 'purchase:status_kpi',
      icon: <Package size={32} />,
      color: '#1890ff',
      description: '采购单各状态概览（待审批/待补发等）',
      path: '/purchase',
      stats: purchaseOrderStatusCounts,
      hasPending: (purchaseOrderStatusCounts['purchased'] || 0) + (purchaseOrderStatusCounts['pending_reshipment'] || 0) > 0
        || (purchaseOrderStatusCounts['approved'] || 0) + (purchaseOrderStatusCounts['partial_received'] || 0) > 0,
      priority: 1,
    },
    {
      id: 'inbound_diff',
      title: '入库数量差异',
      requiredPermission: 'inbound:diff_kpi',
      icon: <AlertTriangle size={32} />,
      color: '#faad14',
      description: '入库数量与采购单数量不一致的待处理提醒',
      path: '/inbound',
      stats: realPendingDiffCount,
      hasPending: realPendingDiffCount > 0,
      priority: 1,
    },
    {
      id: 'pending_shipment',
      title: '待运营确认发货单',
      requiredPermission: 'shipment:kpi',
      icon: <Ship size={32} />,
      color: '#fa8c16',
      description: '等待填写红单、海运、备注信息并确认',
      path: '/shipment',
      stats: pendingShipmentCount,
      hasPending: pendingShipmentCount > 0,
      priority: 1,
    },
    {
      id: 'confirmed_shipment',
      title: '已确认发货单',
      requiredPermission: 'shipment:kpi',
      icon: <Ship size={32} />,
      color: '#52c41a',
      description: '已确认的发货单，可转出库单',
      path: '/shipment',
      stats: confirmedShipmentCount,
      hasPending: false,
      priority: 2,
    },
    {
      id: 'cancelled_shipment',
      title: '已取消发货单',
      requiredPermission: 'shipment:kpi',
      icon: <Ship size={32} />,
      color: '#ff4d4f',
      description: '已取消的发货单',
      path: '/shipment',
      stats: cancelledShipmentCount,
      hasPending: false,
      priority: 2,
    },
    {
      id: 'pending_replenishment',
      title: '补货单待审批',
      requiredPermission: 'replenishment:approve',
      icon: <ClipboardList size={32} />,
      color: '#722ed1',
      description: '等待审批的补货申请单',
      path: '/replenishment',
      stats: pendingReplenishmentCount,
      hasPending: pendingReplenishmentCount > 0,
      priority: 1,
    },
  ], [reviewStats, inventoryStats, emailStats, overduePurchaseCount, realPendingDiffCount, purchaseOrderStatusCounts, pendingShipmentCount, confirmedShipmentCount, cancelledShipmentCount, pendingReplenishmentCount])

  const permittedBots = useMemo(() =>
    allBots.filter(bot => hasPermission(bot.requiredPermission)),
    [allBots, hasPermission])

  const visibleBots = useMemo(() =>
    permittedBots.filter(bot => bot.hasPending).sort((a, b) => a.priority - b.priority),
    [permittedBots])

  const filteredBots = useMemo(() =>
    filterBot ? permittedBots.filter(bot => bot.id === filterBot) : visibleBots,
    [filterBot, permittedBots, visibleBots])

  const filterOptions = useMemo(() =>
    permittedBots.map(bot => ({ value: bot.id, label: bot.title })),
    [permittedBots])

  const renderReviewStats = (stats: any) => {
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fff2f0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>严重</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#cf1322' }}>{stats.high.unhandled}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fffbe6', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>中等</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>{stats.medium.unhandled}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#e6f7ff', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>轻微</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>{stats.low.unhandled}</div>
            </div>
          </Col>
        </Row>
      </div>
    )
  }

 const renderEmailStats = () => {
    
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fff2f0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>紧急</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#cf1322' }}>{emailStats.urgent}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fffbe6', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>中等</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>{emailStats.medium}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#e6f7ff', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>一般</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>{emailStats.normal}</div>
            </div>
          </Col>
        </Row>
      </div>
    )
  }
    
  const renderInventoryStats = (stats: any) => {
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fff2f0', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>断货风险</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#cf1322' }}>{stats.red}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#fffbe6', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>库存预警</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>{stats.yellow}</div>
            </div>
          </Col>
          <Col span={8}>
            <div style={{ textAlign: 'center', padding: '8px 0', background: '#f6ffed', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>库存正常</div>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>{stats.green}</div>
            </div>
          </Col>
        </Row>
      </div>
    )
  }

  const renderOverduePurchaseStats = () => {
    const hasOverdue = overduePurchaseCount > 0
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={24}>
            <div style={{
              textAlign: 'center',
              padding: '12px 0',
              background: hasOverdue ? '#fff2f0' : '#f6ffed',
              borderRadius: 8
            }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>审批超过14天未入库</div>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: hasOverdue ? '#cf1322' : '#52c41a' }}>
                {overduePurchaseCount} 单
              </div>
              {!hasOverdue && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>全部按时入库</div>
              )}
              {hasOverdue && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>请及时跟进</div>
              )}
            </div>
          </Col>
        </Row>
      </div>
    )
  }

  const renderInboundDiffStats = () => {
    const hasDiff = realPendingDiffCount > 0
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={24}>
            <div style={{
              textAlign: 'center',
              padding: '12px 0',
              background: hasDiff ? '#fffbe6' : '#f6ffed',
              borderRadius: 8
            }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>入库数量与采购单不一致</div>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: hasDiff ? '#faad14' : '#52c41a' }}>
                {realPendingDiffCount} 条
              </div>
              {!hasDiff && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>全部数量一致</div>
              )}
              {hasDiff && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>待处理差异通知</div>
              )}
            </div>
          </Col>
        </Row>
      </div>
    )
  }

  const renderPendingShipmentStats = () => {
    const hasPending = pendingShipmentCount > 0
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={24}>
            <div style={{
              textAlign: 'center',
              padding: '12px 0',
              background: hasPending ? '#e6f7ff' : '#f6ffed',
              borderRadius: 8
            }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>等待填写红单、海运、备注并确认</div>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: hasPending ? '#1890ff' : '#52c41a' }}>
                {pendingShipmentCount} 单
              </div>
              {!hasPending && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>全部已确认或取消</div>
              )}
              {hasPending && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>请及时处理</div>
              )}
            </div>
          </Col>
        </Row>
      </div>
    )
  }

  const renderPendingReplenishmentStats = () => {
    const hasPending = pendingReplenishmentCount > 0
    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          <Col span={24}>
            <div style={{
              textAlign: 'center',
              padding: '12px 0',
              background: hasPending ? '#f9f0ff' : '#f6ffed',
              borderRadius: 8
            }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>等待审批的补货申请单</div>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: hasPending ? '#722ed1' : '#52c41a' }}>
                {pendingReplenishmentCount} 单
              </div>
              {!hasPending && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>全部已审批或取消</div>
              )}
              {hasPending && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>请及时审批</div>
              )}
            </div>
          </Col>
        </Row>
      </div>
    )
  }

  const renderPurchaseStatusStats = () => {
    const approved = purchaseOrderStatusCounts['approved'] || 0
    const purchased = purchaseOrderStatusCounts['purchased'] || 0
    const partialReceived = purchaseOrderStatusCounts['partial_received'] || 0
    const pendingReshipment = purchaseOrderStatusCounts['pending_reshipment'] || 0
    const total = approved + purchased + partialReceived + pendingReshipment

    return (
      <div style={{ marginTop: 16 }}>
        <Row gutter={[8, 8]}>
          {pendingReshipment > 0 && (
            <Col span={8}>
              <div style={{ textAlign: 'center', padding: '8px 0', background: '#fff7e6', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>待补发</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#fa8c16' }}>{pendingReshipment}</div>
              </div>
            </Col>
          )}
          {purchased > 0 && (
            <Col span={pendingReshipment > 0 ? 8 : 12}>
              <div style={{ textAlign: 'center', padding: '8px 0', background: '#f0f5ff', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>已采购</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#2f54eb' }}>{purchased}</div>
              </div>
            </Col>
          )}
          {(approved + partialReceived) > 0 && (
            <Col span={(pendingReshipment > 0 || purchased > 0) ? 8 : 12}>
              <div style={{ textAlign: 'center', padding: '8px 0', background: '#e6f7ff', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>已审批待收货</div>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>{approved + partialReceived}</div>
              </div>
            </Col>
          )}
          {total === 0 && (
            <Col span={24}>
              <div style={{ textAlign: 'center', padding: '8px 0', background: '#f6ffed', borderRadius: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>0 条</div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>全部已完成或取消</div>
              </div>
            </Col>
          )}
        </Row>
      </div>
    )
  }

  // 打开差异处理弹窗
  const handleOpenDiffModal = async () => {
    setDiffModalOpen(true)
    setSelectedDiffKeys([])
    setResolutions({})
    setDiffLoading(true)
    try {
      const res: any = await inboundOrdersApi.getPendingDiffItems()
      if (res.data.success) {
        const items = res.data.data || []
        setDiffItems(items)
        // 默认全选
        setSelectedDiffKeys(items.map((item: any) => item.inbound_item_id))
        // 初始化 resolutions 为空（未选择）
        const initResolutions: Record<number, string> = {}
        items.forEach((item: any) => { initResolutions[item.inbound_item_id] = '' })
        setResolutions(initResolutions)
        if (items.length > 0) {
          setRealPendingDiffCount(items.length)
        }
      }
    } catch (e) {
      console.error('获取待处理差异列表失败:', e)
      message.error('获取差异列表失败')
    } finally {
      setDiffLoading(false)
    }
  }

  // 批量设置处理方式
  const handleBatchSetResolution = (resolution: string) => {
    if (selectedDiffKeys.length === 0) {
      message.warning('请先勾选要处理的记录')
      return
    }

    // 如果选择厂家补发，需要检查是否有超收的记录
    if (resolution === 'reshipment') {
      const overReceiveKeys = selectedDiffKeys.filter(key => {
        const item = diffItems.find(d => d.inbound_item_id === key)
        return item && item.diff_type === '超收'
      })
      if (overReceiveKeys.length > 0) {
        message.warning(`有 ${overReceiveKeys.length} 条超收记录无法选择厂家补发，已自动跳过`)
        // 只对少收的记录设置
        const newResolutions = { ...resolutions }
        selectedDiffKeys.forEach(key => {
          const item = diffItems.find(d => d.inbound_item_id === key)
          if (item && item.diff_type !== '超收') {
            newResolutions[key as number] = resolution
          }
        })
        setResolutions(newResolutions)
        return
      }
    }

    const newResolutions = { ...resolutions }
    selectedDiffKeys.forEach(key => {
      newResolutions[key as number] = resolution
    })
    setResolutions(newResolutions)
  }

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedDiffKeys.length === diffItems.length) {
      setSelectedDiffKeys([])
    } else {
      setSelectedDiffKeys(diffItems.map(item => item.inbound_item_id))
    }
  }

  // 提交差异处理结果
  const handleSubmitDiffs = async () => {
    // 只检查已勾选的项是否都已选择处理方式
    const selectedUnresolved = selectedDiffKeys.filter(key => !resolutions[key as number])
    if (selectedUnresolved.length > 0 && selectedDiffKeys.length > 0) {
      message.warning(`还有 ${selectedUnresolved.length} 条已勾选的差异未选择处理方式`)
      return
    }
    if (selectedDiffKeys.length === 0) {
      message.warning('请至少勾选一条要处理的记录')
      return
    }

    const resolutionList = selectedDiffKeys.map((key: React.Key) => ({
      inbound_item_id: key as number,
      resolution: resolutions[key as number],
    })).filter(item => item.resolution)

    try {
      const res: any = await inboundOrdersApi.resolveDiffs(resolutionList)
      if (res.data.success) {
        message.success(res.data.message || '差异处理成功')
        setDiffModalOpen(false)
        setRealPendingDiffCount(0)
        fetchData()
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '处理失败')
    }
  }

  // 差异处理弹窗列定义
  const diffColumns = [
    {
      title: '入库单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 160,
    },
    {
      title: '产品',
      key: 'product',
      render: (_: any, record: any) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.product_name}</div>
          <div style={{ fontSize: 11, color: '#999' }}>{record.product_code}</div>
        </div>
      ),
      width: 200,
    },
    {
      title: '采购单',
      dataIndex: 'po_number',
      key: 'po_number',
      width: 150,
    },
    {
      title: '数量对比',
      key: 'qty_compare',
      render: (_: any, record: any) => (
        <div style={{ fontSize: 12 }}>
          <div>采购{record.ordered_qty}件 已收{record.received_qty}件</div>
          <div>剩余应收<span style={{ fontWeight: 'bold' }}>{record.remaining_qty}</span>件</div>
          <div>实际入库<span style={{
            color: record.diff_type === '超收' ? '#cf1322' : '#faad14',
            fontWeight: 'bold'
          }}>{record.inbound_qty}</span>件</div>
          <Tag color={record.diff_type === '超收' ? 'red' : 'orange'} style={{ marginTop: 4 }}>
            {record.diff_type}{record.diff_amount}件
          </Tag>
        </div>
      ),
      width: 180,
    },
    {
      title: '处理方式',
      key: 'resolution',
      render: (_: any, record: any) => {
        const isOverReceive = record.diff_type === '超收'
        return (
          <Radio.Group
            value={resolutions[record.inbound_item_id] || ''}
            onChange={(e) => setResolutions(prev => ({ ...prev, [record.inbound_item_id]: e.target.value }))}
            size="small"
          >
            <Radio.Button
              value="reshipment"
              style={{ marginRight: 4 }}
              disabled={isOverReceive}
              title={isOverReceive ? '超收订单无法选择补发' : ''}
            >
              厂家补发
            </Radio.Button>
            <Radio.Button value="reduce_po">平采购单数量</Radio.Button>
          </Radio.Group>
        )
      },
      width: 240,
    },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>{user?.username || '用户'}，{getGreeting()}！</Title>
        <Select
          placeholder="选择机器人"
          value={filterBot}
          onChange={(value) => setFilterBot(value)}
          allowClear
          showSearch
          filterOption={(input, option) =>
            (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
          }
          style={{ width: 180 }}
          options={filterOptions}
        />
      </div>

        {loading ? (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '120px 0' }}>
            <Spin size="large" />
          </div>
        ) : (
        <Row gutter={[24, 24]}>
          {filteredBots.length > 0 ? (
            filteredBots.map(module => (
              <Col xs={24} sm={12} md={8} lg={6} key={module.id}>
              <Card
                onClick={() => {
                  if (module.id === 'inbound_diff') {
                    if (!hasPermission('inbound:create')) {
                      message.warning('您没有处理入库差异的权限')
                      return
                    }
                    handleOpenDiffModal()
                  } else {
                    navigate(module.path)
                  }
                }}
                style={{
                  height: '100%',
                  cursor: 'pointer',
                  borderLeft: `4px solid ${module.color}`,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  transition: 'all 0.3s'
                }}
                styles={{ body: { padding: 24 } }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      background: `${module.color}15`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: module.color
                    }}>
                      {module.icon}
                    </div>
                    <div>
                      <Title level={4} style={{ margin: 0, marginBottom: 4 }}>{module.title}</Title>
                      <Text type="secondary" style={{ fontSize: 13 }}>{module.description}</Text>
                    </div>
                  </div>
                  <ChevronRight size={20} color="#999" />
                </div>

                {module.id === 'review' && module.stats && renderReviewStats(module.stats)}
                {module.id === 'email' && renderEmailStats()}
                {module.id === 'inventory' && module.stats && renderInventoryStats(module.stats)}
                {module.id === 'overdue_purchase' && renderOverduePurchaseStats()}
                {module.id === 'purchase_status' && renderPurchaseStatusStats()}
                {module.id === 'inbound_diff' && renderInboundDiffStats()}
                {module.id === 'pending_shipment' && renderPendingShipmentStats()}
                {module.id === 'pending_replenishment' && renderPendingReplenishmentStats()}
              </Card>
            </Col>
            ))
          ) : !loading ? (
            <div style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '120px 0'
            }}>
              <Empty description="今日无待办" />
            </div>
          ) : null}
        </Row>
        )}

        {/* 入库数量差异处理弹窗 */}
        <Modal
          title="入库数量差异处理"
          open={diffModalOpen}
          onCancel={() => setDiffModalOpen(false)}
          width={resp.isMobile ? '95vw' : 1000}
          footer={[
            <Button key="cancel" onClick={() => setDiffModalOpen(false)}>取消</Button>,
            <Button key="submit" type="primary" onClick={handleSubmitDiffs} disabled={diffItems.length === 0}>
              确认处理（{selectedDiffKeys.filter(k => resolutions[k as number]).length}/{selectedDiffKeys.length}）
            </Button>
          ]}
          destroyOnClose
        >
          {diffLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : diffItems.length === 0 ? (
            <Empty description="暂无待处理的差异记录" />
          ) : (
            <>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#666', fontSize: 13 }}>
                  已选择 <b>{selectedDiffKeys.length}</b> / {diffItems.length} 条记录
                </span>
                <Space size="small">
                  <Button size="small" onClick={handleSelectAll}>
                    {selectedDiffKeys.length === diffItems.length ? '取消全选' : '全选'}
                  </Button>
                  <Button size="small" type="primary" ghost onClick={() => handleBatchSetResolution('reshipment')}>
                    批量设为厂家补发
                  </Button>
                  <Button size="small" type="primary" danger ghost onClick={() => handleBatchSetResolution('reduce_po')}>
                    批量设为平采购数量
                  </Button>
                </Space>
              </div>
              <div style={{ marginBottom: 8, fontSize: 12, color: '#999', background: '#fafafa', padding: '8px 12px', borderRadius: 4 }}>
                <div><b>厂家补发</b>：仅限少收情况，采购单状态将变为「待补发」，入库单可正常审批通过。后续补发到货时再次入库关联该采购单，数量补齐后采购单自动变为「已完成」</div>
                <div style={{ marginTop: 4 }}><b>平采购单数量</b>：自动将采购单订购量调整为「已收货+本次入库」。</div>
                <div style={{ marginTop: 2, paddingLeft: 12 }}>• <b>超收时</b>：增加采购单订购量以匹配实际入库</div>
                <div style={{ marginTop: 2, paddingLeft: 12 }}>• <b>少收时</b>：减少采购单订购量以匹配实际入库</div>
              </div>
              <Table
                dataSource={diffItems}
                columns={diffColumns}
                rowKey="inbound_item_id"
                pagination={false}
                size="small"
                scroll={{ y: 400 }}
                rowSelection={{
                  selectedRowKeys: selectedDiffKeys,
                  onChange: (keys) => setSelectedDiffKeys(keys),
                }}
              />
            </>
          )}
        </Modal>

    </div>
  )
}

export default Home
