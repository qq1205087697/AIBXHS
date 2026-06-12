from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from database.database import get_db
from dependencies import get_current_user
from models.user import User
from services.inventory_batch import get_product_stock_summary

router = APIRouter(prefix="/api/inventory-batches", tags=["inventory_batches"])


@router.get("/product/{product_id}")
async def get_product_batches(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        summary = get_product_stock_summary(db, current_user.tenant_id, product_id)
        # 为了兼容性，保留原格式，但是前端会直接使用 batches
        return {"success": True, "data": summary["batches"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取库存批次失败: {str(e)}")


@router.get("/product/{product_id}/history")
async def get_product_stock_history(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        # 先尝试查询包含类型字段的数据
        try:
            inbound_rows = db.execute(text("""
                SELECT io.id as order_id, ioi.id as item_id, io.order_number, io.inbound_date, ioi.quantity, ioi.warehouse, ioi.batch_number, io.created_at, 'inbound' as type, io.inbound_type
                FROM inbound_order_items ioi
                JOIN inbound_orders io ON io.id = ioi.inbound_order_id AND io.deleted_at IS NULL
                WHERE ioi.product_id = :pid AND io.tenant_id = :tid AND ioi.deleted_at IS NULL AND io.status = 'confirmed'
                ORDER BY io.created_at DESC
                LIMIT 100
            """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()
        except Exception as e:
            print(f"查询包含inbound_type失败: {e}")
            # 回退到不包含类型字段的查询
            inbound_rows = db.execute(text("""
                SELECT io.id as order_id, ioi.id as item_id, io.order_number, io.inbound_date, ioi.quantity, ioi.warehouse, ioi.batch_number, io.created_at, 'inbound' as type
                FROM inbound_order_items ioi
                JOIN inbound_orders io ON io.id = ioi.inbound_order_id AND io.deleted_at IS NULL
                WHERE ioi.product_id = :pid AND io.tenant_id = :tid AND ioi.deleted_at IS NULL AND io.status = 'confirmed'
                ORDER BY io.created_at DESC
                LIMIT 100
            """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()

        try:
            outbound_rows = db.execute(text("""
                SELECT oo.id as order_id, ooi.id as item_id, oo.order_number, oo.outbound_date, ooi.quantity, oo.warehouse, ooi.batch_number, oo.created_at, 'outbound' as type, oo.outbound_type, ooi.batch_details
                FROM outbound_order_items ooi
                JOIN outbound_orders oo ON oo.id = ooi.outbound_order_id AND oo.deleted_at IS NULL
                WHERE ooi.product_id = :pid AND oo.tenant_id = :tid AND ooi.deleted_at IS NULL AND oo.status = 'confirmed'
                ORDER BY oo.created_at DESC
                LIMIT 100
            """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()
        except Exception as e:
            print(f"查询包含outbound_type失败: {e}")
            # 回退到不包含类型字段的查询
            try:
                outbound_rows = db.execute(text("""
                    SELECT oo.id as order_id, ooi.id as item_id, oo.order_number, oo.outbound_date, ooi.quantity, oo.warehouse, ooi.batch_number, oo.created_at, 'outbound' as type, ooi.batch_details
                    FROM outbound_order_items ooi
                    JOIN outbound_orders oo ON oo.id = ooi.outbound_order_id AND oo.deleted_at IS NULL
                    WHERE ooi.product_id = :pid AND oo.tenant_id = :tid AND ooi.deleted_at IS NULL AND oo.status = 'confirmed'
                    ORDER BY oo.created_at DESC
                    LIMIT 100
                """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()
            except Exception as e2:
                print(f"查询包含batch_details失败: {e2}")
                outbound_rows = db.execute(text("""
                    SELECT oo.id as order_id, ooi.id as item_id, oo.order_number, oo.outbound_date, ooi.quantity, oo.warehouse, ooi.batch_number, oo.created_at, 'outbound' as type
                    FROM outbound_order_items ooi
                    JOIN outbound_orders oo ON oo.id = ooi.outbound_order_id AND oo.deleted_at IS NULL
                    WHERE ooi.product_id = :pid AND oo.tenant_id = :tid AND ooi.deleted_at IS NULL AND oo.status = 'confirmed'
                    ORDER BY oo.created_at DESC
                    LIMIT 100
                """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()

        # 类型映射
        inbound_type_map = {
            "purchase": "采购入库",
            "return": "退货入库",
            "transfer": "调拨入库",
            "adjustment": "调整入库",
            "other": "其他入库"
        }
        outbound_type_map = {
            "sale": "销售出库",
            "return_supplier": "退货出库",
            "transfer": "调拨出库",
            "scrap": "报废出库",
            "adjustment": "调整出库",
            "other": "其他出库"
        }

        records = []
        for row in inbound_rows:
            has_inbound_type = len(row) > 9
            inbound_type = row[9] if has_inbound_type else None
            sub_type = inbound_type_map.get(inbound_type, inbound_type or "入库")
            order_id = row[0]
            item_id = row[1]
            batch_number = row[6]
            if not batch_number:
                # 如果入库明细没有批次号，从 inventory_batches 表中查找
                batch_info = db.execute(text("""
                    SELECT batch_number FROM inventory_batches
                    WHERE inbound_order_id = :oid AND inbound_item_id = :iid AND deleted_at IS NULL
                """), {"oid": order_id, "iid": item_id}).fetchone()
                if batch_info and batch_info[0]:
                    batch_number = batch_info[0]
                else:
                    # 还没有的话，尝试根据订单号+产品ID查找
                    product_id = db.execute(text("""
                        SELECT product_id FROM inbound_order_items
                        WHERE id = :iid
                    """), {"iid": item_id}).scalar()
                    if product_id:
                        batch = db.execute(text("""
                            SELECT batch_number FROM inventory_batches
                            WHERE inbound_order_id = :oid AND product_id = :pid AND deleted_at IS NULL
                            ORDER BY created_at ASC LIMIT 1
                        """), {"oid": order_id, "pid": product_id}).fetchone()
                        if batch and batch[0]:
                            batch_number = batch[0]
            records.append({
                "order_number": row[2],
                "date": row[3].strftime("%Y-%m-%d") if row[3] else "",
                "quantity": int(row[4]),
                "warehouse": row[5] or "",
                "batch_number": batch_number or "",
                "created_at": row[7].strftime("%Y-%m-%d %H:%M:%S") if row[7] else "",
                "type": row[8],
                "sub_type": sub_type,
            })
        for row in outbound_rows:
            has_outbound_type = len(row) > 9
            outbound_type = row[9] if has_outbound_type else None
            sub_type = outbound_type_map.get(outbound_type, outbound_type or "出库")
            # 解析 batch_details
            batch_details = None
            if len(row) > 10 and row[10]:
                try:
                    if isinstance(row[10], str):
                        import json
                        batch_details = json.loads(row[10])
                    else:
                        batch_details = row[10]
                except (json.JSONDecodeError, TypeError):
                    pass
            
            records.append({
                "order_number": row[2],
                "date": row[3].strftime("%Y-%m-%d") if row[3] else "",
                "quantity": -int(row[4]),
                "warehouse": row[5] or "",
                "batch_number": row[6] or "",
                "created_at": row[7].strftime("%Y-%m-%d %H:%M:%S") if row[7] else "",
                "type": row[8],
                "sub_type": sub_type,
                "batch_details": batch_details,
            })

        records.sort(key=lambda x: x["created_at"], reverse=True)

        return {"success": True, "data": records}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"获取库存历史失败: {str(e)}")


@router.get("/report")
async def get_inventory_report(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        offset = (page - 1) * page_size
        total = db.execute(text("""
            SELECT COUNT(*) FROM products WHERE tenant_id = :tid AND deleted_at IS NULL AND local_quantity > 0
        """), {"tid": current_user.tenant_id}).scalar() or 0

        rows = db.execute(text("""
            SELECT p.id, p.product_code, p.name, p.local_quantity, p.local_warehouse, p.purchase_price,
                   (p.local_quantity * p.purchase_price) as local_value,
                   DATEDIFF(CURDATE(), p.local_inbound_date) as stock_age
            FROM products p
            WHERE p.tenant_id = :tid AND p.deleted_at IS NULL AND p.local_quantity > 0
            ORDER BY local_value DESC
            LIMIT :limit OFFSET :offset
        """), {"tid": current_user.tenant_id, "limit": page_size, "offset": offset}).fetchall()

        items = []
        total_value = 0
        for row in rows:
            value = float(row[6]) if row[6] else 0
            total_value += value
            items.append({
                "product_id": row[0],
                "product_code": row[1] or "",
                "product_name": row[2],
                "local_quantity": int(row[3]),
                "local_warehouse": row[4] or "",
                "purchase_price": float(row[5]) if row[5] else 0,
                "local_value": value,
                "stock_age": int(row[7]) if row[7] is not None else 0,
            })

        return {
            "success": True,
            "data": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "summary": {"total_value": total_value, "total_products": total}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取库存报表失败: {str(e)}")


class ShelfNumberUpdate(BaseModel):
    shelf_number: str


@router.put("/{batch_id}/shelf-number")
async def update_batch_shelf_number(
    batch_id: int,
    data: ShelfNumberUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        row = db.execute(
            text("SELECT id FROM inventory_batches WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": batch_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="批次不存在")

        db.execute(
            text("UPDATE inventory_batches SET shelf_number = :shelf_number, updated_at = NOW() WHERE id = :id"),
            {"shelf_number": data.shelf_number, "id": batch_id}
        )
        db.commit()
        return {"success": True, "message": "货架号更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新货架号失败: {str(e)}")