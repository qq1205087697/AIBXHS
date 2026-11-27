from sqlalchemy import Column, Integer, String, Date, DECIMAL, Index, JSON
from models.base import BaseModel


class FinanceTemplate(BaseModel):
    """财务机器人登记模板：一个模板 = 某一级分类下选定的若干二级分类，批量登记时逐项填金额"""
    __tablename__ = "finance_templates"

    id = Column(Integer, primary_key=True, index=True, comment="模板ID")
    tenant_id = Column(Integer, nullable=False, comment="租户ID")
    name = Column(String(50), nullable=False, comment="模板名称")
    category_id = Column(Integer, nullable=False, comment="所属一级分类ID")
    items = Column(JSON, nullable=True, comment="二级分类ID列表（按显示顺序）")

    __table_args__ = (
        Index("idx_finance_tpl_tenant_cat", "tenant_id", "category_id"),
    )


class FinanceCategory(BaseModel):
    """财务机器人分类表：一级分类（板块）与二级分类共用，parent_id 为空即一级"""
    __tablename__ = "finance_categories"

    id = Column(Integer, primary_key=True, index=True, comment="分类ID")
    tenant_id = Column(Integer, nullable=False, comment="租户ID")
    parent_id = Column(Integer, nullable=True, comment="父级分类ID，NULL=一级分类")
    name = Column(String(50), nullable=False, comment="分类名称")
    sort = Column(Integer, nullable=True, default=0, comment="排序号")
    is_system = Column(Integer, nullable=True, default=1, comment="是否内置分类：1=系统内置")
    remark = Column(String(200), nullable=True, comment="备注说明")
    icon = Column(String(50), nullable=True, comment="图标名（一级分类用）")
    color = Column(String(20), nullable=True, comment="显示色（一级分类用）")

    __table_args__ = (
        Index("idx_finance_cat_tenant_parent", "tenant_id", "parent_id"),
    )


class FinanceRecord(BaseModel):
    """财务机器人流水表，记录各费用板块的收支明细（按租户隔离）"""
    __tablename__ = "finance_records"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, nullable=False, comment="租户ID")
    category = Column(String(20), nullable=False, comment="一级分类名称（冗余文本，兼容旧数据）")
    category_id = Column(Integer, nullable=True, comment="一级分类ID，关联 finance_categories.id")
    sub_category_id = Column(Integer, nullable=True, comment="二级分类ID，关联 finance_categories.id")
    flow_type = Column(String(10), nullable=False, comment="收支类型：收入/支出")
    record_date = Column(Date, nullable=False, comment="业务发生日期")
    amount = Column(DECIMAL(14, 2), nullable=False, comment="金额")
    description = Column(String(200), nullable=True, comment="摘要说明")
    created_by = Column(String(50), nullable=True, comment="登记人")

    __table_args__ = (
        Index("idx_finance_tenant_category", "tenant_id", "category"),
        Index("idx_finance_record_date", "record_date"),
    )
