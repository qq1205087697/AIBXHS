#!/usr/bin/env python3
"""
创建测试数据并手动推送通知
"""
import sys
import os
import datetime

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


def create_test_data():
    """创建测试数据"""
    db = SessionLocal()
    try:
        logger.info("=" * 50)
        logger.info("创建测试数据")
        logger.info("=" * 50)
        
        # 创建测试部门
        dept = db.execute(text("""
            INSERT IGNORE INTO departments (tenant_id, name, description, created_at, updated_at)
            VALUES (1, '测试部门', '这是一个测试部门', NOW(), NOW())
        """))
        db.commit()
        
        # 获取刚创建的部门ID
        result = db.execute(text("SELECT id FROM departments WHERE name = '测试部门'"))
        dept_row = result.fetchone()
        if dept_row:
            dept_id = dept_row[0]
            logger.info(f"测试部门已创建，ID: {dept_id}")
            
            # 关联用户到部门
            db.execute(text("""
                INSERT IGNORE INTO user_departments (tenant_id, user_id, department_id, created_at, updated_at)
                VALUES (1, 1, :dept_id, NOW(), NOW())
            """), {"dept_id": dept_id})
            db.execute(text("""
                INSERT IGNORE INTO user_departments (tenant_id, user_id, department_id, created_at, updated_at)
                VALUES (1, 2, :dept_id, NOW(), NOW())
            """), {"dept_id": dept_id})
            db.commit()
            logger.info("用户已关联到部门")
            
            # 检查是否有未处理差评，如果没有就手动创建一个通知来测试
            # 先查看未处理差评
            has_importance = False
            try:
                check = db.execute(text("SHOW COLUMNS FROM reviews LIKE 'importance_level'"))
                has_importance = check.fetchone() is not None
            except:
                pass
            
            # 手动创建测试通知
            logger.info("\n创建测试通知...")
            
            # 给用户1创建一个测试通知
            db.execute(text("""
                INSERT INTO notifications (tenant_id, user_id, type, title, content, link, created_at, updated_at)
                VALUES (1, 1, 'warning', '【测试通知】差评警告', 
                '这是一条测试通知，通知功能已正常工作！', '/review', NOW(), NOW())
            """))
            
            # 给用户2也创建一个
            db.execute(text("""
                INSERT INTO notifications (tenant_id, user_id, type, title, content, link, created_at, updated_at)
                VALUES (1, 2, 'warning', '【测试通知】差评警告', 
                '这是一条测试通知，通知功能已正常工作！', '/review', NOW(), NOW())
            """))
            
            db.commit()
            logger.info("✅ 测试通知已创建")
            
            # 显示创建的通知
            notifications = db.execute(text("""
                SELECT n.id, u.username, n.title, n.created_at
                FROM notifications n
                JOIN users u ON n.user_id = u.id
                ORDER BY n.created_at DESC
                LIMIT 5
            """))
            
            logger.info("\n最新通知:")
            for n in notifications:
                logger.info(f"  ID: {n[0]}, 用户: {n[1]}, 标题: {n[2]}, 时间: {n[3]}")
        
        logger.info("=" * 50)
        
    except Exception as e:
        logger.error(f"创建失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    create_test_data()
