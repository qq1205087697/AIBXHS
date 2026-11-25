"""产品月销量等级服务（S/A/B/C/D/E）

设计文档：docs/plans/2026-11-24_产品月销量等级体系_完整实现方案.md
口径要点（2026-11-24 用户拍板）：
- 行级 (tenant, asin, account) 逐行评级；父汇总行（summary_flag='是'）为合并口径。
- 行级销量三级归属：
    ① msku 在快照行集中唯一 → product_sales 自然月精确值
    ② 同 msku 跨行 → store 大区→站点映射认领，唯一命中才认领
    ③ 认领失败 → 该行上月末快照 sales_30d 折算（fallback_30d）
- 六档双闭区间无缝覆盖：S[301,+∞) A[101,300] B[31,100] C[11,30] E[1,10] D[0,0]。
- 可见性铁律：等级池查询复用 inventory_service 的可见行漏斗，禁止另写过滤。
"""
import logging
import re
from datetime import date, datetime, timedelta

from sqlalchemy import and_, case, func, tuple_
from sqlalchemy.orm import Session

from models.product_grade import ProductSalesGrade
from models.product_sales import ProductSales
from models.restock import InventorySnapshot

logger = logging.getLogger("grade_service")

# ===== 等级规则（双闭区间，边界划给更低档：10→E、300→A） =====
GRADE_RULES = [
    ("S", 301, None),
    ("A", 101, 300),
    ("B", 31, 100),
    ("C", 11, 30),
    ("E", 1, 10),
    ("D", 0, 0),
]
GRADE_VERSION = "v1"
GRADE_RANK = {"S": 6, "A": 5, "B": 4, "C": 3, "E": 2, "D": 1}
GRADES = ["S", "A", "B", "C", "D", "E"]

SOURCE_PRODUCT_SALES = "product_sales"
SOURCE_FALLBACK = "fallback_30d"
SOURCE_NO_DATA = "no_data"

# product_sales.store 大区后缀 → 快照 account 中的站点码集合（认领用）
SITE_MAP = {
    "美": {"US", "USA", "美国"},
    "英": {"UK", "英国"},
    "加": {"CA", "加拿大"},
    "澳": {"AU", "澳大利亚"},
    "日": {"JP", "日本"},
    "欧": {"DE", "FR", "IT", "ES", "BE", "NL", "PL", "SE", "IE"},
}
# account 中可能出现的大写站点码（'JeVenis-US'、'D-EU-DE'、'G-USA'）
_EN_SITE_RE = re.compile(
    r"(?<![A-Z])(US|USA|UK|CA|AU|JP|MX|BR|DE|FR|IT|ES|BE|NL|PL|SE|IE|AE|SG|TR)(?![A-Z])"
)
# account 中的中文站点名（'B美国'、'C美国'）
_CN_SITES = ["美国", "英国", "加拿大", "澳大利亚", "日本", "德国", "法国", "意大利",
             "西班牙", "墨西哥", "巴西", "荷兰", "瑞典", "波兰", "比利时", "爱尔兰",
             "阿联酋", "新加坡", "土耳其"]
_STORE_REGION_RE = re.compile(r"([\u4e00-\u9fff]+)$")  # store 末尾中文大区（'A美'→'美'）

_UNMAPPED_SAMPLE_LIMIT = 50


def classify_grade(monthly_sales):
    """纯函数分档。None/负数/0 → D；全边界用例见测试。"""
    if monthly_sales is None:
        return "D"
    try:
        v = float(monthly_sales)
    except (TypeError, ValueError):
        return "D"
    if v <= 0:
        return "D"
    for grade, low, high in GRADE_RULES:
        if v >= low and (high is None or v <= high):
            return grade
    return "D"


def get_current_period(today: date = None) -> str:
    """等级所属销量月份 = 上个自然月（每月 3 号计算）。"""
    d = today or date.today()
    prev_last = d.replace(day=1) - timedelta(days=1)
    return prev_last.strftime("%Y-%m")


def _prev_period(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    if m == 1:
        return f"{y - 1}-12"
    return f"{y}-{m - 1:02d}"


def _period_bounds(period: str):
    y, m = int(period[:4]), int(period[5:7])
    start = date(y, m, 1)
    end = date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)
    return start, end


def _sites_of(account: str) -> set:
    """从快照行 account 提取站点码集合（父行拼接串返回多码）。"""
    if not account:
        return set()
    sites = set(_EN_SITE_RE.findall(account))
    for cn in _CN_SITES:
        if cn in account:
            sites.add(cn)
    return sites


def _region_codes(store: str) -> set:
    """product_sales.store（品牌字母+大区中文）→ 站点码集合；无法解析返回空集。"""
    m = _STORE_REGION_RE.search(store or "")
    return SITE_MAP.get(m.group(1), set()) if m else set()


def _latest_snapshot_date(db: Session, tenant_id: int, period: str):
    """period 内最新快照日；period 内无快照则退全局最新（degraded=True 告警）。"""
    start, end = _period_bounds(period)
    d = db.query(func.max(InventorySnapshot.snapshot_date)).filter(
        InventorySnapshot.tenant_id == tenant_id,
        InventorySnapshot.snapshot_date >= start,
        InventorySnapshot.snapshot_date <= end,
        InventorySnapshot.deleted_at.is_(None),
    ).scalar()
    if d:
        return d, False
    d = db.query(func.max(InventorySnapshot.snapshot_date)).filter(
        InventorySnapshot.tenant_id == tenant_id,
        InventorySnapshot.deleted_at.is_(None),
    ).scalar()
    return d, True


def _sales_by_sku(db: Session, tenant_id: int, period: str) -> dict:
    """自然月销量合计，键 = UPPER(sku)。product_sales 单日只记有销量 sku → 无键即无销量。"""
    start, end = _period_bounds(period)
    rows = db.query(
        func.upper(ProductSales.sku),
        func.sum(ProductSales.sales_count),
    ).filter(
        ProductSales.tenant_id == tenant_id,
        ProductSales.date >= start,
        ProductSales.date <= end,
    ).group_by(func.upper(ProductSales.sku)).all()
    return {sku: int(qty or 0) for sku, qty in rows}


def _store_sales_by_sku(db: Session, tenant_id: int, period: str, skus: list) -> dict:
    """(sku, store) 维度月销量，仅对需要跨行认领的 sku 查询。"""
    if not skus:
        return {}
    start, end = _period_bounds(period)
    rows = db.query(
        func.upper(ProductSales.sku), ProductSales.store,
        func.sum(ProductSales.sales_count),
    ).filter(
        ProductSales.tenant_id == tenant_id,
        ProductSales.date >= start,
        ProductSales.date <= end,
        func.upper(ProductSales.sku).in_(skus),
    ).group_by(func.upper(ProductSales.sku), ProductSales.store).all()
    out: dict = {}
    for sku, store, qty in rows:
        out.setdefault(sku, []).append((store, int(qty or 0)))
    return out


def _fallback_row(s30) -> tuple:
    """行级兜底：快照 sales_30d 折算。0/NULL 归 no_data。"""
    fb = int(round(float(s30 or 0)))
    if fb > 0:
        return fb, SOURCE_FALLBACK
    return 0, SOURCE_NO_DATA


def recompute_grades(db: Session, tenant_id: int, period: str = None,
                     computed_by: str = "scheduler") -> dict:
    """等级池全量重算（幂等：先删该期再插入）。返回统计摘要。"""
    period = period or get_current_period()
    snap_date, degraded = _latest_snapshot_date(db, tenant_id, period)
    if not snap_date:
        return {"ok": False, "error": "无任何库存快照，无法计算等级", "period": period}

    # ===== 1. 行集（普通行 + 共享子行 + 父汇总行）=====
    rows = db.query(
        InventorySnapshot.summary_flag,
        func.upper(func.coalesce(InventorySnapshot.msku, "")),
        InventorySnapshot.asin,
        func.coalesce(InventorySnapshot.account, ""),
        InventorySnapshot.sales_30d,
    ).filter(
        InventorySnapshot.tenant_id == tenant_id,
        InventorySnapshot.snapshot_date == snap_date,
        InventorySnapshot.deleted_at.is_(None),
        InventorySnapshot.asin.isnot(None),
        InventorySnapshot.asin != "",
    ).all()

    sales = _sales_by_sku(db, tenant_id, period)

    # ===== 2. 非父行：按 msku 分组归属 =====
    # msku_groups: {UPPER(msku): [行下标]}（不含父行）
    msku_groups: dict = {}
    asin_msus: dict = {}  # asin -> {UPPER(msku)}（父行合并口径用）
    for idx, (flag, msku, asin, account, s30) in enumerate(rows):
        if (flag or "") == "是":
            continue
        if msku:
            msku_groups.setdefault(msku, []).append(idx)
            asin_msus.setdefault(asin, set()).add(msku)

    # 需要 (sku, store) 维度做认领的 sku：同 msku 多行
    claim_skus = [msku for msku, idxs in msku_groups.items() if len(idxs) > 1 and msku in sales]
    store_sales = _store_sales_by_sku(db, tenant_id, period, claim_skus)

    assigned = {}  # 行下标 -> (qty, source)
    multi_asin_skus = []

    for msku, idxs in msku_groups.items():
        qty = sales.get(msku)
        if qty is None:
            for i in idxs:  # product_sales 无此 msku → 行级兜底
                assigned[i] = _fallback_row(rows[i][4])
            continue
        group_asins = {rows[i][2] for i in idxs}
        if len(group_asins) > 1:
            # 同 msku 对应多个 asin（罕见）：均摊 + 告警
            share = max(1, round(qty / len(idxs)))
            multi_asin_skus.append({"sku": msku, "asins": sorted(group_asins), "qty": qty})
            for i in idxs:
                assigned[i] = (share, SOURCE_PRODUCT_SALES)
            continue
        if len(idxs) == 1:
            assigned[idxs[0]] = (qty, SOURCE_PRODUCT_SALES)
            continue
        # 同 asin 跨店多行：store 大区→站点认领。
        # 分配规则按「记录」维度：每条 store 记录只归属唯一命中行；
        # 多行同时命中同一记录（如「欧」合并多国）→ 该记录不分配（全组走 fallback）。
        st_sales = store_sales.get(msku) or []
        alloc: dict = {}  # 行下标 -> 认领销量合计
        for st, q in st_sales:
            codes = _region_codes(st)
            if not codes:
                continue
            hits = [i for i in idxs if _sites_of(rows[i][3]) & codes]
            if len(hits) == 1:
                alloc[hits[0]] = alloc.get(hits[0], 0) + q
        for i in idxs:
            if i in alloc:
                assigned[i] = (alloc[i], SOURCE_PRODUCT_SALES)
            else:
                assigned[i] = _fallback_row(rows[i][4])

    # ===== 3. 父汇总行：合并口径 = 该 ASIN 全部 msku 的 product_sales 合计 =====
    for idx, (flag, msku, asin, account, s30) in enumerate(rows):
        if (flag or "") != "是":
            continue
        merged = sum(sales.get(ms, 0) for ms in asin_msus.get(asin, ()))
        assigned[idx] = (merged, SOURCE_PRODUCT_SALES)

    # 兜底：任何未归属行（如 msku 为空串被分组跳过）按行级 sales_30d 兜底
    for idx in range(len(rows)):
        if idx not in assigned:
            assigned[idx] = _fallback_row(rows[idx][4])

    # 未映射 sku：product_sales 有销量但快照行集（非父）不含该 msku
    covered_msus = set(msku_groups.keys())
    unmapped = {sku: qty for sku, qty in sales.items() if sku not in covered_msus}

    # ===== 4. prev_grade 快照 + 落库（先删该期，再批量插入）=====
    prev_rows = db.query(ProductSalesGrade.asin, ProductSalesGrade.account,
                         ProductSalesGrade.grade).filter(
        ProductSalesGrade.tenant_id == tenant_id,
        ProductSalesGrade.period == _prev_period(period),
        ProductSalesGrade.deleted_at.is_(None),
    ).all()
    prev_map = {(a, acc): g for a, acc, g in prev_rows}

    now = datetime.now()
    insert_rows = []
    for idx, (flag, msku, asin, account, s30) in enumerate(rows):
        qty, source = assigned[idx]
        g = classify_grade(qty)
        insert_rows.append({
            "tenant_id": tenant_id,
            "period": period,
            "asin": asin,
            "account": account or "",
            "grade": g,
            "monthly_sales": int(qty),
            "sales_source": source,
            "grade_rule_version": GRADE_VERSION,
            "prev_grade": prev_map.get((asin, account or "")),
            "computed_at": now,
            "computed_by": computed_by,
            "created_at": now,
            "updated_at": now,
        })

    db.query(ProductSalesGrade).filter(
        ProductSalesGrade.tenant_id == tenant_id,
        ProductSalesGrade.period == period,
    ).delete(synchronize_session=False)
    if insert_rows:
        db.bulk_insert_mappings(ProductSalesGrade, insert_rows, return_defaults=False)
    db.commit()

    # ===== 5. 统计 =====
    distribution = {g: 0 for g in GRADES}
    source_count = {SOURCE_PRODUCT_SALES: 0, SOURCE_FALLBACK: 0, SOURCE_NO_DATA: 0}
    for r in insert_rows:
        distribution[r["grade"]] += 1
        source_count[r["sales_source"]] += 1

    prev_distribution = None
    shift_warning = False
    if prev_rows:
        prev_distribution = {g: 0 for g in GRADES}
        for _, _, g in prev_rows:
            if g in prev_distribution:
                prev_distribution[g] += 1
        total_now = max(1, len(insert_rows))
        total_prev = max(1, len(prev_rows))
        for g in GRADES:
            if abs(distribution[g] / total_now - prev_distribution[g] / total_prev) > 0.20:
                shift_warning = True
                break

    if degraded:
        logger.warning("等级计算 period=%s 在该月内无快照，已退用全局最新快照 %s", period, snap_date)
    if multi_asin_skus:
        logger.warning("等级计算发现同 msku 跨多个 asin（已均摊）: %s", multi_asin_skus[:10])
    if unmapped:
        logger.warning(
            "等级计算 period=%s 未映射销量 sku %s 个（多为下架品），样例: %s",
            period, len(unmapped), dict(list(unmapped.items())[:_UNMAPPED_SAMPLE_LIMIT]),
        )

    return {
        "ok": True,
        "period": period,
        "snapshot_date": snap_date.isoformat(),
        "degraded_snapshot": degraded,
        "rows": len(insert_rows),
        "distribution": distribution,
        "prev_distribution": prev_distribution,
        "shift_warning": shift_warning,
        "source_count": source_count,
        "unmapped_count": len(unmapped),
        "unmapped_sample": dict(list(unmapped.items())[:_UNMAPPED_SAMPLE_LIMIT]),
        "multi_asin_skus": multi_asin_skus[:20],
        "computed_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "computed_by": computed_by,
    }


def get_current_grade_period(db: Session, tenant_id: int):
    """等级池当前期与生成时间。无数据返回 (None, None)。"""
    row = db.query(
        ProductSalesGrade.period,
        func.max(ProductSalesGrade.computed_at),
    ).filter(
        ProductSalesGrade.tenant_id == tenant_id,
        ProductSalesGrade.deleted_at.is_(None),
    ).first()
    if not row or not row[0]:
        return None, None
    return row[0], row[1]


def _grade_base_query(db: Session, tenant_id: int, user_stores, keyword: str = None,
                      account=None, country=None, holiday_filter=None,
                      grade_filter=None):
    """等级池基础查询：可见快照行 JOIN 当前等级。

    复用 inventory_service 的可见行漏斗（铁律：不另写过滤）。
    返回 ORM Query（InventorySnapshot, ProductSalesGrade）或 None（无可见行）。
    """
    from services.inventory_service import (
        build_visible_snapshots, build_keep_cond,
    )

    latest = db.query(func.max(InventorySnapshot.snapshot_date)).filter(
        InventorySnapshot.tenant_id == tenant_id).scalar()
    if not latest:
        return None, None, None

    # user_stores=None → 不做店铺隔离（admin 语义，与 visible_store_names 一致）
    stores = user_stores

    visible_subq = build_visible_snapshots(
        db, tenant_id, latest, keyword=keyword, holiday_filter=holiday_filter,
        account=account, country=country, user_stores=stores,
    )
    if visible_subq is None:
        return None, None, latest

    cur_period = db.query(func.max(ProductSalesGrade.period)).filter(
        ProductSalesGrade.tenant_id == tenant_id,
        ProductSalesGrade.deleted_at.is_(None),
    ).scalar()
    if not cur_period:
        return "NO_GRADES", None, latest

    q = db.query(InventorySnapshot, ProductSalesGrade).outerjoin(
        ProductSalesGrade,
        and_(
            ProductSalesGrade.tenant_id == tenant_id,
            ProductSalesGrade.period == cur_period,
            ProductSalesGrade.deleted_at.is_(None),
            ProductSalesGrade.asin == InventorySnapshot.asin,
            func.coalesce(ProductSalesGrade.account, "") == func.coalesce(InventorySnapshot.account, ""),
        ),
    ).filter(
        InventorySnapshot.tenant_id == tenant_id,
        InventorySnapshot.snapshot_date == latest,
        InventorySnapshot.id.in_(visible_subq),
        InventorySnapshot.deleted_at.is_(None),
    )
    keep_cond = build_keep_cond(db, tenant_id, holiday_filter)
    if keep_cond is not None:
        q = q.filter(keep_cond)
    if grade_filter:
        q = q.filter(ProductSalesGrade.grade.in_(grade_filter))
    return q, cur_period, latest


_GRADE_RANK_EXPR = case(
    {g: r for g, r in GRADE_RANK.items()}, value=ProductSalesGrade.grade, else_=0
)


def list_grade_pool(db: Session, tenant_id: int, user_id: int = None, user_role: str = None,
                    keyword: str = None, grades=None, account=None, country=None,
                    holiday_filter=None, sort_field: str = None, sort_order: str = None,
                    page: int = 1, page_size: int = 20) -> dict:
    """等级池列表（含六档计数）。权限隔离由可见行漏斗内完成（user_stores）。"""
    from services.inventory_service import visible_store_names

    stores = visible_store_names(db, tenant_id, user_id, user_role)
    if stores == []:
        return {"items": [], "total": 0, "page": page, "page_size": page_size,
                "period": None, "distribution": {}}

    q, cur_period, latest = _grade_base_query(
        db, tenant_id, stores, keyword=keyword, account=account, country=country,
        holiday_filter=holiday_filter, grade_filter=grades,
    )
    if q == "NO_GRADES" or q is None:
        return {"items": [], "total": 0, "page": page, "page_size": page_size,
                "period": cur_period, "distribution": {}}

    # 分布统计（同过滤口径，单独轻量聚合）
    dist_rows = q.with_entities(ProductSalesGrade.grade, func.count()).group_by(
        ProductSalesGrade.grade).all()
    distribution = {g: 0 for g in GRADES}
    for g, c in dist_rows:
        if g in distribution:
            distribution[g] += c

    total = q.count()

    desc = (sort_order != "asc")
    if sort_field == "grade":
        order_col = _GRADE_RANK_EXPR.desc() if desc else _GRADE_RANK_EXPR.asc()
        q = q.order_by(order_col, InventorySnapshot.asin, InventorySnapshot.account)
    elif sort_field == "monthly_sales":
        order_col = func.coalesce(ProductSalesGrade.monthly_sales, 0)
        q = q.order_by(order_col.desc() if desc else order_col.asc(),
                       InventorySnapshot.asin, InventorySnapshot.account)
    elif sort_field:
        col = getattr(InventorySnapshot, sort_field, None)
        if col is not None:
            q = q.order_by(col.desc() if desc else col.asc(), InventorySnapshot.account)
        else:
            q = q.order_by(_GRADE_RANK_EXPR.desc(), InventorySnapshot.asin)
    else:
        q = q.order_by(_GRADE_RANK_EXPR.desc(), InventorySnapshot.asin, InventorySnapshot.account)

    results = q.offset((page - 1) * page_size).limit(page_size).all()
    items = []
    for snap, grade_row in results:
        items.append({
            "snapshot_id": snap.id,
            "asin": snap.asin,
            "sku": snap.sku,
            "msku": snap.msku,
            "product_name": snap.product_name,
            "account": snap.account,
            "country": snap.country,
            "summary_flag": snap.summary_flag,
            "grade": grade_row.grade if grade_row else None,
            "monthly_sales": grade_row.monthly_sales if grade_row else None,
            "sales_source": grade_row.sales_source if grade_row else None,
            "prev_grade": grade_row.prev_grade if grade_row else None,
            "computed_at": grade_row.computed_at.strftime("%Y-%m-%d %H:%M")
            if grade_row and grade_row.computed_at else None,
        })
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "period": cur_period, "distribution": distribution}


def grade_pool_summary(db: Session, tenant_id: int, user_id: int = None,
                       user_role: str = None, keyword: str = None, grades=None,
                       account=None, country=None, holiday_filter=None) -> dict:
    """等级池六档统计 + 数据完整性提示。"""
    from services.inventory_service import visible_store_names

    stores = visible_store_names(db, tenant_id, user_id, user_role)
    if stores == []:
        return {"period": None, "distribution": {g: 0 for g in GRADES},
                "total": 0, "fallback_ratio": 0, "integrity_warning": None}

    q, cur_period, latest = _grade_base_query(
        db, tenant_id, stores, keyword=keyword, account=account, country=country,
        holiday_filter=holiday_filter, grade_filter=grades,
    )
    base = {"period": cur_period, "distribution": {g: 0 for g in GRADES},
            "total": 0, "fallback_ratio": 0, "integrity_warning": None}
    if q == "NO_GRADES" or q is None:
        return base

    dist_rows = q.with_entities(ProductSalesGrade.grade, func.count()).group_by(
        ProductSalesGrade.grade).all()
    distribution = {g: 0 for g in GRADES}
    for g, c in dist_rows:
        if g in distribution:
            distribution[g] += c
    total = sum(distribution.values())

    fb_rows = q.with_entities(func.count()).filter(
        ProductSalesGrade.sales_source == SOURCE_FALLBACK).scalar() or 0
    fallback_ratio = round(fb_rows / total, 4) if total else 0

    # 数据完整性：product_sales 当期天数覆盖率（全租户口径）
    integrity_warning = None
    if cur_period:
        start, end = _period_bounds(cur_period)
        days = db.query(func.count(func.distinct(ProductSales.date))).filter(
            ProductSales.tenant_id == tenant_id,
            ProductSales.date >= start,
            ProductSales.date <= end,
        ).scalar() or 0
        period_days = (end - start).days + 1
        if days and days / period_days < 0.9:
            integrity_warning = (
                f"上月销量数据仅覆盖 {days}/{period_days} 天，本期等级仅供参考"
            )

    return {"period": cur_period, "distribution": distribution, "total": total,
            "fallback_ratio": fallback_ratio, "integrity_warning": integrity_warning}


def attach_grades(db: Session, tenant_id: int, items: list) -> None:
    """给库存列表 items（dict，含 asin/account）就地合并等级字段。

    命中 (asin, account) 的行显示 grade/monthly_sales/sales_source；
    父汇总行与子行各有自己的等级；未生成的行不写字段（前端显示 -）。
    """
    if not items:
        return
    asins = list({it.get("asin") for it in items if it.get("asin")})
    if not asins:
        return
    cur_period = db.query(func.max(ProductSalesGrade.period)).filter(
        ProductSalesGrade.tenant_id == tenant_id,
        ProductSalesGrade.deleted_at.is_(None),
    ).scalar()
    if not cur_period:
        return
    rows = db.query(
        ProductSalesGrade.asin, ProductSalesGrade.account, ProductSalesGrade.grade,
        ProductSalesGrade.monthly_sales, ProductSalesGrade.sales_source,
    ).filter(
        ProductSalesGrade.tenant_id == tenant_id,
        ProductSalesGrade.period == cur_period,
        ProductSalesGrade.deleted_at.is_(None),
        ProductSalesGrade.asin.in_(asins),
    ).all()
    gmap = {(a, acc or ""): (g, ms, src) for a, acc, g, ms, src in rows}
    for it in items:
        hit = gmap.get((it.get("asin"), (it.get("account") or "")))
        if hit:
            it["grade"], it["monthly_sales"], it["sales_source"] = hit


def notify_grade_failure(tenant_id: int, period: str, error: str) -> None:
    """等级池更新失败 → 站内通知 admin 角色（按天去重），自建 Session，吞异常。"""
    from database.database import SessionLocal
    from sqlalchemy import text

    db = None
    try:
        db = SessionLocal()
        title = f"等级池更新失败（{period}）"
        content = (
            f"产品月销量等级池 {period} 期自动更新失败，请到「等级池」页手动重算。\n"
            f"原因：{error}"
        )
        today = datetime.now().strftime("%Y-%m-%d")
        admins = db.execute(text(
            "SELECT DISTINCT u.id FROM users u "
            "JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL "
            "WHERE u.tenant_id = :tid AND r.code = 'admin' "
            "AND u.deleted_at IS NULL AND u.status = 'active'"
        ), {"tid": tenant_id}).fetchall()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        rows = []
        for (uid,) in admins:
            dup = db.execute(text(
                "SELECT COUNT(*) FROM notifications "
                "WHERE tenant_id = :tid AND user_id = :uid AND title = :title "
                "AND deleted_at IS NULL AND DATE(created_at) = :today"
            ), {"tid": tenant_id, "uid": uid, "title": title, "today": today}).scalar()
            if dup:
                continue
            rows.append({"tid": tenant_id, "uid": uid, "title": title,
                         "content": content, "now": now_str})
        if rows:
            db.execute(text(
                "INSERT INTO notifications "
                "(tenant_id, user_id, type, title, content, created_at, updated_at) "
                "VALUES (:tid, :uid, 'warning', :title, :content, :now, :now)"
            ), rows)
            db.commit()
            logger.warning("等级池失败通知已发送租户 %s：%s 条", tenant_id, len(rows))
    except Exception as e:  # noqa: BLE001 通知失败不允许阻塞主流程
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        logger.warning("等级池失败通知发送失败: %s", e)
    finally:
        if db is not None:
            db.close()
