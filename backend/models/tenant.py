from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from models.base import BaseModel


class Tenant(BaseModel):
    """租户模型"""
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="租户名称")
    code = Column(String(50), unique=True, nullable=False, index=True, comment="租户编码")
    status = Column(String(20), default="active", comment="状态")
    created_at = Column(DateTime, default=None, comment="创建时间")

    # 关联关系
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    stores = relationship("Store", back_populates="tenant", cascade="all, delete-orphan")
    products = relationship("Product", back_populates="tenant", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="tenant", cascade="all, delete-orphan")
