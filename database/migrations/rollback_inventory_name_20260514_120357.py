#!/usr/bin/env python3
"""
回滚脚本：删除 inventory_name 字段
备份文件: C:\Users\Administrator\Desktop\AI\AIBXHS\database\migrations\stores_backup_before_inv_20260514_120353.json
"""
import pymysql

DB_CONFIG = {
    'host': '115.190.250.14',
    'port': 3306,
    'user': 'bxhs_ai_assistance',
    'password': 'bxhsaiRoot@123',
    'database': 'bxhs_ai_assistance',
    'charset': 'utf8mb4'
}

def rollback():
    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor()

    print("🔄 开始回滚...")

    # 1. 清空 inventory_name
    cursor.execute("UPDATE stores SET inventory_name = NULL")
    print("   ✅ 已清空 inventory_name 字段")

    # 2. 删除字段（可选）
    # cursor.execute("ALTER TABLE stores DROP COLUMN inventory_name")
    # print("   ✅ 已删除 inventory_name 字段")

    conn.commit()
    conn.close()
    print("✅ 回滚完成")

if __name__ == "__main__":
    rollback()
