import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Modal, Form, Input, message, Space, Pagination } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { suppliersApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { useResponsive } from '../hooks/useResponsive'

interface Supplier {
  id: number
  name: string
  contact_person: string | null
  contact_phone: string | null
  address: string | null
  notes: string | null
  created_at: string
}

const SupplierManagement: React.FC = () => {
  const { hasPermission } = useAuth()
  const resp = useResponsive()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })

  useEffect(() => {
    fetchSuppliers()
  }, [pagination.current, pagination.pageSize])

  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const res = await suppliersApi.getList({
        search: searchText || undefined,
        page: pagination.current,
        page_size: pagination.pageSize,
      })
      setSuppliers(res.data.data || [])
      if (res.data.total !== undefined) {
        setPagination(prev => ({ ...prev, total: res.data.total }))
      }
    } catch (err) {
      message.error('获取供应商列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearchText(value)
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleCreate = () => {
    setEditingSupplier(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleEdit = (record: Supplier) => {
    setEditingSupplier(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '删除供应商',
      content: '确定要删除该供应商吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await suppliersApi.delete(id)
          message.success('删除成功')
          fetchSuppliers()
        } catch (err: any) {
          message.error(err?.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingSupplier) {
        await suppliersApi.update(editingSupplier.id, values)
        message.success('更新成功')
      } else {
        await suppliersApi.create(values)
        message.success('创建成功')
      }
      setModalOpen(false)
      fetchSuppliers()
    } catch (err: any) {
      if (err?.errorFields) return
      message.error(err?.response?.data?.detail || '操作失败')
    }
  }

  const columns: ColumnsType<Supplier> = [
    { title: '供应商名称', dataIndex: 'name', key: 'name', width: 180 },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person', width: 120 },
    { title: '联系电话', dataIndex: 'contact_phone', key: 'contact_phone', width: 140 },
    { title: '地址', dataIndex: 'address', key: 'address', width: 220, ellipsis: true },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 200, ellipsis: true },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 170 },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      align: 'right',
      render: (_: any, record: Supplier) => (
        <Space>
          <Button
            type="link"
            size="small"
            disabled={!hasPermission('supplier:edit')}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            disabled={!hasPermission('supplier:delete')}
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
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
              placeholder="搜索供应商名称"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 240 }}
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
              onPressEnter={fetchSuppliers}
            />
          </Space>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!hasPermission('supplier:create')}
              onClick={handleCreate}
            >
              新增供应商
            </Button>
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 16 }}
        styles={{ body: { flex: 1, padding: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <Table
          dataSource={suppliers}
          columns={columns}
          rowKey="id"
          scroll={{ x: 1190 }}
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
        title={editingSupplier ? '编辑供应商' : '新增供应商'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="确定"
        cancelText="取消"
        width={resp.isMobile ? '95vw' : 560}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="请输入供应商名称" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="contact_person" label="联系人">
              <Input placeholder="请输入联系人" />
            </Form.Item>
            <Form.Item name="contact_phone" label="联系电话">
              <Input placeholder="请输入联系电话" />
            </Form.Item>
          </div>
          <Form.Item name="address" label="地址">
            <Input placeholder="请输入地址" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default SupplierManagement
