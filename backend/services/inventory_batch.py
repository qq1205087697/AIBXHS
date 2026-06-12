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
) -> tuple[int, str]:
    batch_number = generate_batch_number(product_id, str(inbound_date) if inbound_date else None)

    if isinstance(unit_price, (int, float)):
        unit_price = Decimal(str(unit_price))

    db.execute(text("""
        INSERT INTO inventory_batches (tenant_id, product_id, inbound_order_id, inbound_item_id, batch_number,
            initial_quantity, current_quantity, locked_quantity, unit_price, warehouse, shelf_number,
            inbound_date, production_date, expiry_date, status, notes, created_at, updated_at)
        VALUES (:tenant_id, :product_id, :inbound_order_id, :inbound_item_id, :batch_number,
            :initial_quantity, :current_quantity, 0, :unit_price, :warehouse, :shelf_number,
            :inbound_date, :production_date, :expiry_date, 'active', :notes, :created_at, :updated_at)
    """), {
        "tenant_id": tenant_id,
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
        "notes": notes,
        "created_at": datetime.now(),
        "updated_at": datetime.now(),
    })
    result = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()
    db.commit()
    return result, batch_number


def deduce_inventory_fifo(
    db: Session,
    tenant_id: int,
    product_id: int,
    requested_quantity: int,
) -> tuple[list[dict], int, bool]:
    """
    FIFO 库存扣减。
    返回: (扣减明细列表, 实际扣减总数, 是否完全满足)
    扣减明细: [{batch_id, batch_number, quantity, unit_price, warehouse, inbound_date}]
    """
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
) -> tuple[list[dict], int, bool]:
    """
    从指定批次扣减库存。
    返回: (扣减明细列表, 实际扣减总数, 是否完全满足)
    """
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
    for detail in deduction_details:
        db.execute(text("""
            UPDATE inventory_batches
            SET current_quantity = current_quantity - :qty,
                status = CASE WHEN current_quantity - :qty <= 0 THEN 'depleted' ELSE 'active' END,
                shelf_number = CASE WHEN current_quantity - :qty <= 0 THEN NULL ELSE shelf_number END,
                updated_at = :now
            WHERE id = :batch_id
        """), {"qty": detail["quantity"], "batch_id": detail["batch_id"], "now": datetime.now()})
    db.commit()


def rollback_deduction(db: Session, deduction_details: list[dict]):
    for detail in deduction_details:
        db.execute(text("""
            UPDATE inventory_batches
            SET current_quantity = current_quantity + :qty,
                status = CASE WHEN current_quantity + :qty > 0 THEN 'active' ELSE status END,
                updated_at = :now
            WHERE id = :batch_id
        """), {"qty": detail["quantity"], "batch_id": detail["batch_id"], "now": datetime.now()})
    db.commit()


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
    db.commit()