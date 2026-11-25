"""TOS 内容寻址去重 + 共享对象删除保护的单元测试（不触网、不写库）

覆盖：
1. 同内容重复上传只 PUT 一次（进程内缓存命中）
2. 对象已存在时跳过 PUT（冷缓存场景走 HEAD）
3. 不同内容各自上传
4. 删除保护：URL 仍被其他任务引用时不删；URL 中的 _ 按字面匹配（不被当通配符）
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from services import tos_service
from services.ai_image_service import _ensure_models_loaded, _url_shared_by_other_task

# 项目已知坑：只 import 单个模型时 mapper 无法全部解析（Tenant 引用 ProductSelection），
# 必须先加载全部 models 才能建表 / 查询。
_ensure_models_loaded()
from models.ai_image_task import AIImageTask  # noqa: E402  （必须在 models 全量加载之后）


@pytest.fixture(autouse=True)
def _clear_dedup_cache():
    """每个用例从空缓存开始，避免用例间互相命中"""
    tos_service._DEDUP_CACHE.clear()
    yield
    tos_service._DEDUP_CACHE.clear()


def _patch_put(monkeypatch, exists=False):
    """拦截真实上传与 HEAD：返回记录 PUT 次数的列表"""
    puts = []
    monkeypatch.setattr(tos_service, "_object_exists", lambda key: exists)
    monkeypatch.setattr(
        tos_service, "upload_file",
        lambda *a, **kw: puts.append(a[1] if len(a) > 1 else kw.get("file_name")) or
        f"https://cdn.example.com/uploads/ai-image/{kw.get('custom_name')}.png",
    )
    return puts


def test_same_bytes_uploaded_once(monkeypatch):
    puts = _patch_put(monkeypatch)
    u1 = tos_service.upload_file_dedup(b"same-bytes", "a.png", subdir="ai-image")
    u2 = tos_service.upload_file_dedup(b"same-bytes", "a.png", subdir="ai-image")
    assert u1 == u2
    assert len(puts) == 1                      # 第二次命中进程内缓存，没有 PUT
    assert "sha256-" in u1


def test_existing_object_skips_put(monkeypatch):
    """冷缓存但对象已在 TOS：直接返回地址，不重复占用存储"""
    puts = _patch_put(monkeypatch, exists=True)
    url = tos_service.upload_file_dedup(b"already-there", "a.png", subdir="ai-image")
    assert puts == []
    assert url.endswith(f"{tos_service.dedup_object_name(b'already-there')}.png")


def test_different_bytes_upload_twice(monkeypatch):
    puts = _patch_put(monkeypatch)
    u1 = tos_service.upload_file_dedup(b"img-1", "a.png", subdir="ai-image")
    u2 = tos_service.upload_file_dedup(b"img-2", "a.png", subdir="ai-image")
    assert u1 != u2
    assert len(puts) == 2


def test_is_dedup_url():
    assert tos_service.is_dedup_url("https://cdn/uploads/ai-image/sha256-abc.png") is True
    assert tos_service.is_dedup_url("https://cdn/uploads/ai-image/1f2e3d.png") is False
    assert tos_service.is_dedup_url("") is False


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://")
    AIImageTask.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _add_task(db, task_id: int, images: str):
    db.add(AIImageTask(
        id=task_id, tenant_id=1, user_id=1, status="已完成", provider="local",
        image_count=1, images=images,
    ))
    db.commit()


def test_url_shared_by_other_task(db_session):
    _add_task(db_session, 1, '["https://cdn/uploads/ai-image/sha256-aaa_SL75_x.png"]')
    _add_task(db_session, 2, '["https://cdn/uploads/ai-image/sha256-bbb.png"]')

    shared_url = "https://cdn/uploads/ai-image/sha256-aaa_SL75_x.png"
    assert _url_shared_by_other_task(db_session, 2, shared_url) is True   # 任务 1 还在用
    assert _url_shared_by_other_task(db_session, 1, shared_url) is False  # 只有自己引用


def test_url_shared_escapes_underscore(db_session):
    """URL 里的 _ 必须按字面匹配，否则 sha256-a_b 会误命中 sha256-aXb"""
    _add_task(db_session, 1, '["https://cdn/uploads/ai-image/sha256-aXb.png"]')
    _add_task(db_session, 2, '["https://cdn/uploads/ai-image/sha256-aXc.png"]')

    # 任务 2 查 sha256-a_b：若不转义，_ 会匹配任意字符 → 误判为共享
    assert _url_shared_by_other_task(
        db_session, 2, "https://cdn/uploads/ai-image/sha256-a_b.png"
    ) is False
