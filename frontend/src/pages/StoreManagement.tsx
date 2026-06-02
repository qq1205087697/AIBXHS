import React, { useState, useEffect } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, Select, message,
  Popconfirm, Space, Tag, Tabs, Drawer, Transfer, Pagination,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined,
  AppstoreOutlined, ShopOutlined,
} from '@ant-design/icons'
import { storesApi, departmentsApi, storeGroupsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { CSSProperties } from 'react'

interface Store {
  id: number
  name: string
  platform: string
  site: string
  platform_store_id: string
  status: string
  department_id: number | null
  department_name: string
  inventory_name: string | null
  group_id: number | null
  group_name: string
  created_at: string
}

interface Department {
  id: number
  name: string
}

interface StoreGroup {
  id: number
  name: string
  description: string
  store_count: number
  created_at: string
}

const StoreManagement: React.FC = () => {
  const { currentTheme } = useTheme()

  const [stores, setStores] = useState<Store[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<Store | null>(null)
  const [form] = Form.useForm()
  const [searchForm] = Form.useForm()
  const [filters, setFilters] = useState({ name_search: '', site_search: '' })
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchForm] = Form.useForm()

  const [groups, setGroups] = useState<StoreGroup[]>([])
  const [groupLoading, setGroupLoading] = useState(false)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<StoreGroup | null>(null)
  const [groupForm] = Form.useForm()
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false)
  const [currentGroup, setCurrentGroup] = useState<StoreGroup | null>(null)
  const [groupStores, setGroupStores] = useState<Store[]>([])
  const [addStoreModalOpen, setAddStoreModalOpen] = useState(false)
  const [transferTargetKeys, setTransferTargetKeys] = useState<string[]>([])
  const [allStores, setAllStores] = useState<Store[]>([])

  const platformOptions = [
    { label: 'Amazon', value: 'amazon' },
    { label: 'eBay', value: 'ebay' },
    { label: 'Walmart', value: 'walmart' },
    { label: 'Shopify', value: 'shopify' },
    { label: 'Shopee', value: 'shopee' },
    { label: 'Lazada', value: 'lazada' },
    { label: 'TikTok', value: 'tiktok' },
    { label: 'Other', value: 'other' },
  ]

  const statusOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Error', value: 'error' },
  ]

  useEffect(() => {
    fetchStores()
  }, [pagination.current, pagination.pageSize, filters])

  useEffect(() => {
    fetchGroups()
    fetchAllStores()
    fetchDepartments()
  }, [])

  const fetchStores = async () => {
    setLoading(true)
    try {
      const res = await storesApi.getList({
        page: pagination.current,
        page_size: pagination.pageSize,
        ...filters,
      })
      if (res.data.success) {
        setStores(res.data.data)
        setPagination((prev) => ({ ...prev, total: res.data.total }))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchDepartments = async () => {
    try {
      const res = await departmentsApi.getList()
      if (res.data.success) setDepartments(res.data.data)
    } catch (e) {
      console.error(e)
    }
  }

  const fetchAllStores = async () => {
    try {
      const res = await storesApi.getList({ page: 1, page_size: 1000 })
      if (res.data.success) setAllStores(res.data.data)
    } catch (e) {
      console.error(e)
    }
  }

  const fetchGroups = async () => {
    setGroupLoading(true)
    try {
      const res = await storeGroupsApi.getList()
      if (res.data.success) setGroups(res.data.data)
    } catch (e) {
      console.error(e)
    } finally {
      setGroupLoading(false)
    }
  }

  const fetchGroupStores = async (groupId: number) => {
    try {
      const res = await storeGroupsApi.getGroupStores(groupId)
      if (res.data.success) setGroupStores(res.data.data)
    } catch (e) {
      console.error(e)
    }
  }

  const handleSearch = async () => {
    const values = await searchForm.validateFields()
    setFilters(values)
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const handleReset = () => {
    searchForm.resetFields()
    setFilters({ name_search: '', site_search: '' })
    setPagination((prev) => ({ ...prev, current: 1 }))
  }

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  }

  const handleBatchAssign = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要分配部门的店铺')
      return
    }
    batchForm.resetFields()
    setBatchModalOpen(true)
  }

  const handleBatchSubmit = async () => {
    try {
      const values = await batchForm.validateFields()
      await storesApi.batchUpdateDepartment({
        store_ids: selectedRowKeys as number[],
        department_id: values.department_id,
      })
      message.success('批量分配部门成功')
      setBatchModalOpen(false)
      setSelectedRowKeys([])
      fetchStores()
    } catch (e: any) {
      if (e.errorFields) return
      message.error('批量分配失败')
    }
  }

  const handleCreate = () => {
    setEditingStore(null)
    form.resetFields()
    setModalOpen(true)
  }

  const handleEdit = (store: Store) => {
    setEditingStore(store)
    form.setFieldsValue({
      name: store.name,
      platform: store.platform,
      site: store.site,
      platform_store_id: store.platform_store_id,
      department_id: store.department_id,
      status: store.status,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingStore) {
        await storesApi.update(editingStore.id, values)
        message.success('店铺更新成功')
      } else {
        await storesApi.create(values)
        message.success('店铺创建成功')
      }
      setModalOpen(false)
      fetchStores()
      fetchAllStores()
    } catch (e: any) {
      if (e.errorFields) return
      message.error('操作失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await storesApi.delete(id)
      message.success('店铺删除成功')
      fetchStores()
      fetchAllStores()
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleGroupCreate = () => {
    setEditingGroup(null)
    groupForm.resetFields()
    setGroupModalOpen(true)
  }

  const handleGroupEdit = (group: StoreGroup) => {
    setEditingGroup(group)
    groupForm.setFieldsValue({ name: group.name, description: group.description })
    setGroupModalOpen(true)
  }

  const handleGroupSubmit = async () => {
    try {
      const values = await groupForm.validateFields()
      if (editingGroup) {
        await storeGroupsApi.update(editingGroup.id, values)
        message.success('分组更新成功')
      } else {
        await storeGroupsApi.create(values)
        message.success('分组创建成功')
      }
      setGroupModalOpen(false)
      fetchGroups()
    } catch (e: any) {
      if (e.errorFields) return
      message.error('操作失败')
    }
  }

  const handleGroupDelete = async (id: number) => {
    try {
      await storeGroupsApi.delete(id)
      message.success('分组删除成功')
      fetchGroups()
      fetchAllStores()
    } catch (e) {
      message.error('删除失败')
    }
  }

  const handleOpenGroupDrawer = async (group: StoreGroup) => {
    setCurrentGroup(group)
    setGroupDrawerOpen(true)
    await fetchGroupStores(group.id)
  }

  const handleOpenAddStoreModal = () => {
    const currentIds = groupStores.map((s) => String(s.id))
    setTransferTargetKeys(currentIds)
    setAddStoreModalOpen(true)
  }

  const handleAddStoreSubmit = async () => {
    if (!currentGroup) return
    try {
      const newIds = transferTargetKeys.map(Number)
      await storeGroupsApi.batchAddStores(currentGroup.id, newIds)
      message.success('分组店铺更新成功')
      setAddStoreModalOpen(false)
      await fetchGroupStores(currentGroup.id)
      fetchGroups()
      fetchAllStores()
    } catch (e) {
      message.error('操作失败')
    }
  }

  const handleRemoveStoreFromGroup = async (storeId: number) => {
    if (!currentGroup) return
    try {
      await storeGroupsApi.removeStore(currentGroup.id, storeId)
      message.success('已从分组移除')
      await fetchGroupStores(currentGroup.id)
      fetchGroups()
      fetchAllStores()
    } catch (e) {
      message.error('移除失败')
    }
  }

  const storeColumns = [
    { title: '店铺名称', dataIndex: 'name', key: 'name' },
    { title: '店铺', dataIndex: 'inventory_name', key: 'inventory_name' },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: '站点', dataIndex: 'site', key: 'site' },
    { title: '店铺ID', dataIndex: 'platform_store_id', key: 'platform_store_id' },
    {
      title: '所属部门',
      dataIndex: 'department_name',
      key: 'department_name',
      render: (v: string) => <Tag color="green">{v}</Tag>,
    },
    {
      title: '所属分组',
      dataIndex: 'group_name',
      key: 'group_name',
      render: (v: string) => v ? <Tag color="purple">{v}</Tag> : <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = { active: 'success', inactive: 'default', error: 'error' }
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>
      },
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Store) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const groupColumns = [
    { title: '分组名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '店铺数量',
      dataIndex: 'store_count',
      key: 'store_count',
      render: (v: number) => <Tag color="blue">{v} 个店铺</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: StoreGroup) => (
        <Space>
          <Button size="small" icon={<ShopOutlined />} onClick={() => handleOpenGroupDrawer(record)}>
            管理店铺
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleGroupEdit(record)}>编辑</Button>
          <Popconfirm title="删除分组后，分组内店铺将取消分组，确定删除?" onConfirm={() => handleGroupDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const transferDataSource = allStores.map((s) => ({
    key: String(s.id),
    title: `${s.name}${s.site ? ` - ${s.site}` : ''}`,
    description: s.platform,
  }))

  return (
    <div style={{ padding: 24, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        defaultActiveKey="stores"
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        destroyInactiveTabPane
        items={[
          {
            key: 'stores',
            label: <span><ShopOutlined /> 店铺列表</span>,
            children: (
              <>
                <Card
                  loading={loading}
                  title={
                    <Form form={searchForm} layout="inline" style={{ margin: 0 }}>
                      <Form.Item name="name_search" label="店铺名">
                        <Input placeholder="请输入店铺名" style={{ width: 150 }} />
                      </Form.Item>
                      <Form.Item name="site_search" label="站点">
                        <Input placeholder="请输入站点" style={{ width: 150 }} />
                      </Form.Item>
                      <Form.Item>
                        <Space>
                          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
                          <Button onClick={handleReset}>重置</Button>
                        </Space>
                      </Form.Item>
                    </Form>
                  }
                  extra={
                    <Space>
                      {selectedRowKeys.length > 0 && (
                        <Button type="default" onClick={handleBatchAssign}>
                          批量分配部门 ({selectedRowKeys.length})
                        </Button>
                      )}
                      <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增店铺</Button>
                    </Space>
                  }
                >
                  <Table
                    dataSource={stores}
                    columns={storeColumns}
                    rowKey="id"
                    rowSelection={rowSelection}
                    scroll={{ x: 1200, y: 500 }}
                    pagination={false}
                  />
                </Card>
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
                  <Pagination
                    current={pagination.current}
                    pageSize={pagination.pageSize}
                    total={pagination.total}
                    showSizeChanger
                    showQuickJumper
                    showTotal={(total) => `共 ${total} 条`}
                    pageSizeOptions={['10', '20', '50', '100']}
                    onChange={(page, pageSize) =>
                      setPagination((prev) => ({ ...prev, current: page, pageSize: pageSize || 20 }))
                    }
                  />
                </div>
              </>
            ),
          },
          {
            key: 'groups',
            label: <span><AppstoreOutlined /> 店铺分组</span>,
            children: (
              <Card
                loading={groupLoading}
                extra={
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleGroupCreate}>
                    新建分组
                  </Button>
                }
              >
                <Table
                  dataSource={groups}
                  columns={groupColumns}
                  rowKey="id"
                  pagination={false}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={editingStore ? '编辑店铺' : '新增店铺'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="店铺名称" rules={[{ required: true, message: '请输入店铺名称' }]}>
            <Input placeholder="请输入店铺名称" />
          </Form.Item>
          <Form.Item name="platform" label="平台" rules={[{ required: true, message: '请选择平台' }]} initialValue="amazon">
            <Select placeholder="请选择平台" options={platformOptions} />
          </Form.Item>
          <Form.Item name="site" label="站点">
            <Input placeholder="请输入站点，如US、UK等" />
          </Form.Item>
          <Form.Item name="platform_store_id" label="平台店铺ID">
            <Input placeholder="请输入平台店铺ID" />
          </Form.Item>
          <Form.Item name="department_id" label="所属部门">
            <Select
              placeholder="请选择部门"
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
              allowClear
            />
          </Form.Item>
          {editingStore && (
            <Form.Item name="status" label="状态">
              <Select placeholder="请选择状态" options={statusOptions} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title="批量分配部门"
        open={batchModalOpen}
        onOk={handleBatchSubmit}
        onCancel={() => setBatchModalOpen(false)}
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item name="department_id" label="选择部门">
            <Select placeholder="请选择部门（不选择则取消分配）" allowClear>
              {departments.map((dept) => (
                <Select.Option key={dept.id} value={dept.id}>{dept.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <div style={{ color: '#999', fontSize: '12px' }}>
            已选择 {selectedRowKeys.length} 个店铺进行批量分配
          </div>
        </Form>
      </Modal>

      <Modal
        title={editingGroup ? '编辑分组' : '新建分组'}
        open={groupModalOpen}
        onOk={handleGroupSubmit}
        onCancel={() => setGroupModalOpen(false)}
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="如：B账号欧洲" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="分组描述（可选）" rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={currentGroup ? `分组：${currentGroup.name}` : '分组店铺管理'}
        open={groupDrawerOpen}
        onClose={() => setGroupDrawerOpen(false)}
        width={600}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAddStoreModal}>
            批量添加店铺
          </Button>
        }
      >
        <Table
          dataSource={groupStores}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: '店铺名称', dataIndex: 'name', key: 'name' },
            {
              title: '平台',
              dataIndex: 'platform',
              key: 'platform',
              render: (v: string) => <Tag color="blue">{v}</Tag>,
            },
            { title: '站点', dataIndex: 'site', key: 'site' },
            {
              title: '操作',
              key: 'actions',
              render: (_: any, record: any) => (
                <Popconfirm title="确定从分组移除?" onConfirm={() => handleRemoveStoreFromGroup(record.id)}>
                  <Button size="small" danger>移除</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        title="批量添加店铺到分组"
        open={addStoreModalOpen}
        onOk={handleAddStoreSubmit}
        onCancel={() => setAddStoreModalOpen(false)}
        width={700}
      >
        <Transfer
          dataSource={transferDataSource}
          titles={['所有店铺', '分组内店铺']}
          targetKeys={transferTargetKeys}
          onChange={(nextTargetKeys) => setTransferTargetKeys(nextTargetKeys as string[])}
          render={(item) => item.title}
          showSearch
          filterOption={(inputValue, item) =>
            item.title.toLowerCase().includes(inputValue.toLowerCase())
          }
          listStyle={{ width: 280, height: 400 }}
        />
      </Modal>
    </div>
  )
}

export default StoreManagement
