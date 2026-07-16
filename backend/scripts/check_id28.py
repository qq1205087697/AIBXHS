"""验证 id=28 当前状态"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text, func
from database.database import SessionLocal
from models.restock import InventorySnapshot

def main():
    db = SessionLocal()
    try:
        latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
        print(f"latest: {latest}")

        # 所有父汇总行
        rows = db.execute(text("""
            SELECT id, account, country, summary_flag, snapshot_date, deleted_at, updated_at
            FROM inventory_snapshots
            WHERE asin = 'B07WHGXBNB' AND summary_flag = '是' AND deleted_at IS NULL
            ORDER BY snapshot_date DESC, id
        """)).fetchall()
        print(f"\nB07WHGXBNB 父汇总行 (有效):")
        for r in rows:
            print(f"  id={r.id} date={r.snapshot_date} country={r.country[:50]}... updated={r.updated_at}")

        # 所有记录（含软删除）
        rows2 = db.execute(text("""
            SELECT id, asin, account, country, summary_flag, snapshot_date, deleted_at
            FROM inventory_snapshots
            WHERE asin = 'B07WHGXBNB' AND summary_flag = '是'
            ORDER BY snapshot_date DESC, id
        """)).fetchall()
        print(f"\nB07WHGXBNB 父汇总行 (全部含软删除):")
        for r in rows2:
            print(f"  id={r.id} date={r.snapshot_date} country={r.country[:50]}... deleted={r.deleted_at}")

        # 子行
        children = db.execute(text("""
            SELECT id, account, country, summary_flag, snapshot_date, deleted_at
            FROM inventory_snapshots
            WHERE asin = 'B07WHGXBNB' AND summary_flag = '共享库存' AND deleted_at IS NULL
            ORDER BY id
        """)).fetchall()
        print(f"\nB07WHGXBNB 子行 (有效): {len(children)} 条")
        for c in children:
            print(f"  id={c.id} acct={c.account} country={c.country}")
    finally:
        db.close()

if __name__ == "__main__":
    main()