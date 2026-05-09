import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Modal, Input, Form, Select, message, Popconfirm, Space, Tag, Tabs, Alert, Typography } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, TeamOutlined, CopyOutlined } from '@ant-design/icons'
import { departmentsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import type { TableProps } from 'antd'

interface Department {
  id: number
  name: string
  description: string
  member_count: number
  created_at: string
}

interface UserItem {
  id: number
  username: string
  nickname: string
  email: string
  role: string
  department_names: string
  department_ids: string
}

const OrgManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const [departments, setDepartments] = useState<Department[]>([])
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(false)
  const [deptModalOpen, setDeptModalOpen] = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [deptForm] = Form.useForm()
  const [deptUserModalOpen, setDeptUserModalOpen] = useState(false)
  const [selectedDept, setSelectedDept] = useState<Department | null>(null)
  const [deptMembers, setDeptMembers] = useState<any[]>([])
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null)
  const [selectedDeptIds, setSelectedDeptIds] = useState<number[]>([])
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [userForm] = Form.useForm()
  const [createdUserInfo, setCreatedUserInfo] = useState<any>(null)
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchAssignModalOpen, setBatchAssignModalOpen] = useState(false)
  const [batchSelectedDeptIds, setBatchSelectedDeptIds] = useState<number[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [deptRes, usersRes] = await Promise.all([
        departmentsApi.getList(),
        departmentsApi.getAllUsers()
      ])
      if (deptRes.data.success) setDepartments(deptRes.data.data)
      if (usersRes.data.success) setUsers(usersRes.data.data)
    } catch (e) {
      console.error('获取数据失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateDept = () => {
    setEditingDept(null)
    deptForm.resetFields()
    setDeptModalOpen(true)
  }

  const handleEditDept = (dept: Department) => {
    setEditingDept(dept)
    deptForm.setFieldsValue({ name: dept.name, description: dept.description })
    setDeptModalOpen(true)
  }

  const handleDeptSubmit = async () => {
    try {
      const values = await deptForm.validateFields()
      if (editingDept) {
        await departmentsApi.update(editingDept.id, values)
        message.success('部门更新成功')
      } else {
        await departmentsApi.create(values)
        message.success('部门创建成功')
      }
      setDeptModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      message.error('操作失败')
    }
  }

  const handleDeleteDept = async (id: number) => {
    try {
      await departmentsApi.delete(id)
      message.success('部门删除成功')
      fetchData()
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleManageMembers = async (dept: Department) => {
    setSelectedDept(dept)
    try {
      const res = await departmentsApi.getMembers(dept.id)
      if (res.data.success) setDeptMembers(res.data.data)
    } catch (e) {
      setDeptMembers([])
    }
    setDeptUserModalOpen(true)
  }

  const handleAssignDepts = (user: UserItem) => {
    setSelectedUser(user)
    const ids = user.department_ids
      ? user.department_ids.split(',').map(Number).filter(Boolean)
      : []
    setSelectedDeptIds(ids)
    setAssignModalOpen(true)
  }

  const handleAssignSubmit = async () => {
    if (!selectedUser) return
    try {
      await departmentsApi.updateUserDepartments(selectedUser.id, selectedDeptIds)
      message.success('部门分配成功')
      setAssignModalOpen(false)
      fetchData()
    } catch (e) {
      message.error('分配失败')
    }
  }

  const handleCreateUser = () => {
    userForm.resetFields()
    setUserModalOpen(true)
  }

  const handleUserSubmit = async () => {
    try {
      const values = await userForm.validateFields()
      const res = await departmentsApi.createUser(values)
      if (res.data.success) {
        setCreatedUserInfo(res.data.data)
        setUserModalOpen(false)
        setSuccessModalOpen(true)
        fetchData()
      }
    } catch (e: any) {
      if (e.errorFields) return
      message.error(e.response?.data?.detail || '创建用户失败')
    }
  }

  const handleCopyUserInfo = () => {
    if (!createdUserInfo) return
    const info = `用户名：${createdUserInfo.username}\n密码：${createdUserInfo.password}\n邮箱：${createdUserInfo.email}\n角色：${createdUserInfo.role === 'admin' ? '管理员' : '普通用户'}`
    navigator.clipboard.writeText(info).then(() => {
      message.success('用户信息已复制到剪贴板')
    }).catch(() => {
      message.error('复制失败，请手动复制')
    })
  }

  const handleBatchAssign = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择用户')
      return
    }
    setBatchSelectedDeptIds([])
    setBatchAssignModalOpen(true)
  }

  const handleBatchAssignSubmit = async () => {
    try {
      await departmentsApi.batchAssignDepartments({
        user_ids: selectedRowKeys.map(Number),
        department_ids: batchSelectedDeptIds
      })
      message.success('批量分配部门成功')
      setBatchAssignModalOpen(false)
      setSelectedRowKeys([])
      fetchData()
    } catch (e) {
      message.error('批量分配失败')
    }
  }

  const deptColumns = [
    { title: '部门名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '成员数', dataIndex: 'member_count', key: 'member_count',
      render: (v: number) => <Tag color="blue">{v}人</Tag>
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作', key: 'actions',
      render: (_: any, record: Department) => (
        <Space>
          <Button size="small" icon={<TeamOutlined />} onClick={() => handleManageMembers(record)}>成员</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditDept(record)}>编辑</Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDeleteDept(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(newSelectedRowKeys)
  }

  const rowSelection: TableProps<UserItem>['rowSelection'] = {
    selectedRowKeys,
    onChange: onSelectChange,
  }

  const userColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname' },
    { title: '邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: '角色', dataIndex: 'role', key: 'role',
      render: (v: string) => <Tag color={v === 'admin' ? 'red' : 'blue'}>{v === 'admin' ? '管理员' : '普通用户'}</Tag>
    },
    {
      title: '所属部门', dataIndex: 'department_names', key: 'department_names',
      render: (v: string) => v ? <Tag color="green">{v}</Tag> : <Tag color="default">未分配</Tag>
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, record: UserItem) => (
        <Button size="small" type="primary" onClick={() => handleAssignDepts(record)}>分配部门</Button>
      )
    }
  ]

  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      <Tabs
        defaultActiveKey="departments"
        items={[
          {
            key: 'departments',
            label: '部门管理',
            children: (
              <Card
                title="部门列表"
                loading={loading}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={handleCreateDept}>新建部门</Button>}
              >
                <Table dataSource={departments} columns={deptColumns} rowKey="id" pagination={false} />
              </Card>
            )
          },
          {
            key: 'users',
            label: '用户部门分配',
            children: (
              <Card 
                title="用户列表" 
                loading={loading}
                extra={
                  <Space>
                    {selectedRowKeys.length > 0 && (
                      <Button type="primary" onClick={handleBatchAssign}>
                        批量分配部门 ({selectedRowKeys.length})
                      </Button>
                    )}
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateUser}>新建用户</Button>
                  </Space>
                }
              >
                <Table 
                  rowSelection={rowSelection}
                  dataSource={users} 
                  columns={userColumns} 
                  rowKey="id" 
                  pagination={false} 
                />
              </Card>
            )
          }
        ]}
      />

      <Modal
        title={editingDept ? '编辑部门' : '新建部门'}
        open={deptModalOpen}
        onOk={handleDeptSubmit}
        onCancel={() => setDeptModalOpen(false)}
      >
        <Form form={deptForm} layout="vertical">
          <Form.Item name="name" label="部门名称" rules={[{ required: true, message: '请输入部门名称' }]}>
            <Input placeholder="如：运营部、客服部" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="部门描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${selectedDept?.name} - 成员列表`}
        open={deptUserModalOpen}
        onCancel={() => setDeptUserModalOpen(false)}
        footer={null}
      >
        <Table
          dataSource={deptMembers}
          columns={[
            { title: '用户名', dataIndex: 'username', key: 'username' },
            { title: '昵称', dataIndex: 'nickname', key: 'nickname' },
            { title: '角色', dataIndex: 'role', key: 'role' }
          ]}
          rowKey="id"
          pagination={false}
          size="small"
        />
      </Modal>

      <Modal
        title={`分配部门 - ${selectedUser?.nickname || selectedUser?.username}`}
        open={assignModalOpen}
        onOk={handleAssignSubmit}
        onCancel={() => setAssignModalOpen(false)}
      >
        <p style={{ marginBottom: 12, color: '#666' }}>选择该用户所属的部门（可多选）：</p>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={selectedDeptIds}
          onChange={setSelectedDeptIds}
          options={departments.map(d => ({ label: d.name, value: d.id }))}
          placeholder="请选择部门"
        />
      </Modal>

      <Modal
        title="新建用户"
        open={userModalOpen}
        onOk={handleUserSubmit}
        onCancel={() => setUserModalOpen(false)}
      >
        <Form form={userForm} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            initialValue="operator"
          >
            <Select placeholder="请选择角色">
              <Select.Option value="operator">普通用户</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="用户创建成功"
        open={successModalOpen}
        onOk={() => setSuccessModalOpen(false)}
        onCancel={() => setSuccessModalOpen(false)}
        footer={[
          <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={handleCopyUserInfo}>
            复制信息
          </Button>,
          <Button key="close" onClick={() => setSuccessModalOpen(false)}>
            关闭
          </Button>
        ]}
      >
        <Alert
          message="请保存以下用户信息"
          description="此信息只会显示一次，请务必保存或复制后发送给用户"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        {createdUserInfo && (
          <div style={{ 
            backgroundColor: '#f5f5f5', 
            padding: 16, 
            borderRadius: 8,
            fontFamily: 'monospace'
          }}>
            <Typography.Paragraph copyable={{ text: `用户名：${createdUserInfo.username}\n密码：${createdUserInfo.password}\n邮箱：${createdUserInfo.email}\n角色：${createdUserInfo.role === 'admin' ? '管理员' : '普通用户'}` }}>
              <p>用户名：{createdUserInfo.username}</p>
              <p>密码：{createdUserInfo.password}</p>
              <p>邮箱：{createdUserInfo.email}</p>
              <p>角色：{createdUserInfo.role === 'admin' ? '管理员' : '普通用户'}</p>
            </Typography.Paragraph>
          </div>
        )}
      </Modal>

      <Modal
        title={`批量分配部门 (已选 ${selectedRowKeys.length} 个用户)`}
        open={batchAssignModalOpen}
        onOk={handleBatchAssignSubmit}
        onCancel={() => setBatchAssignModalOpen(false)}
        width={500}
      >
        <p style={{ marginBottom: 16, color: '#666' }}>选择要分配的部门（可多选）：</p>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={batchSelectedDeptIds}
          onChange={setBatchSelectedDeptIds}
          options={departments.map(d => ({ label: d.name, value: d.id }))}
          placeholder="请选择部门"
        />
      </Modal>
    </div>
  )
}

export default OrgManagement
