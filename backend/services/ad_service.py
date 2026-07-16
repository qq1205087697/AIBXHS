"""
广告数据分析服务
提供搜索、筛选、概览、导出、分析等功能
"""
import logging
from typing import Optional, List
from sqlalchemy import func, or_, desc, asc
from sqlalchemy.orm import Session
from models.ad_report import AdReportSnapshot

logger = logging.getLogger(__name__)


def get_ad_filter_options(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    country: Optional[str] = None,
) -> dict:
    """获取筛选选项（国家/店铺/报告类型），支持国家-店铺联动"""
    # 国家列表
    countries = (
        db.query(AdReportSnapshot.country)
        .filter(
            AdReportSnapshot.tenant_id == tenant_id,
            AdReportSnapshot.deleted_at.is_(None),
            AdReportSnapshot.country.isnot(None),
            AdReportSnapshot.country != "",
        )
        .distinct()
        .order_by(AdReportSnapshot.country)
        .all()
    )

    # 店铺列表（支持按国家筛选）
    store_query = db.query(AdReportSnapshot.account).filter(
        AdReportSnapshot.tenant_id == tenant_id,
        AdReportSnapshot.deleted_at.is_(None),
        AdReportSnapshot.account.isnot(None),
        AdReportSnapshot.account != "",
    )
    if country:
        store_query = store_query.filter(AdReportSnapshot.country == country)
    stores = store_query.distinct().order_by(AdReportSnapshot.account).all()

    # 报告类型
    report_types = (
        db.query(AdReportSnapshot.report_type)
        .filter(
            AdReportSnapshot.tenant_id == tenant_id,
            AdReportSnapshot.deleted_at.is_(None),
            AdReportSnapshot.report_type.isnot(None),
        )
        .distinct()
        .all()
    )

    return {
        "countries": [c[0] for c in countries if c[0]],
        "stores": [s[0] for s in stores if s[0]],
        "report_types": [r[0] for r in report_types if r[0]],
    }


def _build_base_query(db: Session, tenant_id: int, department_ids: List[int], **filters):
    """构建基础查询，应用通用筛选条件"""
    query = db.query(AdReportSnapshot).filter(
        AdReportSnapshot.tenant_id == tenant_id,
        AdReportSnapshot.deleted_at.is_(None)
    )

    if filters.get("account"):
        query = query.filter(AdReportSnapshot.account.in_(filters["account"]))
    if filters.get("country"):
        query = query.filter(AdReportSnapshot.country.in_(filters["country"]))
    if filters.get("date_from"):
        query = query.filter(AdReportSnapshot.date >= filters["date_from"])
    if filters.get("date_to"):
        query = query.filter(AdReportSnapshot.date <= filters["date_to"])
    if filters.get("report_type"):
        query = query.filter(AdReportSnapshot.report_type == filters["report_type"])
    if filters.get("ad_type"):
        query = query.filter(AdReportSnapshot.ad_type == filters["ad_type"])
    if filters.get("match_type"):
        query = query.filter(AdReportSnapshot.match_type == filters["match_type"])
    if filters.get("keyword"):
        kw = f"%{filters['keyword']}%"
        query = query.filter(
            or_(
                AdReportSnapshot.campaign_name.ilike(kw),
                AdReportSnapshot.keyword.ilike(kw),
                AdReportSnapshot.search_term.ilike(kw),
                AdReportSnapshot.advertised_asin.ilike(kw),
            )
        )
    if filters.get("acos_min") is not None:
        query = query.filter(AdReportSnapshot.acos >= filters["acos_min"])
    if filters.get("acos_max") is not None:
        query = query.filter(AdReportSnapshot.acos <= filters["acos_max"])

    return query


def get_ad_overview(db: Session, tenant_id: int, department_ids: List[int], **filters) -> dict:
    """获取广告概览统计（8个核心指标）"""
    query = _build_base_query(db, tenant_id, department_ids, **filters)

    result = query.with_entities(
        func.coalesce(func.sum(AdReportSnapshot.spend), 0),
        func.coalesce(func.sum(AdReportSnapshot.sales), 0),
        func.coalesce(func.sum(AdReportSnapshot.impressions), 0),
        func.coalesce(func.sum(AdReportSnapshot.clicks), 0),
        func.coalesce(func.sum(AdReportSnapshot.orders), 0),
    ).first()

    total_spend = float(result[0])
    total_sales = float(result[1])
    total_impressions = int(result[2])
    total_clicks = int(result[3])
    total_orders = int(result[4])

    acos = round(total_spend / total_sales * 100, 2) if total_sales > 0 else 0
    roas = round(total_sales / total_spend, 2) if total_spend > 0 else 0
    ctr = round(total_clicks / total_impressions * 100, 2) if total_impressions > 0 else 0
    cpc = round(total_spend / total_clicks, 2) if total_clicks > 0 else 0
    cvr = round(total_orders / total_clicks * 100, 2) if total_clicks > 0 else 0
    cpa = round(total_spend / total_orders, 2) if total_orders > 0 else 0

    return {
        "total_spend": round(total_spend, 2),
        "total_sales": round(total_sales, 2),
        "total_impressions": total_impressions,
        "total_clicks": total_clicks,
        "total_orders": total_orders,
        "acos": acos,
        "roas": roas,
        "ctr": ctr,
        "cpc": cpc,
        "cvr": cvr,
        "cpa": cpa,
    }


def search_ad_data(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "spend",
    sort_order: str = "desc",
    **filters
) -> dict:
    """多维度搜索广告数据"""
    query = _build_base_query(db, tenant_id, department_ids, **filters)

    # 排序
    sort_map = {
        "spend": AdReportSnapshot.spend,
        "sales": AdReportSnapshot.sales,
        "acos": AdReportSnapshot.acos,
        "roas": AdReportSnapshot.roas,
        "ctr": AdReportSnapshot.ctr,
        "cpc": AdReportSnapshot.cpc,
        "cvr": AdReportSnapshot.cvr,
        "impressions": AdReportSnapshot.impressions,
        "clicks": AdReportSnapshot.clicks,
        "orders": AdReportSnapshot.orders,
        "date": AdReportSnapshot.date,
    }
    sort_col = sort_map.get(sort_by, AdReportSnapshot.spend)
    if sort_order == "asc":
        query = query.order_by(asc(sort_col))
    else:
        query = query.order_by(desc(sort_col))

    # 总数
    total = query.count()

    # 分页
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_snapshot_to_dict(item) for item in items],
    }


def get_ad_performance_trend(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    granularity: str = "daily",
    **filters
) -> List[dict]:
    """获取广告表现趋势（按日期聚合）"""
    query = _build_base_query(db, tenant_id, department_ids, **filters)

    results = query.with_entities(
        AdReportSnapshot.date,
        func.sum(AdReportSnapshot.spend).label("spend"),
        func.sum(AdReportSnapshot.sales).label("sales"),
        func.sum(AdReportSnapshot.impressions).label("impressions"),
        func.sum(AdReportSnapshot.clicks).label("clicks"),
        func.sum(AdReportSnapshot.orders).label("orders"),
    ).group_by(AdReportSnapshot.date).order_by(AdReportSnapshot.date).all()

    return [
        {
            "date": str(r.date),
            "spend": float(r.spend or 0),
            "sales": float(r.sales or 0),
            "impressions": int(r.impressions or 0),
            "clicks": int(r.clicks or 0),
            "orders": int(r.orders or 0),
        }
        for r in results
    ]


def get_keyword_analysis(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    **filters
) -> dict:
    """关键词分级分析"""
    filters_copy = dict(filters)
    filters_copy["report_type"] = "keyword"
    query = _build_base_query(db, tenant_id, department_ids, **filters_copy)

    results = query.with_entities(
        AdReportSnapshot.keyword,
        AdReportSnapshot.match_type,
        func.sum(AdReportSnapshot.spend).label("spend"),
        func.sum(AdReportSnapshot.sales).label("sales"),
        func.sum(AdReportSnapshot.clicks).label("clicks"),
        func.sum(AdReportSnapshot.orders).label("orders"),
        func.sum(AdReportSnapshot.impressions).label("impressions"),
    ).filter(
        AdReportSnapshot.keyword.isnot(None),
        AdReportSnapshot.keyword != "",
    ).group_by(AdReportSnapshot.keyword, AdReportSnapshot.match_type).all()

    keywords = []
    for r in results:
        spend = float(r.spend or 0)
        sales = float(r.sales or 0)
        clicks = int(r.clicks or 0)
        orders = int(r.orders or 0)
        acos = round(spend / sales * 100, 2) if sales > 0 else 0
        cvr = round(orders / clicks * 100, 2) if clicks > 0 else 0

        # 分级
        if orders > 0 and acos < 20:
            grade = "高转化词"
        elif clicks > 50 and orders == 0:
            grade = "烧钱词"
        elif clicks < 20 and spend > 0:
            grade = "潜力词"
        else:
            grade = "普通词"

        keywords.append({
            "keyword": r.keyword,
            "match_type": r.match_type,
            "spend": round(spend, 2),
            "sales": round(sales, 2),
            "acos": acos,
            "cvr": cvr,
            "clicks": clicks,
            "orders": orders,
            "impressions": int(r.impressions or 0),
            "grade": grade,
        })

    # 排序：花费从高到低
    keywords.sort(key=lambda x: x["spend"], reverse=True)

    return {
        "total": len(keywords),
        "high_conversion": [k for k in keywords if k["grade"] == "高转化词"],
        "money_burner": [k for k in keywords if k["grade"] == "烧钱词"],
        "potential": [k for k in keywords if k["grade"] == "潜力词"],
        "normal": [k for k in keywords if k["grade"] == "普通词"],
        "all": keywords,
    }


def get_search_term_analysis(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    **filters
) -> dict:
    """搜索词分析"""
    query = _build_base_query(db, tenant_id, department_ids, **filters)
    query = query.filter(
        AdReportSnapshot.search_term.isnot(None),
        AdReportSnapshot.search_term != "",
    )

    results = query.with_entities(
        AdReportSnapshot.search_term,
        AdReportSnapshot.keyword,
        AdReportSnapshot.match_type,
        func.sum(AdReportSnapshot.spend).label("spend"),
        func.sum(AdReportSnapshot.sales).label("sales"),
        func.sum(AdReportSnapshot.clicks).label("clicks"),
        func.sum(AdReportSnapshot.orders).label("orders"),
        func.sum(AdReportSnapshot.impressions).label("impressions"),
    ).group_by(
        AdReportSnapshot.search_term,
        AdReportSnapshot.keyword,
        AdReportSnapshot.match_type,
    ).all()

    search_terms = []
    negative_keyword_suggestions = []

    for r in results:
        spend = float(r.spend or 0)
        sales = float(r.sales or 0)
        clicks = int(r.clicks or 0)
        orders = int(r.orders or 0)
        acos = round(spend / sales * 100, 2) if sales > 0 else 0
        cvr = round(orders / clicks * 100, 2) if clicks > 0 else 0

        item = {
            "search_term": r.search_term,
            "related_keyword": r.keyword,
            "match_type": r.match_type,
            "spend": round(spend, 2),
            "sales": round(sales, 2),
            "acos": acos,
            "cvr": cvr,
            "clicks": clicks,
            "orders": orders,
            "impressions": int(r.impressions or 0),
        }
        search_terms.append(item)

        # 否定关键词建议：花费>100 且 0订单
        if spend > 100 and orders == 0:
            negative_keyword_suggestions.append(item)

    search_terms.sort(key=lambda x: x["spend"], reverse=True)

    return {
        "total": len(search_terms),
        "items": search_terms,
        "negative_keyword_suggestions": negative_keyword_suggestions,
    }


def export_ad_data(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    **filters
) -> bytes:
    """导出广告数据为Excel字节流"""
    import pandas as pd
    import io as io_module

    query = _build_base_query(db, tenant_id, department_ids, **filters)
    items = query.all()

    data = [_snapshot_to_dict(item) for item in items]
    df = pd.DataFrame(data)

    output = io_module.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='广告数据')

    return output.getvalue()


def _snapshot_to_dict(snapshot: AdReportSnapshot) -> dict:
    """将 AdReportSnapshot 对象转为字典"""
    return {
        "id": snapshot.id,
        "account": snapshot.account,
        "country": snapshot.country,
        "date": str(snapshot.date) if snapshot.date else None,
        "campaign_name": snapshot.campaign_name,
        "ad_group_name": snapshot.ad_group_name,
        "report_type": snapshot.report_type,
        "keyword": snapshot.keyword,
        "match_type": snapshot.match_type,
        "search_term": snapshot.search_term,
        "ad_type": snapshot.ad_type,
        "advertised_asin": snapshot.advertised_asin,
        "advertised_sku": snapshot.advertised_sku,
        "impressions": snapshot.impressions,
        "clicks": snapshot.clicks,
        "spend": float(snapshot.spend) if snapshot.spend else 0,
        "orders": snapshot.orders,
        "sales": float(snapshot.sales) if snapshot.sales else 0,
        "ctr": float(snapshot.ctr) if snapshot.ctr else 0,
        "cpc": float(snapshot.cpc) if snapshot.cpc else 0,
        "acos": float(snapshot.acos) if snapshot.acos else 0,
        "roas": float(snapshot.roas) if snapshot.roas else 0,
        "cvr": float(snapshot.cvr) if snapshot.cvr else 0,
        "cpa": float(snapshot.cpa) if snapshot.cpa else 0,
    }