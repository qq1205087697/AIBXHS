from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship
from models.base import BaseModel


class DataWarning(BaseModel):
    """数据预警表"""
    __tablename__ = "data_warnings"
    
    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    date = Column(Date, nullable=False, index=True, comment="日期")
    store = Column(String(100), nullable=False, index=True, comment="店铺")
    order_count = Column(Integer, nullable=False, comment="订单量")
    ad_ratio = Column(Float, nullable=False, comment="广告占比")
    acos = Column(Float, nullable=False, comment="ACOS")
    cargo_value = Column(Float, nullable=False, comment="货值")
    gmv = Column(Float, nullable=False, server_default="0", comment="GMV")
    ad_spend = Column(Float, nullable=False, server_default="0", comment="广告费用")
    storage_fee = Column(Float, nullable=False, server_default="0", comment="仓储费用")
    sales_amount = Column(Float, nullable=False, server_default="0", comment="利润报表销售额")
    fba_total_stock = Column(Integer, nullable=True, comment="FBA总库存")
    storage_ratio = Column(Float, nullable=True, comment="仓储占比")
    gross_profit = Column(Float, nullable=True, comment="毛利润")
    
    # 关联关系
    tenant = relationship("Tenant", back_populates="data_warnings")
