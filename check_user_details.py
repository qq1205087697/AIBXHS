
#!/usr/bin/env python3
"""查看用户详情"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from sqlalchemy import text
from database.database import SessionLocal


def main():
    db = SessionLocal()
    try:
        # 查看用户详情
        result = db.execute(text("SELECT id, username, email, role, status FROM users LIMIT 10"))
        users = result.fetchall()
        
        print("=" * 80)
        print("用户详情（前10个）：")
        print("=" * 80)
        for u in users:
            print(f"  ID: {u[0]}, 用户名: {u[1]}, 邮箱: {u[2]}, 角色: {u[3]}, 状态: {u[4]}")
        
        # 检查是否有 admin 或 test 用户
        print("\n" + "=" * 80)
        print("查找常见测试账号：")
        print("=" * 80)
        test_names = ['admin', 'test', 'kayn']
        for name in test_names:
            result = db.execute(text("SELECT id, username, role FROM users WHERE username = :name"), {"name": name})
            user = result.fetchone()
            if user:
                print(f"  找到用户: {user[1]} (角色: {user[2]})")
    
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()

