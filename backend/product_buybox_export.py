# -*- coding: utf-8 -*-
"""
商品购物车（BuyBox）数据读取脚本（独立运行，不依赖项目其他模块）

返回格式与 product_buybox_sync.py 的传参格式一致：
    [['2026-09-07', 'EU-E-208', '带球恐龙蛋糕装饰', 'E欧'], ...]
    每行为 [日期, SKU, 品名, 店铺]

用法（供其他脚本 import 调用）：
    from product_buybox_export import read_buybox

    rows = read_buybox()                          # 全量
    rows = read_buybox(date='2026-09-07')         # 按日期
    rows = read_buybox(store='E欧', status='待处理')  # 组合过滤
    data = read_buybox(as_json=True)              # 返回 JSON 字符串
"""
import os
import sys
import io
import json
from datetime import date as date_cls

if sys.stdout and hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import pymysql
from dotenv import load_dotenv

# 读取 backend/.env 数据库配置
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))


def read_buybox(date=None, sku=None, store=None, status=None, as_json=False):
    """
    读取 product_buybox 表，返回与同步脚本传参一致的列表格式

    参数（全部可选，组合过滤）：
        date   : 日期，如 '2026-09-07'
        sku    : SKU，精确匹配
        store  : 店铺，精确匹配
        status : 状态，精确匹配（如 '待处理'）
        as_json: True 返回 JSON 字符串；False（默认）返回 list[list]

    返回格式：[['日期', 'SKU', '品名', '店铺'], ...]
    """
    sql = """
        SELECT date, sku, product_name, store
        FROM product_buybox
        WHERE deleted_at IS NULL
    """
    conditions, params = [], []
    if date is not None:
        conditions.append('date = %s')
        params.append(date)
    if sku is not None:
        conditions.append('sku = %s')
        params.append(sku)
    if store is not None:
        conditions.append('store = %s')
        params.append(store)
    if status is not None:
        conditions.append('status = %s')
        params.append(status)
    if conditions:
        sql += ' AND ' + ' AND '.join(conditions)
    sql += ' ORDER BY date DESC, id ASC'

    conn = pymysql.connect(
        host=os.getenv('DB_HOST'),
        port=int(os.getenv('DB_PORT', 3306)),
        user=os.getenv('DB_USER'),
        password=os.getenv('DB_PASSWORD'),
        database=os.getenv('DB_NAME'),
        charset='utf8mb4',
    )
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = [
                [
                    r[0].strftime('%Y-%m-%d') if isinstance(r[0], (date_cls,)) else str(r[0]),
                    r[1],
                    r[2],
                    r[3],
                ]
                for r in cur.fetchall()
            ]
    finally:
        conn.close()

    if as_json:
        return json.dumps(rows, ensure_ascii=False, indent=2)
    return rows


if __name__ == '__main__':
    # 直接运行时打印全量 JSON 示例
    print(read_buybox(as_json=True))
