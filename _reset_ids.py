import os
import csv
from datetime import datetime

os.chdir(r'c:\Users\Administrator\Desktop\AI\AIBXHS\backend')
import sys
sys.path.insert(0, r'c:\Users\Administrator\Desktop\AI\AIBXHS\backend')
from database.database import SessionLocal
from sqlalchemy import text

BACKUP_DIR = r'c:\Users\Administrator\Desktop\AI\AIBXHS'
TABLES = ['inventory_snapshots', 'inbound_shipment_details', 'replenishment_decisions']


def backup_table(db, table_name):
    rows = db.execute(text(f"SELECT * FROM {table_name} ORDER BY id")).fetchall()
    columns = rows[0]._fields if rows else []
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filepath = os.path.join(BACKUP_DIR, f"backup_{ts}_{table_name}.csv")
    with open(filepath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        for row in rows:
            writer.writerow(row)
    print(f"  备份 {table_name}: {len(rows)} 行 → {os.path.basename(filepath)}")
    return filepath


def renumber_table(db, table_name, temp_map_name):
    rows = db.execute(text(f"SELECT id FROM {table_name} ORDER BY id")).fetchall()
    if not rows:
        print(f"  {table_name} 无数据，跳过")
        return
    db.execute(text(f"CREATE TEMPORARY TABLE {temp_map_name} (old_id INT PRIMARY KEY, new_id INT)"))
    db.execute(text(f"""
        INSERT INTO {temp_map_name} (old_id, new_id)
        SELECT id, @row := @row + 1
        FROM {table_name}
        CROSS JOIN (SELECT @row := 0) r
        ORDER BY id
    """))
    db.execute(text(f"""
        UPDATE {table_name} d
        JOIN {temp_map_name} m ON d.id = m.old_id
        SET d.id = m.new_id
    """))
    print(f"  {table_name} id 重编号: {len(rows)} 条")


db = SessionLocal()
try:
    # ========== 1. 备份 ==========
    print("=== 1. 备份数据 ===")
    backups = []
    for tbl in TABLES:
        backups.append(backup_table(db, tbl))
    db.commit()

    # ========== 2. 重编号 ==========
    print("\n=== 2. 关闭外键检查 ===")
    db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

    print("\n=== 3. 创建 snapshot ID 映射 ===")
    snap_rows = db.execute(text("SELECT id FROM inventory_snapshots ORDER BY id")).fetchall()
    db.execute(text("CREATE TEMPORARY TABLE _snap_map (old_id INT PRIMARY KEY, new_id INT)"))
    db.execute(text("""
        INSERT INTO _snap_map (old_id, new_id)
        SELECT id, @row := @row + 1
        FROM inventory_snapshots
        CROSS JOIN (SELECT @row := 0) r
        ORDER BY id
    """))

    print("\n=== 4. 更新 FK 引用 ===")
    for tbl in ['inbound_shipment_details', 'replenishment_decisions']:
        r = db.execute(text(f"""
            UPDATE {tbl} d
            JOIN _snap_map m ON d.snapshot_id = m.old_id
            SET d.snapshot_id = m.new_id
        """)).rowcount
        print(f"  {tbl}.snapshot_id 更新: {r} 行")

    print("\n=== 5. 重编号 inventory_snapshots.id ===")
    db.execute(text("""
        UPDATE inventory_snapshots s
        JOIN _snap_map m ON s.id = m.old_id
        SET s.id = m.new_id
    """))
    print(f"  inventory_snapshots.id 重编号: {len(snap_rows)} 条")

    print("\n=== 6. 重编号 inbound_shipment_details.id ===")
    renumber_table(db, 'inbound_shipment_details', '_inbound_map')

    print("\n=== 7. 重编号 replenishment_decisions.id ===")
    renumber_table(db, 'replenishment_decisions', '_replen_map')

    # ========== 8. 重置 AUTO_INCREMENT ==========
    print("\n=== 8. 重置 AUTO_INCREMENT ===")
    for tbl in TABLES:
        max_id = db.execute(text(f"SELECT MAX(id) FROM {tbl}")).scalar() or 0
        db.execute(text(f"ALTER TABLE {tbl} AUTO_INCREMENT = {max_id + 1}"))
        print(f"  {tbl}: AUTO_INCREMENT → {max_id + 1}")

    # ========== 9. 恢复外键检查 ==========
    db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

    db.commit()

    print(f"\n{'='*50}")
    print("全部完成！")
    for b in backups:
        print(f"  备份文件: {os.path.basename(b)}")

except Exception as e:
    db.rollback()
    db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    print(f"\n!!! 执行失败，已回滚: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

finally:
    db.close()