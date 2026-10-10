"""
商品投放报告"商品投放"列解析 TDD 测试

业务规则（参见 services/ad_import_service.py:_build_daily_row_data）:
    商品投放数据.xlsx 的"商品投放"列实际格式是 `asin = B0CDPNGTN8`，
    当前 _build_daily_row_data 在 product 类型只解析"广告"列，导致
    商品投放数据.xlsx 的 advertised_asin 永远为 None，分表写入被跳过。

生产文件实测（前 3 行）:
    ['asin = B0CDPNGTN8', 'asin = B0CGRFF2LP', 'asin = B0FFSYRC8V']

修复方案：
    product 类型增加对"商品投放"列的解析：
    1. 优先用"广告"列（广告数据.xlsx，格式 B0C4GHGWRC/USA-A-341）
    2. "广告"列空时回退到"商品投放"列（商品投放数据.xlsx，格式 asin = B0XXX）
    3. 解析 "asin = B0XXX" → advertised_asin=B0XXX
"""
from __future__ import annotations

import sys
import os
from datetime import date
from typing import Generator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, event, Date
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from models.ad_daily import AdProductDaily
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
        "ad_product_daily",
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
    tenant = Tenant(name="Test Tenant", code="test-tenant-product-target-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


# ==================== 测试："商品投放"列格式解析 ====================

class TestProductTargetingFieldParsing:
    """商品投放数据.xlsx 的"商品投放"列格式 `asin = B0XXX` 应被正确解析"""

    def test_product_targeting_field_parsed_as_asin(self):
        """'商品投放'列值为 'asin = B0CDPNGTN8' 时，advertised_asin 应为 B0CDPNGTN8"""
        row = {
            "站点/店铺": "US/A",
            "商品投放": "asin = B0CDPNGTN8",
            "广告活动": "Product-Targeting-Campaign",
            "广告花费": 4.54,
            "曝光": 431,
            "点击": 12,
            "广告订单": 1,
            "广告销售额": 13.99,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] == "B0CDPNGTN8", (
            f"应从 'asin = B0CDPNGTN8' 解析出 advertised_asin='B0CDPNGTN8'，"
            f"实际: {data.get('advertised_asin')}"
        )

    def test_product_targeting_with_sku_format(self):
        """'商品投放'列值为 'asin = B0XXX, sku = ABC' 时也应能解析 ASIN"""
        row = {
            "站点/店铺": "US/A",
            "商品投放": "asin = B0ABC12345, sku = XYZ-001",
            "广告活动": "Test-Campaign",
            "广告花费": 10.0,
            "曝光": 100,
            "点击": 5,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] == "B0ABC12345"
        # 如果同时解析出 SKU 也算 bonus
        if data.get("advertised_sku"):
            assert data["advertised_sku"] == "XYZ-001"

    def test_product_targeting_field_without_asin_prefix(self):
        """'商品投放'列值直接是 ASIN（无 'asin = ' 前缀）时也应识别"""
        row = {
            "站点/店铺": "US/A",
            "商品投放": "B0XYZ98765",
            "广告活动": "Test-Campaign",
            "广告花费": 5.0,
            "曝光": 50,
            "点击": 2,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] == "B0XYZ98765", (
            f"直接 ASIN 值也应被识别，实际: {data.get('advertised_asin')}"
        )

    def test_ad_field_takes_priority_over_product_targeting(self):
        """'广告'列和'商品投放'列同时存在时，'广告'列优先（广告数据.xlsx 场景）"""
        row = {
            "站点/店铺": "US/A",
            "广告": "B0PRIOR123/USA-A-341",  # 广告数据.xlsx 格式
            "商品投放": "asin = B0FALLBACK456",  # 商品投放数据.xlsx 格式
            "广告活动": "Test-Campaign",
            "广告花费": 8.0,
            "曝光": 80,
            "点击": 4,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] == "B0PRIOR123", (
            f"'广告'列应优先，实际: {data.get('advertised_asin')}"
        )
        assert data["advertised_sku"] == "USA-A-341"

    def test_product_targeting_fallback_when_ad_field_empty(self):
        """'广告'列为空时，回退到'商品投放'列"""
        row = {
            "站点/店铺": "US/A",
            "广告": None,
            "商品投放": "asin = B0FALLBACK789",
            "广告活动": "Test-Campaign",
            "广告花费": 6.0,
            "曝光": 60,
            "点击": 3,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] == "B0FALLBACK789"

    def test_product_targeting_field_empty_returns_none(self):
        """'商品投放'列为空且无'广告'列时，advertised_asin 为 None"""
        row = {
            "站点/店铺": "US/A",
            "商品投放": None,
            "广告活动": "Test-Campaign",
            "广告花费": 1.0,
            "曝光": 10,
            "点击": 1,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] is None


# ==================== 测试：商品投放分表能写入 ====================

class TestProductTargetingDailyWritten:
    """商品投放报告（'商品投放'列格式）能写入 AdProductDaily 分表"""

    def test_product_targeting_row_written_to_daily(
        self, db_session: Session, test_tenant: Tenant
    ):
        """模拟商品投放数据.xlsx 第一行，应成功写入 AdProductDaily"""
        row = {
            "站点/店铺": "US/A",
            "商品投放": "asin = B0CDPNGTN8",
            "广告活动": "芭比蛋糕关联",
            "广告花费": 4.54,
            "曝光": 431,
            "点击": 12,
            "广告订单": 1,
            "广告销量": 1,
            "广告销售额": 13.99,
            "状态": "已启用",
        }
        target = date(2026, 7, 20)
        data = _build_daily_row_data(row, "product", target_date=target)

        _write_to_daily_table(db_session, "product", data, test_tenant.id, "batch-001")

        record = db_session.query(AdProductDaily).filter(
            AdProductDaily.tenant_id == test_tenant.id,
            AdProductDaily.date == target,
            AdProductDaily.advertised_asin == "B0CDPNGTN8",
        ).first()
        assert record is not None, "商品投放分表应写入成功"
        assert record.advertised_asin == "B0CDPNGTN8"
        assert record.campaign_name == "芭比蛋糕关联"


# ==================== 测试：5 个生产文件的 product 行都能解析 ====================

class TestProdProductFilesParsing:
    """5 个生产文件中所有 product 类型报告都能正确解析 advertised_asin"""

    @pytest.mark.parametrize("filename,product_field_col,value,expected_asin", [
        # 广告数据.xlsx：'广告'列格式 B0XXX/SKU
        ("广告数据.xlsx", "广告", "B0C4GHGWRC/USA-A-341", "B0C4GHGWRC"),
        # 商品投放数据.xlsx：'商品投放'列格式 asin = B0XXX
        ("商品投放数据.xlsx", "商品投放", "asin = B0CDPNGTN8", "B0CDPNGTN8"),
    ])
    def test_prod_product_files_asin_parsed(
        self, filename, product_field_col, value, expected_asin
    ):
        """模拟生产文件场景，验证 advertised_asin 解析正确"""
        row = {
            "站点/店铺": "US/A",
            product_field_col: value,
            "广告活动": "Test-Campaign",
            "广告花费": 10.0,
            "曝光": 100,
            "点击": 5,
        }
        data = _build_daily_row_data(row, "product", target_date=date(2026, 7, 20))
        assert data["advertised_asin"] == expected_asin, (
            f"{filename} 解析失败：期望 {expected_asin}，实际 {data.get('advertised_asin')}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
