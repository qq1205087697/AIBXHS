from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote
import logging

logger = logging.getLogger(__name__)

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create, log_order_update, log_order_confirm, log_order_cancel, log_order_delete
from services.excel_helper import create_purchase_excel_template, parse_purchase_excel

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase_orders"])


class PurchaseItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: Optional[float] = 0
    notes: Optional[str] = None
    supplier: Optional[str] = None


class PurchaseOrderCreate(BaseModel):
    order_number: str
    warehouse: Optional[str] = None
    store_group_id: Optional[int] = None
    notes: Optional[str] = None
    items: List[PurchaseItemCreate]


class PurchaseOrderUpdate(BaseModel):
    order_number: Optional[str] = None
    warehouse: Optional[str] = None
    store_group_id: Optional[int] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    items: Optional[List[PurchaseItemCreate]] = None  # 添加 items 字段


@router.get("/")
async def get_purchase_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["po.tenant_id = :tenant_id", "po.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if status:
            where_conditions.append("po.status = :status")
            params["status"] = status
        if search:
            where_conditions.append("po.order_number LIKE :search")
            params["search"] = f"%{search}%"
        if start_date:
            where_conditions.append("DATE(po.created_at) >= :start_date")
            params["start_date"] = start_date
        if end_date:
            where_conditions.append("DATE(po.created_at) <= :end_date")
            params["end_date"] = end_date

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM purchase_orders po WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT po.id, po.order_number,
                   po.warehouse, po.total_amount, po.status, po.notes, po.created_by,
                   po.approved_at, po.created_at, po.approved_by, po.store_group_id, po.platform,
                   sg.name AS store_group_name
            FROM purchase_orders po
            LEFT JOIN store_groups sg ON sg.id = po.store_group_id AND sg.deleted_at IS NULL
            WHERE {where_clause}
            ORDER BY po.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        # 收集所有用户ID
        user_ids = set()
        for row in rows:
            if row[6]:  # created_by
                user_ids.add(row[6])
            if row[10]:  # approved_by
                user_ids.add(row[10])
        
        # 批量查询用户信息
        user_map = {}
        if user_ids:
            # 构建查询参数，使用正确的格式处理IN子句
            if len(user_ids) == 1:
                # 单个用户ID
                user_id = next(iter(user_ids))
                user_rows = db.execute(text("""
                    SELECT id, nickname, username FROM users WHERE id = :id
                """), {"id": user_id}).fetchall()
            else:
                # 多个用户ID，动态构建占位符
                placeholders = ', '.join(f':id{i}' for i in range(len(user_ids)))
                user_id_list = list(user_ids)
                params = {f'id{i}': user_id_list[i] for i in range(len(user_id_list))}
                user_rows = db.execute(text(f"""
                    SELECT id, nickname, username FROM users WHERE id IN ({placeholders})
                """), params).fetchall()
            
            for ur in user_rows:
                user_map[ur[0]] = ur[1] or ur[2] or ''

        orders = []
        for row in rows:
            items = db.execute(text("""
                SELECT poi.id, poi.product_id, p.name as product_name, p.product_code,
                       poi.quantity, poi.received_quantity, poi.unit_price, poi.total_price, poi.notes, poi.supplier
                FROM purchase_order_items poi
                LEFT JOIN products p ON p.id = poi.product_id
                WHERE poi.purchase_order_id = :oid AND poi.deleted_at IS NULL
            """), {"oid": row[0]}).fetchall()

            # 查询该采购单的组装入库数据（batch_type='assembly'）
            assembly_data = db.execute(text("""
                SELECT
                    ab.product_id as finished_product_id,
                    p.name as finished_name,
                    p.product_code as finished_code,
                    SUM(ab.current_quantity) as total_assembly_quantity
                FROM inventory_batches ab
                JOIN products p ON p.id = ab.product_id AND p.deleted_at IS NULL
                JOIN inbound_orders io ON ab.inbound_order_id = io.id AND io.deleted_at IS NULL
                WHERE io.purchase_order_id = :po_id
                  AND ab.batch_type = 'assembly'
                  AND ab.deleted_at IS NULL
                GROUP BY ab.product_id, p.name, p.product_code
            """), {"po_id": row[0]}).fetchall()

            # 构建组装入库数据映射：finished_product_id -> {name, code, quantity}
            assembly_map = {}
            for assembly in assembly_data:
                assembly_map[assembly[0]] = {
                    "finished_name": assembly[1] or "",
                    "finished_code": assembly[2] or "",
                    "assembly_quantity": int(assembly[3])
                }

            # 查询配件与成品的绑定关系（配件对应的成品）
            # 对于配件产品，需要查询它被绑定到哪些成品
            product_ids_in_po = [item[1] for item in items]
            accessory_bindings = {}
            if product_ids_in_po:
                bindings = db.execute(text("""
                    SELECT pb.accessory_product_id, pb.finished_product_id, p.name as finished_name, p.product_code as finished_code
                    FROM product_bindings pb
                    JOIN products p ON p.id = pb.finished_product_id AND p.deleted_at IS NULL
                    WHERE pb.accessory_product_id IN :pids AND pb.deleted_at IS NULL
                """), {"pids": tuple(product_ids_in_po)}).fetchall()
                for b in bindings:
                    acc_id = b[0]
                    finished_id = b[1]
                    finished_name = b[2] or ""
                    finished_code = b[3] or ""
                    if acc_id not in accessory_bindings:
                        accessory_bindings[acc_id] = []
                    accessory_bindings[acc_id].append({
                        "finished_product_id": finished_id,
                        "finished_name": finished_name,
                        "finished_code": finished_code
                    })

            order_items = []
            for item in items:
                product_id = item[1]

                # 计算组装成品信息
                assembly_info = None

                # 如果是成品（在assembly_map中有记录），显示组装入库数量
                if product_id in assembly_map:
                    assembly_info = {
                        "product_name": assembly_map[product_id]["finished_name"],
                        "product_code": assembly_map[product_id]["finished_code"],
                        "quantity": assembly_map[product_id]["assembly_quantity"]
                    }

                # 如果是配件（在accessory_bindings中有记录），查找对应成品的组装入库数量
                elif product_id in accessory_bindings:
                    # 获取该配件绑定的成品列表
                    bound_finished_products = accessory_bindings[product_id]
                    # 查找有组装入库记录的成品
                    for finished_info in bound_finished_products:
                        finished_id = finished_info["finished_product_id"]
                        if finished_id in assembly_map:
                            assembly_info = {
                                "product_name": assembly_map[finished_id]["finished_name"],
                                "product_code": assembly_map[finished_id]["finished_code"],
                                "quantity": assembly_map[finished_id]["assembly_quantity"]
                            }
                            # 只显示第一个有组装记录的成品
                            break

                order_items.append({
                    "id": item[0],
                    "product_id": item[1],
                    "product_name": item[2] or f"产品#{item[1]}",
                    "product_code": item[3] or "",
                    "quantity": int(item[4]),
                    "received_quantity": int(item[5]),
                    "unit_price": float(item[6]) if item[6] else 0,
                    "total_price": float(item[7]) if item[7] else 0,
                    "notes": item[8] or "",
                    "supplier": item[9] or "",
                    "assembly_info": assembly_info  # 新增：组装成品信息
                })

            # 计算待入库/已入库件数：含配件的成品不计入，只算配件+独立成品
            product_ids_in_po = [item["product_id"] for item in order_items]
            finished_with_parts = set()
            if product_ids_in_po:
                # 查询哪些产品是"含配件的成品"（在product_bindings中作为finished_product_id存在）
                bind_rows = db.execute(text("""
                    SELECT DISTINCT pb.finished_product_id
                    FROM product_bindings pb
                    JOIN products p ON p.id = pb.accessory_product_id AND p.deleted_at IS NULL
                    WHERE pb.finished_product_id IN :pids AND pb.deleted_at IS NULL
                """), {"pids": tuple(product_ids_in_po)}).fetchall()
                finished_with_parts = {r[0] for r in bind_rows}

            total_ordered = sum(
                item["quantity"] for item in order_items
                if item["product_id"] not in finished_with_parts
            )
            total_received = sum(
                item["received_quantity"] for item in order_items
                if item["product_id"] not in finished_with_parts
            )

            orders.append({
                "id": row[0],
                "order_number": row[1],
                "warehouse": row[2] or "",
                "total_amount": float(row[3]) if row[3] else 0,
                "status": row[4],
                "notes": row[5] or "",
                "created_by": row[6],
                "approved_at": row[7].strftime("%Y-%m-%d %H:%M:%S") if row[7] else "",
                "created_at": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else "",
                "approved_by": row[9],
                "store_group_id": row[10],
                "store_group_name": row[12] or "",
                "platform": row[11] or "",
                "creator_name": user_map.get(row[6], ""),
                "approver_name": user_map.get(row[9], ""),
                # 汇总待入库和已入库件数（含配件的成品已排除）
                "total_ordered": total_ordered,
                "total_received": total_received,
                "items": order_items,
            })

        return {"success": True, "data": orders, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取采购订单失败: {str(e)}")


@router.post("/")
async def create_purchase_order(
    data: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("purchase:create"))
):
    try:
        # 确保 purchase_orders 表有 store_group_id 字段
        try:
            db.execute(text("""
                ALTER TABLE purchase_orders
                ADD COLUMN store_group_id INT NULL
                COMMENT '店铺分组ID'
                AFTER warehouse
            """))
            db.commit()
        except Exception:
            pass  # 字段已存在则忽略

        if not data.items:
            raise HTTPException(status_code=400, detail="请至少添加一条采购明细")

        # 验证 store_group_id 是否存在
        store_group_name = ""
        if data.store_group_id:
            group = db.execute(text("""
                SELECT id, name FROM store_groups
                WHERE id = :gid AND tenant_id = :tid AND deleted_at IS NULL
            """), {"gid": data.store_group_id, "tid": current_user.tenant_id}).fetchone()
            if not group:
                raise HTTPException(status_code=400, detail=f"店铺分组ID {data.store_group_id} 不存在")
            store_group_name = group[1]

        # 校验仓库是否存在，未指定时自动选择最新创建的仓库
        if data.warehouse:
            wh = db.execute(text(
                "SELECT id FROM warehouses WHERE name = :name AND tenant_id = :tid AND deleted_at IS NULL"
            ), {"name": data.warehouse, "tid": current_user.tenant_id}).fetchone()
            if not wh:
                raise HTTPException(status_code=400, detail=f"仓库 '{data.warehouse}' 不存在")
        else:
            latest_wh = db.execute(text("""
                SELECT name FROM warehouses
                WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'active'
                ORDER BY created_at DESC LIMIT 1
            """), {"tid": current_user.tenant_id}).fetchone()
            if latest_wh:
                data.warehouse = latest_wh[0]

        total_amt = sum((item.quantity * (item.unit_price or 0)) for item in data.items)

        db.execute(text("""
            INSERT INTO purchase_orders (tenant_id, order_number,
                warehouse, store_group_id, total_amount, status, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number,
                :warehouse, :store_group_id, :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "order_number": data.order_number,
            "warehouse": data.warehouse,
            "store_group_id": data.store_group_id,
            "total_amount": total_amt,
            "notes": data.notes,
            "created_by": current_user.id,
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        for item in data.items:
            total_price = item.quantity * (item.unit_price or 0)
            db.execute(text("""
                INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price, total_price, notes, supplier, created_at, updated_at)
                VALUES (:oid, :pid, :qty, :up, :tp, :notes, :supplier, :created_at, :updated_at)
            """), {
                "oid": order_id, "pid": item.product_id, "qty": item.quantity,
                "up": item.unit_price, "tp": total_price, "notes": item.notes, "supplier": item.supplier,
                "created_at": datetime.now(), "updated_at": datetime.now(),
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "purchase", order_id, data.order_number,
                         {"order_number": data.order_number, "店铺分组": store_group_name, "items_count": len(data.items)})
        db.commit()

        return {"success": True, "message": "采购订单创建成功", "data": {"id": order_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建采购订单失败: {str(e)}")


async def check_permission(permission_code: str, current_user: User, db: Session):
    """检查用户权限的辅助函数"""
    # 1. 先检查是否是管理员角色
    is_admin = False
    if current_user.role_id:
        role = db.execute(text("""
            SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
        """), {"role_id": current_user.role_id}).fetchone()
        if role and role[0] == "admin":
            is_admin = True
    
    if is_admin:
        return
    
    # 2. 检查RBAC权限
    has_perm = False
    if current_user.role_id:
        has_perm = db.execute(text("""
            SELECT 1
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id AND p.deleted_at IS NULL
            WHERE rp.role_id = :role_id AND rp.deleted_at IS NULL AND p.code = :perm_code
            LIMIT 1
        """), {"role_id": current_user.role_id, "perm_code": permission_code}).fetchone()
    
    if not has_perm:
        raise HTTPException(
            status_code=403,
            detail=f"缺少权限: {permission_code}"
        )


@router.put("/{order_id}")
async def update_purchase_order(
    order_id: int,
    data: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        row = db.execute(text(
            "SELECT id, order_number, status FROM purchase_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="采购订单不存在")

        before_status = row[2]
        before_data = {"order_number": row[1], "status": before_status}

        # 检查是否是审批操作
        is_approve = data.status == "approved"
        
        # 权限检查
        if is_approve:
            await check_permission("purchase:confirm", current_user, db)
        else:
            await check_permission("purchase:edit", current_user, db)

        # 校验仓库是否存在（更新时），未指定时自动选择最新创建的仓库
        if data.warehouse is not None:
            if data.warehouse != "":
                wh = db.execute(text(
                    "SELECT id FROM warehouses WHERE name = :name AND tenant_id = :tid AND deleted_at IS NULL"
                ), {"name": data.warehouse, "tid": current_user.tenant_id}).fetchone()
                if not wh:
                    raise HTTPException(status_code=400, detail=f"仓库 '{data.warehouse}' 不存在")
            else:
                latest_wh = db.execute(text("""
                    SELECT name FROM warehouses
                    WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'active'
                    ORDER BY created_at DESC LIMIT 1
                """), {"tid": current_user.tenant_id}).fetchone()
                if latest_wh:
                    data.warehouse = latest_wh[0]

        updates = []
        params = {"id": order_id}
        for field in ["order_number", "warehouse", "store_group_id", "notes", "status"]:
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = :{field}")
                params[field] = val

        if "status" in [k.strip().split()[0] for k in updates] and data.status == "approved":
            updates.append("approved_by = :approved_by")
            updates.append("approved_at = :approved_at")
            params["approved_by"] = current_user.id
            params["approved_at"] = datetime.now()

        if updates:
            db.execute(text(f"UPDATE purchase_orders SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"), params)
            db.commit()

        # 更新采购单明细（如果有传入 items）
        if data.items is not None:
            # 软删除旧的明细
            db.execute(text("UPDATE purchase_order_items SET deleted_at = NOW() WHERE purchase_order_id = :oid"), {"oid": order_id})
            # 插入新的明细
            for item in data.items:
                total_price = item.quantity * (item.unit_price or 0)
                db.execute(text("""
                    INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price, total_price, notes, supplier, created_at, updated_at)
                    VALUES (:oid, :pid, :qty, :up, :tp, :notes, :supplier, :created_at, :updated_at)
                """), {
                    "oid": order_id, "pid": item.product_id, "qty": item.quantity,
                    "up": item.unit_price, "tp": total_price, "notes": item.notes, "supplier": item.supplier,
                    "created_at": datetime.now(), "updated_at": datetime.now(),
                })
            db.commit()

        after_data = {"order_number": row[1], "status": data.status or before_status}

        # 采购单变为 completed 时，自动更新关联补货单为 completed
        if data.status == "completed" and before_status != "completed":
            replenishment_rows = db.execute(text("""
                SELECT id FROM replenishment_orders
                WHERE purchase_order_id = :po_id AND deleted_at IS NULL AND status IN ('pending', 'purchased')
            """), {"po_id": order_id}).fetchall()
            if replenishment_rows:
                rep_ids = [r[0] for r in replenishment_rows]
                rep_placeholders = ', '.join(f':rid{i}' for i in range(len(rep_ids)))
                rep_params = {f'rid{i}': rep_ids[i] for i in range(len(rep_ids))}
                db.execute(text(f"""
                    UPDATE replenishment_orders SET status = 'completed', updated_at = NOW()
                    WHERE id IN ({rep_placeholders}) AND deleted_at IS NULL
                """), rep_params)
                db.commit()
                logger.info(f"采购单 {order_id} 变为已完成，已自动更新 {len(rep_ids)} 条关联补货单状态为 completed")

        if is_approve:
            log_order_confirm(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                             "purchase", order_id, row[1],
                             {"status": before_status}, {"status": "approved"})
            db.commit()

            # 自动更新关联的补货单状态为 purchased
            replenishment_rows = db.execute(text("""
                SELECT id FROM replenishment_orders
                WHERE purchase_order_id = :po_id AND deleted_at IS NULL AND status = 'pending'
            """), {"po_id": order_id}).fetchall()
            if replenishment_rows:
                rep_ids = [r[0] for r in replenishment_rows]
                rep_placeholders = ', '.join(f':rid{i}' for i in range(len(rep_ids)))
                rep_params = {f'rid{i}': rep_ids[i] for i in range(len(rep_ids))}
                db.execute(text(f"""
                    UPDATE replenishment_orders SET status = 'purchased', updated_at = NOW()
                    WHERE id IN ({rep_placeholders}) AND deleted_at IS NULL
                """), rep_params)
                db.commit()
                logger.info(f"采购单 {order_id} 审批通过，已自动更新 {len(rep_ids)} 条关联补货单状态为 purchased，IDs: {rep_ids}")
            else:
                logger.info(f"采购单 {order_id} 审批通过，无关联补货单需要更新")
        else:
            log_order_update(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                             "purchase", order_id, row[1], before_data, after_data)
            db.commit()

        return {"success": True, "message": "采购订单更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新采购订单失败: {str(e)}")


@router.post("/{order_id}/cancel-approval")
async def cancel_purchase_approval(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """管理员取消采购单审批"""
    try:
        # 检查用户是否是管理员
        await check_permission("admin", current_user, db)

        row = db.execute(text(
            "SELECT id, order_number, status FROM purchase_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="采购订单不存在")

        current_status = row[2]
        if current_status != "approved":
            raise HTTPException(status_code=400, detail="只有已审批状态的采购单才能取消审批")

        # 取消审批：状态改为 draft，清除审批人和审批时间
        db.execute(text("""
            UPDATE purchase_orders
            SET status = 'draft', approved_by = NULL, approved_at = NULL, updated_at = NOW()
            WHERE id = :id
        """), {"id": order_id})
        db.commit()

        return {"success": True, "message": "取消审批成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"取消审批失败: {str(e)}")


@router.delete("/{order_id}")
async def delete_purchase_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("purchase:delete"))
):
    try:
        row = db.execute(text(
            "SELECT id, order_number, status FROM purchase_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="采购订单不存在")

        before_data = {"order_number": row[1], "status": row[2]}

        # 清除关联的补货单的purchase_order_id
        db.execute(text("""
            UPDATE replenishment_orders
            SET purchase_order_id = NULL, updated_at = NOW()
            WHERE purchase_order_id = :po_id AND tenant_id = :tid
        """), {"po_id": order_id, "tid": current_user.tenant_id})

        # 软删除采购单
        db.execute(text("UPDATE purchase_orders SET deleted_at = NOW() WHERE id = :id"), {"id": order_id})
        db.execute(text("UPDATE purchase_order_items SET deleted_at = NOW() WHERE purchase_order_id = :oid"), {"oid": order_id})
        db.commit()

        log_order_delete(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "purchase", order_id, row[1], before_data)
        db.commit()

        return {"success": True, "message": "采购订单已删除，关联的补货单已解除关联"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除采购订单失败: {str(e)}")


@router.get("/template/download")
async def download_purchase_template(
    current_user: User = Depends(get_current_user)
):
    """下载采购单Excel模板"""
    try:
        file_stream = create_purchase_excel_template()
        filename = f"采购单模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
        encoded_filename = quote(filename)
        return StreamingResponse(
            file_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={encoded_filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


@router.post("/upload/preview")
async def upload_purchase_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """上传采购单Excel预览"""
    try:
        if not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="请上传Excel文件 (.xlsx/.xls)")
        
        file_bytes = await file.read()
        items = parse_purchase_excel(file_bytes, db, current_user.tenant_id)
        parsed_items = items.get("items", items) if isinstance(items, dict) else items
        order_info = items.get("order_info", {}) if isinstance(items, dict) else {}

        # 补充产品信息
        product_ids = [item["product_id"] for item in parsed_items]
        product_map = {}
        if product_ids:
            products = db.execute(text("""
                SELECT id, product_code, name
                FROM products
                WHERE id IN :ids AND deleted_at IS NULL
            """), {"ids": tuple(product_ids)}).fetchall()
            product_map = {p[0]: {"code": p[1], "name": p[2]} for p in products}

        # 查询这些产品绑定的配件（成品→配件）
        bindings_map = {}
        if product_ids:
            bindings = db.execute(text("""
                SELECT pb.finished_product_id, p.id AS accessory_product_id, p.product_code, p.name, p.purchase_price, pb.quantity
                FROM product_bindings pb
                JOIN products p ON p.id = pb.accessory_product_id
                WHERE pb.finished_product_id IN :fids AND pb.deleted_at IS NULL AND p.deleted_at IS NULL
            """), {"fids": tuple(product_ids)}).fetchall()
            for b in bindings:
                bindings_map.setdefault(b[0], []).append({
                    "accessory_product_id": b[1],
                    "code": b[2], "name": b[3], "unit_price": b[4], "qty": b[5]
                })

        for item in parsed_items:
            pid = item["product_id"]
            info = product_map.get(pid, {})
            item["product_code"] = info.get("code", "")
            item["product_name"] = info.get("name", "")
            # 绑定配件信息
            item["bindings"] = bindings_map.get(pid, [])

        return {"success": True, "data": parsed_items, "order_info": order_info}
    except HTTPException:
        raise
    except ValueError as e:
        # 业务错误（如产品编码不存在）返回400
        raise HTTPException(status_code=400, detail=f"{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析Excel失败: {str(e)}")
