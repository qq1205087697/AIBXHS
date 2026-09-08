"""
广告建议状态机 TDD 测试

业务规则（参见 routers/ad_suggestions.py 顶部注释）：
    待处理 → 已确认 → 已执行 / 已忽略 / 已失效

合法转换：
    待处理 → 已确认 / 已忽略 / 已失效
    已确认 → 已执行 / 已忽略 / 已失效
    已执行 → （终态，不可再转换）
    已忽略 → （终态，不可再转换）
    已失效 → （终态，不可再转换）

非法转换（应被拒绝，返回 400）：
    待处理 → 已执行（必须先确认）
    已执行 → 已确认（终态不可复活）
    已执行 → 已执行（重复执行）
    已忽略 → 已确认
    已失效 → 已执行
"""
from __future__ import annotations

import sys
import os
from datetime import date, datetime
from typing import Generator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from models.ad_daily import AdOptimizationSuggestion
from services.auth_service import get_password_hash, create_access_token

# 项目中部分表引用了不存在的表（项目技术债）：
# - purchase_orders.store_group_id → store_groups
# - users.role_id → roles
# 这里在 Base.metadata 中注册哑表，让 FK 在 Python 层面能解析、create_all 能成功
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


# SQLite 索引名是全局唯一的，但项目模型在多张表上用了同名索引（idx_tenant_date 等），
# 在 MySQL 下不暴露（MySQL 索引名是表内唯一）。测试不需要索引验证，
# 直接在 Table 级别监听 before_create，临时清空 indexes 列表绕过冲突。
@event.listens_for(Table, "before_create")
def _skip_index_creation(target, connection, **kw):
    """跳过索引创建，避免 SQLite 全局索引名冲突"""
    if hasattr(target, "indexes") and target.indexes:
        target._test_original_indexes = list(target.indexes)
        target.indexes = []


@event.listens_for(Table, "after_create")
def _restore_indexes(target, connection, **kw):
    """恢复 indexes 列表（不影响后续测试）"""
    if hasattr(target, "_test_original_indexes"):
        target.indexes = target._test_original_indexes
        del target._test_original_indexes

# 复用 test_chat.py 的内存数据库模式，但每个测试函数用独立 engine
# 避免索引名冲突（项目模型中多张表用了同名索引 idx_tenant_date 等，SQLite 索引名全局）
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
    """每个测试独立 engine + 独立内存库，互不影响。

    只创建本测试需要的表（避免项目模型中同名索引 idx_tenant_date 等在 SQLite
    全局索引命名空间下冲突——这是项目模型设计问题，生产用 MySQL 不会暴露）。
    """
    engine = _make_engine()

    # 只创建本测试需要的表（含 FK 依赖）
    needed_tables = [
        "tenants", "users", "roles", "store_groups",
        "ad_optimization_suggestion", "ad_execution_log",
    ]
    tables_to_create = [
        t for name, t in Base.metadata.tables.items() if name in needed_tables
    ]
    Base.metadata.create_all(bind=engine, tables=tables_to_create)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()

    # 替换 app 的 get_db 依赖，指向本测试的 session factory
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
def client(db_session: Session) -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="function")
def test_tenant(db_session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant", code="test-tenant-ad-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


@pytest.fixture(scope="function")
def test_user(db_session: Session, test_tenant: Tenant) -> User:
    user = User(
        tenant_id=test_tenant.id,
        username="aduser",
        email="aduser@example.com",
        password_hash=get_password_hash("adpassword"),
        nickname="Ad User",
        role_id=None,
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def auth_headers(test_user: User) -> dict:
    from datetime import timedelta
    token = create_access_token(
        data={"sub": test_user.username},
        expires_delta=timedelta(minutes=30),
    )
    return {"Authorization": f"Bearer {token}"}


def _create_suggestion(db: Session, tenant_id: int, status: str = "待处理") -> AdOptimizationSuggestion:
    """创建一条测试建议"""
    sug = AdOptimizationSuggestion(
        tenant_id=tenant_id,
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
        status=status,
        created_by=0,
        evaluation_date=date(2026, 7, 20),
    )
    db.add(sug)
    db.commit()
    db.refresh(sug)
    return sug


# ==================== 合法转换测试 ====================

class TestLegalTransitions:
    """合法状态转换应返回 200"""

    def test_pending_to_confirmed(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        sug = _create_suggestion(db_session, test_tenant.id, "待处理")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已确认"})
        assert r.status_code == 200
        assert r.json()["data"]["current_status"] == "已确认"

    def test_pending_to_ignored(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        sug = _create_suggestion(db_session, test_tenant.id, "待处理")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已忽略"})
        assert r.status_code == 200
        assert r.json()["data"]["current_status"] == "已忽略"

    def test_pending_to_expired(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        sug = _create_suggestion(db_session, test_tenant.id, "待处理")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已失效"})
        assert r.status_code == 200
        assert r.json()["data"]["current_status"] == "已失效"

    def test_confirmed_to_executed(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        sug = _create_suggestion(db_session, test_tenant.id, "已确认")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已执行"})
        assert r.status_code == 200
        assert r.json()["data"]["current_status"] == "已执行"

    def test_confirmed_to_ignored(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        sug = _create_suggestion(db_session, test_tenant.id, "已确认")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已忽略"})
        assert r.status_code == 200

    def test_confirmed_to_expired(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        sug = _create_suggestion(db_session, test_tenant.id, "已确认")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已失效"})
        assert r.status_code == 200


# ==================== 非法转换测试（应被拒绝） ====================

class TestIllegalTransitions:
    """非法状态转换应返回 400，且不应修改建议状态"""

    def test_pending_cannot_skip_to_executed(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """待处理不可直接跳到已执行，必须先确认"""
        sug = _create_suggestion(db_session, test_tenant.id, "待处理")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已执行"})
        assert r.status_code == 400
        # 状态不应被修改
        db_session.expire_all()
        fresh = db_session.query(AdOptimizationSuggestion).filter_by(id=sug.id).first()
        assert fresh.status == "待处理"

    def test_executed_cannot_revert_to_confirmed(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """已执行是终态，不可回退到已确认"""
        sug = _create_suggestion(db_session, test_tenant.id, "已执行")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已确认"})
        assert r.status_code == 400
        db_session.expire_all()
        fresh = db_session.query(AdOptimizationSuggestion).filter_by(id=sug.id).first()
        assert fresh.status == "已执行"

    def test_executed_cannot_re_execute(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """已执行不可重复执行"""
        sug = _create_suggestion(db_session, test_tenant.id, "已执行")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已执行"})
        assert r.status_code == 400

    def test_ignored_cannot_revert_to_confirmed(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """已忽略是终态，不可回退"""
        sug = _create_suggestion(db_session, test_tenant.id, "已忽略")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已确认"})
        assert r.status_code == 400

    def test_expired_cannot_execute(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """已失效不可再执行"""
        sug = _create_suggestion(db_session, test_tenant.id, "已失效")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已执行"})
        assert r.status_code == 400

    def test_executed_cannot_be_ignored(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """已执行终态不可再转已忽略"""
        sug = _create_suggestion(db_session, test_tenant.id, "已执行")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已忽略"})
        assert r.status_code == 400


# ==================== 重复执行不应产生多条日志测试 ====================

class TestExecutionLogCreation:
    """已执行终态保护：避免重复创建 AdExecutionLog"""

    def test_legal_execution_creates_one_log(self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict):
        """合法的已确认→已执行应创建恰好 1 条日志"""
        from models.ad_daily import AdExecutionLog
        sug = _create_suggestion(db_session, test_tenant.id, "已确认")
        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已执行"})
        assert r.status_code == 200
        logs = db_session.query(AdExecutionLog).filter_by(suggestion_id=sug.id).all()
        assert len(logs) == 1

    def test_blocked_re_execution_creates_no_additional_log(
        self, client: TestClient, db_session: Session, test_tenant: Tenant, auth_headers: dict
    ):
        """非法的重复执行被拒绝后，不应再创建日志"""
        from models.ad_daily import AdExecutionLog
        sug = _create_suggestion(db_session, test_tenant.id, "已执行")
        # 之前已执行过 1 次（手动构造）—— 模拟重复执行
        existing_log = AdExecutionLog(
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
            execution_time=datetime.now(),
        )
        db_session.add(existing_log)
        db_session.commit()

        r = client.put(f"/api/ad-suggestions/{sug.id}/status", headers=auth_headers, json={"status": "已执行"})
        assert r.status_code == 400
        logs = db_session.query(AdExecutionLog).filter_by(suggestion_id=sug.id).all()
        assert len(logs) == 1  # 没有新增


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
