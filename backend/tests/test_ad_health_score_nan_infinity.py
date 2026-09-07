"""
广告健康分计算 NaN/Infinity 处理 TDD 测试

业务规则（参见 services/ad_health_score.py）:
    健康分计算必须输出可 JSON 序列化的结果（不含 NaN/Infinity），
    否则前端 / 影刀 RPA 反序列化会失败。

NaN/Infinity 来源（生产中真实存在的风险）:
    1. MySQL DECIMAL 字段意外返回 NaN/Inf（极端数据/驱动 bug）
    2. 派生指标除法：spend/0、sales/0 等
       - 服务内对分母 == 0 有保护，但对极小非零值（1e-300）会产生 inf
    3. budget_utilization 反推：spend / avg_util，avg_util 来自 AVG 可能返回极小值
    4. 上游 ETL 写入了 NaN/Inf（Excel 解析失败时的脏值）

校验要求:
    - _extract_metrics: NaN/Inf 字段 → 0.0
    - _calculate: NaN/Inf 指标 → 视为 0.0 评分（不污染总分）
    - calculate_campaign: 整体返回 dict 必须 json.dumps 成功
    - calculate_overall: 整体返回 dict 必须 json.dumps 成功
"""
from __future__ import annotations

import sys
import os
import json
import math
from datetime import date, timedelta
from typing import Generator
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, event, Float, Numeric, Date
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from services.auth_service import get_password_hash, create_access_token
from services.ad_health_score import AdHealthScoreService


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
        "ad_report_snapshots",
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
    tenant = Tenant(name="Test Tenant", code="test-tenant-health-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


@pytest.fixture(scope="function")
def service() -> AdHealthScoreService:
    return AdHealthScoreService()


# ==================== 工具函数 ====================

def _is_json_serializable(obj) -> bool:
    """检查对象是否能被 json.dumps 序列化（NaN/Inf 不能）"""
    try:
        json.dumps(obj, allow_nan=False)
        return True
    except (ValueError, TypeError):
        return False


def _make_mock_record(**overrides) -> MagicMock:
    """构造一个模拟的 AdReportSnapshot 记录，所有字段默认 0"""
    defaults = {
        "spend": 0.0,
        "sales": 0.0,
        "clicks": 0,
        "impressions": 0,
        "orders": 0,
        "budget_utilization": 0.0,
        "acos": 0.0,
        "roas": 0.0,
        "ctr": 0.0,
        "cvr": 0.0,
        "cpc": 0.0,
        "campaign_name": "Test Campaign",
    }
    defaults.update(overrides)
    record = MagicMock()
    for k, v in defaults.items():
        setattr(record, k, v)
    return record


# ==================== 测试：_extract_metrics 处理 NaN/Inf ====================

class TestExtractMetricsHandlesNaNInfinity:
    """_extract_metrics 应将 NaN/Inf 字段清洗为 0.0"""

    def test_nan_acos_returns_zero(self, service: AdHealthScoreService):
        """record.acos = NaN 时，metrics.acos 应为 0.0，而非 NaN"""
        record = _make_mock_record(acos=float("nan"))
        metrics = service._extract_metrics(record)
        assert not math.isnan(metrics["acos"]), "acos 不应为 NaN，应清洗为 0.0"
        assert metrics["acos"] == 0.0

    def test_inf_roas_returns_zero(self, service: AdHealthScoreService):
        """record.roas = Inf 时，metrics.roas 应为 0.0，而非 Inf"""
        record = _make_mock_record(roas=float("inf"))
        metrics = service._extract_metrics(record)
        assert not math.isinf(metrics["roas"]), "roas 不应为 Inf"
        assert metrics["roas"] == 0.0

    def test_neg_inf_ctr_returns_zero(self, service: AdHealthScoreService):
        """record.ctr = -Inf 时，metrics.ctr 应为 0.0"""
        record = _make_mock_record(ctr=float("-inf"))
        metrics = service._extract_metrics(record)
        assert not math.isinf(metrics["ctr"]), "ctr 不应为 -Inf"
        assert metrics["ctr"] == 0.0

    def test_nan_cpc_returns_zero(self, service: AdHealthScoreService):
        """record.cpc = NaN 时，metrics.cpc 应为 0.0"""
        record = _make_mock_record(cpc=float("nan"))
        metrics = service._extract_metrics(record)
        assert not math.isnan(metrics["cpc"])
        assert metrics["cpc"] == 0.0

    def test_nan_budget_utilization_returns_zero(self, service: AdHealthScoreService):
        """record.budget_utilization = NaN 时，metrics.budget_utilization 应为 0.0"""
        record = _make_mock_record(budget_utilization=float("nan"))
        metrics = service._extract_metrics(record)
        assert not math.isnan(metrics["budget_utilization"])
        assert metrics["budget_utilization"] == 0.0

    def test_all_metrics_json_serializable_when_record_has_nan(self, service: AdHealthScoreService):
        """当所有字段都是 NaN 时，metrics 应全部可 JSON 序列化"""
        record = _make_mock_record(
            acos=float("nan"),
            roas=float("inf"),
            ctr=float("-inf"),
            cvr=float("nan"),
            cpc=float("inf"),
            budget_utilization=float("nan"),
        )
        metrics = service._extract_metrics(record)
        assert _is_json_serializable(metrics), (
            f"metrics 含 NaN/Inf，无法 JSON 序列化: {metrics}"
        )


# ==================== 测试：_calculate 结果可序列化 ====================

class TestCalculateHandlesNaNInfinity:
    """_calculate 应保证结果不含 NaN/Inf，且可 JSON 序列化"""

    def test_calculate_with_nan_metrics_returns_serializable(self, service: AdHealthScoreService):
        """metrics 含 NaN/Inf 时，_calculate 返回结果应可 JSON 序列化"""
        metrics = {
            "acos": float("nan"),
            "roas": float("inf"),
            "ctr": float("-inf"),
            "cvr": float("nan"),
            "budget_utilization": float("inf"),
            "cpc": float("nan"),
        }
        result = service._calculate(metrics)
        assert _is_json_serializable(result), (
            f"健康分结果含 NaN/Inf，无法 JSON 序列化: {result}"
        )

    def test_calculate_with_nan_metrics_score_is_int(self, service: AdHealthScoreService):
        """metrics 含 NaN 时，score 应为有限整数"""
        metrics = {
            "acos": float("nan"),
            "roas": float("nan"),
            "ctr": float("nan"),
            "cvr": float("nan"),
            "budget_utilization": float("nan"),
            "cpc": float("nan"),
        }
        result = service._calculate(metrics)
        assert math.isfinite(result["score"]), f"score 不应为 NaN/Inf: {result['score']}"
        assert isinstance(result["score"], (int, float))

    def test_calculate_with_inf_metrics_returns_serializable(self, service: AdHealthScoreService):
        """metrics 全 Inf 时，结果可序列化"""
        metrics = {k: float("inf") for k in ["acos", "roas", "ctr", "cvr", "budget_utilization", "cpc"]}
        result = service._calculate(metrics)
        assert _is_json_serializable(result)


# ==================== 测试：calculate_campaign 端到端 ====================

class TestCalculateCampaignEndToEnd:
    """calculate_campaign 整体流程应输出可序列化结果"""

    def test_calculate_campaign_with_nan_record(
        self, db_session: Session, test_tenant: Tenant, service: AdHealthScoreService
    ):
        """当数据库记录含 NaN/Inf 时，calculate_campaign 返回可序列化 dict"""
        from models.ad_report import AdReportSnapshot
        # 构造一条含 NaN/Inf 的记录（用 Python 端注入，绕过 SQLite 类型检查）
        record = AdReportSnapshot(
            tenant_id=test_tenant.id,
            report_type="campaign",
            campaign_name="Bad-Data-Campaign",
            date=date.today(),
            spend=100.0,
            sales=200.0,
            clicks=10,
            impressions=1000,
            orders=2,
            # 关键：派生指标为 NaN/Inf（模拟 ETL 脏数据）
            acos=float("nan"),
            roas=float("inf"),
            ctr=float("nan"),
            cvr=float("inf"),
            cpc=float("nan"),
            budget_utilization=float("nan"),
        )
        db_session.add(record)
        db_session.commit()

        result = service.calculate_campaign(
            db=db_session,
            tenant_id=test_tenant.id,
            campaign_id="Bad-Data-Campaign",
            evaluation_date=date.today(),
        )
        assert _is_json_serializable(result), (
            f"calculate_campaign 结果含 NaN/Inf，无法 JSON 序列化: {result}"
        )
        assert math.isfinite(result["score"]), (
            f"score 应为有限数: {result['score']}"
        )

    def test_calculate_campaign_with_zero_division_safe(
        self, db_session: Session, test_tenant: Tenant, service: AdHealthScoreService
    ):
        """spend=0, sales=0, clicks=0, impressions=0 时不抛异常，结果可序列化"""
        from models.ad_report import AdReportSnapshot
        record = AdReportSnapshot(
            tenant_id=test_tenant.id,
            report_type="campaign",
            campaign_name="Zero-Campaign",
            date=date.today(),
            spend=0.0,
            sales=0.0,
            clicks=0,
            impressions=0,
            orders=0,
            acos=None,
            roas=None,
            ctr=None,
            cvr=None,
            cpc=None,
            budget_utilization=None,
        )
        db_session.add(record)
        db_session.commit()

        result = service.calculate_campaign(
            db=db_session,
            tenant_id=test_tenant.id,
            campaign_id="Zero-Campaign",
            evaluation_date=date.today(),
        )
        assert _is_json_serializable(result), (
            f"零值场景结果含 NaN/Inf: {result}"
        )
        assert math.isfinite(result["score"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
