import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, message, Popconfirm, Space, Tag, InputNumber, Switch, Drawer, Checkbox, Image, Tooltip, Divider, Transfer, Dropdown, MenuProps } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, SettingOutlined, HolderOutlined, AppstoreOutlined, ShopOutlined, DownOutlined, EyeOutlined, InboxOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { Resizable, ResizeCallbackData } from 'react-resizable'
import { productsApi, storesApi, storeGroupsApi, inventoryBatchesApi } from '../api'
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
}

interface PlatformProduct {
  id: number
  platform: string
  store_ids: number[]
  store_names: string[]
  platform_product_id: string
  asin: string
  spu: string
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
  { key: 'product_code', title: '产品编码', visible: true, width: 130, minWidth: 110 },
  { key: 'name', title: '产品名称', visible: true, width: 200, minWidth: 150 },
  { key: 'name_en', title: '英文名称', visible: false, width: 200, minWidth: 150 },
  { key: 'product_type', title: '产品类型', visible: true, width: 120, minWidth: 100 },
  { key: 'product_attribute', title: '产品属性', visible: true, width: 120, minWidth: 100 },
  { key: 'category', title: '分类', visible: true, width: 120, minWidth: 100 },
  { key: 'brand', title: '品牌', visible: true, width: 120, minWidth: 100 },
  { key: 'purchase_price', title: '采购价', visible: true, width: 110, minWidth: 90 },
  { key: 'sale_price', title: '建议售价', visible: true, width: 110, minWidth: 90 },
  { key: 'local_quantity', title: '库存数量', visible: true, width: 100, minWidth: 80 },
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

const ProductManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const { hasPermission } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [productTypeFilter, setProductTypeFilter] = useState<string[] | undefined>(undefined)
  const [productAttributeFilter, setProductAttributeFilter] = useState<string | undefined>(undefined)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<Record<string, any>>({ search: '' })
  const [columnStates, setColumnStates] = useState<ColumnState[]>(defaultColumns)
  const [columnSettingOpen, setColumnSettingOpen] = useState(false)
  const [columnSettingTarget, setColumnSettingTarget] = useState<'main' | 'platform'>('main')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [displayColumns, setDisplayColumns] = useState<ColumnState[] | null>(null)
  const searchTimeoutRef = useRef<number | null>(null)

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
  const [stockHistory, setStockHistory] = useState<any[]>([])
  const [stockLoading, setStockLoading] = useState(false)
  
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailModalProduct, setDetailModalProduct] = useState<Product | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [importPreviewOpen, setImportPreviewOpen] = useState(false)
  const [importPreviewData, setImportPreviewData] = useState<{ products: any[]; platform_products: any[] }>({ products: [], platform_products: [] })
  const [importing, setImporting] = useState(false)
  
  const [dataFixOpen, setDataFixOpen] = useState(false)
  const [dataFixProducts, setDataFixProducts] = useState<Product[]>([])
  const [dataFixLoading, setDataFixLoading] = useState(false)
  const [dataFixEditingId, setDataFixEditingId] = useState<number | null>(null)
  
  const [shelfEditBatchId, setShelfEditBatchId] = useState<number | null>(null)
  const [shelfEditValue, setShelfEditValue] = useState('')
  const shelfInputRef = useRef<any>(null)
  
  // 平台商品列表的列状态
  const [ppColumnStates, setPpColumnStates] = useState<ColumnState[]>(defaultPpColumns)

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
  }, [pagination.current, pagination.pageSize, filters])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [productsRes, storesRes, groupsRes] = await Promise.all([
        productsApi.getList({
          page: pagination.current,
          page_size: pagination.pageSize,
          ...filters,
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
      spu: item.spu,
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
        setImportPreviewData(res.data.data || { products: [], platform_products: [] })
        setImportPreviewOpen(true)
      } else {
        message.error(res.data.message || '文件解析失败')
      }
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '文件上传失败'
      message.error(errorMsg, 8)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleConfirmImport = async () => {
    if (importPreviewData.products.length === 0 && importPreviewData.platform_products.length === 0) {
      message.warning('没有可导入的数据')
      return
    }
    setImporting(true)
    try {
      const res = await productsApi.batchImport(importPreviewData)
      if (res.data.success) {
        message.success(res.data.message)
        setImportPreviewOpen(false)
        setImportPreviewData({ products: [], platform_products: [] })
        fetchData()
      } else {
        message.error(res.data.message || '导入失败')
      }
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || '导入失败'
      message.error(errorMsg)
    } finally {
      setImporting(false)
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
              Modal.confirm({
                title: '确定删除?',
                content: '删除后不可恢复',
                onOk: () => handleDelete(record.id),
              })
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
          <Space wrap style={{ width: "100%" }} size="middle">
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
        }
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => {
              setColumnSettingTarget('main')
              setColumnSettingOpen(true)
            }}>列设置</Button>
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>模板</Button>
            <Button icon={<UploadOutlined />} onClick={handleImportClick} loading={uploading}>导入</Button>
            <Button onClick={openDataFix}>数据补齐</Button>
            {hasPermission('product:create') && <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增商品</Button>}
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <Table
          dataSource={products}
          columns={getColumns()}
          rowKey="id"
          components={components}
          scroll={{ x: 2000, y: 'calc(100vh - 320px)' }}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) =>
              setPagination((prev) => ({ ...prev, current: page, pageSize: pageSize || 20 })),
          }}
          tableLayout="fixed"
          sticky={{ offsetHeader: 0 }}
        />
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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
        <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
          <Table
            dataSource={ppList}
            rowKey="id"
            loading={ppLoading}
            size="small"
            pagination={false}
            components={components}
            tableLayout="fixed"
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
                
                if (col.key === 'platform') {
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

          <Form.Item name="platform_product_id" label="平台商品ID">
            <Input placeholder="平台侧的商品ID" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="asin" label="ASIN">
              <Input placeholder="ASIN" />
            </Form.Item>
            <Form.Item name="spu" label="SPU">
              <Input placeholder="SPU" />
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
                title: `${s.name}${s.site ? ` - ${s.site}` : ''}`,
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
            <Divider orientation="left">库存批次明细</Divider>
            <Table
              dataSource={stockData}
              rowKey="batch_number"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: '批次号', dataIndex: 'batch_number', key: 'batch_number', width: 150 },
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
                { title: '生产日期', dataIndex: 'production_date', key: 'production_date', width: 120 },
                { title: '过期日期', dataIndex: 'expiry_date', key: 'expiry_date', width: 120 },
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
        onCancel={() => setImportPreviewOpen(false)}
        width={importPreviewData.platform_products.length > 0 ? 1200 : 900}
        footer={[
          <Button key="cancel" onClick={() => setImportPreviewOpen(false)}>取消</Button>,
          <Button key="confirm" type="primary" loading={importing} onClick={handleConfirmImport}>
            确认导入
          </Button>,
        ]}
      >
        {importPreviewData.products.length > 0 && (
          <>
            <Divider orientation="left" plain>产品 ({importPreviewData.products.length} 条)</Divider>
            <Table
              dataSource={importPreviewData.products}
              rowKey={(_, idx) => `product-${idx}`}
              size="small"
              pagination={false}
              scroll={{ y: 300 }}
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
            <Divider orientation="left" plain style={{ marginTop: importPreviewData.products.length > 0 ? 24 : 0 }}>平台商品 ({importPreviewData.platform_products.length} 条)</Divider>
            <Table
              dataSource={importPreviewData.platform_products}
              rowKey={(_, idx) => `platform-${idx}`}
              size="small"
              pagination={false}
              scroll={{ y: 300 }}
              columns={[
                { title: '产品编码', dataIndex: 'product_code', width: 120 },
                { title: '平台', dataIndex: 'platform', width: 100 },
                { title: '店铺名称', dataIndex: 'store_name', width: 150 },
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
    </div>
  )
}

export default ProductManagement
