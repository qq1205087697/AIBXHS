import React, { useState, useEffect } from "react";
import {
  Layout,
  Menu,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Space,
  Tabs,
  Checkbox,
  Tag,
  Typography,
  Empty,
  Tooltip,
  Transfer,
  Dropdown,
  Table,
  Spin,
  Pagination,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  UserOutlined,
  KeyOutlined,
  SaveOutlined,
  MoreOutlined,
  UserAddOutlined,
  ShoppingOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  TruckOutlined,
  DatabaseOutlined,
  ShopOutlined,
  TeamOutlined,
  SafetyOutlined,
  FileTextOutlined,
  RobotOutlined,
  SwapOutlined,
  HomeOutlined,
} from "@ant-design/icons";
import { permissionsApi } from "../api";

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

interface Role {
  id: number;
  name: string;
  code: string;
  description: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  user_count: number;
}

interface Permission {
  id: number;
  name: string;
  code: string;
  type: string;
  module: string;
  parent_id: number | null;
  selected: boolean;
}

interface User {
  id: number;
  username: string;
  nickname: string;
  email: string;
  status: string;
  roles?: { id: number; name: string }[];
}

const PermissionManagement: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("users");

  // 角色相关状态
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleForm] = Form.useForm();

  // 权限相关状态
  const [permissions, setPermissions] = useState<Record<string, Permission[]>>({});
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);

  // 用户相关状态
  const [usersLoading, setUsersLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [roleUsers, setRoleUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedRoleUserIds, setSelectedRoleUserIds] = useState<number[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  // 初始化数据
  useEffect(() => {
    fetchRoles();
  }, []);

  // 当选中角色变化时，加载相关数据
  useEffect(() => {
    if (selectedRole) {
      fetchRolePermissions(selectedRole.id);
      fetchRoleUsers(selectedRole.id);
      fetchAllUsers();
    }
  }, [selectedRole]);

  // 获取角色列表
  const fetchRoles = async () => {
    setRolesLoading(true);
    try {
      const res = await permissionsApi.getRoles();
      if (res.data.success) {
        setRoles(res.data.data);
        if (res.data.data.length > 0 && !selectedRole) {
          setSelectedRole(res.data.data[0]);
        }
      }
    } catch (error) {
      message.error("获取角色列表失败");
    } finally {
      setRolesLoading(false);
    }
  };

  // 获取角色权限
  const fetchRolePermissions = async (roleId: number) => {
    try {
      const res = await permissionsApi.getRolePermissions(roleId);
      if (res.data.success) {
        setPermissions(res.data.data);
        const selected: number[] = [];
        Object.values(res.data.data).forEach((perms: any) => {
          perms.forEach((p: Permission) => {
            if (p.selected) {
              selected.push(p.id);
            }
          });
        });
        setSelectedPermissions(selected);
      }
    } catch (error) {
      message.error("获取权限列表失败");
    }
  };

  // 获取角色用户
  const fetchRoleUsers = async (roleId: number) => {
    setUsersLoading(true);
    try {
      const res = await permissionsApi.getRoleUsers(roleId);
      if (res.data.success) {
        setRoleUsers(res.data.data);
        setSelectedUserIds(res.data.data.map((u: User) => u.id));
        setPagination({ current: 1, pageSize: 10 }); // 切换角色时重置分页
      }
    } catch (error) {
      message.error("获取角色用户失败");
    } finally {
      setUsersLoading(false);
    }
  };

  // 获取所有用户
  const fetchAllUsers = async () => {
    try {
      const res = await permissionsApi.getAllUsers();
      if (res.data.success) {
        setAllUsers(res.data.data);
      }
    } catch (error) {
      message.error("获取用户列表失败");
    }
  };

  // 创建角色
  const handleCreateRole = () => {
    setEditingRole(null);
    roleForm.resetFields();
    setRoleModalVisible(true);
  };

  // 编辑角色
  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    roleForm.setFieldsValue({
      name: role.name,
      code: role.code,
      description: role.description,
    });
    setRoleModalVisible(true);
  };

  // 保存角色
  const handleSaveRole = async () => {
    try {
      const values = await roleForm.validateFields();
      if (editingRole) {
        await permissionsApi.updateRole(editingRole.id, values);
        message.success("角色更新成功");
      } else {
        await permissionsApi.createRole(values);
        message.success("角色创建成功");
      }
      setRoleModalVisible(false);
      fetchRoles();
    } catch (error: any) {
      message.error(error.response?.data?.detail || "保存失败");
    }
  };

  // 删除角色
  const handleDeleteRole = (role: Role) => {
    Modal.confirm({
      title: "删除角色",
      content: `确定要删除角色"${role.name}"吗？`,
      onOk: async () => {
        try {
          await permissionsApi.deleteRole(role.id);
          message.success("角色删除成功");
          if (selectedRole?.id === role.id) {
            setSelectedRole(null);
          }
          fetchRoles();
        } catch (error: any) {
          message.error(error.response?.data?.detail || "删除失败");
        }
      },
    });
  };

  // 保存权限
  const handleSavePermissions = async () => {
    if (!selectedRole) return;
    setLoading(true);
    try {
      await permissionsApi.updateRolePermissions(selectedRole.id, selectedPermissions);
      message.success("权限保存成功");
      fetchRolePermissions(selectedRole.id);
    } catch (error: any) {
      message.error(error.response?.data?.detail || "保存权限失败");
    } finally {
      setLoading(false);
    }
  };

  // 保存用户
  const handleSaveUsers = async () => {
    if (!selectedRole) return;
    setLoading(true);
    try {
      await permissionsApi.updateRoleUsers(selectedRole.id, selectedUserIds);
      message.success("用户保存成功");
      fetchRoleUsers(selectedRole.id);
      fetchRoles();
    } catch (error: any) {
      message.error(error.response?.data?.detail || "保存用户失败");
    } finally {
      setLoading(false);
    }
  };

  // 移除单个用户
  const handleRemoveUser = async (userId: number) => {
    if (!selectedRole) return;
    const newUserIds = roleUsers.filter(u => u.id !== userId).map(u => u.id);
    setLoading(true);
    try {
      await permissionsApi.updateRoleUsers(selectedRole.id, newUserIds);
      message.success("移除成功");
      fetchRoleUsers(selectedRole.id);
      fetchRoles();
    } catch (error: any) {
      message.error(error.response?.data?.detail || "移除失败");
    } finally {
      setLoading(false);
    }
  };

  // 批量移除用户
  const handleBatchRemoveUsers = async () => {
    if (!selectedRole || selectedRoleUserIds.length === 0) return;
    const newUserIds = roleUsers.filter(u => !selectedRoleUserIds.includes(u.id)).map(u => u.id);
    setLoading(true);
    try {
      await permissionsApi.updateRoleUsers(selectedRole.id, newUserIds);
      message.success("批量移除成功");
      setSelectedRoleUserIds([]);
      fetchRoleUsers(selectedRole.id);
      fetchRoles();
    } catch (error: any) {
      message.error(error.response?.data?.detail || "批量移除失败");
    } finally {
      setLoading(false);
    }
  };

  // 全选/取消全选权限
  const handleSelectAllModulePermissions = (moduleName: string, checked: boolean) => {
    const modulePermissions = permissions[moduleName] || [];
    let newSelected = [...selectedPermissions];
    if (checked) {
      modulePermissions.forEach((p) => {
        if (!newSelected.includes(p.id)) {
          newSelected.push(p.id);
        }
      });
    } else {
      const moduleIds = modulePermissions.map((p) => p.id);
      newSelected = newSelected.filter((id) => !moduleIds.includes(id));
    }
    setSelectedPermissions(newSelected);
  };

  // 检查模块是否全选
  const isModuleAllSelected = (moduleName: string) => {
    const modulePermissions = permissions[moduleName] || [];
    if (modulePermissions.length === 0) return false;
    return modulePermissions.every((p) => selectedPermissions.includes(p.id));
  };

  // 检查模块是否部分选中
  const isModuleIndeterminate = (moduleName: string) => {
    const modulePermissions = permissions[moduleName] || [];
    const selectedCount = modulePermissions.filter((p) => selectedPermissions.includes(p.id)).length;
    return selectedCount > 0 && selectedCount < modulePermissions.length;
  };

  // 模块配置 - 定义每个模块的图标和颜色
  const moduleConfig: Record<string, { icon: React.ReactNode; color: string }> = {
    '产品管理': { icon: <ShoppingOutlined />, color: '#722ed1' },
    '入库管理': { icon: <ArrowDownOutlined />, color: '#52c41a' },
    '出库管理': { icon: <ArrowUpOutlined />, color: '#fa541c' },
    '采购管理': { icon: <TruckOutlined />, color: '#fa8c16' },
    '挪货管理': { icon: <SwapOutlined />, color: '#eb2f96' },
    '仓库管理': { icon: <HomeOutlined />, color: '#fa8c16' },
    '库存管理': { icon: <DatabaseOutlined />, color: '#13c2c2' },
    '店铺管理': { icon: <ShopOutlined />, color: '#2f54eb' },
    '组织管理': { icon: <TeamOutlined />, color: '#eb2f96' },
    '权限管理': { icon: <SafetyOutlined />, color: '#f5222d' },
    '系统管理': { icon: <FileTextOutlined />, color: '#595959' },
    'AI聊天助手': { icon: <RobotOutlined />, color: '#1677ff' },
    '库存机器人': { icon: <DatabaseOutlined />, color: '#13c2c2' },
    '差评机器人': { icon: <RobotOutlined />, color: '#fa8c16' },
  };

  // 计算权限总数
  const totalPermissionsCount = Object.values(permissions).reduce(
    (sum, perms) => sum + perms.length, 0
  );

  // 角色菜单项
  const roleMenuItems = roles.map((role) => ({
    key: role.id.toString(),
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingRight: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role.name}</span>
        </div>
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                label: '编辑',
                icon: <EditOutlined />,
                disabled: role.code === 'admin',
                onClick: (e) => {
                  e.domEvent.stopPropagation();
                  handleEditRole(role);
                }
              },
              {
                key: 'delete',
                label: '删除',
                icon: <DeleteOutlined />,
                style: { color: '#ff4d4f' },
                disabled: role.code === 'admin' || role.user_count > 0,
                onClick: (e) => {
                  e.domEvent.stopPropagation();
                  handleDeleteRole(role);
                }
              }
            ]
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button 
            type="text" 
            size="small" 
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
            style={{ flexShrink: 0 }}
          />
        </Dropdown>
      </div>
    ),
  }));

  return (
    <Layout style={{ height: "100%", background: "#fff" }}>
      {/* 左侧角色列表 */}
      <Sider width={260} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Title level={3} style={{ margin: 0, whiteSpace: 'nowrap' }}>角色</Title>
          <div style={{ flex: 1 }}></div>
          <Space>
            <Tooltip title="补充新权限">
              <Button 
                type="text" 
                icon={<SafetyOutlined />} 
                onClick={async () => {
                  try {
                    const res = await permissionsApi.addMissingPermissions()
                    if (res.data.success) {
                      message.success(res.data.message)
                      fetchRoles()
                      if (selectedRole) {
                        fetchRolePermissions(selectedRole.id)
                      }
                    }
                  } catch {
                    message.error('补充权限失败')
                  }
                }}
              />
            </Tooltip>
            <Tooltip title="新增角色">
              <Button type="text" icon={<PlusOutlined />} onClick={handleCreateRole} />
            </Tooltip>
          </Space>
        </div>
        <div className="p-2">
          <Input.Search placeholder="搜索角色" allowClear style={{ marginBottom: 16 }} />
          {rolesLoading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
          ) : (
            <Menu
              mode="inline"
              selectedKeys={selectedRole ? [selectedRole.id.toString()] : []}
              onSelect={({ key }) => {
                const role = roles.find((r) => r.id === parseInt(key));
                if (role) setSelectedRole(role);
              }}
              items={roleMenuItems}
            />
          )}
        </div>
      </Sider>

      {/* 右侧内容区 */}
      <Content className="p-0">
        {selectedRole ? (
          <div style={{ height: '100%' }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              style={{ paddingLeft: '40px' }}
              items={[
                {
                  key: "users",
                  label: (
                    <span>
                      <UserOutlined />
                      角色用户
                    </span>
                  ),
                  children: (
                    <div style={{ padding: '24px', height: 'calc(100% - 64px)', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
                        <Button
                          type="primary"
                          icon={<UserAddOutlined />}
                          onClick={() => {
                            setSelectedUserIds(roleUsers.map(u => u.id));
                            setShowTransferModal(true);
                          }}
                        >
                          添加用户
                        </Button>
                        {selectedRoleUserIds.length > 0 && (
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => {
                              Modal.confirm({
                                title: '批量移除用户',
                                content: `确定要移除选中的 ${selectedRoleUserIds.length} 个用户吗？`,
                                onOk: handleBatchRemoveUsers,
                              });
                            }}
                            loading={loading}
                          >
                            批量移除 ({selectedRoleUserIds.length})
                          </Button>
                        )}
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <Table
                          dataSource={roleUsers.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize)}
                          loading={usersLoading}
                          rowKey="id"
                          scroll={{ x: 'max-content' }}
                          pagination={false}
                          rowSelection={{
                            selectedRowKeys: selectedRoleUserIds,
                            onChange: (keys) => setSelectedRoleUserIds(keys as number[]),
                          }}
                          columns={[
                            {
                              title: '用户名',
                              dataIndex: 'username',
                              key: 'username',
                            },
                            {
                              title: '姓名',
                              dataIndex: 'nickname',
                              key: 'nickname',
                            },
                            {
                              title: '邮箱',
                              dataIndex: 'email',
                              key: 'email',
                            },
                            {
                              title: '操作',
                              key: 'action',
                              render: (_, record) => (
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={() => {
                                    Modal.confirm({
                                      title: '移除用户',
                                      content: `确定要将用户"${record.nickname || record.username}"从当前角色中移除吗？`,
                                      onOk: () => handleRemoveUser(record.id),
                                    });
                                  }}
                                >
                                  移除
                                </Button>
                              ),
                              width: 100,
                            },
                          ]}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
                        <Pagination
                          current={pagination.current}
                          pageSize={pagination.pageSize}
                          total={roleUsers.length}
                          pageSizeOptions={['10', '20', '50', '100']}
                          showSizeChanger
                          showQuickJumper
                          showTotal={(total) => `共 ${total} 个用户`}
                          onChange={(page, size) => {
                            setPagination({ current: page, pageSize: size || 10 });
                            setSelectedRoleUserIds([]); // 切换页码时清空选中
                          }}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  key: "permissions",
                  label: (
                    <span>
                      <KeyOutlined />
                      功能权限
                    </span>
                  ),
                  children: (
                    <div style={{ padding: '24px', height: 'calc(100vh - 200px)', overflowY: 'auto' }}>
                      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 14, color: '#666' }}>
                            已选 <strong style={{ color: '#1890ff' }}>{selectedPermissions.length}</strong> / {totalPermissionsCount} 项权限
                          </span>
                          <Button size="small" onClick={() => setSelectedPermissions([])}>取消全选</Button>
                          <Button size="small" onClick={() => {
                            const allIds: number[] = [];
                            Object.values(permissions).forEach(perms => perms.forEach(p => allIds.push(p.id)));
                            setSelectedPermissions(allIds);
                          }}>全选</Button>
                        </div>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          onClick={handleSavePermissions}
                          loading={loading}
                        >
                          保存权限
                        </Button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
                        {Object.entries(moduleConfig).map(([moduleName, config]) => {
                          const modulePerms = permissions[moduleName];
                          if (!modulePerms || modulePerms.length === 0) return null;
                          const allSelected = isModuleAllSelected(moduleName);
                          const indeterminate = isModuleIndeterminate(moduleName);
                          const selectedCount = modulePerms.filter(p => selectedPermissions.includes(p.id)).length;
                          const headerBg = allSelected ? `${config.color}08` : '#fafafa';
                          return (
                            <div
                              key={moduleName}
                              style={{
                                border: allSelected ? `1px solid ${config.color}40` : '1px solid #e8e8e8',
                                borderRadius: 8,
                                overflow: 'hidden',
                                background: '#fff',
                                transition: 'box-shadow 0.2s, border-color 0.2s',
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                            >
                              <div style={{
                                padding: '12px 16px',
                                background: headerBg,
                                borderBottom: '1px solid #f0f0f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 18, color: config.color }}>
                                    {config.icon}
                                  </span>
                                  <span style={{ fontWeight: 600, fontSize: 15 }}>{moduleName}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 12, color: '#999' }}>
                                    {selectedCount}/{modulePerms.length}
                                  </span>
                                  <Checkbox
                                    checked={allSelected}
                                    indeterminate={indeterminate}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      handleSelectAllModulePermissions(moduleName, e.target.checked);
                                    }}
                                  />
                                </div>
                              </div>
                              <div style={{ padding: '8px 16px 12px' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {modulePerms.map(perm => {
                                    const isChecked = selectedPermissions.includes(perm.id);
                                    return (
                                      <Checkbox
                                        key={perm.id}
                                        checked={isChecked}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          if (e.target.checked) {
                                            setSelectedPermissions(prev => [...prev, perm.id]);
                                          } else {
                                            setSelectedPermissions(prev => prev.filter(id => id !== perm.id));
                                          }
                                        }}
                                        style={{
                                          marginRight: 0,
                                          padding: '4px 10px',
                                          borderRadius: 4,
                                          border: isChecked ? `1px solid ${config.color}60` : '1px solid transparent',
                                          background: isChecked ? `${config.color}10` : 'transparent',
                                          transition: 'all 0.2s',
                                        }}
                                      >
                                        {perm.name}
                                      </Checkbox>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <Empty
              description="请选择或创建一个角色"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Button type="primary" onClick={handleCreateRole}>
                新增角色
              </Button>
            </Empty>
          </div>
        )}
      </Content>

      {/* 角色编辑弹窗 */}
      <Modal
        title={editingRole ? "编辑角色" : "新增角色"}
        open={roleModalVisible}
        onOk={handleSaveRole}
        onCancel={() => setRoleModalVisible(false)}
        okText="确定"
        cancelText="取消"
        confirmLoading={loading}
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: "请输入角色名称" }]}
          >
            <Input placeholder="请输入角色名称" disabled={editingRole?.code === 'admin'} />
          </Form.Item>
          <Form.Item
            name="code"
            label="角色编码"
            rules={[{ required: true, message: "请输入角色编码" }]}
          >
            <Input placeholder="请输入角色编码" disabled={!!editingRole} />
          </Form.Item>
          <Form.Item
            name="description"
            label="角色描述"
          >
            <Input.TextArea rows={3} placeholder="请输入角色描述" disabled={editingRole?.code === 'admin'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 穿梭框添加用户弹窗 */}
      <Modal
        title="添加用户"
        open={showTransferModal}
        onOk={async () => {
          await handleSaveUsers();
          setShowTransferModal(false);
        }}
        onCancel={() => setShowTransferModal(false)}
        okText="确定"
        cancelText="取消"
        confirmLoading={loading}
        width={900}
      >
        <Transfer
          dataSource={allUsers
            // 过滤掉已经有其他角色的用户（当前角色的用户除外）
            .filter(user => {
              const hasOtherRole = user.roles && user.roles.length > 0 && 
                user.roles.some(r => r.id !== selectedRole?.id);
              const isCurrentRoleUser = roleUsers.some(ru => ru.id === user.id);
              return !hasOtherRole || isCurrentRoleUser;
            })
            .map(user => ({
              key: user.id,
              title: user.username,
              description: user.nickname || user.email,
              roles: user.roles,
              disabled: user.roles && user.roles.length > 0 && 
                user.roles.some(r => r.id !== selectedRole?.id)
            }))}
          titles={['可用用户', '已选用户']}
          targetKeys={selectedUserIds}
          onChange={(targetKeys) => setSelectedUserIds(targetKeys as number[])}
          render={(item) => (
            <Space>
              <span>{item.title}</span>
              <Text type="secondary">{item.description}</Text>
              {item.roles && item.roles.length > 0 && (
                <Space size={[4, 0]} wrap>
                  {item.roles.map((r: any) => (
                    r.id !== selectedRole?.id && <Tag key={r.id} color="orange" style={{ fontSize: '12px', lineHeight: '18px' }}>已属于: {r.name}</Tag>
                  ))}
                </Space>
              )}
            </Space>
          )}
          listStyle={{
            width: 380,
            height: 400,
          }}
        />
      </Modal>
    </Layout>
  );
};

export default PermissionManagement;
