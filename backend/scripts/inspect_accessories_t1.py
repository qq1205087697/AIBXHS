# -*- coding: utf-8 -*-
"""检查 tenant=1 的配件数据与绑定关系（只读，不修改）"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import get_settings
import pymysql

settings = get_settings()
conn = pymysql.connect(
    host=settings.DB_HOST,
    port=settings.DB_PORT,
    user=settings.DB_USER,
    password=settings.DB_PASSWORD,
    database=settings.DB_NAME,
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor,
)
try:
    with conn.cursor() as cur:
        # 1. products 表是否存在 product_type 列
        cur.execute("SHOW COLUMNS FROM products LIKE 'product_type'")
        col = cur.fetchone()
        print("product_type 列: ", col)

        # 2. 统计各 product_type 数量
        cur.execute("""
            SELECT product_type, COUNT(*) AS cnt
            FROM products
            WHERE tenant_id = 1 AND deleted_at IS NULL
            GROUP BY product_type
        """)
        print("\n[tenant=1 各 product_type 数量]")
        for r in cur.fetchall():
            print(f"  {r['product_type']}: {r['cnt']}")

        # 3. product_type IS NULL / 空 的产品数量（无法分类的）
        cur.execute("""
            SELECT COUNT(*) AS cnt
            FROM products
            WHERE tenant_id = 1 AND deleted_at IS NULL
              AND (product_type IS NULL OR product_type = '')
        """)
        print("\n未分类(product_type为空)产品数量: ", cur.fetchone()['cnt'])

        # 4. 配件列表（product_type='accessory'）
        cur.execute("SHOW COLUMNS FROM products")
        cols = [r['Field'] for r in cur.fetchall()]
        print("\nproducts 表所有列: ", cols)
        cur.execute("""
            SELECT id, asin, name, product_type
            FROM products
            WHERE tenant_id = 1 AND deleted_at IS NULL AND product_type = 'accessory'
        """)
        accessories = cur.fetchall()
        print(f"\n[tenant=1 配件总数: {len(accessories)}]")
        for r in accessories[:50]:
            print(f"  id={r['id']} asin={r['asin']} name={r['name']}")

        # 5. 这些配件被哪些成品绑定
        if accessories:
            ids = [a['id'] for a in accessories]
            fmt = ','.join(['%s'] * len(ids))
            cur.execute(f"""
                SELECT pb.id AS binding_id, pb.finished_product_id, pb.accessory_product_id,
                       pb.quantity, pb.deleted_at AS binding_deleted_at,
                       fp.name AS finished_name, fp.asin AS finished_code
                FROM product_bindings pb
                LEFT JOIN products fp ON fp.id = pb.finished_product_id
                WHERE pb.accessory_product_id IN ({fmt})
            """, tuple(ids))
            bindings = cur.fetchall()
            active_bindings = [b for b in bindings if b['binding_deleted_at'] is None]
            print(f"\n[这些配件关联的全部绑定关系: {len(bindings)}，其中未删除的: {len(active_bindings)}]")
            for b in bindings:
                print(f"  binding_id={b['binding_id']} 成品#{b['finished_product_id']}({b['finished_code']}/{b['finished_name']}) "
                      f"<-> 配件#{b['accessory_product_id']} qty={b['quantity']} deleted_at={b['binding_deleted_at']}")

        # 6. 这些配件在其他业务表是否有引用（库存等），仅打印计数
        if accessories:
            ids = [a['id'] for a in accessories]
            fmt = ','.join(['%s']*len(ids))
            tables = ['inventory_records', 'inventory_batches', 'inbound_order_items', 'outbound_order_items',
                      'purchase_order_items', 'local_inventory']
            print("\n[配件在其他表引用计数(含软删除)]")
            for t in tables:
                try:
                    cur.execute(f"SELECT COUNT(*) AS cnt FROM {t} WHERE product_id IN ({fmt})", tuple(ids))
                    print(f"  {t}: {cur.fetchone()['cnt']}")
                except Exception as e:
                    print(f"  {t}: 查询失败({e})")
finally:
    conn.close()