from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database.database import Base


class Tenant(Base):
    """租户模型"""
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True, comment="租户ID")
    name = Column(String(255), comment="租户名称")
    code = Column(String(100), unique=True, index=True, comment="租户编码")
    status = Column(String(20), default="active", comment="状态")
    created_at = Column(DateTime, default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), comment="更新时间")
    deleted_at = Column(DateTime, nullable=True, comment="删除时间")

    # 关联关系
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    stores = relationship("Store", back_populates="tenant", cascade="all, delete-orphan")
    products = relationship("Product", back_populates="tenant", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="tenant", cascade="all, delete-orphan")
    departments = relationship("Department", back_populates="tenant", cascade="all, delete-orphan")
