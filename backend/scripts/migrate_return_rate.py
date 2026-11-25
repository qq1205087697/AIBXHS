"""
迁移脚本：inventory_snapshots 新增退货率字段（3/7/14/30/60/90 天）

幂等：列已存在则跳过，可重复执行。
字段策略与 gross_margin（毛利率）完全一致：FLOAT NULL，无默认值，
导入时空值不强制转 0（UPDATE 跳过、INSERT 写 NULL）。

用法：
    cd backend && python scripts/migrate_return_rate.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import engine
from sqlalchemy import text

COLUMNS = [
    ("return_rate_3d", "3天退货率"),
    ("return_rate_7d", "7天退货率"),
    ("return_rate_14d", "14天退货率"),
    ("return_rate_30d", "30天退货率"),
    ("return_rate_60d", "60天退货率"),
    ("return_rate_90d", "90天退货率"),
]


def migrate():
    with engine.connect() as conn:
        for name, comment in COLUMNS:
            exists = conn.execute(
                text(f"SHOW COLUMNS FROM inventory_snapshots LIKE '{name}'")
            ).fetchall()
            if exists:
                print(f"[skip] inventory_snapshots.{name} 已存在: {exists[0][1]}")
                continue
            conn.execute(text(
                f"ALTER TABLE inventory_snapshots "
                f"ADD COLUMN {name} FLOAT NULL COMMENT '{comment}'"
            ))
            conn.commit()
            print(f"[ok]   新增 inventory_snapshots.{name} FLOAT NULL COMMENT '{comment}'")

        # 校验
        print("\n校验结果:")
        cols = conn.execute(text("SHOW COLUMNS FROM inventory_snapshots")).fetchall()
        col_map = {c[0]: c[1] for c in cols}
        missing = [n for n, _ in COLUMNS if n not in col_map]
        for name, _ in COLUMNS:
            print(f"  inventory_snapshots.{name}: {col_map.get(name, 'NOT FOUND')}")
        print(f"表总列数: {len(cols)}")
        if missing:
            raise RuntimeError(f"迁移失败，缺失字段: {missing}")
        print("\n迁移完成。")


if __name__ == "__main__":
    migrate()
