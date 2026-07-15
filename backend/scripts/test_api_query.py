#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.database import SessionLocal
from services.inventory_service import search_inventory, get_inventory_overview

db = SessionLocal()
try:
    print("=== 测试 search_inventory ===")
    result = search_inventory(db, page=1, page_size=5, user_id=1, user_role="admin")
    print(f"total: {result.get('total')}")
    print(f"page: {result.get('page')}")
    items = result.get("items", [])
    print(f"items count: {len(items)}")
    for item in items[:3]:
        print(f"  asin={item.get('asin')}, name={str(item.get('product_name',''))[:30]}, is_holiday={item.get('is_holiday')}")

    print("\n=== 测试 get_inventory_overview ===")
    overview = get_inventory_overview(db, user_id=1, user_role="admin")
    print(f"total_sku: {overview.get('total_sku')}")
    print(f"red_count: {overview.get('red_count')}")
    print(f"yellow_count: {overview.get('yellow_count')}")
    print(f"green_count: {overview.get('green_count')}")
    print(f"snapshot_date: {overview.get('snapshot_date')}")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
