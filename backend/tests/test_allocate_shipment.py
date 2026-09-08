"""分货公式计算测试 - 基于 Excel 模板场景验证

验证 services.inventory_service.allocate_shipment 的判断逻辑和 5 倍数规则。
allocate_shipment 依赖 _fetch_latest_snapshot_metrics 查询数据库，
本测试用 unittest.mock.patch 绕过数据库，直接验证判断与取整逻辑。

patch 路径：services.inventory_service._fetch_latest_snapshot_metrics
"""
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def db_session():
    """数据库查询已被 mock，session 不会被真正使用，返回 None 即可"""
    return None


def _make_metrics(sales_30d, spot_qty, inbound_qty, found=True):
    return {
        "sales_30d": sales_30d,
        "spot_qty": spot_qty,
        "inbound_qty": inbound_qty,
        "found": found,
    }


def _call_allocate(db_session, mock_metrics, asin, country, purchase_qty):
    """统一调用入口：设置 mock 后执行 allocate_shipment 并返回首条结果"""
    mock_metrics.return_value = _make_metrics(
        _current_metrics["sales_30d"],
        _current_metrics["spot_qty"],
        _current_metrics["inbound_qty"],
        _current_metrics["found"],
    )
    from services.inventory_service import allocate_shipment

    items = [
        {
            "asin": asin,
            "country": country,
            "purchase_qty": purchase_qty,
        }
    ]
    result = allocate_shipment(db_session, tenant_id=1, items=items)
    return result[0]


# 每个测试通过 _current_metrics 字典向 _call_allocate 传递 mock 返回值，
# 避免重复构造调用样板
_current_metrics = {"sales_30d": 0, "spot_qty": 0, "inbound_qty": 0, "found": True}


def _set_metrics(sales_30d, spot_qty, inbound_qty, found=True):
    _current_metrics["sales_30d"] = sales_30d
    _current_metrics["spot_qty"] = spot_qty
    _current_metrics["inbound_qty"] = inbound_qty
    _current_metrics["found"] = found


# ==================== 美国站（multiplier=1.0） ====================


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_us_red_supply_gap(mock_metrics, db_session):
    """场景1: 美国站红单补差额 - 现货不足以覆盖需求，无在途"""
    _set_metrics(18, 8, 0)
    r = _call_allocate(db_session, mock_metrics, "A001", "美国", 20)
    assert r["judgment"] == "红单补差额"
    assert r["red_qty"] == 10
    assert r["sea_qty"] == 10


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_us_all_sea(mock_metrics, db_session):
    """场景2: 美国站全部海运 - 现货足以覆盖需求"""
    _set_metrics(5, 20, 0)
    r = _call_allocate(db_session, mock_metrics, "A002", "美国", 15)
    assert r["judgment"] == "全部海运"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 15


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_us_all_zero(mock_metrics, db_session):
    """场景3: 美国站全为0 - 销量/现货/在途均为0"""
    _set_metrics(0, 0, 0)
    r = _call_allocate(db_session, mock_metrics, "A003", "美国", 10)
    assert r["judgment"] == "全为0"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 0


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_us_red_gap_no_spot_but_inbound(mock_metrics, db_session):
    """场景4: 美国站红单补差额 - 无现货有在途，但需求超过在途"""
    _set_metrics(25, 0, 10)
    r = _call_allocate(db_session, mock_metrics, "A004", "美国", 30)
    assert r["judgment"] == "红单补差额"
    assert r["red_qty"] == 15
    assert r["sea_qty"] == 15


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_us_all_sea_no_spot_but_inbound(mock_metrics, db_session):
    """场景5: 美国站全部海运 - 无现货有在途，在途足以覆盖需求"""
    _set_metrics(8, 0, 15)
    r = _call_allocate(db_session, mock_metrics, "A005", "美国", 20)
    assert r["judgment"] == "全部海运"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 20


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_us_operator_decide(mock_metrics, db_session):
    """场景6: 美国站运营自行判断 - 现货不足且存在在途，需人工判断"""
    _set_metrics(25, 10, 5)
    r = _call_allocate(db_session, mock_metrics, "A006", "美国", 30)
    assert r["judgment"] == "运营自行判断"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 0


# ==================== 加欧英站（multiplier=1.5） ====================


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_ca_all_sea(mock_metrics, db_session):
    """场景7: 加拿大站全部海运 - 放大1.5倍需求仍可由现货覆盖"""
    _set_metrics(18, 30, 0)
    r = _call_allocate(db_session, mock_metrics, "A007", "加拿大", 20)
    assert r["judgment"] == "全部海运"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 20


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_ca_red_supply_gap_round_up(mock_metrics, db_session):
    """场景8: 加拿大站红单补差额 - 放大1.5倍后需求超过现货，red_raw=7 进一到10"""
    _set_metrics(18, 20, 0)
    r = _call_allocate(db_session, mock_metrics, "A008", "加拿大", 25)
    assert r["judgment"] == "红单补差额"
    assert r["red_qty"] == 10
    assert r["sea_qty"] == 15


# ==================== 边界场景 ====================


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_sku_not_found(mock_metrics, db_session):
    """场景9: SKU为空 - 快照查询未命中 found=False"""
    _set_metrics(0, 0, 0, found=False)
    r = _call_allocate(db_session, mock_metrics, "A009", "美国", 20)
    assert r["judgment"] == "SKU为空"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 0


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_no_stock_no_inbound_with_sales(mock_metrics, db_session):
    """场景10: 无库存无在途 - 有销量但现货和在途均为0"""
    _set_metrics(10, 0, 0)
    r = _call_allocate(db_session, mock_metrics, "A010", "美国", 20)
    assert r["judgment"] == "无库存无在途"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 0


# ==================== 5倍数规则专项测试 ====================


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_round_up_7_to_10(mock_metrics, db_session):
    """场景11: red_raw=7 进一法到 10（加拿大站 1.5 倍）"""
    _set_metrics(18, 20, 0)
    r = _call_allocate(db_session, mock_metrics, "A011", "加拿大", 25)
    # demand=18*1.5=27, red_raw=27-20=7, _round_up_to_5(7)=10
    assert r["red_qty"] == 10
    assert r["sea_qty"] == 15
    assert r["judgment"] == "红单补差额"


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_round_up_exact_multiple_of_5(mock_metrics, db_session):
    """场景12: red_raw 正好是 5 的倍数（10），_round_up_to_5(10)=10"""
    _set_metrics(18, 8, 0)
    r = _call_allocate(db_session, mock_metrics, "A012", "美国", 20)
    # demand=18*1.0=18, red_raw=18-8=10, _round_up_to_5(10)=10
    assert r["red_qty"] == 10
    assert r["sea_qty"] == 10
    assert r["judgment"] == "红单补差额"


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_round_up_exceeds_purchase(mock_metrics, db_session):
    """场景13: red 向上取整后超过进货量，red 改为 PURCHASE 向下取整到 5 的倍数，sea=0

    country="美国", S30=100, SPOT=90, INBOUND=0, PURCHASE=8
    demand=100, red_raw=10, _round_up_to_5(10)=10 > PURCHASE=8
    → red=(8//5)*5=5, sea=0
    """
    _set_metrics(100, 90, 0)
    r = _call_allocate(db_session, mock_metrics, "A013", "美国", 8)
    assert r["judgment"] == "红单补差额"
    assert r["red_qty"] == 5
    assert r["sea_qty"] == 0


# ==================== SKU 查询场景 ====================


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_sku_query_red_supply_gap(mock_metrics, db_session):
    """场景14: 传 sku 查询 - 红单补差额，结果含 sku 字段"""
    _set_metrics(18, 8, 0)
    mock_metrics.return_value = _make_metrics(18, 8, 0)
    from services.inventory_service import allocate_shipment

    items = [{"sku": "SKU-TEST-001", "country": "美国", "purchase_qty": 20}]
    result = allocate_shipment(db_session, tenant_id=1, items=items)
    r = result[0]
    assert r["judgment"] == "红单补差额"
    assert r["red_qty"] == 10
    assert r["sea_qty"] == 10
    assert r["sku"] == "SKU-TEST-001"
    assert r["asin"] == ""


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_sku_query_all_sea(mock_metrics, db_session):
    """场景15: 传 sku 查询 - 全部海运"""
    _set_metrics(5, 20, 0)
    mock_metrics.return_value = _make_metrics(5, 20, 0)
    from services.inventory_service import allocate_shipment

    items = [{"sku": "SKU-TEST-002", "country": "美国", "purchase_qty": 15}]
    result = allocate_shipment(db_session, tenant_id=1, items=items)
    r = result[0]
    assert r["judgment"] == "全部海运"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 15
    assert r["sku"] == "SKU-TEST-002"


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_sku_query_not_found(mock_metrics, db_session):
    """场景16: 传 sku 查询未找到 - 返回 SKU为空"""
    mock_metrics.return_value = _make_metrics(0, 0, 0, found=False)
    from services.inventory_service import allocate_shipment

    items = [{"sku": "NOT-EXIST", "country": "美国", "purchase_qty": 10}]
    result = allocate_shipment(db_session, tenant_id=1, items=items)
    r = result[0]
    assert r["judgment"] == "SKU为空"
    assert r["red_qty"] == 0
    assert r["sea_qty"] == 0


@patch("services.inventory_service._fetch_latest_snapshot_metrics")
def test_sku_and_asin_mixed_batch(mock_metrics, db_session):
    """场景17: 批量混合 - 一行传 asin，一行传 sku，互不干扰"""
    from services.inventory_service import allocate_shipment

    # 第一次调用（asin）返回红单补差额，第二次调用（sku）返回全部海运
    mock_metrics.side_effect = [
        _make_metrics(18, 8, 0),   # asin 行
        _make_metrics(5, 20, 0),   # sku 行
    ]
    items = [
        {"asin": "B001", "country": "美国", "purchase_qty": 20},
        {"sku": "SKU-MIX-001", "country": "美国", "purchase_qty": 15},
    ]
    result = allocate_shipment(db_session, tenant_id=1, items=items)
    assert len(result) == 2
    assert result[0]["asin"] == "B001"
    assert result[0]["sku"] == ""
    assert result[0]["judgment"] == "红单补差额"
    assert result[1]["sku"] == "SKU-MIX-001"
    assert result[1]["asin"] == ""
    assert result[1]["judgment"] == "全部海运"
