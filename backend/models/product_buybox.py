from sqlalchemy import Column, Integer, String, Date, Index
from models.base import BaseModel


class ProductBuybox(BaseModel):
    """商品购物车（BuyBox）状态表"""
    __tablename__ = "product_buybox"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    date = Column(Date, nullable=False, index=True, comment="日期")
    sku = Column(String(200), nullable=False, index=True, comment="SKU")
    product_name = Column(String(500), nullable=True, comment="品名")
    store = Column(String(100), nullable=False, index=True, comment="店铺")
    status = Column(String(50), nullable=True, comment="状态")

    __table_args__ = (
        Index('ix_pbb_date_store_sku', 'date', 'store', 'sku'),
    )
