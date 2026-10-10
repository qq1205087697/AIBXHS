# -*- coding: utf-8 -*-
"""
货件通知（Shipment Notice）数据同步脚本（独立运行，不依赖项目其他模块）

用法：
    python product_shipment_notice_sync.py "[['2026-09-08', 'E欧', 'FBA15X8K3Q9U'], ...]"

传参格式：JSON/Python 列表，每行为 [日期, 店铺, 货件编码]

逻辑：
    1. 逐行判断 (store, shipment_code) 是否已存在于 product_shipment_notice 表
       （唯一性只看 店铺+货件编码，与日期无关）
    2. 已存在 → 跳过
    3. 不存在 → 插入，状态 status 固定写入「待处理」
"""
import os
import sys
import io
import ast

if sys.stdout and hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import pymysql
from dotenv import load_dotenv

# 读取 backend/.env 数据库配置
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

DB_HOST = os.getenv('DB_HOST', '115.190.250.14')
DB_PORT = int(os.getenv('DB_PORT', 3306))
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME')

DEFAULT_STATUS = '待处理'


def get_connection():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset='utf8mb4',
    )


def record_exists(cur, store, shipment_code):
    """判断同 店铺+货件编码 的记录是否已存在（未删除）"""
    sql = """
        SELECT COUNT(1) FROM product_shipment_notice
        WHERE store = %s AND shipment_code = %s
          AND deleted_at IS NULL
    """
    cur.execute(sql, (store, shipment_code))
    return cur.fetchone()[0] > 0


def sync(rows):
    if not rows:
        print('传参为空，nothing to sync')
        return

    inserted, skipped = 0, 0
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for idx, row in enumerate(rows, 1):
                if len(row) < 3:
                    print(f'[跳过] 第{idx}行字段不足3个: {row}')
                    skipped += 1
                    continue
                date, store, shipment_code = str(row[0]).strip(), str(row[1]).strip(), str(row[2]).strip()

                if record_exists(cur, store, shipment_code):
                    print(f'[跳过] 已存在: {store} | {shipment_code}')
                    skipped += 1
                    continue

                cur.execute(
                    """
                    INSERT INTO product_shipment_notice (date, store, shipment_code, status)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (date, store, shipment_code, DEFAULT_STATUS),
                )
                print(f'[新增] {date} | {store} | {shipment_code} | {DEFAULT_STATUS}')
                inserted += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(f'\n同步完成：新增 {inserted} 条，跳过 {skipped} 条，共接收 {len(rows)} 行')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python product_shipment_notice_sync.py "[[\'2026-09-08\',\'E欧\',\'FBA15X8K3Q9U\'], ...]"')
        sys.exit(1)

    raw = sys.argv[1]
    try:
        data = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        import json
        data = json.loads(raw)

    if not isinstance(data, list):
        print('传参格式错误：应为 [[日期, 店铺, 货件编码], ...] 列表')
        sys.exit(1)

    sync(data)
