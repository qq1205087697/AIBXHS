import React, { useState, useEffect } from 'react'
import { Card, Row, Col, Statistic, Table, Tag } from 'antd'
import {
  TrendingUp,
  Package,
  MessageSquare,
  DollarSign,
  AlertTriangle,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import axios from 'axios'
import { useTheme } from '../contexts/ThemeContext'

interface DashboardData {
  inventoryAlerts: {
    low_stock?: number
    overstock?: number
    [key: string]: number | undefined
  }
  negativeReviews: number
  productCount: number
  storeCount: number
  salesTrend: Array<{date: string, sales: number}>
  inventoryDistribution: Array<{range: string, count: number}>
}

interface InventoryAlert {
  id: string
  asin: string
  name: string
  currentStock: number
  safetyStock: number
  daysRemaining: number
  status: string
  category: string
  suggestion: string
}

interface ReviewItem {
  id: string
  asin: string
  productName: string
  rating: number
  originalText: string
  translatedText: string
  keyPoints: string[]
  date: string
  status: string
  author: string
}

const Dashboard: React.FC = () => {
  const { currentTheme } = useTheme()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryAlert[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [dashboardRes, alertsRes, reviewsRes] = await Promise.all([
        axios.get('/api/dashboard/stats'),
        axios.get('/api/inventory/alerts'),
        axios.get('/api/reviews/')
      ])

      if (dashboardRes.data.success) {
        setDashboardData(dashboardRes.data.data)
      }
      if (alertsRes.data.success) {
        setInventoryAlerts(alertsRes.data.data)
      }
      if (reviewsRes.data.success) {
        setReviews(reviewsRes.data.data)
      }
    } catch (error) {
      console.error('获取数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const inventoryColumns = [
    { title: 'ASIN', dataIndex: 'asin', key: 'asin' },
    { title: '商品名称', dataIndex: 'name', key: 'name' },
    { title: '库存数量', dataIndex: 'currentStock', key: 'currentStock' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (_status: string, record: InventoryAlert) => {
        let color = 'green'
        let text = '正常'
        if (record.category === 'low_stock') {
          color = 'red'
          text = '断货风险'
        } else if (record.category === 'overstock') {
          color = 'orange'
          text = '库存冗余'
        }
        return <Tag color={color}>{text}</Tag>
      },
    },
  ]

  const reviewColumns = [
    { title: 'ASIN', dataIndex: 'asin', key: 'asin' },
    { title: '商品名称', dataIndex: 'productName', key: 'productName' },
    { 
      title: '评分', 
      dataIndex: 'rating', 
      key: 'rating', 
      render: (rating: number) => '⭐'.repeat(rating) 
    },
    { title: '日期', dataIndex: 'date', key: 'date' },
  ]

  const totalAlerts = dashboardData ? 
    (dashboardData.inventoryAlerts.low_stock || 0) + (dashboardData.inventoryAlerts.overstock || 0) : 0

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic
              title="本月销售额"
              value={dashboardData?.salesTrend[dashboardData.salesTrend.length - 1]?.sales || 0}
              precision={2}
              valueStyle={{ color: '#3f8600' }}
              prefix={<DollarSign size={18} />}
              suffix="USD"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic
              title="活跃商品"
              value={dashboardData?.productCount || 0}
              prefix={<Package size={18} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic
              title="新增差评"
              value={dashboardData?.negativeReviews || 0}
              valueStyle={{ color: '#cf1322' }}
              prefix={<MessageSquare size={18} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={loading}>
            <Statistic
              title="待处理预警"
              value={totalAlerts}
              valueStyle={{ color: '#faad14' }}
              prefix={<AlertTriangle size={18} />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="销售趋势" extra={<TrendingUp size={20} />} loading={loading}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dashboardData?.salesTrend || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="sales" stroke={currentTheme.primary} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="库存分布" extra={<Package size={20} />} loading={loading}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dashboardData?.inventoryDistribution || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill={currentTheme.primary} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="库存预警" style={{ marginBottom: 24 }} loading={loading}>
            <Table 
              dataSource={inventoryAlerts.slice(0, 5)} 
              columns={inventoryColumns} 
              rowKey="id" 
              pagination={false} 
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="最新差评" style={{ marginBottom: 24 }} loading={loading}>
            <Table 
              dataSource={reviews.slice(0, 5)} 
              columns={reviewColumns} 
              rowKey="id" 
              pagination={false} 
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard
