"""数据库迁移：为 products 和 platform_products 表添加 images 字段（JSON 数组）。

运行方式：在 backend 目录执行 `python migrations/add_product_images_field.py`
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

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
            # 1. products 表添加 images JSON 字段
            cursor.execute("SHOW COLUMNS FROM products LIKE 'images'")
            if cursor.fetchone():
                print("[OK] products.images 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE products ADD COLUMN images JSON NULL "
                    "COMMENT '产品图片URL列表（JSON数组）' AFTER main_image"
                )
                print("[OK] 已添加 products.images 列")

            # 2. platform_products 表添加 images JSON 字段
            cursor.execute("SHOW COLUMNS FROM platform_products LIKE 'images'")
            if cursor.fetchone():
                print("[OK] platform_products.images 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE platform_products ADD COLUMN images JSON NULL "
                    "COMMENT '平台商品图片URL列表（JSON数组）' AFTER image_url"
                )
                print("[OK] 已添加 platform_products.images 列")

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
