"""迁移：product_tags.uk_tag 放开为多值（Q-2 多值存储 / US-6 AC8 前置）

## 背景（为什么必须改）
`product_tags` 现有唯一键 `uk_tag(tenant_id, asin, sku, tag_type)` **每个产品的每种
tag_type 只允许一行**，与以下已冻结口径直接冲突：

1. 《UserStory》Q-2（2026-09-21 用户裁决「多值存储」）与 US-6 AC8：
   「同一产品命中多个节日时**全部命中节日同时写入**」→ 同一 (asin, sku, holiday) 需要多行；
2. 人工锁定粒度 = 「产品 + 节日」（US-6 §5.6.4② / AC8 后半段）；
3. 已实现的服务代码本就是多值形状：
   - `tag_service.set_holiday_tag()` 按 (asin, sku, holiday, **tag_value**) 查行；
   - `tag_service.run_auto_tagging()` 的 `existing_map` 键为 `(asin, tag_value)`，且注释写明
     「Q-2 多值：命中多个节日全部写入」；
   - `load_active_tags()` 把 holidays 收集为 `{asin: [v1, v2, ...]}`；
   - `evaluate_status()` 节日排除 = 命中任一即排除。

**即：DDL 是唯一的阻塞点，且已在无形中制造真实缺陷** —— 同一产品打第二个节日
（手工 `set_holiday_tag` 或自动打标命中第二个节日）会撞 uk_tag 抛 IntegrityError。
《系统设计》§4.2 的该行 uk_tag 定义是相对用户裁决的规格实现疏漏，本迁移按用户裁决落地。

## 变更
- `uk_tag (tenant_id, asin, sku, tag_type)` → `uk_tag (tenant_id, asin, sku, tag_type, tag_value)`
- 属**约束放宽**：不删除、不改写任何既有数据；新旧数据均满足新键。

## 幂等
- 读 `SHOW INDEX` 判定 uk_tag 是否已含 tag_value；已含则跳过。
- 放宽前先做重复性自检（同一 (tenant,asin,sku,tag_type,tag_value) 是否存在多行），
  存在则中止并要求人工处理（本次实测 0 冲突）。

## 回滚
    ALTER TABLE product_tags DROP INDEX uk_tag,
       ADD UNIQUE KEY uk_tag (tenant_id, asin, sku, tag_type);
（回滚前须先按 (tenant,asin,sku,tag_type) 去重，否则会失败。）

运行：cd backend && python scripts/migrate_uk_tag_multivalue.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from config import get_settings  # noqa: E402

NEW_COLUMNS = ["tenant_id", "asin", "sku", "tag_type", "tag_value"]
OLD_COLUMNS = ["tenant_id", "asin", "sku", "tag_type"]


def get_uk_tag_columns(conn, table: str, index_name: str):
    """返回唯一索引的列序（按 Seq_in_index），不存在返回 None"""
    rows = conn.execute(text(
        "SELECT COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i "
        "ORDER BY SEQ_IN_INDEX"
    ), {"t": table, "i": index_name}).all()
    if not rows:
        return None
    return [r[0] for r in rows]


def main():
    settings = get_settings()
    url = settings.DATABASE_URL
    safe = url.split("@")[-1] if "@" in url else url
    print(f"[TARGET DB] {safe}")
    if "--yes" not in sys.argv:
        ans = input("确认对该库执行 uk_tag 放宽迁移？(yes/N) ").strip().lower()
        if ans != "yes":
            print("已取消")
            return 1

    engine = create_engine(url, future=True)
    with engine.begin() as conn:
        cur = get_uk_tag_columns(conn, "product_tags", "uk_tag")
        print(f"[BEFORE] uk_tag 列序 = {cur}")
        if cur is None:
            print("[FAIL] 未找到 uk_tag 索引，请先确认表结构（中止，不擅自创建）")
            return 1
        if cur == NEW_COLUMNS:
            print("[SKIP] uk_tag 已是多值口径，无需迁移")
        elif cur != OLD_COLUMNS:
            print(f"[FAIL] uk_tag 列序既非旧口径也非新口径，人工确认（中止）")
            return 1
        else:
            # 重复性自检：新键下是否已存在重复（决定 ALTER 能否成功）
            dup = conn.execute(text(
                "SELECT tenant_id, asin, sku, tag_type, tag_value, COUNT(*) c FROM product_tags "
                "GROUP BY tenant_id, asin, sku, tag_type, tag_value HAVING c > 1 LIMIT 5"
            )).all()
            if dup:
                print("[FAIL] 新键下存在重复行，请先人工去重：")
                for d in dup:
                    print("   ", tuple(d))
                return 1
            print("[OK] 新键下无重复行，可安全放宽")

            conn.execute(text(
                "ALTER TABLE product_tags DROP INDEX uk_tag, "
                "ADD UNIQUE KEY uk_tag (`tenant_id`,`asin`,`sku`,`tag_type`,`tag_value`) "
                "COMMENT '同产品同类型同值唯一（多值：同产品多节日多行，Q-2）'"
            ))
            print("[DONE] uk_tag 已放宽为多值口径")

        after = get_uk_tag_columns(conn, "product_tags", "uk_tag")
        print(f"[AFTER] uk_tag 列序 = {after}")
        total = conn.execute(text("SELECT COUNT(*) FROM product_tags")).scalar()
        print(f"[CHECK] product_tags 行数 = {total}（约束放宽不应改变行数）")
        if after != NEW_COLUMNS:
            print("[FAIL] 迁移后列序不符合预期")
            return 1

    print("[SUCCESS] migrate_uk_tag_multivalue 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
