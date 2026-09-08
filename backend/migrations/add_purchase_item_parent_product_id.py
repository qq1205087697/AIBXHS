
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
            cursor.execute("SHOW COLUMNS FROM purchase_order_items LIKE 'parent_product_id'")
            if cursor.fetchone():
                print("[OK] parent_product_id 列已存在，跳过")
                return

            cursor.execute(
                "ALTER TABLE purchase_order_items ADD COLUMN parent_product_id INT NULL COMMENT '关联成品ID（配件行）'"
            )
            conn.commit()
            print("[OK] 已添加 parent_product_id 列到 purchase_order_items 表")
    except Exception as e:
        print(f"[ERR] 迁移过程出错：{e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
