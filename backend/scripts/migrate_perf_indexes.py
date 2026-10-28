"""迁移：读路径性能复合索引（列表 / 概览）

## 背景（为什么需要）
`inventory_snapshots` 只有单列索引（tenant_id、snapshot_date 各自一个）。而列表与概览的
主过滤条件是 `tenant_id + snapshot_date(+deleted_at / summary_flag)` 组合，单列索引在
「同一快照日 4.7 万行」下几乎无选择性 → 实测 `COUNT(*)` 单查询 89ms，列表整查 ~643ms。

## 新增索引
- `idx_snap_tenant_date`          (tenant_id, snapshot_date, deleted_at)
- `idx_snap_tenant_date_summary`  (tenant_id, snapshot_date, summary_flag)

## 幂等
逐个检查 `SHOW INDEX`，已存在则跳过。

## 回滚
    ALTER TABLE inventory_snapshots DROP INDEX idx_snap_tenant_date;
    ALTER TABLE inventory_snapshots DROP INDEX idx_snap_tenant_date_summary;

运行：cd backend && python scripts/migrate_perf_indexes.py --yes
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from config import get_settings  # noqa: E402

INDEXES = [
    ("inventory_snapshots", "idx_snap_tenant_date",
     "(`tenant_id`, `snapshot_date`, `deleted_at`)"),
    ("inventory_snapshots", "idx_snap_tenant_date_summary",
     "(`tenant_id`, `snapshot_date`, `summary_flag`)"),
]


def index_exists(conn, table, name) -> bool:
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
    ), {"t": table, "i": name}).scalar() > 0


def main():
    settings = get_settings()
    url = settings.DATABASE_URL
    print(f"[TARGET DB] {url.split('@')[-1] if '@' in url else url}")
    if "--yes" not in sys.argv:
        ans = input("确认创建性能索引？(yes/N) ").strip().lower()
        if ans != "yes":
            print("已取消")
            return 1

    engine = create_engine(url, future=True)
    with engine.begin() as conn:
        for table, name, cols in INDEXES:
            if index_exists(conn, table, name):
                print(f"[SKIP] {name} 已存在")
                continue
            t0 = time.perf_counter()
            conn.execute(text(f"CREATE INDEX {name} ON {table} {cols}"))
            print(f"[DONE] {table}.{name} {(time.perf_counter() - t0):.1f}s")
        print("\n[VERIFY] inventory_snapshots 索引：")
        rows = conn.execute(text("SHOW INDEX FROM inventory_snapshots")).all()
        agg = {}
        for r in rows:
            agg.setdefault(r[2], []).append((r[3], r[4]))
        for name, cols in sorted(agg.items()):
            print(f"  {name:34s} ({','.join(c for _, c in sorted(cols))})")
    print("[SUCCESS] migrate_perf_indexes 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
