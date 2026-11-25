"""标签系统 ORM 模型（标签系统 MVP，依据《系统设计》v1.0 §4.2.1~§4.2.5）

五张表：
- ProductTag         产品维度标签真源（节日 + 强制补货，跨快照持久 K4）
- HolidayLexicon     节日词库（打标规则配置，变更即生效）
- TagAuditLog        标签变更审计流水（追加只写，V4 100% 覆盖）
- StartopWordData    星拓出单词/流量词落地（90 天滚动清理）
- StartopPullLog     星拓拉取流水（兜底切换依据）
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, Text, Index, UniqueConstraint
from database.database import Base


class ProductTag(Base):
    """产品维度标签真源（跨快照持久，K4）"""
    __tablename__ = "product_tags"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    tenant_id = Column(Integer, default=1, nullable=False, comment="租户隔离")
    asin = Column(String(100), nullable=False, comment="产品 ASIN")
    # 行级作用域（店铺/行组）：与 inventory_snapshots.account 对应（如 'JeVenis-US'，
    # 汇总行为多店铺串 'JeVenis-US、JeVenis-MX'）。
    # 空串 = **通配**：作用于该 ASIN 的全部店铺行（存量数据与自动打标使用此语义，
    # 因为星拓搜索词只按 ASIN 归因、无法区分店铺）。
    account = Column(String(255), nullable=False, default="", server_default="",
                     comment="店铺作用域（空串=该 ASIN 全部店铺）")
    sku = Column(String(500), nullable=False, default="", server_default="", comment="SKU（仅留痕，不参与唯一键/匹配）")
    tag_type = Column(String(30), nullable=False, comment="标签类型：holiday/force_replenish")
    tag_value = Column(String(20), nullable=False, default="", server_default="", comment="节日名（K6 枚举）；强制补货时为 1")
    source = Column(String(10), nullable=False, default="manual", server_default="manual", comment="来源：auto/manual/import")
    locked = Column(Integer, nullable=False, default=0, server_default="0", comment="人工锁定（K5）")
    active = Column(Integer, nullable=False, default=1, server_default="1", comment="生效中")
    match_basis = Column(String(500), nullable=True, comment="自动打标依据词（JSON）")
    reason = Column(String(200), nullable=True, comment="人工理由")
    created_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="创建时间")
    updated_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="更新时间")
    deleted_at = Column(DateTime, nullable=True, comment="软删除")

    __table_args__ = (
        # 行级作用域口径（2026-09-29 用户裁定「行级」）：同一 ASIN 的不同店铺行各自持有标签。
        # account='' 为通配（该 ASIN 全部店铺）。**sku 已移出唯一键**：它不唯一
        # （如 USA-A-524 同时出现在 4 个店铺行）、且 account(255)+sku(500) 会使 InnoDB
        # 索引键超过 3072 字节上限导致建索引失败——sku 现仅作留痕。
        UniqueConstraint("tenant_id", "asin", "account", "tag_type", "tag_value", name="uk_tag"),
        Index("idx_tenant_active", "tenant_id", "tag_type", "active"),
        Index("idx_asin", "asin"),
        Index("idx_asin_account", "tenant_id", "asin", "account"),
    )


class HolidayLexicon(Base):
    """节日词库（打标规则配置，变更即生效）"""
    __tablename__ = "holiday_lexicon"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    tenant_id = Column(Integer, default=1, nullable=False, comment="租户隔离")
    holiday_name = Column(String(20), nullable=False, comment="节日名（K6 枚举）")
    keyword = Column(String(100), nullable=False, comment="匹配关键词")
    match_type = Column(String(10), nullable=False, default="contains", server_default="contains", comment="匹配方式：contains/exact")
    site = Column(String(10), nullable=False, default="ALL", server_default="ALL", comment="生效站点：ALL/US/UK")
    window_start = Column(Date, nullable=True, comment="节日窗口起始（空=全年）")
    window_end = Column(Date, nullable=True, comment="节日窗口截止")
    status = Column(Integer, nullable=False, default=1, server_default="1", comment="启用：1/停用：0")
    remark = Column(String(200), nullable=True, comment="备注")
    created_by = Column(String(64), nullable=True, comment="创建人")
    created_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="创建时间")
    updated_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="更新时间")
    deleted_at = Column(DateTime, nullable=True, comment="软删除")

    __table_args__ = (
        UniqueConstraint("tenant_id", "holiday_name", "keyword", name="uk_lexicon"),
        Index("idx_status", "tenant_id", "status"),
    )


class TagAuditLog(Base):
    """标签变更审计流水（追加只写，无 updated/deleted）"""
    __tablename__ = "tag_audit_logs"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    tenant_id = Column(Integer, default=1, nullable=False, comment="租户隔离")
    event_id = Column(String(64), nullable=False, comment="事件唯一标识（UUID，兼作幂等键）")
    trace_id = Column(String(64), nullable=True, comment="链路追踪 ID")
    asin = Column(String(100), nullable=False, comment="目标产品")
    sku = Column(String(500), nullable=False, default="", server_default="", comment="SKU")
    tag_type = Column(String(30), nullable=False, comment="标签类型：holiday/force_replenish")
    action = Column(String(20), nullable=False, comment="动作：set/clear/unlock/auto_set/auto_clear")
    old_value = Column(String(200), nullable=True, comment="变更前值")
    new_value = Column(String(200), nullable=True, comment="变更后值")
    source = Column(String(10), nullable=False, default="manual", server_default="manual", comment="来源：auto/manual/import")
    operator = Column(String(64), nullable=False, comment="操作人（auto 时为 system）")
    reason = Column(String(200), nullable=True, comment="理由或自动依据摘要")
    created_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="事件时间")

    __table_args__ = (
        UniqueConstraint("event_id", name="uk_event"),
        Index("idx_audit_query", "tenant_id", "asin", "created_at"),
        Index("idx_operator_time", "tenant_id", "operator", "created_at"),
    )


class StartopWordData(Base):
    """星拓词数据落地表（出单词/流量词，90 天滚动清理）"""
    __tablename__ = "startop_word_data"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    tenant_id = Column(Integer, default=1, nullable=False, comment="租户隔离")
    site = Column(String(10), nullable=False, comment="站点：US/UK")
    store_id = Column(String(64), nullable=False, comment="星拓店铺标识")
    profile_id = Column(String(64), nullable=False, comment="星拓 profileId")
    word_type = Column(String(20), nullable=False, comment="词类型：search_term/traffic_term")
    keyword = Column(String(200), nullable=False, comment="关键词文本")
    asin = Column(String(100), nullable=False, comment="归因 ASIN")
    stat_date = Column(Date, nullable=False, comment="数据日期")
    data_source = Column(String(10), nullable=False, default="mcp", server_default="mcp", comment="来源：mcp/report")
    raw_extra = Column(Text, nullable=True, comment="原始行冗余字段（曝光/点击/转化）")
    created_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="创建时间")
    updated_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="更新时间")

    __table_args__ = (
        UniqueConstraint("tenant_id", "profile_id", "asin", "word_type", "keyword", "stat_date", name="uk_word"),
        Index("idx_window", "tenant_id", "stat_date", "asin"),
        Index("idx_profile_date", "profile_id", "stat_date"),
    )


class StartopPullLog(Base):
    """星拓拉取流水（失败告警与兜底切换依据，追加只写，180 天清理）"""
    __tablename__ = "startop_pull_logs"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    tenant_id = Column(Integer, default=1, nullable=False, comment="租户隔离")
    pull_date = Column(Date, nullable=False, comment="拉取批次日期")
    tool = Column(String(50), nullable=False, comment="工具名")
    target_scope = Column(String(200), nullable=True, comment="目标范围（店铺或文件）")
    page_num = Column(Integer, nullable=True, comment="分页页码")
    page_size = Column(Integer, nullable=True, comment="分页大小")
    status = Column(String(30), nullable=False, comment="状态：SUCCESS/PARTIAL/FAILED/FAILED_FALLBACK_READY")
    rows_parsed = Column(Integer, nullable=False, default=0, server_default="0", comment="解析成功行数")
    retry_count = Column(Integer, nullable=False, default=0, server_default="0", comment="已重试次数")
    duration_ms = Column(Integer, nullable=True, comment="耗时毫秒")
    error_msg = Column(String(1000), nullable=True, comment="失败原因")
    fallback_ready = Column(Integer, nullable=False, default=0, server_default="0", comment="兜底通道就绪标记")
    created_at = Column(DateTime, nullable=False, server_default="CURRENT_TIMESTAMP", comment="事件时间")

    __table_args__ = (
        Index("idx_pull_date", "tenant_id", "pull_date", "status"),
        Index("idx_scope", "pull_date", "target_scope"),
    )
