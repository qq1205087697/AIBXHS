import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Modal, Input, Form, Select, message, Space, Tag, Tabs, Typography, Dropdown, MenuProps, Popconfirm, Pagination } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, TeamOutlined, UserOutlined, LockOutlined, MoreOutlined, DownOutlined } from '@ant-design/icons'
import { departmentsApi, permissionsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import type { TableProps } from 'antd'

const { Title } = Typography

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
  status: string
  role_id?: number
  department_names: string
  department_ids: string
}

interface Role {
  id: number
  name: string
  code: string
  description: string
  is_system: boolean
  sort_order: number
  created_at: string
  user_count: number
}

const OrgManagement: React.FC = () => {
  const { currentTheme } = useTheme()
  const { hasPermission } = useAuth()
  const [departments, setDepartments] = useState<Department[]>([])
  const [users, setUsers] = useState<UserItem[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(false)
  const [userPagination, setUserPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [deptPagination, setDeptPagination] = useState({ current: 1, pageSize: 20, total: 0 })
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
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [createdUserInfo, setCreatedUserInfo] = useState<any>(null)
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchAssignModalOpen, setBatchAssignModalOpen] = useState(false)
  const [batchSelectedDeptIds, setBatchSelectedDeptIds] = useState<number[]>([])
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordForm] = Form.useForm()
  const [batchPasswordModalOpen, setBatchPasswordModalOpen] = useState(false)
  const [batchPasswordForm] = Form.useForm()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [deptRes, usersRes, rolesRes] = await Promise.all([
        departmentsApi.getList(),
        departmentsApi.getAllUsers(),
        permissionsApi.getRoles()
      ])
      if (deptRes.data.success) {
        setDepartments(deptRes.data.data)
        setDeptPagination(prev => ({ ...prev, total: deptRes.data.data.length }))
      }
      if (usersRes.data.success) {
        setUsers(usersRes.data.data)
        setUserPagination(prev => ({ ...prev, total: usersRes.data.data.length }))
      }
      if (rolesRes.data.success) setRoles(rolesRes.data.data)
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
    setEditingUser(null)
    userForm.resetFields()
    setUserModalOpen(true)
  }

  const handleEditUser = (user: UserItem) => {
    setEditingUser(user)
    userForm.setFieldsValue({
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      role_id: user.role_id
    })
    setUserModalOpen(true)
  }

  const handleUserSubmit = async () => {
    try {
      const values = await userForm.validateFields()
      if (editingUser) {
        await departmentsApi.updateUser(editingUser.id, values)
        message.success('用户更新成功')
      } else {
        const res = await departmentsApi.createUser(values)
        if (res.data.success) {
          setCreatedUserInfo(res.data.data)
          setSuccessModalOpen(true)
        }
      }
      setUserModalOpen(false)
      fetchData()
    } catch (e: any) {
      if (e.errorFields) return
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  const handleToggleUserStatus = async (user: UserItem) => {
    try {
      await departmentsApi.toggleUserStatus(user.id)
      message.success('用户状态已切换')
      fetchData()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '切换状态失败')
    }
  }

  const handleDeleteUser = (user: UserItem) => {
    Modal.confirm({
      title: '删除用户',
      content: `确定要删除用户"${user.nickname || user.username}"吗？`,
      onOk: async () => {
        try {
          await departmentsApi.deleteUser(user.id)
          message.success('用户删除成功')
          fetchData()
        } catch (e: any) {
          message.error(e.response?.data?.detail || '删除失败')
        }
      }
    })
  }

  const handleOpenPasswordModal = (user: UserItem) => {
    setSelectedUser(user)
    passwordForm.resetFields()
    setPasswordModalOpen(true)
  }

  const handleChangePassword = async () => {
    if (!selectedUser) return
    try {
      const values = await passwordForm.validateFields()
      await departmentsApi.changeUserPassword(selectedUser.id, values.new_password)
      message.success('密码修改成功')
      setPasswordModalOpen(false)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '修改密码失败')
    }
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

  const handleBatchEnable = async () => {
    try {
      await departmentsApi.batchEnableUsers(selectedRowKeys.map(Number))
      message.success('批量启用成功')
      setSelectedRowKeys([])
      fetchData()
    } catch (e) {
      message.error('批量启用失败')
    }
  }

  const handleBatchDisable = async () => {
    try {
      await departmentsApi.batchDisableUsers(selectedRowKeys.map(Number))
      message.success('批量禁用成功')
      setSelectedRowKeys([])
      fetchData()
    } catch (e) {
      message.error('批量禁用失败')
    }
  }

  const handleBatchPasswordSubmit = async () => {
    try {
      const values = await batchPasswordForm.validateFields()
      await departmentsApi.batchChangePassword(selectedRowKeys.map(Number), values.new_password)
      message.success('批量修改密码成功')
      setBatchPasswordModalOpen(false)
      setSelectedRowKeys([])
      batchPasswordForm.resetFields()
      fetchData()
    } catch (e) {
      message.error('批量修改密码失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      await departmentsApi.batchDeleteUsers(selectedRowKeys.map(Number))
      message.success('批量删除成功')
      setSelectedRowKeys([])
      fetchData()
    } catch (e) {
      message.error('批量删除失败')
    }
  }

  const getRoleName = (roleCode: string, roleId?: number) => {
    if (roleId) {
      const role = roles.find(r => r.id === roleId)
      if (role) return role.name
    }
    const role = roles.find(r => r.code === roleCode)
    if (role) return role.name
    return roleCode === 'admin' ? '管理员' : roleCode
  }

  const getUserActionsMenu = (user: UserItem): MenuProps['items'] => [
    {
      key: 'assign',
      label: '分配部门',
      icon: <TeamOutlined />,
      onClick: () => handleAssignDepts(user)
    },
    {
      key: 'toggle',
      label: user.status === 'active' ? '禁用' : '启用',
      icon: <UserOutlined />,
      onClick: () => handleToggleUserStatus(user)
    },
    {
      key: 'password',
      label: '更改密码',
      icon: <LockOutlined />,
      onClick: () => handleOpenPasswordModal(user)
    },
    {
      type: 'divider'
    },
    {
      key: 'delete',
      label: '删除',
      style: { color: '#ff4d4f' },
      icon: <DeleteOutlined />,
      onClick: () => handleDeleteUser(user)
    }
  ]

  const batchActionsMenu: MenuProps['items'] = [
    {
      key: 'assign',
      label: '批量分配部门',
      icon: <TeamOutlined />,
      onClick: () => handleBatchAssign()
    },
    {
      key: 'enable',
      label: '批量启用',
      icon: <UserOutlined />,
      onClick: () => {
        Modal.confirm({
          title: '批量启用用户',
          content: `确定要启用选中的 ${selectedRowKeys.length} 个用户吗？`,
          onOk: handleBatchEnable
        })
      }
    },
    {
      key: 'disable',
      label: '批量禁用',
      icon: <UserOutlined />,
      onClick: () => {
        Modal.confirm({
          title: '批量禁用用户',
          content: `确定要禁用选中的 ${selectedRowKeys.length} 个用户吗？`,
          onOk: handleBatchDisable
        })
      }
    },
    {
      key: 'password',
      label: '批量修改密码',
      icon: <LockOutlined />,
      onClick: () => {
        setBatchPasswordModalOpen(true)
      }
    },
    {
      type: 'divider'
    },
    {
      key: 'delete',
      label: '批量删除',
      style: { color: '#ff4d4f' },
      icon: <DeleteOutlined />,
      onClick: () => {
        Modal.confirm({
          title: '批量删除用户',
          content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？此操作不可恢复！`,
          onOk: handleBatchDelete
        })
      }
    }
  ]

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
          {hasPermission('org:edit') && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => handleEditDept(record)}>编辑</Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteDept(record.id)}>删除</Button>
            </>
          )}
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
    { title: '姓名', dataIndex: 'nickname', key: 'nickname' },
    { title: '邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: '角色', dataIndex: 'role', key: 'role',
      render: (v: string, record: UserItem) => (
        <Tag color={v === 'admin' ? 'red' : 'blue'}>{getRoleName(v, record.role_id)}</Tag>
      )
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>
          {v === 'active' ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '所属部门', dataIndex: 'department_names', key: 'department_names',
      render: (v: string) => v ? <Tag color="green">{v}</Tag> : <Tag color="default">未分配</Tag>
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, record: UserItem) => (
        <Space>
          {hasPermission('org:edit') && (
            <>
              <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => handleEditUser(record)}>
                编辑
              </Button>
              <Dropdown
                menu={{ items: getUserActionsMenu(record) }}
                trigger={['click']}
              >
                <Button size="small" icon={<MoreOutlined />}>操作</Button>
              </Dropdown>
            </>
          )}
        </Space>
      )
    }
  ]

  const getCurrentPageUsers = () => {
    const start = (userPagination.current - 1) * userPagination.pageSize
    const end = start + userPagination.pageSize
    return users.slice(start, end)
  }

  const getCurrentPageDepts = () => {
    const start = (deptPagination.current - 1) * deptPagination.pageSize
    const end = start + deptPagination.pageSize
    return departments.slice(start, end)
  }

  return (
    <div style={{ 
      padding: 24,
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <Tabs
        defaultActiveKey="users"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        items={[
          {
            key: 'users',
            label: '用户管理',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <Card 
                  title="用户列表" 
                  loading={loading}
                  extra={
                    <Space>
                      {hasPermission('org:edit') && selectedRowKeys.length > 0 && (
                        <Dropdown menu={{ items: batchActionsMenu }} trigger={['click']}>
                          <Button type="primary">
                            批量操作 ({selectedRowKeys.length}) <DownOutlined />
                          </Button>
                        </Dropdown>
                      )}
                      {hasPermission('org:edit') && <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateUser}>新建用户</Button>}
                    </Space>
                  }
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
                  styles={{ body: { flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
                >
                  <Table 
                    rowSelection={hasPermission('org:edit') ? {
                      ...rowSelection,
                      columnWidth: 60
                    } : undefined}
                    dataSource={getCurrentPageUsers()} 
                    columns={userColumns} 
                    rowKey="id" 
                    pagination={false}
                    scroll={{ x: 'max-content', y: 'calc(100vh - 380px)' }}
                  />
                </Card>
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, flexShrink: 0 }}>
                  <Pagination
                    current={userPagination.current}
                    pageSize={userPagination.pageSize}
                    total={userPagination.total}
                    showSizeChanger
                    showQuickJumper
                    showTotal={(total) => `共 ${total} 条`}
                    pageSizeOptions={['10', '20', '50', '100']}
                    onChange={(page, pageSize) =>
                      setUserPagination(prev => ({ ...prev, current: page, pageSize: pageSize || 20 }))
                    }
                  />
                </div>
              </div>
            )
          },
          {
            key: 'departments',
            label: '部门管理',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <Card
                  title="部门列表"
                  loading={loading}
                  extra={<>{hasPermission('org:edit') && <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateDept}>新建部门</Button>}</>}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
                  styles={{ body: { flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
                >
                  <Table 
                    dataSource={getCurrentPageDepts()} 
                    columns={deptColumns} 
                    rowKey="id" 
                    pagination={false}
                    scroll={{ x: 'max-content', y: 'calc(100vh - 380px)' }}
                  />
                </Card>
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, flexShrink: 0 }}>
                  <Pagination
                    current={deptPagination.current}
                    pageSize={deptPagination.pageSize}
                    total={deptPagination.total}
                    showSizeChanger
                    showQuickJumper
                    showTotal={(total) => `共 ${total} 条`}
                    pageSizeOptions={['10', '20', '50', '100']}
                    onChange={(page, pageSize) =>
                      setDeptPagination(prev => ({ ...prev, current: page, pageSize: pageSize || 20 }))
                    }
                  />
                </div>
              </div>
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
        title={editingUser ? '编辑用户' : '新建用户'}
        open={userModalOpen}
        onOk={handleUserSubmit}
        onCancel={() => setUserModalOpen(false)}
        width={500}
      >
        <Form form={userForm} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" disabled={!!editingUser} />
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
            name="nickname"
            label="姓名"
          >
            <Input placeholder="请输入姓名（可选）" />
          </Form.Item>
          <Form.Item
            name="role_id"
            label="角色"
          >
            <Select placeholder="请选择角色" style={{ width: '100%' }}>
              {roles.map(role => (
                <Select.Option key={role.id} value={role.id}>{role.name}</Select.Option>
              ))}
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
          <Button key="close" onClick={() => setSuccessModalOpen(false)}>
            关闭
          </Button>
        ]}
      >
        <div style={{ 
          backgroundColor: '#f5f5f5', 
          padding: 16, 
          borderRadius: 8,
          fontFamily: 'monospace'
        }}>
          <p><strong>用户名：</strong>{createdUserInfo?.username}</p>
          <p><strong>密码：</strong>{createdUserInfo?.password}</p>
          <p><strong>邮箱：</strong>{createdUserInfo?.email}</p>
          <p><strong>角色：</strong>{getRoleName(createdUserInfo?.role, createdUserInfo?.role_id)}</p>
        </div>
      </Modal>

      <Modal
        title="更改密码"
        open={passwordModalOpen}
        onOk={handleChangePassword}
        onCancel={() => setPasswordModalOpen(false)}
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少6位' }]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
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

      <Modal
        title={`批量修改密码 (已选 ${selectedRowKeys.length} 个用户)`}
        open={batchPasswordModalOpen}
        onOk={handleBatchPasswordSubmit}
        onCancel={() => setBatchPasswordModalOpen(false)}
        width={500}
      >
        <Form form={batchPasswordForm} layout="vertical">
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6位' }
            ]}
          >
            <Input.Password placeholder="请输入所有选中用户的新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default OrgManagement
