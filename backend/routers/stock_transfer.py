from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create, log_order_confirm, log_order_delete, log_order_update

router = APIRouter(prefix="/api/stock-transfers", tags=["stock_transfers"])


class TransferItemCreate(BaseModel):
    product_id: int
    batch_id: Optional[int] = None
    batch_number: Optional[str] = None
    shelf_number: Optional[str] = None
    target_shelf_number: Optional[str] = None
    quantity: int
    unit_price: Optional[float] = 0
    notes: Optional[str] = None


class StockTransferCreate(BaseModel):
    order_number: str
    source_warehouse: str
    target_warehouse: str
    notes: Optional[str] = None
    items: List[TransferItemCreate]


class StockTransferUpdate(BaseModel):
    order_number: Optional[str] = None
    source_warehouse: Optional[str] = None
    target_warehouse: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[TransferItemCreate]] = None


@router.get("/")
async def get_stock_transfers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    source_warehouse: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["sto.tenant_id = :tenant_id", "sto.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if status:
            where_conditions.append("sto.status = :status")
            params["status"] = status
        if source_warehouse:
            where_conditions.append("sto.source_warehouse = :source_warehouse")
            params["source_warehouse"] = source_warehouse
        if search:
            where_conditions.append("(sto.order_number LIKE :search OR sto.source_warehouse LIKE :search OR sto.target_warehouse LIKE :search)")
            params["search"] = f"%{search}%"
        if start_date:
            where_conditions.append("DATE(sto.created_at) >= :start_date")
            params["start_date"] = start_date
        if end_date:
            where_conditions.append("DATE(sto.created_at) <= :end_date")
            params["end_date"] = end_date

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM stock_transfer_orders sto WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT sto.id, sto.order_number, sto.source_warehouse, sto.target_warehouse,
                   sto.total_quantity, sto.total_amount, sto.status, sto.notes,
                   sto.created_by, sto.confirmed_by, sto.confirmed_at,
                   sto.created_at, sto.updated_at
            FROM stock_transfer_orders sto
            WHERE {where_clause}
            ORDER BY sto.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        user_ids = set()
        for row in rows:
            if row[8]:
                user_ids.add(row[8])
            if row[9]:
                user_ids.add(row[9])

        user_map = {}
        if user_ids:
            user_rows = db.execute(text(
                "SELECT id, nickname, username FROM users WHERE id IN :ids"
            ), {"ids": tuple(user_ids)}).fetchall()
            for u in user_rows:
                user_map[u[0]] = u[1] or u[2]

        result = []
        for row in rows:
            result.append({
                "id": row[0],
                "order_number": row[1],
                "source_warehouse": row[2],
                "target_warehouse": row[3],
                "total_quantity": int(row[4]) if row[4] else 0,
                "total_amount": float(row[5]) if row[5] else 0,
                "status": row[6],
                "notes": row[7],
                "created_by": row[8],
                "creator_name": user_map.get(row[8], "") if row[8] else "",
                "confirmed_by": row[9],
                "confirmer_name": user_map.get(row[9], "") if row[9] else "",
                "confirmed_at": row[10].strftime("%Y-%m-%d %H:%M:%S") if row[10] else None,
                "created_at": row[11].strftime("%Y-%m-%d %H:%M:%S") if row[11] else "",
                "updated_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else "",
            })

        return {"total": total, "items": result, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取挪货申请失败: {str(e)}")


@router.get("/{order_id}")
async def get_stock_transfer_detail(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        order = db.execute(text("""
            SELECT sto.id, sto.order_number, sto.source_warehouse, sto.target_warehouse,
                   sto.total_quantity, sto.total_amount, sto.status, sto.notes,
                   sto.created_by, sto.confirmed_by, sto.confirmed_at, sto.created_at
            FROM stock_transfer_orders sto
            WHERE sto.id = :id AND sto.tenant_id = :tid AND sto.deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()

        if not order:
            raise HTTPException(status_code=404, detail="挪货申请不存在")

        items = db.execute(text("""
            SELECT stoi.id, stoi.product_id, p.name as product_name, p.product_code,
                   stoi.batch_id, stoi.batch_number, stoi.shelf_number,
                   stoi.target_shelf_number, stoi.quantity, stoi.unit_price,
                   stoi.total_price, stoi.notes
            FROM stock_transfer_order_items stoi
            LEFT JOIN products p ON p.id = stoi.product_id
            WHERE stoi.stock_transfer_order_id = :oid AND stoi.deleted_at IS NULL
        """), {"oid": order_id}).fetchall()

        item_list = []
        for it in items:
            item_list.append({
                "id": it[0],
                "product_id": it[1],
                "product_name": it[2] or f"产品#{it[1]}",
                "product_code": it[3] or "",
                "batch_id": it[4],
                "batch_number": it[5] or "",
                "shelf_number": it[6] or "",
                "target_shelf_number": it[7] or "",
                "quantity": int(it[8]) if it[8] else 0,
                "unit_price": float(it[9]) if it[9] else 0,
                "total_price": float(it[10]) if it[10] else 0,
                "notes": it[11] or "",
            })

        user_ids = set()
        if order[8]:
            user_ids.add(order[8])
        if order[9]:
            user_ids.add(order[9])
        user_map = {}
        if user_ids:
            user_rows = db.execute(text(
                "SELECT id, nickname, username FROM users WHERE id IN :ids"
            ), {"ids": tuple(user_ids)}).fetchall()
            for u in user_rows:
                user_map[u[0]] = u[1] or u[2]

        return {
            "id": order[0],
            "order_number": order[1],
            "source_warehouse": order[2],
            "target_warehouse": order[3],
            "total_quantity": int(order[4]) if order[4] else 0,
            "total_amount": float(order[5]) if order[5] else 0,
            "status": order[6],
            "notes": order[7] or "",
            "created_by": order[8],
            "creator_name": user_map.get(order[8], "") if order[8] else "",
            "confirmed_by": order[9],
            "confirmer_name": user_map.get(order[9], "") if order[9] else "",
            "confirmed_at": order[10].strftime("%Y-%m-%d %H:%M:%S") if order[10] else None,
            "created_at": order[11].strftime("%Y-%m-%d %H:%M:%S") if order[11] else "",
            "items": item_list,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取挪货申请详情失败: {str(e)}")


@router.post("/")
async def create_stock_transfer(
    data: StockTransferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("stock_transfer:create"))
):
    try:
        total_qty = sum(item.quantity for item in data.items)
        total_amt = sum(
            (item.quantity * (item.unit_price or 0)) for item in data.items
        )

        db.execute(text("""
            INSERT INTO stock_transfer_orders (tenant_id, order_number, source_warehouse,
                target_warehouse, total_quantity, total_amount, status, notes,
                created_by, created_at, updated_at)
            VALUES (:tid, :num, :sw, :tw, :tq, :ta, 'draft', :notes, :uid, NOW(), NOW())
        """), {
            "tid": current_user.tenant_id, "num": data.order_number,
            "sw": data.source_warehouse, "tw": data.target_warehouse,
            "tq": total_qty, "ta": total_amt, "notes": data.notes,
            "uid": current_user.id,
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        for item in data.items:
            tp = item.quantity * (item.unit_price or 0)
            db.execute(text("""
                INSERT INTO stock_transfer_order_items (stock_transfer_order_id, product_id,
                    batch_id, batch_number, shelf_number, target_shelf_number,
                    quantity, unit_price, total_price, notes, created_at, updated_at)
                VALUES (:oid, :pid, :bid, :bn, :sn, :tsn, :qty, :up, :tp, :notes, NOW(), NOW())
            """), {
                "oid": order_id, "pid": item.product_id,
                "bid": item.batch_id, "bn": item.batch_number,
                "sn": item.shelf_number, "tsn": item.target_shelf_number,
                "qty": item.quantity, "up": item.unit_price or 0,
                "tp": tp, "notes": item.notes,
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id,
                         current_user.nickname or current_user.username,
                         "stock_transfer", order_id, data.order_number,
                         {"source_warehouse": data.source_warehouse,
                          "target_warehouse": data.target_warehouse,
                          "items_count": len(data.items)})

        return {"success": True, "id": order_id, "order_number": data.order_number}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建挪货申请失败: {str(e)}")


@router.put("/{order_id}")
async def update_stock_transfer(
    order_id: int,
    data: StockTransferUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("stock_transfer:edit"))
):
    try:
        order = db.execute(text(
            "SELECT id, status, order_number, source_warehouse, target_warehouse FROM stock_transfer_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="挪货申请不存在")
        if order[1] != "draft":
            raise HTTPException(status_code=400, detail="只有草稿状态的挪货申请可以编辑")

        before_data = {
            "order_number": order[2],
            "source_warehouse": order[3],
            "target_warehouse": order[4],
        }

        set_parts = ["updated_at = NOW()"]
        params = {"id": order_id}
        order_number = order[2]

        if data.order_number is not None:
            set_parts.append("order_number = :num")
            params["num"] = data.order_number
            order_number = data.order_number
        if data.source_warehouse is not None:
            set_parts.append("source_warehouse = :sw")
            params["sw"] = data.source_warehouse
        if data.target_warehouse is not None:
            set_parts.append("target_warehouse = :tw")
            params["tw"] = data.target_warehouse
        if data.notes is not None:
            set_parts.append("notes = :notes")
            params["notes"] = data.notes

        # 如果有items，先处理items
        if data.items:
            # 软删除旧items
            db.execute(text("UPDATE stock_transfer_order_items SET deleted_at = NOW() WHERE stock_transfer_order_id = :oid"), {"oid": order_id})
            
            # 计算新的total_quantity和total_amount
            total_qty = sum(item.quantity for item in data.items)
            total_amt = sum((item.quantity * (item.unit_price or 0)) for item in data.items)
            
            # 更新订单的total
            set_parts.append("total_quantity = :tq")
            set_parts.append("total_amount = :ta")
            params["tq"] = total_qty
            params["ta"] = total_amt
            
            # 插入新items
            for item in data.items:
                tp = item.quantity * (item.unit_price or 0)
                db.execute(text("""
                    INSERT INTO stock_transfer_order_items (stock_transfer_order_id, product_id,
                        batch_id, batch_number, shelf_number, target_shelf_number,
                        quantity, unit_price, total_price, notes, created_at, updated_at)
                    VALUES (:oid, :pid, :bid, :bn, :sn, :tsn, :qty, :up, :tp, :notes, NOW(), NOW())
                """), {
                    "oid": order_id, "pid": item.product_id,
                    "bid": item.batch_id, "bn": item.batch_number,
                    "sn": item.shelf_number, "tsn": item.target_shelf_number,
                    "qty": item.quantity, "up": item.unit_price or 0,
                    "tp": tp, "notes": item.notes,
                })

        db.execute(text(f"UPDATE stock_transfer_orders SET {', '.join(set_parts)} WHERE id = :id"), params)
        db.commit()

        after_data = {
            "order_number": order_number,
            "source_warehouse": data.source_warehouse if data.source_warehouse else order[3],
            "target_warehouse": data.target_warehouse if data.target_warehouse else order[4],
        }

        log_order_update(db, current_user.tenant_id, current_user.id,
                         current_user.nickname or current_user.username,
                         "stock_transfer", order_id, order_number,
                         before_data, after_data)

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新挪货申请失败: {str(e)}")


@router.delete("/{order_id}")
async def delete_stock_transfer(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("stock_transfer:delete"))
):
    try:
        order = db.execute(text(
            "SELECT id, order_number, status, tenant_id, source_warehouse FROM stock_transfer_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="挪货申请不存在")

        order_status = order[2]
        source_warehouse = order[4]

        # 已审批的订单需要回滚库存
        if order_status == "confirmed":
            items = db.execute(text("""
                SELECT stoi.id, stoi.batch_id, stoi.batch_number, stoi.shelf_number,
                       stoi.product_id, stoi.quantity
                FROM stock_transfer_order_items stoi
                WHERE stoi.stock_transfer_order_id = :oid AND stoi.deleted_at IS NULL
            """), {"oid": order_id}).fetchall()

            for item in items:
                batch_id = item[1]
                shelf_number = item[3]
                product_id = item[4]
                transfer_qty = int(item[5]) if item[5] else 0

                if not batch_id or transfer_qty <= 0:
                    continue

                original_batch = db.execute(text("""
                    SELECT id, current_quantity, warehouse, batch_number
                    FROM inventory_batches
                    WHERE id = :bid AND deleted_at IS NULL
                """), {"bid": batch_id}).fetchone()

                if not original_batch:
                    # 原批次已被删除，可能在目标仓库找到了迁移后的批次
                    continue

                orig_batch_no = original_batch[3]
                orig_warehouse = original_batch[2]

                if orig_warehouse == source_warehouse:
                    # 原批次仍在源仓库（部分挪货情景）：加回数量，删除目标仓库新批次
                    new_batch = db.execute(text("""
                        SELECT id FROM inventory_batches
                        WHERE batch_number = :bn AND product_id = :pid
                          AND warehouse != :sw AND deleted_at IS NULL
                          AND tenant_id = :tid
                        ORDER BY id DESC LIMIT 1
                    """), {
                        "bn": orig_batch_no, "pid": product_id,
                        "sw": source_warehouse, "tid": order[3],
                    }).fetchone()

                    if new_batch:
                        db.execute(text(
                            "UPDATE inventory_batches SET deleted_at = NOW() WHERE id = :id"
                        ), {"id": new_batch[0]})

                    new_qty = int(original_batch[1]) + transfer_qty
                    db.execute(text("""
                        UPDATE inventory_batches SET current_quantity = :cq, updated_at = NOW()
                        WHERE id = :bid
                    """), {"cq": new_qty, "bid": batch_id})
                else:
                    # 原批次仓库已变（全部挪货情景）：还原仓库和货架号
                    db.execute(text("""
                        UPDATE inventory_batches SET
                            warehouse = :wh, shelf_number = :sn, updated_at = NOW()
                        WHERE id = :bid
                    """), {
                        "wh": source_warehouse,
                        "sn": shelf_number if shelf_number else None,
                        "bid": batch_id,
                    })

        before_data = {"order_number": order[1], "status": order_status}

        db.execute(text(
            "UPDATE stock_transfer_order_items SET deleted_at = NOW() WHERE stock_transfer_order_id = :oid AND deleted_at IS NULL"
        ), {"oid": order_id})
        db.execute(text(
            "UPDATE stock_transfer_orders SET deleted_at = NOW() WHERE id = :id"
        ), {"id": order_id})
        db.commit()

        log_order_delete(db, current_user.tenant_id, current_user.id,
                         current_user.nickname or current_user.username,
                         "stock_transfer", order_id, order[1], before_data)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除挪货申请失败: {str(e)}")


@router.put("/{order_id}/confirm")
async def confirm_stock_transfer(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("stock_transfer:confirm"))
):
    try:
        order = db.execute(text(
            "SELECT id, order_number, status, tenant_id, target_warehouse FROM stock_transfer_orders WHERE id = :id AND deleted_at IS NULL"
        ), {"id": order_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="挪货申请不存在")
        if order[2] != "draft":
            raise HTTPException(status_code=400, detail=f"当前状态'{order[2]}'不允许审批")

        target_warehouse = order[4]

        items = db.execute(text("""
            SELECT stoi.id, stoi.batch_id, stoi.batch_number, stoi.shelf_number,
                   stoi.target_shelf_number, stoi.product_id, stoi.quantity,
                   p.name as product_name
            FROM stock_transfer_order_items stoi
            LEFT JOIN products p ON p.id = stoi.product_id
            WHERE stoi.stock_transfer_order_id = :oid AND stoi.deleted_at IS NULL
        """), {"oid": order_id}).fetchall()

        for item in items:
            batch_id = item[1]
            transfer_qty = int(item[6]) if item[6] else 0
            tgt_shelf = item[4]
            if batch_id and transfer_qty > 0:
                batch_info = db.execute(text("""
                    SELECT current_quantity, initial_quantity, unit_price, production_date,
                           expiry_date, inbound_order_id, inbound_item_id, batch_number,
                           warehouse, shelf_number, product_id, tenant_id
                    FROM inventory_batches
                    WHERE id = :bid AND deleted_at IS NULL
                """), {"bid": batch_id}).fetchone()

                if not batch_info:
                    continue

                current_qty = int(batch_info[0])
                unit_price = float(batch_info[2]) if batch_info[2] else 0

                if transfer_qty >= current_qty:
                    # 全部挪走：直接改原批次仓库和货架号
                    db.execute(text("""
                        UPDATE inventory_batches SET
                            warehouse = :wh,
                            shelf_number = :sn,
                            updated_at = NOW()
                        WHERE id = :bid
                    """), {
                        "wh": target_warehouse,
                        "sn": tgt_shelf if tgt_shelf else None,
                        "bid": batch_id,
                    })
                else:
                    # 部分挪货：拆批，原批次减量保留在原仓库，创建新批次到目标仓库
                    new_remain = current_qty - transfer_qty
                    db.execute(text("""
                        UPDATE inventory_batches SET
                            current_quantity = :cq,
                            updated_at = NOW()
                        WHERE id = :bid
                    """), {"cq": new_remain, "bid": batch_id})

                    db.execute(text("""
                        INSERT INTO inventory_batches
                            (tenant_id, product_id, batch_number,
                             initial_quantity, current_quantity, unit_price,
                             warehouse, shelf_number,
                             production_date, expiry_date,
                             inbound_order_id, inbound_item_id,
                             stock_transfer_order_id, stock_transfer_item_id,
                             inbound_date,
                             status, created_at, updated_at)
                        VALUES
                            (:tid, :pid, :bn,
                             :iq, :cq, :up,
                             :wh, :sn,
                             :pd, :ed,
                             :ioid, :iiid,
                             :stoid, :stiid,
                             NOW(),
                             'active', NOW(), NOW())
                    """), {
                        "tid": batch_info[11],
                        "pid": batch_info[10],
                        "bn": batch_info[7],
                        "iq": transfer_qty,
                        "cq": transfer_qty,
                        "up": unit_price,
                        "wh": target_warehouse,
                        "sn": tgt_shelf if tgt_shelf else None,
                        "pd": batch_info[3],
                        "ed": batch_info[4],
                        "ioid": batch_info[5],
                        "iiid": batch_info[6],
                        "stoid": order[0],
                        "stiid": item[0],
                    })

        db.execute(text("""
            UPDATE stock_transfer_orders SET
                status = 'confirmed', confirmed_by = :uid, confirmed_at = NOW(), updated_at = NOW()
            WHERE id = :id
        """), {"uid": current_user.id, "id": order_id})
        db.commit()

        log_order_confirm(db, current_user.tenant_id, current_user.id,
                          current_user.nickname or current_user.username,
                          "stock_transfer", order_id, order[1],
                          {"status": "draft"},
                          {"status": "confirmed", "target_warehouse": target_warehouse,
                           "items_count": len(items)})

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"审批挪货申请失败: {str(e)}")


@router.get("/warehouses/list")
async def get_available_warehouses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户下所有有库存的仓库列表"""
    try:
        rows = db.execute(text("""
            SELECT DISTINCT warehouse FROM inventory_batches
            WHERE tenant_id = :tid AND deleted_at IS NULL
              AND warehouse IS NOT NULL AND warehouse != ''
              AND current_quantity > 0
            ORDER BY warehouse
        """), {"tid": current_user.tenant_id}).fetchall()
        return [r[0] for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取仓库列表失败: {str(e)}")


@router.get("/products/by-warehouse")
async def get_products_by_warehouse(
    warehouse: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定仓库下可用库存的产品列表"""
    try:
        rows = db.execute(text("""
            SELECT DISTINCT ib.product_id, p.name, p.product_code,
                   ib.batch_number, ib.shelf_number, ib.current_quantity,
                   ib.unit_price, ib.id as batch_id, ib.warehouse
            FROM inventory_batches ib
            JOIN products p ON p.id = ib.product_id AND p.deleted_at IS NULL
            WHERE ib.tenant_id = :tid AND ib.deleted_at IS NULL
              AND ib.warehouse = :wh AND ib.current_quantity > 0
            ORDER BY p.name, ib.batch_number
        """), {"tid": current_user.tenant_id, "wh": warehouse}).fetchall()

        result = []
        for r in rows:
            result.append({
                "product_id": r[0],
                "product_name": r[1],
                "product_code": r[2] or "",
                "batch_number": r[3],
                "shelf_number": r[4] or "",
                "current_quantity": int(r[5]),
                "unit_price": float(r[6]) if r[6] else 0,
                "batch_id": r[7],
                "warehouse": r[8],
            })

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取仓库产品列表失败: {str(e)}")