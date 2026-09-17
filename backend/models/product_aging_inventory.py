from sqlalchemy import Column, Integer, String, Date, Index
from models.base import BaseModel


class ProductAgingInventory(BaseModel):
    """商品超库龄库存表"""
    __tablename__ = "product_aging_inventory"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    date = Column(Date, nullable=False, index=True, comment="日期")
    store = Column(String(100), nullable=False, index=True, comment="店铺")
    sku = Column(String(200), nullable=False, index=True, comment="SKU")
    aging_181_270 = Column(Integer, nullable=True, default=0, comment="库龄181-270天数量")
    aging_271_365 = Column(Integer, nullable=True, default=0, comment="库龄271-365天数量")
    aging_366_455 = Column(Integer, nullable=True, default=0, comment="库龄366-455天数量")
    aging_456_plus = Column(Integer, nullable=True, default=0, comment="库龄456天以上数量")

    __table_args__ = (
        Index('ix_pai_date_store_sku', 'date', 'store', 'sku'),
    )
