# -*- coding: utf-8 -*-
"""月销量等级 service 单元测试（内存 SQLite，不连正式库）

覆盖：
- classify_grade 全边界（10→E、300→A、0/NULL/负数→D、301→S）
- recompute_grades 行级三级归属：
    ① msku 唯一认领（product_sales 精确值）
    ② 同 msku 跨店 → store 大区→站点认领（唯一命中才认领，用户实例 B0COWBOY）
    ③ 认领失败 → 行级 sales_30d 折算（fallback_30d / no_data）
- 父汇总行合并口径（Σ product_sales）
- 「欧」合并多国歧义 → 不认领、全组 fallback
- 未映射 sku 清单、幂等重跑、租户隔离
- list_grade_pool：admin 全量 / 等级过滤 / 关键词 / rank 排序 / operator 店铺隔离（含父行边界匹配）
- attach_grades：库存列表出参合并
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pkgutil  # noqa: E402
import importlib  # noqa: E402
import models as _models_pkg  # noqa: E402

# models/__init__.py 导不全（缺 ProductSelection 等），必须动态导入全部模型，
# 否则 ORM mapper 初始化报 'ProductSelection' failed to locate
for _m in pkgutil.iter_modules(_models_pkg.__path__):
    importlib.import_module(f"models.{_m.name}")
import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from database.database import Base  # noqa: E402
from models.product_grade import ProductSalesGrade  # noqa: E402
from models.product_sales import ProductSales  # noqa: E402
from models.restock import InventorySnapshot  # noqa: E402
from models.store import Store  # noqa: E402
import services.grade_service as svc  # noqa: E402

TENANT = 1
PERIOD = "2026-10"
SNAP_DATE = "2026-10-31"

# (id, summary_flag, asin, msku, account, sales_30d)
SNAP_ROWS = [
    (1, "是", "B0COWBOY", "USA-A-1635", "JeVenis-US、JeVenis-MX、JeVenis-BR", 162.0),
    (2, "共享库存", "B0COWBOY", "USA-A-1635", "JeVenis-US", 161.0),
    (3, "共享库存", "B0COWBOY", "USA-A-1635", "JeVenis-MX", 0.0),
    (4, "共享库存", "B0COWBOY", "USA-A-1635", "JeVenis-BR", 1.0),
    (5, "0", "B0UNIQ", "USA-B-100", "G-USA", 50.0),
    (6, "共享库存", "B0EU1", "EU-C-900", "D-EU-DE", 20.0),
    (7, "共享库存", "B0EU1", "EU-C-900", "D-EU-FR", 5.0),
    (8, "0", "B0NOMSKU", None, "E-US", 7.0),
]

# (sku, store, sales_count) —— 同 sku 多日由多条记录模拟
SALES_ROWS = [
    ("USA-A-1635", "A美", 50), ("USA-A-1635", "A美", 51),   # 101 → A 档下边界
    ("USA-B-100", "G美", 95),
    ("EU-C-900", "C欧", 40),                                 # 「欧」歧义：DE/FR 两行都命中
    ("GHOST-1", "X美", 33),                                  # 无快照行 → 未映射
]

STORES = [(10, "JeVenis-US"), (11, "JeVenis-MX"), (12, "JeVenis-BR")]


def _make_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[
        InventorySnapshot.__table__, ProductSales.__table__,
        ProductSalesGrade.__table__, Store.__table__,
    ])
    TestingSession = sessionmaker(bind=engine)
    db = TestingSession()
    db.execute(text(
        "CREATE TABLE user_stores (id INTEGER PRIMARY KEY, user_id INTEGER, "
        "tenant_id INTEGER, store_id INTEGER)"))
    db.commit()
    return db


def _seed(db, tenant=TENANT):
    for rid, sf, asin, msku, account, s30 in SNAP_ROWS:
        db.execute(text(
            "INSERT INTO inventory_snapshots (id, tenant_id, snapshot_date, deleted_at, "
            "summary_flag, asin, msku, account, sales_30d) "
            "VALUES (:id, :t, :d, NULL, :sf, :asin, :msku, :acc, :s30)"),
            {"id": rid, "t": tenant, "d": SNAP_DATE, "sf": sf, "asin": asin,
             "msku": msku, "acc": account, "s30": s30})
    day = 1
    for sku, store, qty in SALES_ROWS:
        db.execute(text(
            "INSERT INTO product_sales (tenant_id, date, store, sku, sales_count, deleted_at) "
            "VALUES (:t, :d, :st, :sku, :q, NULL)"),
            {"t": tenant, "d": f"2026-10-{day:02d}", "st": store, "sku": sku, "q": qty})
        day += 1
    for sid, name in STORES:
        db.execute(text(
            "INSERT INTO stores (id, tenant_id, name, platform, inventory_name, status, "
            "created_at, updated_at, deleted_at) "
            "VALUES (:id, :t, :n, 'amazon', :n, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)"),
            {"id": sid, "t": tenant, "n": name})
    db.commit()


@pytest.fixture()
def db_session():
    db = _make_db()
    _seed(db)
    yield db
    db.close()


# ===== classify_grade =====

@pytest.mark.parametrize("sales,expected", [
    (None, "D"), (-5, "D"), (0, "D"),
    (1, "E"), (9, "E"), (10, "E"),
    (11, "C"), (30, "C"),
    (31, "B"), (100, "B"),
    (101, "A"), (300, "A"),
    (301, "S"), (9999, "S"),
])
def test_classify_grade_boundaries(sales, expected):
    assert svc.classify_grade(sales) == expected


# ===== recompute_grades =====

def test_recompute_user_example(db_session):
    """用户实例：B0COWBOY 父行合并 + 三子行分别评级（US 精确认领 / MX、BR fallback）"""
    result = svc.recompute_grades(db_session, TENANT, period=PERIOD)
    assert result["ok"] is True
    assert result["rows"] == 8

    rows = db_session.query(ProductSalesGrade).filter(
        ProductSalesGrade.tenant_id == TENANT,
        ProductSalesGrade.period == PERIOD,
        ProductSalesGrade.asin == "B0COWBOY",
    ).all()
    by_account = {r.account: r for r in rows}
    assert len(by_account) == 4

    father = by_account["JeVenis-US、JeVenis-MX、JeVenis-BR"]
    assert father.grade == "A" and father.monthly_sales == 101
    assert father.sales_source == "product_sales"

    us = by_account["JeVenis-US"]
    assert us.grade == "A" and us.monthly_sales == 101
    assert us.sales_source == "product_sales"

    mx = by_account["JeVenis-MX"]
    assert mx.grade == "D" and mx.monthly_sales == 0
    assert mx.sales_source == "no_data"

    br = by_account["JeVenis-BR"]
    assert br.grade == "E" and br.monthly_sales == 1
    assert br.sales_source == "fallback_30d"


def test_recompute_unique_claim_and_eu_ambiguity(db_session):
    """唯一认领 95→B；「欧」歧义组不认领、两行各自 fallback；无 msku 行 fallback"""
    result = svc.recompute_grades(db_session, TENANT, period=PERIOD)

    uniq = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period=PERIOD, asin="B0UNIQ").first()
    assert uniq.grade == "B" and uniq.monthly_sales == 95
    assert uniq.sales_source == "product_sales"

    de = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period=PERIOD, account="D-EU-DE").first()
    assert de.grade == "C" and de.monthly_sales == 20
    assert de.sales_source == "fallback_30d"

    fr = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period=PERIOD, account="D-EU-FR").first()
    assert fr.grade == "E" and fr.monthly_sales == 5
    assert fr.sales_source == "fallback_30d"

    nom = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period=PERIOD, asin="B0NOMSKU").first()
    assert nom.grade == "E" and nom.monthly_sales == 7

    assert result["source_count"]["product_sales"] == 3
    assert result["source_count"]["fallback_30d"] == 4
    assert result["source_count"]["no_data"] == 1
    assert result["unmapped_count"] == 1
    assert "GHOST-1" in result["unmapped_sample"]


def test_recompute_distribution_and_prev_grade(db_session):
    result = svc.recompute_grades(db_session, TENANT, period=PERIOD)
    assert result["distribution"] == {"S": 0, "A": 2, "B": 1, "C": 1, "D": 1, "E": 3}
    rows = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period=PERIOD).all()
    assert all(r.prev_grade is None for r in rows)
    assert all(r.grade_rule_version == svc.GRADE_VERSION for r in rows)


def test_recompute_idempotent(db_session):
    first = svc.recompute_grades(db_session, TENANT, period=PERIOD)
    second = svc.recompute_grades(db_session, TENANT, period=PERIOD)
    assert first["rows"] == second["rows"] == 8
    count = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period=PERIOD).count()
    assert count == 8  # 先删后插，不翻倍


def test_recompute_prev_grade_after_two_periods(db_session):
    """两期连跑：第二期 prev_grade 取第一期等级"""
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    # 造 11 月快照与销量，跑 2026-11
    db_session.execute(text(
        "INSERT INTO inventory_snapshots (id, tenant_id, snapshot_date, deleted_at, "
        "summary_flag, asin, msku, account, sales_30d) "
        "VALUES (21, :t, '2026-11-30', NULL, '0', 'B0UNIQ', 'USA-B-100', 'G-USA', 88)"),
        {"t": TENANT})
    db_session.execute(text(
        "INSERT INTO product_sales (tenant_id, date, store, sku, sales_count, deleted_at) "
        "VALUES (:t, '2026-11-05', 'G美', 'USA-B-100', 250, NULL)"), {"t": TENANT})
    db_session.commit()
    result = svc.recompute_grades(db_session, TENANT, period="2026-11")
    assert result["ok"] is True
    nov = db_session.query(ProductSalesGrade).filter_by(
        tenant_id=TENANT, period="2026-11", asin="B0UNIQ").first()
    assert nov.grade == "A" and nov.monthly_sales == 250
    assert nov.prev_grade == "B"  # 10 月 95 → B


def test_recompute_tenant_isolation(db_session):
    """其它租户无任何快照 → 返回 ok=False（无数据可算），不串租户"""
    result = svc.recompute_grades(db_session, 2, period=PERIOD)
    assert result["ok"] is False
    assert "无任何库存快照" in result["error"]
    count = db_session.query(ProductSalesGrade).filter_by(tenant_id=2).count()
    assert count == 0


# ===== list_grade_pool =====

def test_pool_admin_all(db_session):
    """列表口径 = 库存页可见行漏斗：父合并行代表整组，其子行不单独出现在列表"""
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    result = svc.list_grade_pool(
        db_session, TENANT, user_id=1, user_role="admin", holiday_filter="all")
    assert result["total"] == 5  # 父行 + B0UNIQ + EU 孤儿×2 + B0NOMSKU
    assert result["period"] == PERIOD
    assert result["distribution"]["A"] == 1
    accounts = {it["account"] for it in result["items"]}
    assert "JeVenis-US、JeVenis-MX、JeVenis-BR" in accounts
    # 父行等级 = 合并口径 A
    father = next(it for it in result["items"]
                  if it["account"] == "JeVenis-US、JeVenis-MX、JeVenis-BR")
    assert father["grade"] == "A" and father["monthly_sales"] == 101


def test_pool_grade_filter_and_keyword(db_session):
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    only_a = svc.list_grade_pool(
        db_session, TENANT, user_id=1, user_role="admin",
        grades=["A"], holiday_filter="all")
    assert only_a["total"] == 1  # 仅父合并行（US 子行不在列表可见行内）
    assert all(it["grade"] == "A" for it in only_a["items"])

    kw = svc.list_grade_pool(
        db_session, TENANT, user_id=1, user_role="admin",
        keyword="B0UNIQ", holiday_filter="all")
    assert kw["total"] == 1
    assert kw["items"][0]["asin"] == "B0UNIQ"


def test_pool_sort_by_grade_rank(db_session):
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    result = svc.list_grade_pool(
        db_session, TENANT, user_id=1, user_role="admin",
        holiday_filter="all", sort_field="grade", sort_order="desc")
    ranks = [svc.GRADE_RANK[it["grade"]] for it in result["items"]]
    assert ranks == sorted(ranks, reverse=True)
    assert ranks[0] == 5  # A（无 S）


def test_pool_operator_isolation(db_session):
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    # 未授权任何店铺 → 空
    empty = svc.list_grade_pool(
        db_session, TENANT, user_id=99, user_role="operator", holiday_filter="all")
    assert empty["total"] == 0
    # 授权 JeVenis-US → 父合并行经前缀边界匹配可见（子行有父行不在列表）
    db_session.execute(text(
        "INSERT INTO user_stores (user_id, tenant_id, store_id) VALUES (99, :t, 10)"),
        {"t": TENANT})
    db_session.commit()
    scoped = svc.list_grade_pool(
        db_session, TENANT, user_id=99, user_role="operator", holiday_filter="all")
    # 父合并行经「JeVenis-US、…」前缀边界匹配可见；US 子行本身有父行不在列表
    assert scoped["total"] == 1
    assert scoped["items"][0]["account"] == "JeVenis-US、JeVenis-MX、JeVenis-BR"


def test_pool_no_grades(db_session):
    result = svc.list_grade_pool(
        db_session, TENANT, user_id=1, user_role="admin", holiday_filter="all")
    assert result["total"] == 0
    assert result["period"] is None


def test_pool_summary(db_session):
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    summary = svc.grade_pool_summary(
        db_session, TENANT, user_id=1, user_role="admin", holiday_filter="all")
    assert summary["total"] == 5
    assert summary["distribution"]["A"] == 1
    # 测试数据只灌了 5 天销量（5/31=16% < 90%）→ 必须触发完整性提示
    assert summary["integrity_warning"] and "仅供参考" in summary["integrity_warning"]
    assert 0 < summary["fallback_ratio"] < 1


# ===== attach_grades =====

def test_attach_grades_merges_into_items(db_session):
    svc.recompute_grades(db_session, TENANT, period=PERIOD)
    items = [
        {"asin": "B0COWBOY", "account": "JeVenis-US"},
        {"asin": "B0COWBOY", "account": "JeVenis-MX"},
        {"asin": "B0NOTHERE", "account": "Whatever"},
    ]
    svc.attach_grades(db_session, TENANT, items)
    assert items[0]["grade"] == "A" and items[0]["monthly_sales"] == 101
    assert items[1]["grade"] == "D"
    assert "grade" not in items[2]
