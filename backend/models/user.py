from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from models.base import BaseModel


class User(BaseModel):
    """用户模型"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, comment="用户ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    username = Column(String(100), nullable=False, comment="用户名")
    email = Column(String(255), nullable=True, comment="邮箱")
    password_hash = Column(String(255), nullable=False, comment="密码哈希")
    nickname = Column(String(100), nullable=True, comment="昵称")
    role = Column(String(20), default="operator", comment="角色")
    status = Column(String(20), default="active", index=True, comment="状态")
    created_at = Column(DateTime, default=None, comment="创建时间")

    # 关联关系
    tenant = relationship("Tenant", back_populates="users")
