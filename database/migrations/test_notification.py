#!/usr/bin/env python3
"""
测试通知推送功能
"""
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from database.database import SessionLocal
from sqlalchemy import text
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_current_data():
    """检查当前数据状态"""
    db = SessionLocal()
    try:
        logger.info("=" * 50)
        logger.info("检查当前数据状态")
        logger.info("=" * 50)
        
        # 检查用户
        users = db.execute(text("SELECT id, username, role FROM users"))
        logger.info("\n用户列表:")
        for u in users:
            logger.info(f"  ID: {u[0]}, 用户名: {u[1]}, 角色: {u[2]}")
        
        # 检查部门
        depts = db.execute(text("SELECT id, name FROM departments"))
        logger.info("\n部门列表:")
        for d in depts:
            logger.info(f"  ID: {d[0]}, 名称: {d[1]}")
        
        # 检查用户部门关联
        user_depts = db.execute(text("SELECT user_id, department_id FROM user_departments"))
        logger.info("\n用户-部门关联:")
        for ud in user_depts:
            logger.info(f"  用户: {ud[0]}, 部门: {ud[1]}")
        
        # 检查未处理差评
        has_importance = False
        try:
            check = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
            has_importance = check.fetchone() is not None
        except:
            pass
        
        if has_importance:
            reviews = db.execute(text("""
                SELECT r.id, r.asin, r.importance_level, r.status,
                       s.department_id
                FROM reviews r
                LEFT JOIN stores s ON r.store_id = s.id
                WHERE r.rating <= 3 AND r.status IN ('new', 'read', 'processing')
                LIMIT 10
            """))
        else:
            reviews = db.execute(text("""
                SELECT r.id, r.asin, r.status,
                       s.department_id
                FROM reviews r
                LEFT JOIN stores s ON r.store_id = s.id
                WHERE r.rating <= 3 AND r.status IN ('new', 'read', 'processing')
                LIMIT 10
            """))
        
        logger.info("\n未处理差评 (前10条):")
        for r in reviews:
            if has_importance:
                logger.info(f"  ID: {r[0]}, ASIN: {r[1]}, 重要性: {r[2]}, 状态: {r[3]}, 部门: {r[4]}")
            else:
                logger.info(f"  ID: {r[0]}, ASIN: {r[1]}, 状态: {r[2]}, 部门: {r[3]}")
        
        # 检查现有通知
        notifications = db.execute(text("SELECT * FROM notifications LIMIT 10"))
        logger.info("\n现有通知 (前10条):")
        for n in notifications:
            logger.info(f"  ID: {n[0]}, 用户: {n[2]}, 标题: {n[4]}, 已读: {'是' if n[7] else '否'}")
        
        logger.info("=" * 50)
        
    except Exception as e:
        logger.error(f"检查失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        db.close()


if __name__ == "__main__":
    check_current_data()
