"""数据库迁移：修正 products 表图片字段。

- 删除误添加的 image_url 列（如存在）
- 确认 main_image 列存在（产品管理实际使用的图片字段）

运行方式：在 backend 目录执行 `python -m migrations.fix_product_image_field`
"""
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
            # 1. 删除误添加的 image_url 列
            cursor.execute("SHOW COLUMNS FROM products LIKE 'image_url'")
            if cursor.fetchone():
                cursor.execute("ALTER TABLE products DROP COLUMN image_url")
                print("[OK] 已删除 products.image_url 列")
            else:
                print("[OK] products.image_url 列不存在，跳过删除")

            # 2. 确认 main_image 列存在
            cursor.execute("SHOW COLUMNS FROM products LIKE 'main_image'")
            if cursor.fetchone():
                print("[OK] products.main_image 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE products ADD COLUMN main_image VARCHAR(500) NULL "
                    "COMMENT '商品主图' AFTER name_en"
                )
                print("[OK] 已添加 products.main_image 列")

            conn.commit()
            print("\n[完成] 迁移成功")
    except Exception as e:
        print(f"[ERR] 迁移过程出错：{e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
