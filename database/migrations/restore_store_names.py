#!/usr/bin/env python3
"""
恢复 stores 表 name 字段为正确的中文店铺名
根据用户提供的映射规则推导：
- JeVenis -> 云南金顺公司
- LaVenty -> B账号账户管理
- roaring -> C账号账户管理
- D账号账户管理 -> D账号账户管理（不变）
- E账号账户管理 -> E账号账户管理（不变）
- F账号账户管理 -> F账号账户管理（不变）
- G站点紫鸟账号 -> G站点紫鸟账号（不变）
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

# name 修复映射
NAME_FIX = {
    "JeVenis": "云南金顺公司",
    "LaVenty": "B账号账户管理",
    "roaring": "C账号账户管理",
    # 以下已经是中文名，不需要改
    "D账号账户管理": "D账号账户管理",
    "E账号账户管理": "E账号账户管理",
    "F账号账户管理": "F账号账户管理",
    "G站点紫鸟账号": "G站点紫鸟账号",
    "云南金顺公司": "云南金顺公司",
    "B账号账户管理": "B账号账户管理",
    "C账号账户管理": "C账号账户管理",
}

def main():
    print("=" * 60)
    print("恢复 stores 表 name 字段")
    print("=" * 60)

    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor()

    # 查询当前数据
    cursor.execute("SELECT id, name, site FROM stores WHERE tenant_id = 1 ORDER BY id")
    stores = cursor.fetchall()

    print(f"\n共 {len(stores)} 条记录")
    print("\n开始恢复...\n")

    fixed = 0
    for store_id, name, site in stores:
        correct_name = NAME_FIX.get(name)
        if correct_name and correct_name != name:
            cursor.execute(
                "UPDATE stores SET name = %s WHERE id = %s",
                (correct_name, store_id)
            )
            fixed += 1
            print(f"  ID:{store_id:2d} | {name:20s} -> {correct_name} | {site}")

    conn.commit()
    conn.close()

    print(f"\n✅ 恢复完成，共修复 {fixed} 条记录")

if __name__ == "__main__":
    main()
