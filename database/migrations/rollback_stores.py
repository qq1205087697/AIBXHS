#!/usr/bin/env python3
"""
回滚脚本：恢复 stores 表到添加 inventory_name 之前的状态
1. 恢复 name 字段为备份中的原始值
2. 删除 inventory_name 字段
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import pymysql
import json
from datetime import datetime

DB_CONFIG = {
    'host': '115.190.250.14',
    'port': 3306,
    'user': 'bxhs_ai_assistance',
    'password': 'bxhsaiRoot@123',
    'database': 'bxhs_ai_assistance',
    'charset': 'utf8mb4'
}

BACKUP_FILE = os.path.join(os.path.dirname(__file__), 'stores_backup_20260513_172524.json')


def main():
    print("=" * 60)
    print("回滚 stores 表")
    print("=" * 60)

    # 1. 读取备份数据
    print("\n📦 读取备份数据...")
    with open(BACKUP_FILE, 'r', encoding='utf-8') as f:
        backup_data = json.load(f)
    print(f"   备份记录数: {len(backup_data)}")

    # 2. 连接数据库
    print("\n🔗 连接数据库...")
    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor()

    # 3. 恢复 name 字段
    print("\n🔄 恢复 name 字段...")
    fixed_count = 0
    for item in backup_data:
        store_id = item['id']
        original_name = item['name']
        cursor.execute(
            "UPDATE stores SET name = %s WHERE id = %s",
            (original_name, store_id)
        )
        if cursor.rowcount > 0:
            fixed_count += 1
    conn.commit()
    print(f"   已恢复 {fixed_count} 条记录的 name 字段")

    # 4. 删除 inventory_name 字段
    print("\n🔧 删除 inventory_name 字段...")
    try:
        cursor.execute("ALTER TABLE stores DROP INDEX idx_inventory_name")
        print("   已删除索引 idx_inventory_name")
    except Exception as e:
        print(f"   删除索引时提示: {e}")

    try:
        cursor.execute("ALTER TABLE stores DROP COLUMN inventory_name")
        conn.commit()
        print("   已删除字段 inventory_name")
    except Exception as e:
        conn.rollback()
        print(f"   删除字段失败: {e}")

    conn.close()

    print("\n✅ 回滚完成！stores 表已恢复到原始状态")


if __name__ == "__main__":
    main()
