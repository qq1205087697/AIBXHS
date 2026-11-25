# -*- coding: utf-8 -*-
"""产品库覆盖度（有销量但产品库无此产品）单元测试

内存 SQLite，不连正式库、不发任何外部请求。覆盖 coding 文档 §5 的 AC2–AC9：
- 判定键（只有 platform_products.sku/asin 生效）
- 归一化与拼接 SKU 拆分
- 销量窗口/阈值
- 问题分类
- 汇总行口径
- 空集合 / 缓存失效 / 软删映射
- build_visible_snapshots 的 missing_ids 回注
"""
import importlib
import os
import pkgutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

# 确保所有 ORM 模型已注册（Tenant 等存在 relationship，缺少会 mapper 配置失败）
import models  # noqa: E402

for _m in pkgutil.iter_modules(models.__path__):
    if _m.name.startswith("_"):
        continue
    try:
        importlib.import_module(f"models.{_m.name}")
    except Exception:  # pragma: no cover - 个别模型依赖可选组件
        pass

import services.inventory_service as inv  # noqa: E402
import services.product_lib_coverage_service as cov  # noqa: E402

LATEST = "2026-11-11"
DDL = [
    "CREATE TABLE inventory_snapshots ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, snapshot_date TEXT, deleted_at TEXT,"
    " asin TEXT, sku TEXT, product_name TEXT, summary_flag TEXT, account TEXT,"
    " sales_7d REAL, sales_14d REAL, sales_30d REAL, sales_60d REAL, sales_90d REAL)",
    "CREATE TABLE products ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, product_code TEXT, sku TEXT,"
    " asin TEXT, name TEXT, deleted_at TEXT)",
    "CREATE TABLE platform_products ("
    " id INTEGER PRIMARY KEY, tenant_id INTEGER, product_id INTEGER,"
    " sku TEXT, asin TEXT, deleted_at TEXT)",
]


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))
    S = sessionmaker(bind=engine)
    session = S()
    cov.invalidate_product_lib_cache()  # 防止跨用例命中缓存
    yield session, engine
    session.close()
    cov.invalidate_product_lib_cache()


def add_product(s, pid, name, *, tenant=1, asin=None, sku=None,
                product_code=None, deleted_at=None):
    s.execute(text(
        "INSERT INTO products (id, tenant_id, product_code, sku, asin, name, deleted_at)"
        " VALUES (:i, :t, :c, :s, :a, :n, :d)"),
        {"i": pid, "t": tenant, "c": product_code or f"BXHS-CP-{pid:05d}",
         "s": sku, "a": asin, "n": name, "d": deleted_at})


def add_mapping(s, mid, product_id, *, tenant=1, sku=None, asin=None, deleted_at=None):
    s.execute(text(
        "INSERT INTO platform_products (id, tenant_id, product_id, sku, asin, deleted_at)"
        " VALUES (:i, :t, :p, :s, :a, :d)"),
        {"i": mid, "t": tenant, "p": product_id, "s": sku, "a": asin, "d": deleted_at})


def add_snapshot(s, sid, *, tenant=1, sku=None, asin=None, name=None,
                 flag=None, date=LATEST, account="A", sales=None,
                 deleted_at=None):
    row = {"id": sid, "t": tenant, "d": date, "dl": deleted_at, "a": asin,
           "s": sku, "n": name, "f": flag, "acc": account}
    row.update({f"s{k}": (sales or {}).get(k) for k in ("7d", "14d", "30d", "60d", "90d")})
    s.execute(text(
        "INSERT INTO inventory_snapshots (id, tenant_id, snapshot_date, deleted_at, asin, sku,"
        " product_name, summary_flag, account, sales_7d, sales_14d, sales_30d, sales_60d, sales_90d)"
        " VALUES (:id, :t, :d, :dl, :a, :s, :n, :f, :acc,"
        " :s7d, :s14d, :s30d, :s60d, :s90d)"), row)


def run(session, **kw):
    return cov.find_uncovered_snapshots(session, 1, LATEST, **kw)


# ---------------------------------------------------------------------------
# AC2：只有 platform_products 决定「是否已收录」
# ---------------------------------------------------------------------------
def test_products_own_keys_do_not_count_as_covered(db_session):
    s, _ = db_session
    # products 自身有 asin/sku/product_code，但没有任何 platform_products 映射
    add_product(s, 1, "已有品名", asin="B0SAMEASIN", sku="SAME-SKU", product_code="SAME-SKU")
    add_snapshot(s, 101, asin="B0SAMEASIN", sku="SAME-SKU", name="已有品名", sales={"30d": 10})
    s.commit()

    r = run(s)
    assert r["total"] == 1, "products.asin/sku/product_code 不应参与判定"
    assert r["classify"][101]["issue"] == cov.ISSUE_MISSING_MAPPING


def test_platform_mapping_covers_row(db_session):
    s, _ = db_session
    add_product(s, 1, "普通产品")
    add_mapping(s, 1, 1, sku="ca-d-425")            # 库内小写
    add_snapshot(s, 101, sku=" ca-d-425 ", name="普通产品", sales={"30d": 10})
    s.commit()

    assert run(s)["total"] == 0, "strip+upper 后应命中"


def test_soft_deleted_mapping_or_product_not_covered(db_session):
    s, _ = db_session
    add_product(s, 1, "产品A")
    add_mapping(s, 1, 1, sku="SKU-DEL-MAP", deleted_at="2026-01-01 00:00:00")   # 映射已软删
    add_product(s, 2, "产品B", deleted_at="2026-01-01 00:00:00")                # 产品已软删
    add_mapping(s, 2, 2, sku="SKU-DEL-PROD")
    add_snapshot(s, 101, sku="SKU-DEL-MAP", name="产品A", sales={"30d": 10})
    add_snapshot(s, 102, sku="SKU-DEL-PROD", name="产品B", sales={"30d": 10})
    s.commit()

    r = run(s)
    assert r["total"] == 2, "软删的映射/产品不算已收录"


# ---------------------------------------------------------------------------
# AC3：归一化与拼接 SKU
# ---------------------------------------------------------------------------
def test_split_sku_any_segment_hit_means_covered(db_session):
    s, _ = db_session
    add_product(s, 1, "拼A")
    add_mapping(s, 1, 1, sku="USA-A-1188")
    add_snapshot(s, 101, sku="CA-A-887、USA-A-1188", name="拼A", sales={"30d": 10})

    add_product(s, 2, "拼B")
    add_mapping(s, 2, 2, sku="USA-B-0001")
    add_snapshot(s, 102, sku="CA-B-0001,USA-B-0002", name="拼B", sales={"30d": 10})
    s.commit()

    r = run(s)
    assert 101 not in r["missing_ids"], "拼接 SKU 任一段命中即算收录"
    assert 102 in r["missing_ids"]


def test_blank_identifiers_are_skipped(db_session):
    s, _ = db_session
    add_snapshot(s, 101, sku="   ", asin=None, name="无标识", sales={"30d": 10})
    add_snapshot(s, 102, sku="", asin="", name="无标识2", sales={"30d": 10})
    s.commit()

    r = run(s)
    assert r["total"] == 0, "sku/asin 双空的行不计入未收录"


# ---------------------------------------------------------------------------
# AC4：销量窗口与阈值
# ---------------------------------------------------------------------------
def test_sales_window_and_threshold(db_session):
    s, _ = db_session
    add_snapshot(s, 101, sku="S1", name="甲", sales={"7d": 5, "30d": 0})
    add_snapshot(s, 102, sku="S2", name="乙", sales={"30d": 3})
    add_snapshot(s, 103, sku="S3", name="丙", sales={"30d": 30})
    s.commit()

    assert run(s, sales_window=30)["total"] == 2          # 102, 103
    assert run(s, sales_window=7)["total"] == 1           # 只有 101
    assert run(s, sales_window=30, min_sales=10)["total"] == 1   # 只有 103


# ---------------------------------------------------------------------------
# AC5：问题分类
# ---------------------------------------------------------------------------
def test_classification(db_session):
    s, _ = db_session
    add_product(s, 1, "唯一品名")
    add_product(s, 2, "重复品名")
    add_product(s, 3, "重复品名")          # 同名两个产品 → 歧义

    add_snapshot(s, 101, sku="SN1", name="唯一品名", sales={"30d": 10})
    add_snapshot(s, 102, sku="SN2", name="重复品名", sales={"30d": 10})
    add_snapshot(s, 103, sku="SN3", name="库中不存在的品名", sales={"30d": 10})
    s.commit()

    r = run(s)
    assert r["classify"][101]["issue"] == cov.ISSUE_MISSING_MAPPING
    assert r["classify"][102]["issue"] == cov.ISSUE_NAME_AMBIGUOUS
    assert r["classify"][103]["issue"] == cov.ISSUE_NOT_CREATED
    assert r["by_type"][cov.ISSUE_MISSING_MAPPING] == 1
    assert r["by_type"][cov.ISSUE_NAME_AMBIGUOUS] == 1
    assert r["by_type"][cov.ISSUE_NOT_CREATED] == 1


# ---------------------------------------------------------------------------
# AC6：汇总行口径
# ---------------------------------------------------------------------------
def test_exclude_summary(db_session):
    s, _ = db_session
    add_snapshot(s, 101, sku="S1", name="甲", flag="0", sales={"30d": 10})
    add_snapshot(s, 102, sku="S2", name="乙", flag="是", sales={"30d": 10})
    add_snapshot(s, 103, sku="S3", name="丙", flag="共享库存", sales={"30d": 10})
    s.commit()

    assert run(s)["total"] == 2                            # 子行(共享库存)默认排除
    assert run(s, exclude_summary=True)["total"] == 1      # 再排除汇总行


def test_only_latest_snapshot_scanned(db_session):
    s, _ = db_session
    add_snapshot(s, 101, sku="S1", name="甲", date=LATEST, sales={"30d": 10})
    add_snapshot(s, 102, sku="S2", name="乙", date="2026-11-10", sales={"30d": 10})
    add_snapshot(s, 103, sku="S3", name="丙", date=LATEST, deleted_at="2026-01-01 00:00:00",
                 sales={"30d": 10})
    s.commit()

    r = run(s)
    assert r["missing_ids"] == [101]


# ---------------------------------------------------------------------------
# AC7：missing_ids 回注 build_visible_snapshots
# ---------------------------------------------------------------------------
def test_build_visible_snapshots_with_missing_ids(db_session):
    s, _ = db_session
    from models.restock import InventorySnapshot
    add_snapshot(s, 101, sku="S1", name="甲", sales={"30d": 10})
    add_snapshot(s, 102, sku="S2", name="乙", sales={"30d": 10})
    add_snapshot(s, 103, sku="S3", name="丙", sales={"30d": 10})
    s.commit()

    q = inv.build_visible_snapshots(s, 1, LATEST, missing_ids=[101, 103])
    assert sorted(r[0] for r in q.all()) == [101, 103]

    # 空集合 → None（无可见行），与「用户无可见店铺」同语义
    assert inv.build_visible_snapshots(s, 1, LATEST, missing_ids=[]) is None

    # 不传 → 全部（含汇总/子行规则）
    assert inv.build_visible_snapshots(s, 1, LATEST).count() == 3

    # 与店铺筛选叠加取交集
    q2 = inv.build_visible_snapshots(s, 1, LATEST, account=["A"], missing_ids=[101])
    assert [r[0] for r in q2.all()] == [101]
    assert InventorySnapshot is not None


# ---------------------------------------------------------------------------
# AC8：缓存失效
# ---------------------------------------------------------------------------
def test_cache_invalidation_after_mapping_added(db_session):
    s, _ = db_session
    add_snapshot(s, 101, sku="S1", name="甲", sales={"30d": 10})
    s.commit()
    assert run(s)["total"] == 1

    # 补上映射（模拟产品库补录后清缓存）
    add_product(s, 1, "甲")
    add_mapping(s, 1, 1, sku="S1")
    s.commit()
    assert run(s)["total"] == 1, "未清缓存时应命中旧结果（60s TTL）"

    cov.invalidate_product_lib_cache(1)
    assert run(s)["total"] == 0, "清缓存后应识别出新补的映射"
