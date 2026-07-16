import os
os.chdir(r'c:\Users\Administrator\Desktop\AI\AIBXHS\backend')
import sys
sys.path.insert(0, r'c:\Users\Administrator\Desktop\AI\AIBXHS\backend')
from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    c = db.execute(text("SHOW COLUMNS FROM inventory_snapshots LIKE 'gross_margin'")).fetchone()
    if c:
        print(f"列: {c[0]}, 类型: {c[1]}, 可为空: {c[2]}, 默认: {c[4]}, 额外: {c[5]}")
        print("gross_margin 验证通过")
    else:
        print("不存在")
finally:
    db.close()