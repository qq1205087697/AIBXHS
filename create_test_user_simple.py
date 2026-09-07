
#!/usr/bin/env python3
"""简单创建测试用户"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from sqlalchemy import text
from database.database import SessionLocal


def main():
    db = SessionLocal()
    try:
        print("正在连接数据库...")
        
        # 检查用户表
        result = db.execute(text("SELECT id, username FROM users"))
        users = result.fetchall()
        
        print(f"当前有 {len(users)} 个用户")
        
        if users:
            print("现有用户:")
            for u in users:
                print(f"  - {u[1]}")
        else:
            print("没有用户，正在创建...")
            
            # 先创建租户
            result = db.execute(text("SELECT id FROM tenants LIMIT 1"))
            tenant = result.fetchone()
            
            if not tenant:
                print("创建默认租户...")
                db.execute(text("INSERT INTO tenants (name, code) VALUES ('Default Tenant', 'default')"))
                db.commit()
                result = db.execute(text("SELECT id FROM tenants LIMIT 1"))
                tenant = result.fetchone()
            
            tenant_id = tenant[0]
            
            # 导入密码哈希函数
            from services.auth_service import get_password_hash
            
            # 创建管理员
            pwd_admin = get_password_hash("admin123")
            db.execute(text("""
                INSERT INTO users (tenant_id, username, email, password_hash, role, status)
                VALUES (:tid, 'admin', 'admin@example.com', :pwd, 'admin', 'active')
            """), {"tid": tenant_id, "pwd": pwd_admin})
            
            # 创建普通用户
            pwd_op = get_password_hash("operator123")
            db.execute(text("""
                INSERT INTO users (tenant_id, username, email, password_hash, role, status)
                VALUES (:tid, 'operator', 'operator@example.com', :pwd, 'operator', 'active')
            """), {"tid": tenant_id, "pwd": pwd_op})
            
            db.commit()
            
            print("\n✅ 测试用户创建成功！")
            print("=" * 60)
            print("测试账号：")
            print("  管理员: admin / admin123")
            print("  普通用户: operator / operator123")
            print("=" * 60)
    
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()

