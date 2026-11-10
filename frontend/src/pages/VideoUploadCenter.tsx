import React, { useCallback, useRef, useState } from 'react'
import {
  Alert, Button, Card, Checkbox, Empty, Modal, Select, Space, Spin, Tag, message,
} from 'antd'
import { CloudUploadOutlined, ReloadOutlined, SearchOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { productsApi, videoBindingApi, OzonUploadResult, OzonTaskStatusResult, PlatformSkuEntry } from '../api'
import PlatformSkuSelector, { skuKey } from '../components/PlatformSkuSelector'
import { VideosUpload } from '../components/TosUpload'
import { useAuth } from '../contexts/AuthContext'

/**
 * 视频统一上传中心：Amazon（飞书多维表 → RPA）与 Ozon（Seller API 直传 + 飞书留痕）
 * 双平台 SKU 分区勾选、单一确认按钮，后端按 SKU 平台自动路由上传路径。
 */

interface ProductOption {
  id: number
  product_code: string
  name: string
}

interface OzonStatusMap {
  [taskIdKey: string]: OzonTaskStatusResult
}

const PAGE_SIZE = 50

const VideoUploadCenter: React.FC = () => {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('product:edit') || hasPermission('ai_video:approve')

  // 产品选择
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const [productId, setProductId] = useState<number | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  // 视频选择
  const [videoOptions, setVideoOptions] = useState<string[]>([])
  const [selectedVideos, setSelectedVideos] = useState<string[]>([])

  // 平台 SKU
  const [amazonItems, setAmazonItems] = useState<PlatformSkuEntry[]>([])
  const [ozonItems, setOzonItems] = useState<PlatformSkuEntry[]>([])
  const [amazonSelected, setAmazonSelected] = useState<string[]>([])
  const [ozonSelected, setOzonSelected] = useState<string[]>([])
  const [skuLoading, setSkuLoading] = useState(false)
  const [amazonConfigured, setAmazonConfigured] = useState(true)

  // 提交与结果
  const [submitting, setSubmitting] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  const [resultMessage, setResultMessage] = useState('')
  const [amazonResult, setAmazonResult] = useState<{ success?: number; failed?: number; errors?: string[]; error?: string } | null>(null)
  const [ozonResults, setOzonResults] = useState<OzonUploadResult[]>([])
  const [ozonBatchNo, setOzonBatchNo] = useState<string | undefined>()
  const [statusMap, setStatusMap] = useState<OzonStatusMap>({})
  const [statusRefreshing, setStatusRefreshing] = useState(false)

  const searchProducts = useCallback(async (keyword: string) => {
    setProductSearching(true)
    try {
      const resp = await productsApi.getList({ page: 1, page_size: PAGE_SIZE, search: keyword || undefined })
      // /products/ 列表接口 data 直接为数组（total 在顶层）
      const items = ((resp.data?.data as unknown as ProductOption[]) || []).filter((p) => p && p.id)
      setProductOptions(items)
    } catch {
      // 搜索失败静默处理，不打断输入
    } finally {
      setProductSearching(false)
    }
  }, [])

  const handleProductSearch = (keyword: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchProducts(keyword.trim()), 400)
  }

  const handleProductSelect = async (value: number) => {
    setProductId(value)
    setSelectedVideos([])
    setAmazonSelected([])
    setOzonSelected([])
    setStatusMap({})
    // 并行拉取产品视频与平台 SKU
    setSkuLoading(true)
    try {
      const [detailResp, skuResp] = await Promise.all([
        productsApi.getById(value),
        videoBindingApi.getPlatformSkus(value),
      ])
      const p = (detailResp.data?.data || {}) as { videos?: string[]; video_url?: string }
      const vids = (p.videos && p.videos.length > 0 ? p.videos : p.video_url ? [p.video_url] : []).filter(Boolean)
      setVideoOptions(vids)
      const d = skuResp.data?.data
      setAmazonItems(d?.amazon || [])
      setOzonItems(d?.ozon || [])
      setAmazonConfigured(d?.feishu_video_configured !== false)
      // Amazon 默认预选已绑定 ASIN 的条目
      setAmazonSelected((d?.amazon || []).filter((e) => e.has_asin).map(skuKey))
      if ((d?.amazon || []).length === 0 && (d?.ozon || []).length === 0) {
        message.info('该产品未关联 Amazon / Ozon 平台商品')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载产品视频 / 平台 SKU 失败')
    } finally {
      setSkuLoading(false)
    }
  }

  const handleVideosUploadChange = (urls?: string[]) => {
    if (!urls) return
    // 本地上传的新视频自动勾选并加入可选项
    setVideoOptions((prev) => [...prev.filter((u) => urls.includes(u)), ...urls.filter((u) => !prev.includes(u))])
    setSelectedVideos(urls)
  }

  const toggleVideo = (url: string, checked: boolean) => {
    setSelectedVideos((prev) => (checked ? [...prev, url] : prev.filter((u) => u !== url)))
  }

  const totalSelectedSkus = amazonSelected.length + ozonSelected.length
  const canSubmit = canEdit && !!productId && selectedVideos.length > 0 && totalSelectedSkus > 0 && !submitting

  const handleRefreshOzonStatus = async () => {
    const tasks = ozonResults
      .filter((r) => r.ok && r.task_id)
      .map((r) => ({ store_id: r.store_id, task_id: r.task_id!, batch_no: ozonBatchNo }))
    if (tasks.length === 0) return
    setStatusRefreshing(true)
    try {
      const resp = await videoBindingApi.getOzonUploadStatus(tasks)
      const next: OzonStatusMap = { ...statusMap }
      for (const r of resp.data?.data?.results || []) {
        next[`${r.store_id}_${r.task_id}`] = r
      }
      setStatusMap(next)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '查询任务状态失败')
    } finally {
      setStatusRefreshing(false)
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const items = [
        ...amazonSelected,
        ...ozonSelected,
      ].map((key) => {
        const [pp, store] = key.split('_')
        return { pp_id: Number(pp), store_id: Number(store) }
      })
      const resp = await videoBindingApi.uploadSkuVideos({
        product_id: productId!,
        video_urls: selectedVideos,
        items,
      })
      const body = resp.data
      const d = body?.data || {}
      setAmazonResult((d.amazon as typeof amazonResult) || null)
      setOzonResults(d.ozon?.results || [])
      setOzonBatchNo(d.ozon?.batch_no)
      setStatusMap({})
      setResultMessage(body?.message || (body?.success ? '提交成功' : '提交失败'))
      setResultOpen(true)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const ozonStatusTag = (r: OzonUploadResult) => {
    if (!r.ok) return <Tag color="error">提交失败</Tag>
    const st = statusMap[`${r.store_id}_${r.task_id}`]
    if (!st) return <Tag color="processing">已提交 · 待刷新</Tag>
    if (st.error) return <Tag color="error">查询失败</Tag>
    if (st.status === '成功') return <Tag color="success">成功</Tag>
    if (st.status === '失败') return <Tag color="error">失败</Tag>
    return <Tag color="processing">处理中</Tag>
  }

  if (!canEdit) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="warning" showIcon message="无权限" description="需要「产品编辑」或「AI视频审核」权限才能使用视频上传。" />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small" title={<Space><VideoCameraOutlined /> 视频统一上传</Space>} extra={
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          Amazon：写飞书多维表由 RPA 自动上传 ｜ Ozon：Seller API 直传（异步审核，飞书留痕）
        </span>
      }>
        <div style={{ maxWidth: 560 }}>
          <Select<number>
            showSearch
            allowClear
            value={productId ?? undefined}
            placeholder="搜索并选择产品（编码 / 名称）"
            style={{ width: '100%' }}
            filterOption={false}
            onSearch={handleProductSearch}
            onFocus={() => { if (productOptions.length === 0) searchProducts('') }}
            onSelect={handleProductSelect}
            onClear={() => {
              setProductId(null); setVideoOptions([]); setSelectedVideos([])
              setAmazonItems([]); setOzonItems([]); setAmazonSelected([]); setOzonSelected([])
            }}
            notFoundContent={productSearching ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配产品" />}
            options={productOptions.map((p) => ({ value: p.id, label: `${p.product_code}　${p.name}`, product_code: p.product_code, name: p.name } as any))}
          >
          </Select>
        </div>
      </Card>

      <Card size="small" title={<Space><CloudUploadOutlined /> 选择视频</Space>}
        extra={<span style={{ color: '#8c8c8c', fontSize: 12 }}>Ozon 每个商品最多 5 个视频（MP4/MOV 公网链接）</span>}
      >
        {!productId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择产品" style={{ padding: '12px 0' }} />
        ) : (
          <>
            {videoOptions.length === 0 && (
              <Alert type="info" showIcon message="该产品暂无视频，可在下方本地上传" style={{ marginBottom: 12 }} />
            )}
            {videoOptions.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8, marginBottom: 12 }}>
                {videoOptions.map((url) => (
                  <Checkbox key={url} checked={selectedVideos.includes(url)} onChange={(e) => toggleVideo(url, e.target.checked)}>
                    <span style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}>
                      {decodeURIComponent(url.split('?')[0].split('/').pop() || '视频')}
                    </span>
                  </Checkbox>
                ))}
              </div>
            )}
            <div style={{ maxWidth: 920 }}>
              <VideosUpload value={selectedVideos} onChange={handleVideosUploadChange} placeholder="本地上传新视频（自动勾选）" />
            </div>
            {selectedVideos.length > 5 && ozonSelected.length > 0 && (
              <Alert type="warning" showIcon style={{ marginTop: 12 }}
                message={`已选 ${selectedVideos.length} 个视频，Ozon 每商品最多 5 个，超出部分 Ozon 提交会被拒绝`} />
            )}
          </>
        )}
      </Card>

      <Card size="small" title={<Space><SearchOutlined /> 选择平台 SKU</Space>}
        extra={<span style={{ color: '#8c8c8c', fontSize: 12 }}>按平台分区勾选，提交后自动路由到对应上传通道</span>}
      >
        {!productId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择产品" style={{ padding: '12px 0' }} />
        ) : (
          <PlatformSkuSelector
            loading={skuLoading}
            amazonItems={amazonItems}
            ozonItems={ozonItems}
            amazonSelected={amazonSelected}
            ozonSelected={ozonSelected}
            onAmazonChange={setAmazonSelected}
            onOzonChange={setOzonSelected}
            amazonConfigured={amazonConfigured}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>
            已选 {selectedVideos.length} 视频 × {totalSelectedSkus} SKU
          </span>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={submitting} disabled={!canSubmit} onClick={handleSubmit}>
            一键上传（{totalSelectedSkus} SKU）
          </Button>
        </div>
      </Card>

      <Modal
        open={resultOpen}
        title="上传结果"
        width={680}
        onCancel={() => setResultOpen(false)}
        footer={[
          <Button key="close" onClick={() => setResultOpen(false)}>关闭</Button>,
          <Button key="refresh" icon={<ReloadOutlined />} loading={statusRefreshing}
            disabled={ozonResults.filter((r) => r.ok).length === 0}
            onClick={handleRefreshOzonStatus}>
            刷新 Ozon 状态
          </Button>,
        ]}
      >
        <Alert type={resultMessage.includes('失败') && !resultMessage.includes('已') ? 'error' : 'success'} showIcon
          message={resultMessage} style={{ marginBottom: 12 }} />
        {amazonResult && (
          <Card size="small" title={<Tag color="orange">Amazon</Tag>} style={{ marginBottom: 12 }}>
            {amazonResult.error ? (
              <Alert type="error" showIcon message={amazonResult.error} />
            ) : (
              <>
                <p>飞书记录写入成功 {amazonResult.success ?? 0} 条{amazonResult.failed ? `，失败 ${amazonResult.failed} 条` : ''}</p>
                {amazonResult.errors && amazonResult.errors.length > 0 && (
                  <ul style={{ color: '#cf1322', fontSize: 12, margin: 0, paddingLeft: 18 }}>
                    {amazonResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </>
            )}
          </Card>
        )}
        {ozonResults.length > 0 && (
          <Card size="small" title={<Tag color="blue">OZON</Tag>}
            extra={<span style={{ color: '#8c8c8c', fontSize: 12 }}>Ozon 视频需平台审核，接口成功仅代表任务受理</span>}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#8c8c8c', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>店铺</th>
                  <th style={{ padding: '6px 8px' }}>SKU</th>
                  <th style={{ padding: '6px 8px' }}>任务ID</th>
                  <th style={{ padding: '6px 8px' }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {ozonResults.map((r, i) => {
                  const st = statusMap[`${r.store_id}_${r.task_id}`]
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '6px 8px' }}>{r.store_name || `店铺#${r.store_id}`}</td>
                      <td style={{ padding: '6px 8px' }}>{r.offer_ids.join('、')}</td>
                      <td style={{ padding: '6px 8px' }}>{r.ok ? r.task_id : '-'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {ozonStatusTag(r)}
                        {st?.error && <div style={{ color: '#cf1322', fontSize: 12 }}>{st.error}</div>}
                        {st?.error_text && <div style={{ color: '#cf1322', fontSize: 12, whiteSpace: 'pre-wrap' }}>{st.error_text}</div>}
                        {!r.ok && <div style={{ color: '#cf1322', fontSize: 12 }}>{r.error}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </Modal>
    </div>
  )
}

export default VideoUploadCenter
