# -*- coding: utf-8 -*-
"""自动补货 service 单元测试（内存 SQLite，不连正式库、不触发真实补货单写入生产）

覆盖：
- 取数口径：KEEP + suggest_qty>0；NEG_MARGIN_EXCLUDED 不入单；共享库存汇总行（'是'）也取
- product_id 解析：ASIN 主匹配 / SKU 兜底 / 未匹配跳过回显
- 店铺分组：单店归组、多店合并行组一致归组、跨组归未分组（store_group_id NULL）
- 聚合：同组同 product 合并 SUM；建议量向上取整且至少 1
- 配件：product_bindings 展开数量 = 数量 × 倍数，parent_product_id 记录来源
- 防重：同快照批次已有 auto 单返回 need_confirm；force=True 允许再生成
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import services.scheduler as scheduler_module  # noqa: E402
import services.auto_replenishment_service as svc  # noqa: E402

TENANT = 1
SNAP_DATE = "2026-11-11"

DDL = [
    """CREATE TABLE inventory_snapshots (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, snapshot_date TEXT, deleted_at TEXT)""",
    """CREATE TABLE replenishment_decisions (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, snapshot_id INTEGER, asin TEXT, sku TEXT,
        account TEXT, country TEXT, suggest_qty REAL, summary_flag TEXT,
        filter_status TEXT, deleted_at TEXT)""",
    """CREATE TABLE stores (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, inventory_name TEXT,
        group_id INTEGER, status TEXT, deleted_at TEXT)""",
    """CREATE TABLE user_stores (
        id INTEGER PRIMARY KEY, user_id INTEGER, tenant_id INTEGER, store_id INTEGER)""",
    """CREATE TABLE store_groups (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, name TEXT, deleted_at TEXT)""",
    """CREATE TABLE products (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, asin TEXT, deleted_at TEXT)""",
    """CREATE TABLE platform_products (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, sku TEXT, product_id INTEGER, deleted_at TEXT)""",
    """CREATE TABLE product_bindings (
        id INTEGER PRIMARY KEY, finished_product_id INTEGER,
        accessory_product_id INTEGER, quantity INTEGER, deleted_at TEXT)""",
    """CREATE TABLE replenishment_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, order_number TEXT,
        store_group_id INTEGER, platform TEXT, status TEXT, notes TEXT, created_by INTEGER,
        created_at TEXT, updated_at TEXT, deleted_at TEXT,
        CONSTRAINT uk_tenant_number UNIQUE (tenant_id, order_number))""",
    """CREATE TABLE replenishment_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, replenishment_order_id INTEGER,
        product_id INTEGER, parent_product_id INTEGER, quantity INTEGER, notes TEXT,
        created_at TEXT, updated_at TEXT, deleted_at TEXT)""",
]

# 店铺：A美店→组2(A美)、B欧店/C英店→组3(B欧)、X店→组2、Y店→组3
STORES = [("A美店", 2), ("B欧店", 3), ("C英店", 3), ("X店", 2), ("Y店", 3)]
GROUPS = [(2, "A美"), (3, "B欧")]
PRODUCTS = [("B0KEEP1", 101), ("B0SUM", 103), ("B0CROSS", 104)]
PLATFORM_SKUS = [("SKU-B", 102)]
BINDINGS = [(101, 201, 2)]  # 成品101 每1件需配件201×2

# 决策行：asin, sku, account, suggest_qty, summary_flag, filter_status
ROWS = [
    ("B0KEEP1", "SKU-A", "A美店", 10.4, "0", "KEEP"),            # →组2 pid101 ceil=11
    ("B0KEEP2", "SKU-B", "B欧店、C英店", 5.5, "0", "KEEP"),       # →组3 pid102（SKU兜底）ceil=6
    ("B0NEG", "SKU-C", "A美店", 99, "0", "NEG_MARGIN_EXCLUDED"),  # 负利润排除不入单
    ("B0SUM", "SKU-D", "B欧店、D未知店", 3.2, "是", "KEEP"),       # →组3（成员组唯一）pid103 ceil=4
    ("B0CROSS", "SKU-E", "X店、Y店", 2, "0", "KEEP"),             # 跨组(2,3) → 未分组 pid104
]


def _seed(db):
    db.execute(text(
        "INSERT INTO inventory_snapshots (id, tenant_id, snapshot_date, deleted_at) "
        "VALUES (1, :t, :d, NULL)"), {"t": TENANT, "d": SNAP_DATE})
    for i, (asin, sku, account, qty, sf, status) in enumerate(ROWS, start=1):
        db.execute(text(
            "INSERT INTO replenishment_decisions (id, tenant_id, snapshot_id, asin, sku, account, "
            "country, suggest_qty, summary_flag, filter_status, deleted_at) "
            "VALUES (:id, :t, 1, :asin, :sku, :acc, 'US', :qty, :sf, :fs, NULL)"),
            {"id": i, "t": TENANT, "asin": asin, "sku": sku, "acc": account,
             "qty": qty, "sf": sf, "fs": status})
    for i, (inv_name, gid) in enumerate(STORES, start=1):
        db.execute(text(
            "INSERT INTO stores (id, tenant_id, inventory_name, group_id, status, deleted_at) "
            "VALUES (:id, :t, :n, :g, 'active', NULL)"), {"id": 100 + i, "t": TENANT, "n": inv_name, "g": gid})
    for gid, name in GROUPS:
        db.execute(text(
            "INSERT INTO store_groups (id, tenant_id, name, deleted_at) "
            "VALUES (:id, :t, :n, NULL)"), {"id": gid, "t": TENANT, "n": name})
    for asin, pid in PRODUCTS:
        db.execute(text(
            "INSERT INTO products (id, tenant_id, asin, deleted_at) "
            "VALUES (:id, :t, :a, NULL)"), {"id": pid, "t": TENANT, "a": asin})
    for sku, pid in PLATFORM_SKUS:
        db.execute(text(
            "INSERT INTO platform_products (id, tenant_id, sku, product_id, deleted_at) "
            "VALUES (:id, :t, :s, :p, NULL)"), {"id": 200, "t": TENANT, "s": sku, "p": pid})
    for fid, aid, qty in BINDINGS:
        db.execute(text(
            "INSERT INTO product_bindings (id, finished_product_id, accessory_product_id, "
            "quantity, deleted_at) VALUES (300, :f, :a, :q, NULL)"),
            {"f": fid, "a": aid, "q": qty})
    db.commit()


@pytest.fixture()
def db_session(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine)
    db = TestingSession()
    with engine.begin() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))
    _seed(db)
    monkeypatch.setattr(scheduler_module, "acquire_distributed_lock", lambda *a, **k: True)
    monkeypatch.setattr(scheduler_module, "release_distributed_lock", lambda *a, **k: None)
    yield db
    db.close()


def _run(db, force=False, user_id=5, user_role="admin", group_ids=None, skip_existing=True):
    return svc.run_auto_replenishment(
        db, TENANT, user_id=user_id, user_role=user_role,
        group_ids=group_ids, skip_existing=skip_existing, force=force)


def test_full_flow_generates_orders_by_group(db_session):
    result = _run(db_session)
    assert result["success"] is True, result
    assert result["snapshot_date"] == SNAP_DATE
    assert result["row_count"] == 4  # 5 行 - 1 负利润排除
    assert result["skipped_count"] == 0
    orders = {o["group_name"]: o for o in result["orders"]}
    # 按店铺分组拆单：组2 / 组3 / 未分组 各一张
    assert set(orders.keys()) == {"A美", "B欧", "未分组"}

    # 组2：pid101 qty=ceil(10.4)=11，配件 201 qty=22（parent 101）
    o2 = orders["A美"]
    items2 = db_session.execute(text(
        "SELECT product_id, parent_product_id, quantity FROM replenishment_items "
        "WHERE replenishment_order_id=:oid ORDER BY product_id"), {"oid": o2["id"]}).fetchall()
    assert [(r[0], r[1], r[2]) for r in items2] == [(101, None, 11), (201, 101, 22)]

    # 组3：pid102（SKU兜底）qty=6 与 pid103（共享池汇总行）qty=4 同单两条
    o3 = orders["B欧"]
    items3 = db_session.execute(text(
        "SELECT product_id, quantity FROM replenishment_items "
        "WHERE replenishment_order_id=:oid ORDER BY product_id"), {"oid": o3["id"]}).fetchall()
    assert [(r[0], r[1]) for r in items3] == [(102, 6), (103, 4)]

    # 未分组：对外用虚拟组 id 0（前端勾选），DB 里 store_group_id 仍为 NULL
    on = orders["未分组"]
    assert on["group_id"] == 0
    row = db_session.execute(text(
        "SELECT store_group_id FROM replenishment_orders WHERE id=:oid"), {"oid": on["id"]}).fetchone()
    assert row[0] is None

    # 单据字段：pending / amazon / notes 溯源前缀
    hdr = db_session.execute(text(
        "SELECT status, platform, notes FROM replenishment_orders WHERE id=:oid"),
        {"oid": o2["id"]}).fetchone()
    assert hdr[0] == "pending" and hdr[1] == "amazon"
    assert hdr[2].startswith(f"auto:{SNAP_DATE}")


def test_skip_existing_is_incremental(db_session):
    """默认 skip_existing=True：第二次点击时产品都已在新生成的待审批单中 → 无新增明细"""
    first = _run(db_session)
    assert first["success"] is True
    second = _run(db_session)
    assert second["success"] is False
    assert "没有可写入" in second["message"]
    assert second["skipped_existing_count"] >= 4


def test_need_confirm_only_when_not_skipping(db_session):
    """skip_existing=False（允许重复）时：同批次已有自动单 → need_confirm；force 后再生一批"""
    first = _run(db_session, skip_existing=False)
    assert first["success"] is True
    second = _run(db_session, skip_existing=False)  # 不跳过 + 不带 force → 需要确认
    assert second["success"] is True
    assert second["need_confirm"] is True
    assert {o["order_number"] for o in second["existing_orders"]} == \
        {o["order_number"] for o in first["orders"]}
    forced = _run(db_session, skip_existing=False, force=True)  # 确认后强制再生成
    assert forced["success"] is True
    assert len(forced["orders"]) == 3
    total = db_session.execute(text(
        "SELECT COUNT(*) FROM replenishment_orders WHERE tenant_id=:t AND deleted_at IS NULL"),
        {"t": TENANT}).scalar()
    assert total == 6
    # 同批次单号不重复
    nums = db_session.execute(text(
        "SELECT order_number FROM replenishment_orders WHERE tenant_id=:t"), {"t": TENANT}).fetchall()
    assert len({r[0] for r in nums}) == 6


def test_unmatched_rows_are_skipped_and_returned(db_session):
    # 追加一条 products/platform_products 都匹配不到的行
    db_session.execute(text(
        "INSERT INTO replenishment_decisions (id, tenant_id, snapshot_id, asin, sku, account, "
        "country, suggest_qty, summary_flag, filter_status, deleted_at) "
        "VALUES (99, :t, 1, 'B0NOPE', 'SKU-Z', 'A美店', 'US', 7, '0', 'KEEP', NULL)"),
        {"t": TENANT})
    db_session.commit()
    result = _run(db_session)
    assert result["success"] is True
    assert result["skipped_count"] == 1
    assert result["skipped"][0]["asin"] == "B0NOPE"
    # 不应出现 pid 相关明细缺失：101 单仍正常
    assert len(result["orders"]) == 3


def test_no_rows_returns_failure(db_session):
    db_session.execute(text(
        "UPDATE replenishment_decisions SET filter_status='HOLIDAY_EXCLUDED' WHERE tenant_id=:t"),
        {"t": TENANT})
    db_session.commit()
    result = _run(db_session)
    assert result["success"] is False
    assert "没有可写入" in result["message"]


def test_neg_margin_row_never_enters_orders(db_session):
    result = _run(db_session)
    pids = db_session.execute(text(
        "SELECT DISTINCT product_id FROM replenishment_items ri "
        "JOIN products p ON p.id=ri.product_id WHERE p.asin='B0NEG'")).scalar()
    assert pids is None  # 负利润行（99 件）从未入单
    assert result["success"] is True


def test_visible_store_isolation(db_session):
    """非 admin 按 user_stores 可见店铺取数：user 7 只绑 A美店（store 101）→ 只生成组2单"""
    db_session.execute(text(
        "INSERT INTO user_stores (id, user_id, tenant_id, store_id) VALUES (1, 7, :t, 101)"),
        {"t": TENANT})
    db_session.commit()
    result = _run(db_session, user_id=7, user_role="operator")
    assert result["success"] is True
    assert [o["group_name"] for o in result["orders"]] == ["A美"]
    # admin 不隔离；组2 的 101 已被上一步占用（增量语义），故只剩组3 与未分组
    admin = _run(db_session, user_id=5, user_role="admin")
    assert admin["success"] is True
    assert {o["group_name"] for o in admin["orders"]} == {"B欧", "未分组"}


def test_group_ids_filter(db_session):
    """只补选中分组：group_ids=[2] 只出组2 单；0 代表未分组"""
    r2 = _run(db_session, group_ids=[2])
    assert r2["success"] is True
    assert [o["group_name"] for o in r2["orders"]] == ["A美"]
    r0 = _run(db_session, group_ids=[0])
    assert r0["success"] is True
    assert [o["group_name"] for o in r0["orders"]] == ["未分组"]


def test_skip_occupied_products_from_open_orders(db_session):
    """pending/approved 单里的 product 不再补；改为 purchased 后允许再补"""
    db_session.execute(text(
        "INSERT INTO replenishment_orders (id, tenant_id, order_number, store_group_id, platform, "
        "status, notes, created_by, created_at, updated_at, deleted_at) "
        "VALUES (900, :t, 'RO-OLD-1', 2, 'amazon', 'pending', '历史单', 5, '2026-11-10', '2026-11-10', NULL)"),
        {"t": TENANT})
    db_session.execute(text(
        "INSERT INTO replenishment_items (id, tenant_id, replenishment_order_id, product_id, "
        "parent_product_id, quantity, notes, created_at, updated_at, deleted_at) "
        "VALUES (901, :t, 900, 101, NULL, 5, '已占用', '2026-11-10', '2026-11-10', NULL)"),
        {"t": TENANT})
    db_session.commit()

    preview = svc.preview_auto_replenishment(db_session, TENANT, 5, "admin")
    assert preview["success"] is True
    assert preview["skipped_existing"] >= 1  # 101 已占用

    result = _run(db_session)
    assert result["success"] is True
    assert db_session.execute(text(
        "SELECT COUNT(*) FROM replenishment_items WHERE product_id=101 AND replenishment_order_id<>900"
    )).scalar() == 0  # 101 已占用 → 不再补

    db_session.execute(text("UPDATE replenishment_orders SET status='purchased' WHERE id=900"))
    db_session.commit()
    again = _run(db_session)
    assert again["success"] is True
    assert db_session.execute(text(
        "SELECT COUNT(*) FROM replenishment_items WHERE product_id=101 AND replenishment_order_id<>900"
    )).scalar() == 1  # 已采购释放 → 允许再补


def test_order_number_collision_retries_with_new_number(db_session, monkeypatch):
    """单号撞唯一索引时换号重试，而不是整批失败（并发双击/重试场景）"""
    import services.auto_replenishment_service as svc

    # 先占住 RO-DUP（模拟另一个请求已写入同号单）
    db_session.execute(
        text("INSERT INTO replenishment_orders (tenant_id, order_number, status) "
             "VALUES (:t, 'RO-DUP', 'pending')"),
        {"t": TENANT},
    )
    db_session.commit()

    seq = iter(["RO-DUP", "RO-DUP", "RO-NEW-1", "RO-NEW-2", "RO-NEW-3"])

    def fake_number(used):
        num = next(seq)
        used.add(num)
        return num

    monkeypatch.setattr(svc, "_generate_unique_number", fake_number)

    result = svc.run_auto_replenishment(db_session, TENANT, user_id=5)
    assert result["success"] is True
    nums = [o["order_number"] for o in result["orders"]]
    assert len(nums) == 3
    assert "RO-DUP" not in nums          # 撞号的单被换号，不再写入重复单号
    assert nums == ["RO-NEW-1", "RO-NEW-2", "RO-NEW-3"]
    # 撞号重试后明细完整写入，没有因 savepoint 回滚丢失
    total_items = db_session.execute(
        text("SELECT COUNT(*) FROM replenishment_items WHERE deleted_at IS NULL")
    ).scalar()
    assert total_items == sum(o["item_count"] for o in result["orders"])
