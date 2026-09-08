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
            cursor.execute("SHOW COLUMNS FROM product_selections LIKE 'status'")
            col_info = cursor.fetchone()
            if not col_info:
                cursor.execute(
                    "ALTER TABLE product_selections ADD COLUMN status VARCHAR(50) DEFAULT NULL COMMENT '审批状态: pending(待审批)/approved(已审批)'"
                )
                conn.commit()
                print("[OK] 添加 product_selections.status 字段成功")
            else:
                print("[OK] product_selections.status 字段已存在，无需重复添加")
    except Exception as e:
        print(f"[ERROR] 迁移过程出错：{e}")
        conn.rollback()
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
