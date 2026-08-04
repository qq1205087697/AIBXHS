import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

# 1. 查 inventory_snapshots 中 B07WHGXBNB 的所有记录
print("===== inventory_snapshots =====")
rows = db.execute(text("""
    SELECT id, asin, account, country, summary_flag, fba_stock, fba_inbound, local_inventory,
           inspection_qty, total_stock, daily_sales, snapshot_date, deleted_at
    FROM inventory_snapshots
    WHERE asin = 'B07WHGXBNB'
    ORDER BY id
""")).fetchall()
for r in rows:
    print(f"id={r[0]} asin={r[1]} account={r[2][:40] if r[2] else ''} country={r[3][:30] if r[3] else ''} "
          f"sf={r[4]} fba={r[5]} inbound={r[6]} local={r[7]} inspect={r[8]} total={r[9]} "
          f"daily={r[10]} snap_date={r[11]} del={r[12]}")

# 2. 查 replenishment_decisions 中 B07WHGXBNB 的所有记录
print("\n===== replenishment_decisions =====")
rows2 = db.execute(text("""
    SELECT d.id, d.snapshot_id, s.asin, s.country, s.summary_flag, s.account,
           d.daily_sales, d.total_stock, d.future_stock, d.days_of_supply,
           d.suggest_qty, d.risk_level, d.stockout_date, d.snapshot_date, d.deleted_at
    FROM replenishment_decisions d
    JOIN inventory_snapshots s ON d.snapshot_id = s.id
    WHERE s.asin = 'B07WHGXBNB'
    ORDER BY d.snapshot_id
""")).fetchall()
for r in rows2:
    print(f"dec_id={r[0]} snap_id={r[1]} country={r[3][:30] if r[3] else ''} sf={r[4]} "
          f"daily={r[6]} total={r[7]} future={r[8]} dos={r[9]} suggest={r[10]} "
          f"risk={r[11]} stockout={r[12]} snap_date={r[13]} del={r[14]}")

# 3. 检查这些 snapshot_id 是否在 calculate_replenishment 的处理范围内
print("\n===== 最新 snapshot_date =====")
latest = db.execute(text("""
    SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE deleted_at IS NULL
""")).scalar()
print(f"最新 snapshot_date: {latest}")

# 4. 检查 B07WHGXBNB 有快照但无决策的记录
print("\n===== 有快照但无决策 =====")
missing = db.execute(text("""
    SELECT s.id, s.asin, s.country, s.summary_flag, s.account, s.snapshot_date, s.deleted_at
    FROM inventory_snapshots s
    LEFT JOIN replenishment_decisions d ON d.snapshot_id = s.id AND d.deleted_at IS NULL
    WHERE s.asin = 'B07WHGXBNB' AND d.id IS NULL
    ORDER BY s.id
""")).fetchall()
for r in missing:
    print(f"snap_id={r[0]} country={r[2][:30] if r[2] else ''} sf={r[3]} "
          f"account={r[4][:40] if r[4] else ''} snap_date={r[5]} del={r[6]}")

# 5. 检查有快照有决策但被软删除的
print("\n===== 有决策但被软删除 =====")
deleted_dec = db.execute(text("""
    SELECT d.id, d.snapshot_id, s.country, s.summary_flag, d.deleted_at
    FROM replenishment_decisions d
    JOIN inventory_snapshots s ON d.snapshot_id = s.id
    WHERE s.asin = 'B07WHGXBNB' AND d.deleted_at IS NOT NULL
    ORDER BY d.snapshot_id
""")).fetchall()
for r in deleted_dec:
    print(f"dec_id={r[0]} snap_id={r[1]} country={r[2][:30] if r[2] else ''} sf={r[3]} del={r[4]}")

db.close()