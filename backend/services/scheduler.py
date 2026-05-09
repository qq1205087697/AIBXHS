from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def init_scheduler():
    scheduler.add_job(
        check_inventory_job,
        trigger=IntervalTrigger(hours=1),
        id="inventory_check",
        name="库存检查任务",
        replace_existing=True
    )

    scheduler.add_job(
        check_reviews_job,
        trigger=IntervalTrigger(minutes=30),
        id="reviews_check",
        name="差评监控任务",
        replace_existing=True
    )

    scheduler.add_job(
        send_daily_report_job,
        trigger="cron",
        hour=9,
        minute=0,
        id="daily_report",
        name="每日运营报告",
        replace_existing=True
    )

    scheduler.add_job(
        analyze_unanalyzed_reviews_job,
        trigger="cron",
        hour=7,
        minute=0,
        id="daily_review_analysis",
        name="每日AI分析未分析差评",
        replace_existing=True
    )

    scheduler.add_job(
        push_daily_review_notifications_job,
        trigger="cron",
        hour=10,
        minute=53,
        id="daily_review_notifications",
        name="每日推送未处理差评通知",
        replace_existing=True
    )

    scheduler.start()
    logger.info("定时任务调度器已启动")


def check_inventory_job():
    logger.info("执行库存检查任务...")


def check_reviews_job():
    logger.info("执行差评监控任务...")


def send_daily_report_job():
    logger.info("发送每日运营报告...")


def analyze_unanalyzed_reviews_job():
    """每天早上7点：检测未分析的差评并进行AI分析"""
    from database.database import SessionLocal
    from sqlalchemy import text
    import json

    db = SessionLocal()
    try:
        db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))

        # 查询所有未分析的差评（review_analyses中不存在的差评）
        query = text("""
            SELECT r.id, r.tenant_id, r.title, r.content, r.translated_content,
                   r.rating, r.asin
            FROM reviews r
            LEFT JOIN review_analyses ra ON r.id = ra.review_id
            WHERE r.rating <= 3 AND ra.id IS NULL
            LIMIT 50
        """)
        result = db.execute(query)
        unanalyzed = result.fetchall()

        if not unanalyzed:
            logger.info("没有未分析的差评")
            return

        logger.info(f"发现 {len(unanalyzed)} 条未分析的差评，开始AI分析...")

        from config import get_settings
        settings = get_settings()
        from openai import OpenAI

        if not settings.OPENAI_API_KEY:
            logger.warning("OpenAI API未配置，跳过AI分析")
            return

        client = OpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_API_BASE)

        success_count = 0
        for row in unanalyzed:
            review_id = row[0]
            tenant_id = row[1]
            title = row[2] or ""
            content = row[3] or ""
            translated_content = row[4] or ""
            rating = row[5]
            asin = row[6] or ""

            try:
                if not translated_content:
                    try:
                        from services.translate_service import translate_review
                        _, translated_content = translate_review(title, content)
                        db.execute(text("UPDATE reviews SET translated_content=:tc WHERE id=:rid"),
                                   {"tc": translated_content, "rid": review_id})
                        db.commit()
                    except Exception as te:
                        logger.error(f"翻译失败 review_id={review_id}: {te}")

                prompt = f"""分析差评并进行重要性分级：
商品: {asin}
评分: {rating}星
标题: {title or '无'}
内容: {content}
翻译: {translated_content or '无'}

重要性分级规则：
1. high（最高级）：货不对板、颜色不对、产品不是同一种、规格不符
2. medium（第二级）：质量不好、破损、少件、缺配件、损坏
3. low（第三级）：其他所有场景

输出JSON: {{"sentiment":"负面","sentiment_score":3,"key_points":[],"topics":[],"suggestions":[],"summary":"","importance_level":"high|medium|low"}}"""

                response = client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=[{"role": "system", "content": "你是专业差评分析师，只输出JSON。"}, {"role": "user", "content": prompt}],
                    temperature=0.3
                )

                rc = response.choices[0].message.content.strip()
                if rc.startswith("```"):
                    rc = rc.split("\n", 1)[-1]
                    if rc.endswith("```"):
                        rc = rc[:-3]
                    rc = rc.strip()

                try:
                    ar = json.loads(rc)
                except json.JSONDecodeError:
                    ar = {"sentiment": "negative", "sentiment_score": 3, "key_points": [], "topics": [], "suggestions": [], "summary": rc[:200]}

                # 保存AI分析结果
                db.execute(text("""
                    INSERT INTO review_analyses (tenant_id, review_id, model, sentiment, sentiment_score, key_points, topics, suggestions, summary, raw_response)
                    VALUES (:tid, :rid, :model, :sentiment, :score, :kp, :topics, :sug, :sum, :raw)
                """), {
                    "tid": tenant_id, "rid": review_id, "model": settings.OPENAI_MODEL,
                    "sentiment": ar.get("sentiment", "negative"), "score": ar.get("sentiment_score", 3),
                    "kp": json.dumps(ar.get("key_points", [])), "topics": json.dumps(ar.get("topics", [])),
                    "sug": json.dumps(ar.get("suggestions", [])), "sum": ar.get("summary", ""), "raw": rc
                })
                
                # 更新重要性等级
                importance_level = ar.get("importance_level", "low")
                if importance_level not in ["high", "medium", "low"]:
                    importance_level = "low"
                
                # 先检查importance_level列是否存在
                col_check = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
                if col_check.fetchone():
                    db.execute(text("""
                        UPDATE reviews SET importance_level = :level WHERE id = :rid
                    """), {"level": importance_level, "rid": review_id})
                    logger.info(f"评论 {review_id} 重要性等级: {importance_level}")
                
                db.commit()
                success_count += 1
                logger.info(f"评论 {review_id} AI分析完成")

            except Exception as e:
                logger.error(f"分析评论 {review_id} 失败: {e}")
                db.rollback()

        logger.info(f"每日AI分析完成：成功 {success_count}/{len(unanalyzed)} 条")

    except Exception as e:
        logger.error(f"每日AI分析任务失败: {e}")
    finally:
        db.close()


def push_daily_review_notifications_job():
    """每天早上8点：推送未处理差评通知给对应部门所有人员"""
    from database.database import SessionLocal
    from sqlalchemy import text

    logger.info("========== 开始推送每日差评通知 ==========")
    
    db = SessionLocal()
    try:
        db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))
        logger.info("数据库连接成功")

        # 检查各表是否存在
        has_dept_table = False
        has_user_dept_table = False
        has_notifications_table = False
        has_importance_level = False

        try:
            check = db.execute(text("SHOW TABLES LIKE 'departments'"))
            has_dept_table = check.fetchone() is not None
            logger.info(f"departments 表: {'存在' if has_dept_table else '不存在'}")
        except Exception as e:
            logger.error(f"检查 departments 表失败: {e}")
        
        try:
            check = db.execute(text("SHOW TABLES LIKE 'user_departments'"))
            has_user_dept_table = check.fetchone() is not None
            logger.info(f"user_departments 表: {'存在' if has_user_dept_table else '不存在'}")
        except Exception as e:
            logger.error(f"检查 user_departments 表失败: {e}")
        
        try:
            check = db.execute(text("SHOW TABLES LIKE 'notifications'"))
            has_notifications_table = check.fetchone() is not None
            logger.info(f"notifications 表: {'存在' if has_notifications_table else '不存在'}")
        except Exception as e:
            logger.error(f"检查 notifications 表失败: {e}")
        
        try:
            check_col = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance_level = check_col.fetchone() is not None
            logger.info(f"importance_level 字段: {'存在' if has_importance_level else '不存在'}")
        except Exception as e:
            logger.error(f"检查 importance_level 字段失败: {e}")

        # 检查必须的表是否都存在
        if not has_dept_table or not has_user_dept_table or not has_notifications_table:
            logger.warning("必要表不存在，跳过通知推送")
            logger.warning(f"需要的表: departments={has_dept_table}, user_departments={has_user_dept_table}, notifications={has_notifications_table}")
            return

        # 查询未处理的差评（status为new, read, processing）
        # 只对 high 和 medium 重要级别的差评发送通知
        if has_importance_level:
            logger.info("使用包含 importance_level 的查询")
            pending_query = text("""
                SELECT r.id, r.asin, r.title, r.rating, r.importance_level, r.status,
                       s.department_id, d.name as dept_name
                FROM reviews r
                LEFT JOIN stores s ON r.store_id = s.id
                LEFT JOIN departments d ON s.department_id = d.id
                WHERE r.rating <= 3
                  AND r.status IN ('new', 'read', 'processing')
                  AND s.department_id IS NOT NULL
                  AND r.importance_level IN ('high', 'medium')
            """)
        else:
            logger.info("使用不包含 importance_level 的查询")
            pending_query = text("""
                SELECT r.id, r.asin, r.title, r.rating, r.status,
                       s.department_id, d.name as dept_name
                FROM reviews r
                LEFT JOIN stores s ON r.store_id = s.id
                LEFT JOIN departments d ON s.department_id = d.id
                WHERE r.rating <= 3
                  AND r.status IN ('new', 'read', 'processing')
                  AND s.department_id IS NOT NULL
            """)
        
        logger.info("执行差评查询...")
        pending_reviews = db.execute(pending_query).fetchall()
        logger.info(f"查询到 {len(pending_reviews)} 条符合条件的差评")

        if not pending_reviews:
            logger.info("没有未处理的差评，跳过推送")
            logger.info("========== 推送结束 ==========")
            return

        # 输出前几条差评详情用于调试
        logger.info("差评详情:")
        for i, row in enumerate(pending_reviews[:5]):
            if has_importance_level:
                logger.info(f"  [{i+1}] ID={row[0]}, ASIN={row[1]}, 评分={row[3]}, 重要性={row[4]}, 状态={row[5]}, 部门ID={row[6]}, 部门名={row[7]}")
            else:
                logger.info(f"  [{i+1}] ID={row[0]}, ASIN={row[1]}, 评分={row[3]}, 状态={row[4]}, 部门ID={row[5]}, 部门名={row[6]}")
        if len(pending_reviews) > 5:
            logger.info(f"  ... 还有 {len(pending_reviews) - 5} 条")

        # 按部门分组统计
        dept_stats = {}
        for row in pending_reviews:
            if has_importance_level:
                dept_id = row[6]
                dept_name = row[7] or f"部门{dept_id}"
            else:
                dept_id = row[5]
                dept_name = row[6] or f"部门{dept_id}"
            
            if dept_id not in dept_stats:
                dept_stats[dept_id] = {"name": dept_name, "total": 0, "high": 0, "medium": 0, "low": 0, "review_ids": []}
            dept_stats[dept_id]["total"] += 1
            
            if has_importance_level:
                level = str(row[4]) if row[4] else "medium"
                if level == "high":
                    dept_stats[dept_id]["high"] += 1
                elif level == "medium":
                    dept_stats[dept_id]["medium"] += 1
                else:
                    dept_stats[dept_id]["low"] += 1
            else:
                dept_stats[dept_id]["medium"] += 1
            
            dept_stats[dept_id]["review_ids"].append(str(row[0]))

        logger.info(f"按部门分组完成，共 {len(dept_stats)} 个部门有未处理差评")
        for dept_id, stats in dept_stats.items():
            logger.info(f"  部门 {stats['name']} (ID={dept_id}): 总计={stats['total']}, 严重={stats['high']}, 中等={stats['medium']}, 轻微={stats['low']}")

        # 为每个部门的成员推送通知
        notification_count = 0
        for dept_id, stats in dept_stats.items():
            logger.info(f"处理部门 {stats['name']} (ID={dept_id})...")
            
            members = db.execute(
                text("SELECT user_id FROM user_departments WHERE department_id = :did"),
                {"did": dept_id}
            ).fetchall()
            logger.info(f"  找到 {len(members)} 个部门成员")

            if not members:
                logger.warning(f"  部门 {stats['name']} 没有成员，跳过")
                continue

            title = f"【{stats['name']}】未处理差评提醒"
            content = f"您所在的部门「{stats['name']}」有 {stats['total']} 条未处理差评（严重: {stats['high']}，中等: {stats['medium']}，轻微: {stats['low']}），请及时处理。"
            logger.info(f"  通知标题: {title}")
            logger.info(f"  通知内容: {content}")

            for member in members:
                user_id = member[0]
                logger.info(f"  准备推送给用户 ID={user_id}")
                try:
                    db.execute(text("""
                        INSERT INTO notifications (tenant_id, user_id, type, title, content, link)
                        VALUES (1, :uid, 'warning', :title, :content, '/review')
                    """), {
                        "uid": user_id,
                        "title": title,
                        "content": content
                    })
                    notification_count += 1
                    logger.info(f"  ✅ 成功推送给用户 ID={user_id}")
                except Exception as e:
                    logger.error(f"  ❌ 推送给用户 {user_id} 失败: {e}")

        db.commit()
        logger.info(f"========== 推送完成！共推送 {notification_count} 条通知，覆盖 {len(dept_stats)} 个部门 ==========")

    except Exception as e:
        logger.error(f"每日通知推送任务失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        db.rollback()
    finally:
        db.close()
