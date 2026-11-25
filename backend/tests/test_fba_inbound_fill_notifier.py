# -*- coding: utf-8 -*-
"""FBA 在途信息补填通知 单元测试（内存 SQLite，不连正式库、不发飞书请求）

覆盖改造后的验收项：
- 缺失收集口径（含占位符 "-"、"无"）
- 文案模板与折叠
- 收件人：仓库角色 → 管理员兜底 → 无收件人记 WARNING
- 按天去重（对齐「超期未入库提醒」范式）
- title 带批次日期、link 指向飞书
- 同步失败不通知、通知异常不阻塞、飞书 0 条仍通知
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import database.database as database_module  # noqa: E402
import services.feishu_sync_service as sync_service  # noqa: E402
import services.fba_inbound_fill_notifier as notifier  # noqa: E402

# ---------------------------------------------------------------------------
# 测试库结构
# ---------------------------------------------------------------------------
DDL = [
    "CREATE TABLE inventory_snapshots ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, snapshot_date TEXT, deleted_at TEXT)",
    "CREATE TABLE inbound_shipment_details ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, snapshot_id INTEGER, shipment_id TEXT,"
    " ship_date TEXT, transport_method TEXT, estimated_arrival_date TEXT,"
    " updated_at TEXT, deleted_at TEXT)",
    "CREATE TABLE users ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, role_id INTEGER, status TEXT, deleted_at TEXT)",
    "CREATE TABLE roles ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, code TEXT, deleted_at TEXT)",
    "CREATE TABLE notifications ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, user_id INTEGER, type TEXT, title TEXT,"
    " content TEXT, link TEXT, read_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT)",
]

WAREHOUSE_USERS = (17, 32, 45, 46)   # 租户 1 仓库角色在职用户
TENANT6_ADMIN = 60                   # 租户 6 管理员（无仓库角色 → 兜底）
EXPECTED_ROWS = len(WAREHOUSE_USERS) + 1
FBA_MISSING_MAIN = "FBA19VWL41D3"
FBA_MISSING_SECOND = "FBA19V0DHHTX"
SNAP_DATE = "2026-11-04"


@pytest.fixture()
def db_session(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _register_now(dbapi_conn, _):  # noqa: ANN001
        dbapi_conn.create_function(
            "NOW", 0, lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    with engine.begin() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))

    test_session = sessionmaker(bind=engine)
    session = test_session()

    monkeypatch.setattr(notifier, "SessionLocal", test_session)
    monkeypatch.setattr(database_module, "SessionLocal", test_session)

    _seed(session)
    yield session, engine

    session.close()


def _seed(session):
    session.execute(text(
        "INSERT INTO inventory_snapshots (id, tenant_id, snapshot_date, deleted_at)"
        " VALUES (1, 1, :d, NULL), (2, 1, '2026-11-01', NULL), (3, 6, :d, NULL)"),
        {"d": SNAP_DATE})

    rows, seq = [], [0]

    def detail(snapshot_id, shipment_id, ship_date, transport, deleted_at="NULL", tenant=1):
        seq[0] += 1
        rows.append(
            f"({seq[0]}, {tenant}, {snapshot_id}, '{shipment_id}', "
            f"{ship_date}, {transport}, {deleted_at})")

    # 租户 1 / 最新快照：两个缺失发货日期的 FBA 编号
    detail(1, FBA_MISSING_MAIN, "NULL", "'海运'")
    detail(1, FBA_MISSING_MAIN, "NULL", "'空运'")
    detail(1, FBA_MISSING_SECOND, "NULL", "'海运'")
    detail(1, "FBA19VOK", "'2026-10-01'", "'空运'")
    detail(1, "FBA19VDEL", "NULL", "'海运'", deleted_at="'2026-11-02 10:00:00'")
    detail(1, "", "NULL", "'海运'")
    detail(2, "FBA19VOLD", "NULL", "'海运'")
    # 租户 6：有缺失、无仓库角色、有管理员 → 走兜底
    detail(3, "FBA19VT6", "NULL", "'海运'", tenant=6)

    session.execute(text(
        "INSERT INTO inbound_shipment_details "
        "(id, tenant_id, snapshot_id, shipment_id, ship_date, transport_method, deleted_at)"
        " VALUES " + ",".join(rows)))

    session.execute(text(
        "INSERT INTO roles (id, tenant_id, code, deleted_at)"
        " VALUES (1, 1, 'warehouseman', NULL), (2, 6, 'admin', NULL)"))
    users = [f"({u}, 1, 1, 'active', NULL)" for u in WAREHOUSE_USERS]
    users.append("(47, 1, 1, 'disabled', NULL)")
    users.append(f"({TENANT6_ADMIN}, 6, 2, 'active', NULL)")
    session.execute(text(
        "INSERT INTO users (id, tenant_id, role_id, status, deleted_at)"
        " VALUES " + ",".join(users)))
    session.commit()


def _notification_rows(session):
    return [dict(r._mapping) for r in session.execute(text(
        "SELECT tenant_id, user_id, type, title, content, link FROM notifications "
        "ORDER BY tenant_id, user_id")).fetchall()]


# ---------------------------------------------------------------------------
# 缺失收集口径
# ---------------------------------------------------------------------------
def test_collect_missing_fba_scope(db_session):
    session, _ = db_session
    result = notifier.collect_missing_fba(session)

    assert set(result.keys()) == {1, 6}
    t1 = result[1]
    assert t1["max_date"] == SNAP_DATE or str(t1["max_date"])[:10] == SNAP_DATE

    ids = [i["shipment_id"] for i in t1["items"]]
    assert ids == [FBA_MISSING_SECOND, FBA_MISSING_MAIN]   # 字典序
    assert all(i["miss_ship_date"] is True for i in t1["items"])
    assert all(i["miss_transport"] is False for i in t1["items"])

    assert [i["shipment_id"] for i in result[6]["items"]] == ["FBA19VT6"]


def test_collect_empty_value_variants(db_session):
    """transport NULL / '' / 全空格 都算缺失；非空不算；排除口径生效"""
    session, _ = db_session
    session.execute(text(
        "INSERT INTO inbound_shipment_details "
        "(id, tenant_id, snapshot_id, shipment_id, ship_date, transport_method, deleted_at)"
        " VALUES "
        " (900, 1, 1, 'FBA19VNULL',  NULL,      NULL,      NULL),"
        " (901, 1, 1, 'FBA19VEMPTY', NULL,      '',        NULL),"
        " (902, 1, 1, 'FBA19VSPACE', NULL,      '   ',     NULL),"
        " (903, 1, 1, 'FBA19VOKTR',  NULL,      '海运',     NULL)"))
    session.commit()

    result = notifier.collect_missing_fba(session)
    ids = {i["shipment_id"]: i for i in result[1]["items"]}
    assert ids["FBA19VNULL"]["miss_transport"] is True
    assert ids["FBA19VEMPTY"]["miss_transport"] is True
    assert ids["FBA19VSPACE"]["miss_transport"] is True
    assert ids["FBA19VOKTR"]["miss_transport"] is False
    assert ids["FBA19VOKTR"]["miss_ship_date"] is True


def test_placeholder_counts_as_missing(db_session):
    """占位符（"-"、"无"）必须算缺失——线上 83 行 '-' 靠这条兜住"""
    session, _ = db_session
    session.execute(text(
        "INSERT INTO inbound_shipment_details "
        "(id, tenant_id, snapshot_id, shipment_id, ship_date, transport_method, deleted_at)"
        " VALUES "
        " (904, 1, 1, 'FBA19VDASH', NULL,      '-',   NULL),"
        " (905, 1, 1, 'FBA19VNONE', '2026-10-01', '无',  NULL),"
        " (906, 1, 1, 'FBA19VOK2',  '2026-10-01', '海运', NULL)"))
    session.commit()

    result = notifier.collect_missing_fba(session)
    ids = {i["shipment_id"]: i for i in result[1]["items"]}
    assert ids["FBA19VDASH"]["miss_transport"] is True
    assert ids["FBA19VNONE"]["miss_transport"] is True
    assert "FBA19VOK2" not in ids        # 两字段齐全 → 不进入缺失集合


# ---------------------------------------------------------------------------
# 文案 / title / link
# ---------------------------------------------------------------------------
def test_render_content_template_exact(db_session):
    session, _ = db_session
    result = notifier.collect_missing_fba(session)
    content = notifier.render_content(result[1]["items"], result[1]["max_date"])

    expected = (
        "【FBA在途信息补填提醒】\n"
        "当前库存数据中，以下 FBA 编号的发货日期或运输方式未填写，请仓库角色前往飞书补填：\n"
        f"  {FBA_MISSING_SECOND}：缺 发货日期\n"
        f"  {FBA_MISSING_MAIN}：缺 发货日期\n"
        "补填字段：发货日期（飞书列「发货日期」）、运输方式（飞书列「渠道（仓库填）」）。\n"
        "补填完成后，下次同步或导入即生效。\n"
        f"批次日期：{SNAP_DATE}"
    )
    assert content == expected


def test_render_content_both_missing_and_order():
    items = [
        {"shipment_id": "FBA-B", "miss_ship_date": True, "miss_transport": True},
        {"shipment_id": "FBA-A", "miss_ship_date": False, "miss_transport": True},
    ]
    content = notifier.render_content(items, "2026-11-04")
    assert "  FBA-B：缺 发货日期、运输方式" in content
    assert "  FBA-A：缺 运输方式" in content
    assert content.index("发货日期、运输方式") > 0


def test_render_content_overflow_folded():
    items = [{"shipment_id": f"FBA-{i:03d}", "miss_ship_date": True,
              "miss_transport": False} for i in range(60)]
    content = notifier.render_content(items, "2026-11-04")
    listed = [line for line in content.splitlines() if line.startswith("  FBA-")]
    assert len(listed) == notifier.MAX_LISTED_FBA
    assert "  ...等共 60 个 FBA 编号" in content.splitlines()


def test_render_content_marks_absent_feishu_record():
    items = [{"shipment_id": "FBA-X", "miss_ship_date": True, "miss_transport": True}]
    content = notifier.render_content(items, "2026-11-04", feishu_state={"OTHER": {}})
    assert "FBA-X：飞书中无此记录，请新增并填齐字段" in content


def test_build_title_has_batch_date():
    assert notifier.build_title(SNAP_DATE) == f"FBA在途信息补填提醒 - 批次 {SNAP_DATE}"
    assert notifier.build_title(None) == "FBA在途信息补填提醒"


def test_build_link_feishu_or_fallback(monkeypatch):
    class _S:
        FEISHU_SYNC_BASE_TOKEN = "tok"
        FEISHU_SYNC_TABLE_ID = "tid"

    monkeypatch.setattr(notifier, "get_settings", lambda: _S())
    assert notifier.build_link() == "https://www.feishu.cn/base/tok?table=tid"

    class _E:
        FEISHU_SYNC_BASE_TOKEN = ""
        FEISHU_SYNC_TABLE_ID = ""

    monkeypatch.setattr(notifier, "get_settings", lambda: _E())
    assert notifier.build_link() == "/inventory"


# ---------------------------------------------------------------------------
# 通知写入 / 兜底 / 无收件人
# ---------------------------------------------------------------------------
def test_notify_writes_to_warehouse_users(db_session):
    session, _ = db_session
    result = notifier.notify_missing_fba_info()

    assert result["ok"] is True
    assert result["tenants"] == 2             # 租户1 走仓库，租户6 走 admin 兜底
    assert result["fba_count"] == 3
    assert result["notified"] == EXPECTED_ROWS
    assert result["skipped"] == 0
    assert result["fallback_tenants"] == [6]

    rows = _notification_rows(session)
    assert [r["user_id"] for r in rows] == list(WAREHOUSE_USERS) + [TENANT6_ADMIN]
    assert all(r["type"] == "warning" for r in rows)
    assert all(r["title"] == notifier.build_title(SNAP_DATE) for r in rows)
    assert all(r["link"] == notifier.build_link() for r in rows)

    tenant1_content = [r["content"] for r in rows if r["tenant_id"] == 1][0]
    assert FBA_MISSING_MAIN in tenant1_content and FBA_MISSING_SECOND in tenant1_content
    assert "发货日期" in tenant1_content
    assert "飞书" in tenant1_content
    assert "仓库角色" in tenant1_content
    assert f"批次日期：{SNAP_DATE}" in tenant1_content
    assert "渠道（仓库填）" in tenant1_content

    tenant6_content = [r["content"] for r in rows if r["tenant_id"] == 6][0]
    assert "本条已改发管理员" in tenant6_content


def test_no_missing_no_notification(db_session):
    session, _ = db_session
    session.execute(text(
        "UPDATE inbound_shipment_details SET ship_date='2026-10-01', transport_method='海运' "
        "WHERE deleted_at IS NULL"))
    session.commit()

    result = notifier.notify_missing_fba_info()
    assert result["ok"] is True
    assert result["tenants"] == 0
    assert result["fba_count"] == 0
    assert result["notified"] == 0
    assert _notification_rows(session) == []


def test_tenant_without_any_target_logged(db_session):
    """租户 5：有缺失、无角色、无用户 → 记入 no_target_tenants，不影响其他租户"""
    session, _ = db_session
    session.execute(text(
        "INSERT INTO inventory_snapshots (id, tenant_id, snapshot_date, deleted_at)"
        " VALUES (4, 5, :d, NULL)"), {"d": SNAP_DATE})
    session.execute(text(
        "INSERT INTO inbound_shipment_details "
        "(id, tenant_id, snapshot_id, shipment_id, ship_date, transport_method, deleted_at)"
        " VALUES (910, 5, 4, 'FBA19VT5', NULL, '海运', NULL)"))
    session.commit()

    result = notifier.notify_missing_fba_info()
    assert result["ok"] is True
    assert 5 in result["no_target_tenants"]
    assert result["fba_count"] == 4
    assert len(_notification_rows(session)) == EXPECTED_ROWS


# ---------------------------------------------------------------------------
# 按天去重
# ---------------------------------------------------------------------------
def test_dedup_same_day(db_session):
    session, _ = db_session
    first = notifier.notify_missing_fba_info()
    assert first["notified"] == EXPECTED_ROWS

    second = notifier.notify_missing_fba_info()
    assert second["notified"] == 0
    assert second["skipped"] == EXPECTED_ROWS
    assert len(_notification_rows(session)) == EXPECTED_ROWS


def test_dedup_same_day_ignores_content_change(db_session):
    """同一天内容变化（编号减少）也不重发——按天去重，避免一天多条"""
    session, _ = db_session
    notifier.notify_missing_fba_info()
    session.execute(text(
        "UPDATE inbound_shipment_details SET ship_date='2026-11-03' "
        "WHERE shipment_id = :sid"), {"sid": FBA_MISSING_SECOND})
    session.commit()

    second = notifier.notify_missing_fba_info()
    assert second["notified"] == 0
    assert second["skipped"] == EXPECTED_ROWS
    assert len(_notification_rows(session)) == EXPECTED_ROWS


def test_next_day_resends_with_remaining_items(db_session):
    """跨天 → 重发，且内容只含仍缺失的编号"""
    session, _ = db_session
    notifier.notify_missing_fba_info()
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    session.execute(text("UPDATE notifications SET created_at = :y"), {"y": yesterday})
    session.execute(text(
        "UPDATE inbound_shipment_details SET ship_date='2026-11-03' "
        "WHERE shipment_id = :sid"), {"sid": FBA_MISSING_SECOND})
    session.commit()

    second = notifier.notify_missing_fba_info()
    assert second["notified"] == EXPECTED_ROWS
    assert second["fba_count"] == 2            # 租户1 剩 1 个 + 租户6 1 个

    today_rows = session.execute(text(
        "SELECT content FROM notifications WHERE DATE(created_at) = :t "
        "AND tenant_id = 1"), {"t": datetime.now().strftime("%Y-%m-%d")}).fetchall()
    latest = today_rows[0][0]
    assert FBA_MISSING_MAIN in latest
    assert FBA_MISSING_SECOND not in latest


# ---------------------------------------------------------------------------
# 与 _do_sync 收尾的衔接
# ---------------------------------------------------------------------------
def _patch_fetch(monkeypatch, records):
    monkeypatch.setattr(sync_service, "fetch_feishu_inbound_data_fast",
                        lambda days=90: records)


def test_sync_failure_sends_no_notification(db_session, monkeypatch):
    session, _ = db_session

    def _boom(days=90):
        raise Exception("获取飞书token失败")

    monkeypatch.setattr(sync_service, "fetch_feishu_inbound_data_fast", _boom)

    sync_service._do_sync()

    assert sync_service._sync_status["is_running"] is False
    assert "token" in sync_service._sync_status["error"]
    assert _notification_rows(session) == []


def test_sync_success_notifies_before_status_closed(db_session, monkeypatch):
    """通知在 is_running=False 之前执行；_do_sync 把 feishu_data 传给通知模块"""
    session, _ = db_session
    _patch_fetch(monkeypatch, [{
        "shipment_id": FBA_MISSING_MAIN,
        "transport_method": "海运",
        "estimated_arrival_date": None,
        "ship_date": None,
    }])

    recorded = {}
    real_notify = notifier.notify_missing_fba_info

    def _spy(**kwargs):
        recorded["during"] = sync_service._sync_status["is_running"]
        recorded["feishu_len"] = len(kwargs.get("feishu_data") or [])
        return real_notify(**kwargs)

    monkeypatch.setattr(notifier, "notify_missing_fba_info", _spy)

    sync_service._do_sync()

    assert sync_service._sync_status["is_running"] is False
    assert sync_service._sync_status["error"] is None
    assert recorded["during"] is True
    assert recorded["feishu_len"] == 1
    assert len(_notification_rows(session)) == EXPECTED_ROWS


def test_sync_no_data_still_notifies(db_session, monkeypatch):
    session, _ = db_session
    _patch_fetch(monkeypatch, [])

    sync_service._do_sync()

    assert sync_service._sync_status["is_running"] is False
    assert sync_service._sync_status["step"] == "没有需要同步的数据"
    assert len(_notification_rows(session)) == EXPECTED_ROWS


def test_notify_failure_does_not_break_sync(db_session, monkeypatch):
    session, _ = db_session
    _patch_fetch(monkeypatch, [{
        "shipment_id": FBA_MISSING_MAIN,
        "transport_method": "海运",
        "estimated_arrival_date": None,
        "ship_date": None,
    }])

    def _explode(**kwargs):
        raise RuntimeError("通知库连不上")

    monkeypatch.setattr(notifier, "notify_missing_fba_info", _explode)

    sync_service._do_sync()

    assert sync_service._sync_status["is_running"] is False
    assert sync_service._sync_status["error"] is None
    assert _notification_rows(session) == []


def test_notify_never_raises_when_session_broken(db_session, monkeypatch):
    def _broken():
        raise RuntimeError("db down")

    monkeypatch.setattr(notifier, "SessionLocal", _broken)
    result = notifier.notify_missing_fba_info()
    assert result["ok"] is False
    assert "db down" in result["error"]
