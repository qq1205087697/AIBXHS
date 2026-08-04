from sqlalchemy import Column, DateTime, Boolean
from sqlalchemy.sql import func
from database.database import Base


class BaseModel(Base):
    """基础模型"""
    __abstract__ = True
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, comment="创建时间")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, comment="更新时间")
    deleted_at = Column(DateTime(timezone=True), nullable=True, comment="删除时间")
