from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship
from models.base import BaseModel


class ThresholdSetting(BaseModel):
    """预警阈值设置表"""
    __tablename__ = "threshold_settings"
    
    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    store = Column(String(100), nullable=False, unique=True, index=True, comment="店铺名")
    ad_ratio_threshold = Column(Float, nullable=False, server_default="25.0", comment="广告占比阈值(%)")
    storage_ratio_threshold = Column(Float, nullable=False, server_default="10.0", comment="仓储占比阈值(%)")
    acos_threshold = Column(Float, nullable=False, server_default="30.0", comment="ACOS阈值(%)")
    
    tenant = relationship("Tenant")
