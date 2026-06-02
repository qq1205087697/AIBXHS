import React, { useState, useEffect } from 'react'
import { Card, Typography, Button, InputNumber, Slider, Space, message, Spin, Divider, Tooltip } from 'antd'
import { Save, RotateCcw, Info } from 'lucide-react'
import { businessSettingsApi, BusinessSetting, FormulaWeight } from '../api'

const { Title, Text } = Typography

const PERIOD_LABELS: Record<string, string> = {
  '3d': '3天日均',
  '7d': '7天日均',
  '14d': '14天日均',
  '30d': '30天日均',
  '60d': '60天日均',
  '90d': '90天日均',
}

const BusinessSettings: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [setting, setSetting] = useState<BusinessSetting | null>(null)
  const [weights, setWeights] = useState<FormulaWeight[]>([])
  const [totalWeight, setTotalWeight] = useState(0)

  useEffect(() => {
    loadSetting()
  }, [])

  const loadSetting = async () => {
    setLoading(true)
    try {
      const response = await businessSettingsApi.getSetting('daily_sales')
      const data = response.data
      setSetting(data)
      if (data.formula_config?.weights) {
        setWeights(data.formula_config.weights)
        const total = data.formula_config.weights.reduce((sum, w) => sum + w.weight, 0)
        setTotalWeight(Math.round(total * 100))
      }
    } catch (error) {
      console.error('加载设置失败:', error)
      message.error('加载设置失败')
    } finally {
      setLoading(false)
    }
  }

  const updateWeight = (period: string, value: number) => {
    const newWeights = weights.map(w =>
      w.period === period ? { ...w, weight: value } : w
    )
    setWeights(newWeights)
    const total = newWeights.reduce((sum, w) => sum + w.weight, 0)
    setTotalWeight(Math.round(total * 100))
  }

  const handleSave = async () => {
    if (totalWeight !== 100) {
      message.warning(`权重总和必须为100%，当前为${totalWeight}%`)
      return
    }

    setSaving(true)
    try {
      const response = await businessSettingsApi.updateSetting('daily_sales', {
        formula_config: {
          type: 'weighted',
          weights: weights
        },
        is_active: 1
      })
      if (response.data.recalculate_triggered) {
        message.success('保存成功，已自动重新计算补货建议')
      } else {
        message.success('保存成功')
      }
    } catch (error) {
      console.error('保存失败:', error)
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    try {
      const response = await businessSettingsApi.resetSetting('daily_sales')
      const data = response.data
      setSetting(data)
      if (data.formula_config?.weights) {
        setWeights(data.formula_config.weights)
        const total = data.formula_config.weights.reduce((sum, w) => sum + w.weight, 0)
        setTotalWeight(Math.round(total * 100))
      }
      if (data.recalculate_triggered) {
        message.success('已重置为默认配置，已自动重新计算补货建议')
      } else {
        message.success('已重置为默认配置')
      }
    } catch (error) {
      console.error('重置失败:', error)
      message.error('重置失败')
    } finally {
      setSaving(false)
    }
  }

  const renderFormula = () => {
    return weights.map((w, index) => (
      <React.Fragment key={w.period}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text>{PERIOD_LABELS[w.period]}</Text>
            <Text type="secondary">{Math.round(w.weight * 100)}%</Text>
          </div>
          <Slider
            value={w.weight}
            onChange={(value) => updateWeight(w.period, value)}
            min={0}
            max={1}
            step={0.01}
            marks={{
              0: '0%',
              0.2: '20%',
              0.4: '40%',
              0.6: '60%',
              0.8: '80%',
              1: '100%',
            }}
            style={{ marginTop: 8 }}
          />
        </div>
        {index < weights.length - 1 && <Text type="secondary" style={{ margin: '0 12px', whiteSpace: 'nowrap' }}>+</Text>}
      </React.Fragment>
    ))
  }

  const renderFormulaPreview = () => {
    return weights.map((w, index) => (
      <React.Fragment key={w.period}>
        <Text strong>{w.weight > 0 ? `${PERIOD_LABELS[w.period]}×${Math.round(w.weight * 100)}%` : `${PERIOD_LABELS[w.period]}×0%`}</Text>
        {index < weights.length - 1 && <Text type="secondary"> + </Text>}
      </React.Fragment>
    ))
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>日均销量规则</Title>
            <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              配置日均销量的计算公式，用于补货决策
            </Text>
          </div>
          <Space>
            <Button icon={<RotateCcw size={14} />} onClick={handleReset} loading={saving}>
              重置默认
            </Button>
            <Button type="primary" icon={<Save size={14} />} onClick={handleSave} loading={saving}>
              保存
            </Button>
          </Space>
        </div>

        <Divider style={{ margin: '16px 0' }} />

        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>类型</Text>
          </div>
          <Text>动态销量（加权平均）</Text>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>计算公式</Text>
            <Tooltip title="各时间段日均销量的加权平均，权重总和必须等于100%">
              <Info size={14} style={{ marginLeft: 8, color: '#999', cursor: 'pointer' }} />
            </Tooltip>
          </div>

          <Card size="small" style={{ background: '#fafafa', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {renderFormulaPreview()}
            </div>
          </Card>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 }}>
            {renderFormula()}
          </div>

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong>权重总和：</Text>
            <Text style={{ color: totalWeight === 100 ? '#52c41a' : '#fa8c16', fontWeight: 600 }}>
              {totalWeight}%
            </Text>
            {totalWeight !== 100 && (
              <Text type="warning" style={{ fontSize: 12 }}>
                （权重总和必须等于100%）
              </Text>
            )}
          </div>
        </div>

        <Divider style={{ margin: '16px 0' }} />

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <Info size={12} style={{ marginRight: 4 }} />
            说明：系统使用加权平均计算日均销量，考虑多个时间段的销量数据。
            3天日均通常设为0%以排除短期波动影响，其他时间段根据业务特点分配权重。
          </Text>
        </div>
      </Card>
    </div>
  )
}

export default BusinessSettings
