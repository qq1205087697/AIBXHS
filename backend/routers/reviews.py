from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
import json
import threading
import logging
from database.database import SessionLocal, get_db
from config import get_settings
from services.translate_service import translate_review
from services.chat_service import batch_analyze_reviews
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/reviews", tags=["reviews"])
settings = get_settings()
logger = logging.getLogger(__name__)

# 异步处理批量分析
def async_batch_analyze(review_ids: List[int]):
    logger.info(f"开始异步分析 {len(review_ids)} 条评论")
    db = None
    try:
        db = SessionLocal()
        batch_analyze_reviews(db, review_ids)
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
    importance_level: Optional[str] = Query(None, description="重要等级筛选: high, medium, low"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取差评列表（支持分页、搜索、排序、部门过滤、日期筛选、状态筛选）"""
    try:
        where_conditions = ["r.rating <= 3"]
        params = {"limit": page_size, "offset": (page - 1) * page_size}
        
        # 检查 importance_level 列是否存在
        has_importance_level = False
        try:
            check_col = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance_level = check_col.fetchone() is not None
        except:
            has_importance_level = False
        
        # 非管理员用户按部门过滤数据
        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                dept_placeholders = ",".join([f":dept_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    params[f"dept_{i}"] = did
                where_conditions.append(f"s.department_id IN ({dept_placeholders}) AND s.department_id IS NOT NULL")
            else:
                # 用户没有分配任何部门，不显示任何数据
                where_conditions.append("1=0")
        
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
        # 处理状态筛选
        if status is not None and status != '' and str(status).strip() != '':
            status_str = str(status).strip()
            where_conditions.append("r.status = :status")
            params["status"] = status_str
        # 处理重要等级筛选
        if importance_level is not None and importance_level != '' and str(importance_level).strip() != '':
            importance_level_str = str(importance_level).strip()
            where_conditions.append("r.importance_level = :importance_level")
            params["importance_level"] = importance_level_str
        
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
        
        # Need store join for department filtering
        store_join = "LEFT JOIN stores s ON r.store_id = s.id" if current_user.role != "admin" else ""
        
        count_query = text(f"""
            SELECT COUNT(DISTINCT r.id)
            FROM reviews r
            LEFT JOIN products p ON r.asin = p.asin
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
                    LEFT JOIN products p ON r.asin = p.asin
                    LEFT JOIN (
                        SELECT asin, COUNT(*) as review_count
                        FROM reviews WHERE rating <= 3 GROUP BY asin
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
                    LEFT JOIN products p ON r.asin = p.asin
                    LEFT JOIN (
                        SELECT asin, COUNT(*) as review_count
                        FROM reviews WHERE rating <= 3 GROUP BY asin
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
                    LEFT JOIN products p ON r.asin = p.asin
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
                    LEFT JOIN products p ON r.asin = p.asin
                    {store_join}
                    WHERE {where_clause}
                    ORDER BY {order_by_clause}
                    LIMIT :limit OFFSET :offset
                """)

        result = db.execute(query, params)
        reviews = result.fetchall()

        analysis_query = text("""
            SELECT review_id, key_points, summary, topics, suggestions
            FROM review_analyses
        """)
        analysis_result = db.execute(analysis_query)
        analysis_map = {row[0]: {"key_points": row[1], "summary": row[2], "topics": row[3], "suggestions": row[4]} for row in analysis_result}

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


@router.get("/{review_id}")
async def get_review_detail(review_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取差评详情"""
    try:
        # 非管理员用户按部门过滤
        dept_filter = ""
        params = {"review_id": review_id}
        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                placeholders = ",".join([f":d_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    params[f"d_{i}"] = did
                dept_filter = f" AND s.department_id IN ({placeholders}) AND s.department_id IS NOT NULL"
            else:
                # 用户没有分配任何部门，不显示任何数据
                raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")
        
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
            LEFT JOIN products p ON r.asin = p.asin
            LEFT JOIN stores s ON r.store_id = s.id
            WHERE r.id = :review_id
            {dept_filter}
        """)

        result = db.execute(query, params)
        row = result.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")

        analysis_query = text("""
            SELECT key_points, summary, topics, suggestions
            FROM review_analyses
            WHERE review_id = :review_id
        """)
        analysis_result = db.execute(analysis_query, {"review_id": review_id})
        analysis_row = analysis_result.fetchone()

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
            "suggestions": analysis_row[3] if analysis_row else []
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
        check_params = {"review_id": review_id}
        check_where = "r.id = :review_id"
        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                placeholders = ",".join([f":d_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    check_params[f"d_{i}"] = did
                check_where += f" AND s.department_id IN ({placeholders}) AND s.department_id IS NOT NULL"
            else:
                # 用户没有分配任何部门，不允许操作
                raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")
        
        check_query = text(f"""
            SELECT r.id FROM reviews r
            LEFT JOIN stores s ON r.store_id = s.id
            WHERE {check_where}
        """)
        result = db.execute(check_query, check_params)
        if not result.fetchone():
            raise HTTPException(status_code=404, detail=f"差评 {review_id} 不存在")

        update_query = text("""
            UPDATE reviews
            SET status = :new_status, updated_at = NOW()
            WHERE id = :review_id
        """)
        db.execute(update_query, {"new_status": new_status, "review_id": review_id})
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
        params = {"three_days_ago": three_days_ago}
        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                placeholders = ",".join([f":d_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    params[f"d_{i}"] = did
                dept_filter = f"AND s.department_id IN ({placeholders}) AND s.department_id IS NOT NULL"
                store_join = "LEFT JOIN stores s ON reviews.store_id = s.id"
            else:
                # 用户没有分配任何部门，不显示任何数据
                dept_filter = "AND 1=0"
        
        query = text(f"""
            SELECT COUNT(*)
            FROM reviews
            {store_join}
            WHERE rating <= 3
              AND status = 'new'
              AND review_date >= :three_days_ago
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
        check_params = {"review_id": review_id}
        check_where = "r.id = :review_id"
        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                placeholders = ",".join([f":d_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    check_params[f"d_{i}"] = did
                check_where += f" AND s.department_id IN ({placeholders}) AND s.department_id IS NOT NULL"
            else:
                # 用户没有分配任何部门，不允许操作
                return {"success": True, "message": "重要性等级更新成功"}
        
        # 验证用户是否有权限操作该差评
        check_query = text(f"""
            SELECT r.id FROM reviews r
            LEFT JOIN stores s ON r.store_id = s.id
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
                UPDATE reviews SET importance_level = :level WHERE id = :rid
            """), {"level": level or None, "rid": review_id})
            db.commit()
        
        return {"success": True, "message": "重要性等级更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        # 即使失败也返回成功（比如列不存在）
        return {"success": True, "message": "重要性等级更新成功"}


@router.post("/analyze/batch")
async def batch_analyze_reviews_endpoint(review_ids: List[Any], background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
        
        # 后台异步处理
        thread = threading.Thread(target=async_batch_analyze, args=(int_review_ids,))
        thread.daemon = True
        thread.start()

        return {
            "success": True,
            "message": f"已开始分析 {len(int_review_ids)} 条评论，请稍后刷新查看结果"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量分析失败: {str(e)}")