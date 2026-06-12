from sqlalchemy import Column, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from models.base import BaseModel


class ProductBinding(BaseModel):
    """成品配件绑定关系模型"""
    __tablename__ = "product_bindings"

    id = Column(Integer, primary_key=True, index=True, comment="绑定ID")
    finished_product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="成品ID")
    accessory_product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True, comment="配件ID")
    quantity = Column(Integer, nullable=False, default=1, comment="配件数量")
    created_at = Column(DateTime, nullable=False, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, comment="更新时间")
    deleted_at = Column(DateTime, nullable=True, comment="删除时间")

    __table_args__ = (
        {'mysql_engine': 'InnoDB'}
    )