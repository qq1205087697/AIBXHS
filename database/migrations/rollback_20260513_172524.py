#!/usr/bin/env python3
"""
店铺名映射回滚脚本
用于撤销迁移操作
"""
import pymysql
import json

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
    
    # 1. 清空 inventory_name 字段
    cursor.execute("UPDATE stores SET inventory_name = NULL")
    print("✅ 已清空 inventory_name 字段")
    
    # 2. 或者删除字段（如果需要完全回滚）
    # cursor.execute("ALTER TABLE stores DROP COLUMN inventory_name")
    # print("✅ 已删除 inventory_name 字段")
    
    conn.commit()
    conn.close()
    print("✅ 回滚完成")

if __name__ == "__main__":
    rollback()
