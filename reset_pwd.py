
#!/usr/bin/env python3
"""重置 test 用户密码"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from sqlalchemy import text
from database.database import SessionLocal
from services.auth_service import get_password_hash


db = SessionLocal()
try:
    print("重置 test 用户密码为 123456...")
    new_hash = get_password_hash("123456")
    
    db.execute(
        text("UPDATE users SET password_hash = :pwd WHERE username = 'test'"),
        {"pwd": new_hash}
    )
    db.commit()
    
    print("\n成功！")
    print("登录: test / 123456")
    
except Exception as e:
    print("错误:", e)
finally:
    db.close()

