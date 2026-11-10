import React from 'react'
import { Checkbox, Empty, Spin, Tag, Tooltip } from 'antd'
import { CheckSquareOutlined } from '@ant-design/icons'
import { PlatformSkuEntry } from '../api'

/**
 * 视频统一上传的双平台 SKU 勾选区（Amazon / Ozon 分区展示）。
 * 勾选键统一为 `${pp_id}_${store_id}`，提交时后端按条目平台自动路由上传路径。
 */

export const skuKey = (e: { pp_id: number; store_id: number }) => `${e.pp_id}_${e.store_id}`

interface PlatformSectionProps {
  title: string
  platformLabel: string
  tagColor: string
  hint: string
  items: PlatformSkuEntry[]
  selected: string[]
  onChange: (keys: string[]) => void
  disabledEntry: (e: PlatformSkuEntry) => string | null  // 返回禁用原因，null 表示可选
  extraLabel?: (e: PlatformSkuEntry) => string
  notConfigured?: boolean  // 平台上传依赖未就绪时整个分区禁用
  notConfiguredText?: string
}

const PlatformSection: React.FC<PlatformSectionProps> = ({
  title, platformLabel, tagColor, hint, items, selected, onChange,
  disabledEntry, extraLabel, notConfigured, notConfiguredText,
}) => {
  const selectable = items.filter((e) => !disabledEntry(e) && !notConfigured)
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.includes(skuKey(e)))
  const someSelected = selectable.some((e) => selected.includes(skuKey(e)))

  const handleToggleAll = (checked: boolean) => {
    onChange(checked ? [...selected, ...selectable.map(skuKey).filter((k) => !selected.includes(k))] : selected.filter((k) => !items.some((e) => skuKey(e) === k && !disabledEntry(e))))
  }

  return (
    <div style={{
      border: `1px solid ${someSelected ? tagColor : 'var(--ant-color-border, #d9d9d9)'}`,
      borderRadius: 10, padding: '12px 16px 14px', marginBottom: 14,
      background: someSelected ? 'rgba(24, 144, 255, 0.03)' : 'transparent',
      transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <CheckSquareOutlined style={{ color: tagColor }} />
        <span style={{ fontWeight: 600 }}>{title}</span>
        <Tag color={tagColor}>{platformLabel}</Tag>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>{hint}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {notConfigured ? (
            <Tooltip title={notConfiguredText}><Tag color="warning">未配置</Tag></Tooltip>
          ) : (
            <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={(e) => handleToggleAll(e.target.checked)} disabled={selectable.length === 0}>
              全选本区
            </Checkbox>
          )}
        </span>
      </div>
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该平台暂无 SKU 关联" style={{ margin: '8px 0' }} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px 16px' }}>
          {items.map((e) => {
            const key = skuKey(e)
            const disabledReason = notConfigured ? notConfiguredText || '平台上传未配置' : disabledEntry(e)
            return (
              <Tooltip key={key} title={disabledReason || ''}>
                <Checkbox
                  checked={selected.includes(key)}
                  disabled={!!disabledReason}
                  onChange={(ev) => onChange(ev.target.checked ? [...selected, key] : selected.filter((k) => k !== key))}
                >
                  <span style={{ userSelect: 'none' }}>
                    <span style={{ fontWeight: 600 }}>{e.sku || '(未填货号)'}</span>
                    <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 8 }}>
                      {e.store_name}{e.site ? ` · ${e.site}` : ''}
                    </span>
                    {extraLabel && (
                      <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 8 }}>{extraLabel(e)}</span>
                    )}
                    {disabledReason && (
                      <Tag color="error" style={{ marginLeft: 8, fontSize: 11, lineHeight: '16px' }}>不可传</Tag>
                    )}
                  </span>
                </Checkbox>
              </Tooltip>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface PlatformSkuSelectorProps {
  loading?: boolean
  amazonItems: PlatformSkuEntry[]
  ozonItems: PlatformSkuEntry[]
  amazonSelected: string[]
  ozonSelected: string[]
  onAmazonChange: (keys: string[]) => void
  onOzonChange: (keys: string[]) => void
  /** Amazon 上传依赖飞书表配置；false 时 Amazon 区整体禁用 */
  amazonConfigured?: boolean
}

const PlatformSkuSelector: React.FC<PlatformSkuSelectorProps> = ({
  loading, amazonItems, ozonItems, amazonSelected, ozonSelected,
  onAmazonChange, onOzonChange, amazonConfigured = true,
}) => {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px 0' }}><Spin tip="加载平台 SKU..." /></div>
  }
  if (amazonItems.length === 0 && ozonItems.length === 0) {
    return <Empty description="该产品未关联 Amazon / Ozon 平台商品" style={{ padding: '24px 0' }} />
  }

  return (
    <Spin spinning={false}>
      <PlatformSection
        title="Amazon（写飞书多维表，RPA 自动上传）"
        platformLabel="Amazon"
        tagColor="orange"
        hint="ASIN 必填"
        items={amazonItems}
        selected={amazonSelected}
        onChange={onAmazonChange}
        disabledEntry={(e) => (e.has_asin ? null : '未绑定 ASIN，无法上传')}
        extraLabel={(e) => (e.asin ? `ASIN: ${e.asin}` : '')}
        notConfigured={!amazonConfigured}
        notConfiguredText="飞书视频上传表未配置"
      />
      <PlatformSection
        title="Ozon（Seller API 直传，异步审核）"
        platformLabel="OZON"
        tagColor="#0d6efd"
        hint="店铺需配置 Client-Id / Api-Key"
        items={ozonItems}
        selected={ozonSelected}
        onChange={onOzonChange}
        disabledEntry={(e) => {
          if (!e.has_credentials) return '店铺未配置 Ozon 凭证'
          if (!e.has_offer_id) return '未填货号(offer_id)'
          return null
        }}
        notConfigured={false}
      />
    </Spin>
  )
}

export default PlatformSkuSelector
