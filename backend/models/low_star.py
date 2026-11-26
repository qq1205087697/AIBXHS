from sqlalchemy import Column, Integer, String, Float, DateTime, Index
from models.base import BaseModel


class LowStarListing(BaseModel):
    """低分产品统计明细（按租户隔离，数据由领星 Listing 同步写入）"""

    __tablename__ = "low_star_listings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")
    sid = Column(Integer, nullable=False, index=True, comment="店铺ID")
    store_name = Column(String(200), nullable=True, comment="店铺名")
    seller_sku = Column(String(200), nullable=False, comment="MSKU")
    asin = Column(String(50), nullable=True, index=True, comment="ASIN")
    last_star = Column(Float, nullable=True, comment="Listing 评分")
    price = Column(Float, nullable=True, comment="价格")
    currency_code = Column(String(10), nullable=True, comment="币种")
    status = Column(Integer, nullable=True, comment="状态：1在售 / 0停售")
    item_name = Column(String(1000), nullable=True, comment="产品标题")

    __table_args__ = (
        Index("idx_low_star_tenant_sid", "tenant_id", "sid"),
        Index("idx_low_star_tenant_sku", "tenant_id", "seller_sku"),
    )


class LowStarSnapshot(BaseModel):
    """低分产品统计快照元信息（每个租户一条）"""

    __tablename__ = "low_star_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, nullable=False, unique=True, index=True, comment="租户ID")
    generated_at = Column(DateTime, nullable=True, comment="统计时间")
    threshold = Column(String(50), nullable=True, comment="评分阈值说明")
    scanned_total = Column(Integer, nullable=True, comment="扫描 Listing 总数")
