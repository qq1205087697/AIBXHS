
#!/usr/bin/env python3
"""检查并创建测试用户"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from database.database import SessionLocal, engine
from sqlalchemy import text
from services.auth_service import get_password_hash


def check_users():
    db = SessionLocal()
    try:
        result = db.execute(text("SELECT id, username, email, role, password_hash FROM users"))
        users = result.fetchall()
        
        print("=" * 60)
        print("当前数据库中的用户：")
        print("=" * 60)
        if users:
            for user in users:
                print(f"  ID: {user[0]}, 用户名: {user[1]}, 邮箱: {user[2]}, 角色: {user[3]}")
        else:
            print("  没有用户！")
        
        print("\n" + "=" * 60)
        print("是否创建测试用户？(yes/no)")
        print("=" * 60)
        
        # 自动创建测试用户
        if not users:
            print("\n正在创建测试用户...")
            
            # 首先创建一个租户
            result = db.execute(text("SELECT id FROM tenants LIMIT 1"))
            tenant = result.fetchone()
            
            if not tenant:
                db.execute(text("INSERT INTO tenants (name, code) VALUES ('Default Tenant', 'default')"))
                db.commit()
                result = db.execute(text("SELECT id FROM tenants LIMIT 1"))
                tenant = result.fetchone()
            
            tenant_id = tenant[0]
            
            # 创建管理员用户
            hashed_pwd = get_password_hash("admin123")
            db.execute(text("""
                INSERT INTO users (tenant_id, username, email, password_hash, role, status)
                VALUES (:tenant_id, 'admin', 'admin@example.com', :pwd, 'admin', 'active')
            """), {"tenant_id": tenant_id, "pwd": hashed_pwd})
            
            # 创建普通用户
            hashed_pwd2 = get_password_hash("operator123")
            db.execute(text("""
                INSERT INTO users (tenant_id, username, email, password_hash, role, status)
                VALUES (:tenant_id, 'operator', 'operator@example.com', :pwd, 'operator', 'active')
            """), {"tenant_id": tenant_id, "pwd": hashed_pwd2})
            
            db.commit()
            
            print("\n✅ 测试用户创建成功！")
            print("=" * 60)
            print("测试账号：")
            print("  管理员: admin / admin123")
            print("  普通用户: operator / operator123")
            print("=" * 60)
        else:
            print("\n数据库中已有用户，无需创建。")
            
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    check_users()

