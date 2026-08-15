from sqlalchemy import Column, Integer, String, Date, ForeignKey
from sqlalchemy.orm import relationship
from models.base import BaseModel


class ProductSales(BaseModel):
    """商品销量表"""
    __tablename__ = "product_sales"
    
    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    date = Column(Date, nullable=False, index=True, comment="日期")
    store = Column(String(100), nullable=False, index=True, comment="店铺名")
    sku = Column(String(200), nullable=False, index=True, comment="商品SKU")
    sales_count = Column(Integer, nullable=False, server_default="0", comment="商品销量数")
    
    tenant = relationship("Tenant", back_populates="product_sales")
