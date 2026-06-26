from sqlalchemy import Column, Integer, String, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from models.base import BaseModel


class Role(BaseModel):
    """角色模型"""
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True, comment="角色ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="角色名称")
    code = Column(String(50), nullable=False, comment="角色编码")
    description = Column(Text, nullable=True, comment="角色描述")
    is_system = Column(Boolean, default=False, comment="是否系统内置角色")
    sort_order = Column(Integer, default=0, comment="排序")

    # 关联关系
    tenant = relationship("Tenant", back_populates="roles")
    role_permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    users = relationship("User", back_populates="role_ref", foreign_keys="User.role_id")

    __table_args__ = (
        UniqueConstraint('tenant_id', 'code', name='uix_tenant_role_code'),
    )


class Permission(BaseModel):
    """权限模型"""
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True, comment="权限ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="权限名称")
    code = Column(String(100), nullable=False, comment="权限编码")
    type = Column(String(20), nullable=False, default="function", comment="权限类型：function/field/data")
    module = Column(String(50), nullable=True, comment="所属模块")
    parent_id = Column(Integer, nullable=True, comment="父权限ID")
    description = Column(Text, nullable=True, comment="权限描述")
    sort_order = Column(Integer, default=0, comment="排序")

    # 关联关系
    tenant = relationship("Tenant", back_populates="permissions")
    role_permissions = relationship("RolePermission", back_populates="permission", cascade="all, delete-orphan")


class RolePermission(BaseModel):
    """角色权限关联模型"""
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True, comment="ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True, comment="角色ID")
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=False, index=True, comment="权限ID")

    # 关联关系
    tenant = relationship("Tenant")
    role = relationship("Role", back_populates="role_permissions")
    permission = relationship("Permission", back_populates="role_permissions")

    __table_args__ = (
        UniqueConstraint('tenant_id', 'role_id', 'permission_id', name='uix_tenant_role_permission'),
    )



