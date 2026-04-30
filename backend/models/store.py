from sqlalchemy import Column, Integer, String, Enum, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from models.base import BaseModel
import enum


class Platform(str, enum.Enum):
    AMAZON = "amazon"
    SHOPEE = "shopee"
    LAZADA = "lazada"
    TIKTOK = "tiktok"
    OTHER = "other"


class StoreStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"


class SyncStatus(str, enum.Enum):
    IDLE = "idle"
    SYNCING = "syncing"
    FAILED = "failed"


class Store(BaseModel):
    """店铺模型"""
    __tablename__ = "stores"
    
    id = Column(Integer, primary_key=True, index=True, comment="店铺ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="店铺名称")
    platform = Column(Enum(Platform), nullable=False, index=True, comment="平台")
    platform_store_id = Column(String(100), nullable=True, comment="平台店铺ID")
    site = Column(String(20), nullable=True, comment="站点(US/UK/CA等)")
    marketplace_id = Column(String(50), nullable=True, comment="市场ID")
    api_key = Column(String(500), nullable=True, comment="API密钥(加密)")
    api_secret = Column(String(500), nullable=True, comment="API密钥(加密)")
    api_token = Column(String(500), nullable=True, comment="API令牌(加密)")
    status = Column(Enum(StoreStatus), default=StoreStatus.ACTIVE, index=True, comment="状态")
    sync_status = Column(Enum(SyncStatus), default=SyncStatus.IDLE, comment="同步状态")
    last_synced_at = Column(DateTime, nullable=True, comment="最后同步时间")
    config = Column(JSON, nullable=True, comment="店铺配置")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人")
    
    # 关联关系
    tenant = relationship("Tenant", back_populates="stores")
    products = relationship("Product", back_populates="store", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="store", cascade="all, delete-orphan")
