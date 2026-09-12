from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
import json
import logging
from database.database import SessionLocal, get_db
from config import get_settings
from services.translate_service import translate_review
from services.chat_service import batch_analyze_reviews
from dependencies import get_current_user, PermissionChecker
from models.user import User
import concurrent.futures

router = APIRouter(prefix="/reviews", tags=["reviews"])
settings = get_settings()
logger = logging.getLogger(__name__)

# 跨店铺可见的推送板块（运营仍按店铺隔离，订阅不扩展可见范围）
CROSS_STORE_SECTIONS = ("purchasing", "warehouse", "design")


def build_review_visibility_condition(db: Session, current_user, params: dict, alias: str = "r"):
    """非管理员的差评可见范围SQL条件：已分配店铺的差评 ∪ 订阅板块命中的差评。

    - 运营板块按店铺隔离（订阅不扩展可见范围）
    - 采购/仓库/美工板块订阅后可见命中板块的全部差评（跨店铺）
    - 一条差评可属多个板块（review_analyses.departments逗号分隔），兼容旧版单值department字段
    管理员返回None（不加条件）；两者皆无返回"1=0"。
    """
    is_admin = False
    if current_user.role_id:
        role = db.execute(text("""
            SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
        """), {"role_id": current_user.role_id}).fetchone()
        if role and role[0] == "admin":
            is_admin = True
    if is_admin:
        return None

    store_ids = db.execute(
        text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
        {"uid": current_user.id, "tid": current_user.tenant_id}
    ).fetchall()
    store_id_list = [s[0] for s in store_ids]
    sub_rows = db.execute(
        text("SELECT section FROM review_section_subscribers WHERE tenant_id = :tid AND user_id = :uid"),
        {"uid": current_user.id, "tid": current_user.tenant_id}
    ).fetchall()
    section_list = [s[0] for s in sub_rows if s[0] in CROSS_STORE_SECTIONS]

    parts = []
    if store_id_list:
        ph = ",".join([f":vs_{i}" for i in range(len(store_id_list))])
        for i, sid in enumerate(store_id_list):
            params[f"vs_{i}"] = sid
        parts.append(f"{alias}.store_id IN ({ph})")
    if section_list:
        sec_conds = []
        for i, sec in enumerate(section_list):
            params[f"vsec_{i}"] = sec
            sec_conds.append(f"FIND_IN_SET(:vsec_{i}, COALESCE(NULLIF(ras.departments, ''), ras.department)) > 0")
        parts.append(
            "EXISTS (SELECT 1 FROM review_analyses ras WHERE ras.review_id = " + alias + ".id "
            "AND ras.tenant_id = " + alias + ".tenant_id AND ras.deleted_at IS NULL AND (" + " OR ".join(sec_conds) + "))"
        )
    if parts:
        return "(" + " OR ".join(parts) + ")"
    return "1=0"

# 异步处理批量分析 - 使用独立的线程池
def async_batch_analyze(review_ids: List[int], tenant_id: Optional[int] = None):
    """后台分析任务，完全独立于主线程"""
    logger.info(f"开始异步分析 {len(review_ids)} 条评论")
    db = None
    try:
        # 每次都创建全新的数据库会话
        db = SessionLocal()
        batch_analyze_reviews(db, review_ids, tenant_id=tenant_id)
        logger.info(f"完成分析 {len(review_ids)} 条评论")
    except Exception as e:
        logger.error(f"分析失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        if db:
            db.close()


@router.get("/")
async def get_reviews(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
    asin_search: str = Query(None, description="ASIN搜索"),
    product_name_search: str = Query(None, description="产品名搜索"),
    sku_search: str = Query(None, description="SKU搜索"),
    sort_by: str = Query("time", description="排序字段: time, return_rate, review_count"),
    sort_order: str = Query("desc", description="排序方式: asc, desc"),
    start_date: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    status: Optional[str] = Query(None, description="状态筛选: new, read, processing, resolved"),
    importance_level: Optional[str] = Query(None, description="重要等级筛选，支持多选逗号分隔: high,medium,low"),
    department: Optional[str] = Query(None, description="问题板块筛选，支持多选逗号分隔: operations,purchasing,warehouse,design"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取差评列表（支持分页、搜索、排序、部门过滤、日期筛选、状态筛选）"""
    try:
        where_conditions = ["r.rating <= 3", "r.tenant_id = :tenant_id"]
        params = {"tenant_id": current_user.tenant_id, "limit": page_size, "offset": (page - 1) * page_size}
        
        # 检查 importance_level 列是否存在
        has_importance_level = False
        try:
            check_col = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance_level = check_col.fetchone() is not None
        except:
            has_importance_level = False
        ensure_suggestion_processed_column(db)

        # 非管理员用户按部门过滤数据
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True
        
        if not is_admin:
            # 可见范围 = 已分配店铺的差评 ∪ 订阅板块命中的差评（采购/仓库/美工跨店铺；运营按店铺隔离）
            visibility_cond = build_review_visibility_condition(db, current_user, params, alias="r")
            where_conditions.append(visibility_cond)
        
        if asin_search:
            where_conditions.append("r.asin LIKE :asin_search")
            params["asin_search"] = f"%{asin_search}%"
        if product_name_search:
            where_conditions.append("p.name LIKE :product_name_search")
            params["product_name_search"] = f"%{product_name_search}%"
        if sku_search:
            where_conditions.append("p.sku LIKE :sku_search")
            params["sku_search"] = f"%{sku_search}%"
        if start_date:
            where_conditions.append("r.review_date >= :start_date")
            params["start_date"] = f"{start_date} 00:00:00"
        if end_date:
            where_conditions.append("r.review_date <= :end_date")
            params["end_date"] = f"{end_date} 23:59:59"
        if department:
            # 支持多选板块（逗号分隔），任一命中即返回；一条差评可属多个板块（兼容旧版单值department字段）
            deps = [d.strip().lower() for d in str(department).split(",") if d.strip()]
            if deps:
                dep_conds = []
                for i, d in enumerate(deps):
                    params[f"dep_{i}"] = d
                    dep_conds.append(f"FIND_IN_SET(:dep_{i}, COALESCE(NULLIF(rad.departments, ''), rad.department)) > 0")
                where_conditions.append(
                    "EXISTS (SELECT 1 FROM review_analyses rad WHERE rad.review_id = r.id AND rad.tenant_id = r.tenant_id AND rad.deleted_at IS NULL "
                    "AND (" + " OR ".join(dep_conds) + "))"
                )
        # 处理状态筛选
        if status is not None and status != '' and str(status).strip() != '':
            status_str = str(status).strip()
            where_conditions.append("r.status = :status")
            params["status"] = status_str
        # 处理重要等级筛选（支持多选，逗号分隔）
        if importance_level is not None and importance_level != '' and str(importance_level).strip() != '' and has_importance_level:
            ils = [s.strip() for s in str(importance_level).split(",") if s.strip()]
            if ils:
                il_ph = ",".join([f":il_{i}" for i in range(len(ils))])
                for i, v in enumerate(ils):
                    params[f"il_{i}"] = v
                where_conditions.append(f"r.importance_level IN ({il_ph})")
        
        where_clause = " AND ".join(where_conditions) if where_conditions else "1=1"
        
        order_by_clause = ""
        if sort_by == "time":
            order_by_clause = f"r.review_date {sort_order}"
        elif sort_by == "return_rate":
            order_by_clause = f"r.return_rate {sort_order}, r.review_date DESC"
        elif sort_by == "review_count":
            order_by_clause = "review_count DESC, r.review_date DESC"
        else:
            order_by_clause = "r.review_date DESC"
        
        # No longer need store join for department filtering - direct store_id filter
        store_join = ""

        count_query = text(f"""
            SELECT COUNT(DISTINCT r.id)
            FROM reviews r
            LEFT JOIN (
            SELECT DISTINCT pp.asin, p.name
            FROM platform_products pp
            JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
            WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
        ) p ON r.asin = p.asin
            {store_join}
            WHERE {where_clause}
        """)
        count_result = db.execute(count_query, params)
        total = count_result.scalar()
        
        # 根据列是否存在选择不同的查询
        if sort_by == "review_count":
            if has_importance_level:
                query = text(f"""
                    SELECT
                        r.id, r.asin, r.reviewer_name, r.rating, r.title,
                        r.translated_title, r.content, r.translated_content,
                        r.review_date, r.status, r.return_rate,
                        COALESCE(p.name, r.asin, '未知商品') as product_name,
                        rc.review_count, r.importance_level
                    FROM reviews r
                    LEFT JOIN (
            SELECT DISTINCT pp.asin, p.name
            FROM platform_products pp
            JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
            WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
        ) p ON r.asin = p.asin
                    LEFT JOIN (
                        SELECT asin, COUNT(*) as review_count
                        FROM reviews WHERE rating <= 3 AND tenant_id = :tenant_id GROUP BY asin
                    ) rc ON r.asin = rc.asin
                    {store_join}
                    WHERE {where_clause}
                    ORDER BY {order_by_clause}
                    LIMIT :limit OFFSET :offset
                """)
            else:
                query = text(f"""
                    SELECT
                        r.id, r.asin, r.reviewer_name, r.rating, r.title,
                        r.translated_title, r.content, r.translated_content,
                        r.review_date, r.status, r.return_rate,
                        COALESCE(p.name, r.asin, '未知商品') as product_name,
                        rc.review_count
                    FROM reviews r
                    LEFT JOIN (
            SELECT DISTINCT pp.asin, p.name
            FROM platform_products pp
            JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
            WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
        ) p ON r.asin = p.asin
                    LEFT JOIN (
                        SELECT asin, COUNT(*) as review_count
                        FROM reviews WHERE rating <= 3 AND tenant_id = :tenant_id GROUP BY asin
                    ) rc ON r.asin = rc.asin
                    {store_join}
                    WHERE {where_clause}
                    ORDER BY {order_by_clause}
                    LIMIT :limit OFFSET :offset
                """)
        else:
            if has_importance_level:
                query = text(f"""
                    SELECT
                        r.id, r.asin, r.reviewer_name, r.rating, r.title,
                        r.translated_title, r.content, r.translated_content,
                        r.review_date, r.status, r.return_rate,
                        COALESCE(p.name, r.asin, '未知商品') as product_name,
                        r.importance_level
                    FROM reviews r
                    LEFT JOIN (
            SELECT DISTINCT pp.asin, p.name
            FROM platform_products pp
            JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
            WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
        ) p ON r.asin = p.asin
                    {store_join}
                    WHERE {where_clause}
                    ORDER BY {order_by_clause}
                    LIMIT :limit OFFSET :offset
                """)
            else:
                query = text(f"""
                    SELECT
                        r.id, r.asin, r.reviewer_name, r.rating, r.title,
                        r.translated_title, r.content, r.translated_content,
                        r.review_date, r.status, r.return_rate,
                        COALESCE(p.name, r.asin, '未知商品') as product_name
                    FROM reviews r
                    LEFT JOIN (
            SELECT DISTINCT pp.asin, p.name
            FROM platform_products pp
            JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
            WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
        ) p ON r.asin = p.asin
                    {store_join}
                    WHERE {where_clause}
                    ORDER BY {order_by_clause}
                    LIMIT :limit OFFSET :offset
                """)

        result = db.execute(query, params)
        reviews = result.fetchall()

        analysis_query = text("""
            SELECT review_id, key_points, summary, topics, suggestions, department, departments, suggestion_processed
        FROM review_analyses
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL
        """)
        analysis_result = db.execute(analysis_query, {"tenant_id": current_user.tenant_id})
        analysis_map = {row[0]: {"key_points": row[1], "summary": row[2], "topics": row[3], "suggestions": row[4], "department": row[5], "departments": row[6], "suggestion_processed": row[7]} for row in analysis_result}

        review_data = []
        for idx, row in enumerate(reviews):
            review_id = row[0]
            
            analysis = analysis_map.get(review_id, {})
            
            key_points = analysis.get("key_points", [])
            topics = analysis.get("topics", [])
            suggestions = analysis.get("suggestions", [])
            
            if isinstance(key_points, str):
                try:
                    key_points = json.loads(key_points)
                except (json.JSONDecodeError, TypeError):
                    key_points = []
            if isinstance(topics, str):
                try:
                    topics = json.loads(topics)
                except (json.JSONDecodeError, TypeError):
                    topics = []
            if isinstance(suggestions, str):
                try:
                    suggestions = json.loads(suggestions)
                except (json.JSONDecodeError, TypeError):
                    suggestions = []

            suggestion_processed = analysis.get("suggestion_processed") or {}
            if isinstance(suggestion_processed, str):
                try:
                    suggestion_processed = json.loads(suggestion_processed)
                except (json.JSONDecodeError, TypeError):
                    suggestion_processed = {}
            if not isinstance(suggestion_processed, dict):
                suggestion_processed = {}

            is_new = False
            status_idx = 9
            date_idx = 8
            if row[status_idx]:
                status_str = str(row[status_idx])
                if status_str == 'new':
                    review_date = row[date_idx]
                    if review_date and (datetime.now() - review_date).days <= 3:
                        is_new = True

            # 字段索引：
            # sort_by != review_count:
            #   0-8: id, asin, reviewer_name, rating, title, translated_title, content, translated_content, review_date
            #   9: status, 10: return_rate, 11: product_name, (12: importance_level 可选)
            # sort_by == review_count:
            #   0-10: 同上, 11: product_name, 12: review_count, (13: importance_level 可选)
            
            product_name_idx = 12 if sort_by == "review_count" else 11
            
            importance_level = None
            if has_importance_level:
                importance_idx = 13 if sort_by == "review_count" else 12
                if len(row) > importance_idx:
                    importance_level = str(row[importance_idx]) if row[importance_idx] else None

            return_rate = None
            return_rate_idx = 10  # return_rate 在第10位
            if len(row) > return_rate_idx and row[return_rate_idx] is not None:
                val = row[return_rate_idx]
                try:
                    return_rate = float(val)
                except (ValueError, TypeError):
                    return_rate = None
            
            if idx == 0:
                print(f"[DEBUG] 索引10处的退货率值: {row[10] if len(row) > 10 else 'N/A'}")
                print(f"[DEBUG] 最终 return_rate: {return_rate}")

            review_data.append({
                "id": str(review_id),
                "asin": row[1] or "",
                "productName": row[product_name_idx] or row[1] or "未知商品",
                "rating": row[3],
                "title": row[4] or "",
                "translatedTitle": row[5] or "",
                "originalText": row[6] or "",
                "translatedText": row[7] or "",
                "keyPoints": key_points,
                "topics": topics,
                "suggestions": suggestions,
                "suggestionProcessed": suggestion_processed,
                "department": analysis.get("department", ""),
                "date": row[date_idx].strftime("%Y-%m-%d %H:%M:%S") if row[date_idx] else "",
                "status": row[status_idx] or "new",
                "isNew": is_new,
                "author": row[2] or "Anonymous",
                "importanceLevel": importance_level,
                "returnRate": return_rate
            })

        return {
            "success": True,
            "data": review_data,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取差评列表失败: {str(e)}")


@router.get("/stats")
async def get_review_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取差评统计数据（全部数据，按重要性等级分组）"""
    try:
        # 检查 importance_level 列是否存在
        has_importance_level = False
        try:
            check_col = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance_level = check_col.fetchone() is not None
        except:
            has_importance_level = False

        store_join = ""
        params = {"tenant_id": current_user.tenant_id}
        # 检查是否是管理员（只通过 role_id 检查）
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True

        # 重要等级统计与列表使用相同的可见范围（店铺 ∪ 订阅板块）
        visibility_cond = build_review_visibility_condition(db, current_user, params, alias="reviews")
        visibility_clause = f"AND {visibility_cond}" if visibility_cond else ""

        # 运营板块数字按店铺隔离用
        op_store_limit = None
        if not is_admin:
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            op_store_limit = set(s[0] for s in user_stores)

        if has_importance_level:
            query = text(f"""
                SELECT
                    COALESCE(SUM(CASE WHEN reviews.importance_level = 'high' AND reviews.status != 'resolved' THEN 1 ELSE 0 END), 0) as high_unviewed,
                    COALESCE(SUM(CASE WHEN reviews.importance_level = 'high' AND reviews.status = 'resolved' THEN 1 ELSE 0 END), 0) as high_viewed,
                    COALESCE(SUM(CASE WHEN (reviews.importance_level = 'medium' OR reviews.importance_level IS NULL OR reviews.importance_level = '') AND reviews.status != 'resolved' THEN 1 ELSE 0 END), 0) as medium_unviewed,
                    COALESCE(SUM(CASE WHEN (reviews.importance_level = 'medium' OR reviews.importance_level IS NULL OR reviews.importance_level = '') AND reviews.status = 'resolved' THEN 1 ELSE 0 END), 0) as medium_viewed,
                    COALESCE(SUM(CASE WHEN reviews.importance_level = 'low' AND reviews.status != 'resolved' THEN 1 ELSE 0 END), 0) as low_unviewed,
                    COALESCE(SUM(CASE WHEN reviews.importance_level = 'low' AND reviews.status = 'resolved' THEN 1 ELSE 0 END), 0) as low_viewed
                FROM reviews
                {store_join}
                WHERE reviews.rating <= 3
                  AND reviews.tenant_id = :tenant_id
                  {visibility_clause}
            """)
        else:
            # 如果没有 importance_level 列，所有数据归为 medium
            query = text(f"""
                SELECT
                    0 as high_unviewed, 0 as high_viewed,
                    COALESCE(SUM(CASE WHEN reviews.status != 'resolved' THEN 1 ELSE 0 END), 0) as medium_unviewed,
                    COALESCE(SUM(CASE WHEN reviews.status = 'resolved' THEN 1 ELSE 0 END), 0) as medium_viewed,
                    0 as low_unviewed, 0 as low_viewed
                FROM reviews
                {store_join}
                WHERE reviews.rating <= 3
                  AND reviews.tenant_id = :tenant_id
                  {visibility_clause}
            """)

        result = db.execute(query, params)
        row = result.fetchone()

        # 各板块未处理差评数（推送口径：一条差评可命中多个板块，板块订阅人在KPI卡片看到各自板块的待处理数）
        ensure_section_subscribers_table(db)
        # 取板块字段后在Python侧统计（一条差评可属于多个板块）
        sec_rows = db.execute(text("""
            SELECT r.store_id, COALESCE(NULLIF(ra.departments, ''), ra.department) AS dept_str
            FROM reviews r
            JOIN review_analyses ra ON ra.review_id = r.id
            WHERE r.tenant_id = :tenant_id
              AND r.rating <= 3
              AND r.status NOT IN ('resolved', 'dismissed')
              AND r.deleted_at IS NULL
              AND ra.deleted_at IS NULL
        """), {"tenant_id": current_user.tenant_id}).fetchall()
        section_stats = {s: 0 for s in VALID_SECTIONS}
        # 运营板块按店铺隔离（与列表可见性一致）；采购/仓库/美工为全租户数
        for sr in sec_rows:
            if not sr[1]:
                continue
            for sec in str(sr[1]).split(","):
                sec = sec.strip().lower()
                if sec not in section_stats:
                    continue
                if sec == "operations" and op_store_limit is not None and sr[0] not in op_store_limit:
                    continue
                section_stats[sec] += 1

        # 当前用户订阅的板块
        sub_rows = db.execute(text(
            "SELECT section FROM review_section_subscribers WHERE tenant_id = :tid AND user_id = :uid"
        ), {"tid": current_user.tenant_id, "uid": current_user.id}).fetchall()
        my_sections = [r[0] for r in sub_rows if r[0] in VALID_SECTIONS]

        return {
            "success": True,
            "data": {
                "high": {"unviewed": row[0], "viewed": row[1]},
                "medium": {"unviewed": row[2], "viewed": row[3]},
                "low": {"unviewed": row[4], "viewed": row[5]},
                "section_stats": section_stats,
                "my_sections": my_sections,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取统计数据失败: {str(e)}")


@router.get("/negative-ranking")
async def get_negative_ranking(
    months: int = Query(6, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """半年差评排行榜：按ASIN统计差评数量排序，含重要性分布与问题板块分布"""
    try:
        params = {"tenant_id": current_user.tenant_id, "months": months}
        store_filter = ""
        # 非管理员用户按店铺过滤
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True

        if not is_admin:
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if store_id_list:
                placeholders = ",".join([f":s_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    params[f"s_{i}"] = sid
                store_filter = f"AND r.store_id IN ({placeholders})"
            else:
                store_filter = "AND 1=0"

        query = text(f"""
            SELECT r.asin,
                   COALESCE(p.product_name, r.asin) AS product_name,
                   p.sku,
                   COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN r.importance_level = 'high' THEN 1 ELSE 0 END), 0) AS high_cnt,
                   COALESCE(SUM(CASE WHEN r.importance_level = 'medium' OR r.importance_level IS NULL THEN 1 ELSE 0 END), 0) AS medium_cnt,
                   COALESCE(SUM(CASE WHEN r.importance_level = 'low' THEN 1 ELSE 0 END), 0) AS low_cnt,
                   COALESCE(SUM(CASE WHEN ra.department = 'operations' THEN 1 ELSE 0 END), 0) AS operations_cnt,
                   COALESCE(SUM(CASE WHEN ra.department = 'purchasing' THEN 1 ELSE 0 END), 0) AS purchasing_cnt,
                   COALESCE(SUM(CASE WHEN ra.department = 'warehouse' THEN 1 ELSE 0 END), 0) AS warehouse_cnt,
                   COALESCE(SUM(CASE WHEN ra.department = 'design' THEN 1 ELSE 0 END), 0) AS design_cnt
            FROM reviews r
            LEFT JOIN review_analyses ra ON r.id = ra.review_id AND ra.deleted_at IS NULL
            LEFT JOIN (
                SELECT pp.asin, MAX(p2.name) AS product_name, MAX(p2.product_code) AS sku
                FROM platform_products pp
                JOIN products p2 ON p2.id = pp.product_id AND p2.deleted_at IS NULL
                WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
                GROUP BY pp.asin
            ) p ON r.asin = p.asin
            WHERE r.rating <= 3
              AND r.tenant_id = :tenant_id
              AND r.review_date >= DATE_SUB(NOW(), INTERVAL :months MONTH)
              AND r.asin IS NOT NULL AND r.asin != ''
              {store_filter}
            GROUP BY r.asin, product_name, p.sku
            ORDER BY total DESC
            LIMIT 50
        """)
        result = db.execute(query, params)
        rows = result.fetchall()

        ranking = []
        for idx, row in enumerate(rows):
            dept_counts = {
                "operations": row[7], "purchasing": row[8],
                "warehouse": row[9], "design": row[10],
            }
            main_department = max(dept_counts, key=dept_counts.get) if any(dept_counts.values()) else ""
            ranking.append({
                "rank": idx + 1,
                "asin": row[0],
                "product_name": row[1],
                "sku": row[2] or "",
                "total": row[3],
                "high": row[4],
                "medium": row[5],
                "low": row[6],
                "operations": row[7],
                "purchasing": row[8],
                "warehouse": row[9],
                "design": row[10],
                "main_department": main_department,
            })

        return {"success": True, "data": {"months": months, "ranking": ranking}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取差评排行榜失败: {str(e)}")


@router.get("/{review_id}")
async def get_review_detail(review_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取差评详情"""
    try:
        # 非管理员用户按部门过滤
        dept_filter = ""
        params = {"review_id": review_id, "tenant_id": current_user.tenant_id}
        # 检查是否是管理员（只通过 role_id 检查）
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True
        
        if not is_admin:
            # 直接通过 user_stores 表获取用户被分配的店铺
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if store_id_list:
                placeholders = ",".join([f":s_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    params[f"s_{i}"] = sid
                dept_filter = f" AND r.store_id IN ({placeholders})"
            else:
                # 用户没有分配任何店铺，不显示任何数据
                raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")

        ensure_suggestion_processed_column(db)
        query = text(f"""
            SELECT
                r.id,
                r.asin,
                r.reviewer_name,
                r.rating,
                r.title,
                r.content,
                r.translated_title,
                r.translated_content,
                r.review_date,
                r.status,
                COALESCE(p.name, r.asin, '未知商品') as product_name
            FROM reviews r
            LEFT JOIN (
            SELECT DISTINCT pp.asin, p.name
            FROM platform_products pp
            JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
            WHERE pp.deleted_at IS NULL AND pp.asin IS NOT NULL
        ) p ON r.asin = p.asin
            WHERE r.id = :review_id
              AND r.tenant_id = :tenant_id
            {dept_filter}
        """)

        result = db.execute(query, params)
        row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")

        analysis_query = text("""
            SELECT key_points, summary, topics, suggestions, department, suggestion_processed
            FROM review_analyses
            WHERE review_id = :review_id AND tenant_id = :tenant_id AND deleted_at IS NULL
        """)
        analysis_result = db.execute(analysis_query, {"review_id": review_id, "tenant_id": current_user.tenant_id})
        analysis_row = analysis_result.fetchone()

        detail_departments_str = (analysis_row[4] or "") if analysis_row else ""
        detail_processed = (analysis_row[5] or {}) if analysis_row else {}
        if isinstance(detail_processed, str):
            try:
                detail_processed = json.loads(detail_processed)
            except (json.JSONDecodeError, TypeError):
                detail_processed = {}
        if not isinstance(detail_processed, dict):
            detail_processed = {}
        review_detail = {
            "id": str(row[0]),
            "asin": row[1] or "",
            "productName": row[10] or row[1] or "未知商品",
            "rating": row[3],
            "title": row[4] or "",
            "originalText": row[5] or "",
            "translatedTitle": row[6] or "",
            "translatedText": row[7] or "",
            "keyPoints": analysis_row[0] if analysis_row else [],
            "date": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else "",
            "status": row[9] or "new",
            "author": row[2] or "Anonymous",
            "helpfulVotes": 0,
            "sourceUrl": "",
            "analysis": analysis_row[1] if analysis_row else "",
            "topics": analysis_row[2] if analysis_row else [],
            "suggestions": analysis_row[3] if analysis_row else [],
            "suggestionProcessed": detail_processed,
            "department": analysis_row[4] if analysis_row else "",
            "departments": [d for d in detail_departments_str.split(",") if d]
        }
        
        if isinstance(review_detail["keyPoints"], str):
            try:
                review_detail["keyPoints"] = json.loads(review_detail["keyPoints"])
            except (json.JSONDecodeError, TypeError):
                review_detail["keyPoints"] = []
        if isinstance(review_detail["topics"], str):
            try:
                review_detail["topics"] = json.loads(review_detail["topics"])
            except (json.JSONDecodeError, TypeError):
                review_detail["topics"] = []
        if isinstance(review_detail["suggestions"], str):
            try:
                review_detail["suggestions"] = json.loads(review_detail["suggestions"])
            except (json.JSONDecodeError, TypeError):
                review_detail["suggestions"] = []

        return {"success": True, "data": review_detail}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取差评详情失败: {str(e)}")


@router.post("/")
async def create_review(review_data: Dict[str, Any], db: Session = Depends(get_db)):
    """创建新评论（写入时自动翻译）- 使用纯SQL避免Enum问题"""
    try:
        required_fields = ['tenant_id', 'store_id', 'rating', 'content', 'review_date']
        for field in required_fields:
            if field not in review_data:
                raise HTTPException(status_code=400, detail=f"缺少必填字段: {field}")

        title = review_data.get('title')
        content = review_data['content']
        
        # 自动翻译
        translated_title, translated_content = translate_review(title, content)

        # 检查 importance_level 列是否存在
        has_importance_level = False
        try:
            check_col = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance_level = check_col.fetchone() is not None
        except:
            has_importance_level = False

        # 使用纯SQL插入，避免Enum问题
        if has_importance_level:
            insert_sql = text("""
                INSERT INTO reviews (
                    tenant_id, store_id, asin, reviewer_name, rating, title, content,
                    translated_title, translated_content, review_date, crawled_at,
                    account, site, return_rate, status, importance_level
                ) VALUES (
                    :tenant_id, :store_id, :asin, :reviewer_name, :rating, :title, :content,
                    :translated_title, :translated_content, :review_date, :crawled_at,
                    :account, :site, :return_rate, 'new', :importance_level
                )
            """)
            
            result = db.execute(insert_sql, {
                "tenant_id": review_data['tenant_id'],
                "store_id": review_data['store_id'],
                "asin": review_data.get('asin'),
                "reviewer_name": review_data.get('reviewer_name'),
                "rating": review_data['rating'],
                "title": title,
                "content": content,
                "translated_title": translated_title,
                "translated_content": translated_content,
                "review_date": datetime.strptime(review_data['review_date'], "%Y-%m-%d %H:%M:%S"),
                "crawled_at": datetime.strptime(review_data['crawled_at'], "%Y-%m-%d %H:%M:%S") if review_data.get('crawled_at') else None,
                "account": review_data.get('account'),
                "site": review_data.get('site'),
                "return_rate": review_data.get('return_rate'),
                "importance_level": review_data.get('importance_level') or None
            })
        else:
            insert_sql = text("""
                INSERT INTO reviews (
                    tenant_id, store_id, asin, reviewer_name, rating, title, content,
                    translated_title, translated_content, review_date, crawled_at,
                    account, site, return_rate, status
                ) VALUES (
                    :tenant_id, :store_id, :asin, :reviewer_name, :rating, :title, :content,
                    :translated_title, :translated_content, :review_date, :crawled_at,
                    :account, :site, :return_rate, 'new'
                )
            """)
            
            result = db.execute(insert_sql, {
                "tenant_id": review_data['tenant_id'],
                "store_id": review_data['store_id'],
                "asin": review_data.get('asin'),
                "reviewer_name": review_data.get('reviewer_name'),
                "rating": review_data['rating'],
                "title": title,
                "content": content,
                "translated_title": translated_title,
                "translated_content": translated_content,
                "review_date": datetime.strptime(review_data['review_date'], "%Y-%m-%d %H:%M:%S"),
                "crawled_at": datetime.strptime(review_data['crawled_at'], "%Y-%m-%d %H:%M:%S") if review_data.get('crawled_at') else None,
                "account": review_data.get('account'),
                "site": review_data.get('site'),
                "return_rate": review_data.get('return_rate')
            })
        db.commit()
        
        inserted_id = result.lastrowid

        return {
            "success": True,
            "message": "评论创建成功，已自动翻译",
            "data": {
                "id": inserted_id,
                "translated_title": translated_title,
                "translated_content": translated_content
            }
        }

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"日期格式错误: {str(e)}")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建评论失败: {str(e)}")


@router.put("/{review_id}/status")
async def update_review_status(review_id: str, status_data: Dict[str, str], db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """更新差评状态"""
    try:
        new_status = status_data.get("status")
        if not new_status or new_status not in ['new', 'read', 'processing', 'resolved', 'dismissed']:
            raise HTTPException(status_code=400, detail="无效的状态值")

        # 非管理员用户按部门过滤
        check_params = {"review_id": review_id, "tenant_id": current_user.tenant_id}
        check_where = "r.id = :review_id AND r.tenant_id = :tenant_id"
        # 检查是否是管理员（只通过 role_id 检查）
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True
        
        if not is_admin:
            # 直接通过 user_stores 表获取用户被分配的店铺
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if store_id_list:
                placeholders = ",".join([f":s_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    check_params[f"s_{i}"] = sid
                check_where += f" AND r.store_id IN ({placeholders})"
            else:
                # 用户没有分配任何店铺，不允许操作
                raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")

        check_query = text(f"""
            SELECT r.id FROM reviews r
            WHERE {check_where}
        """)
        result = db.execute(check_query, check_params)
        if not result.fetchone():
            raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")

        update_query = text("""
            UPDATE reviews
            SET status = :new_status, updated_at = NOW()
            WHERE id = :review_id AND tenant_id = :tenant_id
        """)
        db.execute(update_query, {"new_status": new_status, "review_id": review_id, "tenant_id": current_user.tenant_id})
        db.commit()

        return {
            "success": True,
            "message": "状态更新成功",
            "data": {
                "reviewId": review_id,
                "newStatus": new_status
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新状态失败: {str(e)}")


@router.get("/new/count")
async def get_new_reviews_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取新差评数量（三天内且未查看）"""
    try:
        three_days_ago = datetime.now() - timedelta(days=3)
        
        store_join = ""
        dept_filter = ""
        params = {"three_days_ago": three_days_ago, "tenant_id": current_user.tenant_id}
        # 检查是否是管理员（只通过 role_id 检查）
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True
        
        if not is_admin:
            # 直接通过 user_stores 表获取用户被分配的店铺
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if store_id_list:
                placeholders = ",".join([f":s_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    params[f"s_{i}"] = sid
                dept_filter = f"AND reviews.store_id IN ({placeholders})"
                store_join = ""
            else:
                # 用户没有分配任何店铺，不显示任何数据
                dept_filter = "AND 1=0"

        query = text(f"""
            SELECT COUNT(*)
            FROM reviews
            {store_join}
            WHERE rating <= 3
              AND tenant_id = :tenant_id
              AND status = 'new'
              AND review_date >= :three_days_ago
              AND tenant_id = :tenant_id
              {dept_filter}
        """)
        
        result = db.execute(query, params)
        count = result.scalar()

        return {"success": True, "data": {"count": count}}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取新差评数量失败: {str(e)}")


@router.put("/{review_id}/importance")
async def update_review_importance(review_id: str, data: Dict[str, str], db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """更新差评重要性等级"""
    try:
        level = data.get("importance_level")
        # 允许 level 为 null 或 undefined 来清除等级
        if level and level not in ['high', 'medium', 'low']:
            raise HTTPException(status_code=400, detail="无效的重要性等级")

        # 非管理员用户按部门过滤
        check_params = {"review_id": review_id, "tenant_id": current_user.tenant_id}
        check_where = "r.id = :review_id AND r.tenant_id = :tenant_id"
        # 检查是否是管理员（只通过 role_id 检查）
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True
        
        if not is_admin:
            # 直接通过 user_stores 表获取用户被分配的店铺
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if store_id_list:
                placeholders = ",".join([f":s_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    check_params[f"s_{i}"] = sid
                check_where += f" AND r.store_id IN ({placeholders})"
            else:
                # 用户没有分配任何店铺，不允许操作
                return {"success": True, "message": "重要性等级更新成功"}

        # 验证用户是否有权限操作该差评
        check_query = text(f"""
            SELECT r.id FROM reviews r
            WHERE {check_where}
        """)
        result = db.execute(check_query, check_params)
        if not result.fetchone():
            return {"success": True, "message": "重要性等级更新成功"}

        # 检查列是否存在
        has_importance_level = False
        try:
            check_col = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance_level = check_col.fetchone() is not None
        except:
            has_importance_level = False
        
        if has_importance_level:
            db.execute(text("""
                UPDATE reviews SET importance_level = :level WHERE id = :rid AND tenant_id = :tenant_id
            """), {"level": level or None, "rid": review_id, "tenant_id": current_user.tenant_id})
            db.commit()
        
        return {"success": True, "message": "重要性等级更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        # 即使失败也返回成功（比如列不存在）
        return {"success": True, "message": "重要性等级更新成功"}


@router.post("/analyze/batch")
async def batch_analyze_reviews_endpoint(review_ids: List[Any], background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """批量分析选中的差评（异步处理）"""
    try:
        if not review_ids or len(review_ids) == 0:
            raise HTTPException(status_code=400, detail="请至少选择一条评论进行分析")
        
        int_review_ids = []
        for review_id in review_ids:
            try:
                int_review_ids.append(int(review_id))
            except (ValueError, TypeError):
                continue
        if not int_review_ids:
            raise HTTPException(status_code=400, detail="请选择有效的评论ID")

        validate_params = {"tenant_id": current_user.tenant_id}
        access_join = ""
        access_where = "r.tenant_id = :tenant_id"
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True

        if not is_admin:
            # 直接通过 user_stores 表获取用户被分配的店铺
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if not store_id_list:
                raise HTTPException(status_code=403, detail="用户未分配店铺，无权访问")
            placeholders = ",".join([f":s_{i}" for i in range(len(store_id_list))])
            for i, sid in enumerate(store_id_list):
                validate_params[f"s_{i}"] = sid
            access_where += f" AND r.store_id IN ({placeholders})"

        id_placeholders = ",".join([f":rid_{i}" for i in range(len(int_review_ids))])
        for i, rid in enumerate(int_review_ids):
            validate_params[f"rid_{i}"] = rid
        validate_query = text(f"""
            SELECT r.id
            FROM reviews r
            {access_join}
            WHERE {access_where} AND r.id IN ({id_placeholders})
        """)
        allowed_review_ids = [row[0] for row in db.execute(validate_query, validate_params).fetchall()]
        if not allowed_review_ids:
            raise HTTPException(status_code=403, detail="无权分析这些评论")

        import concurrent.futures
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        executor.submit(async_batch_analyze, allowed_review_ids, current_user.tenant_id)
        executor.shutdown(wait=False)

        return {
            "success": True,
            "message": f"已提交 {len(allowed_review_ids)} 条评论进行分析"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"批量分析接口异常: {e}")
        raise HTTPException(status_code=500, detail=f"批量分析失败: {str(e)}")


# ============ 差评板块订阅（推送对象配置） ============
# 板块为系统固定枚举（与AI分类一致），推送对象不再挂靠部门/角色，
# 采用"板块-用户"订阅关系：谁订阅某板块，该板块的差评就推送给谁。

VALID_SECTIONS = ("operations", "purchasing", "warehouse", "design")


def ensure_suggestion_processed_column(db: Session):
    """确保 review_analyses.suggestion_processed 列存在（幂等）

    存储AI处理建议的处理状态JSON：{"<建议索引>": {"note": 处理说明, "by": 处理人, "at": 时间}}
    """
    try:
        check = db.execute(text("SHOW COLUMNS FROM review_analyses LIKE 'suggestion_processed'"))
        if check.fetchone() is None:
            db.execute(text(
                "ALTER TABLE review_analyses ADD COLUMN suggestion_processed TEXT NULL "
                "COMMENT 'AI建议处理状态JSON'"
            ))
            db.commit()
    except Exception:
        db.rollback()


@router.post("/{review_id}/suggestions/{suggestion_index}/process")
async def process_suggestion(
    review_id: int,
    suggestion_index: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """处理单条AI建议：记录处理说明，该条建议状态变为已处理"""
    try:
        ensure_suggestion_processed_column(db)
        note = str(payload.get("note") or "").strip()
        if not note:
            raise HTTPException(status_code=400, detail="处理说明不能为空")

        row = db.execute(text("""
            SELECT id, suggestions, suggestion_processed
            FROM review_analyses
            WHERE review_id = :rid AND tenant_id = :tid AND deleted_at IS NULL
        """), {"rid": review_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="该差评尚未进行AI分析")

        suggestions = row[1]
        if isinstance(suggestions, str):
            try:
                suggestions = json.loads(suggestions)
            except (json.JSONDecodeError, TypeError):
                suggestions = []
        if not isinstance(suggestions, list) or suggestion_index < 0 or suggestion_index >= len(suggestions):
            raise HTTPException(status_code=400, detail="建议索引无效")

        processed = row[2]
        if isinstance(processed, str):
            try:
                processed = json.loads(processed)
            except (json.JSONDecodeError, TypeError):
                processed = {}
        if not isinstance(processed, dict):
            processed = {}

        # 处理人显示名（昵称优先）
        u = db.execute(text("SELECT COALESCE(NULLIF(nickname, ''), username) FROM users WHERE id = :uid"),
                       {"uid": current_user.id}).fetchone()
        display_name = u[0] if u and u[0] else "未知用户"

        processed[str(suggestion_index)] = {
            "note": note,
            "by": display_name,
            "at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }
        db.execute(text(
            "UPDATE review_analyses SET suggestion_processed = :sp WHERE id = :id"
        ), {"sp": json.dumps(processed, ensure_ascii=False), "id": row[0]})
        db.commit()

        return {"success": True, "data": {"suggestionProcessed": processed}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"处理建议失败: {str(e)}")


def ensure_section_subscribers_table(db: Session):
    """确保订阅表存在（幂等）"""
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS review_section_subscribers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            section VARCHAR(20) NOT NULL COMMENT '问题板块:operations/purchasing/warehouse/design',
            user_id INT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_tenant_section_user (tenant_id, section, user_id),
            KEY idx_tenant_section (tenant_id, section)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """))
    db.commit()


@router.get("/sections/subscribers")
async def get_section_subscribers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取各板块的订阅用户配置"""
    ensure_section_subscribers_table(db)
    rows = db.execute(text("""
        SELECT section, user_id FROM review_section_subscribers
        WHERE tenant_id = :tid
    """), {"tid": current_user.tenant_id}).fetchall()
    subscribers: Dict[str, List[int]] = {s: [] for s in VALID_SECTIONS}
    for r in rows:
        if r[0] in subscribers:
            subscribers[r[0]].append(int(r[1]))
    # 可选用户列表（复用部门管理的全量用户接口数据结构）
    users = db.execute(text("""
        SELECT u.id, u.username,
               COALESCE(NULLIF(u.nickname, ''), u.username) AS display_name,
               r.name AS role_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL
        WHERE u.tenant_id = :tid AND u.deleted_at IS NULL AND u.status = 'active'
        ORDER BY display_name
    """), {"tid": current_user.tenant_id}).fetchall()
    return {
        "success": True,
        "data": {
            "subscribers": subscribers,
            "users": [{"id": u[0], "username": u[1], "display_name": u[2], "role_name": u[3] or ""} for u in users],
        },
    }


@router.put("/sections/subscribers")
async def update_section_subscribers(
    payload: Dict[str, List[int]],
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("robot:review:push_config"))
):
    """全量更新各板块订阅用户（body: {operations:[uid...], purchasing:[...], ...}）"""
    ensure_section_subscribers_table(db)
    # 权限：差评推送配置
    # 校验板块与用户合法性
    cleaned: Dict[str, List[int]] = {}
    for section, uids in (payload or {}).items():
        if section not in VALID_SECTIONS:
            raise HTTPException(status_code=400, detail=f"未知板块: {section}")
        seen = set()
        valid_ids: List[int] = []
        for uid in uids:
            try:
                uid_int = int(uid)
            except (TypeError, ValueError):
                continue
            if uid_int in seen:
                continue
            seen.add(uid_int)
            valid_ids.append(uid_int)
        cleaned[section] = valid_ids
    # 校验用户都属于当前租户
    all_uids = sorted({u for uids in cleaned.values() for u in uids})
    if all_uids:
        ph = ",".join([f":u{i}" for i in range(len(all_uids))])
        uparams = {"tid": current_user.tenant_id}
        for i, uid in enumerate(all_uids):
            uparams[f"u{i}"] = uid
        valid_users = db.execute(text(
            f"SELECT id FROM users WHERE tenant_id = :tid AND deleted_at IS NULL AND id IN ({ph})"
        ), uparams).fetchall()
        valid_set = {r[0] for r in valid_users}
        invalid = [u for u in all_uids if u not in valid_set]
        if invalid:
            raise HTTPException(status_code=400, detail=f"包含无效用户: {invalid}")
    try:
        db.execute(text("DELETE FROM review_section_subscribers WHERE tenant_id = :tid"),
                   {"tid": current_user.tenant_id})
        for section, uids in cleaned.items():
            for uid in uids:
                db.execute(text("""
                    INSERT INTO review_section_subscribers (tenant_id, section, user_id)
                    VALUES (:tid, :section, :uid)
                """), {"tid": current_user.tenant_id, "section": section, "uid": uid})
        db.commit()
        return {"success": True, "message": "板块订阅配置已保存"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"保存板块订阅配置失败: {e}")
        raise HTTPException(status_code=500, detail=f"保存失败: {str(e)}")
