from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, Index
from models.base import BaseModel


class ProductSalesGrade(BaseModel):
    """产品月销量等级池（每月 3 号按上月销量定版，行级 (asin, account) 逐行评级）

    口径见 docs/plans/2026-11-24_产品月销量等级体系_完整实现方案.md：
    - period = 销量所属自然月（YYYY-MM），每月 3 号计算上个自然月
    - 普通行/共享子行：三级归属（product_sales 精确认领 → 站点映射认领 → 行级 sales_30d 折算）
    - 父汇总行（summary_flag='是'）：合并口径 = 该 ASIN 全部 product_sales 销量合计
    - 不放进 inventory_snapshots：Excel 导入会覆盖快照列（FIELD_MAPPING 铁律）
    """
    __tablename__ = "product_sales_grades"

    id = Column(Integer, primary_key=True, index=True, comment="主键ID")
    tenant_id = Column(Integer, default=1, index=True, comment="租户ID")
    period = Column(String(7), nullable=False, comment="销量所属月份 YYYY-MM")
    asin = Column(String(100), nullable=False, comment="ASIN")
    # 快照行 account 原值（父汇总行为「店A、店B、店C」拼接串）
    account = Column(String(500), nullable=False, default="", comment="店铺（快照行 account 原值）")
    grade = Column(String(1), nullable=False, comment="等级 S/A/B/C/D/E（父行=合并口径）")
    monthly_sales = Column(Integer, nullable=False, default=0, comment="行级月销量（父行=ASIN合计）")
    # product_sales / fallback_30d / no_data
    sales_source = Column(String(20), nullable=False, default="product_sales", comment="销量口径来源")
    grade_rule_version = Column(String(10), nullable=False, default="v1", comment="规则版本号")
    prev_grade = Column(String(1), nullable=True, comment="上期等级（计算时快照）")
    computed_at = Column(DateTime, nullable=False, comment="本次计算时间")
    computed_by = Column(String(50), nullable=False, default="scheduler", comment="scheduler / manual:用户名")

    __table_args__ = (
        UniqueConstraint("tenant_id", "period", "asin", "account",
                         name="uk_grades_period_asin_account"),
        Index("idx_grades_asin_account", "tenant_id", "asin", "account"),
        Index("idx_grades_period_grade", "tenant_id", "period", "grade"),
        {"mysql_engine": "InnoDB"},
    )
