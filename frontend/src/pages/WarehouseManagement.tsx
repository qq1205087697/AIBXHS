import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, message, Space, Tag, Typography, Pagination } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, HomeOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { warehousesApi } from '../api'
import { useAuth } from '../contexts/AuthContext'

const { Title } = Typography

interface Warehouse {
  id: number
  name: string
  code: string
  address: string
  contact_person: string
  contact_phone: string
  status: string
  notes: string
  created_at: string
}

const WarehouseManagement: React.FC = () => {
  const { hasPermission } = useAuth()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })

  useEffect(() => {
    fetchWarehouses()
  }, [pagination.current, pagination.pageSize])

  const fetchWarehouses = async () => {
    setLoading(true)
    try {
      const res = await warehousesApi.getList({ 
        search: searchText || undefined,
        page: pagination.current,
        page_size: pagination.pageSize
      })
      setWarehouses(res.data.data || [])
      if (res.data.total !== undefined) {
        setPagination(prev => ({ ...prev, total: res.data.total }))
      }
    } catch (err) {
      message.error('获取仓库列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearchText(value)
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleCreate = () => {
    setEditingWarehouse(null)
    form.resetFields()
    form.setFieldsValue({ status: 'active' })
    setModalOpen(true)
  }

  const handleEdit = (record: Warehouse) => {
    setEditingWarehouse(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '删除仓库',
      content: '确定要删除该仓库吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await warehousesApi.delete(id)
          message.success('删除成功')
          fetchWarehouses()
        } catch (err: any) {
          message.error(err?.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingWarehouse) {
        await warehousesApi.update(editingWarehouse.id, values)
        message.success('更新成功')
      } else {
        await warehousesApi.create(values)
        message.success('创建成功')
      }
      setModalOpen(false)
      fetchWarehouses()
    } catch (err: any) {
      if (err?.errorFields) return
      message.error(err?.response?.data?.detail || '操作失败')
    }
  }

  const columns: ColumnsType<Warehouse> = [
    { title: '仓库名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: '编码', dataIndex: 'code', key: 'code', width: 120 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    { title: '地址', dataIndex: 'address', key: 'address', width: 200, ellipsis: true },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person', width: 100 },
    { title: '电话', dataIndex: 'contact_phone', key: 'contact_phone', width: 130 },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 200, ellipsis: true },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170 },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_: any, record: Warehouse) => (
        <Space>
          {hasPermission('warehouse:edit') && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
              编辑
            </Button>
          )}
          {hasPermission('warehouse:delete') && (
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Card
        loading={loading}
        title={
          <Space wrap size="middle">
            <Input
              placeholder="搜索仓库名称、编码"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 240 }}
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
              onPressEnter={fetchWarehouses}
            />
          </Space>
        }
        extra={
          <Space>
            {hasPermission('warehouse:create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新增仓库
              </Button>
            )}
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 16 }}
        styles={{ body: { flex: 1, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <Table
          dataSource={warehouses}
          columns={columns}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={false}
        />
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8 }}>
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

      <Modal
        title={editingWarehouse ? '编辑仓库' : '新增仓库'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="确定"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="name"
              label="仓库名称"
              rules={[{ required: true, message: '请输入仓库名称' }]}
            >
              <Input placeholder="请输入仓库名称" />
            </Form.Item>
            <Form.Item
              name="code"
              label="仓库编码"
            >
              <Input placeholder="留空自动生成" />
            </Form.Item>
          </div>
          <Form.Item name="address" label="地址">
            <Input placeholder="请输入仓库地址" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="contact_person" label="联系人">
              <Input placeholder="请输入联系人" />
            </Form.Item>
            <Form.Item name="contact_phone" label="联系电话">
              <Input placeholder="请输入联系电话" />
            </Form.Item>
          </div>
          {editingWarehouse && (
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { label: '启用', value: 'active' },
                  { label: '停用', value: 'inactive' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default WarehouseManagement