import json
import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_user
from models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/product-selection", tags=["product-selection"])


class ProductSelectionCreate(BaseModel):
    product_title: str
    url: Optional[str] = None
    asin: Optional[str] = None
    image_url: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    keywords: Optional[str] = None
    price: Optional[float] = None
    commission: Optional[float] = None
    first_leg_cost: Optional[float] = None
    last_mile_cost: Optional[float] = None
    weight_kg: Optional[float] = None
    cost_at_15_profit: Optional[float] = None
    product_type: Optional[str] = None
    site: Optional[str] = None
    monthly_sales: Optional[int] = None
    traffic_trend: Optional[str] = None

class ProductSelectionUpdate(BaseModel):
    product_title: Optional[str] = None
    url: Optional[str] = None
    asin: Optional[str] = None
    image_url: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    keywords: Optional[str] = None
    price: Optional[float] = None
    commission: Optional[float] = None
    first_leg_cost: Optional[float] = None
    last_mile_cost: Optional[float] = None
    weight_kg: Optional[float] = None
    cost_at_15_profit: Optional[float] = None
    product_type: Optional[str] = None
    site: Optional[str] = None
    monthly_sales: Optional[int] = None
    traffic_trend: Optional[str] = None


def _row_to_dict(row) -> dict:
    return {
        "id": row[0],
        "tenant_id": row[1],
        "product_title": row[2],
        "url": row[3] or "",
        "asin": row[4] or "",
        "image_url": row[5] or "",
        "rating": float(row[6]) if row[6] is not None else None,
        "review_count": row[7],
        "keywords": row[8] or "",
        "price": float(row[9]) if row[9] is not None else None,
        "commission": float(row[10]) if row[10] is not None else None,
        "first_leg_cost": float(row[11]) if row[11] is not None else None,
        "last_mile_cost": float(row[12]) if row[12] is not None else None,
        "weight_kg": float(row[13]) if row[13] is not None else None,
        "cost_at_15_profit": float(row[14]) if row[14] is not None else None,
        "product_type": row[15] or "",
        "site": row[16] or "",
        "monthly_sales": row[17],
        "traffic_trend": row[18] or "",
        "seasonality": row[19] or "",
        "infringement_analysis": row[20] or "",
        "infringement_conclusion": row[21] or "",
        "traffic_score_result": row[22] or "",
        "traffic_score": float(row[23]) if row[23] is not None else None,
        "sales_score": float(row[24]) if row[24] is not None else None,
        "rating_score": float(row[25]) if row[25] is not None else None,
        "penalty_factor": float(row[26]) if row[26] is not None else None,
        "composite_score": float(row[27]) if row[27] is not None else None,
        "created_at": row[28].strftime("%Y-%m-%d %H:%M:%S") if row[28] else "",
        "updated_at": row[29].strftime("%Y-%m-%d %H:%M:%S") if row[29] else "",
    }


@router.get("/types")
async def get_product_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户已有的产品类型列表"""
    try:
        query = text("""
            SELECT DISTINCT product_type
            FROM product_selections
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL AND product_type IS NOT NULL AND product_type != ''
            ORDER BY product_type
        """)
        result = db.execute(query, {"tenant_id": current_user.tenant_id})
        types = [row[0] for row in result]
        return {"success": True, "data": types}
    except Exception as e:
        logger.error(f"获取产品类型列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取产品类型列表失败: {str(e)}")


@router.get("/dates")
async def get_product_dates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户已有的选品日期列表（去重，倒序）"""
    try:
        query = text("""
            SELECT DISTINCT DATE(created_at) AS dt
            FROM product_selections
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL
            ORDER BY dt DESC
        """)
        result = db.execute(query, {"tenant_id": current_user.tenant_id})
        dates = [row[0].strftime("%Y-%m-%d") if hasattr(row[0], 'strftime') else str(row[0]) for row in result]
        return {"success": True, "data": dates}
    except Exception as e:
        logger.error(f"获取选品日期列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取选品日期列表失败: {str(e)}")


@router.get("/sites")
async def get_product_sites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户已有的站点列表"""
    try:
        query = text("""
            SELECT DISTINCT site
            FROM product_selections
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL AND site IS NOT NULL AND site != ''
            ORDER BY site
        """)
        result = db.execute(query, {"tenant_id": current_user.tenant_id})
        sites = [row[0] for row in result]
        return {"success": True, "data": sites}
    except Exception as e:
        logger.error(f"获取站点列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取站点列表失败: {str(e)}")


@router.get("/")
async def get_product_selections(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    product_type: Optional[str] = None,
    site: Optional[str] = None,
    date_filter: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = "desc",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["ps.tenant_id = :tenant_id", "ps.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if search:
            where_conditions.append(
                "(ps.asin LIKE :search OR ps.product_title LIKE :search OR ps.keywords LIKE :search)"
            )
            params["search"] = f"%{search}%"

        if product_type:
            where_conditions.append("ps.product_type = :product_type")
            params["product_type"] = product_type

        if site:
            where_conditions.append("ps.site = :site")
            params["site"] = site

        if date_filter:
            where_conditions.append("DATE(ps.created_at) = :date_filter")
            params["date_filter"] = date_filter

        where_clause = " AND ".join(where_conditions)

        count_query = text(f"SELECT COUNT(*) FROM product_selections ps WHERE {where_clause}")
        total = db.execute(count_query, params).scalar() or 0

        order_column = "ps.created_at"
        if sort_by and sort_by in [
            "composite_score", "rating", "price", "monthly_sales", "created_at",
            "product_title", "asin", "product_type", "site", "commission",
            "first_leg_cost", "last_mile_cost", "weight_kg", "cost_at_15_profit",
            "review_count"
        ]:
            order_column = f"ps.{sort_by}"
        order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"

        offset = (page - 1) * page_size
        params["offset"] = offset
        params["limit"] = page_size

        query = text(f"""
            SELECT ps.id, ps.tenant_id, ps.product_title, ps.url, ps.asin, ps.image_url,
                   ps.rating, ps.review_count, ps.keywords, ps.price, ps.commission,
                   ps.first_leg_cost, ps.last_mile_cost, ps.weight_kg, ps.cost_at_15_profit,
                   ps.product_type, ps.site, ps.monthly_sales, ps.traffic_trend,
                   ps.seasonality, ps.infringement_analysis, ps.infringement_conclusion, ps.traffic_score_result,
                   ps.traffic_score, ps.sales_score, ps.rating_score, ps.penalty_factor, ps.composite_score,
                   ps.created_at, ps.updated_at
            FROM product_selections ps
            WHERE {where_clause}
            ORDER BY {order_column} {order_dir}
            LIMIT :limit OFFSET :offset
        """)
        result = db.execute(query, params)
        items = [_row_to_dict(row) for row in result]

        return {
            "success": True,
            "data": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
        }
    except Exception as e:
        logger.error(f"获取选品列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取选品列表失败: {str(e)}")


@router.get("/{selection_id}")
async def get_product_selection(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        query = text("""
            SELECT ps.id, ps.tenant_id, ps.product_title, ps.url, ps.asin, ps.image_url,
                   ps.rating, ps.review_count, ps.keywords, ps.price, ps.commission,
                   ps.first_leg_cost, ps.last_mile_cost, ps.weight_kg, ps.cost_at_15_profit,
                   ps.product_type, ps.site, ps.monthly_sales, ps.traffic_trend,
                   ps.seasonality, ps.infringement_analysis, ps.infringement_conclusion, ps.traffic_score_result,
                   ps.traffic_score, ps.sales_score, ps.rating_score, ps.penalty_factor, ps.composite_score,
                   ps.created_at, ps.updated_at
            FROM product_selections ps
            WHERE ps.id = :id AND ps.tenant_id = :tid AND ps.deleted_at IS NULL
        """)
        row = db.execute(query, {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        return {"success": True, "data": _row_to_dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取选品详情失败: {str(e)}")


@router.post("/")
async def create_product_selection(
    data: ProductSelectionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        insert_sql = text("""
            INSERT INTO product_selections (
                tenant_id, product_title, url, asin, image_url, rating, review_count,
                keywords, price, commission, first_leg_cost, last_mile_cost, weight_kg,
                cost_at_15_profit, product_type, site, monthly_sales, traffic_trend
            ) VALUES (
                :tenant_id, :product_title, :url, :asin, :image_url, :rating, :review_count,
                :keywords, :price, :commission, :first_leg_cost, :last_mile_cost, :weight_kg,
                :cost_at_15_profit, :product_type, :site, :monthly_sales, :traffic_trend
            )
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "product_title": data.product_title,
            "url": data.url,
            "asin": data.asin,
            "image_url": data.image_url,
            "rating": data.rating,
            "review_count": data.review_count,
            "keywords": data.keywords,
            "price": data.price,
            "commission": data.commission,
            "first_leg_cost": data.first_leg_cost,
            "last_mile_cost": data.last_mile_cost,
            "weight_kg": data.weight_kg,
            "cost_at_15_profit": data.cost_at_15_profit,
            "product_type": data.product_type,
            "site": data.site,
            "monthly_sales": data.monthly_sales,
            "traffic_trend": data.traffic_trend,
        })
        db.commit()
        return {"success": True, "message": "选品记录创建成功", "data": {"id": result.lastrowid}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建选品记录失败: {str(e)}")


@router.put("/{selection_id}")
async def update_product_selection(
    selection_id: int,
    data: ProductSelectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        check = text("SELECT id FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        if not db.execute(check, {"id": selection_id, "tid": current_user.tenant_id}).fetchone():
            raise HTTPException(status_code=404, detail="选品记录不存在")

        updates = []
        params = {"id": selection_id}
        field_mapping = {
            "product_title": "product_title", "url": "url", "asin": "asin",
            "image_url": "image_url", "rating": "rating", "review_count": "review_count",
            "keywords": "keywords", "price": "price", "commission": "commission",
            "first_leg_cost": "first_leg_cost", "last_mile_cost": "last_mile_cost",
            "weight_kg": "weight_kg", "cost_at_15_profit": "cost_at_15_profit",
            "product_type": "product_type", "site": "site",
            "monthly_sales": "monthly_sales", "traffic_trend": "traffic_trend"
        }

        for field, col in field_mapping.items():
            value = getattr(data, field, None)
            if value is not None:
                updates.append(f"{col} = :{field}")
                params[field] = value

        if updates:
            update_sql = text(f"UPDATE product_selections SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id")
            db.execute(update_sql, params)
            db.commit()

        return {"success": True, "message": "选品记录更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新选品记录失败: {str(e)}")


@router.delete("/{selection_id}")
async def delete_product_selection(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        check = text("SELECT id FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        if not db.execute(check, {"id": selection_id, "tid": current_user.tenant_id}).fetchone():
            raise HTTPException(status_code=404, detail="选品记录不存在")

        db.execute(text("UPDATE product_selections SET deleted_at = NOW() WHERE id = :id"), {"id": selection_id})
        db.commit()
        return {"success": True, "message": "选品记录删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除选品记录失败: {str(e)}")


def _calc_rating_score(rating: float | None, review_count: int | None) -> float:
    """根据产品评分和评论数计算星级评分"""
    if rating is None:
        return 20.0

    review_count = review_count or 0
    r = round(rating, 1)

    if review_count <= 3:
        if r >= 4.8: return 16.0
        elif r >= 4.5: return 14.0
        elif r >= 4.2: return 12.0
        else: return 6.0
    elif review_count <= 10:
        if r >= 4.7: return 14.0
        elif r >= 4.4: return 11.0
        elif r >= 4.1: return 8.0
        else: return 3.0
    else:
        # 评论数 > 10 时，要求更高
        if r >= 4.7: return 18.0
        elif r >= 4.5: return 15.0
        elif r >= 4.3: return 12.0
        elif r >= 4.0: return 9.0
        else: return 5.0


def _calc_sales_score(monthly_sales: int | None) -> float:
    """根据近一个月销量计算销量评分"""
    s = monthly_sales or 0
    if s == 0: return 0.0
    if s == 1: return 6.0
    if s == 2: return 9.0
    if 3 <= s <= 4: return 12.0
    if 5 <= s <= 9: return 15.0
    if 10 <= s <= 19: return 18.0
    return 20.0


def _calc_penalty_factor(rating_score: float) -> float:
    """根据星级评分计算惩罚因子"""
    if rating_score >= 16: return 1.00
    elif rating_score >= 12: return 0.95
    elif rating_score >= 8: return 0.85
    elif rating_score >= 4: return 0.70
    else: return 0.50


def _calc_composite_score(penalty_factor: float, traffic_score: float, sales_score: float) -> float:
    """根据公式计算综合评分：(惩罚因子 * 流量评分 * 0.6 + 销量评分 * 5 * 0.4).ROUND(2)"""
    return round(penalty_factor * traffic_score * 0.6 + sales_score * 5 * 0.4, 2)


def _calc_traffic_score(traffic_trend_str: str | None) -> tuple[float, str]:
    """根据流量趋势数据公式化计算流量评分（满分100），返回(评分, 详细结果JSON)"""
    import math
    import statistics
    import ast

    def r2(x):
        return round(float(x), 2)

    if not traffic_trend_str:
        return 0.0, ""

    try:
        month_volume = ast.literal_eval(traffic_trend_str)
    except Exception:
        return 0.0, ""

    if not isinstance(month_volume, dict) or not month_volume:
        return 0.0, ""

    values = [v for v in month_volume.values() if isinstance(v, (int, float))]
    n = len(values)

    if n == 0:
        return 0.0, ""

    result = {
        "趋势方向强度分": 0.0,
        "趋势一致性分": 0.0,
        "相对增长倍数分": 0.0,
        "月均增长率分": 0.0,
        "趋势连续性分": 0.0,
        "波动惩罚分": 0.0,
        "趋势总分": 0.0,
        "最近3个月均值": 0.0,
        "之前3个月均值": 0.0,
        "趋势比值": 0.0,
        "历史最低值": r2(min(values)),
        "最新月份值": r2(values[-1]),
        "增长倍数": 0.0,
        "月均增长率": 0.0,
        "波动系数CV": 0.0,
    }

    # 一、趋势方向强度
    if n >= 6:
        last_avg = sum(values[-3:]) / 3
        prev_avg = sum(values[-6:-3]) / 3
        R = last_avg / prev_avg if prev_avg > 0 else 0
        score = max(0, min(25, (R - 1) * 18))
        result["最近3个月均值"] = r2(last_avg)
        result["之前3个月均值"] = r2(prev_avg)
        result["趋势比值"] = r2(R)
        result["趋势方向强度分"] = r2(score)

    # 二、趋势一致性
    if n >= 6:
        up = sum(1 for i in range(1, 6) if values[-6 + i] > values[-7 + i])
        result["趋势一致性分"] = r2((up / 5) * 10)

    # 三、相对增长倍数
    if n >= 2 and min(values) > 0:
        G = values[-1] / min(values)
        score = max(0, min(20, math.log2(G) * 6))
        result["增长倍数"] = r2(G)
        result["相对增长倍数分"] = r2(score)

    # 四、月均增长率
    if n >= 4 and values[-4] > 0:
        M = (values[-1] / values[-4]) ** (1 / 4) - 1
        score = max(0, min(10, M * 120))
        result["月均增长率"] = r2(M)
        result["月均增长率分"] = r2(score)

    # 五、趋势连续性
    if n >= 2:
        cur = max_streak = 0
        for i in range(1, n):
            if values[i] > values[i - 1]:
                cur += 1
                max_streak = max(max_streak, cur)
            else:
                cur = 0
        mapping = {2: 3, 3: 6, 4: 9, 5: 12}
        result["趋势连续性分"] = 15 if max_streak >= 6 else mapping.get(max_streak, 0)

    # 六、波动惩罚
    if n >= 6:
        last_6 = values[-6:]
        mean = statistics.mean(last_6)
        std = statistics.pstdev(last_6)
        CV = std / mean if mean > 0 else 0
        result["波动系数CV"] = r2(CV)
        if CV <= 0.25:
            result["波动惩罚分"] = 10
        elif CV <= 0.35:
            result["波动惩罚分"] = 7
        elif CV <= 0.50:
            result["波动惩罚分"] = 4

    total = (
        result["趋势方向强度分"]
        + result["趋势一致性分"]
        + result["相对增长倍数分"]
        + result["月均增长率分"]
        + result["趋势连续性分"]
        + result["波动惩罚分"]
    )

    result["趋势总分"] = r2(max(0, total))

    # 映射到满分100：原始总分约90分上限，线性放大到100
    raw_score = max(0, total)
    final_score = round(min(100, raw_score * (100 / 90)), 2)

    return final_score, json.dumps(result, ensure_ascii=False)


@router.post("/{selection_id}/analyze")
async def analyze_product_selection(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        query = text("""
            SELECT id, product_title, url, asin, image_url, rating, review_count, keywords,
                   price, commission, first_leg_cost, last_mile_cost, weight_kg,
                   cost_at_15_profit, product_type, monthly_sales, traffic_trend
            FROM product_selections
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """)
        row = db.execute(query, {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        product_data = {
            "product_title": row[1],
            "url": row[2] or "",
            "asin": row[3] or "",
            "image_url": row[4] or "",
            "rating": row[5],
            "review_count": row[6],
            "keywords": row[7] or "",
            "price": float(row[8]) if row[8] is not None else None,
            "commission": float(row[9]) if row[9] is not None else None,
            "first_leg_cost": float(row[10]) if row[10] is not None else None,
            "last_mile_cost": float(row[11]) if row[11] is not None else None,
            "weight_kg": float(row[12]) if row[12] is not None else None,
            "cost_at_15_profit": float(row[13]) if row[13] is not None else None,
            "product_type": row[14] or "",
            "monthly_sales": row[15],
            "traffic_trend": row[16] or "",
        }

        from services.ai_analysis_service import analyze_product_selection as do_analyze
        ai_result = await do_analyze(product_data)

        if not ai_result:
            raise HTTPException(status_code=500, detail="AI分析失败，请稍后重试")

        # 根据产品实际数据自动计算评分
        product_rating = float(row[5]) if row[5] is not None else None
        product_review_count = row[6]
        product_monthly_sales = row[15]

        rating_score = _calc_rating_score(product_rating, product_review_count)
        sales_score = _calc_sales_score(product_monthly_sales)
        penalty_factor = _calc_penalty_factor(rating_score)
        traffic_score, traffic_score_result = _calc_traffic_score(product_data.get("traffic_trend"))

        # 综合评分公式：(惩罚因子 * 流量评分 * 0.6 + 销量评分 * 5 * 0.4).ROUND(2)
        composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

        update_sql = text("""
            UPDATE product_selections SET
                seasonality = :seasonality,
                infringement_analysis = :infringement_analysis,
                infringement_conclusion = :infringement_conclusion,
                traffic_score_result = :traffic_score_result,
                traffic_score = :traffic_score,
                sales_score = :sales_score,
                rating_score = :rating_score,
                penalty_factor = :penalty_factor,
                composite_score = :composite_score,
                ai_raw_response = :ai_raw_response,
                updated_at = NOW()
            WHERE id = :id
        """)
        db.execute(update_sql, {
            "seasonality": ai_result.get("seasonality", ""),
            "infringement_analysis": ai_result.get("infringement_analysis", ""),
            "infringement_conclusion": ai_result.get("infringement_conclusion", ""),
            "traffic_score_result": traffic_score_result,
            "traffic_score": traffic_score,
            "sales_score": sales_score,
            "rating_score": rating_score,
            "penalty_factor": penalty_factor,
            "composite_score": composite_score,
            "ai_raw_response": json.dumps(ai_result, ensure_ascii=False),
            "id": selection_id,
        })
        db.commit()

        return {"success": True, "message": "AI分析完成", "data": {
            **ai_result, "rating_score": rating_score, "sales_score": sales_score,
            "penalty_factor": penalty_factor, "composite_score": composite_score
        }}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"AI分析失败: {e}")
        raise HTTPException(status_code=500, detail=f"AI分析失败: {str(e)}")


@router.post("/batch-analyze")
async def batch_analyze_product_selections(
    ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    results = []
    for selection_id in ids:
        try:
            query = text("""
                SELECT id, product_title, url, asin, image_url, rating, review_count, keywords,
                       price, commission, first_leg_cost, last_mile_cost, weight_kg,
                       cost_at_15_profit, product_type, monthly_sales, traffic_trend
                FROM product_selections
                WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """)
            row = db.execute(query, {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
            if not row:
                results.append({"id": selection_id, "success": False, "message": "记录不存在"})
                continue

            product_data = {
                "product_title": row[1], "url": row[2] or "", "asin": row[3] or "",
                "image_url": row[4] or "", "rating": row[5], "review_count": row[6],
                "keywords": row[7] or "", "price": float(row[8]) if row[8] is not None else None,
                "commission": float(row[9]) if row[9] is not None else None,
                "first_leg_cost": float(row[10]) if row[10] is not None else None,
                "last_mile_cost": float(row[11]) if row[11] is not None else None,
                "weight_kg": float(row[12]) if row[12] is not None else None,
                "cost_at_15_profit": float(row[13]) if row[13] is not None else None,
                "product_type": row[14] or "", "monthly_sales": row[15],
                "traffic_trend": row[16] or "",
            }

            from services.ai_analysis_service import analyze_product_selection as do_analyze
            ai_result = await do_analyze(product_data)

            if ai_result:
                # 根据产品实际数据自动计算评分
                product_rating = float(row[5]) if row[5] is not None else None
                product_review_count = row[6]
                product_monthly_sales = row[15]

                rating_score = _calc_rating_score(product_rating, product_review_count)
                sales_score = _calc_sales_score(product_monthly_sales)
                penalty_factor = _calc_penalty_factor(rating_score)
                traffic_score, traffic_score_result = _calc_traffic_score(product_data.get("traffic_trend"))

                # 综合评分公式：(惩罚因子 * 流量评分 * 0.6 + 销量评分 * 5 * 0.4).ROUND(2)
                composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

                update_sql = text("""
                    UPDATE product_selections SET
                        seasonality = :seasonality,
                        infringement_analysis = :infringement_analysis,
                        infringement_conclusion = :infringement_conclusion,
                        traffic_score_result = :traffic_score_result,
                        traffic_score = :traffic_score,
                        sales_score = :sales_score,
                        rating_score = :rating_score,
                        penalty_factor = :penalty_factor,
                        composite_score = :composite_score,
                        ai_raw_response = :ai_raw_response,
                        updated_at = NOW()
                    WHERE id = :id
                """)
                db.execute(update_sql, {
                    "seasonality": ai_result.get("seasonality", ""),
                    "infringement_analysis": ai_result.get("infringement_analysis", ""),
                    "infringement_conclusion": ai_result.get("infringement_conclusion", ""),
                    "traffic_score_result": traffic_score_result,
                    "traffic_score": traffic_score,
                    "sales_score": sales_score,
                    "rating_score": rating_score,
                    "penalty_factor": penalty_factor,
                    "composite_score": composite_score,
                    "ai_raw_response": json.dumps(ai_result, ensure_ascii=False),
                    "id": selection_id,
                })
                db.commit()
                results.append({"id": selection_id, "success": True, "data": {
                    **ai_result, "rating_score": rating_score, "sales_score": sales_score,
                    "penalty_factor": penalty_factor, "composite_score": composite_score
                }})
            else:
                results.append({"id": selection_id, "success": False, "message": "AI分析失败"})
        except Exception as e:
            db.rollback()
            results.append({"id": selection_id, "success": False, "message": str(e)})

    return {"success": True, "data": results}


@router.post("/recalc-scores")
async def recalc_all_scores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """重新计算所有选品记录的评分"""
    try:
        rows = db.execute(text("""
            SELECT id, rating, review_count, monthly_sales, traffic_trend
            FROM product_selections
            WHERE tenant_id = :tid AND deleted_at IS NULL
        """), {"tid": current_user.tenant_id}).fetchall()

        updated = 0
        for row in rows:
            rid = row[0]
            rating_score = _calc_rating_score(row[1], row[2])
            sales_score = _calc_sales_score(row[3])
            penalty_factor = _calc_penalty_factor(rating_score)
            traffic_score, traffic_result_json = _calc_traffic_score(row[4])
            composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

            db.execute(text("""
                UPDATE product_selections SET
                    traffic_score = :ts,
                    traffic_score_result = :tsr,
                    sales_score = :ss,
                    rating_score = :rs,
                    penalty_factor = :pf,
                    composite_score = :cs,
                    updated_at = NOW()
                WHERE id = :id
            """), {
                "id": rid,
                "ts": traffic_score,
                "tsr": traffic_result_json,
                "ss": sales_score,
                "rs": rating_score,
                "pf": penalty_factor,
                "cs": composite_score,
            })
            updated += 1

        db.commit()
        return {"success": True, "data": updated}
    except Exception as e:
        db.rollback()
        logger.error(f"重新计算评分失败: {e}")
        raise HTTPException(status_code=500, detail=f"重新计算评分失败: {str(e)}")