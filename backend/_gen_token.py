"""生成 JWT token 用于 HTTP 端点测试"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database.database import SessionLocal
from sqlalchemy import text
from services.auth_service import create_access_token

db = SessionLocal()
try:
    row = db.execute(text("SELECT id, username, tenant_id FROM users ORDER BY id LIMIT 1")).fetchone()
    if not row:
        print("ERR: 没有用户")
        sys.exit(1)
    user_id, username, tenant_id = row[0], row[1], row[2]
    token = create_access_token(data={"sub": username, "uid": user_id, "tid": tenant_id})
    print(token)
finally:
    db.close()
