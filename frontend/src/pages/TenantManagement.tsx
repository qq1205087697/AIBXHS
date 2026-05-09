import React, { useState, useEffect } from "react"
import { Card, Table, Button, Modal, Form, Input, Select, message } from "antd"
import { EditOutlined } from "@ant-design/icons"
import { tenantsApi } from "../api"
import { useAuth } from "../contexts/AuthContext"

interface Tenant {
  id: number
  name: string
  code: string
  status: string
  created_at: string
  updated_at: string
}

const TenantManagement: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [form] = Form.useForm()
  const { authData } = useAuth()

  const statusOptions = [
    { label: "活跃", value: "active" },
    { label: "禁用", value: "inactive" },
  ]

  useEffect(() => {
    fetchTenants()
  }, [])

  const fetchTenants = async () => {
    setLoading(true)
    try {
      const res = await tenantsApi.getList()
      if (res.data.success) {
        setTenants(res.data.data)
      }
    } catch (error) {
      console.error("获取租户列表失败:", error)
      message.error("获取租户列表失败")
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (tenant: Tenant) => {
    setEditingTenant(tenant)
    form.setFieldsValue({
      name: tenant.name,
      code: tenant.code,
      status: tenant.status,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    if (!editingTenant) return
    try {
      const values = await form.validateFields()
      await tenantsApi.update(editingTenant.id, values)
      message.success("租户更新成功")
      setModalOpen(false)
      fetchTenants()
    } catch (error) {
      if (!error.errorFields) {
        message.error("更新失败")
      }
    }
  }

  const columns = [
    { title: "租户ID", dataIndex: "id", key: "id", width: 80 },
    { title: "租户名称", dataIndex: "name", key: "name" },
    { title: "租户编码", dataIndex: "code", key: "code" },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          active: "success",
          inactive: "default",
        }
        return (
          <span style={{ color: status === "active" ? "#52c41a" : "#999" }}>
            {status === "active" ? "活跃" : "禁用"}
          </span>
        )
      },
    },
    { title: "创建时间", dataIndex: "created_at", key: "created_at" },
    { title: "更新时间", dataIndex: "updated_at", key: "updated_at" },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_: any, record: Tenant) => (
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => handleEdit(record)}
        >
          编辑
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Card title="租户管理" loading={loading}>
        <Table
          dataSource={tenants}
          columns={columns}
          rowKey="id"
          pagination={false}
        />
      </Card>

      <Modal
        title="编辑租户"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={500}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="租户名称"
            rules={[{ required: true, message: "请输入租户名称" }]}
          >
            <Input placeholder="请输入租户名称" />
          </Form.Item>
          <Form.Item
            name="code"
            label="租户编码"
            rules={[{ required: true, message: "请输入租户编码" }]}
          >
            <Input placeholder="请输入租户编码" />
          </Form.Item>
          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: "请选择状态" }]}
          >
            <Select placeholder="请选择状态" options={statusOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default TenantManagement
