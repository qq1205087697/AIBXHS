import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, message, Popconfirm, Space, Tag, InputNumber, Switch, Drawer, Checkbox } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, SettingOutlined, HolderOutlined } from '@ant-design/icons'
import type { ColumnsType, TableProps } from 'antd/es/table'
import { Resizable, ResizeCallbackData } from 'react-resizable'
import { productsApi, storesApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'

interface Product {
  id: number
  store_id: number
  store_name: string
  asin: string
  sku: string
  name: string
  name_en: string
  image_url: string
  category: string
  brand: string
  price: number
  cost_price: number
  status: string
  is_robot_monitored: boolean
  created_at: string
  department_id: number | null
  department_name: string
}

interface Store {
  id: number
  name: string
}

interface ColumnState {
  key: string
  title: string
  visible: boolean
  width?: number
  fixed?: 'left' | 'right'
}

const defaultColumns: ColumnState[] = [
  { key: 'asin', title: 'ASIN', visible: true, width: 120 },
  { key: 'name', title: '商品名称', visible: true, width: 200 },
  { key: 'name_en', title: '英文名称', visible: true, width: 200 },
  { key: 'sku', title: 'SKU', visible: true, width: 180 },
  { key: 'store_name', title: '所属店铺', visible: true, width: 140 },
  { key: 'department_name', title: '所属部门', visible: true, width: 120 },
  { key: 'brand', title: '品牌', visible: true, width: 100 },
  { key: 'price', title: '售价', visible: true, width: 100 },
  { key: 'cost_price', title: '成本价', visible: true, width: 100 },
  { key: 'is_robot_monitored', title: '机器人监控', visible: true, width: 100 },
  { key: 'status', title: '状态', visible: true, width: 100 },
  { key: 'created_at', title: '创建时间', visible: true, width: 160 },
]

const ResizableTitle = (props: any) => {
  const { onResize, width, ...restProps } = props

  if (!width) {
    return <th {...restProps} />
  }

  return (
    <Resizable
      width={width}
      height={0}
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
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [form] = Form.useForm()
  const [searchForm] = Form.useForm()
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState({ store_id: undefined, asin_search: '', name_search: '', sku_search: '' })
  const [columnStates, setColumnStates] = useState<ColumnState[]>(defaultColumns)
  const [columnSettingOpen, setColumnSettingOpen] = useState(false)
  
  const statusOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Archived', value: 'archived' },
  ]

  useEffect(() => {
    fetchData()
  }, [pagination.current, pagination.pageSize, filters])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [productsRes, storesRes] = await Promise.all([
        productsApi.getList({
          page: pagination.current,
          page_size: pagination.pageSize,
          ...filters,
        }),
        storesApi.getList(),
      ])
      if (productsRes.data.success) {
        setProducts(productsRes.data.data)
        setPagination((prev) => ({ ...prev, total: productsRes.data.total }))
      }
      if (storesRes.data.success) setStores(storesRes.data.data)
    } catch (e) {
      console.error('获取数据失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    const values = await searchForm.validateFields()
    setFilters(values)
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleReset = () => {
    searchForm.resetFields()
    setFilters({ store_id: undefined, asin_search: '', name_search: '', sku_search: '' })
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
      store_id: product.store_id,
      asin: product.asin,
      name: product.name,
      sku: product.sku,
      name_en: product.name_en,
      image_url: product.image_url,
      category: product.category,
      brand: product.brand,
      price: product.price,
      cost_price: product.cost_price,
      status: product.status,
      is_robot_monitored: product.is_robot_monitored,
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
      message.error('操作失败')
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

  const handleColumnToggle = (key: string, checked: boolean) => {
    setColumnStates(prev => 
      prev.map(col => col.key === key ? { ...col, visible: checked } : col)
    )
  }

  const handleResetColumns = () => {
    setColumnStates(defaultColumns)
  }

  const handleResize = (index: number) => {
    return (e: React.SyntheticEvent, { size }: ResizeCallbackData) => {
      const newColumnStates = [...columnStates]
      const currentIndex = newColumnStates.findIndex((_, i) => i === index)
      if (currentIndex !== -1 && newColumnStates[currentIndex]) {
        newColumnStates[currentIndex] = {
          ...newColumnStates[currentIndex],
          width: size.width,
        }
        setColumnStates(newColumnStates)
      }
    }
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString())
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'))
    if (sourceIndex !== targetIndex) {
      const newColumnStates = [...columnStates]
      const [movedColumn] = newColumnStates.splice(sourceIndex, 1)
      newColumnStates.splice(targetIndex, 0, movedColumn)
      setColumnStates(newColumnStates)
    }
  }

  const getColumns = (): ColumnsType<Product> => {
    const baseColumns: ColumnsType<Product> = columnStates.map((col, index) => {
      const column: any = {
        title: col.title,
        dataIndex: col.key,
        key: col.key,
        width: col.width,
        ellipsis: true,
        onHeaderCell: (column: any) => ({
          width: column.width,
          onResize: handleResize(index),
        }),
      }

      if (col.key === 'store_name') {
        column.render = (name: string) => <Tag color="blue">{name}</Tag>
      } else if (col.key === 'department_name') {
        column.render = (name: string) => <Tag color="green">{name}</Tag>
      } else if (col.key === 'price' || col.key === 'cost_price') {
        column.render = (price: number) => `$${price?.toFixed(2) || '0.00'}`
      } else if (col.key === 'is_robot_monitored') {
        column.render = (monitored: boolean) => (
          <Tag color={monitored ? 'success' : 'default'}>
            {monitored ? '是' : '否'}
          </Tag>
        )
      } else if (col.key === 'status') {
        column.render = (status: string) => {
          const colorMap: Record<string, string> = {
            active: 'success',
            inactive: 'default',
            archived: 'error',
          }
          return <Tag color={colorMap[status] || 'default'}>{status}</Tag>
        }
      }

      return column
    })

    baseColumns.push({
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, record: Product) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    })

    return baseColumns.filter(col => {
      if (col.key === 'actions') return true
      return columnStates.find(c => c.key === col.key)?.visible !== false
    })
  }

  const components = {
    header: {
      cell: ResizableTitle,
    },
  }

  return (
    <div style={{ 
      padding: 24, 
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <style>{`
        .react-resizable {
          position: relative;
          background-clip: padding-box;
        }
        .react-resizable-handle {
          position: absolute;
          right: -5px;
          bottom: 0;
          width: 10px;
          height: 100%;
          cursor: col-resize;
          z-index: 1;
        }
      `}</style>
      <Card
        loading={loading}
        title={
          <Form form={searchForm} layout="inline" style={{ margin: 0, width: '100%' }}>
            <Form.Item name="store_id" label="店铺">
              <Select
                placeholder="请选择店铺"
                options={Array.from(new Set(stores.map(s => s.id))).map(id => {
                  const store = stores.find(s => s.id === id)!
                  return { label: store.name, value: store.id }
                })}
                allowClear
                style={{ width: 150 }}
              />
            </Form.Item>
            <Form.Item name="asin_search" label="ASIN">
              <Input placeholder="请输入ASIN" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="sku_search" label="SKU">
              <Input placeholder="请输入SKU" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="name_search" label="商品名称">
              <Input placeholder="请输入商品名称" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
                  搜索
                </Button>
                <Button onClick={handleReset}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        }
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => setColumnSettingOpen(true)}>
              列设置
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新增商品
            </Button>
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
          <Table
            dataSource={products}
            columns={getColumns()}
            rowKey="id"
            components={components}
            scroll={{ x: 1800, y: 'calc(100vh - 300px)' }}
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
        </div>
      </Card>

      <Modal
        title={editingProduct ? '编辑商品' : '新增商品'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="store_id"
            label="所属店铺"
            rules={[{ required: true, message: '请选择店铺' }]}
          >
            <Select placeholder="请选择店铺" options={stores.map((s) => ({ label: s.name, value: s.id }))} />
          </Form.Item>
          <Form.Item
            name="asin"
            label="ASIN"
            rules={[{ required: true, message: '请输入ASIN' }]}
          >
            <Input placeholder="请输入ASIN" />
          </Form.Item>
          <Form.Item
            name="name"
            label="商品名称"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input placeholder="请输入商品名称" />
          </Form.Item>
          <Form.Item name="name_en" label="英文名称">
            <Input placeholder="请输入英文名称" />
          </Form.Item>
          <Form.Item name="sku" label="SKU">
            <Input placeholder="请输入SKU" />
          </Form.Item>
          <Form.Item name="image_url" label="商品图片">
            <Input placeholder="请输入图片URL" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="请输入分类" />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Input placeholder="请输入品牌" />
          </Form.Item>
          <Form.Item name="price" label="售价">
            <InputNumber style={{ width: '100%' }} placeholder="请输入售价" min={0} precision={2} />
          </Form.Item>
          <Form.Item name="cost_price" label="成本价">
            <InputNumber style={{ width: '100%' }} placeholder="请输入成本价" min={0} precision={2} />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select placeholder="请选择状态" options={statusOptions} />
          </Form.Item>
          <Form.Item
            name="is_robot_monitored"
            label="机器人监控"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="列设置"
        open={columnSettingOpen}
        onClose={() => setColumnSettingOpen(false)}
        width={320}
        extra={
          <Space>
            <Button onClick={handleResetColumns}>重置</Button>
            <Button type="primary" onClick={() => setColumnSettingOpen(false)}>
              完成
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {columnStates.map((col, index) => (
            <div
              key={col.key}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 12px',
                border: '1px solid #f0f0f0',
                borderRadius: 4,
                cursor: 'move',
                backgroundColor: '#fff',
              }}
            >
              <HolderOutlined style={{ color: '#999', marginRight: 8, cursor: 'grab' }} />
              <Checkbox
                checked={col.visible}
                onChange={(e) => handleColumnToggle(col.key, e.target.checked)}
              >
                {col.title}
              </Checkbox>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  )
}

export default ProductManagement
