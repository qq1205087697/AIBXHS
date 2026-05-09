#!/usr/bin/env python3
"""
创建测试用户
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


def check_and_create_user():
    """检查并创建测试用户"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # 先查看现有用户
        cursor.execute("SELECT id, username, email, role FROM users")
        users = cursor.fetchall()
        
        logger.info(f"当前用户数量: {len(users)}")
        for user in users:
            logger.info(f"  - ID: {user['id']}, 用户名: {user['username']}, 邮箱: {user['email']}, 角色: {user['role']}")
        
        # 检查是否有 admin 用户
        has_admin = any(u['role'] == 'admin' for u in users)
        
        if not has_admin:
            logger.info("没有找到管理员用户，正在创建测试用户...")
            
            # 导入 passlib
            from passlib.context import CryptContext
            
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
            hashed_password = pwd_context.hash("admin123")
            
            # 创建管理员用户
            cursor.execute("""
                INSERT INTO users (username, email, hashed_password, role, created_at) 
                VALUES (%s, %s, %s, %s, NOW())
            """, ("admin", "admin@example.com", hashed_password, "admin"))
            
            # 创建普通用户
            cursor.execute("""
                INSERT INTO users (username, email, hashed_password, role, created_at) 
                VALUES (%s, %s, %s, %s, NOW())
            """, ("operator", "operator@example.com", pwd_context.hash("operator123"), "operator"))
            
            conn.commit()
            logger.info("✅ 测试用户创建成功！")
            logger.info("  管理员账号: admin / admin123")
            logger.info("  普通账号: operator / operator123")
        else:
            logger.info("✅ 数据库中已有用户，无需创建")
            logger.info("请使用现有账号登录，或重置密码")
            
    except Exception as e:
        logger.error(f"执行失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        conn.rollback()
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    print("=" * 60)
    print("  检查并创建测试用户")
    print("=" * 60)
    print()
    
    check_and_create_user()
    
    print()
    print("=" * 60)
    print("✅ 完成！")
    print("=" * 60)
