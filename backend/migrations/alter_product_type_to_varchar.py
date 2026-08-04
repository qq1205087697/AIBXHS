
import pymysql
from config import get_settings

def migrate():
    settings = get_settings()
    conn = pymysql.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME
    )
    
    try:
        with conn.cursor() as cursor:
            # 先查看当前表结构
            cursor.execute("SHOW COLUMNS FROM products LIKE 'product_type'")
            col_info = cursor.fetchone()
            print(f"当前product_type字段当前类型: {col_info}")
            
            # 修改字段类型为VARCHAR
            cursor.execute("ALTER TABLE products MODIFY COLUMN product_type VARCHAR(100) DEFAULT NULL COMMENT '产品类型: finished(成品)/accessory(配件)/consumable(耗材)'")
            conn.commit()
            print("✅ 修改product_type字段为VARCHAR类型成功")
    except Exception as e:
        print(f"⚠️ 迁移过程出错：{e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
