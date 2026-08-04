from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import text


def generate_batch_number(product_id: int, inbound_date: str | date | datetime | None) -> str:
    if inbound_date:
        if isinstance(inbound_date, (date, datetime)):
            # 如果是日期或日期时间对象，直接格式化
            today = inbound_date.strftime("%Y%m%d")
        else:
            # 如果是字符串，处理一下
            date_str = str(inbound_date)
            # 如果包含空格（带有时间），只取日期部分
            if " " in date_str:
                date_str = date_str.split(" ")[0]
            today = date_str.replace("-", "").replace("/", "")
    else:
        today = datetime.now().strftime("%Y%m%d")
    seq = datetime.now().strftime("%H%M%S")
    return f"B{product_id:06d}-{today}-{seq}"


def create_inventory_batch(
    db: Session,
    tenant_id: int,
    product_id: int,
    inbound_order_id: int,
    inbound_item_id: int,
    quantity: int,
    unit_price: Decimal | float,
    warehouse: str | None = None,
    shelf_number: str | None = None,
    inbound_date: date | str | None = None,
    production_date: date | str | None = None,
    expiry_date: date | str | None = None,
    notes: str | None = None,
    batch_type: str = "purchase",  # 新增批次类型参数,默认为采购入库
    source_batch_id: int | None = None,  # 新增来源批次ID参数
    assembly_quantity: int | None = None,  # 新增组装数量参数
    store_group_id: int | None = None,  # 新增店铺分组ID参数
) -> tuple[int, str]:
    batch_number = generate_batch_number(product_id, str(inbound_date) if inbound_date else None)

    if isinstance(unit_price, (int, float)):
        unit_price = Decimal(str(unit_price))

    # 确保inventory_batches表有新字段
    try:
        db.execute(text("""
            ALTER TABLE inventory_batches
            ADD COLUMN batch_type VARCHAR(20) DEFAULT 'purchase' COMMENT '批次类型: purchase=采购入库, assembly=组装入库'
        """))
        db.execute(text("""
            ALTER TABLE inventory_batches
            ADD COLUMN source_batch_id INT NULL COMMENT '来源批次ID(组装入库时记录配件批次)'
        """))
        db.execute(text("""
            ALTER TABLE inventory_batches
            ADD COLUMN assembly_quantity INT NULL COMMENT '组装数量(每个成品消耗的配件数量)'
        """))
        db.commit()
    except Exception:
        pass  # 字段已存在则忽略

    db.execute(text("""
        INSERT INTO inventory_batches (tenant_id, store_group_id, product_id, inbound_order_id, inbound_item_id, batch_number,
            initial_quantity, current_quantity, locked_quantity, unit_price, warehouse, shelf_number,
            inbound_date, production_date, expiry_date, status, batch_type, source_batch_id, assembly_quantity, notes, created_at, updated_at)
        VALUES (:tenant_id, :store_group_id, :product_id, :inbound_order_id, :inbound_item_id, :batch_number,
            :initial_quantity, :current_quantity, 0, :unit_price, :warehouse, :shelf_number,
            :inbound_date, :production_date, :expiry_date, 'active', :batch_type, :source_batch_id, :assembly_quantity, :notes, :created_at, :updated_at)
    """), {
        "tenant_id": tenant_id,
        "store_group_id": store_group_id,
        "product_id": product_id,
        "inbound_order_id": inbound_order_id,
        "inbound_item_id": inbound_item_id,
        "batch_number": batch_number,
        "initial_quantity": quantity,
        "current_quantity": quantity,
        "unit_price": float(unit_price),
        "warehouse": warehouse,
        "shelf_number": shelf_number,
        "inbound_date": inbound_date,
        "production_date": production_date,
        "expiry_date": expiry_date,
        "batch_type": batch_type,
        "source_batch_id": source_batch_id,
        "assembly_quantity": assembly_quantity,
        "notes": notes,
        "created_at": datetime.now(),
        "updated_at": datetime.now(),
    })
    result = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
    # 不在此处commit，由调用者控制事务提交时机，确保原子性
    return result, batch_number


def deduce_inventory_fifo(
    db: Session,
    tenant_id: int,
    product_id: int,
    requested_quantity: int,
    store_group_id: int | None = None,
) -> tuple[list[dict], int, bool]:
    """
    FIFO 库存扣减。
    返回: (扣减明细列表, 实际扣减总数, 是否完全满足)
    扣减明细: [{batch_id, batch_number, quantity, unit_price, warehouse, inbound_date}]
    参数:
        store_group_id: 如果指定，则只扣除该店铺分组下的库存批次
    """
    # 如果指定了store_group_id，需要通过关联查询筛选批次
    if store_group_id:
        rows = db.execute(text("""
            SELECT ib.id, ib.batch_number, ib.current_quantity, ib.locked_quantity, ib.unit_price, ib.warehouse, ib.inbound_date
            FROM inventory_batches ib
            LEFT JOIN inbound_orders io ON ib.inbound_order_id = io.id
            LEFT JOIN purchase_orders po ON io.purchase_order_id = po.id
            WHERE ib.tenant_id = :tenant_id AND ib.product_id = :product_id
              AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL
              AND po.store_group_id = :store_group_id
            ORDER BY ib.inbound_date ASC, ib.id ASC
        """), {"tenant_id": tenant_id, "product_id": product_id, "store_group_id": store_group_id}).fetchall()
    else:
        # 未指定店铺分组，扣除所有批次（原有逻辑）
        rows = db.execute(text("""
            SELECT id, batch_number, current_quantity, locked_quantity, unit_price, warehouse, inbound_date
            FROM inventory_batches
            WHERE tenant_id = :tenant_id AND product_id = :product_id
              AND status = 'active' AND current_quantity > 0 AND deleted_at IS NULL
            ORDER BY inbound_date ASC, id ASC
        """), {"tenant_id": tenant_id, "product_id": product_id}).fetchall()

    deduction_details = []
    remaining = requested_quantity

    for row in rows:
        batch_id = row[0]
        batch_number = row[1]
        available = int(row[2]) - int(row[3])

        if available <= 0:
            continue

        deduct = min(available, remaining)
        if deduct > 0:
            deduction_details.append({
                "batch_id": batch_id,
                "batch_number": batch_number,
                "quantity": deduct,
                "unit_price": float(row[4]) if row[4] else 0,
                "warehouse": row[5] or "",
                "inbound_date": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
            })
            remaining -= deduct

        if remaining <= 0:
            break

    fully_fulfilled = remaining <= 0
    return deduction_details, requested_quantity - remaining, fully_fulfilled


def deduce_inventory_from_specific_batch(
    db: Session,
    tenant_id: int,
    product_id: int,
    requested_quantity: int,
    specified_batch_id: int,
    store_group_id: int | None = None,
) -> tuple[list[dict], int, bool]:
    """
    从指定批次扣减库存。
    返回: (扣减明细列表, 实际扣减总数, 是否完全满足)
    参数:
        store_group_id: 如果指定，则验证该批次是否属于该店铺分组
    """
    # 如果指定了store_group_id，需要验证批次是否属于该分组
    if store_group_id:
        row = db.execute(text("""
            SELECT ib.id, ib.batch_number, ib.current_quantity, ib.locked_quantity, ib.unit_price, ib.warehouse, ib.inbound_date
            FROM inventory_batches ib
            LEFT JOIN inbound_orders io ON ib.inbound_order_id = io.id
            LEFT JOIN purchase_orders po ON io.purchase_order_id = po.id
            WHERE ib.tenant_id = :tenant_id AND ib.product_id = :product_id AND ib.id = :batch_id
              AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL
              AND po.store_group_id = :store_group_id
        """), {"tenant_id": tenant_id, "product_id": product_id, "batch_id": specified_batch_id, "store_group_id": store_group_id}).fetchone()
    else:
        # 未指定店铺分组，直接查询批次（原有逻辑）
        row = db.execute(text("""
            SELECT id, batch_number, current_quantity, locked_quantity, unit_price, warehouse, inbound_date
            FROM inventory_batches
            WHERE tenant_id = :tenant_id AND product_id = :product_id AND id = :batch_id
              AND status = 'active' AND current_quantity > 0 AND deleted_at IS NULL
        """), {"tenant_id": tenant_id, "product_id": product_id, "batch_id": specified_batch_id}).fetchone()

    if not row:
        return [], 0, False

    batch_id = row[0]
    batch_number = row[1]
    available = int(row[2]) - int(row[3])

    if available <= 0:
        return [], 0, False

    deduct = min(available, requested_quantity)
    deduction_details = [{
        "batch_id": batch_id,
        "batch_number": batch_number,
        "quantity": deduct,
        "unit_price": float(row[4]) if row[4] else 0,
        "warehouse": row[5] or "",
        "inbound_date": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
    }]

    fully_fulfilled = deduct >= requested_quantity
    return deduction_details, deduct, fully_fulfilled


def apply_deduction(db: Session, deduction_details: list[dict]):
    """
    执行库存扣减。
    MySQL UPDATE行为: SET子句按顺序执行，后续计算使用已更新的值。
    所以status判断应该直接用已更新的current_quantity > 0。
    """
    for detail in deduction_details:
        batch_id = detail["batch_id"]
        qty = detail["quantity"]
        print(f"[APPLY_DEDUCTION] Deducting batch#{batch_id} by {qty}")
        # Check current status before deduction
        before = db.execute(text("""
            SELECT current_quantity, status FROM inventory_batches WHERE id = :batch_id
        """), {"batch_id": batch_id}).fetchone()
        print(f"[APPLY_DEDUCTION] Before: current={before[0]} status={before[1]}")
        
        # MySQL UPDATE: SET子句按顺序执行
        # 1. 先执行 current_quantity = current_quantity - :qty (current_quantity变成新值)
        # 2. 然后执行 status = CASE WHEN current_quantity > 0... (使用已更新的current_quantity)
        # 所以status判断直接用 current_quantity > 0（已扣减后的剩余数量）
        db.execute(text("""
            UPDATE inventory_batches
            SET current_quantity = current_quantity - :qty,
                status = CASE WHEN current_quantity > 0 THEN 'active' ELSE 'depleted' END,
                shelf_number = CASE WHEN current_quantity > 0 THEN shelf_number ELSE NULL END,
                updated_at = :now
            WHERE id = :batch_id
        """), {"qty": qty, "batch_id": batch_id, "now": datetime.now()})
        
        # Check status after deduction
        after = db.execute(text("""
            SELECT current_quantity, status FROM inventory_batches WHERE id = :batch_id
        """), {"batch_id": batch_id}).fetchone()
        print(f"[APPLY_DEDUCTION] After: current={after[0]} status={after[1]}")
    # 不在此处commit，由调用者控制事务提交时机，确保原子性


def rollback_deduction(db: Session, deduction_details: list[dict]):
    for detail in deduction_details:
        db.execute(text("""
            UPDATE inventory_batches
            SET current_quantity = current_quantity + :qty,
                status = CASE WHEN current_quantity + :qty > 0 THEN 'active' ELSE status END,
                updated_at = :now
            WHERE id = :batch_id
        """), {"qty": detail["quantity"], "batch_id": detail["batch_id"], "now": datetime.now()})
    # 不在此处commit，由调用者控制事务提交时机，确保原子性


def get_product_stock_summary(db: Session, tenant_id: int, product_id: int) -> dict:
    rows = db.execute(text("""
        SELECT id, batch_number, current_quantity, unit_price, warehouse, shelf_number, inbound_date,
               DATEDIFF(CURDATE(), inbound_date) as stock_age,
               production_date, expiry_date,
               inbound_order_id, stock_transfer_order_id
        FROM inventory_batches
        WHERE tenant_id = :tenant_id AND product_id = :product_id
          AND current_quantity > 0 AND status = 'active' AND deleted_at IS NULL
        ORDER BY inbound_date ASC
    """), {"tenant_id": tenant_id, "product_id": product_id}).fetchall()

    batches = []
    total_quantity = 0
    for row in rows:
        qty = int(row[2])
        total_quantity += qty
        # 确定来源类型
        source_type = "inbound"
        if row[11]:
            source_type = "stock_transfer"
        
        batch_number = row[1]
        if not batch_number:
            # 如果没有批次号，生成一个
            batch_number = generate_batch_number(product_id, row[6])
            # 更新数据库
            db.execute(text("""
                UPDATE inventory_batches SET batch_number = :bn WHERE id = :id
            """), {"bn": batch_number, "id": row[0]})
            db.commit()
        
        batches.append({
            "id": int(row[0]),
            "batch_number": batch_number,
            "current_quantity": qty,
            "unit_price": float(row[3]) if row[3] else 0,
            "warehouse": row[4] or "",
            "shelf_number": row[5] or "",
            "inbound_date": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
            "stock_age": int(row[7]) if row[7] is not None else 0,
            "production_date": row[8].strftime("%Y-%m-%d") if row[8] else "",
            "expiry_date": row[9].strftime("%Y-%m-%d") if row[9] else "",
            "source_type": source_type,
            "inbound_order_id": row[10],
            "stock_transfer_order_id": row[11],
        })

    return {"total_quantity": total_quantity, "batches": batches}


def recalculate_product_local_stock(db: Session, tenant_id: int, product_id: int):
    summary = get_product_stock_summary(db, tenant_id, product_id)
    total_qty = summary["total_quantity"]
    db.execute(text("""
        UPDATE products SET local_quantity = :qty, updated_at = NOW()
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"qty": total_qty, "pid": product_id, "tid": tenant_id})
    # 不在此处commit，由调用者控制事务提交时机，确保原子性