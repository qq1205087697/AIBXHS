#!/usr/bin/env python3
"""
重置管理员密码
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


def reset_password():
    """重置管理员密码"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # 查看现有用户
        cursor.execute("SELECT id, username, email, role FROM users")
        users = cursor.fetchall()
        
        logger.info(f"当前用户数量: {len(users)}")
        for user in users:
            logger.info(f"  - ID: {user['id']}, 用户名: {user['username']}, 邮箱: {user['email']}, 角色: {user['role']}")
        
        # 使用 pbkdf2_sha256 算法
        from passlib.context import CryptContext
        
        pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
        hashed_password = pwd_context.hash("admin123")
        
        # 重置 admin 用户密码
        updated = cursor.execute("""
            UPDATE users 
            SET password_hash = %s 
            WHERE username = 'admin'
        """, (hashed_password,))
        
        if updated > 0:
            logger.info(f"✅ 成功更新 {updated} 条记录")
            logger.info("管理员账号: admin")
            logger.info("新密码: admin123")
            
            # 也重置一下 k 用户（另一个管理员）
            updated2 = cursor.execute("""
                UPDATE users 
                SET password_hash = %s 
                WHERE username = 'k'
            """, (hashed_password,))
            if updated2 > 0:
                logger.info("账号 k 密码也重置为 admin123")
            
            conn.commit()
            logger.info("✅ 密码重置成功！")
        else:
            logger.warning("没有找到 admin 用户")
            
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
    print("  重置管理员密码")
    print("=" * 60)
    print()
    
    reset_password()
    
    print()
    print("=" * 60)
    print("完成！")
    print("=" * 60)
