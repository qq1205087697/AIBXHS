"""
广告日度分表复合键 upsert TDD 测试

业务规则（参见 services/ad_import_service.py:_write_to_daily_table）:
    5 个生产 Excel 均无业务 ID 列（campaign_id/keyword_id/ad_id），
    必须改用"主体字段"作为复合键 upsert，而非业务 ID。

各报告类型的复合键：
    - campaign    → (tenant_id, date, account, campaign_name)
    - keyword     → (tenant_id, date, account, campaign_name, keyword_text)
    - search_term → (tenant_id, date, account, campaign_name, search_term)
    - product     → (tenant_id, date, account, campaign_name, advertised_asin)

当前缺陷：
    _write_to_daily_table 用 business_id_field（campaign_id/keyword_id/
    search_term/ad_id）做 upsert，但 Excel 无 ID 列，business_id_value
    永远为 None，触发"跳过分表写入"警告，导致 4 个分表全部数据丢失。

修复方案：
    1. business_id 缺失时，回退到复合键 upsert
    2. 复合键 = (tenant_id, date, account, campaign_name, [主体字段])
    3. 主体字段缺失的行才跳过（如 campaign 报告无 campaign_name）
"""
from __future__ import annotations

import sys
import os
from datetime import date, datetime
from typing import Generator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, event, Date, Numeric
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from models.ad_daily import (
    AdCampaignDaily, AdKeywordDaily, AdSearchTermDaily, AdProductDaily,
)
from services.ad_import_service import (
    _build_daily_row_data,
    _write_to_daily_table,
)


# ==================== 项目技术债：哑表注册 ====================
for _tbl, _cols in [
    ("store_groups", ["name", "code", "tenant_id"]),
    ("roles", ["name", "code", "tenant_id"]),
]:
    if _tbl not in Base.metadata.tables:
        Table(
            _tbl,
            Base.metadata,
            Column("id", Integer, primary_key=True, autoincrement=True),
            *[_cols and Column(c, String(100)) for c in _cols],
            Column("created_at", DateTime),
            Column("updated_at", DateTime),
        )


# ==================== SQLite 索引名冲突绕过 ====================
@event.listens_for(Table, "before_create")
def _skip_index_creation(target, connection, **kw):
    if hasattr(target, "indexes") and target.indexes:
        target._test_original_indexes = list(target.indexes)
        target.indexes = []


@event.listens_for(Table, "after_create")
def _restore_indexes(target, connection, **kw):
    if hasattr(target, "_test_original_indexes"):
        target.indexes = target._test_original_indexes
        del target._test_original_indexes


TEST_DATABASE_URL = "sqlite:///:memory:"


def _make_engine():
    return create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def override_get_db_factory(session_local):
    def _override():
        try:
            db = session_local()
            yield db
        finally:
            db.close()
    return _override


@pytest.fixture(scope="function")
def db_session() -> Generator[Session, None, None]:
    engine = _make_engine()
    needed_tables = [
        "tenants", "users", "roles", "store_groups",
        "ad_campaign_daily", "ad_keyword_daily",
        "ad_search_term_daily", "ad_product_daily",
    ]
    tables_to_create = [
        t for name, t in Base.metadata.tables.items() if name in needed_tables
    ]
    Base.metadata.create_all(bind=engine, tables=tables_to_create)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    app.dependency_overrides[get_db] = override_get_db_factory(SessionLocal)

    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine, tables=tables_to_create)
        engine.dispose()
        if get_db in app.dependency_overrides:
            del app.dependency_overrides[get_db]


@pytest.fixture(scope="function")
def test_tenant(db_session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant", code="test-tenant-composite-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


# ==================== 测试：4 个分表都能写入（无业务 ID 场景） ====================

class TestCompositeKeyUpsertAllReportTypes:
    """4 个分表在 Excel 无业务 ID 时都能用复合键 upsert 写入"""

    def test_campaign_daily_written_without_campaign_id(
        self, db_session: Session, test_tenant: Tenant
    ):
        """广告活动报告无 campaign_id 列时，用 (tenant, date, account, campaign_name) upsert"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "CompositeKey-Campaign",
            "广告花费": 100.0,
            "曝光": 1000,
            "点击": 50,
            "广告订单": 5,
            "广告销量": 10,
            "广告销售额": 200.0,
            "广告类型": "SP手动",
            "预算": "$45.00 每日",
            "状态": "已启用",
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "campaign", target_date=target)

        _write_to_daily_table(db_session, "campaign", data, test_tenant.id, "batch-001")

        record = db_session.query(AdCampaignDaily).filter(
            AdCampaignDaily.tenant_id == test_tenant.id,
            AdCampaignDaily.date == target,
            AdCampaignDaily.campaign_name == "CompositeKey-Campaign",
        ).first()
        assert record is not None, "广告活动分表应用复合键写入"
        assert record.account == "A"
        assert record.country == "US"
        assert record.campaign_name == "CompositeKey-Campaign"

    def test_keyword_daily_written_without_keyword_id(
        self, db_session: Session, test_tenant: Tenant
    ):
        """关键词报告无 keyword_id 列时，用 (tenant, date, account, campaign_name, keyword_text) upsert"""
        row = {
            "站点/店铺": "US/A",
            "关键词": "running shoes",
            "广告活动": "KeywordTest-Campaign",
            "广告花费": 50.0,
            "曝光": 500,
            "点击": 25,
            "匹配类型": "Broad",
            "竞价": 1.5,
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "keyword", target_date=target)

        _write_to_daily_table(db_session, "keyword", data, test_tenant.id, "batch-001")

        record = db_session.query(AdKeywordDaily).filter(
            AdKeywordDaily.tenant_id == test_tenant.id,
            AdKeywordDaily.date == target,
            AdKeywordDaily.campaign_name == "KeywordTest-Campaign",
            AdKeywordDaily.keyword_text == "running shoes",
        ).first()
        assert record is not None, "关键词分表应用复合键写入"

    def test_search_term_daily_written_without_campaign_id(
        self, db_session: Session, test_tenant: Tenant
    ):
        """搜索词报告无 campaign_id 列时，用 (tenant, date, account, campaign_name, search_term) upsert"""
        row = {
            "站点/店铺": "US/A",
            "搜索词": "blue running shoes",
            "广告活动": "SearchTermTest-Campaign",
            "广告花费": 30.0,
            "曝光": 300,
            "点击": 15,
            "匹配类型": "Broad",
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "search_term", target_date=target)

        _write_to_daily_table(db_session, "search_term", data, test_tenant.id, "batch-001")

        record = db_session.query(AdSearchTermDaily).filter(
            AdSearchTermDaily.tenant_id == test_tenant.id,
            AdSearchTermDaily.date == target,
            AdSearchTermDaily.search_term == "blue running shoes",
        ).first()
        assert record is not None, "搜索词分表应用复合键写入"

    def test_product_daily_written_without_ad_id(
        self, db_session: Session, test_tenant: Tenant
    ):
        """商品投放/广告报告无 ad_id 列时，用 (tenant, date, account, campaign_name, advertised_asin) upsert"""
        row = {
            "站点/店铺": "US/A",
            "广告": "B0TEST12345/USA-A-341",
            "广告活动": "ProductTest-Campaign",
            "广告花费": 80.0,
            "曝光": 800,
            "点击": 40,
            "广告订单": 4,
            "广告销量": 8,
            "广告销售额": 160.0,
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "product", target_date=target)

        _write_to_daily_table(db_session, "product", data, test_tenant.id, "batch-001")

        record = db_session.query(AdProductDaily).filter(
            AdProductDaily.tenant_id == test_tenant.id,
            AdProductDaily.date == target,
            AdProductDaily.advertised_asin == "B0TEST12345",
        ).first()
        assert record is not None, "商品投放分表应用复合键写入"
        assert record.advertised_asin == "B0TEST12345"
        assert record.advertised_sku == "USA-A-341"


# ==================== 测试：复合键 upsert 更新而非重复插入 ====================

class TestCompositeKeyUpsertUpdatesExisting:
    """复合键匹配时应该更新已有记录，而非重复插入"""

    def test_campaign_daily_upsert_updates_same_key(
        self, db_session: Session, test_tenant: Tenant
    ):
        """同一 (tenant, date, account, campaign_name) 第二次导入应更新而非插入"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Upsert-Campaign",
            "广告花费": 100.0,
            "曝光": 1000,
            "点击": 50,
            "广告订单": 5,
            "广告销售额": 200.0,
            "广告类型": "SP手动",
            "预算": "$45.00 每日",
            "状态": "已启用",
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "campaign", target_date=target)

        # 第一次写入
        _write_to_daily_table(db_session, "campaign", data, test_tenant.id, "batch-001")
        # 第二次写入（同复合键，不同 batch_id，数据更新）
        row2 = dict(row)
        row2["广告花费"] = 200.0
        row2["曝光"] = 2000
        data2 = _build_daily_row_data(row2, "campaign", target_date=target)
        _write_to_daily_table(db_session, "campaign", data2, test_tenant.id, "batch-002")

        # 验证只有 1 条记录
        records = db_session.query(AdCampaignDaily).filter(
            AdCampaignDaily.tenant_id == test_tenant.id,
            AdCampaignDaily.date == target,
            AdCampaignDaily.campaign_name == "Upsert-Campaign",
        ).all()
        assert len(records) == 1, f"复合键 upsert 应更新而非插入，实际有 {len(records)} 条"
        # 验证数据已更新
        assert float(records[0].spend) == 200.0
        assert records[0].impressions == 2000
        assert records[0].batch_id == "batch-002"


# ==================== 测试：不同复合键应分别插入 ====================

class TestCompositeKeyDifferentKeysInsertSeparately:
    """不同复合键应分别插入（验证复合键正确区分）"""

    def test_different_campaigns_inserted_separately(
        self, db_session: Session, test_tenant: Tenant
    ):
        """同日同租户不同广告活动名应插入 2 条"""
        target = date(2026, 7, 20)
        for name in ["Campaign-A", "Campaign-B"]:
            row = {
                "站点/店铺": "US/A",
                "广告活动": name,
                "广告花费": 100.0,
                "曝光": 1000,
                "点击": 50,
                "广告类型": "SP手动",
                "预算": "$45.00 每日",
                "状态": "已启用",
            }
            data = _build_daily_row_data(row, "campaign", target_date=target)
            _write_to_daily_table(db_session, "campaign", data, test_tenant.id, "batch-001")

        records = db_session.query(AdCampaignDaily).filter(
            AdCampaignDaily.tenant_id == test_tenant.id,
            AdCampaignDaily.date == target,
        ).all()
        assert len(records) == 2, f"应插入 2 条不同 campaign_name 记录，实际 {len(records)}"

    def test_different_dates_inserted_separately(
        self, db_session: Session, test_tenant: Tenant
    ):
        """同租户同广告活动不同日期应插入 2 条"""
        for d in [date(2026, 7, 19), date(2026, 7, 20)]:
            row = {
                "站点/店铺": "US/A",
                "广告活动": "Same-Campaign",
                "广告花费": 100.0,
                "曝光": 1000,
                "点击": 50,
                "广告类型": "SP手动",
                "预算": "$45.00 每日",
                "状态": "已启用",
            }
            data = _build_daily_row_data(row, "campaign", target_date=d)
            _write_to_daily_table(db_session, "campaign", data, test_tenant.id, "batch-001")

        records = db_session.query(AdCampaignDaily).filter(
            AdCampaignDaily.tenant_id == test_tenant.id,
            AdCampaignDaily.campaign_name == "Same-Campaign",
        ).all()
        assert len(records) == 2, f"应插入 2 条不同日期记录，实际 {len(records)}"


# ==================== 测试：主体字段缺失时仍跳过 ====================

class TestMissingMainFieldStillSkipped:
    """主体字段（如 campaign_name）缺失时仍应跳过（防止脏数据）"""

    def test_campaign_without_name_skipped(self, db_session: Session, test_tenant: Tenant):
        """campaign 报告无 campaign_name 时跳过"""
        row = {
            "站点/店铺": "US/A",
            "广告花费": 100.0,
            "曝光": 1000,
            # 无"广告活动"列
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "campaign", target_date=target)
        _write_to_daily_table(db_session, "campaign", data, test_tenant.id, "batch-001")

        count = db_session.query(AdCampaignDaily).filter(
            AdCampaignDaily.tenant_id == test_tenant.id,
        ).count()
        assert count == 0, "无 campaign_name 应跳过"

    def test_keyword_without_keyword_text_skipped(self, db_session: Session, test_tenant: Tenant):
        """keyword 报告无 keyword_text 时跳过"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Some-Campaign",
            "广告花费": 100.0,
            # 无"关键词"列
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "keyword", target_date=target)
        _write_to_daily_table(db_session, "keyword", data, test_tenant.id, "batch-001")

        count = db_session.query(AdKeywordDaily).filter(
            AdKeywordDaily.tenant_id == test_tenant.id,
        ).count()
        assert count == 0, "无 keyword_text 应跳过"

    def test_product_without_asin_skipped(self, db_session: Session, test_tenant: Tenant):
        """product 报告无 advertised_asin 时跳过"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Some-Campaign",
            "广告花费": 100.0,
            # 无"广告"列
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "product", target_date=target)
        _write_to_daily_table(db_session, "product", data, test_tenant.id, "batch-001")

        count = db_session.query(AdProductDaily).filter(
            AdProductDaily.tenant_id == test_tenant.id,
        ).count()
        assert count == 0, "无 advertised_asin 应跳过"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
