#!/usr/bin/env python3
"""
直接检查数据库
"""
import sys
import os
import pymysql

# 加载环境配置
env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'backend', '.env')
config = {}
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                config[key.strip()] = value.strip()

print("=" * 50)
print("数据库连接信息:")
print(f"  Host: {config.get('DB_HOST', 'localhost')}")
print(f"  Port: {config.get('DB_PORT', '3306')}")
print(f"  User: {config.get('DB_USER', 'root')}")
print(f"  Database: {config.get('DB_NAME', 'baoxinhuasheng')}")
print("=" * 50)

try:
    conn = pymysql.connect(
        host=config.get('DB_HOST', 'localhost'),
        port=int(config.get('DB_PORT', '3306')),
        user=config.get('DB_USER', 'root'),
        password=config.get('DB_PASSWORD', ''),
        database=config.get('DB_NAME', 'baoxinhuasheng'),
        charset='utf8mb4'
    )
    
    cursor = conn.cursor()
    
    print("\n现有表列表:")
    cursor.execute("SHOW TABLES")
    tables = cursor.fetchall()
    for table in tables:
        print(f"  - {table[0]}")
    
    print("\n尝试创建需要的表...")
    
    # 创建 departments 表
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS departments (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                tenant_id BIGINT UNSIGNED NOT NULL,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(500),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at DATETIME,
                PRIMARY KEY (id),
                INDEX idx_tenant_id (tenant_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        print("✅ departments 表已创建")
    except Exception as e:
        print(f"⚠️ departments 表: {e}")
    
    # 创建 user_departments 表
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_departments (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                tenant_id BIGINT UNSIGNED NOT NULL,
                user_id BIGINT UNSIGNED NOT NULL,
                department_id BIGINT UNSIGNED NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at DATETIME,
                PRIMARY KEY (id),
                INDEX idx_user_id (user_id),
                INDEX idx_department_id (department_id),
                UNIQUE KEY uk_user_dept (user_id, department_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        print("✅ user_departments 表已创建")
    except Exception as e:
        print(f"⚠️ user_departments 表: {e}")
    
    # 创建 notifications 表
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                tenant_id BIGINT UNSIGNED NOT NULL,
                user_id BIGINT UNSIGNED NOT NULL,
                type VARCHAR(50),
                title VARCHAR(255) NOT NULL,
                content TEXT,
                link VARCHAR(255),
                read_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                deleted_at DATETIME,
                PRIMARY KEY (id),
                INDEX idx_user_id (user_id),
                INDEX idx_read_at (read_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
        print("✅ notifications 表已创建")
    except Exception as e:
        print(f"⚠️ notifications 表: {e}")
    
    # 确认表是否创建成功
    print("\n表创建完成，当前表列表:")
    cursor.execute("SHOW TABLES")
    tables = cursor.fetchall()
    for table in tables:
        print(f"  - {table[0]}")
    
    # 创建测试数据
    print("\n创建测试数据...")
    
    # 先获取现有用户
    cursor.execute("SELECT id, username FROM users LIMIT 3")
    users = cursor.fetchall()
    print(f"现有用户: {users}")
    
    # 创建测试部门
    cursor.execute("""
        INSERT IGNORE INTO departments (tenant_id, name, description, created_at, updated_at)
        VALUES (1, '测试部门', '这是一个测试部门', NOW(), NOW())
    """)
    
    # 获取部门ID
    cursor.execute("SELECT id FROM departments WHERE name = '测试部门'")
    dept_result = cursor.fetchone()
    if dept_result:
        dept_id = dept_result[0]
        print(f"测试部门ID: {dept_id}")
        
        # 关联用户
        for user in users:
            user_id = user[0]
            cursor.execute("""
                INSERT IGNORE INTO user_departments 
                (tenant_id, user_id, department_id, created_at, updated_at)
                VALUES (1, %s, %s, NOW(), NOW())
            """, (user_id, dept_id))
            print(f"用户 {user_id} 已关联到部门")
        
        # 创建测试通知
        print("\n创建测试通知...")
        for user in users:
            user_id = user[0]
            username = user[1]
            cursor.execute("""
                INSERT INTO notifications 
                (tenant_id, user_id, type, title, content, link, created_at, updated_at)
                VALUES 
                (1, %s, 'warning', '【测试通知】差评警告', 
                '这是一条测试通知，通知功能已正常工作！登录系统查看。', '/review', NOW(), NOW())
            """, (user_id,))
            print(f"已给用户 {username} 创建通知")
        
        # 显示通知
        print("\n创建的通知:")
        cursor.execute("""
            SELECT n.id, u.username, n.title, n.created_at
            FROM notifications n
            JOIN users u ON n.user_id = u.id
            ORDER BY n.created_at DESC
            LIMIT 5
        """)
        notifications = cursor.fetchall()
        for n in notifications:
            print(f"  ID: {n[0]}, 用户: {n[1]}, 标题: {n[2]}, 时间: {n[3]}")
    
    conn.commit()
    
    print("\n" + "=" * 50)
    print("✅ 所有操作完成！现在刷新网页查看通知。")
    print("=" * 50)
    
except Exception as e:
    print(f"错误: {e}")
    import traceback
    traceback.print_exc()
finally:
    if 'cursor' in locals():
        cursor.close()
    if 'conn' in locals():
        conn.close()
