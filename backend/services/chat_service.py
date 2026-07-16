import json
import uuid
import sys
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text

from models.user import User
import models.tenant  # noqa
import models.store  # noqa
import models.product  # noqa
import models.review  # noqa

from models.conversation import ConversationHistory
from models.review import Review, ReviewAnalysis, Sentiment
from openai import OpenAI
from config import get_settings
from services.ai_concurrency import ai_call_slot

settings = get_settings()

# 配置日志
logger = logging.getLogger(__name__)

client = OpenAI(
    api_key=settings.OPENAI_API_KEY,
    base_url=settings.OPENAI_API_BASE
) if settings.OPENAI_API_KEY else None

# ???????????? AI ?????????? 123 ???????
SESSION_REPLENISHMENT_CANDIDATES: dict[str, list[dict[str, Any]]] = {}


DATE_PARSING_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "parse_date_range",
            "description": "解析用户提到的日期范围，返回开始日期和结束日期",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "开始日期，格式 YYYY-MM-DD"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "结束日期，格式 YYYY-MM-DD"
                    },
                    "date_description": {
                        "type": "string",
                        "description": "对日期范围的描述，如'最近一个月'、'2024年全年'等"
                    }
                },
                "required": ["start_date", "end_date", "date_description"]
            }
        }
    }
]

# 库存查询工具
INVENTORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_inventory_status",
            "description": "查询库存状态，可按风险等级、补货需求等条件筛选。支持查询：断货风险商品、需要补货的商品、库存正常商品等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": ["stockout_risk", "need_restock", "low_stock", "all"],
                        "description": "查询类型：stockout_risk=断货风险商品，need_restock=需要补货的商品，low_stock=低库存商品，all=全部库存"
                    },
                    "risk_level": {
                        "type": "string",
                        "enum": ["red", "yellow", "green"],
                        "description": "风险等级筛选：red=断货风险，yellow=库存预警，green=库存正常"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回数量限制，默认10条",
                        "default": 10
                    }
                },
                "required": ["query_type"]
            }
        }
    }
]

# 合并所有工具
ALL_TOOLS = DATE_PARSING_TOOLS + INVENTORY_TOOLS

# 统一模式的工具（包含差评查询、库存查询、采购单、入库单等）
UNIFIED_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_inventory_status",
            "description": "查询库存状态，可按风险等级、补货需求等条件筛选。当用户问断货风险、补货、库存相关问题时调用此工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": ["stockout_risk", "need_restock", "low_stock", "all"],
                        "description": "查询类型：stockout_risk=断货风险商品，need_restock=需要补货的商品，low_stock=低库存商品，all=全部库存"
                    },
                    "risk_level": {
                        "type": "string",
                        "enum": ["red", "yellow", "green"],
                        "description": "风险等级筛选：red=断货风险，yellow=库存预警，green=库存正常"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回数量限制，默认10条",
                        "default": 10
                    }
                },
                "required": ["query_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_product",
            "description": "查找产品信息，可通过产品名称、编码、ASIN等搜索。在创建采购单或入库单前，需要先调用此工具找到产品ID。",
            "parameters": {
                "type": "object",
                "properties": {
                    "search_keyword": {
                        "type": "string",
                        "description": "搜索关键词：可输入产品名称、编码、ASIN、SKU等"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回数量限制，默认10条",
                        "default": 10
                    }
                },
                "required": ["search_keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_purchase_order",
            "description": "创建采购单。必须先调用find_product获取产品ID。单号自动生成，不要问用户要单号！",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_number": {
                        "type": "string",
                        "description": "采购单号（可选，后端自动生成）"
                    },
                    "supplier": {
                        "type": "string",
                        "description": "供应商名称（可选）"
                    },
                    "warehouse": {
                        "type": "string",
                        "description": "仓库名称（可选）"
                    },
                    "expected_date": {
                        "type": "string",
                        "description": "预计到货日期（可选）"
                    },
                    "notes": {
                        "type": "string",
                        "description": "备注信息（可选）"
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "product_id": {
                                    "type": "integer",
                                    "description": "产品ID，必须通过find_product工具获取"
                                },
                                "quantity": {
                                    "type": "integer",
                                    "description": "采购数量"
                                },
                                "unit_price": {
                                    "type": "number",
                                    "description": "单价（可选）"
                                },
                                "notes": {
                                    "type": "string",
                                    "description": "备注（可选）"
                                }
                            },
                            "required": ["product_id", "quantity"]
                        },
                        "description": "采购明细列表"
                    }
                },
                "required": ["items"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_inbound_order",
            "description": "创建入库单。必须先调用find_product获取产品ID。单号自动生成，不要问用户要单号！",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_number": {
                        "type": "string",
                        "description": "入库单号（可选，后端自动生成）"
                    },
                    "inbound_type": {
                        "type": "string",
                        "enum": ["purchase", "return", "transfer", "other"],
                        "description": "入库类型：purchase=采购入库，return=退货入库，transfer=调拨入库，other=其他",
                        "default": "purchase"
                    },
                    "purchase_order_id": {
                        "type": "integer",
                        "description": "关联的采购单ID（可选）"
                    },
                    "warehouse": {
                        "type": "string",
                        "description": "仓库名称（可选）"
                    },
                    "handler": {
                        "type": "string",
                        "description": "经办人（可选）"
                    },
                    "inbound_date": {
                        "type": "string",
                        "description": "入库日期（可选）"
                    },
                    "notes": {
                        "type": "string",
                        "description": "备注信息（可选）"
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "product_id": {
                                    "type": "integer",
                                    "description": "产品ID，必须通过find_product工具获取"
                                },
                                "quantity": {
                                    "type": "integer",
                                    "description": "入库数量"
                                },
                                "unit_price": {
                                    "type": "number",
                                    "description": "单价（可选）"
                                },
                                "batch_number": {
                                    "type": "string",
                                    "description": "批次号（可选）"
                                },
                                "production_date": {
                                    "type": "string",
                                    "description": "生产日期（可选）"
                                },
                                "expiry_date": {
                                    "type": "string",
                                    "description": "过期日期（可选）"
                                },
                                "warehouse": {
                                    "type": "string",
                                    "description": "仓库（可选，如与主单不同时填写）"
                                },
                                "shelf_number": {
                                    "type": "string",
                                    "description": "货架号（可选）"
                                },
                                "notes": {
                                    "type": "string",
                                    "description": "备注（可选）"
                                }
                            },
                            "required": ["product_id", "quantity"]
                        },
                        "description": "入库明细列表"
                    }
                },
                "required": ["items"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_reviews",
            "description": "查询差评数据。当用户问差评、评论分析、客户反馈、退货率等相关问题时调用此工具。会自动解析日期范围。",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "开始日期，格式 YYYY-MM-DD"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "结束日期，格式 YYYY-MM-DD"
                    },
                    "asin": {
                        "type": "string",
                        "description": "指定ASIN查询，不传则查全部"
                    },
                    "date_description": {
                        "type": "string",
                        "description": "对日期范围的描述，如'最近一个月'、'本周'等"
                    }
                },
                "required": ["start_date", "end_date"]
            }
        }
    }
]


def query_inventory_status(db: Session, tenant_id: int, query_type: str, risk_level: str = None, limit: int = 10) -> List[Dict[str, Any]]:
    """查询库存状态"""
    try:
        from models.restock import InventorySnapshot, ReplenishmentDecision
        from sqlalchemy import func

        # 获取最新快照日期
        latest = db.query(func.max(InventorySnapshot.snapshot_date)).filter(InventorySnapshot.tenant_id == tenant_id).scalar()
        if not latest:
            return []

        # 构建基础查询
        query = db.query(InventorySnapshot, ReplenishmentDecision).outerjoin(
            ReplenishmentDecision,
            (ReplenishmentDecision.snapshot_id == InventorySnapshot.id) &
            (ReplenishmentDecision.snapshot_date == latest)
        ).filter(
            InventorySnapshot.snapshot_date == latest,
            (InventorySnapshot.summary_flag != "共享库存") | (InventorySnapshot.summary_flag.is_(None))
        )

        # 根据查询类型筛选
        if query_type == "stockout_risk":
            query = query.filter(ReplenishmentDecision.risk_level == "红")
            query = query.order_by(ReplenishmentDecision.days_of_supply.asc())
        elif query_type == "need_restock":
            query = query.filter(ReplenishmentDecision.suggest_qty > 0)
            query = query.order_by(ReplenishmentDecision.suggest_qty.desc())
        elif query_type == "low_stock":
            query = query.filter(ReplenishmentDecision.days_of_supply <= 60)
            query = query.order_by(ReplenishmentDecision.days_of_supply.asc())
        elif risk_level:
            risk_map = {"red": "红", "yellow": "黄", "green": "绿"}
            query = query.filter(ReplenishmentDecision.risk_level == risk_map.get(risk_level, risk_level))

        results = query.limit(limit).all()

        items = []
        for snap, dec in results:
            items.append({
                "asin": snap.asin or "",
                "sku": snap.sku or "",
                "product_name": snap.product_name or snap.asin or "未知商品",
                "account": snap.account or "",
                "country": snap.country or "",
                "fba_stock": int(snap.fba_stock) if snap.fba_stock else 0,
                "fba_available": int(snap.fba_available) if snap.fba_available else 0,
                "fba_inbound": int(snap.fba_inbound) if snap.fba_inbound else 0,
                "daily_sales": round(float(snap.daily_sales), 1) if snap.daily_sales else 0,
                "days_of_supply": round(float(dec.days_of_supply), 1) if dec and dec.days_of_supply else 0,
                "suggest_qty": int(dec.suggest_qty) if dec and dec.suggest_qty else 0,
                "risk_level": dec.risk_level if dec else "绿",
                "stockout_date": dec.stockout_date_calc if dec else "-",
                "reason": dec.reason if dec else "",
            })

        return items

    except Exception as e:
        logger.error(f"查询库存状态失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return []


def query_negative_reviews(db: Session, tenant_id: int, start_date: str, end_date: str, asin: Optional[str] = None) -> List[Dict[str, Any]]:
    """查询差评工具函数 - 使用纯SQL避免Enum问题"""
    try:
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")

        # 明确查询产品表的 name 字段作为产品名
        if asin:
            query = text("""
                SELECT r.id, r.asin, r.reviewer_name, r.rating, r.title, r.content, 
                       r.translated_content, r.review_date, r.crawled_at, r.account, 
                       r.site, r.return_rate, r.tenant_id,
                       CASE 
                           WHEN p.name IS NOT NULL AND p.name != '' THEN p.name
                           WHEN r.asin IS NOT NULL AND r.asin != '' THEN r.asin
                           ELSE '未知商品' 
                       END as product_name
                FROM reviews r
                LEFT JOIN products p ON r.asin = p.asin
                WHERE r.rating <= 3
                AND r.tenant_id = :tenant_id
                AND r.review_date >= :start_date
                AND r.review_date <= :end_date
                AND r.asin = :asin
                ORDER BY r.review_date DESC
                LIMIT 50
            """)
            result = db.execute(query, {
                "tenant_id": tenant_id, "start_date": start_date_obj, "end_date": end_date_obj, "asin": asin
            })
        else:
            query = text("""
                SELECT r.id, r.asin, r.reviewer_name, r.rating, r.title, r.content, 
                       r.translated_content, r.review_date, r.crawled_at, r.account, 
                       r.site, r.return_rate, r.tenant_id,
                       CASE 
                           WHEN p.name IS NOT NULL AND p.name != '' THEN p.name
                           WHEN r.asin IS NOT NULL AND r.asin != '' THEN r.asin
                           ELSE '未知商品' 
                       END as product_name
                FROM reviews r
                LEFT JOIN products p ON r.asin = p.asin
                WHERE r.rating <= 3
                AND r.tenant_id = :tenant_id
                AND r.review_date >= :start_date
                AND r.review_date <= :end_date
                ORDER BY r.review_date DESC
                LIMIT 50
            """)
            result = db.execute(query, {
                "tenant_id": tenant_id, "start_date": start_date_obj, "end_date": end_date_obj
            })

        reviews = result.fetchall()
        logger.debug(f"[DB] 查询到 {len(reviews)} 条差评")

        result_data = []
        for row in reviews:
            result_data.append({
                "id": row[0],
                "asin": row[1],
                "reviewer_name": row[2],
                "rating": row[3],
                "title": row[4],
                "content": row[5],
                "translated_content": row[6],
                "review_date": row[7].strftime("%Y-%m-%d") if row[7] else "",
                "crawled_at": row[8].strftime("%Y-%m-%d") if row[8] else "",
                "account": row[9],
                "site": row[10],
                "return_rate": row[11],
                "tenant_id": row[12],
                "product_name": row[13]
            })
        
        return result_data
    except Exception as e:
        logger.error(f"查询差评出错: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return []


def get_review_analysis(db: Session, review_id: int, tenant_id: Optional[int] = None) -> Optional[dict]:
    """从数据库获取评论分析结果"""
    query_sql = """
        SELECT id, tenant_id, review_id, model, sentiment, sentiment_score,
               key_points, topics, suggestions, summary, raw_response
        FROM review_analyses
        WHERE review_id = :review_id
    """
    params = {"review_id": review_id}
    if tenant_id is not None:
        query_sql += " AND tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id
    query = text(query_sql)
    result = db.execute(query, params)
    row = result.fetchone()

    if not row:
        return None

    return {
        "id": row[0],
        "tenant_id": row[1],
        "review_id": row[2],
        "model": row[3],
        "sentiment": row[4],
        "sentiment_score": row[5],
        "key_points": json.loads(row[6]) if row[6] else [],
        "topics": json.loads(row[7]) if row[7] else [],
        "suggestions": json.loads(row[8]) if row[8] else [],
        "summary": row[9],
        "raw_response": row[10]
    }


def analyze_and_save_single_review(db: Session, review_data: Dict[str, Any]) -> Optional[dict]:
    """分析单条评论并保存到数据库（用于聊天时自动保存）"""
    review_id = review_data["id"]
    product_name = review_data.get("product_name", "未知商品")

    existing_analysis = get_review_analysis(db, review_id, review_data.get("tenant_id"))
    if existing_analysis:
        logger.info(f"评论{review_id}({product_name})已有分析结果，跳过")
        return existing_analysis

    if not client:
        logger.warning(f"OpenAI API未配置，跳过评论{review_id}分析")
        return None

    try:
        content = review_data["content"]
        title = review_data.get("title", "") or ""
        translated_content = review_data.get("translated_content", "")
        translated_title = review_data.get("translated_title", "")
        
        # 如果没有翻译，先进行翻译并保存到数据库
        if not translated_content:
            logger.debug(f"评论{review_id}({product_name})未翻译，正在翻译...")
            try:
                from services.translate_service import translate_review
                translated_title, translated_content = translate_review(title, content)
                
                # 保存翻译到数据库
                update_query = text("""
                    UPDATE reviews 
                    SET translated_title = :translated_title, translated_content = :translated_content
                    WHERE id = :review_id
                """)
                db.execute(update_query, {
                    "translated_title": translated_title,
                    "translated_content": translated_content,
                    "review_id": review_id
                })
                db.commit()
                logger.info(f"[OK] 评论{review_id}({product_name})翻译已保存")
            except Exception as e:
                logger.error(f"翻译失败: {e}")

        prompt = f"""请分析以下差评并提供详细分析：

【商品名称】：{product_name}
【评分】: {review_data['rating']}星
【标题】: {review_data.get('title', '') or '无'}
【原文内容】: {content}
【中文翻译】: {translated_content or '无'}

重要性分级规则：
1. high（最高级）：货不对板、颜色不对、产品不是同一种、规格不符
2. medium（第二级）：质量不好、破损、少件、缺配件、损坏
3. low（第三级）：其他所有场景

请严格按照以下JSON格式输出（不要输出其他内容）：
{{
    "sentiment": "negative|neutral|positive",
    "sentiment_score": 1-10,
    "key_points": ["要点1", "要点2"],
    "topics": ["主题1", "主题2"],
    "suggestions": ["建议1", "建议2"],
    "summary": "一句话总结",
    "importance_level": "high|medium|low"
}}
"""

        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "你是专业的跨境电商差评分析师。所有分析结果必须使用中文输出。只输出JSON，不要输出其他内容。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )

        response_content = response.choices[0].message.content.strip()
        
        # 清理可能的markdown标记
        if response_content.startswith("```"):
            response_content = response_content.split("\n", 1)[-1]
            if response_content.endswith("```"):
                response_content = response_content[:-3]
            response_content = response_content.strip()

        try:
            ai_result = json.loads(response_content)
        except json.JSONDecodeError:
            ai_result = {
                "sentiment": "negative",
                "sentiment_score": 3,
                "key_points": ["分析失败"],
                "topics": ["未知"],
                "suggestions": ["人工查看"],
                "summary": response_content[:200]
            }

        insert_query = text("""
            INSERT INTO review_analyses (
                tenant_id, review_id, model, sentiment, sentiment_score,
                key_points, topics, suggestions, summary, raw_response
            ) VALUES (
                :tenant_id, :review_id, :model, :sentiment, :sentiment_score,
                :key_points, :topics, :suggestions, :summary, :raw_response
            )
        """)

        db.execute(insert_query, {
            "tenant_id": review_data.get("tenant_id", 1),
            "review_id": review_id,
            "model": settings.OPENAI_MODEL,
            "sentiment": ai_result.get("sentiment", "negative"),
            "sentiment_score": ai_result.get("sentiment_score", 3),
            "key_points": json.dumps(ai_result.get("key_points", [])),
            "topics": json.dumps(ai_result.get("topics", [])),
            "suggestions": json.dumps(ai_result.get("suggestions", [])),
            "summary": ai_result.get("summary", ""),
            "raw_response": response_content
        })
        
        # 更新重要性等级
        importance_level = ai_result.get("importance_level", "low")
        if importance_level not in ["high", "medium", "low"]:
            importance_level = "low"
        
        # 先检查importance_level列是否存在
        try:
            col_check = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            if col_check.fetchone():
                result = db.execute(text("""
                    UPDATE reviews SET importance_level = :level WHERE id = :rid
                """), {"level": importance_level, "rid": review_id})
                logger.info(f"[OK] 评论{review_id}重要性等级: {importance_level}, 影响行数: {result.rowcount}")
                db.commit()  # 立即提交
        except Exception as e:
            logger.error(f"更新重要性等级失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
        
        # 再提交一次确保所有内容都保存
        db.commit()

        logger.info(f"[OK] 评论{review_id}({product_name})分析已保存到review_analyses表")
        return get_review_analysis(db, review_id, review_data.get("tenant_id"))

    except Exception as e:
        logger.error(f"分析评论{review_id}失败: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return None


def analyze_review(db: Session, review: Review) -> dict:
    """使用AI分析评论并保存结果"""
    if not client:
        raise Exception("OpenAI API Key 未配置")

    try:
        existing_analysis = get_review_analysis(db, review.id, review.tenant_id)
        if existing_analysis:
            return existing_analysis

        prompt = f"""请分析以下差评：

评分: {review.rating}
标题: {review.title or '无'}
内容: {review.content}
翻译: {review.translated_content or '无'}

重要性分级规则：
1. high（最高级）：货不对板、颜色不对、产品不是同一种、规格不符
2. medium（第二级）：质量不好、破损、少件、缺配件、损坏
3. low（第三级）：其他所有场景

输出JSON格式：
{{"sentiment":"negative","sentiment_score":3,"key_points":[],"topics":[],"suggestions":[],"summary":"","importance_level":"high|medium|low"}}
"""

        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "你是专业差评分析助手。所有分析结果必须使用中文输出。只输出JSON。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )

        response_content = response.choices[0].message.content.strip()
        
        if response_content.startswith("```"):
            response_content = response_content.split("\n", 1)[-1]
            if response_content.endswith("```"):
                response_content = response_content[:-3]
            response_content = response_content.strip()

        try:
            result = json.loads(response_content)
        except json.JSONDecodeError:
            result = {"sentiment": "negative", "sentiment_score": 3, "key_points": [], "topics": [], "suggestions": [], "summary": response_content}

        insert_query = text("""
            INSERT INTO review_analyses (tenant_id, review_id, model, sentiment, sentiment_score, key_points, topics, suggestions, summary, raw_response)
            VALUES (:tenant_id, :review_id, :model, :sentiment, :score, :kp, :top, :sug, :sum, :raw)
        """)
        db.execute(insert_query, {
            "tenant_id": review.tenant_id, "review_id": review.id, "model": settings.OPENAI_MODEL,
            "sentiment": result.get("sentiment", "negative"), "score": result.get("sentiment_score", 3),
            "kp": json.dumps(result.get("key_points", [])), "top": json.dumps(result.get("topics", [])),
            "sug": json.dumps(result.get("suggestions", [])), "sum": result.get("summary", ""), "raw": response_content
        })
        
        # 更新重要性等级
        importance_level = result.get("importance_level", "low")
        if importance_level not in ["high", "medium", "low"]:
            importance_level = "low"
        
        # 先检查importance_level列是否存在
        try:
            col_check = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            if col_check.fetchone():
                update_result = db.execute(text("""
                    UPDATE reviews SET importance_level = :level WHERE id = :rid
                """), {"level": importance_level, "rid": review.id})
                logger.info(f"评论{review.id}重要性等级: {importance_level}, 影响行数: {update_result.rowcount}")
                db.commit()  # 立即提交
        except Exception as e:
            logger.error(f"更新重要性等级失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
        
        # 再提交一次确保所有内容都保存
        db.commit()

        return get_review_analysis(db, review.id, review.tenant_id)

    except Exception as e:
        logger.error(f"分析评论失败: {str(e)}")
        raise


def batch_analyze_reviews(db: Session, review_ids: List[int], tenant_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """批量分析评论"""
    results = []
    import time

    for idx, review_id in enumerate(review_ids):
        try:
            logger.info(f"正在分析第 {idx+1}/{len(review_ids)} 条评论，ID: {review_id}")
            
            query_sql = "SELECT id, tenant_id, title, content, translated_title, translated_content, rating FROM reviews WHERE id = :rid"
            params = {"rid": review_id}
            if tenant_id is not None:
                query_sql += " AND tenant_id = :tenant_id"
                params["tenant_id"] = tenant_id
            check_result = db.execute(text(query_sql), params).first()
            if not check_result:
                results.append({"review_id": review_id, "success": False, "message": "不存在"})
                continue

            review_tenant_id = check_result[1]
            analysis = get_review_analysis(db, review_id, review_tenant_id)

            if analysis:
                results.append({"review_id": review_id, "success": True, "data": analysis})
            else:
                tenant_id = check_result[1]
                title = check_result[2] or ""
                content = check_result[3] or ""
                translated_title = check_result[4] or ""
                translated_content = check_result[5] or ""

                if not translated_content:
                    try:
                        from services.translate_service import translate_review
                        tt, tc = translate_review(title, content)
                        db.execute(text("UPDATE reviews SET translated_title=:tt, translated_content=:tc WHERE id=:rid"), {"tt": tt, "tc": tc, "rid": review_id})
                        db.commit()
                        translated_content = tc
                    except Exception as e:
                        logger.error(f"翻译失败: {e}")

                prompt = f"""分析差评：评分{check_result[6]}星，标题:{title or '无'}，内容:{content}，翻译:{translated_content or '无'}

重要性分级规则：
1. high（最高级）：货不对板、颜色不对、产品不是同一种、规格不符
2. medium（第二级）：质量不好、破损、少件、缺配件、损坏
3. low（第三级）：其他所有场景

输出JSON:{{"sentiment":"","sentiment_score":0,"key_points":[],"topics":[],"suggestions":[],"summary":"","importance_level":"high|medium|low"}}"""

                if client:
                    try:
                        resp = client.chat.completions.create(model=settings.OPENAI_MODEL, messages=[{"role":"system","content":"你是专业的跨境电商差评分析师。所有分析结果必须使用中文输出。只输出JSON，不要输出其他内容。"},{"role":"user","content":prompt}], temperature=0.3, timeout=120)
                        rc = resp.choices[0].message.content.strip()
                        if rc.startswith("```"): rc = rc.split("\n",1)[-1]
                        if rc.endswith("```"): rc = rc[:-3]
                        rc = rc.strip()
                        ar = json.loads(rc) if rc.startswith("{") else {}
                        
                        db.execute(text("""INSERT INTO review_analyses (tenant_id,review_id,model,sentiment,sentiment_score,key_points,topics,suggestions,summary,raw_response) VALUES (:tid,:rid,:m,:s,:sc,:kp,:t,:sg,:sm,:r)"""), {
                            "tid": tenant_id, "rid": review_id, "m": settings.OPENAI_MODEL, "s": ar.get("sentiment","negative"), "sc": ar.get("sentiment_score",3), "kp": json.dumps(ar.get("key_points",[])), "t": json.dumps(ar.get("topics",[])), "sg": json.dumps(ar.get("suggestions",[])), "sm": ar.get("summary",""), "r": rc
                        })
                        db.commit()
                        
                        # 更新重要性等级
                        importance_level = ar.get("importance_level", "low")
                        if importance_level not in ["high", "medium", "low"]:
                            importance_level = "low"
                        
                        try:
                            col_check = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
                            if col_check.fetchone():
                                update_result = db.execute(text("""
                                    UPDATE reviews SET importance_level = :level WHERE id = :rid
                                """), {"level": importance_level, "rid": review_id})
                                logger.info(f"评论{review_id}重要性等级: {importance_level}, 影响行数: {update_result.rowcount}")
                                db.commit()  # 立即提交
                        except Exception as e:
                            logger.error(f"更新重要性等级失败: {e}")
                            import traceback
                            logger.error(traceback.format_exc())
                        
                        results.append({"review_id": review_id, "success": True, "data": get_review_analysis(db, review_id, review_tenant_id)})
                    except Exception as ex:
                        logger.error(f"分析评论 {review_id} 时发生错误: {ex}")
                        results.append({"review_id": review_id, "success": False, "data": {"error": str(ex)}})
                else:
                    results.append({"review_id": review_id, "success": True, "data": {"error": "API未配置"}})
        except Exception as e:
            results.append({"review_id": review_id, "success": False, "message": str(e)})

    return results


def save_message(db: Session, user_id: int, session_id: str, role: str, content: str, function_name: Optional[str] = None, chat_type: str = "review"):
    message = ConversationHistory(user_id=user_id, session_id=session_id, role=role, content=content, function_name=function_name, chat_type=chat_type)
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def get_conversation_history(db: Session, user_id: int, session_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    messages = db.query(ConversationHistory).filter(ConversationHistory.user_id == user_id, ConversationHistory.session_id == session_id).order_by(ConversationHistory.created_at).limit(limit).all()
    return [{"role": m.role, "content": m.content} for m in messages if m.role in ["system", "user", "assistant"]]


def query_reviews_unified(db: Session, tenant_id: int, start_date: str, end_date: str, asin: Optional[str] = None, chat_type: str = "unified") -> List[Dict[str, Any]]:
    """统一模式的差评查询 - 直接返回结果给AI"""
    reviews = query_negative_reviews(db, tenant_id, start_date, end_date, asin)
    return reviews


def find_product(db: Session, search_keyword: str, tenant_id: int, limit: int = 10) -> List[Dict[str, Any]]:
    """查找产品信息"""
    try:
        from sqlalchemy import text
        
        search = f"%{search_keyword}%"
        query = text("""
            SELECT DISTINCT p.id, p.product_code, p.name, p.name_en, p.category, p.brand, 
                   p.purchase_price, p.sale_price, p.status
            FROM products p
            WHERE p.tenant_id = :tenant_id 
              AND p.deleted_at IS NULL
              AND (
                  p.product_code LIKE :search 
                  OR p.name LIKE :search 
                  OR p.name_en LIKE :search
                  OR p.category LIKE :search
                  OR p.brand LIKE :search
                  OR EXISTS (
                      SELECT 1 FROM platform_products pp 
                      WHERE pp.product_id = p.id 
                      AND pp.deleted_at IS NULL 
                      AND (pp.sku LIKE :search 
                           OR pp.asin LIKE :search 
                           OR pp.platform_product_id LIKE :search 
                           OR pp.title LIKE :search 
                           OR pp.title_en LIKE :search)
                  )
              )
            ORDER BY p.created_at DESC
            LIMIT :limit
        """)
        result = db.execute(query, {
            "tenant_id": tenant_id, 
            "search": search, 
            "limit": limit
        })
        
        products = []
        for row in result:
            product_id = row[0]
            
            # 获取这个产品的平台SKU信息
            platform_query = text("""
                SELECT pp.sku, pp.asin, pp.platform_product_id, pp.title 
                FROM platform_products pp 
                WHERE pp.product_id = :product_id 
                  AND pp.deleted_at IS NULL
                ORDER BY pp.created_at DESC
                LIMIT 5
            """)
            platform_result = db.execute(platform_query, {"product_id": product_id})
            platform_skus = []
            for pp_row in platform_result:
                platform_skus.append({
                    "sku": pp_row[0] or "",
                    "asin": pp_row[1] or "",
                    "platform_product_id": pp_row[2] or "",
                    "title": pp_row[3] or ""
                })
            
            products.append({
                "id": product_id,
                "product_code": row[1] or "",
                "name": row[2],
                "name_en": row[3] or "",
                "category": row[4] or "",
                "brand": row[5] or "",
                "purchase_price": float(row[6]) if row[6] else None,
                "sale_price": float(row[7]) if row[7] else None,
                "status": row[8],
                "platform_skus": platform_skus
            })
        return products
    except Exception as e:
        logger.error(f"[CHAT] 查找产品失败: {e}")
        return []


def create_purchase_order(db: Session, tenant_id: int, user_id: int,
                          order_number: Optional[str] = None, supplier: Optional[str] = None,
                          warehouse: Optional[str] = None,
                          expected_date: Optional[str] = None,
                          notes: Optional[str] = None,
                          items: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """创建采购单"""
    try:
        from datetime import datetime
        from sqlalchemy import text

        # 自动生成单号
        if not order_number:
            order_number = f"PO{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        logger.info(f"[CHAT] create_purchase_order 开始: tenant_id={tenant_id}, user_id={user_id}, order_number={order_number}")
        logger.info(f"[CHAT] 创建采购单明细: {json.dumps(items, ensure_ascii=False)}")

        # 计算总金额
        total_amount = 0
        for item in items or []:
            total_amount += (item.get("quantity") or 0) * (item.get("unit_price") or 0)

        logger.info(f"[CHAT] 计算总金额: {total_amount}")

        # 创建主单
        insert_result = db.execute(text("""
            INSERT INTO purchase_orders 
            (tenant_id, order_number, supplier, warehouse, expected_date, total_amount, status, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :supplier, :warehouse, :expected_date, :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": tenant_id,
            "order_number": order_number,
            "supplier": supplier,
            "warehouse": warehouse,
            "expected_date": expected_date,
            "total_amount": total_amount,
            "notes": notes,
            "created_by": user_id,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        })

        # 获取刚插入的ID
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
        logger.info(f"[CHAT] 采购单主单已创建, ID={order_id}")
        
        # 创建明细
        for idx, item in enumerate(items or []):
            total_price = (item.get("quantity") or 0) * (item.get("unit_price") or 0)
            logger.info(f"[CHAT] 创建明细 {idx+1}: product_id={item.get('product_id')}, quantity={item.get('quantity')}")
            
            db.execute(text("""
                INSERT INTO purchase_order_items 
                (purchase_order_id, product_id, quantity, unit_price, total_price, notes, created_at, updated_at)
                VALUES (:po_id, :product_id, :quantity, :unit_price, :total_price, :notes, :created_at, :updated_at)
            """), {
                "po_id": order_id,
                "product_id": item.get("product_id"),
                "quantity": item.get("quantity"),
                "unit_price": item.get("unit_price") or 0,
                "total_price": total_price,
                "notes": item.get("notes"),
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            })
        
        db.commit()
        logger.info(f"[CHAT] 采购单提交成功: ID={order_id}, order_number={order_number}")
        
        # 验证一下是否真的插入了
        verify_result = db.execute(text("""
            SELECT id, order_number FROM purchase_orders WHERE id = :oid AND tenant_id = :tid AND deleted_at IS NULL
        """), {"oid": order_id, "tid": tenant_id}).fetchone()
        
        logger.info(f"[CHAT] 验证插入结果: {verify_result}")
        
        return {
            "success": True,
            "id": order_id,
            "order_number": order_number,
            "total_amount": total_amount,
            "items_count": len(items or [])
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[CHAT] 创建采购单失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


def create_replenishment_order(db: Session, tenant_id: int, user_id: int,
                               store_group_id: Optional[int] = None,
                               notes: Optional[str] = None,
                               items: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """创建补货单"""
    try:
        if not items:
            return {"success": False, "message": "补货单商品不能为空"}

        order_number = f"RO{datetime.now().strftime('%Y%m%d%H%M%S')}"
        db.execute(text("""
            INSERT INTO replenishment_orders (tenant_id, order_number, store_group_id, status, notes,
                created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :store_group_id, 'pending', :notes,
                :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": tenant_id,
            "order_number": order_number,
            "store_group_id": store_group_id,
            "notes": notes,
            "created_by": user_id,
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        for item in items:
            db.execute(text("""
                INSERT INTO replenishment_items (tenant_id, replenishment_order_id, product_id, quantity,
                    notes, created_at, updated_at)
                VALUES (:tenant_id, :replenishment_order_id, :product_id, :quantity,
                    :notes, :created_at, :updated_at)
            """), {
                "tenant_id": tenant_id,
                "replenishment_order_id": order_id,
                "product_id": item.get("product_id"),
                "quantity": item.get("quantity"),
                "notes": item.get("notes"),
                "created_at": datetime.now(),
                "updated_at": datetime.now(),
            })

        db.commit()
        return {
            "success": True,
            "id": order_id,
            "order_number": order_number,
            "items_count": len(items or []),
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[CHAT] 创建补货单失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}




def zh(*codes: int) -> str:
    return "".join(chr(code) for code in codes)


ZH_REPLENISH = zh(34917, 36135)
ZH_BU = zh(34917)
ZH_GENERATE = zh(29983, 25104)
ZH_CREATE = zh(21019, 24314)
ZH_ORDER = zh(19979, 21333)
ZH_PURCHASE = zh(37319, 36141)
ZH_PURCHASE_ORDER = zh(37319, 36141, 21333)
ZH_INBOUND = zh(20837, 24211)
ZH_INBOUND_ORDER = zh(20837, 24211, 21333)
ZH_NEED = zh(38656, 35201)
ZH_HELP_ME = zh(24110, 25105)
ZH_PLEASE = zh(35831)
ZH_GIVE_ME = zh(32473, 25105)
ZH_DIRECT = zh(30452, 25509)
ZH_ITEM = zh(20214)
ZH_ONE = zh(20010)
ZH_BOX = zh(31665)
ZH_SET = zh(22871)
ZH_PACK = zh(21253)


def fallback_extract_order_items(user_message: str) -> List[Dict[str, Any]]:
    """Extract product-name + quantity pairs from one user message."""
    import re

    normalized = (
        user_message.replace(chr(65292), ",")
        .replace(chr(12289), ",")
        .replace(chr(65307), ",")
        .replace(";", ",")
        .replace("\n", ",")
    )
    parts = [part.strip() for part in normalized.split(",") if part.strip()]
    items: List[Dict[str, Any]] = []
    unit_pattern = "[" + re.escape(ZH_ITEM + ZH_ONE + ZH_BOX + ZH_SET + ZH_PACK) + "]?"

    for part in parts:
        qty_match = re.search(r"(\d+)\s*" + unit_pattern, part)
        if not qty_match:
            continue

        quantity = int(qty_match.group(1))
        product_name = part[:qty_match.start()].strip()
        action_words = [
            ZH_HELP_ME + ZH_REPLENISH,
            ZH_HELP_ME + ZH_BU,
            ZH_PLEASE + ZH_REPLENISH,
            ZH_PLEASE + ZH_BU,
            ZH_GIVE_ME + ZH_REPLENISH,
            ZH_GIVE_ME + ZH_BU,
            ZH_REPLENISH,
            ZH_BU,
            ZH_PURCHASE,
            zh(20080),
            ZH_INBOUND,
            ZH_GENERATE,
            ZH_CREATE,
            ZH_ORDER,
            ZH_NEED,
        ]
        changed = True
        while changed:
            changed = False
            for word in action_words:
                if product_name.endswith(word):
                    product_name = product_name[: -len(word)].strip()
                    changed = True
        prefix_words = [ZH_HELP_ME + ZH_REPLENISH, ZH_HELP_ME + ZH_BU, ZH_PLEASE + ZH_REPLENISH, ZH_PLEASE + ZH_BU, ZH_REPLENISH, ZH_BU]
        changed = True
        while changed:
            changed = False
            for word in prefix_words:
                if product_name.startswith(word):
                    product_name = product_name[len(word):].strip()
                    changed = True
        product_name = product_name.strip(" ？:？，？。!。？")
        product_name = product_name.lstrip("?:").strip()
        if product_name and quantity > 0:
            items.append({"product_name": product_name, "quantity": quantity})

    return items


def classify_order_intent_with_ai(user_message: str) -> Dict[str, Any]:
    """Use AI to classify order intent before executing mutating tools."""
    fallback_intent = "other"
    if any(keyword in user_message for keyword in [ZH_REPLENISH, ZH_BU]):
        fallback_intent = "replenishment"
    elif ZH_INBOUND in user_message:
        fallback_intent = "inbound"
    elif any(keyword in user_message for keyword in [ZH_PURCHASE, ZH_PURCHASE_ORDER]):
        fallback_intent = "purchase"

    fallback = {
        "intent": fallback_intent,
        "items": fallback_extract_order_items(user_message),
        "confidence": 0.5,
    }

    if not client:
        return fallback

    try:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are an order-intent classifier. Return JSON only. "
                    "intent must be one of replenishment, purchase, inbound, query, other. "
                    "If the user says Chinese words meaning replenish/restock, including the single character bu(?), classify as replenishment, never purchase. "
                    "items must contain explicitly requested products and quantities: [{product_name, quantity}]. "
                    "If the user only asks which products need replenishment and gives no quantity, use intent=query and items=[]."
                ),
            },
            {"role": "user", "content": user_message},
        ]
        with ai_call_slot():
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages,
                temperature=0,
                timeout=60,
                response_format={"type": "json_object"},
            )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)
        intent = parsed.get("intent") or fallback_intent
        raw_items = parsed.get("items") if isinstance(parsed.get("items"), list) else []
        normalized_items = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            product_name = str(item.get("product_name") or "").strip()
            try:
                quantity = int(item.get("quantity") or 0)
            except (TypeError, ValueError):
                quantity = 0
            if product_name and quantity > 0:
                normalized_items.append({"product_name": product_name, "quantity": quantity})

        if not normalized_items:
            normalized_items = fallback["items"]
        return {
            "intent": intent,
            "items": normalized_items,
            "confidence": parsed.get("confidence", 0.8),
        }
    except Exception as e:
        logger.warning(f"[CHAT] AI intent classification failed, using fallback parser: {e}")
        return fallback


def resolve_store_group_from_message(db: Session, tenant_id: int, user_message: str) -> Optional[Dict[str, Any]]:
    try:
        groups = db.execute(text("""
            SELECT id, name
            FROM store_groups
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL
            ORDER BY LENGTH(name) DESC, id ASC
        """), {"tenant_id": tenant_id}).fetchall()
        matched = None
        matched_index = None
        for group in groups:
            group_id = group[0]
            group_name = str(group[1] or "").strip()
            if not group_name:
                continue
            idx = user_message.find(group_name)
            if idx == -1:
                continue
            if matched is None or idx < matched_index or (idx == matched_index and len(group_name) > len(matched["name"])):
                matched = {"id": group_id, "name": group_name}
                matched_index = idx
        return matched
    except Exception as e:
        logger.warning(f"[CHAT] resolve_store_group_from_message failed: {e}")
        return None


def build_replenishment_success_reply(result: Dict[str, Any], items: List[Dict[str, Any]]) -> str:
    item_lines = "\n".join([
        f"- {item.get('product_name', '')}\uff1a{item.get('quantity', 0)}" for item in items
    ])
    store_group_name = result.get("store_group_name") or ""
    store_group_line = f"\n- \u5e97\u94fa\u5206\u7ec4\uff1a{store_group_name}" if store_group_name else ""
    return (
        f"\u8865\u8d27\u5355\u521b\u5efa\u6210\u529f\uff01\n\n"
        f"\u8865\u8d27\u5355\u4fe1\u606f\uff1a\n- \u5355\u53f7\uff1a{result.get('order_number')}\n- ID\uff1a{result.get('id')}{store_group_line}\n- \u5546\u54c1\u6570\uff1a{result.get('items_count', 0)}\n\n"
        f"\u8865\u8d27\u660e\u7ec6\uff1a\n{item_lines}"
    )


def create_replenishment_from_named_items(db: Session, tenant_id: int, user_id: int, named_items: List[Dict[str, Any]], user_message: str = "") -> Optional[str]:
    if not named_items:
        return None

    replenishment_items: List[Dict[str, Any]] = []
    missing_names: List[str] = []
    for named_item in named_items:
        product_name = str(named_item.get("product_name") or "").strip()
        quantity = int(named_item.get("quantity") or 0)
        if not product_name or quantity <= 0:
            continue

        products = find_product(db, product_name, tenant_id, 10)
        if not products:
            missing_names.append(product_name)
            continue

        exact_product = None
        lowered_name = product_name.lower()
        for product in products:
            candidate_values = [product.get("name"), product.get("name_en"), product.get("product_code")]
            candidate_values.extend([sku.get("sku") for sku in product.get("platform_skus") or []])
            if any(str(value or "").strip().lower() == lowered_name for value in candidate_values):
                exact_product = product
                break
        product = exact_product or products[0]
        replenishment_items.append({
            "product_id": product["id"],
            "quantity": quantity,
            "notes": None,
            "product_name": product.get("name") or product_name,
        })

    if missing_names and not replenishment_items:
        return "\u672a\u627e\u5230\u8981\u8865\u8d27\u7684\u5546\u54c1\uff1a" + "\u3001".join(missing_names)
    if not replenishment_items:
        return None

    merged: Dict[int, Dict[str, Any]] = {}
    for item in replenishment_items:
        product_id = item["product_id"]
        if product_id in merged:
            merged[product_id]["quantity"] += item["quantity"]
        else:
            merged[product_id] = dict(item)
    final_items = list(merged.values())

    store_group = resolve_store_group_from_message(db, tenant_id, user_message)
    result = create_replenishment_order(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        store_group_id=store_group["id"] if store_group else None,
        notes=None,
        items=final_items,
    )
    if not result.get("success"):
        error_message = result.get("message") or "\u672a\u77e5\u9519\u8bef"
        return f"\u8865\u8d27\u5355\u521b\u5efa\u5931\u8d25\uff1a{error_message}"

    if store_group:
        result["store_group_name"] = store_group["name"]
    reply = build_replenishment_success_reply(result, final_items)
    if missing_names:
        reply += "\n\n\u4ee5\u4e0b\u5546\u54c1\u672a\u627e\u5230\uff0c\u672a\u52a0\u5165\u8865\u8d27\u5355\uff1a" + "\u3001".join(missing_names)
    return reply


def try_execute_ai_order_intent(db: Session, tenant_id: int, user_id: int, user_message: str) -> Optional[str]:
    # 检查是否包含订单创建关键词
    if not any(keyword in user_message for keyword in [ZH_BU, ZH_REPLENISH, ZH_PURCHASE, ZH_PURCHASE_ORDER, ZH_INBOUND, ZH_CREATE, ZH_GENERATE, ZH_ORDER]):
        return None

    # 检查是否是询问类意图（询问补货数量、断货风险等）
    query_keywords = ["要补多少", "应该补多少", "补多少货", "补多少", "断货风险", "风险", "库存情况", "库存状态"]
    if any(keyword in user_message for keyword in query_keywords):
        logger.info(f"[CHAT] 检测到询问类意图: {user_message}, 让AI助手查询库存")
        return None

    # 如果用户没有提供数量，可能是在询问，不是直接创建
    # 检查是否包含数量信息
    import re
    has_quantity = re.search(r'\d+\s*(件|个|箱|套|包)', user_message)
    if not has_quantity:
        # 如果没有数量，但有"补货"关键词，可能是在询问
        if ZH_REPLENISH in user_message or ZH_BU in user_message:
            logger.info(f"[CHAT] 用户提到补货但未提供数量，让AI助手推荐补货数量")
            return None

    intent_result = classify_order_intent_with_ai(user_message)
    intent = intent_result.get("intent")
    items = intent_result.get("items") or []
    logger.info(f"[CHAT] order intent: intent={intent}, items={items}")

    if intent == "replenishment":
        if not items:
            return None
        store_group = resolve_store_group_from_message(db, tenant_id, user_message)
        if store_group:
            logger.info(f"[CHAT] matched store group: {store_group}")
        return create_replenishment_from_named_items(db, tenant_id, user_id, items, user_message)

    return None


def extract_replenishment_selection(user_message: str) -> List[int]:
    """解析用户输入的 123 / 1,2,3 / 1 2 3 等序号组合"""
    import re
    text_message = user_message.strip()
    compact_match = re.fullmatch(r"[0-9]{1,20}", text_message)
    if compact_match and len(text_message) > 1:
        return [int(ch) for ch in text_message if ch.isdigit()]

    numbers = re.findall(r"\d+", text_message)
    result: List[int] = []
    for token in numbers:
        if len(token) > 1 and (',' not in text_message and '?' not in text_message and ' ' not in text_message):
            result.extend(int(ch) for ch in token)
        else:
            result.append(int(token))
    return result


def try_create_named_replenishment_from_session(db: Session, tenant_id: int, user_id: int, session_id: str, user_message: str) -> Optional[str]:
    """Create replenishment order from cached candidates using product-name + quantity."""
    candidates = SESSION_REPLENISHMENT_CANDIDATES.get(session_id) or []
    if not candidates:
        return None

    intent_keywords = ["补货", "生成", "创建", "下单"]
    if not any(keyword in user_message for keyword in intent_keywords):
        return None

    matched_items = []
    lowered_message = user_message.lower()
    import re

    for candidate in candidates:
        product_name = str(candidate.get("product_name") or "").strip()
        if not product_name:
            continue

        lowered_name = product_name.lower()
        if lowered_name not in lowered_message:
            continue

        name_index = lowered_message.find(lowered_name)
        tail_text = user_message[name_index + len(product_name): name_index + len(product_name) + 30]
        qty_match = re.search(r"(\d+)\s*(?:件|个|箱|套|包)?", tail_text)
        if not qty_match:
            continue

        quantity = int(qty_match.group(1))
        product_id = candidate.get("product_id")
        if not product_id or quantity <= 0:
            continue

        matched_items.append({
            "product_id": product_id,
            "quantity": quantity,
            "notes": f"AI助手按对话补货：{product_name}",
            "product_name": product_name,
            "suggest_qty": quantity,
        })

    if not matched_items:
        return None

    result = create_replenishment_order(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        store_group_id=None,
        notes="AI助手根据对话内容自动创建补货单",
        items=matched_items,
    )

    if not result.get("success"):
        return f"补货单创建失败：{result.get('message', '未知错误')}"

    item_lines = "\n".join([
        f"- {item['product_name']}：{item['suggest_qty']} 件" for item in matched_items
    ])
    return (
        f"补货单创建成功！\n\n"
        f"补货单信息：\n- 单号：{result.get('order_number')}\n- ID：{result.get('id')}\n- 商品数：{result.get('items_count', 0)}\n\n"
        f"补货明细：\n{item_lines}\n\n"
        "请在补货管理页面查看。"
    )


def try_create_replenishment_from_session(db: Session, tenant_id: int, user_id: int, session_id: str, user_message: str) -> Optional[str]:
    """根据用户选择序号，从会话候选列表创建补货单"""
    candidates = SESSION_REPLENISHMENT_CANDIDATES.get(session_id) or []
    if not candidates:
        return None

    if not any(keyword in user_message for keyword in ["补货", "生成", "创建", "下单"]):
        return None

    selected_indexes = extract_replenishment_selection(user_message)
    if not selected_indexes:
        return None

    chosen_items = []
    seen = set()
    for index in selected_indexes:
        if index in seen:
            continue
        seen.add(index)
        if 1 <= index <= len(candidates):
            chosen = candidates[index - 1]
            suggest_qty = int(chosen.get("suggest_qty") or 0)
            product_id = chosen.get("product_id")
            if product_id and suggest_qty > 0:
                chosen_items.append({
                    "product_id": product_id,
                    "quantity": suggest_qty,
                    "notes": f"AI????????????????? {index}????? {chosen.get('risk_level', '-')}",
                    "product_name": chosen.get("product_name", ""),
                    "suggest_qty": suggest_qty,
                })

    if not chosen_items:
        return "没有可创建的补货商品，请确认选中的条目是否存在建议补货数量。"

    result = create_replenishment_order(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        store_group_id=None,
        notes="AI助手自动创建补货单",
        items=chosen_items,
    )

    if not result.get("success"):
        return f"创建失败：{result.get('message', '未知错误')}"

    item_lines = "\n".join([
        f"- {item['product_name']}：{item['suggest_qty']} 件" for item in chosen_items
    ])
    return (
        f"补货单已创建成功！\n\n"
        f"订单详情\n- 单号：{result.get('order_number')}\n- ID：{result.get('id')}\n- 商品数：{result.get('items_count', 0)}\n\n"
        f"商品清单\n{item_lines}\n\n"
        "请在系统中查看并确认此补货单，审批后可转采购单。"
    )



def create_inbound_order(db: Session, tenant_id: int, user_id: int,
                          order_number: Optional[str] = None, inbound_type: str = "purchase",
                          purchase_order_id: Optional[int] = None,
                          warehouse: Optional[str] = None,
                          handler: Optional[str] = None,
                          inbound_date: Optional[str] = None,
                          notes: Optional[str] = None,
                          items: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """创建入库单"""
    try:
        from datetime import datetime
        from sqlalchemy import text

        # 自动生成单号
        if not order_number:
            order_number = f"IO{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
        logger.info(f"[CHAT] create_inbound_order 开始: tenant_id={tenant_id}, user_id={user_id}, order_number={order_number}")
        logger.info(f"[CHAT] 创建入库单明细: {json.dumps(items, ensure_ascii=False)}")

        # 计算总数量和金额
        total_qty = 0
        total_amount = 0
        for item in items or []:
            total_qty += item.get("quantity") or 0
            total_amount += (item.get("quantity") or 0) * (item.get("unit_price") or 0)

        logger.info(f"[CHAT] 计算总数量: {total_qty}, 总金额: {total_amount}")

        # 处理入库日期
        inbound_date_value = datetime.now()
        if inbound_date:
            try:
                inbound_date_value = datetime.strptime(inbound_date, "%Y-%m-%d")
            except:
                pass

        # 创建主单
        db.execute(text("""
            INSERT INTO inbound_orders 
            (tenant_id, order_number, inbound_type, purchase_order_id, warehouse, handler, inbound_date, total_quantity, total_amount, status, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :inbound_type, :purchase_order_id, :warehouse, :handler, :inbound_date, :total_quantity, :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": tenant_id,
            "order_number": order_number,
            "inbound_type": inbound_type,
            "purchase_order_id": purchase_order_id,
            "warehouse": warehouse,
            "handler": handler,
            "inbound_date": inbound_date_value,
            "total_quantity": total_qty,
            "total_amount": total_amount,
            "notes": notes,
            "created_by": user_id,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        })

        # 获取刚插入的ID
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
        logger.info(f"[CHAT] 入库单主单已创建, ID={order_id}")
        
        # 创建明细
        for idx, item in enumerate(items or []):
            total_price = (item.get("quantity") or 0) * (item.get("unit_price") or 0)
            logger.info(f"[CHAT] 创建入库明细 {idx+1}: product_id={item.get('product_id')}, quantity={item.get('quantity')}")
            
            # 处理生产日期和过期日期
            prod_date = None
            if item.get("production_date"):
                try:
                    prod_date = datetime.strptime(item["production_date"], "%Y-%m-%d")
                except:
                    pass
            
            exp_date = None
            if item.get("expiry_date"):
                try:
                    exp_date = datetime.strptime(item["expiry_date"], "%Y-%m-%d")
                except:
                    pass
            
            db.execute(text("""
                INSERT INTO inbound_order_items 
                (inbound_order_id, product_id, quantity, unit_price, total_price, batch_number, production_date, expiry_date, warehouse, shelf_number, notes, created_at, updated_at)
                VALUES (:inbound_order_id, :product_id, :quantity, :unit_price, :total_price, :batch_number, :production_date, :expiry_date, :warehouse, :shelf_number, :notes, :created_at, :updated_at)
            """), {
                "inbound_order_id": order_id,
                "product_id": item.get("product_id"),
                "quantity": item.get("quantity"),
                "unit_price": item.get("unit_price") or 0,
                "total_price": total_price,
                "batch_number": item.get("batch_number"),
                "production_date": prod_date,
                "expiry_date": exp_date,
                "warehouse": item.get("warehouse") or warehouse,
                "shelf_number": item.get("shelf_number"),
                "notes": item.get("notes"),
                "created_at": datetime.now(),
                "updated_at": datetime.now()
            })
        
        db.commit()
        logger.info(f"[CHAT] 入库单提交成功: ID={order_id}, order_number={order_number}")
        
        # 验证一下是否真的插入了
        verify_result = db.execute(text("""
            SELECT id, order_number FROM inbound_orders WHERE id = :oid AND tenant_id = :tid AND deleted_at IS NULL
        """), {"oid": order_id, "tid": tenant_id}).fetchone()
        
        logger.info(f"[CHAT] 验证插入结果: {verify_result}")
        
        return {
            "success": True,
            "id": order_id,
            "order_number": order_number,
            "total_quantity": total_qty,
            "items_count": len(items or [])
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[CHAT] 创建入库单失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


def process_chat(db: Session, user_id: int, session_id: str, user_message: str, chat_type: str = "review") -> str:
    """处理聊天请求 - chat_type: review=差评分析, inventory=库存分析, unified=统一分析"""
    logger.info(f"[CHAT] 收到消息, 用户={user_id}, 类型={chat_type}")

    if not client:
        return "OpenAI API Key 未配置"

    # 获取用户信息和租户ID
    user = db.query(User).filter(User.id == user_id).first()
    tenant_id = user.tenant_id if user else 0

    save_message(db, user_id, session_id, "user", user_message, chat_type=chat_type)
    history = get_conversation_history(db, user_id, session_id, limit=10)
    current_date = datetime.now().strftime("%Y-%m-%d")

    ai_order_intent_reply = try_execute_ai_order_intent(db, tenant_id, user_id, user_message)
    if ai_order_intent_reply:
        save_message(db, user_id, session_id, "assistant", ai_order_intent_reply, function_name="create_replenishment_order", chat_type=chat_type)
        return ai_order_intent_reply

    named_replenishment_reply = try_create_named_replenishment_from_session(db, tenant_id, user_id, session_id, user_message)
    if named_replenishment_reply:
        save_message(db, user_id, session_id, "assistant", named_replenishment_reply, function_name="create_replenishment_order", chat_type=chat_type)
        return named_replenishment_reply

    replenishment_reply = try_create_replenishment_from_session(db, tenant_id, user_id, session_id, user_message)
    if replenishment_reply:
        save_message(db, user_id, session_id, "assistant", replenishment_reply, function_name="create_replenishment_order", chat_type=chat_type)
        return replenishment_reply

    # 根据对话类型选择不同的提示词和工具
    if chat_type == "unified":
        system_prompt = f"""你是跨境电商AI助手。当前日期: {current_date}。

【核心规则】
1. 创建采购/入库单前，**必须**先调用 find_product 找到产品ID！
2. 单号自动生成，不需要用户提供。
3. 【判断逻辑】：
   - 如果用户已提供产品信息和数量：直接调用工具创建，不要啰嗦
   - 如果信息缺失：清楚告诉用户需要补充什么必填项，哪些是可选的

【采购单必填/可选】
✅ 必须先通过 find_product 找到产品 ID
必填：商品、数量
可选：供应商、仓库、预计到货日期、备注

【入库单必填/可选】
✅ 必须先通过 find_product 找到产品 ID
必填：商品、数量
可选：入库类型(默认采购)、仓库、经办人、入库日期、备注

【可用工具】
- find_product: 查找产品（先做这个！）
- create_purchase_order: 创建采购单
- create_inbound_order: 创建入库单
- query_inventory_status: 查库存
- query_reviews: 查差评
"""
        tools = UNIFIED_TOOLS
    elif chat_type == "inventory":
        system_prompt = f"""你是专业的跨境电商库存分析助手。当前日期: {current_date}。

你的能力：
- 查询库存状态、断货风险商品、补货建议
- 分析库存健康度，给出补货优先级建议

重要规则：
- 使用商品的【真实名称】来引用产品，不要只使用ASIN
- 回复要简洁专业，突出关键数据和建议
- 优先展示风险等级和建议补货数量
- 对于库存数据，用表格或列表形式清晰展示
"""
        tools = INVENTORY_TOOLS
    else:
        system_prompt = f"""你是专业的跨境电商差评分析助手。当前日期: {current_date}。

任务：
1. 解析用户提到的日期范围
2. 查询该日期范围内的差评
3. 用中文进行分析回复

重要规则：
- 绝对不要在回复中使用数字ID或ASIN编号来标识产品
- 必须使用商品的【真实名称】来引用产品
- 引用格式：【商品名】具体问题描述
"""
        tools = DATE_PARSING_TOOLS

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    logger.info(f"[CHAT] 准备调用AI, 工具数: {len(tools)}, 对话类型: {chat_type}")
    try:
        with ai_call_slot():
            response = client.chat.completions.create(model=settings.OPENAI_MODEL, messages=messages, tools=tools, tool_choice="auto", timeout=180)

        assistant_message = response.choices[0].message
        logger.info(f"[CHAT] AI返回: content={assistant_message.content}, tool_calls={assistant_message.tool_calls}")

        if assistant_message.tool_calls:
            logger.info(f"[CHAT] 检测到工具调用，数量: {len(assistant_message.tool_calls)}")

            # 先收集所有find_product工具调用的结果
            all_found_products = []
            has_find_product = False
            is_query_intent = any(keyword in user_message for keyword in ["要补多少", "应该补多少", "补多少货", "补多少", "断货风险", "风险"])

            for tool_call in assistant_message.tool_calls:
                logger.info(f"[CHAT] 工具调用: {tool_call.function.name}, 参数: {tool_call.function.arguments}")
                # 处理库存查询
                if tool_call.function.name == "query_inventory_status":
                    args = json.loads(tool_call.function.arguments)
                    query_type = args.get("query_type", "all")
                    risk_level = args.get("risk_level")
                    limit = args.get("limit", 10)

                    logger.info(f"[CHAT] 库存查询: type={query_type}, risk={risk_level}, limit={limit}")
                    inventory_items = query_inventory_status(db, tenant_id, query_type, risk_level, limit)
                    logger.info(f"[CHAT] 查询到 {len(inventory_items)} 条库存数据")

                    # 构建给AI的数据
                    inventory_prompt = f"""当前日期: {current_date}

查询到 {len(inventory_items)} 条库存数据：

{json.dumps(inventory_items, ensure_ascii=False, indent=1)}

请基于以上数据进行专业的库存分析，给出：
1. 整体库存状况概述
2. 重点关注商品列表（按风险等级排序）
3. 补货建议

回复要简洁专业，使用商品名称而非ASIN。"""

                    final_messages = [{"role": "system", "content": inventory_prompt}]
                    final_messages.extend(history)
                    final_messages.append({"role": "user", "content": user_message})

                    with ai_call_slot():
                        final_response = client.chat.completions.create(model=settings.OPENAI_MODEL, messages=final_messages, temperature=0.7, timeout=240)
                    final_reply = final_response.choices[0].message.content or "无回复内容"

                    replenishment_candidates = [
                        item for item in inventory_items
                        if item.get("suggest_qty", 0) > 0 and item.get("product_id")
                    ][:9]
                    SESSION_REPLENISHMENT_CANDIDATES[session_id] = replenishment_candidates

                    if replenishment_candidates:
                        candidate_lines = "\n".join([
                            f"{idx + 1}. {item.get('product_name', '-')}建议补货 {item.get('suggest_qty', 0)} 件，库存 {item.get('days_of_supply', 0)}"
                            for idx, item in enumerate(replenishment_candidates)
                        ])
                        final_reply = (
                            f"{final_reply}\n\n是否创建补货单？以下产品建议补货：\n{candidate_lines}"
                            "\n\n回复序号确认，如 `123全部` 或 `1,2,3部分`。"
                            "不回复则取消创建补货单。"
                        )
                    else:
                        SESSION_REPLENISHMENT_CANDIDATES.pop(session_id, None)

                    save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                    return final_reply

                # 处理统一模式的差评查询
                if tool_call.function.name == "query_reviews":
                    args = json.loads(tool_call.function.arguments)
                    start_date = args.get("start_date")
                    end_date = args.get("end_date")
                    asin = args.get("asin")

                    if not start_date or not end_date:
                        end_date = datetime.now().strftime("%Y-%m-%d")
                        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

                    logger.info(f"[CHAT] 统一模式差评查询: {start_date} ~ {end_date}, ASIN={asin}")
                    reviews = query_negative_reviews(db, tenant_id, start_date, end_date, asin)
                    logger.info(f"[CHAT] 查询到 {len(reviews)} 条差评")

                    # 分离已分析和未分析的差评
                    reviews_for_ai = []
                    unanalyzed_reviews = []
                    for review in reviews:
                        product_name = review.get("product_name", review["asin"])
                        analysis = get_review_analysis(db, review["id"], tenant_id)
                        if analysis:
                            reviews_for_ai.append({
                                "product_name": product_name,
                                "rating": review["rating"],
                                "title": review.get("title", "") or "",
                                "content_preview": review["content"][:150] + ("..." if len(review["content"]) > 150 else ""),
                                "translation_preview": (review.get("translated_content") or "")[:150],
                                "key_issues": analysis["key_points"] if analysis else [],
                                "summary": analysis["summary"] if analysis else ""
                            })
                        else:
                            unanalyzed_reviews.append(review)

                    # 并发分析未分析的差评（最多5条，线程池并发）
                    if unanalyzed_reviews:
                        to_analyze = unanalyzed_reviews[:5]
                        logger.info(f"[CHAT] 并发分析 {len(to_analyze)} 条未分析差评（共 {len(unanalyzed_reviews)} 条未分析）")
                        from concurrent.futures import ThreadPoolExecutor, as_completed
                        analysis_results = {}
                        def _analyze_one(rev):
                            try:
                                return rev["id"], analyze_and_save_single_review(db, rev)
                            except Exception as e:
                                logger.error(f"分析评论{rev['id']}失败: {e}")
                                return rev["id"], None

                        with ThreadPoolExecutor(max_workers=min(5, len(to_analyze))) as executor:
                            futures = {executor.submit(_analyze_one, rev): rev for rev in to_analyze}
                            for future in as_completed(futures):
                                rev_id, result = future.result()
                                analysis_results[rev_id] = result

                        analyzed_count = sum(1 for v in analysis_results.values() if v)
                        # 将分析结果合并到 reviews_for_ai
                        for rev in to_analyze:
                            product_name = rev.get("product_name", rev["asin"])
                            analysis = analysis_results.get(rev["id"])
                            reviews_for_ai.append({
                                "product_name": product_name,
                                "rating": rev["rating"],
                                "title": rev.get("title", "") or "",
                                "content_preview": rev["content"][:150] + ("..." if len(rev["content"]) > 150 else ""),
                                "translation_preview": (rev.get("translated_content") or "")[:150],
                                "key_issues": analysis["key_points"] if analysis else [],
                                "summary": analysis["summary"] if analysis else ""
                            })
                        # 未分析的剩余差评也加入列表（无分析结果）
                        for rev in unanalyzed_reviews[5:]:
                            product_name = rev.get("product_name", rev["asin"])
                            reviews_for_ai.append({
                                "product_name": product_name,
                                "rating": rev["rating"],
                                "title": rev.get("title", "") or "",
                                "content_preview": rev["content"][:150] + ("..." if len(rev["content"]) > 150 else ""),
                                "translation_preview": (rev.get("translated_content") or "")[:150],
                                "key_issues": [],
                                "summary": ""
                            })
                        logger.info(f"[CHAT] 并发分析完成，新分析 {analyzed_count} 条")
                    else:
                        logger.info(f"[CHAT] 全部 {len(reviews_for_ai)} 条差评已有分析结果")

                    analysis_prompt = f"""当前日期: {current_date}

查询到 {len(reviews_for_ai)} 条差评数据（日期范围: {start_date} ~ {end_date}）：

{json.dumps(reviews_for_ai, ensure_ascii=False, indent=1)}

请基于以上数据进行专业的差评分析，给出改进建议。
回复必须使用商品名称引用产品，禁止使用ASIN编号。"""

                    final_messages = [{"role": "system", "content": analysis_prompt}]
                    final_messages.extend(history)
                    final_messages.append({"role": "user", "content": user_message})

                    with ai_call_slot():
                        final_response = client.chat.completions.create(model=settings.OPENAI_MODEL, messages=final_messages, temperature=0.7, timeout=240)
                    final_reply = final_response.choices[0].message.content or "抱歉，无法处理"

                    save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                    return final_reply

                # 处理产品查找
                if tool_call.function.name == "find_product":
                    args = json.loads(tool_call.function.arguments)
                    search_keyword = args.get("search_keyword")
                    limit = args.get("limit", 10)

                    logger.info(f"[CHAT] 查找产品: {search_keyword}")

                    products = find_product(db, search_keyword, tenant_id, limit)
                    logger.info(f"[CHAT] 查询到 {len(products)} 个产品")

                    if len(products) > 0:
                        # 收集所有找到的产品，稍后统一处理
                        has_find_product = True
                        all_found_products.extend(products)
                    else:
                        logger.info(f"[CHAT] 未找到产品: {search_keyword}")

            # 循环结束后，统一处理所有找到的产品
            if has_find_product and all_found_products:
                # 去重（同一产品可能被多次搜索到）
                seen_ids = set()
                unique_products = []
                for p in all_found_products:
                    if p["id"] not in seen_ids:
                        seen_ids.add(p["id"])
                        unique_products.append(p)
                all_found_products = unique_products
                logger.info(f"[CHAT] 去重后共 {len(all_found_products)} 个产品")

                # 如果是询问类意图，查询库存并推荐补货数量
                if is_query_intent:
                    logger.info(f"[CHAT] 用户询问补货数量，查询库存状态")
                    products = all_found_products  # 使用所有找到的产品

                    # 构建产品名称、SKU和ASIN列表用于数据库查询
                    product_names = [p["name"] for p in products]
                    product_codes = [p.get("product_code") for p in products]
                    product_skus = []
                    product_asins = []
                    for p in products:
                        if p.get("platform_skus"):
                            for s in p["platform_skus"]:
                                if s.get("sku"):
                                    product_skus.append(s.get("sku"))
                                if s.get("asin"):
                                    product_asins.append(s.get("asin"))

                    logger.info(f"[CHAT] 产品信息: 名称={product_names}, 编码={product_codes}, SKU={product_skus}, ASIN={product_asins}")

                    # 直接在数据库中查询匹配的库存数据
                    from models.restock import InventorySnapshot, ReplenishmentDecision
                    from sqlalchemy import or_, and_, func

                    # 获取最新快照日期
                    latest_date_query = db.query(func.max(InventorySnapshot.snapshot_date)).filter(
                        InventorySnapshot.tenant_id == tenant_id
                    )
                    latest_date = latest_date_query.scalar()

                    if not latest_date:
                        final_reply = "库存数据尚未更新，请先上传最新的库存Excel文件。"
                        save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                        return final_reply

                    # 构建查询条件：通过名称、SKU、ASIN或产品编码匹配
                    name_conditions = [InventorySnapshot.product_name.like(f"%{name}%") for name in product_names if name]
                    sku_conditions = [InventorySnapshot.sku == sku for sku in product_skus if sku]
                    asin_conditions = [InventorySnapshot.asin == asin for asin in product_asins if asin]
                    code_conditions = [InventorySnapshot.sku == code for code in product_codes if code]

                    all_conditions = name_conditions + sku_conditions + asin_conditions + code_conditions

                    if not all_conditions:
                        final_reply = f"未找到产品信息，请确认产品名称或SKU。"
                        save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                        return final_reply

                    # 查询库存快照和补货决策
                    query = db.query(InventorySnapshot, ReplenishmentDecision).outerjoin(
                        ReplenishmentDecision,
                        and_(
                            ReplenishmentDecision.snapshot_id == InventorySnapshot.id,
                            ReplenishmentDecision.snapshot_date == latest_date
                        )
                    ).filter(
                        InventorySnapshot.snapshot_date == latest_date,
                        InventorySnapshot.tenant_id == tenant_id,
                        or_(*all_conditions)
                    )

                    results = query.all()
                    logger.info(f"[CHAT] 数据库查询到 {len(results)} 条匹配的库存数据")

                    # 转换为字典列表
                    inventory_items = []
                    for snap, dec in results:
                        inventory_items.append({
                            "product_name": snap.product_name or snap.asin or "未知商品",
                            "sku": snap.sku or "",
                            "asin": snap.asin or "",
                            "fba_stock": int(snap.fba_stock) if snap.fba_stock else 0,
                            "daily_sales": round(float(snap.daily_sales), 1) if snap.daily_sales else 0,
                            "days_of_supply": round(float(dec.days_of_supply), 1) if dec and dec.days_of_supply else 0,
                            "suggest_qty": int(dec.suggest_qty) if dec and dec.suggest_qty else 0,
                            "risk_level": dec.risk_level if dec else "绿",
                        })

                    logger.info(f"[CHAT] 转换后得到 {len(inventory_items)} 条库存数据")

                    if inventory_items:
                        # 计算推荐补货数量并保存候选列表
                        replenishment_candidates = []
                        for item in inventory_items:
                            days_of_supply = item.get("days_of_supply", 0)
                            suggest_qty = item.get("suggest_qty", 0)
                            if suggest_qty > 0:
                                # 从产品列表中找到匹配的产品ID
                                matched_product = None
                                for p in products:
                                    # 通过名称匹配
                                    if p["name"] and item.get("product_name") and (p["name"] in item["product_name"] or item["product_name"] in p["name"]):
                                        matched_product = p
                                        break
                                    # 通过SKU匹配
                                    if p.get("platform_skus"):
                                        for s in p["platform_skus"]:
                                            if s.get("sku") == item.get("sku"):
                                                matched_product = p
                                                break

                                replenishment_candidates.append({
                                    "product_id": matched_product["id"] if matched_product else None,
                                    "product_name": item.get("product_name"),
                                    "product_code": matched_product.get("product_code") if matched_product else item.get("sku"),
                                    "sku": item.get("sku"),
                                    "days_of_supply": days_of_supply,
                                    "suggest_qty": suggest_qty,
                                    "fba_stock": item.get("fba_stock", 0),
                                    "daily_sales": item.get("daily_sales", 0),
                                })

                        logger.info(f"[CHAT] 找到 {len(replenishment_candidates)} 个需要补货的商品")

                        SESSION_REPLENISHMENT_CANDIDATES[session_id] = replenishment_candidates

                        # 构建推荐回复
                        candidate_lines = "\n".join([
                            f"{idx + 1}. {item.get('product_name')} ({item.get('sku', '无SKU')}): "
                            f"可售{item.get('days_of_supply', 0)}天, FBA库存{item.get('fba_stock', 0)}, "
                            f"日均销量{item.get('daily_sales', 0)}, 建议补货{item.get('suggest_qty', 0)}件"
                            for idx, item in enumerate(replenishment_candidates)
                        ])

                        final_reply = (
                            f"根据库存分析，以下商品需要补货：\n\n{candidate_lines}\n\n"
                            f"请确认需要补货的商品和数量，回复序号如 `123全部` 或 `1,2,3部分`，"
                            f"或直接回复商品名称和数量如 `Love Island气球 50件, 红色蝴蝶结车厘子包 30件`。"
                        )

                        save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                        return final_reply
                    else:
                        # 没有找到匹配的库存数据
                        logger.warning(f"[CHAT] 未找到匹配的库存数据，产品名称: {product_names}, SKU: {product_skus}")
                        final_reply = (
                            f"已找到产品：{', '.join([p['name'] for p in products])}，但未在库存数据中找到匹配记录。\n\n"
                            f"可能的原因：\n"
                            f"1. 库存数据尚未更新，请先上传最新的库存Excel文件\n"
                            f"2. 产品名称或SKU与库存数据不匹配，请检查产品信息\n"
                            f"3. 该产品可能不在库存管理范围内\n\n"
                            f"请在系统中确认产品信息，或联系管理员更新库存数据。"
                        )
                        save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                        return final_reply

                else:
                    # 非询问类意图，检查是否包含数量，直接创建订单
                    products = all_found_products  # 使用所有找到的产品
                    import re
                    # 提取数量
                    qty_match = re.search(r'(\d+)\s*件', user_message)
                    quantity = int(qty_match.group(1)) if qty_match else 0

                    # 提取仓库 - 兼容多种写法：仓库深圳、仓库：深圳、仓库深圳bxhs
                    warehouse = None
                    warehouse_match = re.search(r'仓库[?:\s]*([^仓库]+)', user_message)
                    if warehouse_match:
                        warehouse = warehouse_match.group(1).strip()

                    # 判断订单类型关键字
                    is_purchase = "采购" in user_message
                    is_inbound = "入库" in user_message or "入库单" in user_message
                    is_replenishment = any(keyword in user_message for keyword in ["补货", "补", "生成补货单", "创建补货单"])

                    if quantity > 0:
                        logger.info(f"[CHAT] 提取到 {quantity}件, 仓库={warehouse}, 判断订单类型...")
                        
                        product = products[0]
                        # 提取产品的默认采购价
                        unit_price = product.get("purchase_price")
                        items = [{
                            "product_id": product["id"],
                            "quantity": quantity,
                            "unit_price": unit_price
                        }]
                        
                        if is_replenishment:
                            final_reply = (
                                "\u8bc6\u522b\u5230\u4f60\u662f\u8981\u521b\u5efa\u8865\u8d27\u5355\uff0c\u4e0d\u4f1a\u518d\u81ea\u52a8\u521b\u5efa\u91c7\u8d2d\u5355\u3002\n\n"
                                f"\u5df2\u5339\u914d\u5230\u5546\u54c1\uff1a{product['name']}\uff0c\u6570\u91cf\uff1a{quantity}\u3002\n"
                                "\u8bf7\u5148\u5728\u540c\u4e00\u4f1a\u8bdd\u91cc\u8ba9 AI \u5217\u51fa\u9700\u8981\u8865\u8d27\u7684\u5546\u54c1\uff0c\u518d\u56de\u590d\u5546\u54c1\u548c\u6570\u91cf\uff1b"
                                "\u6216\u8005\u76f4\u63a5\u8bf4“\u54ea\u4e9b\u5546\u54c1\u9700\u8981\u8865\u8d27”\u3002"
                            )
                        elif is_purchase or (not is_purchase and not is_inbound):
                            # 创建采购单
                            logger.info(f"[CHAT] 准备创建采购单，仓库：{warehouse}，单价：{unit_price}")
                            result = create_purchase_order(
                                db, tenant_id, user_id,
                                None, None, warehouse, None, None, items
                            )
                            if result.get("success"):
                                price_note = f"{unit_price}" if unit_price else "未设置，默认 0"
                                # 获取平台 SKU
                                platform_sku = ""
                                if product.get("platform_skus") and len(product["platform_skus"]) > 0:
                                    platform_sku = product["platform_skus"][0].get("sku", "")
                                final_reply = f"""采购单创建成功！

采购单信息：
- 单号：{result.get('order_number')}
- ID：{result.get('id')}
- 产品：{product['name']}
- 产品编码：{product['product_code']}
- 平台 SKU：{platform_sku}
- 数量：{quantity} 件
- 单价：{price_note}
- 仓库：{warehouse or '未指定'}

请在采购管理页面查看。"""
                            else:
                                final_reply = f"创建失败：{result.get('message')}"
                        else:
                            # 创建入库单
                            logger.info(f"[CHAT] 准备创建入库单，仓库：{warehouse}，单价：{unit_price}")
                            result = create_inbound_order(
                                db, tenant_id, user_id,
                                None, "purchase", None, warehouse, None, None, None, items
                            )
                            if result.get("success"):
                                price_note = f"{unit_price}" if unit_price else "未设置，默认 0"
                                # 获取平台 SKU
                                platform_sku = ""
                                if product.get("platform_skus") and len(product["platform_skus"]) > 0:
                                    platform_sku = product["platform_skus"][0].get("sku", "")
                                final_reply = f"""入库单创建成功！

入库单信息：
- 单号：{result.get('order_number')}
- ID：{result.get('id')}
- 产品：{product['name']}
- 产品编码：{product['product_code']}
- 平台 SKU：{platform_sku}
- 数量：{quantity} 件
- 单价：{price_note}
- 仓库：{warehouse or '未指定'}

请在入库管理页面查看。"""
                            else:
                                final_reply = f"创建失败：{result.get('message')}"
                    else:
                        # 没有数量，告诉用户需要补充
                        final_reply = f"""已找到产品！
产品：{products[0]['name']} (SKU: {products[0]['product_code']})

但需要补充数量信息！

📋 必填：商品、数量
✅ 可选：供应商、仓库、预计到货日期、备注

请告诉我需要采购或入库的数量。"""
            else:
                final_reply = f"未找到与 {search_keyword} 相关的产品，请确认产品编码或 SKU 正确。"
                
                save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                return final_reply

                # 处理创建采购单
                if tool_call.function.name == "create_purchase_order":
                    ai_order_intent_reply = try_execute_ai_order_intent(db, tenant_id, user_id, user_message)
                    if ai_order_intent_reply:
                        save_message(db, user_id, session_id, "assistant", ai_order_intent_reply, function_name="create_replenishment_order", chat_type=chat_type)
                        return ai_order_intent_reply

                    if any(keyword in user_message for keyword in ["帮", "帮忙", "帮帮我", "求助"]):
                        final_reply = "您好！我可以帮您查询产品、分析库存、创建补货单、入库单、采购单等。请告诉我您需要什么帮助。"
                        save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                        return final_reply

                    args = json.loads(tool_call.function.arguments)
                    order_number = args.get("order_number")
                    supplier = args.get("supplier")
                    warehouse = args.get("warehouse")
                    expected_date = args.get("expected_date")
                    notes = args.get("notes")
                    items = args.get("items", [])

                    logger.info(f"[CHAT] 创建采购单: {order_number}, items={len(items)}")
                    
                    result = create_purchase_order(
                        db, tenant_id, user_id,
                        order_number, supplier, warehouse,
                        expected_date, notes, items
                    )
                    logger.info(f"[CHAT] 采购单创建结果: {result}")

                    if result.get("success"):
                        final_reply = f"""采购单创建成功！

采购单信息：
- 单号：{result.get('order_number')}
- ID：{result.get('id')}
- 总金额：{result.get('total_amount', 0)}
- 商品数量：{result.get('items_count', 0)}

采购单已保存为草稿状态，您可以在系统中进一步编辑或提交审批。"""
                    else:
                        final_reply = f"创建采购单失败：{result.get('message', '未知错误')}"

                    save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                    return final_reply

                # 处理创建入库单
                if tool_call.function.name == "create_inbound_order":
                    args = json.loads(tool_call.function.arguments)
                    order_number = args.get("order_number")
                    inbound_type = args.get("inbound_type", "purchase")
                    purchase_order_id = args.get("purchase_order_id")
                    warehouse = args.get("warehouse")
                    handler = args.get("handler")
                    inbound_date = args.get("inbound_date")
                    notes = args.get("notes")
                    items = args.get("items", [])

                    logger.info(f"[CHAT] 创建入库单: {order_number}, items={len(items)}")
                    
                    result = create_inbound_order(
                        db, tenant_id, user_id,
                        order_number, inbound_type, purchase_order_id,
                        warehouse, handler, inbound_date, notes, items
                    )
                    logger.info(f"[CHAT] 入库单创建结果: {result}")

                    if result.get("success"):
                        final_reply = f"""入库单创建成功！

入库单信息：
- 单号：{result.get('order_number')}
- ID：{result.get('id')}
- 入库类型：{inbound_type}
- 总数量：{result.get('total_quantity', 0)}
- 商品数量：{result.get('items_count', 0)}

入库单已保存为草稿状态，您可以在系统中进一步编辑或确认入库。"""
                    else:
                        final_reply = f"创建入库单失败：{result.get('message', '未知错误')}"

                    save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                    return final_reply

                # 处理日期解析（差评查询）
                if tool_call.function.name == "parse_date_range":
                    args = json.loads(tool_call.function.arguments)
                    # 添加健壮性检查
                    start_date = args.get("start_date")
                    end_date = args.get("end_date")

                    # 如果AI没有正确返回日期，重新调用AI要求明确日期
                    if not start_date or not end_date:
                        logger.warning(f"[CHAT] AI未正确返回日期，重新要求明确日期")
                        # 保存当前消息
                        save_message(db, user_id, session_id, "assistant", assistant_message.content or "", chat_type=chat_type)
                        # 重新发送明确要求
                        clarify_prompt = """请务必调用parse_date_range工具，并明确返回：
- start_date: YYYY-MM-DD格式的开始日期
- end_date: YYYY-MM-DD格式的结束日期
- date_description: 日期描述

请确保正确调用工具，不要用自然语言回复。"""
                        
                        messages.append({"role": "assistant", "content": assistant_message.content or ""})
                        messages.append({"role": "user", "content": clarify_prompt})
                        
                        # 重新调用AI
                        with ai_call_slot():
                            response = client.chat.completions.create(model=settings.OPENAI_MODEL, messages=messages, tools=DATE_PARSING_TOOLS, tool_choice="auto", timeout=180)
                        assistant_message = response.choices[0].message
                        
                        # 检查第二次调用是否有工具响应
                        if assistant_message.tool_calls:
                            for tool_call_2 in assistant_message.tool_calls:
                                if tool_call_2.function.name == "parse_date_range":
                                    args_2 = json.loads(tool_call_2.function.arguments)
                                    start_date = args_2.get("start_date")
                                    end_date = args_2.get("end_date")
                                    break
                    
                    # 如果第二次调用还是没有日期，使用默认日期
                    if not start_date or not end_date:
                        logger.warning(f"[CHAT] AI仍然未正确返回日期，使用默认日期")
                        end_date = datetime.now().strftime("%Y-%m-%d")
                        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
                    
                    logger.info(f"[CHAT] 查询日期: {start_date} ~ {end_date}")
                    reviews = query_negative_reviews(db, tenant_id, start_date, end_date)
                    logger.info(f"[CHAT] 查询到 {len(reviews)} 条差评")

                    # 分离已分析和未分析的差评
                    reviews_for_ai = []
                    unanalyzed_reviews = []
                    for review in reviews:
                        product_name = review.get("product_name", review["asin"])
                        analysis = get_review_analysis(db, review["id"], tenant_id)
                        if analysis:
                            reviews_for_ai.append({
                                "product_name": product_name,
                                "rating": review["rating"],
                                "title": review.get("title", "") or "",
                                "content_preview": review["content"][:150] + ("..." if len(review["content"]) > 150 else ""),
                                "translation_preview": (review.get("translated_content") or "")[:150],
                                "key_issues": analysis["key_points"] if analysis else [],
                                "summary": analysis["summary"] if analysis else ""
                            })
                        else:
                            unanalyzed_reviews.append(review)

                    # 并发分析未分析的差评（最多5条，线程池并发）
                    analyzed_count = 0
                    if unanalyzed_reviews:
                        to_analyze = unanalyzed_reviews[:5]
                        logger.info(f"[CHAT] 并发分析 {len(to_analyze)} 条未分析差评（共 {len(unanalyzed_reviews)} 条未分析）")
                        from concurrent.futures import ThreadPoolExecutor, as_completed
                        analysis_results = {}
                        def _analyze_one(rev):
                            try:
                                return rev["id"], analyze_and_save_single_review(db, rev)
                            except Exception as e:
                                logger.error(f"分析评论{rev['id']}失败: {e}")
                                return rev["id"], None

                        with ThreadPoolExecutor(max_workers=min(5, len(to_analyze))) as executor:
                            futures = {executor.submit(_analyze_one, rev): rev for rev in to_analyze}
                            for future in as_completed(futures):
                                rev_id, result = future.result()
                                analysis_results[rev_id] = result

                        analyzed_count = sum(1 for v in analysis_results.values() if v)
                        # 将分析结果合并到 reviews_for_ai
                        for rev in to_analyze:
                            product_name = rev.get("product_name", rev["asin"])
                            analysis = analysis_results.get(rev["id"])
                            reviews_for_ai.append({
                                "product_name": product_name,
                                "rating": rev["rating"],
                                "title": rev.get("title", "") or "",
                                "content_preview": rev["content"][:150] + ("..." if len(rev["content"]) > 150 else ""),
                                "translation_preview": (rev.get("translated_content") or "")[:150],
                                "key_issues": analysis["key_points"] if analysis else [],
                                "summary": analysis["summary"] if analysis else ""
                            })
                        # 未分析的剩余差评也加入列表（无分析结果）
                        for rev in unanalyzed_reviews[5:]:
                            product_name = rev.get("product_name", rev["asin"])
                            reviews_for_ai.append({
                                "product_name": product_name,
                                "rating": rev["rating"],
                                "title": rev.get("title", "") or "",
                                "content_preview": rev["content"][:150] + ("..." if len(rev["content"]) > 150 else ""),
                                "translation_preview": (rev.get("translated_content") or "")[:150],
                                "key_issues": [],
                                "summary": ""
                            })
                        logger.info(f"[CHAT] 并发分析完成，新分析 {analyzed_count} 条")
                    else:
                        logger.info(f"[CHAT] 全部 {len(reviews_for_ai)} 条差评已有分析结果")

                    logger.info(f"[CHAT] 新分析了 {analyzed_count} 条评论并保存到数据库")
                    logger.debug(f"[AI] 准备发送的数据样例: {json.dumps(reviews_for_ai[:2], ensure_ascii=False)}")

                    # 构建更严格的提示词
                    analysis_prompt = f"""当前日期: {current_date}

你有以下差评数据（共{len(reviews_for_ai)}条）：

{json.dumps(reviews_for_ai, ensure_ascii=False, indent=1)}

【严格规则 - 违反将扣分】：
1. 回复中必须使用"商品名称"字段来指代产品
2. 禁止使用任何数字ID、ASIN编号
3. 正确示例："【Party Bags】质量差，塑料感重"
4. 错误示例："562号产品质量差" 或 "B0XXX质量差"

请基于以上数据进行专业的差评分析，给出改进建议。
"""

                    final_messages = [{"role": "system", "content": analysis_prompt}]
                    final_messages.extend(history)
                    final_messages.append({"role": "user", "content": user_message})

                    with ai_call_slot():
                        final_response = client.chat.completions.create(model=settings.OPENAI_MODEL, messages=final_messages, temperature=0.7, timeout=240)
                    final_reply = final_response.choices[0].message.content or "抱歉，无法处理"
                    
                    save_message(db, user_id, session_id, "assistant", final_reply, chat_type=chat_type)
                    return final_reply
        else:
            reply = assistant_message.content or "请说明想查看的日期范围"
            save_message(db, user_id, session_id, "assistant", reply, chat_type=chat_type)
            return reply

    except Exception as e:
        logger.error(f"[CHAT] 错误: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"处理出错: {str(e)}"


def create_session_id() -> str:
    return str(uuid.uuid4())

