"""广告产品信息表模型（ad_product_info）

2026-10-14 已完成表结构标准化：英文列名（COMMENT 保留原中文名）、
自增 id 主键 + record_id 业务唯一副键 + tenant_id + 通用时间戳字段。
开发机器人（ProductDevelopmentBot）以该表为数据源做增删改查。
"""
from sqlalchemy import Column, String, Text, LargeBinary, Float, Integer, UniqueConstraint

from models.base import BaseModel


class AdProductInfo(BaseModel):
    __tablename__ = "ad_product_info"
    __table_args__ = (
        UniqueConstraint("tenant_id", "record_id", name="uk_adp_tenant_record"),
        {"comment": "广告产品信息表（原飞书多维表产品库同步）"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    tenant_id = Column(Integer, nullable=False, default=1, comment="租户ID")
    record_id = Column(String(255), nullable=False, comment="记录ID（飞书多维表记录ID，业务副键）")
    product_code = Column(String(50), comment="产品编码")
    title_en = Column(Text, comment="英文标题")
    keywords_en = Column(Text, comment="英文标题关键词+关键词")
    product_name_zh = Column(String(255), comment="产品中文名称")
    purchase_images = Column(LargeBinary, comment="采购图片（逗号分隔的URL/文件名）")
    category = Column(String(255), comment="商品类目")
    developer = Column(String(255), comment="开发人员")
    related_store = Column(String(255), comment="关联产品管理里的店铺")
    purchase_links = Column(Text, comment="采购链接（多行，一行一个URL）")
    purchase_info = Column(Text, comment="采购信息")
    urgency = Column(String(255), comment="产品紧急程度")
    seasonality = Column(String(255), comment="产品季节性")
    competitors = Column(String(255), comment="竞品ASIN")
    purchase_cost = Column(Float, comment="进货成本价格（采购填）")
    purchased = Column(String(20), default="未采购", comment="是否采购：未采购/已采购")
    purchase_note = Column(String(500), comment="采购备注（采购填）")
    warehouse_note = Column(String(500), comment="仓库备注（仓库填）")
    site_owners = Column(String(255), comment="相关站点负责人员（数据可见性）")
    six_face_image = Column(LargeBinary, comment="欧洲六面图（仓库上传，URL文本）")
    designer_image = Column(LargeBinary, comment="产品图片（美工上传，URL文本）")
    designer_assignee = Column(String(255), comment="美工分配人员")
    designer_complete_date = Column(String(255), comment="美工完成图片日期（自动生成）")
    image_review = Column(String(255), comment="图片审核结果（管理层）：已通过/不通过请看评论")
    de_title = Column(Text, comment="德语标题")
    de_keywords = Column(Text, comment="德语关键词")
    purchase_date = Column(String(255), comment="记录日期（YYYY-MM-DD）")
    doc_name = Column(String(255), comment="产品开发文档标题")
    doc_link = Column(String(255), comment="飞书文档链接")
