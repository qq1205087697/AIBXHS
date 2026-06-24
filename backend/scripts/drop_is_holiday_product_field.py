"""删除数据库中多余字段 is_holiday_product（保留 is_holiday）"""
import os, sys, json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import engine


def drop_column_if_exists(table_name: str, column_name: str):
    with engine.connect() as conn:
        # 检查字段是否存在
        from sqlalchemy import text
        result = conn.execute(
            text(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :tn AND COLUMN_NAME = :cn"
            ),
            {"tn": table_name, "cn": column_name}
        )
        exists = result.scalar()

        if exists:
            conn.execute(text(f"ALTER TABLE {table_name} DROP COLUMN `{column_name}`"))
            conn.commit()
            print(f"已删除字段: {table_name}.{column_name}")
        else:
            print(f"字段不存在，跳过: {table_name}.{column_name}")


if __name__ == "__main__":
    print("开始清理多余字段 is_holiday_product...")
    drop_column_if_exists("inventory_snapshots", "is_holiday_product")
    drop_column_if_exists("replenishment_decisions", "is_holiday_product")
    print("清理完成！")
