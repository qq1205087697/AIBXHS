"""
广告日度分表 date 字段处理 TDD 测试

业务规则（参见 services/ad_import_service.py）:
    5 个生产 Excel 文件均无"日期"列，date 字段必须从 target_date 传入。

当前缺陷：
    _build_daily_row_data(row, report_type) 不接收 target_date 参数，
    内部调用 _parse_date(row) 查找 'date'/'Date'/'日期' 列，永远返回 None。
    导致 _write_to_daily_table 因 "date_val=None" 静默跳过分表写入。

修复方案：
    1. _build_daily_row_data(row, report_type, target_date) 接收 target_date
    2. 行内有 date 列时优先用行内值；否则用 target_date
    3. _import_ad_excel 调用处传入 target_date
"""
from __future__ import annotations

import sys
import os
from datetime import date, datetime
from typing import Generator
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, event, Date, Numeric
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from models.ad_daily import AdCampaignDaily, AdKeywordDaily, AdSearchTermDaily, AdProductDaily
from services.auth_service import get_password_hash, create_access_token
from services import ad_import_service
from services.ad_import_service import (
    _build_daily_row_data,
    _write_to_daily_table,
    _detect_report_type,
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
    tenant = Tenant(name="Test Tenant", code="test-tenant-daily-date-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


# ==================== 测试：_build_daily_row_data 接收 target_date ====================

class TestBuildDailyRowDataWithTargetDate:
    """_build_daily_row_data 必须接收 target_date 并作为 date 默认值"""

    def test_campaign_row_uses_target_date_when_no_date_column(self):
        """行内无 date 列时，date 字段应使用 target_date"""
        # 模拟广告活动数据.xlsx 的行（无 date 列）
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Test-Campaign",
            "广告花费": 100.0,
            "曝光": 1000,
            "点击": 50,
            "CPC": 2.0,
            "广告订单": 5,
            "广告销量": 10,
            "广告销售额": 200.0,
            "CVR": 0.1,
            "ACOS": 0.5,
            "广告类型": "SP手动",
            "预算": "$45.00 每日",
            "状态": "已启用",
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "campaign", target_date=target)
        assert data["date"] == target, (
            f"行内无 date 列时应用 target_date，实际: {data.get('date')}"
        )

    def test_keyword_row_uses_target_date(self):
        """关键词报告行也应用 target_date"""
        row = {
            "站点/店铺": "US/A",
            "关键词": "shoes",
            "广告活动": "Test-Campaign",
            "广告花费": 50.0,
            "曝光": 500,
            "点击": 25,
        }
        target = date(2026, 7, 19)
        data = _build_daily_row_data(row, "keyword", target_date=target)
        assert data["date"] == target

    def test_search_term_row_uses_target_date(self):
        """搜索词报告行也应用 target_date"""
        row = {
            "站点/店铺": "US/A",
            "搜索词": "running shoes",
            "广告活动": "Test-Campaign",
            "广告花费": 30.0,
            "曝光": 300,
            "点击": 15,
        }
        target = date(2026, 7, 18)
        data = _build_daily_row_data(row, "search_term", target_date=target)
        assert data["date"] == target

    def test_product_row_uses_target_date(self):
        """商品投放/广告报告行也应用 target_date"""
        row = {
            "站点/店铺": "US/A",
            "广告": "B0C4GHGWRC/USA-A-341",
            "广告活动": "Test-Campaign",
            "广告花费": 80.0,
            "曝光": 800,
            "点击": 40,
        }
        target = date(2026, 7, 17)
        data = _build_daily_row_data(row, "product", target_date=target)
        assert data["date"] == target

    def test_row_with_explicit_date_column_uses_row_value(self):
        """行内有 date 列时优先用行内值（向后兼容）"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Test-Campaign",
            "日期": "2026-07-15",
            "广告花费": 100.0,
            "曝光": 1000,
            "点击": 50,
        }
        target = date(2026, 7, 20)  # target_date 与行内日期不同
        data = _build_daily_row_data(row, "campaign", target_date=target)
        # 行内有日期列时优先用行内值
        assert data["date"] == date(2026, 7, 15), (
            f"行内有日期列时应优先用行内值，实际: {data.get('date')}"
        )

    def test_target_date_none_and_no_date_column_returns_none(self):
        """target_date 为 None 且行内无日期列时，date 为 None（保持原行为）"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Test-Campaign",
            "广告花费": 100.0,
        }
        data = _build_daily_row_data(row, "campaign", target_date=None)
        assert data["date"] is None


# ==================== 测试：_write_to_daily_table 使用 target_date ====================

class TestWriteToDailyTableWithTargetDate:
    """_write_to_daily_table 必须能写入 date 字段（从 target_date 来）"""

    def test_campaign_daily_written_with_target_date(
        self, db_session: Session, test_tenant: Tenant
    ):
        """广告活动日度分表能写入 date 字段"""
        row = {
            "站点/店铺": "US/A",
            "广告活动": "Test-Campaign-Write",
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

        # 查询验证
        record = db_session.query(AdCampaignDaily).filter(
            AdCampaignDaily.tenant_id == test_tenant.id,
            AdCampaignDaily.date == target,
        ).first()
        assert record is not None, "广告活动日度分表应写入成功"
        assert record.campaign_name == "Test-Campaign-Write"
        assert record.date == target

    def test_product_daily_written_with_target_date(
        self, db_session: Session, test_tenant: Tenant
    ):
        """商品投放日度分表能写入 date 字段"""
        row = {
            "站点/店铺": "US/A",
            "广告": "B0TEST12345/USA-A-341",
            "广告活动": "Test-Product-Campaign",
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
        ).first()
        assert record is not None, "商品投放日度分表应写入成功"
        assert record.date == target


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
