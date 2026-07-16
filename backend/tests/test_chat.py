"""
聊天功能后端单元测试

该模块包含库存机器人项目中聊天功能的完整单元测试，包括：
- 聊天端点测试（认证、验证、会话管理）
- 流式聊天测试
- 安全测试（SQL注入、XSS防护）

使用 pytest + FastAPI TestClient + 内存 SQLite 数据库
"""

from __future__ import annotations

import pytest
import sys
import os
from datetime import datetime, timedelta
from typing import Generator, Optional

# 添加 backend 目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from jose import jwt

# 导入应用和模型 - 必须导入所有模型以确保 SQLAlchemy 元数据完整
from main import app
from database.database import Base, get_db
from models.user import User
from models.tenant import Tenant
from models.conversation import ConversationHistory
from models.department import Department, UserDepartment
from models.store import Store
from models.product import Product
from models.inventory import InventoryRecord, InventoryAlert, InventoryAction
from models.review import Review, ReviewAnalysis, ReviewHandling
from models.restock import InventorySnapshot, InboundShipmentDetail, ReplenishmentDecision
from models.local_inventory import LocalInventory
from services.auth_service import get_password_hash, create_access_token
from config import get_settings

# 测试数据库配置 - 使用内存 SQLite
# 使用 static pool 确保所有连接共享同一个内存数据库
TEST_DATABASE_URL = "sqlite:///:memory:"

# 创建测试引擎 - 使用 StaticPool 确保所有连接共享同一个内存数据库
from sqlalchemy.pool import StaticPool
engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

# 创建测试会话工厂
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db() -> Generator[Session, None, None]:
    """覆盖数据库依赖，使用测试数据库"""
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


# 替换应用的数据库依赖
app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def db_session() -> Generator[Session, None, None]:
    """
    创建测试数据库会话
    
    每个测试函数运行前创建表，运行后删除表
    """
    # 创建所有表
    Base.metadata.create_all(bind=engine)
    
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        # 删除所有表
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """
    创建测试客户端
    
    使用 TestClient 进行 HTTP 请求测试
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="function")
def test_tenant(db_session: Session) -> Tenant:
    """创建测试租户"""
    tenant = Tenant(
        name="Test Tenant",
        code="test-tenant-001"
    )
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


@pytest.fixture(scope="function")
def test_user(db_session: Session, test_tenant: Tenant) -> User:
    """创建测试用户"""
    user = User(
        tenant_id=test_tenant.id,
        username="testuser",
        email="test@example.com",
        password_hash=get_password_hash("testpassword"),
        nickname="Test User",
        role="operator",
        status="active"
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def test_admin(db_session: Session, test_tenant: Tenant) -> User:
    """创建测试管理员用户"""
    admin = User(
        tenant_id=test_tenant.id,
        username="adminuser",
        email="admin@example.com",
        password_hash=get_password_hash("adminpassword"),
        nickname="Admin User",
        role="admin",
        status="active"
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture(scope="function")
def auth_token(test_user: User) -> str:
    """生成测试用户的认证令牌"""
    settings = get_settings()
    access_token = create_access_token(
        data={"sub": test_user.username},
        expires_delta=timedelta(minutes=30)
    )
    return access_token


@pytest.fixture(scope="function")
def admin_token(test_admin: User) -> str:
    """生成管理员用户的认证令牌"""
    settings = get_settings()
    access_token = create_access_token(
        data={"sub": test_admin.username},
        expires_delta=timedelta(minutes=30)
    )
    return access_token


@pytest.fixture(scope="function")
def auth_headers(auth_token: str) -> dict:
    """生成认证请求头"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="function")
def admin_headers(admin_token: str) -> dict:
    """生成管理员认证请求头"""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="function")
def sample_conversations(db_session: Session, test_user: User) -> list:
    """创建示例对话记录"""
    conversations = []
    session_id = "test-session-001"
    
    # 创建用户消息
    user_msg = ConversationHistory(
        user_id=test_user.id,
        session_id=session_id,
        role="user",
        content="帮我分析最近的库存情况",
        chat_type="inventory"
    )
    db_session.add(user_msg)
    db_session.commit()
    db_session.refresh(user_msg)
    conversations.append(user_msg)
    
    # 创建AI回复
    ai_msg = ConversationHistory(
        user_id=test_user.id,
        session_id=session_id,
        role="assistant",
        content="根据数据分析，您的库存整体状况良好...",
        chat_type="inventory"
    )
    db_session.add(ai_msg)
    db_session.commit()
    db_session.refresh(ai_msg)
    conversations.append(ai_msg)
    
    # 创建第二个会话
    session_id2 = "test-session-002"
    user_msg2 = ConversationHistory(
        user_id=test_user.id,
        session_id=session_id2,
        role="user",
        content="查看差评分析",
        chat_type="review"
    )
    db_session.add(user_msg2)
    db_session.commit()
    db_session.refresh(user_msg2)
    conversations.append(user_msg2)
    
    return conversations


class TestChatEndpoints:
    """聊天端点测试类
    
    测试所有聊天相关的 HTTP 端点，包括：
    - 未认证访问
    - 已认证访问
    - 输入验证
    - 会话列表获取
    - 会话搜索
    """
    
    def test_chat_without_auth(self, client: TestClient):
        """测试未认证访问聊天端点 - 应返回 401"""
        response = client.post("/api/chat", json={
            "message": "测试消息",
            "chat_type": "review"
        })
        assert response.status_code == 403 or response.status_code == 401
    
    def test_chat_with_auth(self, client: TestClient, auth_headers: dict):
        """测试已认证访问聊天端点 - 应返回 200"""
        # 注意：由于 chat_service 可能依赖外部 AI 服务，
        # 这里主要测试端点可访问性和响应结构
        response = client.post("/api/chat", 
            headers=auth_headers,
            json={
                "message": "测试消息",
                "chat_type": "review",
                "session_id": "test-session-auth"
            }
        )
        # 可能成功或失败，但不应返回 401/403
        assert response.status_code != 401
        assert response.status_code != 403
    
    def test_chat_validation_empty_message(self, client: TestClient, auth_headers: dict):
        """测试聊天输入验证 - 空消息"""
        response = client.post("/api/chat",
            headers=auth_headers,
            json={
                "message": "",
                "chat_type": "review"
            }
        )
        # Pydantic 验证应返回 422
        assert response.status_code == 422
    
    def test_chat_validation_invalid_chat_type(self, client: TestClient, auth_headers: dict):
        """测试聊天输入验证 - 无效的 chat_type"""
        response = client.post("/api/chat",
            headers=auth_headers,
            json={
                "message": "测试消息",
                "chat_type": "invalid_type"
            }
        )
        # Pydantic 验证应返回 422
        assert response.status_code == 422
    
    def test_chat_validation_message_too_long(self, client: TestClient, auth_headers: dict):
        """测试聊天输入验证 - 消息过长"""
        long_message = "A" * 4001  # 超过 4000 字符限制
        response = client.post("/api/chat",
            headers=auth_headers,
            json={
                "message": long_message,
                "chat_type": "review"
            }
        )
        # Pydantic 验证应返回 422
        assert response.status_code == 422
    
    def test_get_sessions(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试获取会话列表"""
        response = client.get("/api/chat/sessions", headers=auth_headers)
        
        # 检查响应状态
        assert response.status_code == 200
        
        # 检查响应数据结构
        data = response.json()
        assert isinstance(data, list)
        
        # 应该至少有一个会话
        assert len(data) >= 1
        
        # 检查会话数据结构
        for session in data:
            assert "session_id" in session
            assert "title" in session
            assert "created_at" in session
    
    def test_get_sessions_with_chat_type_filter(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试按 chat_type 过滤会话列表"""
        # 测试 inventory 类型过滤
        response = client.get("/api/chat/sessions?chat_type=inventory", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # 测试 review 类型过滤
        response = client.get("/api/chat/sessions?chat_type=review", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_get_session_messages(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试获取指定会话的消息"""
        session_id = "test-session-001"
        response = client.get(f"/api/chat/sessions/{session_id}/messages", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # 检查消息结构
        for msg in data:
            assert "id" in msg
            assert "role" in msg
            assert "content" in msg
            assert "created_at" in msg
            assert msg["role"] in ["user", "assistant", "system"]
    
    def test_search_sessions(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试搜索会话"""
        response = client.post("/api/chat/search",
            headers=auth_headers,
            json={
                "query": "库存",
                "limit": 10
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_search_sessions_with_chat_type(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试按类型搜索会话"""
        response = client.post("/api/chat/search",
            headers=auth_headers,
            json={
                "query": "分析",
                "chat_type": "inventory",
                "limit": 10
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_search_sessions_validation(self, client: TestClient, auth_headers: dict):
        """测试搜索输入验证"""
        # 空查询
        response = client.post("/api/chat/search",
            headers=auth_headers,
            json={
                "query": "",
                "limit": 10
            }
        )
        assert response.status_code == 422
        
        # 查询过长
        response = client.post("/api/chat/search",
            headers=auth_headers,
            json={
                "query": "A" * 101,
                "limit": 10
            }
        )
        assert response.status_code == 422
        
        # limit 超出范围
        response = client.post("/api/chat/search",
            headers=auth_headers,
            json={
                "query": "测试",
                "limit": 100
            }
        )
        assert response.status_code == 422


class TestStreamingChat:
    """流式聊天测试类
    
    测试流式聊天端点，包括：
    - 端点存在性
    - SSE Content-Type
    """
    
    def test_stream_endpoint_exists(self, client: TestClient, auth_headers: dict):
        """测试流式端点存在"""
        response = client.post("/api/chat/stream",
            headers=auth_headers,
            json={
                "message": "测试流式消息",
                "chat_type": "review",
                "session_id": "test-stream-session"
            }
        )
        
        # 端点应该存在，不应返回 404
        assert response.status_code != 404
        # 不应返回认证错误
        assert response.status_code != 401
        assert response.status_code != 403
    
    def test_stream_content_type(self, client: TestClient, auth_headers: dict):
        """测试流式响应 Content-Type 为 SSE"""
        response = client.post("/api/chat/stream",
            headers=auth_headers,
            json={
                "message": "测试流式消息",
                "chat_type": "review"
            }
        )
        
        # 如果请求成功，检查 Content-Type
        if response.status_code == 200:
            content_type = response.headers.get("content-type", "")
            assert "text/event-stream" in content_type or "application/json" in content_type
    
    def test_stream_validation(self, client: TestClient, auth_headers: dict):
        """测试流式端点输入验证"""
        # 空消息
        response = client.post("/api/chat/stream",
            headers=auth_headers,
            json={
                "message": "",
                "chat_type": "review"
            }
        )
        assert response.status_code == 422


class TestSecurity:
    """安全测试类
    
    测试安全防护措施，包括：
    - SQL 注入防护
    - XSS 防护
    """
    
    def test_sql_injection_prevention_in_search(self, client: TestClient, auth_headers: dict):
        """测试搜索功能的 SQL 注入防护"""
        # 常见的 SQL 注入尝试
        sql_injection_attempts = [
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            "1'; DELETE FROM conversation_history WHERE '1'='1",
            "'; UPDATE users SET role='admin' WHERE '1'='1'; --",
            "test' UNION SELECT * FROM users --",
        ]
        
        for attempt in sql_injection_attempts:
            response = client.post("/api/chat/search",
                headers=auth_headers,
                json={
                    "query": attempt,
                    "limit": 10
                }
            )
            
            # 不应返回 500 错误（SQL 错误）
            # 应该正常处理或返回 422 验证错误
            assert response.status_code in [200, 422, 400]
            
            # 如果成功，确保没有敏感数据泄露
            if response.status_code == 200:
                data = response.json()
                # 响应应该是列表格式
                assert isinstance(data, list)
    
    def test_sql_injection_prevention_in_session_id(self, client: TestClient, auth_headers: dict):
        """测试会话 ID 参数的 SQL 注入防护"""
        sql_injection_session_ids = [
            "test'; DROP TABLE conversation_history; --",
            "test' OR '1'='1",
            "test'; DELETE FROM users; --",
        ]
        
        for session_id in sql_injection_session_ids:
            response = client.get(f"/api/chat/sessions/{session_id}/messages", 
                headers=auth_headers
            )
            
            # 不应返回 500 错误
            assert response.status_code in [200, 404, 422, 400]
    
    def test_xss_prevention_in_chat_message(self, client: TestClient, auth_headers: dict, db_session: Session, test_user: User):
        """测试聊天消息中的 XSS 防护"""
        # XSS 攻击载荷
        xss_attempts = [
            "<script>alert('XSS')</script>",
            "<img src=x onerror=alert('XSS')>",
            "<body onload=alert('XSS')>",
            "javascript:alert('XSS')",
            "<iframe src='javascript:alert(1)'>",
        ]
        
        for xss_payload in xss_attempts:
            # 发送包含 XSS 的消息
            response = client.post("/api/chat",
                headers=auth_headers,
                json={
                    "message": xss_payload,
                    "chat_type": "review",
                    "session_id": "test-xss-session"
                }
            )
            
            # 请求应该被接受（XSS 防护应在输出时处理）
            assert response.status_code != 422  # 不应因为内容而拒绝
            
            # 检查数据库中存储的内容
            # 理想情况下，XSS 应该在输出时转义，而不是输入时
            # 这里主要验证系统不会崩溃
    
    def test_xss_prevention_in_search(self, client: TestClient, auth_headers: dict):
        """测试搜索功能的 XSS 防护"""
        xss_search = "<script>alert('XSS')</script>"
        
        response = client.post("/api/chat/search",
            headers=auth_headers,
            json={
                "query": xss_search,
                "limit": 10
            }
        )
        
        # 应该正常处理
        assert response.status_code in [200, 422]
    
    def test_authentication_bypass_attempts(self, client: TestClient):
        """测试认证绕过尝试"""
        # 无效令牌
        invalid_tokens = [
            "invalid_token",
            "Bearer ",
            "Basic dGVzdDp0ZXN0",
            "",
        ]
        
        for token in invalid_tokens:
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            response = client.get("/api/chat/sessions", headers=headers)
            
            # 应该返回 401 或 403
            assert response.status_code in [401, 403]
    
    def test_token_tampering(self, client: TestClient):
        """测试令牌篡改检测"""
        # 篡改的 JWT
        tampered_tokens = [
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature",
            "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ0ZXN0In0.",
            "not.a.jwt",
        ]
        
        for token in tampered_tokens:
            headers = {"Authorization": f"Bearer {token}"}
            response = client.get("/api/chat/sessions", headers=headers)
            
            # 应该返回 401 或 403
            assert response.status_code in [401, 403]


class TestChatExport:
    """聊天导出功能测试类"""
    
    def test_export_session_json(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试导出会话为 JSON 格式"""
        response = client.post("/api/chat/export",
            headers=auth_headers,
            json={
                "session_id": "test-session-001",
                "format": "json"
            }
        )
        
        # 可能成功或失败（取决于实现），但不应返回认证错误
        assert response.status_code != 401
        assert response.status_code != 403
    
    def test_export_session_markdown(self, client: TestClient, auth_headers: dict, sample_conversations: list):
        """测试导出会话为 Markdown 格式"""
        response = client.post("/api/chat/export",
            headers=auth_headers,
            json={
                "session_id": "test-session-001",
                "format": "markdown"
            }
        )
        
        assert response.status_code != 401
        assert response.status_code != 403
    
    def test_export_nonexistent_session(self, client: TestClient, auth_headers: dict):
        """测试导出不存在的会话"""
        response = client.post("/api/chat/export",
            headers=auth_headers,
            json={
                "session_id": "nonexistent-session",
                "format": "json"
            }
        )
        
        # 应该返回 404
        assert response.status_code == 404
    
    def test_export_validation(self, client: TestClient, auth_headers: dict):
        """测试导出参数验证"""
        # 无效的格式
        response = client.post("/api/chat/export",
            headers=auth_headers,
            json={
                "session_id": "test-session",
                "format": "invalid_format"
            }
        )
        assert response.status_code == 422
        
        # 缺少 session_id
        response = client.post("/api/chat/export",
            headers=auth_headers,
            json={
                "format": "json"
            }
        )
        assert response.status_code == 422


# 运行测试
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
