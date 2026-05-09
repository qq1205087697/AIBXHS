#!/usr/bin/env python3
"""
查看当前 importance_level 数据
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


def check_data():
    """查看数据"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # 查看列信息
        logger.info("=== 列信息 ===")
        cursor.execute("SHOW COLUMNS FROM `reviews` LIKE 'importance_level'")
        col_info = cursor.fetchone()
        logger.info(f"列信息: {col_info}")
        
        # 统计 importance_level 的分布
        logger.info("\n=== importance_level 分布 ===")
        cursor.execute("""
            SELECT `importance_level`, COUNT(*) as count
            FROM `reviews`
            GROUP BY `importance_level`
        """)
        results = cursor.fetchall()
        for row in results:
            logger.info(f"  {row['importance_level'] or 'NULL'}: {row['count']}")
        
        # 查看前10条数据
        logger.info("\n=== 前10条数据 ===")
        cursor.execute("""
            SELECT id, asin, title, importance_level, review_date
            FROM `reviews`
            ORDER BY id DESC
            LIMIT 10
        """)
        rows = cursor.fetchall()
        for row in rows:
            logger.info(f"  ID: {row['id']}, ASIN: {row['asin']}, Importance: {row['importance_level'] or 'NULL'}, Title: {row['title'][:50]}")
        
        # 把所有 importance_level 设为 NULL
        logger.info("\n=== 把所有 importance_level 设为 NULL ===")
        cursor.execute("""
            UPDATE `reviews` 
            SET `importance_level` = NULL
        """)
        updated_count = cursor.rowcount
        conn.commit()
        logger.info(f"已更新 {updated_count} 条记录")
        
    except Exception as e:
        logger.error(f"执行失败: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    print("=" * 60)
    print("  查看并修复 importance_level 数据")
    print("=" * 60)
    print()
    
    check_data()
    
    print()
    print("=" * 60)
    print("✅ 完成！")
    print("=" * 60)
