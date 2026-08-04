import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Alert, Card, Table, Button, Modal, Form, Input, Select, message, Popconfirm, Space, Tag, InputNumber, Switch, Drawer, Checkbox, Image, Tooltip, Divider, Transfer, Dropdown, MenuProps, Progress, Badge, Descriptions, Pagination, DatePicker, Popover, Spin } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, SettingOutlined, HolderOutlined, AppstoreOutlined, ShopOutlined, DownOutlined, EyeOutlined, InboxOutlined, DownloadOutlined, UploadOutlined, CheckCircleOutlined, WarningOutlined, ExportOutlined, UnorderedListOutlined, LoadingOutlined, FilterOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { Resizable, ResizeCallbackData } from 'react-resizable'
import { productsApi, storesApi, storeGroupsApi, inventoryBatchesApi, inventoryCountApi, productBindingsApi, shipmentsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'

interface Product {
  id: number
  product_code: string
  name: string
  name_en: string
  product_type: string | string[]
  product_attribute: string
  category: string
  brand: string
  purchase_price: number | null
  sale_price: number | null
  main_image: string
  weight: number | null
  length: number | null
  width: number | null
  height: number | null
  status: string
  is_robot_monitored: boolean
  created_at: string
  platform_count: number
  local_quantity: number
  local_warehouse: string
  local_inbound_date: string
  local_stock_age: number | null
  local_value: number | null
  replenishment_quantity: number
  purchased_quantity: number
}

interface PlatformProduct {
  id: number
  platform: string
  store_ids: number[]
  store_names: string[]
  platform_product_id: string
  asin: string
  sku: string
  title: string
  title_en: string
  image_url: string
  currency: string
  price: number | null
  cost_price: number | null
  status: string
  sync_status: string
  created_at: string
}

interface Store {
  id: number
  name: string
  inventory_name?: string
  platform?: string
  site?: string
  group_id?: number | null
  group_name?: string
}

interface StoreGroup {
  id: number
  name: string
  description: string
  store_count: number
}

interface ColumnState {
  key: string
  title: string
  visible: boolean
  width?: number
  minWidth?: number
  fixed?: 'left' | 'right'
}

// 平台商品列表的列状态
const defaultPpColumns: ColumnState[] = [
  { key: 'image_url', title: '图片', visible: true, width: 70, minWidth: 70 },
  { key: 'platform', title: '平台', visible: true, width: 90 },
  { key: 'store_names', title: '店铺', visible: true, width: 220 },
  { key: 'asin', title: 'ASIN', visible: true, width: 130 },
  { key: 'sku', title: 'SKU', visible: true, width: 140 },
  { key: 'title', title: '标题', visible: true, width: 300 },
  { key: 'price', title: '售价', visible: true, width: 110 },
  { key: 'status', title: '状态', visible: true, width: 90 },
]

const defaultColumns: ColumnState[] = [
  { key: 'main_image', title: '图片', visible: true, width: 70, minWidth: 70 },
  { key: 'product_code', title: '产品编码', visible: true, width: 180, minWidth: 150 },
  { key: 'name', title: '产品名称', visible: true, width: 200, minWidth: 150 },
  { key: 'name_en', title: '英文名称', visible: false, width: 200, minWidth: 150 },
  { key: 'product_type', title: '产品类型', visible: true, width: 120, minWidth: 100 },
  { key: 'product_attribute', title: '产品属性', visible: true, width: 120, minWidth: 100 },
  { key: 'category', title: '分类', visible: true, width: 120, minWidth: 100 },
  { key: 'brand', title: '品牌', visible: true, width: 120, minWidth: 100 },
  { key: 'purchase_price', title: '采购价', visible: true, width: 110, minWidth: 90 },
  { key: 'sale_price', title: '建议售价', visible: true, width: 110, minWidth: 90 },
  { key: 'local_quantity', title: '库存数量', visible: true, width: 100, minWidth: 80 },
  { key: 'replenishment_quantity', title: '补货数量', visible: true, width: 100, minWidth: 80 },
  { key: 'purchased_quantity', title: '已采购数量', visible: true, width: 110, minWidth: 90 },
  { key: 'local_warehouse', title: '仓库', visible: false, width: 120, minWidth: 100 },
  { key: 'local_inbound_date', title: '入库日期', visible: false, width: 130, minWidth: 110 },
  { key: 'local_stock_age', title: '库龄(天)', visible: false, width: 100, minWidth: 80 },
  { key: 'local_value', title: '货值', visible: true, width: 120, minWidth: 100 },
  { key: 'platform_count', title: '平台数', visible: true, width: 100, minWidth: 80 },
  { key: 'is_robot_monitored', title: '机器人监控', visible: true, width: 120, minWidth: 110 },
  { key: 'status', title: '状态', visible: true, width: 100, minWidth: 80 },
  { key: 'created_at', title: '创建时间', visible: true, width: 170, minWidth: 150 },
]

const platformOptions = [
  { label: 'Amazon', value: 'amazon' },
  { label: 'eBay', value: 'ebay' },
  { label: 'Walmart', value: 'walmart' },
  { label: 'Shopify', value: 'shopify' },
  { label: 'Shopee', value: 'shopee' },
  { label: 'Lazada', value: 'lazada' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Temu', value: 'temu' },
  { label: '其他', value: 'other' },
]

const platformColorMap: Record<string, string> = {
  amazon: 'orange',
  ebay: 'blue',
  walmart: 'yellow',
  shopify: 'green',
  shopee: 'red',
  lazada: 'purple',
  tiktok: 'cyan',
  temu: 'volcano',
  other: 'default',
}

const ResizableTitle = (props: any) => {
  const { onResize, width, minWidth, ...restProps } = props

  if (!width) {
    return <th {...restProps} />
  }

  return (
    <Resizable
      width={width}
      height={0}
      minConstraints={[minWidth || 80, 0]}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => {
            e.stopPropagation()
          }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  )
}

// 高级筛选条件
interface AdvancedFilterCondition {
  id: number
  field: string
  operator: string
  value: string
  extra_value?: string  // 用于 store_group_stock 字段的店铺分组ID
}

// 筛选字段选项
const filterFieldOptions = [
  { label: '库存数量', value: 'local_quantity' },
  { label: '店铺分组库存', value: 'store_group_stock' },
  { label: '产品编码', value: 'product_code' },
  { label: '产品名称', value: 'name' },
  { label: '产品类型', value: 'product_type' },
  { label: '分类', value: 'category' },
  { label: '品牌', value: 'brand' },
  { label: '货值', value: 'local_value' },
  { label: '补货数量', value: 'replenishment_quantity' },
  { label: '已采购数量', value: 'purchased_quantity' },
  { label: '平台数', value: 'platform_count' },
  { label: '状态', value: 'status' },
]

// 操作符选项
const filterOperatorOptions = [
  { label: '等于', value: 'eq' },
  { label: '不等于', value: 'neq' },
  { label: '大于', value: 'gt' },
  { label: '大于等于', value: 'gte' },
  { label: '小于', value: 'lt' },
  { label: '小于等于', value: 'lte' },
  { label: '包含', value: 'contains' },
  { label: '不包含', value: 'not_contains' },
]


const PRODUCT_FILTER_SESSION_KEY = 'product_management_session_filters_v1'
const defaultAdvancedFilterConditions: AdvancedFilterCondition[] = [
  { id: Date.now(), field: 'local_quantity', operator: 'gt', value: '0' },
]

const loadProductFilterSession = () => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(PRODUCT_FILTER_SESSION_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    return {
      searchText: typeof parsed.searchText === 'string' ? parsed.searchText : '',
      productTypeFilter: Array.isArray(parsed.productTypeFilter) ? parsed.productTypeFilter : undefined,
      productAttributeFilter: typeof parsed.productAttributeFilter === 'string' ? parsed.productAttributeFilter : undefined,
      filters: parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : { search: '' },
      filterConditions: Array.isArray(parsed.filterConditions)
        ? parsed.filterConditions.map((condition: any, index: number) => ({
            id: typeof condition.id === 'number' ? condition.id : Date.now() + index,
            field: condition.field || 'local_quantity',
            operator: condition.operator || 'gt',
            value: condition.value ?? '0',
            extra_value: condition.extra_value,
          }))
        : defaultAdvancedFilterConditions,
      filterMatchMode: parsed.filterMatchMode === 'any' ? 'any' : 'all',
    }
  } catch {
    return null
  }
}

const ProductManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const { hasPermission } = useAuth()
  const initialFilterSession = loadProductFilterSession()
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState(initialFilterSession?.searchText || '')
  const [productTypeFilter, setProductTypeFilter] = useState<string[] | undefined>(initialFilterSession?.productTypeFilter)
  const [productAttributeFilter, setProductAttributeFilter] = useState<string | undefined>(initialFilterSession?.productAttributeFilter)
  // 高级筛选条件
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [filterConditions, setFilterConditions] = useState<AdvancedFilterCondition[]>(initialFilterSession?.filterConditions || defaultAdvancedFilterConditions)
  const [filterMatchMode, setFilterMatchMode] = useState<'all' | 'any'>(initialFilterSession?.filterMatchMode || 'all')
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>(initialFilterSession?.filters || { search: '' })
  const [columnStates, setColumnStates] = useState<ColumnState[]>(defaultColumns)
  const [columnSettingOpen, setColumnSettingOpen] = useState(false)
  const [columnSettingTarget, setColumnSettingTarget] = useState<'main' | 'platform'>('main')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [displayColumns, setDisplayColumns] = useState<ColumnState[] | null>(null)
  const searchTimeoutRef = useRef<number | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchBindOpen, setBatchBindOpen] = useState(false)
  const [batchBindLoading, setBatchBindLoading] = useState(false)
  const [selectedFinishedProduct, setSelectedFinishedProduct] = useState<number | null>(null)
  const [selectedAccessoryIds, setSelectedAccessoryIds] = useState<number[]>([])
  const [importRecordModalOpen, setImportRecordModalOpen] = useState(false)
  const [importRecordLoading, setImportRecordLoading] = useState(false)
  const [importRecords, setImportRecords] = useState<any[]>([])
  const [importRecordTotal, setImportRecordTotal] = useState(0)
  const [importRecordPage, setImportRecordPage] = useState(1)
  const [importRecordPageSize, setImportRecordPageSize] = useState(20)
  const [importRecordStatus, setImportRecordStatus] = useState<string | undefined>()
  const [importRecordCreator, setImportRecordCreator] = useState<string | undefined>()
  const [importRecordDateRange, setImportRecordDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [importRecordDetail, setImportRecordDetail] = useState<any>(null)

  const [ppModalOpen, setPpModalOpen] = useState(false)
  const [ppEditingItem, setPpEditingItem] = useState<PlatformProduct | null>(null)
  const [ppCurrentProductId, setPpCurrentProductId] = useState<number | null>(null)
  const [ppCurrentProductName, setPpCurrentProductName] = useState('')
  const [ppList, setPpList] = useState<PlatformProduct[]>([])
  const [ppLoading, setPpLoading] = useState(false)
  const [ppDrawerOpen, setPpDrawerOpen] = useState(false)
  const [ppForm] = Form.useForm()
  const [groups, setGroups] = useState<StoreGroup[]>([])
  const [ppTransferOpen, setPpTransferOpen] = useState(false)
  const [ppTransferTargetKeys, setPpTransferTargetKeys] = useState<string[]>([])
  const [ppTransferFilterGroupId, setPpTransferFilterGroupId] = useState<number | undefined>(undefined)
  
  const [stockModalOpen, setStockModalOpen] = useState(false)
  const [stockModalProduct, setStockModalProduct] = useState<Product | null>(null)
  const [stockData, setStockData] = useState<any[] | null>(null)
  const [stockPlatformData, setStockPlatformData] = useState<any[]>([])
  const [stockGroupData, setStockGroupData] = useState<any[]>([])
  const [stockHistory, setStockHistory] = useState<any[]>([])
  const [stockLoading, setStockLoading] = useState(false)
  
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailModalProduct, setDetailModalProduct] = useState<Product | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [importPreviewOpen, setImportPreviewOpen] = useState(false)
  const [importPreviewData, setImportPreviewData] = useState<{ products: any[]; platform_products: any[]; file_name?: string; total_count?: number }>({ products: [], platform_products: [] })
  const [importPreviewRecordId, setImportPreviewRecordId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  
  const [dataFixOpen, setDataFixOpen] = useState(false)
  const [dataFixProducts, setDataFixProducts] = useState<Product[]>([])
  const [dataFixLoading, setDataFixLoading] = useState(false)
  const [dataFixEditingId, setDataFixEditingId] = useState<number | null>(null)
  
  const [shelfEditBatchId, setShelfEditBatchId] = useState<number | null>(null)
  const [shelfEditValue, setShelfEditValue] = useState('')
  const shelfInputRef = useRef<any>(null)

  const [shipmentCreating, setShipmentCreating] = useState(false)

  // 平台商品列表的列状态
  const [ppColumnStates, setPpColumnStates] = useState<ColumnState[]>(defaultPpColumns)

  // 仓库盘存
  const [countModalOpen, setCountModalOpen] = useState(false)
  const [countUploading, setCountUploading] = useState(false)
  const [countResult, setCountResult] = useState<any>(null)
  const [countConfirming, setCountConfirming] = useState(false)
  const countFileRef = useRef<HTMLInputElement>(null)

  // 成品配件绑定管理
  const [bindingDrawerOpen, setBindingDrawerOpen] = useState(false)
  const [bindingProduct, setBindingProduct] = useState<Product | null>(null)
  const [bindingList, setBindingList] = useState<any[]>([])
  const [bindingLoading, setBindingLoading] = useState(false)
  const [bindingModalOpen, setBindingModalOpen] = useState(false)
  const [bindingEditingItem, setBindingEditingItem] = useState<any>(null)
  const [bindingForm] = Form.useForm()

  // 配件绑定成品管理（反向查看）
  const [accBindingDrawerOpen, setAccBindingDrawerOpen] = useState(false)
  const [accBindingProduct, setAccBindingProduct] = useState<Product | null>(null)
  const [accBindingList, setAccBindingList] = useState<any[]>([])
  const [accBindingLoading, setAccBindingLoading] = useState(false)
  const [accBindingModalOpen, setAccBindingModalOpen] = useState(false)
  const [accBindingEditingItem, setAccBindingEditingItem] = useState<any>(null)
  const [accBindingForm] = Form.useForm()

  // 全量产品列表（用于绑定选择，支持懒加载）
  const [allAccessories, setAllAccessories] = useState<Product[]>([])
  const [allFinishedProducts, setAllFinishedProducts] = useState<Product[]>([])
  const [accPage, setAccPage] = useState(1) // 配件当前页码
  const [accTotal, setAccTotal] = useState(0) // 配件总数
  const [accLoadingMore, setAccLoadingMore] = useState(false) // 配件加载更多中
  const [finishedPage, setFinishedPage] = useState(1) // 成品当前页码
  const [finishedTotal, setFinishedTotal] = useState(0) // 成品总数
  const [finishedLoadingMore, setFinishedLoadingMore] = useState(false) // 成品加载更多中
  const [accSearchText, setAccSearchText] = useState('') // 配件搜索关键词
  const [finishedSearchText, setFinishedSearchText] = useState('') // 成品搜索关键词
  const accSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null) // 配件搜索防抖
  const finishedSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null) // 成品搜索防抖

  const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
  { label: '归档', value: 'archived' },
]

const productTypeOptions = [
  { label: '成品', value: 'finished' },
  { label: '配件', value: 'accessory' },
]

const productTypeLabelMap: Record<string, string> = {
  'finished': '成品',
  'accessory': '配件',
  '成品': '成品',
  '配件': '配件',
}

const productAttributeOptions = [
  { label: '通货', value: 'general' },
  { label: '定制品', value: 'custom' },
]

const productAttributeLabelMap: Record<string, string> = {
  'general': '通货',
  'custom': '定制品',
}

  useEffect(() => {
    fetchData()
  }, [pagination.current, pagination.pageSize, filters, filterConditions, filterMatchMode])


  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.sessionStorage.setItem(
      PRODUCT_FILTER_SESSION_KEY,
      JSON.stringify({
        searchText,
        productTypeFilter,
        productAttributeFilter,
        filters,
        filterConditions,
        filterMatchMode,
      })
    )
  }, [searchText, productTypeFilter, productAttributeFilter, filters, filterConditions, filterMatchMode])


  const fetchData = async () => {
    setLoading(true)
    try {
      // 将高级筛选条件转换为API参数
      const advFilters: Record<string, any> = {}
      if (filterConditions.length > 0) {
        advFilters.advanced_filters = JSON.stringify({
          conditions: filterConditions.map(c => ({
            field: c.field,
            operator: c.operator,
            value: c.value,
            extra_value: c.extra_value,  // 用于 store_group_stock 的店铺分组ID
          })),
          match_mode: filterMatchMode,
        })
      }
      const [productsRes, storesRes, groupsRes] = await Promise.all([
        productsApi.getList({
          page: pagination.current,
          page_size: pagination.pageSize,
          ...filters,
          ...advFilters,
        }),
        storesApi.getList({ page: 1, page_size: 1000 }),
        storeGroupsApi.getList(),
      ])
      if (productsRes.data.success) {
        setProducts(productsRes.data.data)
        setPagination((prev) => ({ ...prev, total: productsRes.data.total }))
      }
      if (storesRes.data.success) setStores(storesRes.data.data)
      if (groupsRes.data.success) setGroups(groupsRes.data.data)
    } catch (e) {
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = useCallback((value: string) => {
    setSearchText(value)
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: value }))
      setPagination((prev) => ({ ...prev, current: 1 }))
    }, 300)
  }, [])
  
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const handleProductTypeFilter = (value: string[] | undefined) => {
    setProductTypeFilter(value)
    setFilters(prev => ({ ...prev, product_type: value }))
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleProductAttributeFilter = (value: string | undefined) => {
    setProductAttributeFilter(value)
    setFilters(prev => ({ ...prev, product_attribute: value }))
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  // 高级筛选操作
  const addFilterCondition = () => {
    setFilterConditions(prev => [
      ...prev,
      { id: Date.now(), field: 'local_quantity', operator: 'gt', value: '0' },
    ])
  }

  const removeFilterCondition = (id: number) => {
    setFilterConditions(prev => prev.filter(c => c.id !== id))
  }

  const updateFilterCondition = (id: number, key: keyof AdvancedFilterCondition, value: string) => {
    setFilterConditions(prev =>
      prev.map(c => c.id === id ? { ...c, [key]: value } : c)
    )
  }

  const handleCreate = () => {
    setEditingProduct(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleEdit = (product: Product) => {
    setEditingProduct(product)
    form.setFieldsValue({
      product_code: product.product_code,
      name: product.name,
      name_en: product.name_en,
      product_type: Array.isArray(product.product_type) ? product.product_type : 
                   (product.product_type ? product.product_type.split(',') : []),
      product_attribute: product.product_attribute,
      category: product.category,
      brand: product.brand,
      purchase_price: product.purchase_price,
      sale_price: product.sale_price,
      main_image: product.main_image,
      weight: product.weight,
      length: product.length,
      width: product.width,
      height: product.height,
      status: product.status,
      is_robot_monitored: product.is_robot_monitored,
      local_quantity: product.local_quantity,
      local_warehouse: product.local_warehouse,
      local_inbound_date: product.local_inbound_date,
      local_stock_age: product.local_stock_age,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingProduct) {
        await productsApi.update(editingProduct.id, values)
        message.success('商品更新成功')
      } else {
        await productsApi.create(values)
        message.success('商品创建成功')
      }
      setModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      const errorMsg = e.response?.data?.detail || e.message || '操作失败'
      message.error(errorMsg)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await productsApi.delete(id)
      message.success('商品删除成功')
      fetchData()
    } catch (e) {
      message.error('删除失败')
    }
  }

  // 查询产品作为配件时的绑定成品列表，用于删除前提示
  const fetchAccessoryBindings = async (productId: number) => {
    try {
      const res = await productBindingsApi.getByAccessory(productId)
      return res.data.data || []
    } catch {
      return []
    }
  }

  // 单个删除：先查绑定关系再弹确认框
  const confirmDelete = async (record: any) => {
    const bindings = await fetchAccessoryBindings(record.id)
    let content: React.ReactNode
    if (bindings.length > 0) {
      const finishedNames = bindings.map((b: any) =>
        b.finished_code && b.finished_name
          ? `${b.finished_code} - ${b.finished_name}`
          : b.finished_name || b.finished_code || `成品#${b.finished_product_id}`
      )
      content = (
        <div>
          <p>删除后不可恢复</p>
          <p style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
            该产品作为配件已绑定 {bindings.length} 个成品，删除后将同时移除以下绑定关系：
          </p>
          <ul style={{ margin: '8px 0', paddingLeft: 20, color: '#ff4d4f' }}>
            {finishedNames.map((name: string, i: number) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        </div>
      )
    } else {
      content = '删除后不可恢复'
    }
    Modal.confirm({
      title: `确定删除「${record.name || record.product_code}」?`,
      content,
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(record.id),
    })
  }

  const handleBatchDelete = async () => {
    try {
      const ids = selectedRowKeys.map(k => Number(k))
      const res = await productsApi.batchDelete(ids)
      if (res.data.success) {
        message.success(res.data.message)
        setBatchDeleteOpen(false)
        setSelectedRowKeys([])
        fetchData()
      } else {
        message.error(res.data.message || '批量删除失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message || '批量删除失败')
    }
  }

  const handleBatchBind = async () => {
    if (!selectedAccessoryIds || selectedAccessoryIds.length === 0) {
      message.warning('请选择至少一个配件')
      return
    }
    setBatchBindLoading(true)
    try {
      const finishedProductIds = selectedRowKeys.map(k => Number(k))
      const res = await productsApi.batchBindAccessory({
        finished_product_ids: finishedProductIds,
        accessory_ids: selectedAccessoryIds,
        quantity: 1,
      })
      if (res.data.success) {
        message.success(res.data.message)
        setBatchBindOpen(false)
        setSelectedAccessoryIds([])
        setSelectedRowKeys([])
        fetchData()
      } else {
        message.error(res.data.message || '批量绑定失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message || '批量绑定失败')
    } finally {
      setBatchBindLoading(false)
    }
  }

  const fetchImportRecords = async () => {
    setImportRecordLoading(true)
    try {
      const params: any = {
        page: importRecordPage,
        page_size: importRecordPageSize,
      }
      if (importRecordStatus) params.status = importRecordStatus
      if (importRecordCreator) params.created_by = importRecordCreator
      if (importRecordDateRange?.[0]) params.start_date = importRecordDateRange[0].format('YYYY-MM-DD')
      if (importRecordDateRange?.[1]) params.end_date = importRecordDateRange[1].format('YYYY-MM-DD')
      const res = await productsApi.getImportRecords(params)
      if (res.data.success) {
        setImportRecords(res.data.data.list)
        setImportRecordTotal(res.data.data.total)
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '获取导入记录失败')
    } finally {
      setImportRecordLoading(false)
    }
  }

  useEffect(() => {
    if (importRecordModalOpen) {
      fetchImportRecords()
    }
  }, [importRecordModalOpen, importRecordPage, importRecordPageSize])

  const openImportRecordDetail = async (id: number) => {
    try {
      const res = await productsApi.getImportRecordDetail(id)
      if (res.data.success) {
        setImportRecordDetail(res.data.data)
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '获取详情失败')
    }
  }

  const openImportPreviewFromRecord = async (recordId: number, fromDetail: boolean = false) => {
    try {
      message.loading({ content: '正在加载预览数据，数据量较大请等待...', key: 'load-preview', duration: 0 })
      const res = await productsApi.getImportRecordPreviewData(recordId)
      if (res.data.success) {
        const d = res.data.data
        const products = d.products || []
        const platform_products = d.platform_products || []
        if (!products.length && !platform_products.length) {
          message.destroy('load-preview')
          message.warning('预览数据为空')
          return
        }
        setImportPreviewRecordId(recordId)
        setImportPreviewData({
          products,
          platform_products,
          file_name: d.preview_file_name || `产品导入_${new Date().toISOString().slice(0, 10)}.xlsx`,
          total_count: d.total_count || (products.length + platform_products.length),
        })
        setImportPreviewOpen(true)
        if (fromDetail) {
          setImportRecordDetail(null)
        }
        setImportRecordModalOpen(false)
        setTimeout(() => message.destroy('load-preview'), 300)
      } else {
        message.destroy('load-preview')
        message.error(res.data.message || '获取预览数据失败')
      }
    } catch (e: any) {
      message.destroy('load-preview')
      message.error(e.response?.data?.detail || '获取预览数据失败')
    }
  }

  const openPpDrawer = async (product: Product) => {
    setPpCurrentProductId(product.id)
    setPpCurrentProductName(product.name)
    setPpDrawerOpen(true)
    setPpLoading(true)
    try {
      const res = await productsApi.getPlatformProducts(product.id)
      if (res.data.success) {
        setPpList(res.data.data)
      }
    } catch (e) {
      message.error('获取平台商品失败')
    } finally {
      setPpLoading(false)
    }
  }

  const handlePpCreate = () => {
    setPpEditingItem(null)
    ppForm.resetFields()
    setPpTransferTargetKeys([])
    setPpModalOpen(true)
  }

  const handlePpEdit = (item: PlatformProduct) => {
    setPpEditingItem(item)
    setPpTransferTargetKeys(item.store_ids.map(String))
    ppForm.resetFields()
    ppForm.setFieldsValue({
      platform: item.platform,
      platform_product_id: item.platform_product_id,
      asin: item.asin,
      sku: item.sku,
      title: item.title,
      title_en: item.title_en,
      image_url: item.image_url,
      currency: item.currency,
      price: item.price,
      cost_price: item.cost_price,
      status: item.status,
    })
    setPpModalOpen(true)
  }

  const handleOpenTransfer = () => {
    setPpTransferFilterGroupId(undefined)
    setPpTransferOpen(true)
  }

  const handlePpSubmit = async () => {
    if (!ppCurrentProductId) return
    if (ppTransferTargetKeys.length === 0) {
      message.warning('请先选择店铺')
      return
    }
    try {
      const values = await ppForm.validateFields()
      const submitData = {
        ...values,
        store_ids: ppTransferTargetKeys.map(Number),
      }
      if (ppEditingItem) {
        await productsApi.updatePlatformProduct(ppCurrentProductId, ppEditingItem.id, submitData)
        message.success('平台商品更新成功')
      } else {
        await productsApi.createPlatformProduct(ppCurrentProductId, submitData)
        message.success('平台商品创建成功')
      }
      setPpModalOpen(false)
      const res = await productsApi.getPlatformProducts(ppCurrentProductId)
      if (res.data.success) setPpList(res.data.data)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      message.error('操作失败')
    }
  }

  const handlePpDelete = async (ppId: number) => {
    if (!ppCurrentProductId) return
    try {
      await productsApi.deletePlatformProduct(ppCurrentProductId, ppId)
      message.success('平台商品删除成功')
      const res = await productsApi.getPlatformProducts(ppCurrentProductId)
      if (res.data.success) setPpList(res.data.data)
      fetchData()
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleStockClick = async (product: Product) => {
    setStockModalProduct(product)
    setStockModalOpen(true)
    setStockLoading(true)
    try {
      const [batchRes, historyRes] = await Promise.all([
        inventoryBatchesApi.getProductBatches(product.id),
        inventoryBatchesApi.getProductHistory(product.id),
      ])
      if (batchRes.data.success) setStockData(batchRes.data.data)
      if (batchRes.data.platform_stock) setStockPlatformData(batchRes.data.platform_stock)
      else setStockPlatformData([])
      if (batchRes.data.group_stock) setStockGroupData(batchRes.data.group_stock)
      else setStockGroupData([])
      if (historyRes.data.success) setStockHistory(historyRes.data.data)
    } catch (e) {
      message.error('获取库存信息失败')
    } finally {
      setStockLoading(false)
    }
  }

  const downloadTemplate = useCallback(async () => {
    try {
      const res = await productsApi.downloadTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '产品导入模板_' + new Date().toISOString().split('T')[0] + '.xlsx')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success('模板下载成功')
    } catch (e: any) {
      message.error('模板下载失败: ' + (e.message || '未知错误'))
    }
  }, [])

  const handleExport = useCallback(async () => {
    try {
      message.loading({ content: '正在导出，请稍候...', key: 'export-loading', duration: 0 })
      const params: any = {}
      if (filters.search) params.search = filters.search
      if (filters.product_type && filters.product_type.length > 0) params.product_type = filters.product_type
      if (filters.product_attribute) params.product_attribute = filters.product_attribute
      if (filters.status) params.status = filters.status

      const res = await productsApi.exportProducts(params)
      message.destroy('export-loading')
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '产品列表_' + new Date().toISOString().split('T')[0] + '.xlsx')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success('导出成功')
    } catch (e: any) {
      message.destroy('export-loading')
      message.error('导出失败: ' + (e.message || '未知错误'))
    }
  }, [filters])

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const res = await productsApi.uploadPreview(file)
      if (res.data.success) {
        const recordId = res.data.data?.record_id
        message.info('文件已上传成功，正在后台解析预览数据...', 5)

        // 后台轮询等待预览就绪，就绪后弹出提示（用户可点击打开导入记录）
        if (recordId) {
          _pollPreviewReady(recordId)
        }
      } else {
        message.error(res.data.message || '文件上传失败')
      }
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '文件上传失败'
      message.error(errorMsg, 8)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // 轮询预览状态，就绪后弹出可点击的提示
  const _pollPreviewReady = (recordId: number) => {
    let pollCount = 0
    const MAX_POLL = 180 // 最多轮询 3 分钟（每2秒一次）
    const timer = setInterval(async () => {
      pollCount++
      if (pollCount > MAX_POLL) {
        clearInterval(timer)
        return
      }
      try {
        const statusRes = await productsApi.getImportRecordStatus(recordId)
        if (statusRes.data.success && statusRes.data.data.preview_status === 'success') {
          clearInterval(timer)
          message.success({
            content: (
              <span>
                预览数据已解析完成！{' '}
                <a onClick={() => { message.destroy(`preview-ready-${recordId}`); setImportRecordModalOpen(true); fetchImportRecords() }} style={{ fontWeight: 600 }}>
                  点击查看导入记录 →
                </a>
              </span>
            ),
            key: `preview-ready-${recordId}`,
            duration: 10,
          })
        }
      } catch { /* 静默 */ }
    }, 2000)
  }

  // 轮询检测导入处理完成，完成后弹出提示
  const _pollImportComplete = (recordId: number) => {
    let pollCount = 0
    const MAX_POLL = 600 // 最多轮询10分钟（每1秒一次）
    const timer = setInterval(async () => {
      pollCount++
      if (pollCount > MAX_POLL) {
        clearInterval(timer)
        return
      }
      try {
        const statusRes = await productsApi.getImportRecordStatus(recordId)
        if (statusRes.data.success) {
          const d = statusRes.data.data
          if (d.status === 'success' || d.status === 'partial_success' || d.status === 'failed') {
            clearInterval(timer)
            const isOk = d.status !== 'failed'
            const pOk = d.product_success ?? 0
            const pTotal = d.product_total ?? 0
            const ppOk = d.platform_success ?? 0
            const ppTotal = d.platform_total ?? 0
            message[isOk ? 'success' : 'error']({
              content: (
                <span>
                  导入{d.status === 'success' ? '完成' : d.status === 'partial_success' ? '部分完成' : '失败'}！{' '}
                  产品 {pOk}/{pTotal}，平台商品 {ppOk}/{ppTotal}。{' '}
                  <a onClick={() => { message.destroy(`import-done-${recordId}`); setImportRecordModalOpen(true); fetchImportRecords() }} style={{ fontWeight: 600 }}>
                    查看详情 →
                  </a>
                </span>
              ),
              key: `import-done-${recordId}`,
              duration: isOk ? 10 : 15,
            })
          }
        }
      } catch { /* 静默 */ }
    }, 1000)
  }

  const handleConfirmImport = async () => {
    if (!importPreviewRecordId) {
      message.warning('缺少导入记录ID')
      return
    }
    setImporting(true)
    try {
      const total = importPreviewData.total_count || (importPreviewData.products.length + importPreviewData.platform_products.length)
      // 传 record_id 让后端从 DB 读完整数据执行导入（前端数据可能被分页截断）
      const submitRes = await productsApi.batchImport({
        products: [],
        platform_products: [],
        file_name: importPreviewData.file_name || `产品导入_${new Date().toISOString().slice(0, 10)}.xlsx`,
        record_id: importPreviewRecordId,
      })
      if (!submitRes.data.success) {
        message.error(submitRes.data.message || '提交导入任务失败')
        return
      }
      message.success(`已提交 ${total} 条数据到后台导入，可在"导入记录"中查看进度`)
      setImportPreviewOpen(false)
      setImportPreviewData({ products: [], platform_products: [] })
      setImportPreviewRecordId(null)
      setImportErrors([])
      fetchData()
      // 轮询检测处理完成
      _pollImportComplete(importPreviewRecordId!)
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '导入失败'
      message.error(errorMsg)
    } finally {
      setImporting(false)
    }
  }

  const downloadCountTemplate = async () => {
    try {
      const res = await inventoryCountApi.downloadTemplate()
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '仓库盘存模板_' + new Date().toISOString().split('T')[0] + '.xlsx')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success('盘存模板下载成功')
    } catch (e: any) {
      message.error('模板下载失败: ' + (e.message || '未知错误'))
    }
  }

  const handleCountClick = () => {
    setCountResult(null)
    setCountModalOpen(true)
  }

  const handleBatchCreateShipment = () => {
    const selectedProducts = products.filter(p => selectedRowKeys.includes(p.id))
    if (selectedProducts.length === 0) {
      message.warning('请先选择要操作的商品')
      return
    }

    // 从筛选条件中获取店铺分组
    const storeGroupCondition = filterConditions.find(c => c.field === 'store_group_stock' && c.extra_value)
    const storeGroupId = storeGroupCondition ? Number(storeGroupCondition.extra_value) : undefined
    const storeGroup = groups.find(g => g.id === storeGroupId)
    const storeGroupName = storeGroup?.name

    Modal.confirm({
      title: '批量生成发货单',
      content: (
        <div>
          <div>将根据选中的 <b>{selectedProducts.length}</b> 个商品生成发货单</div>
          {storeGroupName && <div>店铺分组：<b>{storeGroupName}</b></div>}
        </div>
      ),
      okText: '生成',
      cancelText: '取消',
      onOk: async () => {
        setShipmentCreating(true)
        try {
          const orderNumber = `FH${dayjs().format('YYYYMMDDHHmmss')}`
          const items = selectedProducts.map(p => ({
            product_id: p.id,
            product_code: p.product_code,
            product_name: p.name,
            stock_quantity: p.local_quantity || 0,
          }))

          const res = await shipmentsApi.create({
            order_number: orderNumber,
            store_group_id: storeGroupId,
            store_group_name: storeGroupName,
            items,
          })

          if (res.data.success) {
            message.success(`发货单创建成功，共 ${items.length} 个商品`)
            setSelectedRowKeys([])
          } else {
            message.error(res.data.detail || '创建发货单失败')
          }
        } catch (err: any) {
          message.error(err?.response?.data?.detail || '创建发货单失败')
        } finally {
          setShipmentCreating(false)
        }
      },
    })
  }

  const handleCountFileUpload = () => {
    countFileRef.current?.click()
  }

  const handleCountFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setCountUploading(true)
    try {
      const res = await inventoryCountApi.upload(file)
      if (res.data.success) {
        setCountResult(res.data.data)
        message.success(res.data.message)
      } else {
        message.error(res.data.message || '盘存文件解析失败')
      }
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '盘存文件解析失败'
      message.error(errorMsg)
    } finally {
      setCountUploading(false)
      e.target.value = ''
    }
  }

  const handleCountConfirm = async () => {
    if (!countResult || !countResult.items) {
      message.warning('没有可确认的盘存数据')
      return
    }
    setCountConfirming(true)
    try {
      const res = await inventoryCountApi.confirm({ items: countResult.items })
      if (res.data.success) {
        message.success(res.data.message)
        setCountModalOpen(false)
        setCountResult(null)
        fetchData()
      } else {
        message.error(res.data.message || '确认失败')
      }
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '确认盘存失败'
      message.error(errorMsg)
    } finally {
      setCountConfirming(false)
    }
  }

  const openDataFix = useCallback(async () => {
    setDataFixOpen(true)
    setDataFixLoading(true)
    try {
      const res = await productsApi.getList({
        page: 1,
        page_size: 10000,
      })
      if (res.data.success) {
        const allProducts: Product[] = res.data.data
        const missingProducts = allProducts.filter((p: Product) => {
          const hasMissingPrice = p.purchase_price == null
          const hasMissingSize = p.weight == null || p.length == null || p.width == null || p.height == null
          return hasMissingPrice || hasMissingSize
        })
        if (missingProducts.length === 0) {
          message.info('没有需要补齐数据的产品')
          setDataFixOpen(false)
          return
        }
        setDataFixProducts(missingProducts)
      }
    } catch (e: any) {
      message.error('获取产品数据失败')
    } finally {
      setDataFixLoading(false)
    }
  }, [])

  const handleDataFixEdit = (product: Product) => {
    setDataFixOpen(false)
    setEditingProduct(product)
    form.setFieldsValue({
      product_code: product.product_code,
      name: product.name,
      name_en: product.name_en,
      product_type: Array.isArray(product.product_type) ? product.product_type :
                   (product.product_type ? product.product_type.split(',') : []),
      product_attribute: product.product_attribute,
      category: product.category,
      brand: product.brand,
      purchase_price: product.purchase_price,
      sale_price: product.sale_price,
      main_image: product.main_image,
      weight: product.weight,
      length: product.length,
      width: product.width,
      height: product.height,
      status: product.status,
      is_robot_monitored: product.is_robot_monitored,
      local_quantity: product.local_quantity,
      local_warehouse: product.local_warehouse,
      local_inbound_date: product.local_inbound_date,
      local_stock_age: product.local_stock_age,
    })
    setModalOpen(true)
  }

  // 成品配件绑定管理
  const openBindingDrawer = async (product: Product) => {
    setBindingProduct(product)
    setBindingDrawerOpen(true)
    await fetchBindings(product.id)
  }

  const fetchBindings = async (productId: number) => {
    setBindingLoading(true)
    try {
      const res = await productBindingsApi.getByFinished(productId)
      if (res.data.success) {
        setBindingList(res.data.data || [])
      }
    } catch (e) {
      message.error('获取配件绑定失败')
    } finally {
      setBindingLoading(false)
    }
  }

  const handleBindingCreate = async () => {
    setBindingEditingItem(null)
    bindingForm.resetFields()
    // 加载全量配件列表（不受筛选限制）
    await loadAllAccessories()
    setBindingModalOpen(true)
  }

  const loadAllAccessories = async (page: number = 1, append: boolean = false, search: string = '') => {
    try {
      if (append) {
        setAccLoadingMore(true)
      }
      // 查询配件，按id正序排序，支持搜索
      const res = await productsApi.getList({
        page: page,
        page_size: 100,
        product_type: 'accessory',
        sort_by: 'id',
        sort_order: 'asc',
        search: search || undefined
      })
      if (res.data.success) {
        const newProducts = res.data.data || []
        if (append) {
          // 滚动加载更多，追加数据
          setAllAccessories(prev => [...prev, ...newProducts])
        } else {
          // 首次加载或搜索，替换数据
          setAllAccessories(newProducts)
        }
        setAccTotal(res.data.total || 0)
        setAccPage(page)
      }
    } catch (e) {
      message.error('加载配件列表失败')
    } finally {
      setAccLoadingMore(false)
    }
  }

  // 加载更多配件（使用当前搜索关键词）
  const loadMoreAccessories = async () => {
    if (accLoadingMore) return
    const nextPage = accPage + 1
    const loadedCount = allAccessories.length
    if (loadedCount >= accTotal) return
    await loadAllAccessories(nextPage, true, accSearchText)
  }

  // 配件搜索（防抖）
  const handleAccSearch = (value: string) => {
    setAccSearchText(value)
    if (accSearchTimeoutRef.current) {
      clearTimeout(accSearchTimeoutRef.current)
    }
    accSearchTimeoutRef.current = setTimeout(() => {
      loadAllAccessories(1, false, value)
    }, 500)
  }

  const handleBindingEdit = (binding: any) => {
    setBindingEditingItem(binding)
    bindingForm.setFieldsValue({
      accessory_product_id: binding.accessory_product_id,
      quantity: binding.quantity,
    })
    setBindingModalOpen(true)
  }

  const handleBindingSubmit = async () => {
    if (!bindingProduct) return
    try {
      const values = await bindingForm.validateFields()
      if (bindingEditingItem) {
        await productBindingsApi.update(bindingEditingItem.id, {
          finished_product_id: bindingProduct.id,
          accessory_product_id: values.accessory_product_id,
          quantity: values.quantity,
        })
        message.success('绑定更新成功')
      } else {
        await productBindingsApi.create({
          finished_product_id: bindingProduct.id,
          accessory_product_id: values.accessory_product_id,
          quantity: values.quantity,
        })
        message.success('绑定创建成功')
      }
      setBindingModalOpen(false)
      fetchBindings(bindingProduct.id)
    } catch (e: any) {
      if (e.errorFields) return
      const errorMsg = e.response?.data?.detail || e.message || '操作失败'
      message.error(errorMsg)
    }
  }

  const handleBindingDelete = async (bindingId: number) => {
    try {
      await productBindingsApi.delete(bindingId)
      message.success('绑定已删除')
      if (bindingProduct) fetchBindings(bindingProduct.id)
    } catch (e) {
      message.error('删除失败')
    }
  }

  // ========== 配件绑定成品（反向查看） ==========

  const openAccBindingDrawer = async (product: Product) => {
    setAccBindingProduct(product)
    setAccBindingDrawerOpen(true)
    await fetchAccBindings(product.id)
  }

  const fetchAccBindings = async (productId: number) => {
    setAccBindingLoading(true)
    try {
      const res = await productBindingsApi.getByAccessory(productId)
      if (res.data.success) {
        setAccBindingList(res.data.data || [])
      }
    } catch (e) {
      message.error('获取绑定成品失败')
    } finally {
      setAccBindingLoading(false)
    }
  }

  const handleAccBindingCreate = async () => {
    setAccBindingEditingItem(null)
    accBindingForm.resetFields()
    // 加载全量成品列表（不受筛选限制）
    await loadAllFinishedProducts()
    setAccBindingModalOpen(true)
  }

  const loadAllFinishedProducts = async (page: number = 1, append: boolean = false, search: string = '') => {
    try {
      if (append) {
        setFinishedLoadingMore(true)
      }
      // 查询成品，按id正序排序，支持搜索
      const res = await productsApi.getList({
        page: page,
        page_size: 100,
        product_type: 'finished',
        sort_by: 'id',
        sort_order: 'asc',
        search: search || undefined
      })
      if (res.data.success) {
        const newProducts = res.data.data || []
        if (append) {
          setAllFinishedProducts(prev => [...prev, ...newProducts])
        } else {
          setAllFinishedProducts(newProducts)
        }
        setFinishedTotal(res.data.total || 0)
        setFinishedPage(page)
      }
    } catch (e) {
      message.error('加载成品列表失败')
    } finally {
      setFinishedLoadingMore(false)
    }
  }

  // 加载更多成品（使用当前搜索关键词）
  const loadMoreFinishedProducts = async () => {
    if (finishedLoadingMore) return
    const nextPage = finishedPage + 1
    const loadedCount = allFinishedProducts.length
    if (loadedCount >= finishedTotal) return
    await loadAllFinishedProducts(nextPage, true, finishedSearchText)
  }

  // 成品搜索（防抖）
  const handleFinishedSearch = (value: string) => {
    setFinishedSearchText(value)
    if (finishedSearchTimeoutRef.current) {
      clearTimeout(finishedSearchTimeoutRef.current)
    }
    finishedSearchTimeoutRef.current = setTimeout(() => {
      loadAllFinishedProducts(1, false, value)
    }, 500)
  }

  const handleAccBindingEdit = (binding: any) => {
    setAccBindingEditingItem(binding)
    accBindingForm.setFieldsValue({
      finished_product_id: binding.finished_product_id,
      quantity: binding.quantity,
    })
    setAccBindingModalOpen(true)
  }

  const handleAccBindingSubmit = async () => {
    if (!accBindingProduct) return
    try {
      const values = await accBindingForm.validateFields()
      if (accBindingEditingItem) {
        await productBindingsApi.update(accBindingEditingItem.id, {
          finished_product_id: values.finished_product_id,
          accessory_product_id: accBindingProduct.id,
          quantity: values.quantity,
        })
        message.success('绑定更新成功')
      } else {
        await productBindingsApi.create({
          finished_product_id: values.finished_product_id,
          accessory_product_id: accBindingProduct.id,
          quantity: values.quantity,
        })
        message.success('绑定创建成功')
      }
      setAccBindingModalOpen(false)
      fetchAccBindings(accBindingProduct.id)
    } catch (e: any) {
      if (e.errorFields) return
      const errorMsg = e.response?.data?.detail || e.message || '操作失败'
      message.error(errorMsg)
    }
  }

  const handleAccBindingDelete = async (bindingId: number) => {
    try {
      await productBindingsApi.delete(bindingId)
      message.success('绑定已删除')
      if (accBindingProduct) fetchAccBindings(accBindingProduct.id)
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleShelfEditStart = (batchId: number, currentValue: string) => {
    setShelfEditBatchId(batchId)
    setShelfEditValue(currentValue || '')
    setTimeout(() => shelfInputRef.current?.focus(), 100)
  }

  const handleShelfEditConfirm = async () => {
    if (shelfEditBatchId == null) return
    try {
      await inventoryBatchesApi.updateShelfNumber(shelfEditBatchId, shelfEditValue)
      message.success('货架号更新成功')
      setShelfEditBatchId(null)
      setShelfEditValue('')
      if (stockModalProduct) {
        const batchRes = await inventoryBatchesApi.getProductBatches(stockModalProduct.id)
        if (batchRes.data.success) setStockData(batchRes.data.data)
        if (batchRes.data.platform_stock) setStockPlatformData(batchRes.data.platform_stock)
        if (batchRes.data.group_stock) setStockGroupData(batchRes.data.group_stock)
      }
    } catch (e: any) {
      message.error('更新货架号失败')
    }
  }

  const handleColumnToggle = (key: string, checked: boolean) => {
    setColumnStates(prev => 
      prev.map(col => col.key === key ? { ...col, visible: checked } : col)
    )
  }

  const handleResetColumns = () => {
    if (columnSettingTarget === 'main') {
      setColumnStates(defaultColumns)
    } else {
      setPpColumnStates(defaultPpColumns)
    }
  }
  
  const handlePpColumnToggle = (key: string, checked: boolean) => {
    setPpColumnStates(prev => 
      prev.map(col => col.key === key ? { ...col, visible: checked } : col)
    )
  }

  const handleResetPpColumns = () => {
    setPpColumnStates(defaultPpColumns)
  }

  const handleCurrentColumnToggle = (key: string, checked: boolean) => {
    if (columnSettingTarget === 'main') {
      handleColumnToggle(key, checked)
    } else {
      handlePpColumnToggle(key, checked)
    }
  }

  const handleDragStart = (index: number, e: React.DragEvent) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', 'drag')
    // 保存当前状态
    setDisplayColumns(columnSettingTarget === 'main' ? [...columnStates] : [...ppColumnStates])
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
    setDisplayColumns(null)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnter = (index: number) => {
    if (draggedIndex === null || draggedIndex === index || !displayColumns) return
    setDragOverIndex(index)
    
    // 实时更新预览
    const newColumns = [...displayColumns]
    const [draggedItem] = newColumns.splice(draggedIndex, 1)
    newColumns.splice(index, 0, draggedItem)
    setDisplayColumns(newColumns)
    // 更新拖拽索引
    setDraggedIndex(index)
  }

  const handleDragLeave = () => {
    // 不清除 dragOverIndex，保持视觉效果
  }

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || !displayColumns) return
    
    if (columnSettingTarget === 'main') {
      setColumnStates(displayColumns)
    } else {
      setPpColumnStates(displayColumns)
    }
    
    setDraggedIndex(null)
    setDragOverIndex(null)
    setDisplayColumns(null)
  }

  const handlePpResize = (index: number) => {
    return (_e: React.SyntheticEvent, { size }: ResizeCallbackData) => {
      const newColumnStates = [...ppColumnStates]
      const currentIndex = newColumnStates.findIndex((_col, i) => i === index)
      if (currentIndex !== -1 && newColumnStates[currentIndex]) {
        newColumnStates[currentIndex] = {
          ...newColumnStates[currentIndex],
          width: size.width,
        }
        setPpColumnStates(newColumnStates)
      }
    }
  }

  const handleResize = (index: number) => {
    return (_e: React.SyntheticEvent, { size }: ResizeCallbackData) => {
      const newColumnStates = [...columnStates]
      const currentIndex = newColumnStates.findIndex((_, i) => i === index)
      if (currentIndex !== -1 && newColumnStates[currentIndex]) {
        const column = newColumnStates[currentIndex]
        const minWidth = column.minWidth || 80
        const finalWidth = Math.max(size.width, minWidth)
        newColumnStates[currentIndex] = {
          ...column,
          width: finalWidth,
        }
        setColumnStates(newColumnStates)
      }
    }
  }

  const getColumns = (): ColumnsType<Product> => {
    const baseColumns: ColumnsType<Product> = columnStates
      .filter(col => col.visible)
      .map((col, index) => {
        const column: any = {
          title: <div style={{ whiteSpace: 'nowrap' }}>{col.title}</div>,
          dataIndex: col.key,
          key: col.key,
          width: col.width,
          onHeaderCell: (column: any) => ({
            width: column.width,
            minWidth: col.minWidth,
            onResize: handleResize(columnStates.findIndex(c => c.key === col.key)),
            style: { whiteSpace: 'nowrap' },
          }),
        }

        if (col.key === 'main_image') {
          column.render = (url: string) =>
            url ? (
              <Image 
                src={url} 
                width={40} 
                height={40} 
                style={{ objectFit: 'cover', borderRadius: 4 }} 
                preview={{ mask: false }}
                loading="lazy"
                placeholder={
                  <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AppstoreOutlined style={{ color: '#ccc' }} />
                  </div>
                }
              />
            ) : (
              <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AppstoreOutlined style={{ color: '#ccc' }} />
              </div>
            )
        } else if (col.key === 'name' || col.key === 'name_en') {
          column.render = (text: string) => (
            <div style={{ 
              wordBreak: 'break-word', 
              whiteSpace: 'pre-wrap', 
              lineHeight: 1.5 
            }}>
              {text || '-'}
            </div>
          )
        } else if (col.key === 'platform_count') {
          column.render = (count: number) => (
            <Tag color={count > 0 ? 'blue' : 'default'}>{count} 个平台</Tag>
          )
        } else if (col.key === 'purchase_price' || col.key === 'sale_price') {
          column.render = (price: number | null) => price != null ? `¥${price.toFixed(2)}` : '-'
        } else if (col.key === 'is_robot_monitored') {
          column.render = (monitored: boolean) => (
            <Tag color={monitored ? 'success' : 'default'}>{monitored ? '是' : '否'}</Tag>
          )
        } else if (col.key === 'status') {
          column.render = (status: string) => {
            const colorMap: Record<string, string> = { active: 'success', inactive: 'default', archived: 'error' }
            const labelMap: Record<string, string> = { active: '启用', inactive: '停用', archived: '归档' }
            return <Tag color={colorMap[status] || 'default'}>{labelMap[status] || status}</Tag>
          }
        } else if (col.key === 'product_type') {
          column.render = (types: string | string[]) => {
            const typeList = Array.isArray(types) ? types : (types ? types.split(',') : [])
            return typeList.length > 0 ? (
              <Space size={4} style={{ display: 'inline-flex' }}>
                {typeList.map((type, idx) => (
                <Tag key={idx}>{productTypeLabelMap[type] || type}</Tag>
              ))}
              </Space>
            ) : '-'
          }
        } else if (col.key === 'product_attribute') {
          column.render = (attr: string) => attr ? <Tag color={attr === 'custom' ? 'blue' : 'default'}>{productAttributeLabelMap[attr] || attr}</Tag> : '-'
        } else if (col.key === 'local_quantity') {
          column.render = (qty: number, record: Product) => (
            <Tag 
              color={qty > 0 ? 'green' : 'default'} 
              style={{ cursor: 'pointer' }}
              onClick={() => handleStockClick(record)}
            >
              {qty}
            </Tag>
          )
        } else if (col.key === 'local_value') {
          column.render = (value: number | null) => value != null ? `¥${value.toFixed(2)}` : '-'
        } else if (col.key === 'replenishment_quantity') {
          column.render = (qty: number) => qty > 0 ? <Tag color="orange">{qty}</Tag> : <span style={{ color: '#999' }}>0</span>
        } else if (col.key === 'purchased_quantity') {
          column.render = (qty: number) => qty > 0 ? <Tag color="blue">{qty}</Tag> : <span style={{ color: '#999' }}>0</span>
        } else if (col.key === 'local_stock_age') {
          column.render = (days: number | null) => {
            if (days == null) return '-'
            let color = 'default'
            if (days > 180) color = 'red'
            else if (days > 90) color = 'orange'
            else if (days > 30) color = 'blue'
            return <Tag color={color}>{days} 天</Tag>
          }
        } else {
          column.ellipsis = true
        }

        return column
      })

    baseColumns.push({
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, record: Product) => {
        const dropdownItems: MenuProps['items'] = []
        
        if (hasPermission('product:view')) {
          dropdownItems.push(
            {
              key: 'detail',
              label: '详情',
              icon: <EyeOutlined />,
              onClick: () => {
                setDetailModalProduct(record)
                setDetailModalOpen(true)
              },
            },
            {
              key: 'stock',
              label: '查看库存',
              icon: <InboxOutlined />,
              onClick: () => handleStockClick(record),
            },
          )
        }
        
        if (hasPermission('product:edit')) {
          dropdownItems.push({
            key: 'edit',
            label: '编辑',
            icon: <EditOutlined />,
            onClick: () => handleEdit(record),
          })
          
          if (record.product_type?.includes('finished')) {
            dropdownItems.push({
              key: 'binding',
              label: '绑定配件',
              icon: <SettingOutlined />,
              onClick: () => openBindingDrawer(record),
            })
          }

          if (record.product_type?.includes('accessory')) {
            dropdownItems.push({
              key: 'acc_binding',
              label: '绑定成品',
              icon: <SettingOutlined />,
              onClick: () => openAccBindingDrawer(record),
            })
          }
        }
        
        if (hasPermission('product:delete')) {
          if (dropdownItems.length > 0) {
            dropdownItems.push({ type: 'divider' })
          }
          dropdownItems.push({
            key: 'delete',
            label: '删除',
            style: { color: '#ff4d4f' },
            icon: <DeleteOutlined />,
            onClick: (e: any) => {
              e.domEvent.stopPropagation()
              confirmDelete(record)
            },
          })
        }
        
        return (
          <Space>
            <Tooltip title="平台商品">
              <Button size="small" icon={<ShopOutlined />} onClick={() => openPpDrawer(record)}>
                平台({record.platform_count})
              </Button>
            </Tooltip>
            {dropdownItems.length > 0 && (
              <Dropdown menu={{ items: dropdownItems }} trigger={['click']}>
                <Button size="small">
                  操作 <DownOutlined />
                </Button>
              </Dropdown>
            )}
          </Space>
        )
      },
    })

    return baseColumns
  }

  const components = {
    header: {
      cell: ResizableTitle,
    },
  }

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .react-resizable { position: relative; background-clip: padding-box; }
        .react-resizable-handle { position: absolute; right: -5px; bottom: 0; width: 10px; height: 100%; cursor: col-resize; z-index: 1; }
      `}</style>
      <Card
        loading={loading}
        title={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', padding: '12px 8px' }}>
            <Space wrap style={{ width: '100%' }} size="middle">
              <Input
                placeholder="搜索产品编码、名称、分类、品牌、平台SKU、ASIN..."
                prefix={<SearchOutlined />}
                allowClear
                style={{ width: 450 }}
                value={searchText}
                onChange={(e) => handleSearch(e.target.value)}
              />
              <Select
                placeholder="产品类型"
                allowClear
                mode="multiple"
                style={{ width: 200 }}
                value={productTypeFilter}
                onChange={handleProductTypeFilter}
                options={productTypeOptions}
                showSearch
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />
              <Select
                placeholder="产品属性"
                allowClear
                style={{ width: 120 }}
                value={productAttributeFilter}
                onChange={handleProductAttributeFilter}
                options={productAttributeOptions}
                showSearch
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 794 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增商品</Button>
                <Dropdown
                  menu={{
                    items: [
                      hasPermission('product:delete') ? {
                        key: 'delete',
                        label: '批量删除',
                        onClick: () => {
                          if (selectedRowKeys.length === 0) {
                            message.warning('请先选择要操作的商品')
                            return
                          }
                          setBatchDeleteOpen(true)
                        },
                      } : null,
                      hasPermission('product:edit') ? {
                        key: 'bind',
                        label: '批量绑定配件',
                        onClick: () => {
                          if (selectedRowKeys.length === 0) {
                            message.warning('请先选择要操作的商品')
                            return
                          }
                          setSelectedAccessoryIds([])
                          setBatchBindOpen(true)
                        },
                      } : null,
                      hasPermission('shipment:create') ? {
                        key: 'shipment',
                        label: '批量生成发货单',
                        onClick: () => {
                          if (selectedRowKeys.length === 0) {
                            message.warning('请先选择要操作的商品')
                            return
                          }
                          handleBatchCreateShipment()
                        },
                      } : null,
                    ].filter(Boolean) as any,
                  }}
                >
                  <Button>批量 <DownOutlined /></Button>
                </Dropdown>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>模板</Button>
                <Button icon={<UploadOutlined />} onClick={handleImportClick} loading={uploading}>导入</Button>
                <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
                <Button icon={<CheckCircleOutlined />} onClick={handleCountClick}>仓库盘存</Button>
                <Button onClick={openDataFix}>数据补齐</Button>
              </div>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <Button onClick={() => setImportRecordModalOpen(true)}>导入记录</Button>
                <Popover
                  open={filterPanelOpen}
                  onOpenChange={(open) => setFilterPanelOpen(open)}
                  trigger="click"
                  placement="bottomRight"
                  content={
                    <div style={{ width: 600 }}>
                      {/* 顶部：符合以下 + 所有/任一 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span>符合以下</span>
                        <Select
                          value={filterMatchMode}
                          onChange={(v) => setFilterMatchMode(v)}
                          options={[
                            { label: '所有', value: 'all' },
                            { label: '任一', value: 'any' },
                          ]}
                          style={{ width: 70 }}
                        />
                        <span>条件</span>
                      </div>

                      {/* 条件列表 */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                        {filterConditions.map((condition) => (
                          <div key={condition.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Select
                              value={condition.field}
                              onChange={(v) => updateFilterCondition(condition.id, 'field', v)}
                              options={filterFieldOptions}
                              style={{ width: 150 }}
                              size="middle"
                            />
                            {condition.field === 'store_group_stock' ? (
                              <>
                                <Select
                                  value={condition.extra_value || ''}
                                  onChange={(v) => updateFilterCondition(condition.id, 'extra_value', v || '')}
                                  placeholder="选择分组"
                                  style={{ width: 140 }}
                                  size="middle"
                                  allowClear
                                  options={groups.map(g => ({ label: g.name, value: String(g.id) }))}
                                />
                                <Select
                                  value={condition.operator}
                                  onChange={(v) => updateFilterCondition(condition.id, 'operator', v)}
                                  options={filterOperatorOptions}
                                  style={{ width: 100 }}
                                  size="middle"
                                />
                                <InputNumber
                                  value={condition.value ? parseFloat(condition.value) : undefined}
                                  onChange={(v) => updateFilterCondition(condition.id, 'value', String(v || 0))}
                                  placeholder="库存数量"
                                  style={{ flex: 1 }}
                                  size="middle"
                                  min={0}
                                />
                              </>
                            ) : (
                              <>
                                <Select
                                  value={condition.operator}
                                  onChange={(v) => updateFilterCondition(condition.id, 'operator', v)}
                                  options={filterOperatorOptions}
                                  style={{ width: 100 }}
                                  size="middle"
                                />
                                <Input
                                  value={condition.value}
                                  onChange={(e) => updateFilterCondition(condition.id, 'value', e.target.value)}
                                  placeholder="输入值"
                                  style={{ flex: 1 }}
                                  size="middle"
                                  allowClear
                                />
                              </>
                            )}
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => removeFilterCondition(condition.id)}
                              size="small"
                            />
                          </div>
                        ))}
                      </div>

                      {/* 底部按钮 */}
                      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', marginTop: 8 }}>
                        <Button
                          type="link"
                          icon={<PlusOutlined />}
                          onClick={addFilterCondition}
                          style={{ padding: 0 }}
                        >
                          添加条件
                        </Button>
                      </div>
                    </div>
                  }
                >
                  <Button
                    icon={<FilterOutlined style={{ marginRight: 4 }} />}
                    style={filterConditions.length > 0 ? { color: '#1890ff', borderColor: '#1890ff' } : undefined}
                  >
                    筛选{filterConditions.length > 0 ? `(${filterConditions.length})` : ''}
                  </Button>
                </Popover>
                <Button type="text" icon={<SettingOutlined />} onClick={() => {
                  setColumnSettingTarget('main')
                  setColumnSettingOpen(true)
                }} title="列设置" />
              </div>
            </div>
          </div>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { padding: 16 } }}
      >
        <Table
          dataSource={products}
          columns={getColumns()}
          rowKey="id"
          components={components}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          scroll={{ x: 2000, y: 'calc(100vh - 380px)' }}
          pagination={false}
          tableLayout="fixed"
          sticky={{ offsetHeader: 0 }}
        />
      </Card>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', paddingRight: 8 }}>
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <Modal
        title={`确认删除 ${selectedRowKeys.length} 个商品`}
        open={batchDeleteOpen}
        onOk={handleBatchDelete}
        onCancel={() => setBatchDeleteOpen(false)}
        okText="删除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <p>确定要删除选中的 {selectedRowKeys.length} 个商品吗？</p>
        <p style={{ color: '#ff4d4f' }}>该操作不可撤销，相关的绑定关系也将被移除。</p>
      </Modal>

      <Modal
        title={`批量绑定配件 (已选 ${selectedRowKeys.length} 个成品)`}
        open={batchBindOpen}
        onOk={handleBatchBind}
        onCancel={() => {
          setBatchBindOpen(false)
          setSelectedAccessoryIds([])
        }}
        confirmLoading={batchBindLoading}
        okText="绑定"
        cancelText="取消"
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <p>选择要绑定的配件，将把它们添加到选中的 {selectedRowKeys.length} 个成品：</p>
        </div>
        <Form layout="vertical">
          <Form.Item label="选择配件" required>
            <Select
              mode="multiple"
              placeholder="请选择配件"
              showSearch
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: '100%' }}
              value={selectedAccessoryIds.length > 0 ? selectedAccessoryIds : undefined}
              onChange={(value) => setSelectedAccessoryIds(value)}
              options={products
                .filter((p) => {
                  const types = p.product_type
                  if (!types) return false
                  if (Array.isArray(types)) {
                    return types.some((t) => t && t.toLowerCase().includes('accessory'))
                  }
                  return typeof types === 'string' && types.toLowerCase().includes('accessory')
                })
                .map((p) => ({
                  value: p.id,
                  label: `${p.name || ''} (${p.product_code || p.id})`,
                }))}
            />
          </Form.Item>
          {(() => {
            const accessoryCount = products.filter((p) => {
              const types = p.product_type
              if (!types) return false
              if (Array.isArray(types)) {
                return types.some((t) => t && t.toLowerCase().includes('accessory'))
              }
              return typeof types === 'string' && types.toLowerCase().includes('accessory')
            }).length
            return accessoryCount === 0 ? (
              <div style={{ color: '#faad14', fontSize: 12, padding: 8, background: '#fffbe6', borderRadius: 4 }}>
                当前列表中没有配件。请先创建类型为"配件"的商品。
              </div>
            ) : null
          })()}
        </Form>
      </Modal>

      <Modal
        title="导入记录"
        open={importRecordModalOpen}
        onCancel={() => {
          if (importRecordDetail?.status === 'success' || importRecordDetail?.status === 'partial_success') {
            fetchData()
          }
          setImportRecordModalOpen(false)
          setImportRecordDetail(null)
        }}
        footer={[
          <Button key="close" onClick={() => {
            if (importRecordDetail?.status === 'success' || importRecordDetail?.status === 'partial_success') {
              fetchData()
            }
            setImportRecordModalOpen(false)
            setImportRecordDetail(null)
          }}>
            关闭
          </Button>
        ]}
        width={1200}
        style={{ top: 20 }}
        styles={{
          body: {
            padding: 16,
          },
        }}
      >
        {!importRecordDetail ? (
          <>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Select
                placeholder="处理状态"
                allowClear
                style={{ width: 120 }}
                value={importRecordStatus}
                onChange={(v) => setImportRecordStatus(v)}
                options={[
                  { value: 'success', label: '成功' },
                  { value: 'partial_success', label: '部分成功' },
                  { value: 'failed', label: '失败' },
                ]}
              />
              <Input
                placeholder="创建人"
                allowClear
                style={{ width: 120 }}
                value={importRecordCreator}
                onChange={(e) => setImportRecordCreator(e.target.value)}
              />
              <DatePicker.RangePicker
                style={{ width: 260 }}
                format="YYYY-MM-DD"
                value={importRecordDateRange as any}
                onChange={(range) => setImportRecordDateRange(range as any)}
              />
              <Button type="primary" onClick={fetchImportRecords}>查询</Button>
              <Button onClick={() => {
                setImportRecordStatus(undefined)
                setImportRecordCreator(undefined)
                setImportRecordDateRange(null)
                setImportRecordPage(1)
                setTimeout(() => fetchImportRecords(), 50)
              }}>重置</Button>
            </div>
            <Table
              dataSource={importRecords}
              rowKey="id"
              loading={importRecordLoading}
              size="small"
              scroll={{ y: 360 }}
              columns={[
                { title: '上传文件', dataIndex: 'file_name', width: 220, ellipsis: true },
                {
                  title: '预览状态',
                  dataIndex: 'preview_status',
                  width: 90,
                  render: (status: string) => {
                    const statusMap: Record<string, { text: string; color: string }> = {
                      'previewing': { text: '解析中', color: 'blue' },
                      'success': { text: '已就绪', color: 'green' },
                      'failed': { text: '解析失败', color: 'red' },
                    }
                    const info = statusMap[status] || { text: status || '-', color: 'default' }
                    return <Tag color={info.color}>{info.text}</Tag>
                  }
                },
                {
                  title: '处理状态',
                  dataIndex: 'status',
                  width: 90,
                  render: (status: string) => {
                    const statusMap: Record<string, { text: string; color: string }> = {
                      'pending': { text: '待处理', color: 'default' },
                      'processing': { text: '处理中', color: 'blue' },
                      'success': { text: '成功', color: 'green' },
                      'partial_success': { text: '部分成功', color: 'orange' },
                      'failed': { text: '失败', color: 'red' },
                    }
                    const info = statusMap[status] || { text: status, color: 'default' }
                    return <Tag color={info.color}>{info.text}</Tag>
                  }
                },
                {
                  title: '产品',
                  width: 90,
                  dataIndex: 'product_total',
                  render: (_: number, record: any) => (
                    <span>
                      <span style={{ color: '#52c41a' }}>{record.product_success ?? '-'}</span>
                      <span style={{ color: '#999', margin: '0 2px' }}>/</span>
                      <span>{record.product_total ?? '-'}</span>
                    </span>
                  )
                },
                {
                  title: '平台商品',
                  width: 100,
                  dataIndex: 'platform_total',
                  render: (_: number, record: any) => (
                    <span>
                      <span style={{ color: '#52c41a' }}>{record.platform_success ?? '-'}</span>
                      <span style={{ color: '#999', margin: '0 2px' }}>/</span>
                      <span>{record.platform_total ?? '-'}</span>
                    </span>
                  )
                },
                { title: '创建人', dataIndex: 'created_by', width: 80 },
                { title: '创建时间', dataIndex: 'created_at', width: 150 },
                {
                  title: '操作',
                  width: 150,
                  render: (_: any, record: any) => (
                    <Space size="small">
                      {record.preview_status === 'success' && record.status !== 'success' && record.status !== 'partial_success' && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => openImportPreviewFromRecord(record.id)}
                        >
                          查看预览
                        </Button>
                      )}
                      <Button type="link" size="small" onClick={() => openImportRecordDetail(record.id)}>
                        详情
                      </Button>
                    </Space>
                  )
                },
              ]}
              pagination={{
                current: importRecordPage,
                pageSize: importRecordPageSize,
                total: importRecordTotal,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => {
                  setImportRecordPage(page)
                  setImportRecordPageSize(pageSize)
                },
              }}
            />
          </>
        ) : (
          <>
            <Button style={{ marginBottom: 16 }} onClick={() => setImportRecordDetail(null)}>
              ← 返回列表
            </Button>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="上传文件">{importRecordDetail.file_name}</Descriptions.Item>
              <Descriptions.Item label="预览状态">
                <Tag color={
                  importRecordDetail.preview_status === 'success' ? 'green' :
                  importRecordDetail.preview_status === 'previewing' ? 'blue' :
                  importRecordDetail.preview_status === 'failed' ? 'red' : 'default'
                }>
                  {importRecordDetail.preview_status === 'success' ? '已就绪' :
                   importRecordDetail.preview_status === 'previewing' ? '解析中' :
                   importRecordDetail.preview_status === 'failed' ? '解析失败' : '-'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="处理状态">
                <Tag color={importRecordDetail.status === 'success' ? 'green' : importRecordDetail.status === 'partial_success' ? 'orange' : importRecordDetail.status === 'failed' ? 'red' : importRecordDetail.status === 'processing' ? 'blue' : 'default'}>
                  {importRecordDetail.status === 'success' ? '成功' :
                   importRecordDetail.status === 'partial_success' ? '部分成功' :
                   importRecordDetail.status === 'failed' ? '失败' :
                   importRecordDetail.status === 'processing' ? '处理中...' :
                   importRecordDetail.status === 'pending' ? '待处理' : importRecordDetail.status}
                </Tag>
              </Descriptions.Item>

              {/* 总体进度条 */}
              {importRecordDetail.status === 'processing' && (
                <Descriptions.Item label="导入进度" span={2}>
                  <div style={{ marginBottom: 8 }}>
                    <Progress
                      percent={(() => {
                        const total = (importRecordDetail.product_total ?? 0) + (importRecordDetail.platform_total ?? 0)
                        const success = (importRecordDetail.product_success ?? 0) + (importRecordDetail.platform_success ?? 0)
                        if (total === 0) return 0
                        return Math.round((success / total) * 100)
                      })()}
                      status="active"
                      strokeColor={{ from: '#108ee9', to: '#87d068' }}
                      style={{ marginTop: 4 }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    已完成 {(importRecordDetail.product_success ?? 0) + (importRecordDetail.platform_success ?? 0)} / {(importRecordDetail.product_total ?? 0) + (importRecordDetail.platform_total ?? 0)} 条
                  </div>
                </Descriptions.Item>
              )}

              {/* 产品统计 */}
              <Descriptions.Item label={<span><strong>产品</strong>（共{importRecordDetail.product_total ?? 0}条）</span>}>
                {importRecordDetail.status === 'processing' || importRecordDetail.status === 'pending' ? (
                  <span style={{ color: '#1890ff' }}><LoadingOutlined style={{ marginRight: 6 }} />导入中...</span>
                ) : (
                  <>
                    <span style={{ color: '#52c41a', fontWeight: 600 }}>成功 {importRecordDetail.product_success ?? 0}</span>
                    {importRecordDetail.product_total != null && importRecordDetail.product_success != null && importRecordDetail.product_success < importRecordDetail.product_total && (
                      <span style={{ color: '#ff4d4f', marginLeft: 12 }}>失败 {importRecordDetail.product_total - importRecordDetail.product_success}</span>
                    )}
                  </>
                )}
              </Descriptions.Item>

              {/* 平台商品统计 */}
              <Descriptions.Item label={<span><strong>平台商品</strong>（共{importRecordDetail.platform_total ?? 0}条）</span>}>
                {importRecordDetail.status === 'processing' || importRecordDetail.status === 'pending' ? (
                  <span style={{ color: '#1890ff' }}><LoadingOutlined style={{ marginRight: 6 }} />导入中...</span>
                ) : (
                  <>
                    <span style={{ color: '#52c41a', fontWeight: 600 }}>成功 {importRecordDetail.platform_success ?? 0}</span>
                    {importRecordDetail.platform_total != null && importRecordDetail.platform_success != null && importRecordDetail.platform_success < importRecordDetail.platform_total && (
                      <span style={{ color: '#ff4d4f', marginLeft: 12 }}>失败 {importRecordDetail.platform_total - importRecordDetail.platform_success}</span>
                    )}
                  </>
                )}
              </Descriptions.Item>

              <Descriptions.Item label="创建人">{importRecordDetail.created_by}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {importRecordDetail.created_at}
              </Descriptions.Item>
            </Descriptions>
            {importRecordDetail.preview_status === 'success' &&
             importRecordDetail.status !== 'success' &&
             importRecordDetail.status !== 'partial_success' && (
              <div style={{ marginTop: 16 }}>
                <Button type="primary" onClick={() => openImportPreviewFromRecord(importRecordDetail.id, true)}>
                  查看预览并确认导入
                </Button>
              </div>
            )}

            {/* 产品错误（优先用新格式 product_errors，兼容旧格式 error_details 数组） */}
            {(() => {
              const pErrs = (importRecordDetail.product_errors && importRecordDetail.product_errors.length > 0)
                ? importRecordDetail.product_errors
                : (Array.isArray(importRecordDetail.error_details) ? importRecordDetail.error_details : [])
              if (pErrs.length === 0) return null
              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ marginBottom: 8, fontWeight: 500, color: '#ff4d4f' }}>
                    产品错误（{pErrs.length}条）：
                  </div>
                  <div style={{
                    maxHeight: 200, overflowY: 'auto',
                    background: '#fff1f0', padding: 12,
                    border: '1px solid #ffccc7', borderRadius: 4
                  }}>
                    {pErrs.map((err: string, idx: number) => (
                      <div key={idx} style={{ marginBottom: 4, color: '#cf1322', fontSize: 13 }}>
                        {idx + 1}. {err}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* 平台商品/绑定错误 */}
            {(importRecordDetail.platform_errors && importRecordDetail.platform_errors.length > 0) && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500, color: '#fa8c16' }}>
                  平台商品/绑定错误（{importRecordDetail.platform_errors.length}条）：
                </div>
                <div style={{
                  maxHeight: 200, overflowY: 'auto',
                  background: '#fff7e6', padding: 12,
                  border: '1px solid #ffd591', borderRadius: 4
                }}>
                  {importRecordDetail.platform_errors.map((err: string, idx: number) => (
                    <div key={idx} style={{ marginBottom: 4, color: '#ad6800', fontSize: 13 }}>
                      {idx + 1}. {err}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal
        title={editingProduct ? '编辑商品' : '新增商品'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={720}
        style={{ top: 20 }}
        styles={{ body: { 
          maxHeight: 'calc(100vh - 180px)', 
          overflow: 'auto', 
          paddingRight: 8 
        } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="product_code" label="商品编码" rules={[{ required: true, message: '请输入商品编码' }]}>
            <Input placeholder="请输入商品编码（唯一）" />
          </Form.Item>
          <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
            <Input placeholder="请输入商品名称" />
          </Form.Item>
          <Form.Item name="name_en" label="英文名称">
            <Input placeholder="请输入英文名称" />
          </Form.Item>
          <Form.Item name="product_type" label="商品类型">
            <Select placeholder="请选择商品类型" options={productTypeOptions} allowClear mode="multiple" />
          </Form.Item>
          <Form.Item name="product_attribute" label="产品属性" initialValue="general">
            <Select placeholder="请选择产品属性" options={productAttributeOptions} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="请输入分类" />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Input placeholder="请输入品牌" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="purchase_price" label="采购价">
              <InputNumber style={{ width: '100%' }} placeholder="采购价" min={0} precision={2} prefix="¥" />
            </Form.Item>
            <Form.Item name="sale_price" label="建议售价">
              <InputNumber style={{ width: '100%' }} placeholder="建议售价" min={0} precision={2} prefix="¥" />
            </Form.Item>
          </div>
          <Form.Item name="main_image" label="主图URL">
            <Input placeholder="请输入主图URL" />
          </Form.Item>
          <Divider orientation="left" plain>尺寸/重量</Divider>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="weight" label="重量(kg)">
              <InputNumber style={{ width: '100%' }} min={0} precision={3} />
            </Form.Item>
            <Form.Item name="length" label="长(cm)">
              <InputNumber style={{ width: '100%' }} min={0} precision={1} />
            </Form.Item>
            <Form.Item name="width" label="宽(cm)">
              <InputNumber style={{ width: '100%' }} min={0} precision={1} />
            </Form.Item>
            <Form.Item name="height" label="高(cm)">
              <InputNumber style={{ width: '100%' }} min={0} precision={1} />
            </Form.Item>
          </div>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select placeholder="请选择状态" options={statusOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`平台商品 - ${ppCurrentProductName}`}
        open={ppDrawerOpen}
        onClose={() => setPpDrawerOpen(false)}
        width={1000}
        extra={
          hasPermission('platform:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handlePpCreate}>
              新增平台商品
            </Button>
          )
        }
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      >
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <Table
            dataSource={ppList}
            rowKey="id"
            loading={ppLoading}
            size="small"
            pagination={false}
            components={components}
            tableLayout="fixed"
            scroll={{ x: 'max-content', y: 'calc(100vh - 300px)' }}
            columns={ppColumnStates
              .filter(col => col.visible)
              .map((col, index) => {
                const column: any = {
                  title: col.title,
                  dataIndex: col.key,
                  key: col.key,
                  width: col.width,
                  onHeaderCell: (column: any) => ({
                    width: column.width,
                    onResize: handlePpResize(ppColumnStates.findIndex(c => c.key === col.key)),
                  }),
                }
                
                if (col.key === 'image_url') {
                  column.render = (url: string) =>
                    url ? (
                      <Image 
                        src={url} 
                        width={40} 
                        height={40} 
                        style={{ objectFit: 'cover', borderRadius: 4 }} 
                        preview={{ mask: false }}
                        loading="lazy"
                        placeholder={
                          <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <AppstoreOutlined style={{ color: '#ccc' }} />
                          </div>
                        }
                      />
                    ) : (
                      <div style={{ width: 40, height: 40, background: '#f0f0f0', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AppstoreOutlined style={{ color: '#ccc' }} />
                      </div>
                    )
                } else if (col.key === 'platform') {
                  column.render = (p: string) => <Tag color={platformColorMap[p] || 'default'}>{p?.toUpperCase()}</Tag>
                } else if (col.key === 'store_names') {
                  column.render = (names: string[]) => names?.length > 0
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {names.map((n, i) => <Tag key={i} color="blue" style={{ margin: 0 }}>{n}</Tag>)}
                      </div>
                    : '-'
                } else if (col.key === 'title') {
                  column.render = (text: string) => (
                    <div style={{ 
                      wordBreak: 'break-word', 
                      whiteSpace: 'pre-wrap', 
                      lineHeight: 1.5 
                    }}>
                      {text || '-'}
                    </div>
                  )
                } else if (col.key === 'price') {
                  column.render = (price: number | null, row: PlatformProduct) =>
                    price != null ? `${row.currency || ''}${price.toFixed(2)}` : '-'
                } else if (col.key === 'status') {
                  column.render = (s: string) => {
                    const colorMap: Record<string, string> = { active: 'success', inactive: 'default', archived: 'error' }
                    const labelMap: Record<string, string> = { active: '启用', inactive: '停用', archived: '归档' }
                    return <Tag color={colorMap[s] || 'default'}>{labelMap[s] || s}</Tag>
                  }
                }
                
                return column
              }).concat([
                {
                  title: '操作',
                  key: 'actions',
                  width: 120,
                  fixed: 'right' as const,
                  onCell: () => ({
                    style: {
                      borderLeft: '1px solid #f0f0f0',
                      backgroundColor: '#fff'
                    }
                  }),
                  onHeaderCell: () => ({
                    style: {
                      borderLeft: '1px solid #f0f0f0',
                      backgroundColor: '#fafafa'
                    }
                  }),
                  render: (_: any, record: PlatformProduct) => (
                    <Space>
                      {hasPermission('platform:edit') && (
                        <Button size="small" icon={<EditOutlined />} onClick={() => handlePpEdit(record)} />
                      )}
                      {hasPermission('platform:delete') && (
                        <Popconfirm title="确定删除?" onConfirm={() => handlePpDelete(record.id)}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      )}
                    </Space>
                  ),
                },
              ])}
          />
        </div>
      </Drawer>

      <Modal
        title={ppEditingItem ? '编辑平台商品' : '新增平台商品'}
        open={ppModalOpen}
        onOk={handlePpSubmit}
        onCancel={() => {
          ppForm.resetFields()
          setPpEditingItem(null)
          setPpTransferTargetKeys([])
          setPpModalOpen(false)
        }}
        width={640}
        style={{ top: 20 }}
        styles={{ body: { 
          maxHeight: 'calc(100vh - 180px)', 
          overflow: 'auto', 
          paddingRight: 8 
        } }}
      >
        <Form 
          form={ppForm} 
          layout="vertical"
        >
          <Form.Item
            name="platform"
            label="平台"
            rules={[{ required: true, message: '请选择平台' }]}
          >
            <Select
              placeholder="请选择平台"
              options={platformOptions}
              onChange={() => {
                setPpTransferTargetKeys([])
              }}
            />
          </Form.Item>

          <Form.Item label="选择店铺">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                value={ppTransferTargetKeys.length > 0 
                  ? `${ppTransferTargetKeys.length} 个店铺已选中`
                  : '请点击选择店铺'
                }
                placeholder="请点击选择店铺"
                readOnly
              />
              <Button type="primary" onClick={handleOpenTransfer}>
                选择店铺
              </Button>
            </div>
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="platform_product_id" label="平台商品ID">
              <Input placeholder="平台侧的商品ID" />
            </Form.Item>
            <Form.Item name="asin" label="ASIN">
              <Input placeholder="ASIN" />
            </Form.Item>
            <Form.Item name="sku" label="SKU">
              <Input placeholder="SKU" />
            </Form.Item>
          </div>
          <Form.Item name="title" label="标题">
            <Input placeholder="平台商品标题" />
          </Form.Item>
          <Form.Item name="title_en" label="英文标题">
            <Input placeholder="英文标题" />
          </Form.Item>
          <Form.Item name="image_url" label="商品图片URL">
            <Input placeholder="请输入图片URL" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="currency" label="货币">
              <Input placeholder="USD / CNY" />
            </Form.Item>
            <Form.Item name="price" label="售价">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="cost_price" label="成本价">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
          </div>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select options={statusOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="选择店铺"
        open={ppTransferOpen}
        onOk={() => setPpTransferOpen(false)}
        onCancel={() => setPpTransferOpen(false)}
        width={700}
      >
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Select
            style={{ width: 200 }}
            placeholder="按分组筛选"
            allowClear
            value={ppTransferFilterGroupId}
            onChange={(value) => setPpTransferFilterGroupId(value)}
            options={[
              { label: '全部店铺', value: undefined },
              ...groups.map(g => ({ label: g.name, value: g.id })),
            ]}
          />
        </div>
        <Transfer
          dataSource={(() => {
            const platform = ppForm.getFieldValue('platform')
            return stores
              .filter(s => !platform || s.platform === platform)
              .filter(s => !ppTransferFilterGroupId || s.group_id === ppTransferFilterGroupId)
              .map(s => ({
                key: String(s.id),
                title: s.inventory_name || s.name,
                description: s.platform,
              }))
          })()}
          titles={['所有店铺', '已选店铺']}
          targetKeys={ppTransferTargetKeys}
          onChange={(nextKeys) => setPpTransferTargetKeys(nextKeys as string[])}
          render={item => item.title}
          showSearch
          filterOption={(input, item) =>
            item.title.toLowerCase().includes(input.toLowerCase())
          }
          listStyle={{ width: 280, height: 400 }}
        />
      </Modal>

      <Drawer
        title={`列设置 - ${columnSettingTarget === 'main' ? '商品列表' : '平台商品'}`}
        open={columnSettingOpen}
        onClose={() => setColumnSettingOpen(false)}
        width={320}
        extra={
          <Space>
            <Button onClick={handleResetColumns}>重置</Button>
            <Button type="primary" onClick={() => setColumnSettingOpen(false)}>完成</Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(displayColumns || (columnSettingTarget === 'main' ? columnStates : ppColumnStates)).map((col, index) => (
            <div
              key={col.key}
              draggable
              onDragStart={(e) => handleDragStart(index, e)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(index)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 12px',
                border: `2px solid ${draggedIndex === index ? '#1890ff' : (dragOverIndex === index ? '#1890ff' : '#f0f0f0')}`,
                borderRadius: 6,
                backgroundColor: draggedIndex === index ? '#e6f7ff' : (dragOverIndex === index ? '#f0f5ff' : '#fff'),
                cursor: 'move',
                transition: 'all 0.15s ease',
                transform: draggedIndex === index ? 'scale(1.02)' : 'scale(1)',
                boxShadow: draggedIndex === index ? '0 4px 12px rgba(24, 144, 255, 0.25)' : 'none',
                userSelect: 'none',
              }}
            >
              <HolderOutlined 
                style={{ 
                  color: draggedIndex === index ? '#1890ff' : '#999', 
                  marginRight: 10, 
                  cursor: 'grab',
                  fontSize: '16px'
                }} 
              />
              <Checkbox
                checked={col.visible}
                onChange={(e) => handleCurrentColumnToggle(col.key, e.target.checked)}
                style={{ flex: 1 }}
              >
                <span style={{ 
                  fontWeight: draggedIndex === index ? 600 : 400,
                  color: draggedIndex === index ? '#1890ff' : '#333'
                }}>
                  {col.title}
                </span>
              </Checkbox>
            </div>
          ))}
        </div>
      </Drawer>

      <Modal
        title={
          <Space>
            <span>库存详情 - {stockModalProduct?.name || ''}</span>
            {stockData && stockData.some((b: any) => !b.shelf_number) && (
              <Tag color="error">
                {stockData.filter((b: any) => !b.shelf_number).length} 个批次货架号缺失
              </Tag>
            )}
          </Space>
        }
        open={stockModalOpen}
        onCancel={() => { setStockModalOpen(false); setShelfEditBatchId(null) }}
        footer={null}
        width={1200}
        loading={stockLoading}
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } }}
      >
        {stockData && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
              <Card size="small" style={{ flex: 1 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 'bold', color: '#1890ff' }}>
                    {stockData.reduce((sum: number, batch: any) => sum + (batch.current_quantity || 0), 0)}
                  </div>
                  <div style={{ color: '#999' }}>当前库存总量</div>
                </div>
              </Card>
              <Card size="small" style={{ flex: 1 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 'bold', color: '#52c41a' }}>{stockData.length}</div>
                  <div style={{ color: '#999' }}>活跃批次</div>
                </div>
              </Card>
            </div>
            <Divider orientation="left">各平台库存</Divider>
            {stockPlatformData.length > 0 ? (
              <Table
                dataSource={stockPlatformData}
                rowKey="platform"
                size="small"
                pagination={false}
                columns={[
                  { title: '平台', dataIndex: 'platform', key: 'platform', width: 150,
                    render: (v: string) => {
                      const colorMap: Record<string, string> = { amazon: 'orange', ebay: 'blue', walmart: 'yellow', shopify: 'green', shopee: 'red', lazada: 'purple', tiktok: 'cyan', temu: 'volcano', other: 'default' }
                      const labelMap: Record<string, string> = { amazon: 'Amazon', ebay: 'eBay', walmart: 'Walmart', shopify: 'Shopify', shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok', temu: 'Temu', other: '其他' }
                      return <Tag color={colorMap[v] || 'default'}>{labelMap[v] || v}</Tag>
                    }
                  },
                  { title: '库存数量', dataIndex: 'quantity', key: 'quantity', width: 120,
                    render: (v: number) => <Tag color="blue">{v}</Tag>
                  },
                  { title: '店铺分组', key: 'groups', width: 300,
                    render: (_: any, record: any) => {
                      const platformGroups = stockGroupData.filter((g: any) => g.platform === record.platform)
                      if (platformGroups.length === 0) return <span style={{ color: '#999' }}>-</span>
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {platformGroups.map((g: any) => (
                            <Tag key={g.group_id || 'ungrouped'} color="cyan">
                              {g.group_name || '未分组'}: {g.quantity}
                            </Tag>
                          ))}
                        </div>
                      )
                    }
                  },
                ]}
              />
            ) : (
              <div style={{ color: '#999', padding: '16px 0', textAlign: 'center' }}>暂无库存</div>
            )}
            <Divider orientation="left">库存批次明细</Divider>
            <Table
              dataSource={stockData}
              rowKey="batch_number"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: '批次号', dataIndex: 'batch_number', key: 'batch_number', width: 150,
                  render: (v: string) => v || <Tag color="orange">自动生成中</Tag> },
                { title: '来源', dataIndex: 'source_type', key: 'source_type', width: 100,
                  render: (t: string) => 
                    t === 'stock_transfer' 
                      ? <Tag color="purple">挪货</Tag> 
                      : <Tag color="green">入库</Tag> 
                },
                { title: '库存数量', dataIndex: 'current_quantity', key: 'current_quantity', width: 120,
                  render: (v: number) => <Tag color="blue">{v}</Tag> },
                { title: '采购单价', dataIndex: 'unit_price', key: 'unit_price', width: 120,
                  render: (v: number) => `¥${v.toFixed(2)}` },
                { title: '仓库', dataIndex: 'warehouse', key: 'warehouse', width: 120 },
                { title: '货架号', dataIndex: 'shelf_number', key: 'shelf_number', width: 130,
                  render: (v: string, record: any) => {
                    if (shelfEditBatchId === record.id) {
                      return (
                        <Input
                          ref={shelfInputRef}
                          size="small"
                          value={shelfEditValue}
                          onChange={(e) => setShelfEditValue(e.target.value)}
                          onPressEnter={handleShelfEditConfirm}
                          onBlur={handleShelfEditConfirm}
                          style={{ width: 100 }}
                        />
                      )
                    }
                    return (
                      <span
                        style={{ cursor: 'pointer', borderBottom: '1px dashed #d9d9d9', color: v ? undefined : '#ff4d4f' }}
                        onClick={() => handleShelfEditStart(record.id, record.shelf_number)}
                        title="点击编辑货架号"
                      >
                        {v || '点击补齐'}
                      </span>
                    )
                  }
                },
                { title: '入库日期', dataIndex: 'inbound_date', key: 'inbound_date', width: 180 },
                { title: '库龄(天)', dataIndex: 'stock_age', key: 'stock_age', width: 120,
                  render: (days: number) => {
                    let color = 'default'
                    if (days > 180) color = 'red'
                    else if (days > 90) color = 'orange'
                    else if (days > 30) color = 'blue'
                    return <Tag color={color}>{days} 天</Tag>
                  } },
              ]}
            />
            {stockHistory.length > 0 && (
              <>
                <Divider orientation="left" style={{ marginTop: 24 }}>出入库历史</Divider>
                <Table
                  dataSource={stockHistory.slice(0, 20)}
                  rowKey={(record, index) => `${record.created_at}-${index}`}
                  size="small"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  columns={[
                    { title: '类型', dataIndex: 'sub_type', key: 'sub_type', width: 100,
                      render: (t: string, record: any) => {
                        const displayText = t || (record.type === 'inbound' ? '入库' : '出库');
                        return <Tag color={record.type === 'inbound' ? 'green' : 'red'}>{displayText}</Tag>;
                      }},
                    { title: '订单号', dataIndex: 'order_number', key: 'order_number', width: 180 },
                    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 120,
                      render: (v: number) => <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 'bold' }}>{v > 0 ? `+${v}` : v}</span> },
                    { title: '批次号', dataIndex: 'batch_number', key: 'batch_number', width: 200,
                      render: (batch: string, record: any) => {
                        const extraCount = record.batch_details ? record.batch_details.length - 1 : 0;
                        return (
                          <Space size={4}>
                            <Tag color="blue">{batch || '-'}</Tag>
                            {extraCount > 0 && (
                              <Tooltip
                                title={
                                  <div>
                                    {record.batch_details.map((d: any, i: number) => (
                                      <div key={i}>
                                        批次 <strong>{d.batch_number}</strong>: 扣减 {d.quantity} 件
                                      </div>
                                    ))}
                                  </div>
                                }
                              >
                                <Tag color="orange" style={{ cursor: 'pointer' }}>+{extraCount}</Tag>
                              </Tooltip>
                            )}
                          </Space>
                        );
                      }},
                    { title: '仓库', dataIndex: 'warehouse', key: 'warehouse', width: 150 },
                    { title: '操作时间', dataIndex: 'created_at', key: 'created_at', width: 180 },
                  ]}
                />
              </>
            )}
          </>
        )}
      </Modal>
      
      <Modal
        title={`商品详情 - ${detailModalProduct?.name || ''}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={720}
      >
        {detailModalProduct && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {detailModalProduct.main_image && (
              <div style={{ textAlign: 'center' }}>
                <Image 
                  src={detailModalProduct.main_image} 
                  style={{ width: 200, height: 200, objectFit: 'cover', borderRadius: 8 }}
                  preview={true}
                />
              </div>
            )}
            <Card size="small" title="基本信息">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><strong>产品编码:</strong> {detailModalProduct.product_code}</div>
                <div><strong>产品类型:</strong> 
              {(() => {
                const types = Array.isArray(detailModalProduct.product_type) 
                  ? detailModalProduct.product_type 
                  : (detailModalProduct.product_type ? detailModalProduct.product_type.split(',') : []);
                return types.length > 0 
                  ? types.map((type, idx) => <Tag key={idx} style={{ marginRight: 4 }}>{productTypeLabelMap[type] || type}</Tag>) 
                  : '-';
              })()}
            </div>
                <div><strong>产品属性:</strong> {productAttributeLabelMap[detailModalProduct.product_attribute] || detailModalProduct.product_attribute}</div>
                <div><strong>分类:</strong> {detailModalProduct.category || '-'}</div>
                <div><strong>品牌:</strong> {detailModalProduct.brand || '-'}</div>
                <div><strong>状态:</strong> <Tag color={{ active: 'success', inactive: 'default', archived: 'error' }[detailModalProduct.status]}>{{ active: '启用', inactive: '停用', archived: '归档' }[detailModalProduct.status]}</Tag></div>
              </div>
            </Card>
            <Card size="small" title="价格信息">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><strong>采购价:</strong> {detailModalProduct.purchase_price != null ? `¥${detailModalProduct.purchase_price.toFixed(2)}` : '-'}</div>
                <div><strong>建议售价:</strong> {detailModalProduct.sale_price != null ? `¥${detailModalProduct.sale_price.toFixed(2)}` : '-'}</div>
                <div><strong>货值:</strong> {detailModalProduct.local_value != null ? `¥${detailModalProduct.local_value.toFixed(2)}` : '-'}</div>
              </div>
            </Card>
            <Card size="small" title="尺寸/重量">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <div><strong>重量:</strong> {detailModalProduct.weight != null ? `${detailModalProduct.weight} kg` : '-'}</div>
                <div><strong>长:</strong> {detailModalProduct.length != null ? `${detailModalProduct.length} cm` : '-'}</div>
                <div><strong>宽:</strong> {detailModalProduct.width != null ? `${detailModalProduct.width} cm` : '-'}</div>
                <div><strong>高:</strong> {detailModalProduct.height != null ? `${detailModalProduct.height} cm` : '-'}</div>
              </div>
            </Card>
          </div>
        )}
      </Modal>

      <Modal
        title="导入预览"
        open={importPreviewOpen}
        onCancel={() => {
          setImportPreviewOpen(false)
          setImportPreviewRecordId(null)
        }}
        width={importPreviewData.platform_products.length > 0 ? 1200 : 900}
        footer={[
          <Button key="cancel" onClick={() => {
            setImportPreviewOpen(false)
            setImportPreviewRecordId(null)
          }}>取消</Button>,
          <Button key="confirm" type="primary" loading={importing} onClick={handleConfirmImport}>
            确认导入
          </Button>,
        ]}
      >
        {importPreviewData.products.length > 0 && (
          <>
            <Divider orientation="left" plain>产品 (共 {importPreviewData.products.length} 条)</Divider>
            <Table
              dataSource={importPreviewData.products}
              rowKey={(_, idx) => `product-${idx}`}
              size="small"
              scroll={{ y: 300 }}
              pagination={{ pageSize: 50, showSizeChanger: false, showQuickJumper: true, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
              columns={[
                { title: '产品编码', dataIndex: 'product_code', width: 120 },
                { title: '产品名称', dataIndex: 'name', width: 200 },
                { title: '分类', dataIndex: 'category', width: 100, render: (v: string) => v || '-' },
                { title: '品牌', dataIndex: 'brand', width: 100, render: (v: string) => v || '-' },
                { title: '采购价', dataIndex: 'purchase_price', width: 100, render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-' },
                { title: '建议售价', dataIndex: 'sale_price', width: 100, render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-' },
              ]}
            />
          </>
        )}
        {importPreviewData.platform_products.length > 0 && (
          <>
            <Divider orientation="left" plain style={{ marginTop: importPreviewData.products.length > 0 ? 24 : 0 }}>平台商品 (共 {importPreviewData.platform_products.length} 条)</Divider>
            <Table
              dataSource={importPreviewData.platform_products}
              rowKey={(_, idx) => `platform-${idx}`}
              size="small"
              scroll={{ y: 300 }}
              pagination={{ pageSize: 50, showSizeChanger: false, showQuickJumper: true, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
              columns={[
                { title: '产品编码', dataIndex: 'product_code', width: 120 },
                { title: '品名', dataIndex: 'product_name', width: 150, render: (v: string) => v || '-' },
                { title: '平台', dataIndex: 'platform', width: 100 },
                { title: '店铺', dataIndex: 'store_with_site_raw', width: 180, render: (v: string) => v || '-' },
                { title: 'SKU', dataIndex: 'sku', width: 120, render: (v: string) => v || '-' },
                { title: '标题', dataIndex: 'title', width: 200, render: (v: string) => v || '-' },
                { title: '售价', dataIndex: 'price', width: 100, render: (v: number, record: any) => v != null ? `${record.currency || ''} ${v.toFixed(2)}` : '-' },
                { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => {
                  const statusMap: Record<string, string> = { active: '启用', inactive: '停用', archived: '归档' }
                  return <Tag color={v === 'active' ? 'green' : v === 'inactive' ? 'default' : 'red'}>{statusMap[v] || v}</Tag>
                }},
              ]}
            />
          </>
        )}
        {importErrors.length > 0 && (
          <>
            <Divider orientation="left" plain style={{ marginTop: 24, color: '#ff4d4f' }}>
              错误详情 ({importErrors.length} 条)
            </Divider>
            <div style={{
              maxHeight: 200,
              overflowY: 'auto',
              backgroundColor: '#fff1f0',
              padding: 12,
              border: '1px solid #ffccc7',
              borderRadius: 4,
            }}>
              {importErrors.map((err, idx) => (
                <div key={idx} style={{ color: '#cf1322', fontSize: 13, marginBottom: 4 }}>
                  • {err}
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      <Drawer
        title="数据缺失补齐"
        open={dataFixOpen}
        onClose={() => { setDataFixOpen(false); setDataFixEditingId(null) }}
        width={700}
        loading={dataFixLoading}
      >
        <div style={{ marginBottom: 16, color: '#999' }}>
          以下产品存在数据缺失，点击"编辑"进入产品编辑页补充
        </div>
        <Table
          dataSource={dataFixProducts}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: '产品编码', dataIndex: 'product_code', width: 120 },
            { title: '产品名称', dataIndex: 'name', width: 200 },
            { title: '缺失项', width: 200,
              render: (_: any, record: Product) => (
                <Space size={4}>
                  {record.purchase_price == null && <Tag color="red">采购价</Tag>}
                  {record.weight == null && <Tag color="orange">重量</Tag>}
                  {record.length == null && <Tag color="orange">长</Tag>}
                  {record.width == null && <Tag color="orange">宽</Tag>}
                  {record.height == null && <Tag color="orange">高</Tag>}
                </Space>
              )
            },
            { title: '操作', width: 100,
              render: (_: any, record: Product) => (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleDataFixEdit(record)}
                >
                  编辑
                </Button>
              )
            },
          ]}
        />
      </Drawer>

      <input
        ref={countFileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleCountFileChange}
      />

      <Modal
        title="仓库盘存"
        open={countModalOpen}
        onCancel={() => { setCountModalOpen(false); setCountResult(null) }}
        width={900}
        footer={
          countResult ? (
            <Space>
              <Button onClick={() => { setCountResult(null) }}>重新上传</Button>
              <Button onClick={() => { setCountModalOpen(false); setCountResult(null) }}>取消</Button>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleCountConfirm}
                loading={countConfirming}
                danger={countResult.has_diff}
              >
                {countResult.has_diff ? '确认并更新库存差异' : '确认'}
              </Button>
            </Space>
          ) : null
        }
      >
        {!countResult ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ marginBottom: 24 }}>
              <Button size="large" icon={<DownloadOutlined />} onClick={downloadCountTemplate} style={{ marginRight: 16 }}>
                下载盘存模板
              </Button>
              <Button
                size="large"
                type="primary"
                icon={<UploadOutlined />}
                loading={countUploading}
                onClick={handleCountFileUpload}
              >
                上传盘存文件
              </Button>
            </div>
            <div style={{ color: '#999', fontSize: 13 }}>
              请先下载模板，按模板格式填写盘点数据后上传，系统将自动对比库存差异
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', gap: 24, alignItems: 'center' }}>
              <div>
                <span style={{ color: '#666' }}>盘点总数：</span>
                <strong>{countResult.total}</strong>
              </div>
              <div>
                <span style={{ color: '#666' }}>差异数量：</span>
                <strong style={{ color: countResult.has_diff ? '#ff4d4f' : '#52c41a' }}>
                  {countResult.diff_count}
                </strong>
              </div>
              {countResult.has_diff && (
                <Tag color="error" icon={<WarningOutlined />}>存在库存差异，请确认后更新</Tag>
              )}
              {!countResult.has_diff && (
                <Tag color="success" icon={<CheckCircleOutlined />}>库存一致</Tag>
              )}
            </div>
            <Table
              dataSource={countResult.items}
              rowKey={(record: any, index: number) => `${record.product_code}-${index}`}
              size="small"
              scroll={{ y: 400 }}
              pagination={false}
              columns={[
                { title: '产品编码', dataIndex: 'product_code', width: 120 },
                { title: '产品名称', dataIndex: 'product_name', width: 150 },
                { title: '仓库', dataIndex: 'warehouse', width: 100 },
                { title: '系统库存', dataIndex: 'system_quantity', width: 90, align: 'center' as const },
                { title: '盘点数量', dataIndex: 'count_quantity', width: 90, align: 'center' as const },
                {
                  title: '差异',
                  dataIndex: 'difference',
                  width: 90,
                  align: 'center' as const,
                  render: (val: number) => {
                    if (val === 0) return <Tag color="default">0</Tag>
                    return (
                      <Tag color={val > 0 ? 'green' : 'red'}>
                        {val > 0 ? '+' : ''}{val}
                      </Tag>
                    )
                  },
                },
                { title: '备注', dataIndex: 'notes', width: 120, ellipsis: true },
              ]}
              rowClassName={(record: any) => record.has_difference ? 'inventory-count-diff-row' : ''}
            />
            <style>{`
              .inventory-count-diff-row { background-color: #fff2f0 !important; }
              .inventory-count-diff-row:hover { background-color: #ffe7e5 !important; }
            `}</style>
          </div>
        )}
      </Modal>

      {/* 成品配件绑定管理 */}
      <Drawer
        title={`配件绑定 - ${bindingProduct?.name || ''}`}
        open={bindingDrawerOpen}
        onClose={() => setBindingDrawerOpen(false)}
        width={700}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleBindingCreate}>
            新增绑定
          </Button>
        }
      >
        <Table
          dataSource={bindingList}
          rowKey="id"
          loading={bindingLoading}
          size="small"
          pagination={false}
          columns={[
            { title: '配件名称', dataIndex: 'accessory_name', width: 200 },
            { title: '配件编码', dataIndex: 'accessory_code', width: 130 },
            { title: '数量', dataIndex: 'quantity', width: 80,
              render: (qty: number) => <Tag color="blue">{qty}</Tag>
            },
            {
              title: '操作',
              key: 'actions',
              width: 150,
              render: (_: any, record: any) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleBindingEdit(record)} />
                  <Popconfirm title="确定删除?" onConfirm={() => handleBindingDelete(record.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: '暂无配件绑定，点击右上角"新增绑定"添加' }}
        />
      </Drawer>

      <Modal
        title={bindingEditingItem ? '编辑绑定' : '新增绑定'}
        open={bindingModalOpen}
        onOk={handleBindingSubmit}
        onCancel={() => {
          bindingForm.resetFields()
          setBindingEditingItem(null)
          setBindingModalOpen(false)
          // 清空搜索状态
          setAccSearchText('')
          if (accSearchTimeoutRef.current) {
            clearTimeout(accSearchTimeoutRef.current)
          }
        }}
        width={500}
      >
        <Form form={bindingForm} layout="vertical">
          <Form.Item
            name="accessory_product_id"
            label="配件产品"
            rules={[{ required: true, message: '请选择配件产品' }]}
          >
            <Select
              placeholder="请选择配件产品"
              showSearch
              disabled={!!bindingEditingItem}
              filterOption={false}
              onSearch={handleAccSearch}
              onPopupScroll={(e) => {
                const target = e.target as HTMLDivElement
                // 滚动到底部时加载更多
                if (target.scrollTop + target.clientHeight === target.scrollHeight) {
                  loadMoreAccessories()
                }
              }}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  {accLoadingMore && (
                    <div style={{ padding: '8px', textAlign: 'center' }}>
                      <Spin size="small" />
                    </div>
                  )}
                </>
              )}
              options={allAccessories
                .filter(p => p.id !== bindingProduct?.id)
                .map(p => ({
                  label: `[${p.product_code}] ${p.name}`,
                  value: p.id,
                }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label="配件数量"
            rules={[{ required: true, message: '请输入配件数量' }]}
            initialValue={1}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="请输入出库时自动扣除的配件数量" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 配件绑定成品管理（反向查看） */}
      <Drawer
        title={`绑定成品 - ${accBindingProduct?.name || ''}`}
        open={accBindingDrawerOpen}
        onClose={() => setAccBindingDrawerOpen(false)}
        width={700}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAccBindingCreate}>
            新增绑定
          </Button>
        }
      >
        <Table
          dataSource={accBindingList}
          rowKey="id"
          loading={accBindingLoading}
          size="small"
          pagination={false}
          columns={[
            { title: '成品名称', dataIndex: 'finished_name', width: 200 },
            { title: '成品编码', dataIndex: 'finished_code', width: 130 },
            { title: '数量', dataIndex: 'quantity', width: 80,
              render: (qty: number) => <Tag color="blue">{qty}</Tag>
            },
            {
              title: '操作',
              key: 'actions',
              width: 150,
              render: (_: any, record: any) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleAccBindingEdit(record)} />
                  <Popconfirm title="确定删除?" onConfirm={() => handleAccBindingDelete(record.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: '暂无绑定成品，点击右上角"新增绑定"添加' }}
        />
      </Drawer>

      <Modal
        title={accBindingEditingItem ? '编辑绑定' : '新增绑定'}
        open={accBindingModalOpen}
        onOk={handleAccBindingSubmit}
        onCancel={() => {
          accBindingForm.resetFields()
          setAccBindingEditingItem(null)
          setAccBindingModalOpen(false)
          // 清空搜索状态
          setFinishedSearchText('')
          if (finishedSearchTimeoutRef.current) {
            clearTimeout(finishedSearchTimeoutRef.current)
          }
        }}
        width={500}
      >
        <Form form={accBindingForm} layout="vertical">
          <Form.Item
            name="finished_product_id"
            label="成品产品"
            rules={[{ required: true, message: '请选择成品产品' }]}
          >
            <Select
              placeholder="请选择成品产品"
              showSearch
              disabled={!!accBindingEditingItem}
              filterOption={false}
              onSearch={handleFinishedSearch}
              onPopupScroll={(e) => {
                const target = e.target as HTMLDivElement
                if (target.scrollTop + target.clientHeight === target.scrollHeight) {
                  loadMoreFinishedProducts()
                }
              }}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  {finishedLoadingMore && (
                    <div style={{ padding: '8px', textAlign: 'center' }}>
                      <Spin size="small" />
                    </div>
                  )}
                </>
              )}
              options={allFinishedProducts
                .filter(p => p.id !== accBindingProduct?.id)
                .map(p => ({
                  label: `[${p.product_code}] ${p.name}`,
                  value: p.id,
                }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label="配件数量"
            rules={[{ required: true, message: '请输入配件数量' }]}
            initialValue={1}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="请输入出库时自动扣除的配件数量" />
          </Form.Item>
        </Form>
      </Modal>

    </div>
  )
}

export default ProductManagement
