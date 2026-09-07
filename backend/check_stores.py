from sqlalchemy import create_engine, text

DB_HOST = 'rm-cn-xr3l4w83m0010v9o.rwlb.rds.aliyuncs.com'
DB_PORT = 3306
DB_NAME = 'cross_border_ai'
DB_USER = 'root'
DB_PASS = 'Qq123456!'

engine = create_engine(f'mysql+pymysql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4')

with engine.connect() as conn:
    result = conn.execute(text("SELECT DISTINCT platform, status FROM stores WHERE platform IS NOT NULL"))
    print('platform, status 分布:')
    for row in result:
        print(f'  platform={repr(row[0])}, status={repr(row[1])}')
    
    result2 = conn.execute(text("SELECT id, shop_abbr, name, platform, status FROM stores WHERE platform != 'amazon' AND platform IS NOT NULL LIMIT 10"))
    print('\n非amazon的店铺示例:')
    for row in result2:
        print(f'  id={row[0]}, shop_abbr={row[1]}, platform={row[3]}')
# from database.database import SessionLocal
# from sqlalchemy import text

# db = SessionLocal()
# r = db.execute(text("SELECT inventory_name, shop_abbr, site FROM stores WHERE inventory_name LIKE '%JeVenis%' LIMIT 5")).fetchall()
# for x in r:
#     print(f"inventory_name={x[0]}, shop_abbr={x[1]}, site={x[2]}")
# print("---")
# r = db.execute(text("SELECT inventory_name, shop_abbr, site FROM stores LIMIT 10")).fetchall()
# for x in r:
#     print(f"inventory_name={x[0]}, shop_abbr={x[1]}, site={x[2]}")
# db.close()
