import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Button, Card, Checkbox, Descriptions, Empty, Image, Input, Modal, Pagination, Popover, Select, Space, Spin,
  Table, Tabs, Tag, Timeline, Tooltip, message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, DownOutlined, EyeOutlined,
  BulbOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, SendOutlined, ThunderboltOutlined, VideoCameraOutlined,
} from '@ant-design/icons'
import {
  mediaRequestApi, MediaPlan, MediaRequestItem, MediaStage, ProductSkuEntry, ProductSkuGroup, productsApi, videoBindingApi,
} from '../api'
import TosUpload from '../components/TosUpload'
import { useAuth } from '../contexts/AuthContext'

/**
 * 媒体任务中心
 *
 * 运营提报 → 运营主管审核需求 → 美工微调提示词并生成 → 美工审核成片
 * → 运营二次审核 → 待高清（强制 Topaz 超分）→ 待绑定（绑定至产品审核）
 * → 待上传 → Amazon（飞书 + RPA）/ Ozon（Seller API）上传 → 已上传
 *
 * 单据存 media_requests，生成走 AI 视频（MiniMax H3），高清复用超分服务，
 * 绑定复用媒体绑定审核通道，上传走 video_bindings 统一通道。
 * 门禁在后端强校验：未高清不能绑定，未绑定不能上传。
 */

const STAGES: MediaStage[] = ['待提交', '待审核', '待生成', '已生成', '待确认', '待高清', '待绑定', '待上传', '已上传']

const STAGE_HINT: Record<MediaStage, string> = {
  待提交: '运营提报视频需求：选择产品与目标平台 SKU，填写需求类型与需求描述后提交。可在此阶段修改需求描述/需求类型。',
  待审核: '运营主管审核需求：通过后按需求类型拆成待生成子单（勾 N 个类型拆 N 条）；驳回退回待提交。',
  待生成: '美工微调提示词、上传参考图（1~9 张）并设置时长/比例/分辨率，点击生成调用 AI 视频；生成完成后自动进入已生成。',
  已生成: '美工审核成片内容：通过后进入待确认；不通过退回待生成，需重新生成。',
  待确认: '运营二次审核内容：通过后进入待高清；驳回退回待生成重新生成。',
  待高清: '强制高清门禁：成片必须先完成高清处理（Topaz 超分，档位可选）才能进入绑定；高清中自动等待，失败可重新提交。',
  待绑定: '绑定门禁：提交「绑定至产品」申请，审核人直接在本页任务行上通过/拒绝；通过后视频写入产品并自动进入待上传。',
  待上传: '已绑定产品后，按提报时选择的平台 SKU 上传：Amazon 写飞书多维表由 RPA 上传，Ozon 走 Seller API 直传（异步审核）。',
  已上传: '流程结束：成片已提交至所属平台，可查看上传时间与上传结果。',
}

const DEMAND_TYPES = ['口播带货视频', '产品展示视频', 'AI图片']
const DEMAND_COLOR: Record<string, string> = { 口播带货视频: 'purple', 产品展示视频: 'blue', AI图片: 'gold' }
const isImageDemand = (t?: string | null) => t === 'AI图片'
const RATIOS = ['9:16', '16:9', '1:1', '3:4']
const RESOLUTIONS: { value: string; label: string }[] = [
  { value: '0.3', label: '0.3K 快速' },
  { value: '0.5', label: '0.5K 标清' },
  { value: '0.9', label: '0.9K 高清' },
]
const DURATIONS = [5, 10, 15]
const PAGE_SIZE = 20

const errText = (e: any) => e?.response?.data?.detail || e?.message || '操作失败'

const platformMeta = (p?: string | null) => {
  const key = (p || '').toLowerCase()
  if (key === 'ozon') return { label: 'Ozon', color: 'blue' }
  if (key === 'amazon') return { label: 'Amazon', color: 'orange' }
  return { label: p || '-', color: 'default' }
}

const VideoUploadCenter: React.FC<{ initialTab?: 'tasks' | 'binding' }> = ({ initialTab = 'tasks' }) => {
  const { hasPermission } = useAuth()
  const canReport = hasPermission('ai_video:use') || hasPermission('product:edit')
  const canReview = hasPermission('ai_video:approve')
  const canWork = hasPermission('ai_video:use') || hasPermission('product:edit')
  const canUpload = hasPermission('ai_video:approve') || hasPermission('product:edit')

  // ===== 列表 =====
  const [stage, setStage] = useState<MediaStage>(initialTab === 'binding' && canReview ? '待绑定' : '待提交')
  const [items, setItems] = useState<MediaRequestItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<{ op: string; platform?: string; keyword: string }>({ op: '', keyword: '' })
  const [filterInput, setFilterInput] = useState({ op: '', keyword: '' })
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchLoading, setBatchLoading] = useState(false)

  // ===== 弹窗 =====
  const [detailItem, setDetailItem] = useState<MediaRequestItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [logItem, setLogItem] = useState<MediaRequestItem | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<{ open: boolean; message: string; data?: unknown }>({ open: false, message: '' })
  const [planLoadingId, setPlanLoadingId] = useState<number | null>(null)
  // 待高清档位（每行独立记忆，默认 2.0x）
  const [hdScales, setHdScales] = useState<Record<number, number>>({})
  const hdScaleOf = (id: number) => hdScales[id] ?? 2
  const [planModal, setPlanModal] = useState<{ open: boolean; plan?: MediaPlan | null; item?: MediaRequestItem | null }>({ open: false })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerImages, setPickerImages] = useState<string[]>([])
  const [pickerSelected, setPickerSelected] = useState<string[]>([])
  // 行内需求类型下拉（待提交）
  const [dtPopId, setDtPopId] = useState<number | null>(null)
  const [pickerTarget, setPickerTarget] = useState<{ kind: 'row'; item: MediaRequestItem } | null>(null)

  // ===== 新增提报 =====
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  // 提报弹窗：按产品分组（展开选择具体店铺/SKU），选中项落到「待提交」后逐条填写需求
  const [skuGroups, setSkuGroups] = useState<ProductSkuGroup[]>([])
  const [skuTotal, setSkuTotal] = useState(0)
  const [skuPage, setSkuPage] = useState(1)
  const [skuLoading, setSkuLoading] = useState(false)
  const [skuKeyword, setSkuKeyword] = useState('')
  const [skuKeywordInput, setSkuKeywordInput] = useState('')
  const [skuPlatform, setSkuPlatform] = useState<string | undefined>()
  const [skuSelected, setSkuSelected] = useState<Record<string, ProductSkuEntry>>({})
  const reasonRef = useRef('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const resp = await mediaRequestApi.list({
        stage,
        page,
        page_size: PAGE_SIZE,
        op: filters.op || undefined,
        platform: filters.platform || undefined,
        keyword: filters.keyword || undefined,
      })
      const d = resp.data?.data
      setItems(d?.items || [])
      setCounts(d?.counts || {})
      setTotal(d?.total || 0)
    } catch (e: any) {
      if (!silent) message.error(errText(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [stage, page, filters])

  useEffect(() => {
    setSelectedRowKeys([])
    load()
  }, [load])

  // 有「生成中 / 高清中」单据时轮询，后台任务完成后会自动流转到下一阶段
  useEffect(() => {
    const busy = items.some((i) => i.gen_status === '生成中' || i.hd_status === '高清中')
    if (!busy) return
    const timer = setInterval(() => load(true), 5000)
    return () => clearInterval(timer)
  }, [items, load])

  const skuKeyOf = (e: { pp_id: number; store_id: number }) => `${e.pp_id}_${e.store_id}`

  // ===== 提报弹窗：产品分组 / 勾选 / 添加 =====
  const loadSkus = useCallback(async (page = 1, keyword = skuKeyword, platform = skuPlatform, silent = false) => {
    if (!silent) setSkuLoading(true)
    try {
      const resp = await mediaRequestApi.listProductSkus({ page, page_size: 10, keyword: keyword || undefined, platform: platform || undefined })
      const d = resp.data?.data
      setSkuGroups(d?.items || [])
      setSkuTotal(d?.total || 0)
      setSkuPage(page)
    } catch (e: any) {
      message.error(errText(e))
    } finally {
      if (!silent) setSkuLoading(false)
    }
  }, [skuKeyword, skuPlatform])

  const openCreate = () => {
    setSkuKeyword(''); setSkuKeywordInput(''); setSkuPlatform(undefined)
    setSkuSelected({}); setSkuPage(1)
    setCreateOpen(true)
    loadSkus(1, '', undefined)
  }

  const toggleSku = (entry: ProductSkuEntry) => {
    const key = skuKeyOf(entry)
    setSkuSelected((prev) => {
      if (prev[key]) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      if (!entry.usable) {
        message.warning(entry.unusable_reason || '该 SKU 暂不可上传')
        return prev
      }
      return { ...prev, [key]: entry }
    })
  }

  // 勾选整个产品的全部可上传 SKU / 取消该产品全部勾选
  const toggleGroup = (group: ProductSkuGroup, checked: boolean) => {
    setSkuSelected((prev) => {
      const next = { ...prev }
      group.entries.forEach((e) => {
        if (!e.usable) return
        if (checked) next[skuKeyOf(e)] = e
        else delete next[skuKeyOf(e)]
      })
      return next
    })
  }

  const groupSelCount = (group: ProductSkuGroup) =>
    group.entries.filter((e) => skuSelected[skuKeyOf(e)]).length
  const groupUsableCount = (group: ProductSkuGroup) =>
    group.entries.filter((e) => e.usable).length

  const resetCreate = () => {
    setSkuSelected({})
  }

  const handleCreate = async () => {
    const selected = Object.values(skuSelected)
    if (!selected.length) { message.warning('请先展开勾选要提报的店铺/SKU'); return }

    // 按产品分组：同一产品的多个 SKU 合为一张提报单；需求在添加后逐条填写（提交前必填）
    const byProduct = new Map<number, ProductSkuEntry[]>()
    selected.forEach((e) => {
      const list = byProduct.get(e.product_id) || []
      list.push(e)
      byProduct.set(e.product_id, list)
    })

    setCreating(true)
    let okCount = 0
    let failCount = 0
    try {
      for (const [pid, entries] of byProduct) {
        try {
          await mediaRequestApi.create({
            product_id: pid,
            platform_items: entries.map((e) => ({ pp_id: e.pp_id, store_id: e.store_id })),
          })
          okCount += 1
        } catch {
          failCount += 1
        }
      }
      if (okCount) {
        message.success(`已添加 ${okCount} 张提报单${failCount ? `，失败 ${failCount} 张` : ''}，请在「待提交」逐条填写需求后提交`)
        setCreateOpen(false)
        resetCreate()
        setStage('待提交'); setPage(1)
        load()
      } else {
        message.error('提报创建失败，请重试')
      }
    } finally {
      setCreating(false)
    }
  }

  // ===== 单据操作 =====
  const refreshAfter = async (msg: string) => {
    message.success(msg)
    await load(true)
  }

  const doSubmit = async (id: number) => {
    try {
      const r = await mediaRequestApi.submit(id)
      await refreshAfter(r.data?.message || '已提交至「待审核」')
    } catch (e: any) { message.error(errText(e)) }
  }

  const askReason = (title: string, onOk: (reason: string) => void) => {
    reasonRef.current = ''
    Modal.confirm({
      title,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="填写原因（选填）"
          onChange={(e) => { reasonRef.current = e.target.value }}
          style={{ marginTop: 8 }}
        />
      ),
      okText: '确认',
      cancelText: '取消',
      onOk: () => onOk(reasonRef.current),
    })
  }

  const doReview = async (id: number, passed: boolean, reason?: string) => {
    try {
      const r = await mediaRequestApi.review(id, { passed, reason })
      await refreshAfter(r.data?.message || (passed ? '审核通过' : '已驳回'))
    } catch (e: any) { message.error(errText(e)) }
  }

  const doGenerate = async (id: number) => {
    try {
      const r = await mediaRequestApi.generate(id)
      await refreshAfter(r.data?.message || '已提交 AI 生成')
    } catch (e: any) { message.error(errText(e)) }
  }

  const doGenReview = async (id: number, passed: boolean, reason?: string) => {
    try {
      const r = await mediaRequestApi.genReview(id, { passed, reason })
      await refreshAfter(r.data?.message || (passed ? '成片审核通过' : '已退回重新生成'))
    } catch (e: any) { message.error(errText(e)) }
  }

  const doConfirm = async (id: number, passed: boolean, reason?: string) => {
    try {
      const r = await mediaRequestApi.confirm(id, { passed, reason })
      await refreshAfter(r.data?.message || (passed ? '二次审核通过' : '已驳回'))
    } catch (e: any) { message.error(errText(e)) }
  }

  const doUpscale = async (id: number, scale?: number) => {
    try {
      const r = await mediaRequestApi.upscale(id, scale)
      await refreshAfter(r.data?.message || '已提交高清处理')
    } catch (e: any) { message.error(errText(e)) }
  }

  const doBind = async (id: number) => {
    try {
      const r = await mediaRequestApi.bind(id)
      await refreshAfter(r.data?.message || '绑定申请已提交')
    } catch (e: any) { message.error(errText(e)) }
  }

  // 待绑定行内直接审核：通过后视频写入产品并自动流转「待上传」，拒绝则留在待绑定可重提
  const doBindReview = async (bindingId: number, passed: boolean, reason?: string) => {
    try {
      const r = passed
        ? await videoBindingApi.approve(bindingId)
        : await videoBindingApi.reject(bindingId, reason)
      await refreshAfter(r.data?.message || (passed ? '绑定审核通过' : '已拒绝'))
    } catch (e: any) { message.error(errText(e)) }
  }

  const doUpload = async (id: number) => {
    Modal.confirm({
      title: '确认上传至所属平台？',
      content: '将按提报时选择的平台 SKU 上传成片：Amazon 写入飞书多维表由 RPA 上传；Ozon 走 Seller API 直传（异步审核）。',
      okText: '开始上传',
      cancelText: '取消',
      onOk: async () => {
        try {
          const r = await mediaRequestApi.upload(id)
          setUploadResult({ open: true, message: r.data?.message || '上传完成', data: r.data?.data })
          await load(true)
        } catch (e: any) { message.error(errText(e)) }
      },
    })
  }

  const runBatch = async (label: string, fn: (id: number) => Promise<void>) => {
    if (!selectedRowKeys.length) return
    setBatchLoading(true)
    let ok = 0
    let fail = 0
    for (const key of selectedRowKeys) {
      try {
        await fn(Number(key))
        ok += 1
      } catch {
        fail += 1
      }
    }
    setBatchLoading(false)
    setSelectedRowKeys([])
    await load(true)
    message[fail ? 'warning' : 'success'](`${label}完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`)
  }

  // ===== 行内编辑（待生成） =====
  const patch = async (id: number, data: Parameters<typeof mediaRequestApi.update>[1], ok = '已保存') => {
    try {
      await mediaRequestApi.update(id, data)
      message.success(ok)
      await load(true)
    } catch (e: any) { message.error(errText(e)) }
  }

  // ===== AI 生成方案（只生成 1 套，回填提示词） =====
  const doGeneratePlan = async (item: MediaRequestItem) => {
    if (!(item.ref_images || []).length) {
      message.warning('请先选择/上传参考图，再生成方案')
      return
    }
    setPlanLoadingId(item.id)
    const hide = message.loading('AI 正在生成方案，约需 1~5 分钟…', 0)
    try {
      const resp = await mediaRequestApi.generatePlan(item.id)
      hide()
      const plan = resp.data?.data?.plan || null
      message.success(resp.data?.message || '已生成 1 套方案并回填提示词')
      setPlanModal({ open: true, plan, item })
      await load(true)
    } catch (e: any) {
      hide()
      message.error(errText(e))
    } finally {
      setPlanLoadingId(null)
    }
  }

  // ===== 从产品管理选择参考图（待生成行内） =====
  const openProductPicker = async (productId: number, item: MediaRequestItem) => {
    setPickerTarget({ kind: 'row', item })
    setPickerOpen(true)
    setPickerLoading(true)
    setPickerImages([])
    setPickerSelected([])
    try {
      const resp = await productsApi.getById(productId)
      const p = (resp.data?.data || {}) as { main_image?: string; images?: string[] | string }
      let images = p.images
      if (typeof images === 'string') {
        try { images = JSON.parse(images) } catch { images = [] }
      }
      const urls = [p.main_image, ...(Array.isArray(images) ? images : [])].filter(Boolean) as string[]
      const unique = Array.from(new Set(urls))
      setPickerImages(unique)
      setPickerSelected((item.ref_images || []).filter((u) => unique.includes(u)))
    } catch (e: any) {
      message.error(errText(e))
    } finally {
      setPickerLoading(false)
    }
  }

  const confirmPicker = async () => {
    if (!pickerTarget) { setPickerOpen(false); return }
    const current = pickerTarget.item.ref_images || []
    const merged = [...current, ...pickerSelected.filter((u) => !current.includes(u))].slice(0, 9)
    await patch(pickerTarget.item.id, { ref_images: merged }, '参考图已更新')
    setPickerOpen(false)
  }

  const togglePicker = (url: string) => {
    setPickerSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url)
      if (prev.length >= 9) {
        message.warning('参考图最多 9 张')
        return prev
      }
      return [...prev, url]
    })
  }

  const openDetail = async (id: number) => {
    setDetailLoading(true)
    setDetailItem(null)
    try {
      const resp = await mediaRequestApi.get(id)
      setDetailItem(resp.data?.data || null)
    } catch (e: any) {
      message.error(errText(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const openLog = async (id: number) => {
    setLogItem(null)
    try {
      const resp = await mediaRequestApi.get(id)
      setLogItem(resp.data?.data || null)
    } catch (e: any) {
      message.error(errText(e))
    }
  }

  const savePrompt = (item: MediaRequestItem, value: string) => {
    const next = value.trim()
    if (next === (item.prompt || '')) return
    patch(item.id, { prompt: next }, '提示词已保存')
  }

  // 行内保存需求类型（待提交）：本地即时更新 + 静默保存，不整表刷新以免下拉关闭
  const saveDemands = async (item: MediaRequestItem, types: string[]) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, demand_types: types } : i)))
    try {
      await mediaRequestApi.update(item.id, { demand_types: types })
      message.success('需求类型已保存')
    } catch (e: any) {
      message.error(errText(e))
      load(true)
    }
  }

  // 行内保存需求描述（待提交）
  const saveDesc = (item: MediaRequestItem, value: string) => {
    const next = value.trim()
    if (next === (item.description || '')) return
    patch(item.id, { description: next }, '需求描述已保存')
  }

  const addRefImage = (item: MediaRequestItem, url: string) => {
    if (!url) return
    if ((item.ref_images || []).includes(url)) return
    patch(item.id, { ref_images: [...(item.ref_images || []), url] }, '参考图已添加')
  }

  const removeRefImage = (item: MediaRequestItem, url: string) => {
    patch(item.id, { ref_images: (item.ref_images || []).filter((u) => u !== url) }, '参考图已删除')
  }

  // ===== 表格 =====
  const columns: ColumnsType<MediaRequestItem> = (() => {
    const editable = stage === '待生成'

    const base: ColumnsType<MediaRequestItem> = [
      {
        title: '', key: 'no', width: 48, fixed: 'left', align: 'center',
        render: (_v, _r, idx) => (
          <span style={{ color: '#98a2b3', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {(page - 1) * PAGE_SIZE + idx + 1}
          </span>
        ),
        onCell: () => ({
          style: {
            textAlign: 'center', background: '#f7f9fc',
            borderRight: '2px solid #cbd6e6', paddingLeft: 0, paddingRight: 0,
          },
        }),
        onHeaderCell: () => ({
          style: {
            textAlign: 'center', background: '#f7f9fc',
            borderRight: '2px solid #cbd6e6', paddingLeft: 0, paddingRight: 0,
          },
        }),
      },
      {
        title: '单据关联号', dataIndex: 'seq', width: 96,
        render: (v: string) => {
          const i = String(v || '').indexOf('-')
          return i < 0
            ? <span style={{ fontWeight: 700 }}>{v}</span>
            : <span style={{ fontWeight: 700 }}>{String(v).slice(0, i)}<span style={{ color: '#1677ff' }}>-{String(v).slice(i + 1)}</span></span>
        },
      },
      { title: '运营', dataIndex: 'submitter_name', width: 96, render: (v) => v || '-' },
      {
        title: '平台', dataIndex: 'platform', width: 96,
        render: (v) => {
          const m = platformMeta(v)
          return <Tag color={m.color}>{m.label}</Tag>
        },
      },
      {
        title: '商品', dataIndex: 'product_code', width: 268,
        render: (_, r) => (
          <Space size={8} align="start">
            {r.product_image
              ? <Image src={r.product_image} width={42} height={42} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} />
              : <div style={{ width: 42, height: 42, borderRadius: 6, background: '#f5f5f5' }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{r.product_code}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.product_name}>
                {r.product_name}
              </div>
            </div>
          </Space>
        ),
      },
      {
        title: '目标 SKU', dataIndex: 'platform_items', width: 230,
        render: (_, r) => {
          const list = r.platform_items || []
          if (!list.length) return '-'
          const first = list[0]
          return (
            <Tooltip
              title={list.map((i) => `${platformMeta(i.platform).label} · ${i.store_name || `店铺#${i.store_id}`} · ${i.sku || '-'}`).join('；')}
            >
              <div>
                <div style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 12 }}>{first.sku || '-'}</div>
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                  {first.store_name || `店铺#${first.store_id}`}{first.site ? ` · ${first.site}` : ''}{list.length > 1 ? ` 等 ${list.length} 个` : ''}
                </div>
              </div>
            </Tooltip>
          )
        },
      },
      {
        title: '需求类型', dataIndex: 'demand_type', width: 160,
        render: (_, r) => {
          const types = r.demand_type ? [r.demand_type] : (r.demand_types || [])
          if (stage === '待提交') {
            // 行内下拉多选：勾选即保存，参考需求演示页交互
            const sel = r.demand_types || []
            return (
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={dtPopId === r.id}
                onOpenChange={(o) => setDtPopId(o ? r.id : null)}
                content={
                  <div style={{ minWidth: 170 }}>
                    {DEMAND_TYPES.map((t) => (
                      <div
                        key={t}
                        onClick={() => saveDemands(r, sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t])}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f2f6ff' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <Checkbox checked={sel.includes(t)} />
                        <Tag color={DEMAND_COLOR[t] || 'default'} style={{ margin: 0 }}>{t}</Tag>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', marginTop: 6, paddingTop: 6 }}>
                      <span style={{ color: '#a5adba', fontSize: 12 }}>可多选，勾选即生效</span>
                      <Button type="link" size="small" style={{ padding: 0 }} onClick={() => saveDemands(r, [])}>清空</Button>
                    </div>
                  </div>
                }
              >
                <Button
                  size="small"
                  style={{ width: '100%', justifyContent: 'flex-start', maxWidth: 150, overflow: 'hidden' }}
                  icon={<DownOutlined style={{ fontSize: 9, color: '#a8b0bd' }} />}
                  iconPosition="end"
                >
                  {sel.length
                    ? <span>{sel.map((t) => <Tag key={t} color={DEMAND_COLOR[t] || 'default'} style={{ margin: '0 3px 0 0' }}>{t}</Tag>)}</span>
                    : <span style={{ color: '#b7bec9' }}>请选择需求类型</span>}
                </Button>
              </Popover>
            )
          }
          return types.length
            ? <>{types.map((t) => <Tag key={t} color={DEMAND_COLOR[t] || 'default'} style={{ marginBottom: 2 }}>{t}</Tag>)}</>
            : <span style={{ color: '#bfbfbf' }}>未选择</span>
        },
      },
      {
        title: '需求描述', dataIndex: 'description', width: 240,
        render: (_, r) => stage === '待提交'
          ? (
            <Input.TextArea
              key={`${r.id}-${r.description || ''}`}
              defaultValue={r.description || ''}
              placeholder="请填写需求描述（提交前必填）"
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ width: 220, fontSize: 12 }}
              onBlur={(e) => saveDesc(r, e.target.value)}
            />
          )
          : (
            <Tooltip title={r.description || ''} placement="topLeft">
              <div style={{ maxHeight: 44, overflow: 'hidden', lineHeight: 1.55, color: r.description ? undefined : '#bfbfbf' }}>{r.description || '—'}</div>
            </Tooltip>
          ),
      },
    ]

    if (stage === '待审核') {
      base.push({ title: '提交时间', dataIndex: 'submit_time', width: 150, render: (v) => v || '-' })
    }

    if (['待生成', '已生成', '待确认', '待上传', '已上传'].includes(stage)) {
      base.push({
        title: '提示词 / 方案', dataIndex: 'prompt', width: 280,
        render: (_, r) => editable
          ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Input.TextArea
                key={`${r.id}-${r.prompt || ''}`}
                defaultValue={r.prompt || ''}
                placeholder={isImageDemand(r.demand_type) ? 'AI生图提示词（选填，也可在 AI生图 页填写）' : '填写/微调视频提示词，或点下方 AI 生成方案'}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ width: 250, fontSize: 12 }}
                onBlur={(e) => savePrompt(r, e.target.value)}
              />
              {!isImageDemand(r.demand_type) && (
                <Space size={4} wrap>
                  <Button
                    size="small" type="link" icon={<BulbOutlined />}
                    loading={planLoadingId === r.id}
                    onClick={() => doGeneratePlan(r)}
                  >
                    {r.plan ? '重新生成方案' : 'AI生成方案'}
                  </Button>
                  {r.plan && (
                    <Button size="small" type="link" onClick={() => setPlanModal({ open: true, plan: r.plan, item: r })}>
                      查看方案
                    </Button>
                  )}
                </Space>
              )}
            </div>
          )
          : (
            <div>
              <Tooltip title={r.prompt || ''} placement="topLeft">
                <div style={{ maxHeight: 44, overflow: 'hidden', lineHeight: 1.55, color: r.prompt ? undefined : '#bfbfbf' }}>{r.prompt || '未填写'}</div>
              </Tooltip>
              {r.plan && (
                <Button size="small" type="link" style={{ paddingInline: 0 }} onClick={() => setPlanModal({ open: true, plan: r.plan, item: r })}>
                  查看方案
                </Button>
              )}
            </div>
          ),
      })
      base.push({
        title: '参考图', dataIndex: 'ref_images', width: 190,
        render: (_, r) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 180 }}>
              {(r.ref_images || []).map((url) => (
                <div key={url} style={{ position: 'relative' }}>
                  <Image src={url} width={34} height={34} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  {editable && (
                    <Button
                      size="small" type="text" danger icon={<DeleteOutlined />}
                      style={{ position: 'absolute', top: -8, right: -10, width: 18, height: 18 }}
                      onClick={() => removeRefImage(r, url)}
                    />
                  )}
                </div>
              ))}
              {editable && (r.ref_images || []).length < 9 && (
                <TosUpload
                  key={`${r.id}-${(r.ref_images || []).length}`}
                  type="image"
                  placeholder="+ 参考图"
                  onChange={(url) => addRefImage(r, url || '')}
                />
              )}
              {!editable && !(r.ref_images || []).length && <span style={{ color: '#bfbfbf' }}>未上传</span>}
            </div>
            {editable && (
              <Button
                size="small" type="link" icon={<PictureOutlined />} style={{ paddingInline: 0 }}
                onClick={() => openProductPicker(r.product_id, r)}
              >
                从产品图选择
              </Button>
            )}
          </div>
        ),
      })
      base.push({
        title: '参数', dataIndex: 'ratio', width: 210,
        render: (_, r) => {
          if (isImageDemand(r.demand_type)) return <span style={{ color: '#bfbfbf' }}>—</span>
          return editable
            ? (
              <Space size={4} direction="vertical" style={{ width: 190 }}>
                <Space size={4}>
                  <Select size="small" value={r.ratio} style={{ width: 78 }} options={RATIOS.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => patch(r.id, { ratio: v }, '比例已保存')} />
                  <Select size="small" value={String(r.duration)} style={{ width: 76 }} options={DURATIONS.map((v) => ({ value: String(v), label: `${v}s` }))}
                    onChange={(v) => patch(r.id, { duration: Number(v) }, '时长已保存')} />
                </Space>
                <Select size="small" value={r.resolution} style={{ width: 160 }} options={RESOLUTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(v) => patch(r.id, { resolution: v }, '分辨率已保存')} />
              </Space>
            )
            : <span style={{ fontSize: 12 }}>{r.ratio} · {r.duration}s · {RESOLUTIONS.find((o) => o.value === r.resolution)?.label || r.resolution}</span>
        },
      })
    }

    // 待提交：参考图同样行内编辑（本地上传 / 从产品图选择 / 删除）
    if (stage === '待提交') {
      base.push({
        title: '参考图', dataIndex: 'ref_images', width: 190,
        render: (_, r) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 180 }}>
              {(r.ref_images || []).map((url) => (
                <div key={url} style={{ position: 'relative' }}>
                  <Image src={url} width={34} height={34} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  <Button
                    size="small" type="text" danger icon={<DeleteOutlined />}
                    style={{ position: 'absolute', top: -8, right: -10, width: 18, height: 18 }}
                    onClick={() => removeRefImage(r, url)}
                  />
                </div>
              ))}
              {(r.ref_images || []).length < 9 && (
                <TosUpload
                  key={`${r.id}-${(r.ref_images || []).length}`}
                  type="image"
                  placeholder="+ 参考图"
                  onChange={(url) => addRefImage(r, url || '')}
                />
              )}
              {!(r.ref_images || []).length && <span style={{ color: '#bfbfbf' }}>未上传（选填）</span>}
            </div>
            <Button
              size="small" type="link" icon={<PictureOutlined />} style={{ paddingInline: 0 }}
              onClick={() => openProductPicker(r.product_id, r)}
            >
              从产品图选择
            </Button>
          </div>
        ),
      })
    }

    if (stage === '待生成') {
      base.push({
        title: '生成状态', dataIndex: 'gen_status', width: 110,
        render: (_, r) => {
          if (isImageDemand(r.demand_type)) {
            return r.media_url ? <Tag color="success">已上传成片</Tag> : <Tag>待上传成片</Tag>
          }
          return r.gen_status === '生成中'
            ? <Tag color="processing">生成中</Tag>
            : r.gen_status === '失败'
              ? <Tag color="error">生成失败</Tag>
              : r.media_url ? <Tag color="success">已生成</Tag> : <Tag>未生成</Tag>
        },
      })
    }

    if (['待生成', '已生成', '待确认', '待上传', '已上传'].includes(stage)) {
      base.push({ title: '生成时间', dataIndex: 'gen_time', width: 150, render: (v) => v || '-' })
    }

    if (stage === '待高清') {
      base.push({
        title: '高清状态', dataIndex: 'hd_status', width: 110,
        render: (_, r) => r.hd_status === '高清中'
          ? <Tag color="processing">高清中</Tag>
          : r.hd_status === '失败'
            ? <Tag color="error">高清失败</Tag>
            : <Tag>待高清</Tag>,
      })
    }

    if (['待高清', '待绑定', '待上传', '已上传'].includes(stage)) {
      base.push({ title: '高清时间', dataIndex: 'hd_time', width: 150, render: (v) => v || '-' })
    }

    if (['已生成', '待确认', '待高清', '待绑定', '待上传', '已上传'].includes(stage)) {
      base.push({
        title: '成片', dataIndex: 'media_url', width: 100,
        render: (_, r) => r.media_url
          ? <Button size="small" type="link" icon={<VideoCameraOutlined />} onClick={() => setVideoUrl(r.media_url!)}>查看</Button>
          : <span style={{ color: '#bfbfbf' }}>—</span>,
      })
    }

    if (['待绑定', '待上传', '已上传'].includes(stage)) {
      base.push({
        title: '高清成片', dataIndex: 'hd_url', width: 100,
        render: (_, r) => r.hd_url
          ? <Button size="small" type="link" icon={<VideoCameraOutlined />} onClick={() => setVideoUrl(r.hd_url!)}>查看</Button>
          : <span style={{ color: '#bfbfbf' }}>{stage === '待绑定' ? '未高清' : '—'}</span>,
      })
    }

    if (stage === '待绑定') {
      base.push({
        title: '绑定状态', dataIndex: 'bind_status', width: 110,
        render: (v) => v === '审核中'
          ? <Tag color="processing">审核中</Tag>
          : v === '已拒绝'
            ? <Tag color="error">已拒绝</Tag>
            : <Tag>未提交</Tag>,
      })
    }

    if (stage === '待上传') {
      base.push({
        title: '上传状态', dataIndex: 'upload_status', width: 110,
        render: (v) => v === '上传失败' ? <Tag color="error">上传失败</Tag> : v ? <Tag color="success">{v}</Tag> : <Tag>待上传</Tag>,
      })
      base.push({ title: '上传时间', dataIndex: 'upload_time', width: 150, render: (v) => v || '-' })
    }
    if (stage === '已上传') {
      base.push({ title: '上传时间', dataIndex: 'upload_time', width: 150, render: (v) => v || '-' })
    }

    base.push({
      title: '操作', key: 'ops', width: 230, fixed: 'right',
      render: (_, r) => {
        const btns: React.ReactNode[] = []
        if (stage === '待提交' && canReport) {
          btns.push(<Button key="submit" size="small" type="primary" icon={<SendOutlined />} onClick={() => doSubmit(r.id)}>提交</Button>)
        }
        if (stage === '待审核' && canReview) {
          btns.push(<Button key="pass" size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => doReview(r.id, true)}>通过</Button>)
          btns.push(<Button key="reject" size="small" danger onClick={() => askReason('驳回需求（退回待提交）', (reason) => doReview(r.id, false, reason))}>驳回</Button>)
        }
        if (stage === '待生成' && canWork) {
          if (isImageDemand(r.demand_type)) {
            // AI图片：美工在 AI生图 完成后直接上传成片（图片），进入已生成审核
            btns.push(
              <TosUpload
                key={`upmedia-${r.id}-${r.media_url ? 1 : 0}`}
                type="image"
                placeholder={r.media_url ? '重新上传成片' : '上传成片'}
                onChange={(url) => {
                  if (!url) return
                  mediaRequestApi.uploadMedia(r.id, url)
                    .then(async (res) => { await refreshAfter(res.data?.message || '成片已上传') })
                    .catch((e: any) => message.error(errText(e)))
                }}
              />,
            )
          } else {
            const generating = r.gen_status === '生成中'
            btns.push(
              <Button key="gen" size="small" type="primary" icon={<ThunderboltOutlined />} loading={generating} disabled={generating} onClick={() => doGenerate(r.id)}>
                {generating ? '生成中…' : r.gen_status === '失败' ? '重新生成' : '生成'}
              </Button>,
            )
          }
        }
        if (stage === '已生成' && canWork) {
          btns.push(<Button key="pass" size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => doGenReview(r.id, true)}>通过</Button>)
          btns.push(<Button key="reject" size="small" danger onClick={() => askReason('成片审核不通过（退回待生成）', (reason) => doGenReview(r.id, false, reason))}>不通过</Button>)
        }
        if (stage === '待确认' && canReview) {
          btns.push(<Button key="pass" size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => doConfirm(r.id, true)}>确认</Button>)
          btns.push(<Button key="reject" size="small" danger onClick={() => askReason('运营驳回（退回待生成）', (reason) => doConfirm(r.id, false, reason))}>驳回</Button>)
        }
        if (stage === '待高清' && canWork) {
          const hdBusy = r.hd_status === '高清中'
          btns.push(
            <Select
              key="hdscale" size="small" style={{ width: 72 }} value={hdScaleOf(r.id)} disabled={hdBusy}
              options={[1.5, 2, 3, 4].map((v) => ({ value: v, label: `${v}x` }))}
              onChange={(v) => setHdScales((p) => ({ ...p, [r.id]: v }))}
            />,
            <Tooltip key="hd" title={r.media_url ? '' : '缺少成片地址，无法提交高清'}>
              <Button
                size="small" type="primary" icon={<ThunderboltOutlined />}
                loading={hdBusy} disabled={hdBusy || !r.media_url} onClick={() => doUpscale(r.id, hdScaleOf(r.id))}
              >
                {hdBusy ? '高清中…' : r.hd_status === '失败' ? '重新高清' : '提交高清'}
              </Button>
            </Tooltip>,
          )
        }
        if (stage === '待绑定' && canWork) {
          const binding = r.bind_status === '审核中'
          if (binding && canReview && r.binding_request_id) {
            // 绑定申请审核中：审核人直接在任务行上通过/拒绝
            btns.push(<Button key="pass" size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => doBindReview(r.binding_request_id!, true)}>通过</Button>)
            btns.push(<Button key="reject" size="small" danger onClick={() => askReason('拒绝绑定申请（可修改后重新提交）', (reason) => doBindReview(r.binding_request_id!, false, reason))}>拒绝</Button>)
          } else {
            btns.push(
              <Tooltip key="bind" title={r.hd_url ? '' : '请先完成高清，再提交绑定申请'}>
                <Button
                  size="small" type="primary" icon={<CheckCircleOutlined />}
                  disabled={binding || !r.hd_url} onClick={() => doBind(r.id)}
                >
                  {binding ? '审核中…' : r.bind_status === '已拒绝' ? '重新提交绑定' : '提交绑定'}
                </Button>
              </Tooltip>,
            )
          }
        }
        if (stage === '待上传' && canUpload) {
          const bound = r.bind_status === '已通过'
          btns.push(
            <Tooltip key="upload" title={bound ? '' : '视频未通过绑定审核，不能上传'}>
              <Button
                size="small" type="primary" icon={<CloudUploadOutlined />}
                disabled={!bound} onClick={() => doUpload(r.id)}
              >
                {r.upload_status === '上传失败' ? '重新上传' : '上传'}
              </Button>
            </Tooltip>,
          )
        }
        btns.push(<Button key="log" size="small" icon={<EyeOutlined />} onClick={() => openLog(r.id)}>日志</Button>)
        btns.push(<Button key="detail" size="small" onClick={() => openDetail(r.id)}>详情</Button>)
        return <Space size={4} wrap>{btns}</Space>
      },
    })

    return base
  })()

  // ===== 批量按钮 =====
  const batchActions = useMemo(() => {
    const list: { label: string; type?: 'primary' | 'default'; danger?: boolean; onClick: () => void }[] = []
    if (!selectedRowKeys.length) return list
    if (stage === '待提交' && canReport) {
      list.push({ label: '批量提交', type: 'primary', onClick: () => runBatch('批量提交', async (id) => { await mediaRequestApi.submit(id) }) })
    }
    if (stage === '待审核' && canReview) {
      list.push({ label: '批量通过', type: 'primary', onClick: () => runBatch('批量审核通过', async (id) => { await mediaRequestApi.review(id, { passed: true }) }) })
      list.push({
        label: '批量驳回', danger: true,
        onClick: () => askReason('批量驳回（退回待提交）', (reason) => runBatch('批量驳回', async (id) => { await mediaRequestApi.review(id, { passed: false, reason }) })),
      })
    }
    if (stage === '待生成' && canWork) {
      list.push({ label: '批量生成', type: 'primary', onClick: () => runBatch('批量生成', async (id) => { await mediaRequestApi.generate(id) }) })
    }
    if (stage === '已生成' && canWork) {
      list.push({ label: '批量通过', type: 'primary', onClick: () => runBatch('批量成片审核通过', async (id) => { await mediaRequestApi.genReview(id, { passed: true }) }) })
      list.push({
        label: '批量不通过', danger: true,
        onClick: () => askReason('批量成片审核不通过（退回待生成）', (reason) => runBatch('批量成片审核不通过', async (id) => { await mediaRequestApi.genReview(id, { passed: false, reason }) })),
      })
    }
    if (stage === '待确认' && canReview) {
      list.push({ label: '批量确认', type: 'primary', onClick: () => runBatch('批量二次审核通过', async (id) => { await mediaRequestApi.confirm(id, { passed: true }) }) })
      list.push({
        label: '批量驳回', danger: true,
        onClick: () => askReason('批量运营驳回（退回待生成）', (reason) => runBatch('批量运营驳回', async (id) => { await mediaRequestApi.confirm(id, { passed: false, reason }) })),
      })
    }
    if (stage === '待高清' && canWork) {
      list.push({ label: '批量高清', type: 'primary', onClick: () => runBatch('批量提交高清', async (id) => { await mediaRequestApi.upscale(id, hdScaleOf(id)) }) })
    }
    if (stage === '待绑定' && canWork) {
      list.push({ label: '批量提交绑定', type: 'primary', onClick: () => runBatch('批量提交绑定', async (id) => { await mediaRequestApi.bind(id) }) })
    }
    if (stage === '待绑定' && canReview) {
      list.push({
        label: '批量通过', type: 'primary',
        onClick: () => runBatch('批量绑定审核通过', async (id) => {
          const it = items.find((i) => i.id === id)
          if (!it?.binding_request_id) throw new Error('缺少绑定申请')
          await videoBindingApi.approve(it.binding_request_id)
        }),
      })
      list.push({
        label: '批量拒绝', danger: true,
        onClick: () => askReason('批量拒绝绑定申请', (reason) => runBatch('批量拒绝绑定申请', async (id) => {
          const it = items.find((i) => i.id === id)
          if (!it?.binding_request_id) throw new Error('缺少绑定申请')
          await videoBindingApi.reject(it.binding_request_id, reason)
        })),
      })
    }
    if (stage === '待上传' && canUpload) {
      list.push({ label: '批量上传', type: 'primary', onClick: () => runBatch('批量上传', async (id) => { const r = await mediaRequestApi.upload(id); if (r.data?.success === false) throw new Error(r.data?.message) }) })
    }
    return list
  }, [stage, selectedRowKeys, canReport, canReview, canWork, canUpload, load, hdScales, items])

  if (!canReport && !canReview && !canWork) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="warning" showIcon message="无权限" description="需要「AI视频使用」「AI视频审核」或「产品编辑」权限才能使用视频需求流转。" />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        size="small"
        title={<Space><VideoCameraOutlined /> 媒体任务中心</Space>}
        extra={<span style={{ color: '#8c8c8c', fontSize: 12 }}>运营提报 → 主管审核 → 美工生成 → 成片审核 → 运营二次审核 → 高清 → 绑定产品 → 平台上传</span>}
      >
        <Alert type="info" showIcon message={STAGE_HINT[stage]} />
      </Card>

      <Card size="small" bodyStyle={{ paddingTop: 8 }}>
        {/* key 随各阶段数量变化：计数加载后重渲染页签条，修复动态标签导致的下划线错位 */}
        <Tabs
          key={STAGES.map((s) => counts[s] || 0).join('-')}
          activeKey={stage}
          onChange={(key) => { setStage(key as MediaStage); setPage(1) }}
          items={STAGES.map((s) => ({ key: s, label: `${s}${counts[s] ? ` (${counts[s]})` : ''}` }))}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          {stage === '待提交' && canReport && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增提报
            </Button>
          )}
          {batchActions.map((b) => (
            <Button key={b.label} type={b.type} danger={b.danger} loading={batchLoading} onClick={b.onClick}>{b.label}</Button>
          ))}
          <span style={{ color: selectedRowKeys.length ? '#1677ff' : '#bfbfbf', fontSize: 12 }}>
            {selectedRowKeys.length ? `已选 ${selectedRowKeys.length} 条` : '勾选后可批量操作'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              allowClear placeholder="运营"
              style={{ width: 120 }}
              value={filterInput.op}
              onChange={(e) => setFilterInput((f) => ({ ...f, op: e.target.value }))}
              onPressEnter={() => { setPage(1); setFilters((f) => ({ ...f, op: filterInput.op })) }}
            />
            <Select
              allowClear placeholder="平台" style={{ width: 110 }}
              value={filters.platform}
              options={[{ value: 'amazon', label: 'Amazon' }, { value: 'ozon', label: 'Ozon' }]}
              onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, platform: v })) }}
            />
            <Input.Search
              allowClear placeholder="编码 / 品名 / 单据号"
              style={{ width: 200 }}
              value={filterInput.keyword}
              onChange={(e) => setFilterInput((f) => ({ ...f, keyword: e.target.value }))}
              onSearch={(v) => { setPage(1); setFilters((f) => ({ ...f, keyword: v })) }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => { setFilterInput({ op: '', keyword: '' }); setFilters({ op: '', keyword: '' }); setPage(1); load() }}>刷新</Button>
          </div>
        </div>

        <Table<MediaRequestItem>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={items}
          scroll={{ x: 2296 }}
          rowSelection={stage === '已上传' ? undefined : {
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            preserveSelectedRowKeys: true,
          }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => setPage(p),
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该阶段暂无单据" /> }}
        />
      </Card>

      {stage === '待绑定' && (
        <div style={{ color: '#8c8c8c', fontSize: 12 }}>
          提示：绑定申请审核通过后视频将写入产品详情；提交后可直接在本页任务行上「通过 / 拒绝」。
        </div>
      )}

      {/* ===== 新增提报（按产品分组，展开勾选店铺/SKU；需求添加后逐条填写） ===== */}
      <Modal
        open={createOpen}
        title={<span>添加商品<span style={{ color: '#8c8c8c', fontSize: 12, fontWeight: 400, marginLeft: 10 }}>展开产品勾选店铺/SKU 加入「待提交」；需求在添加后逐条填写</span></span>}
        width={1000}
        okText="确认添加"
        cancelText="取消"
        confirmLoading={creating}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        destroyOnClose
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Input
            allowClear placeholder="筛选产品编码 / 品名 / SKU"
            style={{ width: 240 }}
            value={skuKeywordInput}
            onChange={(e) => setSkuKeywordInput(e.target.value)}
            onPressEnter={() => loadSkus(1, skuKeywordInput.trim(), skuPlatform)}
          />
          <Select
            allowClear placeholder="平台" style={{ width: 120 }}
            value={skuPlatform}
            options={[{ value: 'amazon', label: 'Amazon' }, { value: 'ozon', label: 'Ozon' }]}
            onChange={(v) => { setSkuPlatform(v); loadSkus(1, skuKeywordInput.trim(), v) }}
          />
          <Button onClick={() => loadSkus(1, skuKeywordInput.trim(), skuPlatform)}>查询</Button>
        </div>

        <Table
          rowKey="product_id"
          size="small"
          loading={skuLoading}
          dataSource={skuGroups}
          pagination={false}
          scroll={{ y: 340 }}
          expandable={{
            expandedRowRender: (group) => (
              <Table
                rowKey={skuKeyOf}
                size="small"
                showHeader={false}
                pagination={false}
                dataSource={group.entries}
                columns={[
                  {
                    title: '', key: 'ck', width: 44,
                    render: (_, e) => <Checkbox checked={!!skuSelected[skuKeyOf(e)]} onChange={() => toggleSku(e)} />,
                  },
                  { title: 'SKU', dataIndex: 'sku', width: 190, render: (v) => <span style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 12 }}>{v}</span> },
                  { title: '店铺', dataIndex: 'store_name', width: 150, ellipsis: true },
                  { title: '站点', dataIndex: 'site', width: 110, render: (v) => v ? <Tag>{v}</Tag> : '-' },
                  { title: '平台', dataIndex: 'platform', width: 100, render: (v) => <Tag color={platformMeta(v).color}>{platformMeta(v).label}</Tag> },
                  {
                    title: '状态', key: 'st', width: 110,
                    render: (_, e) => e.usable
                      ? <Tag color="green">可上传</Tag>
                      : <Tooltip title={e.unusable_reason}><Tag color="error">{e.unusable_reason || '不可上传'}</Tag></Tooltip>,
                  },
                ]}
              />
            ),
            rowExpandable: (group) => group.entries.length > 0,
          }}
          columns={[
            {
              title: '', key: 'ck', width: 44,
              render: (_, g) => {
                const usableN = groupUsableCount(g)
                const selN = groupSelCount(g)
                return (
                  <Checkbox
                    checked={usableN > 0 && selN === usableN}
                    indeterminate={selN > 0 && selN < usableN}
                    disabled={usableN === 0}
                    onChange={(e) => toggleGroup(g, e.target.checked)}
                  />
                )
              },
            },
            {
              title: '产品图片', key: 'img', width: 90,
              render: (_, g) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {g.product_image
                    ? <Image src={g.product_image} width={42} height={42} style={{ objectFit: 'cover', borderRadius: 6, display: 'block' }} preview={false} />
                    : <div style={{ width: 42, height: 42, borderRadius: 6, background: '#f5f5f5', flex: 'none' }} />}
                </div>
              ),
            },
            {
              title: '产品编码 / 品名', key: 'product', width: 230,
              render: (_, g) => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.product_code}>{g.product_code}</div>
                  <div style={{ color: '#8c8c8c', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.product_name}>{g.product_name}</div>
                </div>
              ),
            },
            {
              title: 'SKU', key: 'sku', width: 200,
              render: (_, g) => {
                const selN = groupSelCount(g)
                return selN > 0
                  ? <span style={{ color: '#1677ff', fontWeight: 600 }}>已选 {selN} / {g.entries.length} 个</span>
                  : <span style={{ color: '#8c8c8c' }}>共 {g.entries.length} 个，展开选择</span>
              },
            },
            {
              title: '平台', key: 'plat', width: 140,
              render: (_, g) => {
                const plats = Array.from(new Set(g.entries.map((e) => e.platform)))
                return <>{plats.map((p) => <Tag key={p} color={platformMeta(p).color}>{platformMeta(p).label}</Tag>)}</>
              },
            },
            {
              title: '状态', key: 'st', width: 130,
              render: (_, g) => {
                const usableN = groupUsableCount(g)
                if (usableN === 0) return <Tag color="error">不可上传</Tag>
                if (usableN < g.entries.length) return <Tag color="warning">部分可上传</Tag>
                return <Tag color="green">可上传</Tag>
              },
            },
          ]}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配商品" /> }}
        />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#1677ff', fontWeight: 600, fontSize: 13 }}>
            已选 {Object.keys(skuSelected).length} 个 SKU · {new Set(Object.values(skuSelected).map((e) => e.product_id)).size} 个产品
          </span>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>共 {skuTotal} 个产品 · 每页 10 个</span>
        </div>
        <div style={{ margin: '8px 0 0', display: 'flex', justifyContent: 'center' }}>
          <Pagination
            size="small" current={skuPage} pageSize={10} total={skuTotal}
            showSizeChanger={false} onChange={(p) => loadSkus(p, skuKeyword, skuPlatform, true)}
          />
        </div>
      </Modal>

      {/* ===== 日志 ===== */}
      <Modal open={!!logItem} title={`操作日志${logItem ? ` · 单据 ${logItem.seq}` : ''}`} footer={null} width={620} onCancel={() => setLogItem(null)}>
        {logItem?.logs?.length
          ? (
            <Timeline
              items={logItem.logs.map((l) => ({
                children: (
                  <div>
                    <div style={{ color: '#8c8c8c', fontSize: 12 }}>{l.created_at} · {l.actor_name}</div>
                    <div style={{ fontWeight: 600 }}>{l.action}</div>
                    <div style={{ color: '#595959', fontSize: 12 }}>{l.note}</div>
                  </div>
                ),
              }))}
            />
          )
          : <Empty description="暂无操作记录" />}
      </Modal>

      {/* ===== 详情 ===== */}
      <Modal
        open={!!detailItem || detailLoading}
        title={`单据详情${detailItem ? ` · ${detailItem.seq}` : ''}`}
        footer={null}
        width={860}
        onCancel={() => setDetailItem(null)}
      >
        {detailLoading && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
        {detailItem && (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="单据关联号">{detailItem.seq}</Descriptions.Item>
              <Descriptions.Item label="当前阶段"><Tag color="blue">{detailItem.stage}</Tag></Descriptions.Item>
              <Descriptions.Item label="产品编码">{detailItem.product_code}</Descriptions.Item>
              <Descriptions.Item label="产品名称">{detailItem.product_name}</Descriptions.Item>
              <Descriptions.Item label="运营">{detailItem.submitter_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{detailItem.submit_time || '-'}</Descriptions.Item>
              <Descriptions.Item label="需求类型" span={2}>
                {(detailItem.demand_type ? [detailItem.demand_type] : detailItem.demand_types).map((t) => <Tag key={t} color={DEMAND_COLOR[t]}>{t}</Tag>)}
              </Descriptions.Item>
              <Descriptions.Item label="需求描述" span={2}>{detailItem.description || '—'}</Descriptions.Item>
              <Descriptions.Item label="提示词" span={2}>{detailItem.prompt || '—'}</Descriptions.Item>
              <Descriptions.Item label="视频参数" span={2}>
                {detailItem.ratio} · {detailItem.duration}s · {RESOLUTIONS.find((o) => o.value === detailItem.resolution)?.label || detailItem.resolution}
              </Descriptions.Item>
              <Descriptions.Item label="生成时间">{detailItem.gen_time || '-'}</Descriptions.Item>
              <Descriptions.Item label="上传时间">{detailItem.upload_time || '-'}</Descriptions.Item>
              <Descriptions.Item label="高清状态">
                {detailItem.hd_status === '高清中' ? '高清中' : detailItem.hd_status === '失败' ? '高清失败' : detailItem.hd_url ? '已完成' : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="高清时间">{detailItem.hd_time || '-'}</Descriptions.Item>
              <Descriptions.Item label="绑定状态">
                {detailItem.bind_status === '审核中' ? '审核中' : detailItem.bind_status === '已通过' ? '已通过' : detailItem.bind_status === '已拒绝' ? '已拒绝' : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="绑定申请">{detailItem.binding_request_id ? `#${detailItem.binding_request_id}` : '-'}</Descriptions.Item>
            </Descriptions>

            {detailItem.plan && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>视频方案</div>
                <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500 }}>{detailItem.plan.concept_title}</span>
                  <Tag color={DEMAND_COLOR[detailItem.plan.video_type || ''] || 'default'}>{detailItem.plan.video_type}</Tag>
                  <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                    {detailItem.plan.duration}s · {detailItem.plan.ratio} · 分镜 {(detailItem.plan.storyboard || []).length} 个镜头
                  </span>
                  <Button size="small" type="link" onClick={() => setPlanModal({ open: true, plan: detailItem.plan, item: detailItem })}>
                    查看完整方案
                  </Button>
                </div>
              </div>
            )}

            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>目标平台 SKU</div>
              <Table
                size="small" rowKey={(r) => `${r.pp_id}_${r.store_id}`} pagination={false}
                dataSource={detailItem.platform_items || []}
                columns={[
                  { title: '平台', dataIndex: 'platform', width: 90, render: (v) => <Tag color={platformMeta(v).color}>{platformMeta(v).label}</Tag> },
                  { title: '店铺', dataIndex: 'store_name', width: 160 },
                  { title: '站点', dataIndex: 'site', width: 100 },
                  { title: 'SKU / 货号', dataIndex: 'sku', width: 200 },
                  { title: 'ASIN', dataIndex: 'asin', render: (v) => v || '-' },
                ]}
              />
            </div>

            {detailItem.ref_images?.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>参考图</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detailItem.ref_images.map((u) => <Image key={u} src={u} width={64} height={64} style={{ objectFit: 'cover', borderRadius: 6 }} />)}
                </div>
              </div>
            )}

            {detailItem.media_url && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>成片</div>
                <video src={detailItem.media_url} controls style={{ width: 360, maxWidth: '100%', borderRadius: 8, background: '#000' }} />
              </div>
            )}

            {detailItem.hd_url && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>高清成片</div>
                <video src={detailItem.hd_url} controls style={{ width: 360, maxWidth: '100%', borderRadius: 8, background: '#000' }} />
              </div>
            )}

            {detailItem.upload_result && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>上传结果</div>
                <pre style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, maxHeight: 220, overflow: 'auto', fontSize: 12 }}>
                  {JSON.stringify(detailItem.upload_result, null, 2)}
                </pre>
              </div>
            )}
          </Space>
        )}
      </Modal>

      {/* ===== 成片预览（视频 / AI图片） ===== */}
      <Modal open={!!videoUrl} footer={null} width={720} onCancel={() => setVideoUrl(null)} destroyOnClose>
        {videoUrl && (
          /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(videoUrl)
            ? <Image src={videoUrl} width="100%" style={{ borderRadius: 8 }} />
            : <video src={videoUrl} controls autoPlay style={{ width: '100%', borderRadius: 8, background: '#000' }} />
        )}
      </Modal>

      {/* ===== 上传结果 ===== */}
      <Modal
        open={uploadResult.open}
        title="上传结果"
        width={720}
        onCancel={() => setUploadResult({ open: false, message: '' })}
        footer={<Button type="primary" onClick={() => setUploadResult({ open: false, message: '' })}>知道了</Button>}
      >
        <Alert
          type={uploadResult.message.includes('失败') ? 'error' : 'success'}
          showIcon message={uploadResult.message} style={{ marginBottom: 12 }}
        />
        <pre style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, maxHeight: 360, overflow: 'auto', fontSize: 12 }}>
          {JSON.stringify(uploadResult.data || {}, null, 2)}
        </pre>
      </Modal>

      {/* ===== 视频方案 ===== */}
      <Modal
        open={planModal.open}
        title={`视频方案${planModal.plan ? ` · ${planModal.plan.concept_title}` : ''}`}
        width={860}
        footer={null}
        onCancel={() => setPlanModal({ open: false })}
      >
        {planModal.plan ? (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="方案名称">{planModal.plan.concept_title}</Descriptions.Item>
              <Descriptions.Item label="视频类型">{planModal.plan.video_type || '-'}</Descriptions.Item>
              <Descriptions.Item label="时长 / 比例">{planModal.plan.duration}s · {planModal.plan.ratio}</Descriptions.Item>
              <Descriptions.Item label="口播语言">{planModal.plan.video_type === '产品展示' ? '无口播' : (planModal.plan.language || '英语')}</Descriptions.Item>
              <Descriptions.Item label="生成时间" span={2}>{planModal.plan.generated_at || '-'}</Descriptions.Item>
            </Descriptions>
            {(planModal.plan.story || planModal.plan.character || planModal.plan.environment || planModal.plan.music) && (
              <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, fontSize: 12.5, lineHeight: 1.8 }}>
                {planModal.plan.story && <div><b>情节：</b>{planModal.plan.story}</div>}
                {planModal.plan.character && <div><b>模特：</b>{planModal.plan.character}</div>}
                {planModal.plan.environment && <div><b>环境：</b>{planModal.plan.environment}</div>}
                {planModal.plan.music && <div><b>音乐：</b>{planModal.plan.music}</div>}
              </div>
            )}
            <Table
              size="small"
              pagination={false}
              rowKey={(_, idx) => String(idx)}
              dataSource={planModal.plan.storyboard || []}
              columns={[
                { title: '镜头', width: 62, render: (_v, _r, idx) => idx + 1 },
                { title: '时间码', dataIndex: 'timestamp', width: 110 },
                { title: '画面内容', dataIndex: 'description' },
                ...(planModal.plan.video_type === '产品展示'
                  ? []
                  : [{ title: '口播台词', dataIndex: 'voiceover' }]),
              ]}
            />
            <Alert
              type="info"
              showIcon
              message="每次只生成 1 套方案，不再提供多套选择；口播带货包含分镜与口播台词，产品展示仅画面分镜。"
            />
          </Space>
        ) : <Empty description="暂无方案" />}
      </Modal>

      {/* ===== 产品图库选参考图 ===== */}
      <Modal
        open={pickerOpen}
        title="从产品管理选择参考图"
        width={780}
        okText={pickerSelected.length ? `添加（${pickerSelected.length}）` : '添加'}
        cancelText="取消"
        confirmLoading={pickerLoading}
        onOk={confirmPicker}
        onCancel={() => setPickerOpen(false)}
        destroyOnClose
      >
        {pickerLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : pickerImages.length === 0 ? (
          <Empty description="该产品暂无产品图片，可先在产品管理上传" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12, maxHeight: 440, overflow: 'auto' }}>
            {pickerImages.map((url) => {
              const checked = pickerSelected.includes(url)
              return (
                <div
                  key={url}
                  onClick={() => togglePicker(url)}
                  style={{
                    border: `2px solid ${checked ? '#1677ff' : '#f0f0f0'}`,
                    borderRadius: 8, padding: 6, cursor: 'pointer',
                    background: checked ? '#f0f7ff' : '#fff',
                  }}
                >
                  <Image src={url} width="100%" height={100} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} />
                  <Checkbox checked={checked} style={{ marginTop: 6 }}>选择</Checkbox>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 8 }}>已选 {pickerSelected.length} 张 · 参考图最多 9 张</div>
      </Modal>
    </div>
  )
}

export default VideoUploadCenter
