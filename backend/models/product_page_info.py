from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.orm import relationship
from models.base import BaseModel


class ProductPageInfo(BaseModel):
    """产品页面信息模型 - 评分优化（对应数据库 product_page_info 表）"""
    __tablename__ = "product_page_info"

    id = Column(Integer, primary_key=True, index=True, comment="ID")
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")

    sku = Column(String(50), nullable=False, comment="SKU")
    asin = Column(String(20), nullable=False, comment="ASIN")
    store = Column(String(100), nullable=False, comment="店铺")
    title = Column(String(500), nullable=False, comment="标题")
    keywords = Column(Text, nullable=False, comment="关键词")
    product_description = Column(Text, nullable=True, comment="产品描述")
    bullet_points = Column(Text, nullable=True, comment="五点描述")
    price = Column(String(50), nullable=False, comment="价格")
    image_count = Column(Integer, default=0, comment="图片数")

    # 评分字段（数据库中为 varchar 类型）
    title_rating = Column(String(20), nullable=True, comment="标题评分")
    description_rating = Column(String(20), nullable=True, comment="描述评分")
    keywords_rating = Column(String(20), nullable=True, comment="冠军词/关键词评分")
    image_rating = Column(String(20), nullable=True, comment="图片评分")

    # 其他字段
    has_ad = Column(Boolean, default=False, comment="是否有广告")
    has_aplus = Column(Boolean, default=False, comment="是否有A+页面")
    has_video = Column(Boolean, default=False, comment="是否有视频")