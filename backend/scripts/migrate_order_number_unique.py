"""
迁移脚本：replenishment_orders 增加 (tenant_id, order_number) 唯一索引

背景：自动补货/并发审批下，order_number 仅靠代码侧「时间戳 + 批内去重」保证唯一，
数据库没有约束。两个请求在同一毫秒生成同一单号时会写入重复单号，后续按单号查单
会出现歧义。本索引把唯一性下沉到数据库，代码侧配套 IntegrityError 换号重试。

幂等：索引已存在则跳过；若库里已有重复单号，脚本只报告并中止，不修改任何数据。

用法：
    cd backend && python scripts/migrate_order_number_unique.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import engine
from sqlalchemy import text

TABLE = "replenishment_orders"
INDEX = "uk_replenishment_orders_tenant_number"


def migrate():
    with engine.connect() as conn:
        # 1) 先查重复：有重复时 ALTER 会失败，这里给出清晰报告并中止
        dups = conn.execute(text(
            f"SELECT tenant_id, order_number, COUNT(*) AS c FROM {TABLE} "
            f"GROUP BY tenant_id, order_number HAVING c > 1 LIMIT 20"
        )).fetchall()
        if dups:
            print(f"[abort] {TABLE} 存在重复单号，需先人工处理（未做任何修改）：")
            for tid, num, c in dups:
                print(f"        tenant={tid} order_number={num} count={c}")
            sys.exit(1)

        # 2) 索引是否已存在
        exists = conn.execute(text(f"SHOW INDEX FROM {TABLE} WHERE Key_name = '{INDEX}'")).fetchall()
        if exists:
            print(f"[skip] 唯一索引已存在: {INDEX}")
        else:
            conn.execute(text(
                f"ALTER TABLE {TABLE} ADD UNIQUE KEY {INDEX} (tenant_id, order_number)"
            ))
            conn.commit()
            print(f"[ok]   新增唯一索引 {INDEX} (tenant_id, order_number)")

        # 3) 校验
        rows = conn.execute(text(f"SHOW INDEX FROM {TABLE} WHERE Key_name = '{INDEX}'")).fetchall()
        cols = [r[4] for r in rows]
        if cols != ["tenant_id", "order_number"]:
            print(f"[fail] 索引校验失败，实际列: {cols}")
            sys.exit(1)
        total = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar()
        print(f"[done] 校验通过，{TABLE} 共 {total} 行")


if __name__ == "__main__":
    migrate()
