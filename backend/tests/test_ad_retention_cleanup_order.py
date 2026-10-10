"""
广告数据保留策略清理顺序 TDD 测试

业务规则（参见 ad_retention_service.py 顶部注释）：
    清理顺序：子表先于主表

依赖关系：
    AdExecutionLog.suggestion_id → AdOptimizationSuggestion.id (FK RESTRICT)

错误顺序（当前实现）：
    1. ad_optimization_suggestion（父表）
    2. ad_execution_log（子表）
    → 父表先删时，若子表存在 FK 引用，会触发外键约束错误

正确顺序应为：
    1. ad_execution_log（子表先删）
    2. ad_optimization_suggestion（父表后删）
"""
from __future__ import annotations

import sys
import os
from datetime import date, datetime, timedelta
from typing import Generator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, event, Date, Text, ForeignKey
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from models.ad_daily import AdOptimizationSuggestion, AdExecutionLog
from services.auth_service import get_password_hash, create_access_token

# 项目技术债：注册哑表
for _tbl, _cols in [
    ("store_groups", ["name", "code", "tenant_id"]),
    ("roles", ["name", "code", "tenant_id"]),
    ("stores", ["name", "code", "country", "tenant_id"]),
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


# SQLite 全局索引名冲突绕过
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
    """每个测试独立 engine + 独立内存库"""
    engine = _make_engine()
    # 启用 SQLite FK 约束（默认关闭）
    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_conn, conn_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    needed_tables = [
        "tenants", "users", "roles", "store_groups", "stores",
        "ad_optimization_suggestion", "ad_execution_log",
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
    tenant = Tenant(name="Test Tenant", code="test-tenant-retention-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


# ==================== 测试：清理顺序正确性 ====================

class TestCleanupOrder:
    """清理顺序必须子表先于父表，避免 FK 冲突"""

    def test_cleanup_order_is_child_before_parent(self):
        """ad_execution_log（子表）必须在 ad_optimization_suggestion（父表）之前清理"""
        from services.ad_retention_service import CLEANUP_TABLES

        table_names_in_order = [t["table_name"] for t in CLEANUP_TABLES]

        # 子表必须出现在父表之前
        child_idx = table_names_in_order.index("ad_execution_log")
        parent_idx = table_names_in_order.index("ad_optimization_suggestion")

        assert child_idx < parent_idx, (
            f"清理顺序错误：ad_execution_log（子表）应在 ad_optimization_suggestion（父表）之前。"
            f"当前顺序：{table_names_in_order}"
        )

    def test_cleanup_with_existing_fk_reference_succeeds(
        self, db_session: Session, test_tenant: Tenant
    ):
        """当存在 AdExecutionLog 引用 AdOptimizationSuggestion 时，清理不应因 FK 约束失败。

        注意：SQLite 不支持 DELETE...LIMIT 语法（生产用 MySQL 支持），所以本测试
        只验证清理顺序正确时不会因 FK 冲突失败——通过 mock _cleanup_table 为
        普通 DELETE 实现，验证顺序正确性。
        """
        from services.ad_retention_service import cleanup_expired_data, _cleanup_table
        from unittest.mock import patch

        old_date = date.today() - timedelta(days=120)

        sug = AdOptimizationSuggestion(
            tenant_id=test_tenant.id,
            rule_name="acos_too_high",
            rule_priority="高",
            rule_version="v1",
            target_type="campaign",
            target_id="camp-001",
            target_name="Test Campaign",
            current_value=0.45,
            threshold=0.30,
            suggestion_action="降低竞价",
            suggestion_reason="ACOS 过高",
            status="已执行",
            created_by=0,
            evaluation_date=old_date,
        )
        db_session.add(sug)
        db_session.commit()
        db_session.refresh(sug)

        log = AdExecutionLog(
            tenant_id=test_tenant.id,
            suggestion_id=sug.id,
            rule_name=sug.rule_name,
            action=sug.suggestion_action,
            target_type=sug.target_type,
            target_id=sug.target_id,
            target_name=sug.target_name,
            result="",
            status="成功",
            executed_by=1,
            execution_time=datetime.combine(old_date, datetime.min.time()),
        )
        db_session.add(log)
        db_session.commit()

        # 在 cleanup 调用前捕获 ID（cleanup 内的 db.commit() 会让实例过期，
        # 之后访问 .id 会触发刷新并抛 ObjectDeletedError）
        sug_id = sug.id
        log_id = log.id

        # 用普通 DELETE 替代 DELETE...LIMIT（SQLite 兼容）
        def _sqlite_compatible_cleanup(db, table_name, date_column, date_type, cutoff_value, tenant_id=None):
            import re
            from sqlalchemy import text as _text
            if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
                return {"table": table_name, "deleted": 0, "error": f"非法表名: {table_name}"}
            if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", date_column):
                return {"table": table_name, "deleted": 0, "error": f"非法列名: {date_column}"}

            tenant_clause = "AND tenant_id = :tid" if tenant_id is not None else ""
            params = {"cutoff": cutoff_value}
            if tenant_id is not None:
                params["tid"] = tenant_id

            try:
                delete_sql = _text(
                    f"DELETE FROM {table_name} "
                    f"WHERE {date_column} IS NOT NULL AND {date_column} < :cutoff {tenant_clause}"
                )
                result = db.execute(delete_sql, params)
                db.commit()
                return {"table": table_name, "deleted": result.rowcount or 0, "error": None}
            except Exception as e:
                db.rollback()
                return {"table": table_name, "deleted": 0, "error": str(e)}

        with patch("services.ad_retention_service._cleanup_table", side_effect=_sqlite_compatible_cleanup):
            result = cleanup_expired_data(db_session, tenant_id=test_tenant.id, retention_days=90)

        sug_result = next(r for r in result["tables"] if r["table"] == "ad_optimization_suggestion")
        log_result = next(r for r in result["tables"] if r["table"] == "ad_execution_log")

        assert log_result["error"] is None, f"清理子表 ad_execution_log 失败: {log_result['error']}"
        assert sug_result["error"] is None, (
            f"清理父表 ad_optimization_suggestion 失败（可能因 FK 冲突）: {sug_result['error']}"
        )
        assert sug_result["deleted"] == 1, f"父表应删除 1 条，实际 {sug_result['deleted']}"
        assert log_result["deleted"] == 1, f"子表应删除 1 条，实际 {log_result['deleted']}"

        db_session.expire_all()
        assert db_session.query(AdOptimizationSuggestion).filter_by(id=sug_id).first() is None
        assert db_session.query(AdExecutionLog).filter_by(id=log_id).first() is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
