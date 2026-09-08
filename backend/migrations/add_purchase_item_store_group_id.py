
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
            cursor.execute("SHOW COLUMNS FROM purchase_order_items LIKE 'store_group_id'")
            if cursor.fetchone():
                print("[OK] store_group_id 列已存在，跳过")
                return

            cursor.execute(
                "ALTER TABLE purchase_order_items ADD COLUMN store_group_id INT NULL COMMENT '店铺分组ID（明细级）' AFTER parent_product_id"
            )
            conn.commit()
            print("[OK] 已添加 store_group_id 列到 purchase_order_items 表")
    except Exception as e:
        print(f"[ERR] 迁移过程出错：{e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
