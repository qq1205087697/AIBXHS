from sqlalchemy import Column, Integer, String, BigInteger, DECIMAL, Date, ForeignKey, Text, DateTime
from sqlalchemy.orm import relationship
from models.base import BaseModel


class AdReportSnapshot(BaseModel):
    """广告报表快照 - Excel导入主表
    参考 InventorySnapshot 的设计，存储多类型广告报告数据
    每条记录对应报告中的一行数据
    """
    __tablename__ = "ad_report_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    # 店铺关联
    account = Column(String(100), index=True, comment="店铺名（对应 stores.inventory_name）")
    country = Column(String(50), index=True, comment="国家")

    # 日期
    date = Column(Date, index=True, comment="报告日期")

    # 广告层级
    campaign_name = Column(String(255), index=True, comment="广告活动名称")
    ad_group_name = Column(String(255), comment="广告组名称")
    report_type = Column(String(30), index=True, comment="报告类型: campaign/keyword/search_term/product")

    # 关键词/搜索词
    keyword = Column(String(500), comment="关键词文本")
    match_type = Column(String(20), comment="匹配类型: exact/phrase/broad")
    search_term = Column(String(500), comment="用户搜索词")

    # 广告类型
    ad_type = Column(String(20), comment="广告类型: sp/sb/sd")

    # ASIN/SKU
    advertised_asin = Column(String(50), index=True, comment="推广的ASIN")
    advertised_sku = Column(String(100), comment="推广的SKU")

    # 核心指标
    impressions = Column(Integer, default=0, comment="曝光量")
    clicks = Column(Integer, default=0, comment="点击量")
    spend = Column(DECIMAL(12, 2), default=0, comment="花费")
    orders = Column(Integer, default=0, comment="广告订单数")
    sales = Column(DECIMAL(12, 2), default=0, comment="广告销售额")

    # 派生指标 (导入时自动计算)
    ctr = Column(DECIMAL(8, 4), comment="点击率 (clicks/impressions)")
    cpc = Column(DECIMAL(12, 4), comment="单次点击成本 (spend/clicks)")
    acos = Column(DECIMAL(8, 4), comment="广告销售成本 (spend/sales)")
    roas = Column(DECIMAL(8, 4), comment="投入产出比 (sales/spend)")
    cvr = Column(DECIMAL(8, 4), comment="转化率 (orders/clicks)")
    cpa = Column(DECIMAL(12, 4), comment="单次转化成本 (spend/orders)")

    # 导入批次
    batch_id = Column(String(50), index=True, comment="导入批次号（格式: ad_import_YYYYMMDD_HHmmss）")


class AdOptimizationRule(BaseModel):
    """广告自动化优化规则"""
    __tablename__ = "ad_optimization_rules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False, comment="规则名称")
    rule_type = Column(String(50), nullable=False, comment="规则类型: adjust_bid/pause/add_negative/increase_budget")
    conditions = Column(Text, nullable=False, comment="条件JSON")
    actions = Column(Text, nullable=False, comment="动作JSON")
    is_enabled = Column(Integer, default=1, comment="是否启用: 1=启用, 0=禁用")
    last_executed_at = Column(DateTime, comment="上次执行时间")


class AdOptimizationLog(BaseModel):
    """广告优化操作日志"""
    __tablename__ = "ad_optimization_logs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    rule_id = Column(Integer, ForeignKey("ad_optimization_rules.id"), index=True)
    action_type = Column(String(50), comment="操作类型: adjust_bid/pause/add_negative/increase_budget")
    target = Column(String(500), comment="操作目标描述")
    result = Column(Text, comment="执行结果详情")
    status = Column(String(20), default="success", comment="执行状态: success/failed")