#!/usr/bin/env python3
"""
修复 importance_level 字段的默认值问题
把所有 'medium' 改为 NULL
"""

import os
import sys
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_env():
    """加载 .env 配置"""
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'backend', '.env')
    
    if not os.path.exists(env_path):
        logger.error(f"找不到 .env 文件: {env_path}")
        return {}
    
    config = {}
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                config[key.strip()] = value.strip()
    
    return config


def get_db_connection():
    """创建数据库连接"""
    import pymysql
    
    config = load_env()
    
    try:
        conn = pymysql.connect(
            host=config.get('DB_HOST', 'localhost'),
            port=int(config.get('DB_PORT', 3306)),
            user=config.get('DB_USER', 'root'),
            password=config.get('DB_PASSWORD', ''),
            database=config.get('DB_NAME', 'bxhs_ai_assistance'),
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor
        )
        logger.info("数据库连接成功！")
        return conn
    except Exception as e:
        logger.error(f"数据库连接失败: {e}")
        sys.exit(1)


def fix_importance_default():
    """修复 importance_level 字段"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # 1. 检查列是否存在
        cursor.execute("SHOW COLUMNS FROM `reviews` LIKE 'importance_level'")
        col_info = cursor.fetchone()
        
        if not col_info:
            logger.info("importance_level 列不存在，无需修复")
            return
        
        # 2. 查看当前默认值
        logger.info(f"当前列信息: {col_info}")
        
        # 3. 更新默认值
        logger.info("正在修改列默认值...")
        cursor.execute("""
            ALTER TABLE `reviews` 
            MODIFY COLUMN `importance_level` VARCHAR(20) DEFAULT NULL COMMENT '重要性等级'
        """)
        conn.commit()
        logger.info("✅ 默认值已修改为 NULL")
        
        # 4. 把现有的 'medium' 值改为 NULL
        cursor.execute("""
            UPDATE `reviews` 
            SET `importance_level` = NULL 
            WHERE `importance_level` = 'medium'
        """)
        updated_count = cursor.rowcount
        conn.commit()
        logger.info(f"✅ 已更新 {updated_count} 条记录")
        
    except Exception as e:
        logger.error(f"执行失败: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    print("=" * 60)
    print("  修复 importance_level 默认值")
    print("=" * 60)
    print()
    
    fix_importance_default()
    
    print()
    print("=" * 60)
    print("✅ 修复完成！")
    print("=" * 60)
