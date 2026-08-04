#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.database import SessionLocal
from services.inventory_service import search_inventory, get_inventory_overview, get_stockout_top10, get_overstock_top10

db = SessionLocal()
try:
    # 测试 overview
    print("=== 测试 get_inventory_overview ===")
    t0 = time.time()
    overview = get_inventory_overview(db, user_id=1, user_role="admin")
    t1 = time.time()
    print(f"耗时: {t1-t0:.3f}s")
    print(f"total_sku: {overview.get('total_sku')}")
    print(f"red/yellow/green: {overview.get('red_count')}/{overview.get('yellow_count')}/{overview.get('green_count')}")
    print(f"snapshot_date: {overview.get('snapshot_date')}")
    stockout = overview.get('stockout_top10', [])
    print(f"stockout_top10 count: {len(stockout)}")
    if stockout:
        print(f"  第一条字段: {list(stockout[0].keys())}")
        print(f"  第一条asin: {stockout[0].get('asin')}, total_stock: {stockout[0].get('total_stock')}")
    overstock = overview.get('overstock_top10', [])
    print(f"overstock_top10 count: {len(overstock)}")

    # 测试 search
    print("\n=== 测试 search_inventory ===")
    t0 = time.time()
    result = search_inventory(db, page=1, page_size=5, user_id=1, user_role="admin")
    t1 = time.time()
    print(f"耗时: {t1-t0:.3f}s")
    print(f"total: {result.get('total')}")
    items = result.get("items", [])
    print(f"items count: {len(items)}")
    if items:
        print(f"  第一条字段: {list(items[0].keys())}")
        print(f"  第一条asin: {items[0].get('asin')}, is_holiday: {items[0].get('is_holiday')}")

    # 测试带风险筛选的 search
    print("\n=== 测试 search_inventory (risk_level=red) ===")
    t0 = time.time()
    result2 = search_inventory(db, page=1, page_size=5, risk_level=["red"], user_id=1, user_role="admin")
    t1 = time.time()
    print(f"耗时: {t1-t0:.3f}s")
    print(f"total: {result2.get('total')}")

    # 测试 stockout_top10
    print("\n=== 测试 get_stockout_top10 ===")
    t0 = time.time()
    stockout_list = get_stockout_top10(db, user_id=1, user_role="admin")
    t1 = time.time()
    print(f"耗时: {t1-t0:.3f}s")
    print(f"count: {len(stockout_list)}")
    if stockout_list:
        print(f"  第一条字段: {list(stockout_list[0].keys())}")
        print(f"  第一条asin: {stockout_list[0].get('asin')}, suggest_qty: {stockout_list[0].get('suggest_qty')}")

    print("\n=== 全部测试通过 ===")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
