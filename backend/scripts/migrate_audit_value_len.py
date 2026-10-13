"""迁移：tag_audit_logs.old_value / new_value 列宽放开 20 → 200

## 背景（为什么必须改）
G7 词库编辑接口的端到端验证抓到真实缺陷：
`tag_audit_logs.old_value` / `new_value` 当前为 `VARCHAR(20)`，而词库维度的审计值写入
格式是 `「节日:关键词」`：

- `routers/tags.py::create_lexicon_entry` → `new_value = f"{holiday_name}:{keyword}"`
- `routers/tags.py::update_lexicon_entry` → `old_value`/`new_value` 同格式

关键词列宽为 100 字符（`keyword[:100]`）→ 审计值最长 = 6（节日名，如「感恩节黑五」）+
1（冒号）+ 100 = **107 字符**。实测 21 字符即触发：
    pymysql.err.DataError: (1406, "Data too long for column 'new_value' at row 1")

**影响面**：任何关键词长度超过 ~14 字符的词库**新增或修改**操作，都会在 commit 阶段
抛 1406，被 FastAPI 转成 500 —— 即「词库功能对长关键词整体不可用」。属 P1 缺陷。

## 变更
- `old_value` VARCHAR(20) → VARCHAR(200)
- `new_value` VARCHAR(20) → VARCHAR(200)
- 与同表 `reason` 列宽（String(200)）对齐。

属**纯放宽**：宽列写入短值永远合法，不删除、不改写任何既有数据。
配套 `tag_service.write_audit()` 增加 `_clip(v, 200)` 防御性截断 —— 宁可审计值被截断，
也不让业务写操作整体 500。

## 幂等
- 读 `information_schema.COLUMNS.CHARACTER_MAXIMUM_LENGTH`；已是 200 则跳过。

## 回滚
    ALTER TABLE tag_audit_logs
      MODIFY COLUMN old_value VARCHAR(20) NULL COMMENT '变更前值',
      MODIFY COLUMN new_value VARCHAR(20) NULL COMMENT '变更后值';
（回滚前须确保无超过 20 字符的历史值，否则会截断。）

运行：cd backend && python scripts/migrate_audit_value_len.py --yes
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from config import get_settings  # noqa: E402

TABLE = "tag_audit_logs"
COLUMNS = ["old_value", "new_value"]
TARGET_LEN = 200
OLD_LEN = 20


def get_col_len(conn, table: str, column: str):
    row = conn.execute(text(
        "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {"t": table, "c": column}).first()
    return None if row is None else row[0]


def main():
    settings = get_settings()
    url = settings.DATABASE_URL
    safe = url.split("@")[-1] if "@" in url else url
    print(f"[TARGET DB] {safe}")
    if "--yes" not in sys.argv:
        ans = input("确认对该库执行 tag_audit_logs 列宽放开迁移？(yes/N) ").strip().lower()
        if ans != "yes":
            print("已取消")
            return 1

    engine = create_engine(url, future=True)
    with engine.begin() as conn:
        before = {c: get_col_len(conn, TABLE, c) for c in COLUMNS}
        print(f"[BEFORE] 列宽 = {before}")
        missing = [c for c, v in before.items() if v is None]
        if missing:
            print(f"[FAIL] 未找到列 {missing}，请先确认表结构（中止）")
            return 1

        if all(v == TARGET_LEN for v in before.values()):
            print(f"[SKIP] 列宽已是 {TARGET_LEN}，无需迁移")
        elif all(v == OLD_LEN for v in before.values()):
            total = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar()
            print(f"[INFO] 迁移前 {TABLE} 行数 = {total}（放宽列宽不改变行数）")
            conn.execute(text(
                f"ALTER TABLE {TABLE} "
                f"MODIFY COLUMN old_value VARCHAR({TARGET_LEN}) NULL COMMENT '变更前值（词库维度为「节日:关键词」，最长 107）', "
                f"MODIFY COLUMN new_value VARCHAR({TARGET_LEN}) NULL COMMENT '变更后值（词库维度为「节日:关键词」，最长 107）'"
            ))
            print(f"[DONE] old_value / new_value 已放开为 VARCHAR({TARGET_LEN})")
        else:
            print(f"[FAIL] 列宽既非 {OLD_LEN} 也非 {TARGET_LEN}，人工确认（中止）")
            return 1

        after = {c: get_col_len(conn, TABLE, c) for c in COLUMNS}
        print(f"[AFTER] 列宽 = {after}")
        total = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar()
        print(f"[CHECK] {TABLE} 行数 = {total}")
        if not all(v == TARGET_LEN for v in after.values()):
            print("[FAIL] 迁移后列宽不符合预期")
            return 1

        maxlen = conn.execute(text(
            f"SELECT MAX(CHAR_LENGTH(old_value)), MAX(CHAR_LENGTH(new_value)) FROM {TABLE}"
        )).first()
        print(f"[CHECK] 历史数据最长 old={maxlen[0]} new={maxlen[1]}（均 <= {TARGET_LEN}，无截断）")

    print("[SUCCESS] migrate_audit_value_len 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
