from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
r = db.execute(text("SELECT inventory_name, shop_abbr, site FROM stores WHERE inventory_name LIKE '%JeVenis%' LIMIT 5")).fetchall()
for x in r:
    print(f"inventory_name={x[0]}, shop_abbr={x[1]}, site={x[2]}")
print("---")
r = db.execute(text("SELECT inventory_name, shop_abbr, site FROM stores LIMIT 10")).fetchall()
for x in r:
    print(f"inventory_name={x[0]}, shop_abbr={x[1]}, site={x[2]}")
db.close()
