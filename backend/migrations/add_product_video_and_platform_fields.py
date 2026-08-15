"""数据库迁移：为 products 表添加 video_url 字段，为 platform_products 表添加
description、bullet_points、keywords 字段。

运行方式：在 backend 目录执行 `python migrations/add_product_video_and_platform_fields.py`
"""
import sys
import os

# 将 backend 目录添加到 sys.path，使 config 等模块可被导入
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
            # ========== 1. products 表添加 video_url ==========
            cursor.execute("SHOW COLUMNS FROM products LIKE 'video_url'")
            if cursor.fetchone():
                print("[OK] products.video_url 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE products ADD COLUMN video_url VARCHAR(500) NULL "
                    "COMMENT '产品视频URL（火山引擎TOS）' AFTER main_image"
                )
                print("[OK] 已添加 products.video_url 列")

            # ========== 2. platform_products 表添加新字段 ==========
            # description 产品描述
            cursor.execute("SHOW COLUMNS FROM platform_products LIKE 'description'")
            if cursor.fetchone():
                print("[OK] platform_products.description 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE platform_products ADD COLUMN description TEXT NULL "
                    "COMMENT '产品描述' AFTER image_url"
                )
                print("[OK] 已添加 platform_products.description 列")

            # bullet_points 五点描述
            cursor.execute("SHOW COLUMNS FROM platform_products LIKE 'bullet_points'")
            if cursor.fetchone():
                print("[OK] platform_products.bullet_points 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE platform_products ADD COLUMN bullet_points TEXT NULL "
                    "COMMENT '五点描述（换行分隔）' AFTER description"
                )
                print("[OK] 已添加 platform_products.bullet_points 列")

            # keywords 关键词
            cursor.execute("SHOW COLUMNS FROM platform_products LIKE 'keywords'")
            if cursor.fetchone():
                print("[OK] platform_products.keywords 列已存在，跳过")
            else:
                cursor.execute(
                    "ALTER TABLE platform_products ADD COLUMN keywords VARCHAR(1000) NULL "
                    "COMMENT '搜索关键词（逗号或空格分隔）' AFTER bullet_points"
                )
                print("[OK] 已添加 platform_products.keywords 列")

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
