import React, { useState, useEffect } from "react"
import { Card, Table, Button, Modal, Form, Input, Select, message, Space, Popconfirm, Tag, Typography, Alert } from "antd"
import { EditOutlined, DeleteOutlined, CopyOutlined, LinkOutlined } from "@ant-design/icons"
import { tenantsApi } from "../api"
import { useAuth } from "../contexts/AuthContext"

const { Text } = Typography

interface Tenant {
  id: number
  name: string
  code: string
  binding_code: string
  status: string
  is_personal: boolean
  created_at: string
  updated_at: string
}

const TenantManagement: React.FC = () => {
  const { user, isAdmin, refreshUser } = useAuth()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const [bindModalOpen, setBindModalOpen] = useState(false)
  const [bindCode, setBindCode] = useState("")
  const [bindLoading, setBindLoading] = useState(false)

  const isPersonalCompany = user?.is_personal === true

  const statusOptions = [
    { label: "活跃", value: "active" },
    { label: "禁用", value: "inactive" },
  ]

  useEffect(() => {
    if (isAdmin) {
      fetchTenants()
    }
  }, [isAdmin])

  const fetchTenants = async () => {
    setLoading(true)
    try {
      const res = await tenantsApi.getList()
      if (res.data.success) {
        setTenants(res.data.data)
      }
    } catch (error) {
      console.error("获取公司列表失败:", error)
      message.error("获取公司列表失败")
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingTenant(null)
    form.resetFields()
    form.setFieldsValue({ status: "active" })
    setModalOpen(true)
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
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      if (editingTenant) {
        await tenantsApi.update(editingTenant.id, values)
        message.success("公司更新成功")
      } else {
        await tenantsApi.create(values)
        message.success("公司创建成功")
      }
      setModalOpen(false)
      fetchTenants()
    } catch (error: any) {
      if (error?.response?.data?.detail) {
        message.error(error.response.data.detail)
      } else if (!error.errorFields) {
        message.error("操作失败")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await tenantsApi.delete(id)
      message.success("公司删除成功")
      fetchTenants()
    } catch (error: any) {
      if (error?.response?.data?.detail) {
        message.error(error.response.data.detail)
      } else {
        message.error("删除失败")
      }
    }
  }

  const handleGenerateBindingCode = async (id: number) => {
    try {
      const res = await tenantsApi.generateBindingCode(id)
      if (res.data.success) {
        message.success(`绑定码已生成: ${res.data.data.binding_code}`)
        fetchTenants()
      }
    } catch (error: any) {
      if (error?.response?.data?.detail) {
        message.error(error.response.data.detail)
      } else {
        message.error("生成绑定码失败")
      }
    }
  }

  const handleCopyBindingCode = (code: string) => {
    navigator.clipboard.writeText(code)
    message.success("绑定码已复制")
  }

  const handleBindCompany = async () => {
    if (!bindCode.trim()) {
      message.error("请输入绑定码")
      return
    }
    setBindLoading(true)
    try {
      const res = await tenantsApi.bind(bindCode.trim())
      if (res.data.success) {
        message.success(res.data.message)
        setBindModalOpen(false)
        setBindCode("")
        await refreshUser()
      }
    } catch (error: any) {
      if (error?.response?.data?.detail) {
        message.error(error.response.data.detail)
      } else {
        message.error("绑定失败")
      }
    } finally {
      setBindLoading(false)
    }
  }

  const columns: any[] = [
    { title: "ID", dataIndex: "id", key: "id", width: 60 },
    { title: "公司名称", dataIndex: "name", key: "name" },
    { title: "公司编号", dataIndex: "code", key: "code" },
    {
      title: "绑定码",
      dataIndex: "binding_code",
      key: "binding_code",
      width: 200,
      render: (code: string, record: Tenant) => (
        <Space>
          {code ? (
            <>
              <Tag color="blue">{code}</Tag>
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopyBindingCode(code)}
              />
            </>
          ) : (
            <Button
              type="link"
              size="small"
              onClick={() => handleGenerateBindingCode(record.id)}
            >
              生成绑定码
            </Button>
          )}
        </Space>
      ),
    },
    {
      title: "类型",
      dataIndex: "is_personal",
      key: "is_personal",
      width: 80,
      render: (v: boolean) => (
        <Tag color={v ? "orange" : "green"}>{v ? "个人" : "公司"}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (status: string) => (
        <Tag color={status === "active" ? "success" : "default"}>
          {status === "active" ? "活跃" : "禁用"}
        </Tag>
      ),
    },
    { title: "创建时间", dataIndex: "created_at", key: "created_at", width: 170 },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: any, record: Tenant) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该公司吗？"
            description="删除后不可恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.id === 1}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {isPersonalCompany && (
        <Alert
          type="warning"
          showIcon
          message="您当前使用的是个人公司，请绑定到正式公司以解锁全部功能"
          action={
            <Button size="small" type="primary" onClick={() => setBindModalOpen(true)}>
              绑定公司
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        title={
          <Space>
            <span>当前公司</span>
            <Tag color="blue">{user?.tenant_name || "-"}</Tag>
            <Text type="secondary">编号: {user?.tenant_code || "-"}</Text>
          </Space>
        }
        extra={
          <Button
            icon={<LinkOutlined />}
            onClick={() => setBindModalOpen(true)}
          >
            绑定其他公司
          </Button>
        }
      >
        <Text type="secondary">
          如需加入其他公司，请向管理员索取绑定码，点击上方按钮输入绑定码即可
        </Text>
      </Card>

      {isAdmin && (
        <Card
          title="公司设置"
          style={{ marginTop: 16 }}
          loading={loading}
        >
          <Table
            dataSource={tenants}
            columns={columns}
            rowKey="id"
            pagination={false}
            scroll={{ x: 1000 }}
          />
        </Card>
      )}

      <Modal
        title={editingTenant ? "编辑公司" : "新增公司"}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        width={500}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="公司名称"
            rules={[{ required: true, message: "请输入公司名称" }]}
          >
            <Input placeholder="请输入公司名称" />
          </Form.Item>
          <Form.Item
            name="code"
            label="公司编号"
            rules={[{ required: true, message: "请输入公司编号" }]}
          >
            <Input placeholder="请输入公司编号" disabled={!!editingTenant} />
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

      <Modal
        title="绑定公司"
        open={bindModalOpen}
        onOk={handleBindCompany}
        onCancel={() => { setBindModalOpen(false); setBindCode("") }}
        confirmLoading={bindLoading}
        okText="确认绑定"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            请输入管理员提供的6位绑定码
          </Text>
        </div>
        <Input
          size="large"
          placeholder="请输入绑定码"
          maxLength={6}
          value={bindCode}
          onChange={(e) => setBindCode(e.target.value.toUpperCase())}
          style={{ textAlign: "center", letterSpacing: 8, fontSize: 24, fontWeight: "bold" }}
          onPressEnter={handleBindCompany}
        />
      </Modal>
    </div>
  )
}

export default TenantManagement