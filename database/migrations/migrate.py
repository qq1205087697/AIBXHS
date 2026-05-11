#!/usr/bin/env python3
"""
数据库迁移脚本 - 独立版本
不依赖项目代码，直接使用 pymysql 连接数据库
"""

import os
import sys
import re
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


def column_exists(conn, table, column):
    """检查列是否存在"""
    cursor = conn.cursor()
    try:
        cursor.execute(f"SHOW COLUMNS FROM `{table}` LIKE '{column}'")
        result = cursor.fetchone()
        return result is not None
    finally:
        cursor.close()


def index_exists(conn, table, index_name):
    """检查索引是否存在"""
    cursor = conn.cursor()
    try:
        cursor.execute(f"SHOW INDEX FROM `{table}` WHERE Key_name = '{index_name}'")
        result = cursor.fetchone()
        return result is not None
    finally:
        cursor.close()


def execute_safe_alter(conn):
    """安全地执行 ALTER TABLE 操作"""
    cursor = conn.cursor()
    success_count = 0
    
    try:
        # 1. stores.department_id
        if not column_exists(conn, 'stores', 'department_id'):
            logger.info("添加 stores.department_id 列...")
            cursor.execute("""
                ALTER TABLE `stores` 
                ADD COLUMN `department_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属部门ID'
            """)
            conn.commit()
            logger.info("✅ stores.department_id 已添加")
            success_count += 1
        else:
            logger.info("跳过 stores.department_id (已存在)")
        
        # 2. stores.idx_department_id
        if not index_exists(conn, 'stores', 'idx_department_id'):
            logger.info("添加 stores.idx_department_id 索引...")
            cursor.execute("""
                ALTER TABLE `stores` 
                ADD INDEX `idx_department_id` (`department_id`)
            """)
            conn.commit()
            logger.info("✅ stores.idx_department_id 已添加")
            success_count += 1
        else:
            logger.info("跳过 stores.idx_department_id (已存在)")
        
        # 3. reviews.importance_level
        if not column_exists(conn, 'reviews', 'importance_level'):
            logger.info("添加 reviews.importance_level 列...")
            cursor.execute("""
                ALTER TABLE `reviews` 
                ADD COLUMN `importance_level` VARCHAR(20) DEFAULT NULL COMMENT '重要性等级'
            """)
            conn.commit()
            logger.info("✅ reviews.importance_level 已添加")
            success_count += 1
        else:
            logger.info("跳过 reviews.importance_level (已存在)")
        
        # 4. reviews.idx_importance_level
        if not index_exists(conn, 'reviews', 'idx_importance_level'):
            logger.info("添加 reviews.idx_importance_level 索引...")
            cursor.execute("""
                ALTER TABLE `reviews` 
                ADD INDEX `idx_importance_level` (`importance_level`)
            """)
            conn.commit()
            logger.info("✅ reviews.idx_importance_level 已添加")
            success_count += 1
        else:
            logger.info("跳过 reviews.idx_importance_level (已存在)")
        
        # 5. reviews.return_rate
        if not column_exists(conn, 'reviews', 'return_rate'):
            logger.info("添加 reviews.return_rate 列...")
            cursor.execute("""
                ALTER TABLE `reviews` 
                ADD COLUMN `return_rate` DECIMAL(5, 2) DEFAULT NULL COMMENT '退货率'
            """)
            conn.commit()
            logger.info("✅ reviews.return_rate 已添加")
            success_count += 1
        else:
            logger.info("跳过 reviews.return_rate (已存在)")
            
    except Exception as e:
        logger.error(f"ALTER TABLE 执行失败: {e}")
        conn.rollback()
    
    finally:
        cursor.close()
    
    return success_count


def execute_create_tables(conn):
    """创建表（使用 IF NOT EXISTS）"""
    cursor = conn.cursor()
    success_count = 0
    
    try:
        # 1. departments
        logger.info("创建 departments 表...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `departments` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '部门ID',
                `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
                `name` VARCHAR(100) NOT NULL COMMENT '部门名称',
                `description` VARCHAR(500) DEFAULT NULL COMMENT '部门描述',
                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
                PRIMARY KEY (`id`),
                KEY `idx_tenant_id` (`tenant_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表'
        """)
        conn.commit()
        success_count += 1
        logger.info("✅ departments 表已创建")
        
        # 2. user_departments
        logger.info("创建 user_departments 表...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `user_departments` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '关联ID',
                `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
                `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
                `department_id` BIGINT UNSIGNED NOT NULL COMMENT '部门ID',
                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
                PRIMARY KEY (`id`),
                KEY `idx_user_id` (`user_id`),
                KEY `idx_department_id` (`department_id`),
                UNIQUE KEY `uk_user_dept` (`user_id`, `department_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户部门关联表'
        """)
        conn.commit()
        success_count += 1
        logger.info("✅ user_departments 表已创建")
        
        # 3. notifications
        logger.info("创建 notifications 表...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS `notifications` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知ID',
                `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
                `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
                `type` VARCHAR(50) DEFAULT NULL COMMENT '通知类型',
                `title` VARCHAR(255) NOT NULL COMMENT '标题',
                `content` TEXT DEFAULT NULL COMMENT '内容',
                `link` VARCHAR(255) DEFAULT NULL COMMENT '跳转链接',
                `read_at` DATETIME DEFAULT NULL COMMENT '已读时间',
                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
                PRIMARY KEY (`id`),
                KEY `idx_user_id` (`user_id`),
                KEY `idx_read_at` (`read_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息通知表'
        """)
        conn.commit()
        success_count += 1
        logger.info("✅ notifications 表已创建")
        
    except Exception as e:
        logger.error(f"创建表失败: {e}")
        conn.rollback()
    
    finally:
        cursor.close()
    
    return success_count


def main():
    print("=" * 60)
    print("  宝鑫华盛AI - 数据库迁移工具")
    print("=" * 60)
    print()
    
    # 获取数据库连接
    conn = get_db_connection()
    
    total_success = 0
    
    # 1. 创建表
    logger.info("=" * 50)
    logger.info("阶段1: 创建新表")
    logger.info("=" * 50)
    success = execute_create_tables(conn)
    total_success += success
    
    # 2. 添加列和索引
    logger.info("=" * 50)
    logger.info("阶段2: 添加列和索引")
    logger.info("=" * 50)
    success = execute_safe_alter(conn)
    total_success += success
    
    conn.close()
    
    print()
    print("=" * 50)
    print(f"✅ 迁移完成！成功执行 {total_success} 项更改")
    print()
    print("新增功能：")
    print("  - 部门管理")
    print("  - 用户-部门多对多关系")
    print("  - 消息通知表")
    print("  - 差评重要性等级")
    print("\n请重启后端服务以应用更改。")


if __name__ == "__main__":
    main()
