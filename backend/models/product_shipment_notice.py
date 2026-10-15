from sqlalchemy import Column, Integer, String, Date, Index
from models.base import BaseModel


class ProductShipmentNotice(BaseModel):
    """货件通知表"""
    __tablename__ = "product_shipment_notice"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    date = Column(Date, nullable=False, index=True, comment="日期")
    store = Column(String(100), nullable=False, index=True, comment="店铺")
    shipment_code = Column(String(100), nullable=False, comment="货件编码")
    status = Column(String(50), nullable=True, comment="状态")

    __table_args__ = (
        Index('ix_psn_date_store_code', 'date', 'store', 'shipment_code'),
    )
