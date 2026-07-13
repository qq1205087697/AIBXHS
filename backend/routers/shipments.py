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

router = APIRouter(prefix="/api/shipments", tags=["shipments"])


class ShipmentItemCreate(BaseModel):
    product_id: Optional[int] = None
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    stock_quantity: Optional[int] = 0
    red_list: Optional[str] = None
    sea_freight: Optional[str] = None
    notes: Optional[str] = None


class ShipmentCreate(BaseModel):
    order_number: str
    store_group_id: Optional[int] = None
    store_group_name: Optional[str] = None
    notes: Optional[str] = None
    items: List[ShipmentItemCreate]


class ShipmentUpdate(BaseModel):
    order_number: Optional[str] = None
    store_group_id: Optional[int] = None
    store_group_name: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[ShipmentItemCreate]] = None


@router.get("/")
async def get_shipments(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    store_group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["so.tenant_id = :tenant_id", "so.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if status:
            where_conditions.append("so.status = :status")
            params["status"] = status
        if search:
            where_conditions.append("(so.order_number LIKE :search OR so.store_group_name LIKE :search OR so.notes LIKE :search)")
            params["search"] = f"%{search}%"
        if start_date:
            where_conditions.append("DATE(so.created_at) >= :start_date")
            params["start_date"] = start_date
        if end_date:
            where_conditions.append("DATE(so.created_at) <= :end_date")
            params["end_date"] = end_date
        if store_group_id:
            where_conditions.append("so.store_group_id = :store_group_id")
            params["store_group_id"] = store_group_id

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM shipment_orders so WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT so.id, so.order_number, so.store_group_id, so.store_group_name,
                   so.total_quantity, so.status, so.notes,
                   so.created_by, so.confirmed_by, so.confirmed_at, so.created_at
            FROM shipment_orders so
            WHERE {where_clause}
            ORDER BY so.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        user_ids = set()
        for row in rows:
            if row[7]:
                user_ids.add(row[7])
            if row[8]:
                user_ids.add(row[8])

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
                "store_group_id": row[2],
                "store_group_name": row[3] or "",
                "total_quantity": int(row[4]) if row[4] else 0,
                "status": row[5],
                "notes": row[6],
                "created_by": row[7],
                "creator_name": user_map.get(row[7], "") if row[7] else "",
                "confirmed_by": row[8],
                "confirmer_name": user_map.get(row[8], "") if row[8] else "",
                "confirmed_at": row[9].strftime("%Y-%m-%d %H:%M:%S") if row[9] else None,
                "created_at": row[10].strftime("%Y-%m-%d %H:%M:%S") if row[10] else "",
            })

        return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取发货单失败: {str(e)}")


@router.post("/")
async def create_shipment(
    data: ShipmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("shipment:create"))
):
    try:
        order_number = f"FH{datetime.now().strftime('%Y%m%d%H%M%S')}"
        total_qty = sum((item.stock_quantity or 0) for item in data.items)
        creator_name = current_user.nickname or current_user.username

        db.execute(text("""
            INSERT INTO shipment_orders (tenant_id, order_number, store_group_id, store_group_name,
                total_quantity, status, notes,
                created_by, creator_name, created_at, updated_at)
            VALUES (:tid, :num, :sg_id, :sg_name, :tq, 'draft', :notes, :uid, :cname, NOW(), NOW())
        """), {
            "tid": current_user.tenant_id, "num": order_number,
            "sg_id": data.store_group_id, "sg_name": data.store_group_name,
            "tq": total_qty, "notes": data.notes,
            "uid": current_user.id, "cname": creator_name,
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        for item in data.items:
            pid = item.product_id
            if pid is None and item.product_code:
                product = db.execute(text(
                    "SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"
                ), {"code": item.product_code, "tid": current_user.tenant_id}).fetchone()
                if product:
                    pid = product[0]
            db.execute(text("""
                INSERT INTO shipment_order_items (tenant_id, shipment_order_id, product_id,
                    product_code, product_name, stock_quantity, created_at, updated_at)
                VALUES (:tid, :oid, :pid, :pcode, :pname, :sqty, NOW(), NOW())
            """), {
                "tid": current_user.tenant_id, "oid": order_id, "pid": pid,
                "pcode": item.product_code, "pname": item.product_name,
                "sqty": item.stock_quantity or 0,
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, creator_name,
                         "shipment", order_id, order_number,
                         {"store_group_id": data.store_group_id,
                          "store_group_name": data.store_group_name or "",
                          "items_count": len(data.items)})
        db.commit()

        return {"success": True, "id": order_id, "order_number": order_number}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建发货单失败: {str(e)}")


@router.get("/kpi-count")
async def get_kpi_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取待处理的发货单数量（KPI卡片）"""
    try:
        count = db.execute(text(
            "SELECT COUNT(*) FROM shipment_orders WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'draft'"
        ), {"tid": current_user.tenant_id}).scalar() or 0
        return {"success": True, "pending_shipments": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取发货单KPI数量失败: {str(e)}")


@router.get("/{order_id}")
async def get_shipment_detail(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        order = db.execute(text("""
            SELECT so.id, so.order_number, so.store_group_id, so.store_group_name,
                   so.total_quantity, so.status, so.notes,
                   so.created_by, so.confirmed_by, so.confirmed_at, so.created_at
            FROM shipment_orders so
            WHERE so.id = :id AND so.tenant_id = :tid AND so.deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()

        if not order:
            raise HTTPException(status_code=404, detail="发货单不存在")

        items = db.execute(text("""
            SELECT soi.id, soi.product_id, soi.product_code, soi.product_name,
                   soi.stock_quantity,
                   soi.red_list, soi.sea_freight, soi.notes
            FROM shipment_order_items soi
            WHERE soi.shipment_order_id = :oid AND soi.deleted_at IS NULL
        """), {"oid": order_id}).fetchall()

        item_list = []
        for it in items:
            item_list.append({
                "id": it[0],
                "product_id": it[1],
                "product_code": it[2] or "",
                "product_name": it[3] or "",
                "stock_quantity": int(it[4]) if it[4] else 0,
                "red_list": it[5] or "",
                "sea_freight": it[6] or "",
                "notes": it[7] or "",
            })

        user_ids = set()
        if order[7]:
            user_ids.add(order[7])
        if order[8]:
            user_ids.add(order[8])
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
            "store_group_id": order[2],
            "store_group_name": order[3] or "",
            "total_quantity": int(order[4]) if order[4] else 0,
            "status": order[5],
            "notes": order[6] or "",
            "created_by": order[7],
            "creator_name": user_map.get(order[7], "") if order[7] else "",
            "confirmed_by": order[8],
            "confirmer_name": user_map.get(order[8], "") if order[8] else "",
            "confirmed_at": order[9].strftime("%Y-%m-%d %H:%M:%S") if order[9] else None,
            "created_at": order[10].strftime("%Y-%m-%d %H:%M:%S") if order[10] else "",
            "items": item_list,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取发货单详情失败: {str(e)}")


@router.put("/{order_id}")
async def update_shipment(
    order_id: int,
    data: ShipmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("shipment:edit"))
):
    try:
        order = db.execute(text(
            "SELECT id, status, order_number, store_group_id, store_group_name FROM shipment_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="发货单不存在")
        if order[1] != "draft":
            raise HTTPException(status_code=400, detail="只有草稿状态的发货单可以编辑")

        before_data = {
            "order_number": order[2],
            "store_group_id": order[3],
            "store_group_name": order[4],
        }

        set_parts = ["updated_at = NOW()"]
        params = {"id": order_id}
        order_number = order[2]

        if data.order_number is not None:
            set_parts.append("order_number = :num")
            params["num"] = data.order_number
            order_number = data.order_number
        if data.store_group_id is not None:
            set_parts.append("store_group_id = :sg_id")
            params["sg_id"] = data.store_group_id
        if data.store_group_name is not None:
            set_parts.append("store_group_name = :sg_name")
            params["sg_name"] = data.store_group_name
        if data.notes is not None:
            set_parts.append("notes = :notes")
            params["notes"] = data.notes

        # 如果有items，先软删除旧items再插入新items
        if data.items:
            db.execute(text(
                "UPDATE shipment_order_items SET deleted_at = NOW() WHERE shipment_order_id = :oid AND deleted_at IS NULL"
            ), {"oid": order_id})

            total_qty = sum((item.stock_quantity or 0) for item in data.items)
            set_parts.append("total_quantity = :tq")
            params["tq"] = total_qty

            for item in data.items:
                pid = item.product_id
                if pid is None and item.product_code:
                    product = db.execute(text(
                        "SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"
                    ), {"code": item.product_code, "tid": current_user.tenant_id}).fetchone()
                    if product:
                        pid = product[0]
                db.execute(text("""
                    INSERT INTO shipment_order_items (tenant_id, shipment_order_id, product_id,
                        product_code, product_name, stock_quantity,
                        red_list, sea_freight, notes, created_at, updated_at)
                    VALUES (:tid, :oid, :pid, :pcode, :pname, :sqty,
                        :red_list, :sea_freight, :notes, NOW(), NOW())
                """), {
                    "tid": current_user.tenant_id, "oid": order_id, "pid": pid,
                    "pcode": item.product_code, "pname": item.product_name,
                    "sqty": item.stock_quantity or 0,
                    "red_list": item.red_list,
                    "sea_freight": item.sea_freight,
                    "notes": item.notes,
                })

        db.execute(text(f"UPDATE shipment_orders SET {', '.join(set_parts)} WHERE id = :id"), params)
        db.commit()

        after_data = {
            "order_number": order_number,
            "store_group_id": data.store_group_id if data.store_group_id is not None else order[3],
            "store_group_name": data.store_group_name if data.store_group_name is not None else order[4],
        }

        log_order_update(db, current_user.tenant_id, current_user.id,
                         current_user.nickname or current_user.username,
                         "shipment", order_id, order_number,
                         before_data, after_data)
        db.commit()

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新发货单失败: {str(e)}")


@router.put("/{order_id}/confirm")
async def confirm_shipment(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("shipment:confirm"))
):
    try:
        order = db.execute(text(
            "SELECT id, order_number, status FROM shipment_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="发货单不存在")
        if order[2] != "draft":
            raise HTTPException(status_code=400, detail=f"当前状态'{order[2]}'不允许确认")

        confirmer_name = current_user.nickname or current_user.username
        db.execute(text("""
            UPDATE shipment_orders SET
                status = 'confirmed',
                confirmed_by = :uid,
                confirmer_name = :cname,
                confirmed_at = NOW(),
                updated_at = NOW()
            WHERE id = :id
        """), {"uid": current_user.id, "cname": confirmer_name, "id": order_id})
        db.commit()

        log_order_confirm(db, current_user.tenant_id, current_user.id, confirmer_name,
                          "shipment", order_id, order[1],
                          {"status": "draft"},
                          {"status": "confirmed"})
        db.commit()

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"确认发货单失败: {str(e)}")


@router.delete("/{order_id}")
async def delete_shipment(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("shipment:delete"))
):
    try:
        order = db.execute(text(
            "SELECT id, order_number, status FROM shipment_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="发货单不存在")

        order_status = order[2]

        before_data = {"order_number": order[1], "status": order_status}

        db.execute(text(
            "UPDATE shipment_order_items SET deleted_at = NOW() WHERE shipment_order_id = :oid AND deleted_at IS NULL"
        ), {"oid": order_id})
        db.execute(text(
            "UPDATE shipment_orders SET deleted_at = NOW() WHERE id = :id"
        ), {"id": order_id})
        db.commit()

        log_order_delete(db, current_user.tenant_id, current_user.id,
                         current_user.nickname or current_user.username,
                         "shipment", order_id, order[1], before_data)
        db.commit()

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除发货单失败: {str(e)}")