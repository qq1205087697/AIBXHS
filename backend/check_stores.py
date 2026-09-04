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