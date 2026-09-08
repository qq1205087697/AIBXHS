"""
广告报表导入文件校验 TDD 测试

业务规则（参见 routers/ads.py / 项目约束）:
    上传文件必须满足：
    1. 扩展名为 .xlsx 或 .xls
    2. 文件大小 ≤ 10MB (10 * 1024 * 1024 bytes)
    3. 文件内容非空

校验失败的应答：
    - HTTP 400
    - 错误信息明确指出失败原因（扩展名 / 大小 / 空文件）

校验通过：
    - 进入导入服务（本测试 mock 掉导入服务，不验证导入流程本身）

参考: routers/local_inventory.py 中 _validate_upload_file 的现有模式。
"""
from __future__ import annotations

import sys
import os
from datetime import timedelta
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
from services.auth_service import get_password_hash, create_access_token


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


# ==================== SQLite 全局索引名冲突绕过 ====================
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
def test_tenant(db_session: Session) -> Tenant:
    tenant = Tenant(name="Test Tenant", code="test-tenant-ads-import-001")
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


@pytest.fixture(scope="function")
def test_user(db_session: Session, test_tenant: Tenant) -> User:
    user = User(
        tenant_id=test_tenant.id,
        username="adsimporter",
        email="adsimporter@example.com",
        password_hash=get_password_hash("adpassword"),
        nickname="Ad Importer",
        role_id=None,
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def auth_headers(test_user: User) -> dict:
    token = create_access_token(
        data={"sub": test_user.username},
        expires_delta=timedelta(minutes=30),
    )
    return {"Authorization": f"Bearer {token}"}


# ==================== 工具函数 ====================

def _make_file(payload: bytes, filename: str, content_type: str = "application/octet-stream"):
    """构造 TestClient 用的 files 参数"""
    return {"file": (filename, payload, content_type)}


# ==================== 测试：扩展名校验 ====================

class TestFileExtensionValidation:
    """扩展名非 .xlsx/.xls 的文件应返回 400"""

    def test_txt_file_rejected(self, client: TestClient, auth_headers: dict):
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(b"hello,world", "data.txt", "text/plain"),
        )
        assert r.status_code == 400, f"应拒绝 .txt 文件，实际 {r.status_code}: {r.text}"
        assert "xlsx" in r.text.lower() or "xls" in r.text.lower(), (
            f"错误信息应说明支持的扩展名，实际: {r.text}"
        )

    def test_csv_file_rejected(self, client: TestClient, auth_headers: dict):
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(b"a,b,c\n1,2,3\n", "data.csv", "text/csv"),
        )
        assert r.status_code == 400, f"应拒绝 .csv 文件，实际 {r.status_code}: {r.text}"

    def test_exe_file_rejected(self, client: TestClient, auth_headers: dict):
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(b"\x4d\x5a\x90\x00", "malware.exe", "application/x-msdownload"),
        )
        assert r.status_code == 400, f"应拒绝 .exe 文件，实际 {r.status_code}: {r.text}"

    def test_no_extension_rejected(self, client: TestClient, auth_headers: dict):
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(b"whatever", "noextension", "application/octet-stream"),
        )
        assert r.status_code == 400, f"应拒绝无扩展名文件，实际 {r.status_code}: {r.text}"

    def test_double_extension_rejected(self, client: TestClient, auth_headers: dict):
        """恶意双扩展名如 report.xlsx.exe 应被拒绝"""
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(b"fake", "report.xlsx.exe", "application/x-msdownload"),
        )
        assert r.status_code == 400, f"应拒绝双扩展名伪装文件，实际 {r.status_code}: {r.text}"


# ==================== 测试：文件大小校验 ====================

class TestFileSizeValidation:
    """文件大小超过 10MB 应返回 400"""

    def test_oversize_file_rejected(self, client: TestClient, auth_headers: dict):
        # 构造 11MB 的文件内容
        big_payload = b"\x00" * (11 * 1024 * 1024)
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(big_payload, "huge.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        )
        assert r.status_code == 400, f"应拒绝 >10MB 文件，实际 {r.status_code}: {r.text}"
        assert "10" in r.text and ("mb" in r.text.lower() or "MB" in r.text), (
            f"错误信息应说明大小限制 10MB，实际: {r.text}"
        )

    def test_empty_file_rejected(self, client: TestClient, auth_headers: dict):
        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(b"", "empty.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        )
        # 空文件应该被拒绝（要么 400 校验失败，要么 400 导入服务解析失败）
        assert r.status_code in (400, 422), (
            f"应拒绝空文件，实际 {r.status_code}: {r.text}"
        )


# ==================== 测试：合法文件应通过校验层 ====================

class TestValidFilePassesValidation:
    """合法文件应通过校验，进入导入服务（mock 掉导入服务）"""

    def test_valid_xlsx_passes_validation(
        self, client: TestClient, auth_headers: dict, monkeypatch
    ):
        """合法 .xlsx 文件应通过文件校验层（不被 400 拒绝）"""
        # Mock 导入服务，避免依赖真实 Excel 解析
        from services import ad_import_service

        def _fake_start(file_content, filename, tenant_id, report_date=None):
            return {"task_id": "fake-task-id", "status": "已启动"}

        monkeypatch.setattr(ad_import_service, "start_ad_import_async", _fake_start)

        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(
                b"PK\x03\x04fake-xlsx-content",
                "report.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
        )
        assert r.status_code == 200, (
            f"合法 .xlsx 文件应通过校验（200），实际 {r.status_code}: {r.text}"
        )
        assert r.json()["success"] is True

    def test_valid_xls_passes_validation(
        self, client: TestClient, auth_headers: dict, monkeypatch
    ):
        """合法 .xls 文件应通过文件校验层"""
        from services import ad_import_service

        def _fake_start(file_content, filename, tenant_id, report_date=None):
            return {"task_id": "fake-task-id", "status": "已启动"}

        monkeypatch.setattr(ad_import_service, "start_ad_import_async", _fake_start)

        r = client.post(
            "/api/ads/import",
            headers=auth_headers,
            files=_make_file(
                b"\xd0\xcf\x11\xe0fake-xls-content",
                "report.xls",
                "application/vnd.ms-excel",
            ),
        )
        assert r.status_code == 200, (
            f"合法 .xls 文件应通过校验（200），实际 {r.status_code}: {r.text}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
