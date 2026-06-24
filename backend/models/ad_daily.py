"""
广告日度数据模型 V1.0
4 个日度分表 + 优化建议池 + 执行日志
数据来源: 影刀 RPA 从星拓 ERP 下载报表导入
"""
from sqlalchemy import Column, Integer, String, BigInteger, DECIMAL, Date, DateTime, Text, Index, ForeignKey
from models.base import BaseModel


# ==================== 4 个日度分表 ====================

class AdCampaignDaily(BaseModel):
    """广告活动日表 - 按活动维度存储每日广告数据"""
    __tablename__ = "ad_campaign_daily"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True, comment="店铺ID")

    # 店铺信息（冗余字段，方便查询）
    account = Column(String(100), index=True, comment="店铺名")
    country = Column(String(50), index=True, comment="国家")

    # 日期
    date = Column(Date, nullable=False, index=True, comment="报告日期")

    # 广告活动维度
    campaign_id = Column(String(100), index=True, comment="广告活动ID")
    campaign_name = Column(String(255), index=True, comment="广告活动名称")
    campaign_type = Column(String(20), comment="广告类型: SP/SB/SD")
    targeting_type = Column(String(20), comment="投放类型: Auto/Manual")
    bidding_strategy = Column(String(50), comment="竞价策略")
    budget = Column(DECIMAL(12, 2), default=0, comment="日预算")
    status = Column(String(20), comment="活动状态: Enabled/Paused/Archived")
    portfolio_name = Column(String(255), comment="组合名称")
    ad_group_name = Column(String(255), comment="广告组名称")

    # 核心指标
    impressions = Column(Integer, default=0, comment="曝光量")
    clicks = Column(Integer, default=0, comment="点击量")
    spend = Column(DECIMAL(12, 2), default=0, comment="花费")
    orders = Column(Integer, default=0, comment="广告订单数")
    sales = Column(DECIMAL(12, 2), default=0, comment="广告销售额")

    # 派生指标
    ctr = Column(DECIMAL(8, 4), comment="点击率 (clicks/impressions)")
    cpc = Column(DECIMAL(12, 4), comment="单次点击成本 (spend/clicks)")
    acos = Column(DECIMAL(8, 4), comment="广告销售成本 (spend/sales)")
    roas = Column(DECIMAL(8, 4), comment="投入产出比 (sales/spend)")
    cvr = Column(DECIMAL(8, 4), comment="转化率 (orders/clicks)")
    budget_utilization = Column(DECIMAL(8, 4), comment="预算利用率 (spend/budget)")
    tacos = Column(DECIMAL(8, 4), comment="总销售广告成本 (spend/total_sales)")

    # 导入批次
    batch_id = Column(String(50), index=True, comment="导入批次号")

    __table_args__ = (
        Index("idx_tenant_date", "tenant_id", "date"),
        Index("idx_tenant_campaign", "tenant_id", "campaign_id"),
        Index("idx_store_date", "store_id", "date"),
    )


class AdKeywordDaily(BaseModel):
    """关键词日表 - 按关键词维度存储每日广告数据"""
    __tablename__ = "ad_keyword_daily"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True, comment="店铺ID")

    account = Column(String(100), index=True, comment="店铺名")
    country = Column(String(50), index=True, comment="国家")
    date = Column(Date, nullable=False, index=True, comment="报告日期")

    # 关键词维度
    campaign_id = Column(String(100), index=True, comment="广告活动ID")
    campaign_name = Column(String(255), index=True, comment="广告活动名称")
    ad_group_name = Column(String(255), comment="广告组名称")
    keyword_id = Column(String(100), index=True, comment="关键词ID")
    keyword_text = Column(String(500), index=True, comment="关键词文本")
    match_type = Column(String(20), comment="匹配类型: Broad/Phrase/Exact")
    bid = Column(DECIMAL(12, 4), default=0, comment="出价")

    # 核心指标
    impressions = Column(Integer, default=0, comment="曝光量")
    clicks = Column(Integer, default=0, comment="点击量")
    spend = Column(DECIMAL(12, 2), default=0, comment="花费")
    orders = Column(Integer, default=0, comment="广告订单数")
    sales = Column(DECIMAL(12, 2), default=0, comment="广告销售额")

    # 派生指标
    ctr = Column(DECIMAL(8, 4), comment="点击率")
    cpc = Column(DECIMAL(12, 4), comment="单次点击成本")
    acos = Column(DECIMAL(8, 4), comment="广告销售成本")
    roas = Column(DECIMAL(8, 4), comment="投入产出比")
    cvr = Column(DECIMAL(8, 4), comment="转化率")

    batch_id = Column(String(50), index=True, comment="导入批次号")

    __table_args__ = (
        Index("idx_tenant_date", "tenant_id", "date"),
        Index("idx_tenant_campaign", "tenant_id", "campaign_id"),
        Index("idx_store_date", "store_id", "date"),
    )


class AdSearchTermDaily(BaseModel):
    """搜索词日表 - 按用户搜索词维度存储每日广告数据"""
    __tablename__ = "ad_search_term_daily"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True, comment="店铺ID")

    account = Column(String(100), index=True, comment="店铺名")
    country = Column(String(50), index=True, comment="国家")
    date = Column(Date, nullable=False, index=True, comment="报告日期")

    # 搜索词维度
    campaign_id = Column(String(100), index=True, comment="广告活动ID")
    campaign_name = Column(String(255), index=True, comment="广告活动名称")
    ad_group_name = Column(String(255), comment="广告组名称")
    search_term = Column(String(500), index=True, comment="用户搜索词")
    keyword_text = Column(String(500), comment="触发关键词")
    match_type = Column(String(20), comment="匹配类型")

    # 核心指标
    impressions = Column(Integer, default=0, comment="曝光量")
    clicks = Column(Integer, default=0, comment="点击量")
    spend = Column(DECIMAL(12, 2), default=0, comment="花费")
    orders = Column(Integer, default=0, comment="广告订单数")
    sales = Column(DECIMAL(12, 2), default=0, comment="广告销售额")

    # 派生指标
    ctr = Column(DECIMAL(8, 4), comment="点击率")
    cpc = Column(DECIMAL(12, 4), comment="单次点击成本")
    acos = Column(DECIMAL(8, 4), comment="广告销售成本")
    roas = Column(DECIMAL(8, 4), comment="投入产出比")
    cvr = Column(DECIMAL(8, 4), comment="转化率")

    batch_id = Column(String(50), index=True, comment="导入批次号")

    __table_args__ = (
        Index("idx_tenant_date", "tenant_id", "date"),
        Index("idx_tenant_campaign", "tenant_id", "campaign_id"),
        Index("idx_store_date", "store_id", "date"),
    )


class AdProductDaily(BaseModel):
    """产品广告日表 - 按推广商品维度存储每日广告数据"""
    __tablename__ = "ad_product_daily"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True, comment="店铺ID")

    account = Column(String(100), index=True, comment="店铺名")
    country = Column(String(50), index=True, comment="国家")
    date = Column(Date, nullable=False, index=True, comment="报告日期")

    # 产品维度
    campaign_id = Column(String(100), index=True, comment="广告活动ID")
    campaign_name = Column(String(255), index=True, comment="广告活动名称")
    ad_group_name = Column(String(255), comment="广告组名称")
    ad_id = Column(String(100), index=True, comment="广告ID")
    advertised_asin = Column(String(50), index=True, comment="推广的ASIN")
    advertised_sku = Column(String(100), comment="推广的SKU")

    # 核心指标
    impressions = Column(Integer, default=0, comment="曝光量")
    clicks = Column(Integer, default=0, comment="点击量")
    spend = Column(DECIMAL(12, 2), default=0, comment="花费")
    orders = Column(Integer, default=0, comment="广告订单数")
    sales = Column(DECIMAL(12, 2), default=0, comment="广告销售额")

    # 派生指标
    ctr = Column(DECIMAL(8, 4), comment="点击率")
    cpc = Column(DECIMAL(12, 4), comment="单次点击成本")
    acos = Column(DECIMAL(8, 4), comment="广告销售成本")
    roas = Column(DECIMAL(8, 4), comment="投入产出比")
    cvr = Column(DECIMAL(8, 4), comment="转化率")

    batch_id = Column(String(50), index=True, comment="导入批次号")

    __table_args__ = (
        Index("idx_tenant_date", "tenant_id", "date"),
        Index("idx_tenant_campaign", "tenant_id", "campaign_id"),
        Index("idx_store_date", "store_id", "date"),
    )


# ==================== 优化建议池 ====================

class AdOptimizationSuggestion(BaseModel):
    """广告优化建议池 - 规则引擎生成的建议存储"""
    __tablename__ = "ad_optimization_suggestion"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True, comment="店铺ID")

    # 规则信息
    rule_name = Column(String(100), nullable=False, index=True, comment="规则名称")
    rule_priority = Column(String(10), nullable=False, comment="规则优先级: 高/中")
    rule_version = Column(String(20), default="1.0", comment="规则版本")

    # 目标信息
    target_type = Column(String(30), nullable=False, index=True, comment="目标类型: campaign/keyword/search_term/product")
    target_id = Column(String(200), index=True, comment="目标ID")
    target_name = Column(String(500), comment="目标名称")

    # 条件快照
    condition_metrics = Column(Text, comment="触发条件指标 JSON")
    current_value = Column(DECIMAL(12, 4), comment="当前值")
    threshold = Column(DECIMAL(12, 4), comment="阈值")

    # 建议内容
    suggestion_action = Column(String(500), nullable=False, comment="建议动作")
    suggestion_reason = Column(Text, comment="建议原因")
    ai_analysis = Column(Text, comment="AI 分析（可选）")

    # 状态: 待处理 → 已确认 → 已执行 / 已忽略 / 已失效
    status = Column(String(20), default="待处理", nullable=False, index=True, comment="状态")

    # 审计字段
    created_by = Column(Integer, comment="创建人（系统=0）")
    confirmed_by = Column(Integer, comment="确认人")
    confirmed_at = Column(DateTime, comment="确认时间")
    executed_at = Column(DateTime, comment="执行时间")
    expired_at = Column(DateTime, comment="失效时间")

    # 关联日期（规则评估的数据日期）
    evaluation_date = Column(Date, index=True, comment="规则评估数据日期")

    __table_args__ = (
        Index("idx_tenant_status", "tenant_id", "status"),
        Index("idx_tenant_rule", "tenant_id", "rule_name"),
        Index("idx_tenant_target", "tenant_id", "target_type", "target_id"),
    )


# ==================== 执行日志 ====================

class AdExecutionLog(BaseModel):
    """广告优化执行日志 - 记录建议执行结果"""
    __tablename__ = "ad_execution_log"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    # 关联建议
    suggestion_id = Column(Integer, ForeignKey("ad_optimization_suggestion.id"), index=True, comment="建议ID")

    # 规则信息
    rule_name = Column(String(100), index=True, comment="规则名称")
    action = Column(String(500), comment="执行动作")

    # 目标信息
    target_type = Column(String(30), comment="目标类型")
    target_id = Column(String(200), comment="目标ID")
    target_name = Column(String(500), comment="目标名称")

    # 执行结果
    result = Column(Text, comment="执行结果 JSON")
    status = Column(String(20), default="成功", nullable=False, index=True, comment="执行状态: 成功/失败")
    error_message = Column(Text, comment="错误信息")

    # 审计字段
    executed_by = Column(Integer, comment="执行人")
    execution_time = Column(DateTime, comment="执行时间")
    execution_duration_ms = Column(Integer, comment="执行耗时(毫秒)")

    __table_args__ = (
        Index("idx_tenant_rule", "tenant_id", "rule_name"),
        Index("idx_tenant_status", "tenant_id", "status"),
    )
