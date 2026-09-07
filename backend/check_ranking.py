from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
r = db.execute(text("SELECT COUNT(*) FROM product_page_info WHERE rating_status = 1")).fetchone()
print(f"Rated records count: {r[0]}")
r2 = db.execute(text("SELECT COUNT(*) FROM product_page_info WHERE rating_status = 0")).fetchone()
print(f"Unrated records count: {r2[0]}")
db.close()
