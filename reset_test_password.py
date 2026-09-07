
#!/usr/bin/env python3
"""重置 test 用户密码"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from sqlalchemy import text
from database.database import SessionLocal
from services.auth_service import get_password_hash


def main():
    db = SessionLocal()
    try:
        print("正在重置 test 用户密码为: 123456...")
        
        new_hash = get_password_hash("123456")
        
        # 更新 test 用户密码
        result = db.execute(
            text("UPDATE users SET password_hash = :pwd WHERE username = 'test'"),
            {"pwd": new_hash}
        )
        
        db.commit()
        
        if result.rowcount &gt; 0:
            print("\n✅ 密码重置成功！")
            print("=" * 60)
            print("登录账号：")
            print("  用户名: test")
            print("  密码: 123456")
            print("=" * 60)
        else:
            print("❌ 未找到 test 用户")
    
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()

