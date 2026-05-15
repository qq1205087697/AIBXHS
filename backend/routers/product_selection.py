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
        "monthly_sales": row[16],
        "traffic_trend": row[17] or "",
        "seasonality": row[18] or "",
        "infringement_analysis": row[19] or "",
        "infringement_conclusion": row[20] or "",
        "traffic_score_result": row[21] or "",
        "traffic_score": float(row[22]) if row[22] is not None else None,
        "sales_score": float(row[23]) if row[23] is not None else None,
        "rating_score": float(row[24]) if row[24] is not None else None,
        "penalty_factor": float(row[25]) if row[25] is not None else None,
        "composite_score": float(row[26]) if row[26] is not None else None,
        "created_at": row[27].strftime("%Y-%m-%d %H:%M:%S") if row[27] else "",
        "updated_at": row[28].strftime("%Y-%m-%d %H:%M:%S") if row[28] else "",
    }


@router.get("/")
async def get_product_selections(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    asin_search: Optional[str] = None,
    keyword_search: Optional[str] = None,
    title_search: Optional[str] = None,
    product_type: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = "desc",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["ps.tenant_id = :tenant_id", "ps.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if asin_search:
            where_conditions.append("ps.asin LIKE :asin_search")
            params["asin_search"] = f"%{asin_search}%"

        if keyword_search:
            where_conditions.append("ps.keywords LIKE :keyword_search")
            params["keyword_search"] = f"%{keyword_search}%"

        if title_search:
            where_conditions.append("ps.product_title LIKE :title_search")
            params["title_search"] = f"%{title_search}%"

        if product_type:
            where_conditions.append("ps.product_type = :product_type")
            params["product_type"] = product_type

        where_clause = " AND ".join(where_conditions)

        count_query = text(f"SELECT COUNT(*) FROM product_selections ps WHERE {where_clause}")
        total = db.execute(count_query, params).scalar() or 0

        order_column = "ps.created_at"
        if sort_by and sort_by in ["composite_score", "rating", "price", "monthly_sales", "created_at"]:
            order_column = f"ps.{sort_by}"
        order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"

        offset = (page - 1) * page_size
        params["offset"] = offset
        params["limit"] = page_size

        query = text(f"""
            SELECT ps.id, ps.tenant_id, ps.product_title, ps.url, ps.asin, ps.image_url,
                   ps.rating, ps.review_count, ps.keywords, ps.price, ps.commission,
                   ps.first_leg_cost, ps.last_mile_cost, ps.weight_kg, ps.cost_at_15_profit,
                   ps.product_type, ps.monthly_sales, ps.traffic_trend,
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
                   ps.product_type, ps.monthly_sales, ps.traffic_trend,
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
                cost_at_15_profit, product_type, monthly_sales, traffic_trend
            ) VALUES (
                :tenant_id, :product_title, :url, :asin, :image_url, :rating, :review_count,
                :keywords, :price, :commission, :first_leg_cost, :last_mile_cost, :weight_kg,
                :cost_at_15_profit, :product_type, :monthly_sales, :traffic_trend
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
            "product_type": "product_type", "monthly_sales": "monthly_sales",
            "traffic_trend": "traffic_trend"
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

        from services.coze_service import analyze_product_selection as do_analyze
        ai_result = await do_analyze(product_data)

        if not ai_result:
            raise HTTPException(status_code=500, detail="AI分析失败，请稍后重试")

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
            "traffic_score_result": ai_result.get("traffic_score_result", ""),
            "traffic_score": ai_result.get("traffic_score"),
            "sales_score": ai_result.get("sales_score"),
            "rating_score": ai_result.get("rating_score"),
            "penalty_factor": ai_result.get("penalty_factor"),
            "composite_score": ai_result.get("composite_score"),
            "ai_raw_response": json.dumps(ai_result, ensure_ascii=False),
            "id": selection_id,
        })
        db.commit()

        return {"success": True, "message": "AI分析完成", "data": ai_result}
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

            from services.coze_service import analyze_product_selection as do_analyze
            ai_result = await do_analyze(product_data)

            if ai_result:
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
                    "traffic_score_result": ai_result.get("traffic_score_result", ""),
                    "traffic_score": ai_result.get("traffic_score"),
                    "sales_score": ai_result.get("sales_score"),
                    "rating_score": ai_result.get("rating_score"),
                    "penalty_factor": ai_result.get("penalty_factor"),
                    "composite_score": ai_result.get("composite_score"),
                    "ai_raw_response": json.dumps(ai_result, ensure_ascii=False),
                    "id": selection_id,
                })
                db.commit()
                results.append({"id": selection_id, "success": True, "data": ai_result})
            else:
                results.append({"id": selection_id, "success": False, "message": "AI分析失败"})
        except Exception as e:
            db.rollback()
            results.append({"id": selection_id, "success": False, "message": str(e)})

    return {"success": True, "data": results}