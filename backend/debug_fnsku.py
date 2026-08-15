"""
调试脚本：查询数据库中 FNSKU 和 SKU 的样本数据
对比 Excel 中的 SKU 值格式
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()

try:
    # 1. 查看 inventory_snapshots 表的总行数
    count = db.execute(text("SELECT COUNT(*) FROM inventory_snapshots")).scalar()
    print(f"inventory_snapshots 表总行数: {count}")
    print()

    # 2. 查看最新的 snapshot_date
    latest_date = db.execute(text("SELECT MAX(snapshot_date) FROM inventory_snapshots")).scalar()
    print(f"最新快照日期: {latest_date}")
    print()

    # 3. 查询 20 条 FNSKU 样本
    print("=" * 80)
    print("【FNSKU 样本 - 20条】")
    print("=" * 80)
    rows = db.execute(text("""
        SELECT fnsku, sku, asin, account, country 
        FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND fnsku IS NOT NULL AND fnsku != ''
        LIMIT 20
    """), {"dt": latest_date}).fetchall()
    for r in rows:
        print(f"  FNSKU: '{r[0]}'  |  SKU: '{r[1]}'  |  ASIN: '{r[2]}'  |  Account: '{r[3]}'  |  Country: '{r[4]}'")
    print()

    # 4. 查询 20 条 SKU 样本
    print("=" * 80)
    print("【SKU 样本 - 20条】")
    print("=" * 80)
    rows = db.execute(text("""
        SELECT sku, fnsku, asin, account, country 
        FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND sku IS NOT NULL AND sku != ''
        LIMIT 20
    """), {"dt": latest_date}).fetchall()
    for r in rows:
        print(f"  SKU: '{r[0]}'  |  FNSKU: '{r[1]}'  |  ASIN: '{r[2]}'  |  Account: '{r[3]}'  |  Country: '{r[4]}'")
    print()

    # 5. 统计 FNSKU 的典型格式/长度
    print("=" * 80)
    print("【FNSKU 格式分析 - 查看前10条非空FNSKU的字符构成】")
    print("=" * 80)
    rows = db.execute(text("""
        SELECT fnsku, LENGTH(fnsku) as len, sku
        FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND fnsku IS NOT NULL AND fnsku != ''
        LIMIT 30
    """), {"dt": latest_date}).fetchall()
    for r in rows:
        print(f"  FNSKU长度={r[1]}: '{r[0]}'  (对应SKU: '{r[2]}')")
    print()

    # 6. 尝试查找 Excel 中类似 PW-067 的值
    print("=" * 80)
    print("【尝试查找类似 'PW-' 开头的SKU或FNSKU】")
    print("=" * 80)
    rows = db.execute(text("""
        SELECT sku, fnsku, asin
        FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND (sku LIKE 'PW-%' OR fnsku LIKE 'PW-%')
        LIMIT 20
    """), {"dt": latest_date}).fetchall()
    if rows:
        for r in rows:
            print(f"  SKU: '{r[0]}'  |  FNSKU: '{r[1]}'  |  ASIN: '{r[2]}'")
    else:
        print("  未找到 PW- 开头的数据")
    print()

    # 7. 检查 FNSKU 是否像亚马逊标准 FNSKU（通常是大写字母数字混合，如 X000xxxxx 或类似）
    print("=" * 80)
    print("【FNSKU 是否为纯数字/字母混合 - 前10条】")
    print("=" * 80)
    rows = db.execute(text("""
        SELECT fnsku, sku
        FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND fnsku IS NOT NULL AND fnsku != ''
        LIMIT 10
    """), {"dt": latest_date}).fetchall()
    for r in rows:
        fnsku = r[0]
        has_letter = any(c.isalpha() for c in fnsku)
        has_digit = any(c.isdigit() for c in fnsku)
        has_hyphen = '-' in fnsku
        print(f"  FNSKU: '{fnsku}' | 含字母={has_letter} | 含数字={has_digit} | 含连字符={has_hyphen}")
    print()

    # 8. 分别统计 FNSKU 和 SKU 的非空数量
    print("=" * 80)
    print("【FNSKU vs SKU 非空统计(最新快照)】")
    print("=" * 80)
    fnsku_count = db.execute(text("""
        SELECT COUNT(*) FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND fnsku IS NOT NULL AND fnsku != ''
    """), {"dt": latest_date}).scalar()
    sku_count = db.execute(text("""
        SELECT COUNT(*) FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND sku IS NOT NULL AND sku != ''
    """), {"dt": latest_date}).scalar()
    print(f"  FNSKU 非空数量: {fnsku_count}")
    print(f"  SKU 非空数量: {sku_count}")
    print()

    # 9. 尝试用 PW-067 搜索
    print("=" * 80)
    print("【尝试用 'PW-067' 搜索 SKU 和 FNSKU】")
    print("=" * 80)
    rows_sku = db.execute(text("""
        SELECT sku, fnsku, asin FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND sku LIKE '%PW-067%'
    """), {"dt": latest_date}).fetchall()
    rows_fnsku = db.execute(text("""
        SELECT sku, fnsku, asin FROM inventory_snapshots 
        WHERE snapshot_date = :dt AND fnsku LIKE '%PW-067%'
    """), {"dt": latest_date}).fetchall()
    print(f"  SKU 中查找 'PW-067': {len(rows_sku)} 条")
    for r in rows_sku:
        print(f"    SKU='{r[0]}'  FNSKU='{r[1]}'  ASIN='{r[2]}'")
    print(f"  FNSKU 中查找 'PW-067': {len(rows_fnsku)} 条")
    for r in rows_fnsku:
        print(f"    SKU='{r[0]}'  FNSKU='{r[1]}'  ASIN='{r[2]}'")

finally:
    db.close()