"""迁移：product_tags 标签作用域 从「ASIN 级」改为「行级 (asin, account)」

## 背景（用户裁定）
原先 `product_tags` 只有 asin 维度，导致「点一行 → 该 ASIN 全部店铺行一起绑定/解绑」，
而相邻的「停售 / 标记节日」是**行级**（`restock.mark-product-status` 只更新传入的
snapshot_ids 及其共享库存子行）。两个按钮粒度不一致，且 ASIN 级豁免会连带覆盖
其他店铺行的负利润排除 → 可能多补货。用户裁定改为**行级**。

## 变更
1. 新增列 `account VARCHAR(255) NOT NULL DEFAULT ''`
   - 与 `inventory_snapshots.account` 对应（如 `JeVenis-US`；汇总行为多店铺串
     `JeVenis-US、JeVenis-MX`）。
   - **空串 = 通配**：作用于该 ASIN 全部店铺行。存量 4 行标签经 DEFAULT 自动落为 `''`，
     语义与迁移前**完全一致**（迁移不改变现有行为）；自动打标也写 `''`，因为星拓搜索词
     只按 ASIN 归因、无法区分店铺。
2. 唯一键 `uk_tag`：
   `(tenant_id, asin, sku, tag_type, tag_value)` → `(tenant_id, asin, account, tag_type, tag_value)`
   - **移除 sku**：它并非唯一（如 `USA-A-524` 同时出现在 4 个店铺行），且
     `account(255)+sku(500)` 会使 InnoDB 索引键超过 3072 字节上限，建索引会失败。
     sku 列保留，仅作审计留痕。

## 幂等
- `SHOW COLUMNS` 判列是否存在；`information_schema.STATISTICS` 判 uk_tag 列序。
- 改键前做新键重复性自检，存在重复则中止要求人工处理。

## 回滚
    ALTER TABLE product_tags DROP INDEX uk_tag,
      ADD UNIQUE KEY uk_tag (tenant_id, asin, sku, tag_type, tag_value);
    ALTER TABLE product_tags DROP COLUMN account;
（回滚会丢失行级作用域信息：所有行级标签的 account 会被丢弃，退化为通配。）

运行：cd backend && python scripts/migrate_tag_account_scope.py --yes
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from config import get_settings  # noqa: E402

TABLE = "product_tags"
COLUMN = "account"
COLUMN_DDL = (f"ADD COLUMN {COLUMN} VARCHAR(255) NOT NULL DEFAULT '' "
              f"COMMENT '店铺作用域（空串=该 ASIN 全部店铺）' AFTER asin")

NEW_KEY = ["tenant_id", "asin", "account", "tag_type", "tag_value"]
OLD_KEY = ["tenant_id", "asin", "sku", "tag_type", "tag_value"]


def get_index_columns(conn, table: str, index_name: str):
    rows = conn.execute(text(
        "SELECT COLUMN_NAME FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i "
        "ORDER BY SEQ_IN_INDEX"
    ), {"t": table, "i": index_name}).all()
    return [r[0] for r in rows] or None


def column_exists(conn, table: str, column: str) -> bool:
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {"t": table, "c": column}).scalar() > 0


def main():
    settings = get_settings()
    url = settings.DATABASE_URL
    safe = url.split("@")[-1] if "@" in url else url
    print(f"[TARGET DB] {safe}")
    if "--yes" not in sys.argv:
        ans = input("确认执行标签行级作用域迁移？(yes/N) ").strip().lower()
        if ans != "yes":
            print("已取消")
            return 1

    engine = create_engine(url, future=True)
    with engine.begin() as conn:
        rows_before = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar()
        print(f"[BEFORE] {TABLE} 行数 = {rows_before}")

        # ---------- 1. 加列 ----------
        if column_exists(conn, TABLE, COLUMN):
            print(f"[SKIP] 列 {COLUMN} 已存在")
        else:
            conn.execute(text(f"ALTER TABLE {TABLE} {COLUMN_DDL}"))
            print(f"[DONE] 新增列 {COLUMN} VARCHAR(255) NOT NULL DEFAULT ''")

        # ---------- 2. 改唯一键 ----------
        cur = get_index_columns(conn, TABLE, "uk_tag")
        print(f"[INDEX BEFORE] uk_tag = {cur}")
        if cur is None:
            print("[FAIL] 未找到 uk_tag，请先确认表结构（中止）")
            return 1
        if cur == NEW_KEY:
            print("[SKIP] uk_tag 已是行级口径")
        elif cur == OLD_KEY:
            dup = conn.execute(text(
                "SELECT tenant_id, asin, account, tag_type, tag_value, COUNT(*) c "
                f"FROM {TABLE} GROUP BY tenant_id, asin, account, tag_type, tag_value "
                "HAVING c > 1 LIMIT 5"
            )).all()
            if dup:
                print("[FAIL] 新键下存在重复行，请先人工去重：")
                for d in dup:
                    print("   ", tuple(d))
                return 1
            print("[OK] 新键下无重复行，可安全改键")
            conn.execute(text(
                f"ALTER TABLE {TABLE} DROP INDEX uk_tag, "
                "ADD UNIQUE KEY uk_tag (`tenant_id`,`asin`,`account`,`tag_type`,`tag_value`) "
                "COMMENT '同产品同店铺同类型同值唯一（account 空串=该 ASIN 全部店铺）'"
            ))
            print("[DONE] uk_tag 已改为行级口径")
        else:
            print(f"[FAIL] uk_tag 列序既非旧口径也非新口径，人工确认（中止）：{cur}")
            return 1

        after = get_index_columns(conn, TABLE, "uk_tag")
        print(f"[INDEX AFTER] uk_tag = {after}")
        rows_after = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar()
        dist = conn.execute(text(
            f"SELECT account, COUNT(*) FROM {TABLE} GROUP BY account"
        )).all()
        print(f"[AFTER] {TABLE} 行数 = {rows_after}（不应改变）；account 分布 = "
              f"{[tuple(x) for x in dist]}")
        if after != NEW_KEY or rows_after != rows_before:
            print("[FAIL] 迁移后校验不通过")
            return 1

    print("[SUCCESS] migrate_tag_account_scope 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
