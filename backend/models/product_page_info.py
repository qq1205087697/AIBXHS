from sqlalchemy import Column, Integer, String, Text, Boolean, Float, DateTime, Index
from sqlalchemy.orm import relationship
from models.base import BaseModel


class ProductPageInfo(BaseModel):
    """产品页面信息模型 - 评分优化（对应数据库 product_page_info 表）"""
    __tablename__ = "product_page_info"
    __table_args__ = (
        Index('idx_tenant_rating_status', 'tenant_id', 'rating_status'),  # 复合索引优化筛选查询
    )

    id = Column(Integer, primary_key=True, index=True, comment="ID")
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")

    sku = Column(String(50), nullable=False, comment="SKU")
    asin = Column(String(20), nullable=True, comment="ASIN")
    product_name = Column(String(500), nullable=True, comment="品名")
    store = Column(String(100), nullable=False, comment="店铺")
    title = Column(String(500), nullable=True, comment="标题")
    keywords = Column(Text, nullable=True, comment="关键词")
    product_description = Column(Text, nullable=True, comment="产品描述")
    bullet_points = Column(Text, nullable=True, comment="五点描述")
    price = Column(String(50), nullable=True, comment="价格")
    image_count = Column(Integer, default=0, comment="图片数")

    # 评分字段（数据库中为 varchar 类型，各项满分10分）
    title_rating = Column(String(20), nullable=True, comment="标题评分")
    description_rating = Column(String(20), nullable=True, comment="五点描述评分")
    keywords_rating = Column(String(20), nullable=True, comment="关键词评分")
    image_rating = Column(String(20), nullable=True, comment="图片评分")
    product_description_rating = Column(String(20), nullable=True, comment="产品描述评分")
    star = Column(String(20), nullable=True, comment="星级")
    star_rating = Column(String(20), nullable=True, comment="星级评分（得分）")
    ad_rating = Column(String(20), nullable=True, comment="广告评分")
    aplus_rating = Column(String(20), nullable=True, comment="A+评分")
    video_rating = Column(String(20), nullable=True, comment="视频评分")
    listing_suggestions = Column(Text, nullable=True, comment="产品建议")
    competitor_price = Column(Text, nullable=True, comment="竞品价格")

    # 其他字段
    has_ad = Column(Integer, default=0, comment="广告数量")
    has_aplus = Column(Integer, default=0, comment="A+页面等级 0=无 1=有 2=高级")
    has_video = Column(Boolean, default=False, comment="是否有视频")
    rating_status = Column(Integer, default=0, comment="评分状态 0=未评分 1=已评分")
    traffic_keywords = Column(String(2000), nullable=True, comment="参考流量词")