from sqlalchemy import Column, Integer, String, DECIMAL, Float, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from models.base import BaseModel


class ProductSelection(BaseModel):
    __tablename__ = "product_selections"

    id = Column(Integer, primary_key=True, index=True, comment="选品ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")

    product_title = Column(String(500), nullable=False, comment="产品标题")
    url = Column(String(1000), nullable=True, comment="URL")
    asin = Column(String(50), nullable=True, index=True, comment="ASIN")
    image_url = Column(String(1000), nullable=True, comment="图片链接")
    rating = Column(Float, nullable=True, comment="评分")
    review_count = Column(Integer, nullable=True, comment="评论数")
    keywords = Column(String(500), nullable=True, comment="关键词")
    price = Column(DECIMAL(12, 2), nullable=True, comment="价格")
    commission = Column(DECIMAL(12, 2), nullable=True, comment="佣金")
    first_leg_cost = Column(DECIMAL(12, 2), nullable=True, comment="头程")
    last_mile_cost = Column(DECIMAL(12, 2), nullable=True, comment="尾程")
    weight_kg = Column(Float, nullable=True, comment="重量(kg)")
    cost_at_15_profit = Column(DECIMAL(12, 2), nullable=True, comment="15%毛利时成本")
    product_type = Column(String(100), nullable=True, comment="类型")
    monthly_sales = Column(Integer, nullable=True, comment="近一个月销量")
    traffic_trend = Column(String(200), nullable=True, comment="流量趋势")

    seasonality = Column(Text, nullable=True, comment="季节性判断")
    infringement_analysis = Column(Text, nullable=True, comment="侵权分析")
    infringement_conclusion = Column(String(500), nullable=True, comment="侵权分析结论")
    traffic_score_result = Column(String(500), nullable=True, comment="流量评分结果")
    traffic_score = Column(Float, nullable=True, comment="流量评分")
    sales_score = Column(Float, nullable=True, comment="销量评分")
    rating_score = Column(Float, nullable=True, comment="星级评分")
    penalty_factor = Column(Float, nullable=True, comment="惩罚因子")
    composite_score = Column(Float, nullable=True, comment="综合评分")

    ai_raw_response = Column(Text, nullable=True, comment="AI原始返回")

    tenant = relationship("Tenant", back_populates="product_selections")

    __table_args__ = (
        {'mysql_engine': 'InnoDB'}
    )