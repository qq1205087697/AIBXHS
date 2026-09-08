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
            # 1. 先将 status 列从 ENUM 改为 VARCHAR，避免值被截断
            cursor.execute(
                "ALTER TABLE platform_products MODIFY COLUMN status VARCHAR(50) NULL COMMENT '状态（在售 on_sale / 停售 off_sale）'"
            )

            # 2. 将启用状态改为在售
            cursor.execute(
                "UPDATE platform_products SET status = 'on_sale' WHERE status IN ('active', '在售', '启用')"
            )
            on_sale_count = cursor.rowcount

            # 3. 将停用、归档等其他状态改为停售
            cursor.execute(
                "UPDATE platform_products SET status = 'off_sale' WHERE status NOT IN ('on_sale', 'active', '在售', '启用') OR status IS NULL"
            )
            off_sale_count = cursor.rowcount

            conn.commit()
            print(f"[OK] 平台商品状态迁移完成：{on_sale_count} 条改为 on_sale（在售），{off_sale_count} 条改为 off_sale（停售）")
    except Exception as e:
        print(f"[ERR] 迁移过程出错：{e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
