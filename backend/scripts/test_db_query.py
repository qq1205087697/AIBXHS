#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.database import engine, SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    # 测试数据库连接
    result = db.execute(text("SELECT 1")).fetchone()
    print("DB连接: OK")

    # 检查 inventory_snapshots 表是否有数据
    count = db.execute(text(
        "SELECT COUNT(*) FROM inventory_snapshots WHERE deleted_at IS NULL"
    )).scalar()
    print(f"inventory_snapshots 记录数: {count}")

    # 检查最新快照日期
    latest = db.execute(text(
        "SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE deleted_at IS NULL"
    )).scalar()
    print(f"最新快照日期: {latest}")

    # 检查 is_holiday 字段是否存在
    col = db.execute(text(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = 'inventory_snapshots' AND COLUMN_NAME = 'is_holiday'"
    )).fetchall()
    print(f"is_holiday 字段存在: {len(col) > 0}")

    # 检查 replenishment_decisions 表
    rd_count = db.execute(text(
        "SELECT COUNT(*) FROM replenishment_decisions WHERE deleted_at IS NULL"
    )).scalar()
    print(f"replenishment_decisions 记录数: {rd_count}")

    # 测试搜索查询（模拟 search_inventory 的核心逻辑）
    result = db.execute(text(
        "SELECT id, asin, product_name, is_holiday, summary_flag "
        "FROM inventory_snapshots "
        "WHERE deleted_at IS NULL "
        "ORDER BY snapshot_date DESC LIMIT 5"
    )).fetchall()
    print(f"\n最近5条记录:")
    for r in result:
        name = r[2][:30] if r[2] else ""
        print(f"  id={r[0]}, asin={r[1]}, name={name}, is_holiday={r[3]}, summary={r[4]}")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
