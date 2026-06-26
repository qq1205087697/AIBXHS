from sqlalchemy import Column, Integer, DateTime, func
from database.database import Base


class BaseModel(Base):
    """模型基类，提供公共字段"""
    __abstract__ = True

    created_at = Column(DateTime, default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), comment="更新时间")