"""
迁移脚本：将 is_holiday 从 Boolean 改为 VARCHAR(20)，新增 is_discontinued 字段
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database.database import engine
from sqlalchemy import text

def migrate():
    with engine.connect() as conn:
        # 1. inventory_snapshots 表
        # 1a. 数据迁移：先转换现有 Boolean 值为字符串
        print("迁移 inventory_snapshots.is_holiday 数据...")
        conn.execute(text("UPDATE inventory_snapshots SET is_holiday = '1' WHERE is_holiday = TRUE"))
        conn.execute(text("UPDATE inventory_snapshots SET is_holiday = '0' WHERE is_holiday = FALSE OR is_holiday IS NULL"))
        conn.commit()

        # 1b. 修改列类型为 VARCHAR(20)
        print("修改 inventory_snapshots.is_holiday 列类型为 VARCHAR(20)...")
        conn.execute(text("ALTER TABLE inventory_snapshots MODIFY COLUMN is_holiday VARCHAR(20) DEFAULT '' COMMENT '节日类型'"))
        conn.commit()

        # 1c. 数据迁移：'1' → '其他'，'0' → ''
        print("转换 inventory_snapshots.is_holiday 值...")
        conn.execute(text("UPDATE inventory_snapshots SET is_holiday = '其他' WHERE is_holiday = '1'"))
        conn.execute(text("UPDATE inventory_snapshots SET is_holiday = '' WHERE is_holiday = '0' OR is_holiday IS NULL"))
        conn.commit()

        # 1d. 新增 is_discontinued 列
        print("新增 inventory_snapshots.is_discontinued 列...")
        try:
            conn.execute(text("ALTER TABLE inventory_snapshots ADD COLUMN is_discontinued BOOLEAN DEFAULT FALSE COMMENT '停售产品标记'"))
            conn.commit()
        except Exception:
            pass  # 列已存在

        # 2. replenishment_decisions 表
        # 2a. 如果有 is_holiday 列（旧），先迁移数据
        print("检查 replenishment_decisions.is_holiday...")
        cols = conn.execute(text("SHOW COLUMNS FROM replenishment_decisions LIKE 'is_holiday'")).fetchall()
        if cols:
            col_type = cols[0][1]
            if 'tinyint' in col_type.lower() or 'int' in col_type.lower() or 'bool' in col_type.lower():
                # 旧 Boolean 类型，先迁移数据
                conn.execute(text("UPDATE replenishment_decisions SET is_holiday = '1' WHERE is_holiday = TRUE"))
                conn.execute(text("UPDATE replenishment_decisions SET is_holiday = '0' WHERE is_holiday = FALSE OR is_holiday IS NULL"))
                conn.commit()
                print("修改 replenishment_decisions.is_holiday 列类型为 VARCHAR(20)...")
                conn.execute(text("ALTER TABLE replenishment_decisions MODIFY COLUMN is_holiday VARCHAR(20) DEFAULT '' COMMENT '节日类型'"))
                conn.commit()
                conn.execute(text("UPDATE replenishment_decisions SET is_holiday = '其他' WHERE is_holiday = '1'"))
                conn.execute(text("UPDATE replenishment_decisions SET is_holiday = '' WHERE is_holiday = '0' OR is_holiday IS NULL"))
                conn.commit()
        else:
            # 没有 is_holiday 列，新增
            print("新增 replenishment_decisions.is_holiday 列...")
            conn.execute(text("ALTER TABLE replenishment_decisions ADD COLUMN is_holiday VARCHAR(20) DEFAULT '' COMMENT '节日类型'"))
            conn.commit()

        # 2b. 新增 is_discontinued
        print("新增 replenishment_decisions.is_discontinued 列...")
        try:
            conn.execute(text("ALTER TABLE replenishment_decisions ADD COLUMN is_discontinued BOOLEAN DEFAULT FALSE COMMENT '停售产品标记'"))
            conn.commit()
        except Exception:
            pass  # 列已存在

        print("迁移完成！")

        # 验证
        snap_cols = conn.execute(text("SHOW COLUMNS FROM inventory_snapshots LIKE 'is_holiday'")).fetchone()
        disc_cols = conn.execute(text("SHOW COLUMNS FROM inventory_snapshots LIKE 'is_discontinued'")).fetchone()
        dec_cols = conn.execute(text("SHOW COLUMNS FROM replenishment_decisions LIKE 'is_holiday'")).fetchone()
        dec_disc = conn.execute(text("SHOW COLUMNS FROM replenishment_decisions LIKE 'is_discontinued'")).fetchone()
        print(f"inventory_snapshots.is_holiday: {snap_cols[1] if snap_cols else 'NOT FOUND'}")
        print(f"inventory_snapshots.is_discontinued: {disc_cols[1] if disc_cols else 'NOT FOUND'}")
        print(f"replenishment_decisions.is_holiday: {dec_cols[1] if dec_cols else 'NOT FOUND'}")
        print(f"replenishment_decisions.is_discontinued: {dec_disc[1] if dec_disc else 'NOT FOUND'}")

if __name__ == "__main__":
    migrate()
