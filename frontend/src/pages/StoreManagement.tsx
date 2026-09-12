import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, Select, message,
  Popconfirm, Space, Tag, Tabs, Drawer, Transfer, Pagination, Dropdown, Menu,
  Spin, Empty,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined,
  AppstoreOutlined, ShopOutlined, TeamOutlined, UserOutlined, DownOutlined,
} from '@ant-design/icons'
import { storesApi, departmentsApi, storeGroupsApi } from '../api'
import { useTheme } from '../contexts/ThemeContext'
import { useResponsive } from '../hooks/useResponsive'
import { CSSProperties, useMemo } from 'react'
import { loadCustomPlatforms, saveCustomPlatform } from '../utils/customPlatforms'

interface Store {
  id: number
  name: string
  platform: string
  site: string
  status: string
  inventory_name: string | null
  ziniao_account: string | null
  group_id: number | null
  group_name: string
  created_at: string
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
  const resp = useResponsive()

  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<Store | null>(null)
  const [form] = Form.useForm()
  const [searchText, setSearchText] = useState('')
  const [filters, setFilters] = useState<Record<string, any>>({ search: '' })
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const searchTimeoutRef = useRef<number | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchForm] = Form.useForm()

  // 分配人员相关状态
  const [memberModalOpen, setMemberModalOpen] = useState(false)
  const [memberStoreId, setMemberStoreId] = useState<number | null>(null)
  const [memberGroupId, setMemberGroupId] = useState<number | null>(null)
  const [memberList, setMemberList] = useState<any[]>([])
  const [memberLoading, setMemberLoading] = useState(false)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])

  // 分配店铺分组相关状态
  const [assignGroupModalOpen, setAssignGroupModalOpen] = useState(false)
  const [assignGroupStore, setAssignGroupStore] = useState<Store | null>(null)
  const [assignGroupForm] = Form.useForm()

  const [groups, setGroups] = useState<StoreGroup[]>([])
  const [groupLoading, setGroupLoading] = useState(false)
  const [groupSearchText, setGroupSearchText] = useState('')
  const [groupPagination, setGroupPagination] = useState({ current: 1, pageSize: 20 })
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<StoreGroup | null>(null)
  const [groupForm] = Form.useForm()
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false)
  const [currentGroup, setCurrentGroup] = useState<StoreGroup | null>(null)
  const [groupStores, setGroupStores] = useState<Store[]>([])
  // 分组行展开显示组内店铺
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<React.Key[]>([])
  const [groupStoresMap, setGroupStoresMap] = useState<Record<number, Store[]>>({})
  const [groupStoresLoadingIds, setGroupStoresLoadingIds] = useState<number[]>([])
  const [addStoreModalOpen, setAddStoreModalOpen] = useState(false)
  const [transferTargetKeys, setTransferTargetKeys] = useState<string[]>([])
  const [allStores, setAllStores] = useState<Store[]>([])
  const [customPlatforms, setCustomPlatforms] = useState<string[]>(() => loadCustomPlatforms())
  const watchPlatform = Form.useWatch('platform', form)

  const platformOptions = [
    { label: 'Amazon', value: 'amazon' },
    { label: 'eBay', value: 'ebay' },
    { label: 'Walmart', value: 'walmart' },
    { label: 'Shopify', value: 'shopify' },
    { label: 'Shopee', value: 'shopee' },
    { label: 'Lazada', value: 'lazada' },
    { label: 'TikTok', value: 'tiktok' },
    { label: 'Temu半托', value: 'temu_half' },
    { label: 'Temu全托', value: 'temu_full' },
    { label: 'SHEIN半托', value: 'shein_half' },
    { label: 'SHEIN全托', value: 'shein_full' },
    { label: '速卖通半托', value: 'aliexpress_half' },
    { label: '速卖通全托', value: 'aliexpress_full' },
    { label: 'Other', value: 'other' },
  ]

  const platformLabelMap: Record<string, string> = {
    amazon: 'Amazon',
    ebay: 'eBay',
    walmart: 'Walmart',
    shopify: 'Shopify',
    shopee: 'Shopee',
    lazada: 'Lazada',
    tiktok: 'TikTok',
    temu_half: 'Temu半托',
    temu_full: 'Temu全托',
    shein_half: 'SHEIN半托',
    shein_full: 'SHEIN全托',
    aliexpress_half: '速卖通半托',
    aliexpress_full: '速卖通全托',
    other: 'Other',
  }

  // 标准平台 + 自定义平台（localStorage）+ 已有店铺中出现过的非标准平台
  const dynamicPlatformOptions = useMemo(() => {
    const stdValues = new Set(platformOptions.map((o) => o.value))
    const extra = new Set<string>()
    customPlatforms.forEach((p) => { if (p && !stdValues.has(p)) extra.add(p) })
    allStores.forEach((s) => { if (s.platform && !stdValues.has(s.platform)) extra.add(s.platform) })
    return [...platformOptions, ...Array.from(extra).map((p) => ({ label: p, value: p }))]
  }, [customPlatforms, allStores])

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
      if (res.data.success) {
        const list: StoreGroup[] = res.data.data || []
        setGroups(list)
        // 删除后当前页可能超范围，自动回退
        setGroupPagination((prev) => {
          const maxPage = Math.max(1, Math.ceil(list.length / prev.pageSize))
          return prev.current > maxPage ? { ...prev, current: maxPage } : prev
        })
      }
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

  // 加载并缓存分组内店铺（展开行用）
  const loadGroupStoresMap = async (groupId: number) => {
    if (groupStoresLoadingIds.includes(groupId)) return
    setGroupStoresLoadingIds((prev) => [...prev, groupId])
    try {
      const res = await storeGroupsApi.getGroupStores(groupId)
      if (res.data.success) {
        setGroupStoresMap((prev) => ({ ...prev, [groupId]: res.data.data }))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setGroupStoresLoadingIds((prev) => prev.filter((id) => id !== groupId))
    }
  }

  const handleGroupExpand = (expanded: boolean, record: StoreGroup) => {
    setExpandedGroupKeys((prev) =>
      expanded ? [...prev, record.id] : prev.filter((k) => k !== record.id),
    )
    if (expanded) loadGroupStoresMap(record.id)
  }

  const handleSearch = (value: string) => {
    setSearchText(value)
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: value }))
      setPagination((prev) => ({ ...prev, current: 1 }))
    }, 300)
  }

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  }

  const handleBatchAssign = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要分配分组的店铺')
      return
    }
    batchForm.resetFields()
    setBatchModalOpen(true)
  }

  const handleBatchSubmit = async () => {
    try {
      const values = await batchForm.validateFields()
      await storesApi.batchUpdateGroup({
        store_ids: selectedRowKeys as number[],
        group_id: values.group_id ?? null,
      })
      message.success('批量分配分组成功')
      setBatchModalOpen(false)
      setSelectedRowKeys([])
      fetchStores()
    } catch (e: any) {
      if (e.errorFields) return
      message.error(e?.response?.data?.detail || '批量分配失败')
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
      inventory_name: store.inventory_name,
      ziniao_account: store.ziniao_account,
      platform: store.platform,
      site: store.site,
      shop_abbr: (store as any).shop_abbr,
      group_id: store.group_id,
      status: store.status,
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (values.platform === 'other') {
        const name = (values.custom_platform_name || '').trim()
        if (!name) return
        values.platform = name
        setCustomPlatforms(saveCustomPlatform(name))
      }
      delete values.custom_platform_name
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

  // 分配人员相关函数
  const handleOpenMemberModal = async (id: number, type: 'store' | 'group' = 'store') => {
    if (type === 'store') {
      setMemberStoreId(id)
      setMemberGroupId(null)
    } else {
      setMemberGroupId(id)
      setMemberStoreId(null)
    }
    setMemberModalOpen(true)
    setMemberLoading(true)
    try {
      if (type === 'store') {
        // 获取店铺人员
        const memberRes = await storesApi.getMembers(id)
        const members = memberRes.data?.data || []
        setMemberList(members)
        setSelectedUserIds(members.map((m: any) => m.id))
      } else {
        // 获取店铺分组的人员（合并分组下所有店铺的人员）
        const memberRes = await storeGroupsApi.getMembers(id)
        const members = memberRes.data?.data || []
        setMemberList(members)
        setSelectedUserIds(members.map((m: any) => m.id))
      }

      // 获取所有用户
      const userRes = await departmentsApi.getAllUsers()
      setAllUsers(userRes.data?.data || [])
    } catch (e) {
      message.error('获取数据失败')
    } finally {
      setMemberLoading(false)
    }
  }

  const handleSaveMembers = async () => {
    if (!memberStoreId && !memberGroupId) return
    setMemberLoading(true)
    try {
      if (memberStoreId) {
        await storesApi.setMembers(memberStoreId, { user_ids: selectedUserIds })
      } else if (memberGroupId) {
        await storeGroupsApi.setMembers(memberGroupId, { user_ids: selectedUserIds })
      }
      message.success('保存成功')
      setMemberModalOpen(false)
    } catch (e) {
      message.error('保存失败')
    } finally {
      setMemberLoading(false)
    }
  }

  // 分配店铺分组相关函数
  const handleOpenGroupModal = (store: Store) => {
    setAssignGroupStore(store)
    assignGroupForm.setFieldsValue({ group_id: store.group_id })
    setAssignGroupModalOpen(true)
  }

  const handleSaveAssignGroup = async () => {
    if (!assignGroupStore) return
    try {
      const values = await assignGroupForm.validateFields()
      // 调用批量接口更新店铺分组（group_id 为空时表示取消分组）
      await storesApi.batchUpdateGroup({
        store_ids: [assignGroupStore.id],
        group_id: values.group_id ?? null,
      })
      message.success('分配店铺分组成功')
      setAssignGroupModalOpen(false)
      fetchStores()
      fetchAllStores()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '分配失败')
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
      message.error(e?.response?.data?.detail || '操作失败')
    }
  }

  const handleGroupDelete = async (id: number) => {
    try {
      await storeGroupsApi.delete(id)
      message.success('分组删除成功')
      setExpandedGroupKeys((prev) => prev.filter((k) => k !== id))
      setGroupStoresMap((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
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
      loadGroupStoresMap(currentGroup.id)
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
      loadGroupStoresMap(currentGroup.id)
      fetchGroups()
      fetchAllStores()
    } catch (e) {
      message.error('移除失败')
    }
  }

  // 分组搜索过滤（名称/描述）
  const filteredGroups = useMemo(() => {
    const kw = groupSearchText.trim().toLowerCase()
    if (!kw) return groups
    return groups.filter(
      (g) =>
        (g.name || '').toLowerCase().includes(kw) ||
        (g.description || '').toLowerCase().includes(kw),
    )
  }, [groups, groupSearchText])

  const handleGroupSearch = (value: string) => {
    setGroupSearchText(value)
    setGroupPagination((prev) => ({ ...prev, current: 1 }))
  }

  const storeColumns = [
    { title: '店铺名', dataIndex: 'inventory_name', key: 'inventory_name' },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      render: (v: string) => <Tag color="blue">{platformLabelMap[v] || v}</Tag>,
    },
    { title: '紫鸟账号', dataIndex: 'ziniao_account', key: 'ziniao_account' },
    { title: '站点', dataIndex: 'site', key: 'site' },
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
      width: 100,
      render: (_: any, record: Store) => {
        const items: MenuProps['items'] = [
          {
            key: 'edit',
            label: '编辑',
            icon: <EditOutlined />,
            onClick: () => handleEdit(record),
          },
          {
            key: 'assignGroup',
            label: '分配店铺分组',
            icon: <TeamOutlined />,
            onClick: () => handleOpenGroupModal(record),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              Modal.confirm({
                title: '确定删除?',
                content: '删除后数据将无法恢复',
                okText: '确定',
                cancelText: '取消',
                onOk: () => handleDelete(record.id),
              })
            },
          },
        ]
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button size="small">
              操作 <DownOutlined />
            </Button>
          </Dropdown>
        )
      },
    },
  ]

  const groupColumns = [
    { title: '分组名称', dataIndex: 'name', key: 'name', width: 220 },
    { title: '描述', dataIndex: 'description', key: 'description', width: 380, ellipsis: true },
    {
      title: '店铺数量',
      dataIndex: 'store_count',
      key: 'store_count',
      width: 150,
      render: (v: number) => <Tag color="blue">{v} 个店铺</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 200 },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: any, record: StoreGroup) => {
        const items: MenuProps['items'] = [
          {
            key: 'manage',
            label: '管理店铺',
            icon: <ShopOutlined />,
            onClick: () => handleOpenGroupDrawer(record),
          },
          {
            key: 'assignMember',
            label: '分配人员',
            icon: <UserOutlined />,
            onClick: () => handleOpenMemberModal(record.id, 'group'),
          },
          {
            key: 'edit',
            label: '编辑',
            icon: <EditOutlined />,
            onClick: () => handleGroupEdit(record),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              Modal.confirm({
                title: '删除分组',
                content: '删除分组后，分组内店铺将取消分组，确定删除?',
                okText: '确定',
                cancelText: '取消',
                onOk: () => handleGroupDelete(record.id),
              })
            },
          },
        ]
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button size="small">
              操作 <DownOutlined />
            </Button>
          </Dropdown>
        )
      },
    },
  ]

  const transferDataSource = allStores.map((s) => ({
    key: String(s.id),
    title: `${s.inventory_name || s.name}${s.site ? ` - ${s.site}` : ''}`,
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
                    <Input
                      placeholder="搜索紫鸟账号、店铺名、站点..."
                      prefix={<SearchOutlined />}
                      allowClear
                      style={{ width: resp.isMobile ? '100%' : 400 }}
                      value={searchText}
                      onChange={(e) => handleSearch(e.target.value)}
                    />
                  }
                  extra={
                    <Space>
                      {selectedRowKeys.length > 0 && (
                        <Button type="default" onClick={handleBatchAssign}>
                          批量分配分组 ({selectedRowKeys.length})
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
              <>
                <Card
                  loading={groupLoading}
                  title={
                    <Input
                      placeholder="搜索分组名称、描述..."
                      prefix={<SearchOutlined />}
                      allowClear
                      style={{ width: resp.isMobile ? '100%' : 400 }}
                      value={groupSearchText}
                      onChange={(e) => handleGroupSearch(e.target.value)}
                    />
                  }
                  extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleGroupCreate}>
                      新建分组
                    </Button>
                  }
                >
                  <Table
                    dataSource={filteredGroups.slice(
                      (groupPagination.current - 1) * groupPagination.pageSize,
                      groupPagination.current * groupPagination.pageSize,
                    )}
                    columns={groupColumns}
                    rowKey="id"
                    pagination={false}
                    scroll={{ x: 1200, y: 500 }}
                  expandable={{
                    expandedRowKeys: expandedGroupKeys,
                    onExpand: handleGroupExpand,
                    expandedRowRender: (record: StoreGroup) => {
                      const list = groupStoresMap[record.id]
                      if (groupStoresLoadingIds.includes(record.id)) {
                        return (
                          <div style={{ textAlign: 'center', padding: 16 }}>
                            <Spin size="small" />
                          </div>
                        )
                      }
                      if (!list || list.length === 0) {
                        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无店铺" />
                      }
                      return (
                        <Table
                          dataSource={list}
                          rowKey="id"
                          size="small"
                          pagination={false}
                          columns={[
                            { title: '店铺名', dataIndex: 'inventory_name', key: 'inventory_name' },
                            {
                              title: '平台',
                              dataIndex: 'platform',
                              key: 'platform',
                              width: 130,
                              render: (v: string) => <Tag color="blue">{platformLabelMap[v] || v}</Tag>,
                            },
                            { title: '紫鸟账号', dataIndex: 'ziniao_account', key: 'ziniao_account', width: 180 },
                            { title: '站点', dataIndex: 'site', key: 'site', width: 100 },
                          ]}
                        />
                      )
                    },
                  }}
                />
                </Card>
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
                  <Pagination
                    current={groupPagination.current}
                    pageSize={groupPagination.pageSize}
                    total={filteredGroups.length}
                    showSizeChanger
                    showQuickJumper
                    showTotal={(total) => `共 ${total} 条`}
                    pageSizeOptions={['10', '20', '50', '100']}
                    onChange={(page, pageSize) =>
                      setGroupPagination((prev) => ({ ...prev, current: page, pageSize: pageSize || 20 }))
                    }
                  />
                </div>
              </>
            ),
          },
        ]}
      />

      <Modal
        title={editingStore ? '编辑店铺' : '新增店铺'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={resp.isMobile ? '95vw' : 600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="inventory_name" label="店铺名" rules={[{ required: true, message: '请输入店铺名' }]}>
            <Input placeholder="请输入店铺名" />
          </Form.Item>
          <Form.Item name="ziniao_account" label="紫鸟账号">
            <Input placeholder="请输入紫鸟账号" />
          </Form.Item>
          <Form.Item name="name" label="店铺名称">
            <Input placeholder="可选，不填则自动使用店铺名" />
          </Form.Item>
          <Form.Item name="platform" label="平台" rules={[{ required: true, message: '请选择平台' }]} initialValue="amazon">
            <Select
              placeholder="请选择平台"
              options={dynamicPlatformOptions}
              onChange={(v) => { if (v !== 'other') form.setFieldValue('custom_platform_name', undefined) }}
            />
          </Form.Item>
          {watchPlatform === 'other' && (
            <Form.Item
              name="custom_platform_name"
              label="自定义平台名称"
              rules={[{ required: true, message: '请输入平台名称' }]}
              preserve={false}
            >
              <Input placeholder="请输入平台名称，如：Noon" maxLength={30} />
            </Form.Item>
          )}
          <Form.Item name="site" label="站点">
            <Input placeholder="请输入站点，如US、UK等" />
          </Form.Item>
          <Form.Item name="shop_abbr" label="店铺简称" rules={[{ required: true, message: '请输入店铺简称' }]}>
            <Input placeholder="请输入店铺简称" />
          </Form.Item>
          <Form.Item name="group_id" label="所属分组">
            <Select
              placeholder="请选择店铺分组"
              options={groups.map((g) => ({ label: g.name, value: g.id }))}
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
        title="批量分配分组"
        open={batchModalOpen}
        onOk={handleBatchSubmit}
        onCancel={() => setBatchModalOpen(false)}
        width={resp.isMobile ? '95vw' : 520}
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item name="group_id" label="选择店铺分组">
            <Select placeholder="请选择店铺分组（不选择则取消分组）" allowClear>
              {groups.map((g) => (
                <Select.Option key={g.id} value={g.id}>{g.name}</Select.Option>
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
        width={resp.isMobile ? '95vw' : 520}
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
          scroll={{ x: resp.isMobile ? true : false }}
          columns={[
            { title: '店铺名', dataIndex: 'inventory_name', key: 'inventory_name' },
            {
              title: '平台',
              dataIndex: 'platform',
              key: 'platform',
              render: (v: string) => <Tag color="blue">{platformLabelMap[v] || v}</Tag>,
            },
            { title: '紫鸟账号', dataIndex: 'ziniao_account', key: 'ziniao_account' },
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
        width={resp.isMobile ? '95vw' : 700}
      >
        <Transfer
          dataSource={transferDataSource}
          titles={['所有店铺', '分组内店铺']}
          targetKeys={transferTargetKeys}
          onChange={(nextTargetKeys) => setTransferTargetKeys(nextTargetKeys as string[])}
          render={(item) => (
            <span>
              {item.title}
              {item.description && (
                <Tag color="blue" style={{ marginLeft: 8 }}>
                  {platformLabelMap[item.description as string] || item.description}
                </Tag>
              )}
            </span>
          )}
          showSearch
          filterOption={(inputValue, item) =>
            item.title.toLowerCase().includes(inputValue.toLowerCase()) ||
            (item.description && String(item.description).toLowerCase().includes(inputValue.toLowerCase()))
          }
          listStyle={{ width: 280, height: 400 }}
        />
      </Modal>

      {/* 分配店铺分组弹窗 */}
      <Modal
        title="分配店铺分组"
        open={assignGroupModalOpen}
        onOk={handleSaveAssignGroup}
        onCancel={() => setAssignGroupModalOpen(false)}
        width={resp.isMobile ? '95vw' : 400}
      >
        <Form form={assignGroupForm} layout="vertical">
          <Form.Item name="group_id" label="选择店铺分组">
            <Select
              placeholder="请选择店铺分组"
              options={groups.map((g) => ({ label: g.name, value: g.id }))}
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分配人员弹窗 */}
      <Modal
        title="分配人员"
        open={memberModalOpen}
        onOk={handleSaveMembers}
        onCancel={() => setMemberModalOpen(false)}
        confirmLoading={memberLoading}
        width={resp.isMobile ? '95vw' : 600}
      >
        <Transfer
          dataSource={allUsers.map((u: any) => ({
            key: u.id,
            title: u.name || u.username,
            description: u.email,
          }))}
          targetKeys={selectedUserIds}
          onChange={(keys) => setSelectedUserIds(keys as number[])}
          render={(item) => item.title}
          titles={['可选人员', '已分配人员']}
          showSearch
          filterOption={(inputValue, item) =>
            item.title.toLowerCase().includes(inputValue.toLowerCase()) ||
            (item.description && item.description.toLowerCase().includes(inputValue.toLowerCase()))
          }
          listStyle={{ width: 260, height: 350 }}
        />
      </Modal>
    </div>
  )
}

export default StoreManagement
