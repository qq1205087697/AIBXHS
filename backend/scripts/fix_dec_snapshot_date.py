"""一次性修复脚本：把所有 dec 记录的 snapshot_date 更新为对应 snapshot 的 snapshot_date
解决历史遗留：Diff 校验跳过写入导致 dec.snapshot_date 滞留在旧日期
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database.database import SessionLocal

def main():
    db = SessionLocal()
    try:
        # 找出所有 dec.snapshot_date 与对应 snapshot.snapshot_date 不一致的记录
        mismatched = db.execute(text("""
            SELECT d.id, d.snapshot_id, d.snapshot_date AS dec_date, s.snapshot_date AS snap_date
            FROM replenishment_decisions d
            JOIN inventory_snapshots s ON s.id = d.snapshot_id
            WHERE d.snapshot_date != s.snapshot_date
              AND d.deleted_at IS NULL
              AND s.deleted_at IS NULL
            LIMIT 10
        """)).fetchall()
        print(f"不一致记录数（抽样10条）:")
        for r in mismatched:
            print(f"  dec.id={r.id} snapshot_id={r.snapshot_id} dec_date={r.dec_date} snap_date={r.snap_date}")

        # 统计总数
        cnt = db.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM replenishment_decisions d
            JOIN inventory_snapshots s ON s.id = d.snapshot_id
            WHERE d.snapshot_date != s.snapshot_date
              AND d.deleted_at IS NULL
              AND s.deleted_at IS NULL
        """)).fetchone()
        print(f"\n总计需要修复: {cnt.cnt} 条")

        if cnt.cnt == 0:
            print("无需修复")
            return

        # 执行修复
        result = db.execute(text("""
            UPDATE replenishment_decisions d
            JOIN inventory_snapshots s ON s.id = d.snapshot_id
            SET d.snapshot_date = s.snapshot_date
            WHERE d.snapshot_date != s.snapshot_date
              AND d.deleted_at IS NULL
              AND s.deleted_at IS NULL
        """))
        db.commit()
        print(f"\n修复完成: 更新了 {result.rowcount} 条 dec 记录的 snapshot_date")
    finally:
        db.close()

if __name__ == "__main__":
    main()
