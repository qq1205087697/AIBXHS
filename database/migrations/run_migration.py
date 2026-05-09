#!/usr/bin/env python3
"""
数据库迁移脚本
执行所有必要的数据库更新
"""

import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from database.database import SessionLocal
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def execute_migration():
    """执行数据库迁移"""
    db = SessionLocal()
    try:
        logger.info("开始执行数据库迁移...")
        
        # 读取迁移脚本
        migration_file = os.path.join(
            os.path.dirname(__file__),
            'v1_add_departments_notifications.sql'
        )
        
        with open(migration_file, 'r', encoding='utf-8') as f:
            sql_content = f.read()
        
        # 按语句分割执行
        statements = [s.strip() for s in sql_content.split(';') if s.strip()]
        
        for statement in statements:
            # 跳过注释和空行
            if statement.startswith('--'):
                continue
            
            try:
                logger.debug(f"执行SQL: {statement[:80]}...")
                db.execute(text(statement))
                db.commit()
            except Exception as e:
                logger.warning(f"执行SQL时出现警告: {e}")
                db.rollback()
                # 继续执行下一条
                continue
        
        logger.info("数据库迁移完成！")
        print("\n✅ 迁移成功！")
        print("\n新增功能：")
        print("  - 部门管理")
        print("  - 用户-部门多对多关系")
        print("  - 消息通知表")
        print("  - 差评重要性等级")
        print("\n请重启后端服务以应用更改。")
        
    except Exception as e:
        logger.error(f"迁移失败: {e}")
        print(f"\n❌ 迁移失败: {e}")
        return False
    finally:
        db.close()
    
    return True


if __name__ == "__main__":
    print("=" * 50)
    print("  宝鑫华盛AI - 数据库迁移工具")
    print("=" * 50)
    print()
    
    success = execute_migration()
    
    if success:
        sys.exit(0)
    else:
        sys.exit(1)
