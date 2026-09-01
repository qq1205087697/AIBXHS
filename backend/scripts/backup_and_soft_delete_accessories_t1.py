# -*- coding: utf-8 -*-
"""备份并软删除 tenant=1 的所有配件及其绑定关系

- 第1步：将涉及的配件与绑定关系完整导出为 JSON + SQL 备份文件
- 第2步：将 products.deleted_at 置为当前时间（软删除配件）
- 第3步：将 product_bindings.deleted_at 置为当前时间（软删除绑定关系）

所有操作在同一事务中执行，任一步失败则整体回滚。
"""
import sys, os, json, io
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import get_settings
from datetime import datetime
import pymysql

TENANT_ID = 1
BACKUP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "accessory_backup")
os.makedirs(BACKUP_DIR, exist_ok=True)
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")

settings = get_settings()
conn = pymysql.connect(
    host=settings.DB_HOST,
    port=settings.DB_PORT,
    user=settings.DB_USER,
    password=settings.DB_PASSWORD,
    database=settings.DB_NAME,
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=False,
)

def log(msg):
    print(msg, flush=True)

def main():
    try:
        with conn.cursor() as cur:
            # ---------- 备份配件（SELECT * 保证与真实表结构一致） ----------
            cur.execute("""
                SELECT * FROM products
                WHERE tenant_id = %s AND product_type = 'accessory'
            """, (TENANT_ID,))
            accessories = cur.fetchall()
            acc_ids = [a['id'] for a in accessories]
            log(f"待删除配件数: {len(accessories)}")

            # ---------- 备份绑定关系 ----------
            if acc_ids:
                fmt = ','.join(['%s'] * len(acc_ids))
                cur.execute(f"""
                    SELECT * FROM product_bindings
                    WHERE accessory_product_id IN ({fmt})
                """, tuple(acc_ids))
                bindings = cur.fetchall()
            else:
                bindings = []
            log(f"待删除绑定关系数: {len(bindings)}")

            # ---------- 写出 JSON 备份 ----------
            backup_json = os.path.join(BACKUP_DIR, f"accessories_t{TENANT_ID}_{TIMESTAMP}.json")
            payload = {
                "tenant_id": TENANT_ID,
                "created_at": TIMESTAMP,
                "accessories": accessories,
                "product_bindings": bindings,
            }
            with io.open(backup_json, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
            log(f"JSON备份已写入: {backup_json} ({os.path.getsize(backup_json)} bytes)")

            # ---------- 写出 SQL 备份（可回滚用） ----------
            backup_sql = os.path.join(BACKUP_DIR, f"accessories_t{TENANT_ID}_{TIMESTAMP}.sql")
            lines = []
            lines.append(f"-- tenant_id={TENANT_ID} 备份时间 {TIMESTAMP}\n")
            lines.append("-- 回滚方法：执行以下语句将 deleted_at 恢复为 NULL 即可还原。\n")
            lines.append("-- 1) 还原配件:\n")
            lines.append(f"--   UPDATE products SET deleted_at=NULL WHERE tenant_id={TENANT_ID} AND product_type='accessory';\n")
            lines.append("-- 2) 还原绑定关系(请替换 ACC_ID_LIST 为 JSON 备份中的配件ID列表):\n")
            lines.append("--   UPDATE product_bindings SET deleted_at=NULL WHERE accessory_product_id IN (ACC_ID_LIST);\n")
            with io.open(backup_sql, "w", encoding="utf-8") as f:
                f.writelines(lines)
            log(f"SQL备份说明已写入: {backup_sql}")

        # ---------- 执行软删除（同一事务） ----------
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE products
                SET deleted_at = %s
                WHERE tenant_id = %s AND product_type = 'accessory' AND deleted_at IS NULL
            """, (now_str, TENANT_ID))
            acc_deleted = cur.rowcount
            log(f"软删除配件: {acc_deleted}")

            if acc_ids:
                fmt = ','.join(['%s'] * len(acc_ids))
                cur.execute(f"""
                    UPDATE product_bindings
                    SET deleted_at = %s
                    WHERE accessory_product_id IN ({fmt}) AND deleted_at IS NULL
                """, (now_str, ) + tuple(acc_ids))
                binding_deleted = cur.rowcount
            else:
                binding_deleted = 0
            log(f"软删除绑定关系: {binding_deleted}")

        conn.commit()
        log("OK: 已提交，全部软删除成功完成。")

    except Exception as e:
        conn.rollback()
        log(f"ERR: 执行失败，已回滚: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()