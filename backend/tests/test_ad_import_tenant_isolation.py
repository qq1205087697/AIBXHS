"""
广告导入任务跨租户状态隔离 TDD 测试

业务规则（参见 services/ad_import_service.py）:
    导入任务状态必须按租户隔离：
    1. 不同租户的导入任务互不阻塞（可并发）
    2. 同一租户内同时只允许一个导入任务
    3. 查询状态时只返回当前租户的状态，不泄漏其他租户信息

当前缺陷：
    _import_status 是全局单例 dict，导致：
    - 跨租户阻塞（A 导入中，B 启动失败）
    - 信息泄漏（B 能查到 A 的导入状态）
    - 同租户重复启动校验缺失（若 A 启动后立刻又启动，会被覆盖）

参考项目约束:
    - All database queries for multi-tenant operations must include explicit
      tenant_id filtering to prevent data leakage
    - tenant_id must not be hardcoded in any service function; must be passed
      from authenticated endpoints
"""
from __future__ import annotations

import sys
import os
import time
import threading
from datetime import timedelta
from typing import Generator
from unittest.mock import patch

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
from services.auth_service import get_password_hash, create_access_token
from services import ad_import_service


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
    needed_tables = ["tenants", "users", "roles", "store_groups"]
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
def client(db_session: Session) -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="function")
def reset_import_status():
    """每个测试前重置全局导入状态（隔离测试）"""
    # 备份原状态，测试后恢复
    original = ad_import_service._import_status.copy()
    ad_import_service._import_status.clear()
    ad_import_service._import_status.update({
        "running": False,
        "task_id": None,
        "progress": 0,
        "total": 0,
        "message": "",
        "error": None,
    })
    yield
    ad_import_service._import_status.clear()
    ad_import_service._import_status.update(original)


@pytest.fixture(scope="function")
def test_tenant_a(db_session: Session) -> Tenant:
    tenant = Tenant(name="Tenant A", code="test-tenant-import-a-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


@pytest.fixture(scope="function")
def test_tenant_b(db_session: Session) -> Tenant:
    tenant = Tenant(name="Tenant B", code="test-tenant-import-b-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


def _make_user(db: Session, tenant: Tenant, username: str) -> User:
    user = User(
        tenant_id=tenant.id,
        username=username,
        email=f"{username}@example.com",
        password_hash=get_password_hash("password"),
        nickname=username,
        role_id=None,
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture(scope="function")
def user_a(db_session: Session, test_tenant_a: Tenant) -> User:
    return _make_user(db_session, test_tenant_a, "user_a")


@pytest.fixture(scope="function")
def user_b(db_session: Session, test_tenant_b: Tenant) -> User:
    return _make_user(db_session, test_tenant_b, "user_b")


def _auth_headers(user: User) -> dict:
    token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=30),
    )
    return {"Authorization": f"Bearer {token}"}


def _mock_import_noop(*args, **kwargs):
    """模拟后台导入线程：什么都不做，但保持 running=True 永久（测试可控）"""
    # 不修改任何状态，让 start_ad_import_async 设置的 running=True 保留
    pass


# ==================== 测试：跨租户不阻塞 ====================

class TestCrossTenantNoBlocking:
    """不同租户的导入任务互不阻塞"""

    def test_tenant_b_can_start_while_tenant_a_running(
        self, reset_import_status, test_tenant_a, test_tenant_b
    ):
        """租户 A 任务运行中时，租户 B 仍能启动自己的导入任务"""
        with patch.object(ad_import_service, "_import_ad_excel", _mock_import_noop):
            # 租户 A 启动
            result_a = ad_import_service.start_ad_import_async(
                file_content=b"fake-a",
                filename="report_a.xlsx",
                tenant_id=test_tenant_a.id,
            )
            assert result_a["task_id"] is not None

            # 租户 B 启动（不应被 A 阻塞）
            result_b = ad_import_service.start_ad_import_async(
                file_content=b"fake-b",
                filename="report_b.xlsx",
                tenant_id=test_tenant_b.id,
            )
            assert result_b["task_id"] is not None, (
                f"租户 B 应能启动导入任务，实际返回: {result_b}"
            )
            assert result_b["task_id"] != result_a["task_id"], (
                "不同租户的任务 ID 必须不同"
            )

    def test_same_tenant_blocked_while_running(
        self, reset_import_status, test_tenant_a
    ):
        """同一租户 A 任务运行中时，再次启动应被拒绝（同租户去重）"""
        with patch.object(ad_import_service, "_import_ad_excel", _mock_import_noop):
            # 第一次启动
            result_1 = ad_import_service.start_ad_import_async(
                file_content=b"fake",
                filename="r1.xlsx",
                tenant_id=test_tenant_a.id,
            )
            assert result_1["task_id"] is not None

            # 同租户第二次启动 - 应被拒绝
            result_2 = ad_import_service.start_ad_import_async(
                file_content=b"fake",
                filename="r2.xlsx",
                tenant_id=test_tenant_a.id,
            )
            # 应返回与第一次相同的 task_id + 阻塞提示
            assert result_2["task_id"] == result_1["task_id"], (
                f"同租户重复启动应返回原 task_id，实际: {result_2}"
            )
            assert "运行中" in result_2.get("message", "") or "已" in result_2.get("message", ""), (
                f"应提示已有任务运行中，实际: {result_2['message']}"
            )


# ==================== 测试：状态查询不泄漏 ====================

class TestStatusQueryNoLeakage:
    """状态查询必须按租户隔离，不泄漏其他租户信息"""

    def test_get_status_returns_only_current_tenant(
        self, reset_import_status, test_tenant_a, test_tenant_b
    ):
        """租户 A 查询状态不应看到租户 B 的任务"""
        with patch.object(ad_import_service, "_import_ad_excel", _mock_import_noop):
            # 租户 A 启动任务
            result_a = ad_import_service.start_ad_import_async(
                file_content=b"fake-a",
                filename="report_a.xlsx",
                tenant_id=test_tenant_a.id,
            )
            task_id_a = result_a["task_id"]

            # 租户 B 查询状态 - 应看不到 A 的任务
            status_b = ad_import_service.get_ad_import_status(tenant_id=test_tenant_b.id)
            assert status_b.get("task_id") != task_id_a, (
                f"租户 B 不应看到 A 的 task_id，实际: {status_b}"
            )
            # 租户 B 应该是空闲状态
            assert status_b.get("running") is False, (
                f"租户 B 应为非运行状态，实际: {status_b}"
            )

    def test_get_status_returns_own_task(
        self, reset_import_status, test_tenant_a, test_tenant_b
    ):
        """租户 A 查询状态应看到自己的任务，而非 B 的"""
        with patch.object(ad_import_service, "_import_ad_excel", _mock_import_noop):
            # 租户 A 启动
            result_a = ad_import_service.start_ad_import_async(
                file_content=b"fake-a",
                filename="report_a.xlsx",
                tenant_id=test_tenant_a.id,
            )
            task_id_a = result_a["task_id"]

            # 租户 B 启动
            result_b = ad_import_service.start_ad_import_async(
                file_content=b"fake-b",
                filename="report_b.xlsx",
                tenant_id=test_tenant_b.id,
            )
            task_id_b = result_b["task_id"]

            # 租户 A 查询 - 应只看到 A 的任务
            status_a = ad_import_service.get_ad_import_status(tenant_id=test_tenant_a.id)
            assert status_a.get("task_id") == task_id_a, (
                f"租户 A 应看到自己的 task_id={task_id_a}，实际: {status_a}"
            )

            # 租户 B 查询 - 应只看到 B 的任务
            status_b = ad_import_service.get_ad_import_status(tenant_id=test_tenant_b.id)
            assert status_b.get("task_id") == task_id_b, (
                f"租户 B 应看到自己的 task_id={task_id_b}，实际: {status_b}"
            )


# ==================== 测试：HTTP 端点按租户隔离 ====================

class TestHttpEndpointTenantIsolation:
    """/api/ads/import-status 必须只返回当前租户的状态"""

    def test_import_status_endpoint_filters_by_tenant(
        self, client: TestClient, reset_import_status,
        test_tenant_a, test_tenant_b, user_a, user_b
    ):
        """租户 B 调用 /import-status 不应看到租户 A 的运行任务"""
        with patch.object(ad_import_service, "_import_ad_excel", _mock_import_noop):
            # 租户 A 启动导入
            r = client.post(
                "/api/ads/import",
                headers=_auth_headers(user_a),
                files={"file": ("a.xlsx", b"fake", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )
            assert r.status_code == 200
            task_id_a = r.json()["data"]["task_id"]

            # 租户 B 查询状态
            r = client.get("/api/ads/import-status", headers=_auth_headers(user_b))
            assert r.status_code == 200
            data_b = r.json()["data"]
            assert data_b.get("task_id") != task_id_a, (
                f"租户 B 不应在 /import-status 看到 A 的 task_id，实际: {data_b}"
            )
            assert data_b.get("running") is False, (
                f"租户 B 应为非运行状态，实际: {data_b}"
            )

    def test_import_status_endpoint_returns_own_task(
        self, client: TestClient, reset_import_status,
        test_tenant_a, user_a
    ):
        """租户 A 调用 /import-status 应看到自己的运行任务"""
        with patch.object(ad_import_service, "_import_ad_excel", _mock_import_noop):
            r = client.post(
                "/api/ads/import",
                headers=_auth_headers(user_a),
                files={"file": ("a.xlsx", b"fake", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )
            task_id_a = r.json()["data"]["task_id"]

            r = client.get("/api/ads/import-status", headers=_auth_headers(user_a))
            assert r.status_code == 200
            data_a = r.json()["data"]
            assert data_a.get("task_id") == task_id_a, (
                f"租户 A 应看到自己的 task_id={task_id_a}，实际: {data_a}"
            )
            assert data_a.get("running") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
