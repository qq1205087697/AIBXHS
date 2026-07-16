from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, date
from decimal import Decimal
from urllib.parse import quote

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create, log_order_confirm, log_order_cancel, log_order_delete, log_order_update
from services.inventory_batch import create_inventory_batch, recalculate_product_local_stock, deduce_inventory_fifo, apply_deduction
from services.excel_helper import create_inbound_excel_template, parse_inbound_excel

router = APIRouter(prefix="/api/inbound-orders", tags=["inbound_orders"])


class InboundItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: Optional[float] = 0
    batch_number: Optional[str] = None
    production_date: Optional[str] = None
    expiry_date: Optional[str] = None
    warehouse: Optional[str] = None
    shelf_number: Optional[str] = None
    notes: Optional[str] = None
    purchase_order_item_id: Optional[int] = None  # 关联的采购单明细ID


class InboundOrderCreate(BaseModel):
    order_number: str
    inbound_type: str = "purchase"
    purchase_order_id: Optional[int] = None
    warehouse: Optional[str] = None
    handler: Optional[str] = None
    inbound_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[InboundItemCreate]


class InboundOrderUpdate(BaseModel):
    order_number: Optional[str] = None
    inbound_type: Optional[str] = None
    purchase_order_id: Optional[int] = None
    warehouse: Optional[str] = None
    handler: Optional[str] = None
    inbound_date: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[InboundItemCreate]] = None


@router.get("/")
async def get_inbound_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    inbound_type: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["io.tenant_id = :tenant_id", "io.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if status:
            where_conditions.append("io.status = :status")
            params["status"] = status
        if inbound_type:
            where_conditions.append("io.inbound_type = :inbound_type")
            params["inbound_type"] = inbound_type
        if search:
            where_conditions.append("(io.order_number LIKE :search OR io.handler LIKE :search)")
            params["search"] = f"%{search}%"
        if start_date:
            where_conditions.append("DATE(io.created_at) >= :start_date")
            params["start_date"] = start_date
        if end_date:
            where_conditions.append("DATE(io.created_at) <= :end_date")
            params["end_date"] = end_date

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM inbound_orders io WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT io.id, io.order_number, io.inbound_type, io.purchase_order_id, io.warehouse,
                   io.handler, io.inbound_date, io.total_quantity, io.total_amount,
                   io.status, io.notes, io.created_by, io.confirmed_at, io.created_at,
                   io.confirmed_by
            FROM inbound_orders io
            WHERE {where_clause}
            ORDER BY io.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()
        
        # 收集所有用户ID
        user_ids = set()
        for row in rows:
            if row[11]:  # created_by
                user_ids.add(row[11])
            if row[14]:  # confirmed_by
                user_ids.add(row[14])
        
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
                SELECT ioi.id, ioi.product_id, p.name as product_name, p.product_code,
                       ioi.quantity, ioi.unit_price, ioi.total_price, ioi.batch_number,
                       ioi.production_date, ioi.expiry_date, ioi.warehouse, ioi.shelf_number,
                       ioi.notes, ioi.purchase_order_item_id, po.order_number as purchase_order_number
                FROM inbound_order_items ioi
                LEFT JOIN products p ON p.id = ioi.product_id
                LEFT JOIN purchase_order_items poi ON poi.id = ioi.purchase_order_item_id
                LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
                WHERE ioi.inbound_order_id = :oid AND ioi.deleted_at IS NULL
            """), {"oid": row[0]}).fetchall()

            order_items = []
            for item in items:
                order_items.append({
                    "id": item[0],
                    "product_id": item[1],
                    "product_name": item[2] or f"产品#{item[1]}",
                    "product_code": item[3] or "",
                    "quantity": int(item[4]),
                    "unit_price": float(item[5]) if item[5] else 0,
                    "total_price": float(item[6]) if item[6] else 0,
                    "batch_number": item[7] or "",
                    "production_date": item[8].strftime("%Y-%m-%d") if item[8] else "",
                    "expiry_date": item[9].strftime("%Y-%m-%d") if item[9] else "",
                    "warehouse": item[10] or "",
                    "shelf_number": item[11] or "",
                    "notes": item[12] or "",
                    "purchase_order_item_id": item[13],
                    "purchase_order_number": item[14] or "",
                })

            orders.append({
                "id": row[0],
                "order_number": row[1],
                "inbound_type": row[2],
                "purchase_order_id": row[3],
                "warehouse": row[4] or "",
                "handler": row[5] or "",
                "inbound_date": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
                "total_quantity": int(row[7]),
                "total_amount": float(row[8]) if row[8] else 0,
                "status": row[9],
                "notes": row[10] or "",
                "created_by": row[11],
                "confirmed_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else "",
                "created_at": row[13].strftime("%Y-%m-%d %H:%M:%S") if row[13] else "",
                "confirmed_by": row[14],
                "creator_name": user_map.get(row[11], ""),
                "confirmer_name": user_map.get(row[14], ""),
                "items": order_items,
            })

        return {"success": True, "data": orders, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取入库订单失败: {str(e)}")


@router.post("/")
async def create_inbound_order(
    data: InboundOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:create"))
):
    try:
        if not data.items:
            raise HTTPException(status_code=400, detail="请至少添加一条入库明细")

        # 仓库未指定时自动选择最新创建的仓库
        if not data.warehouse:
            latest_wh = db.execute(text("""
                SELECT name FROM warehouses
                WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'active'
                ORDER BY created_at DESC LIMIT 1
            """), {"tid": current_user.tenant_id}).fetchone()
            if latest_wh:
                data.warehouse = latest_wh[0]

        total_qty = sum(item.quantity for item in data.items)
        total_amt = sum((item.quantity * (item.unit_price or 0)) for item in data.items)

        # 正确处理入库日期
        inbound_date_value = datetime.now()
        if data.inbound_date:
            try:
                # 如果传入的是字符串，尝试解析
                inbound_date_value = datetime.strptime(data.inbound_date, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                try:
                    inbound_date_value = datetime.strptime(data.inbound_date, "%Y-%m-%d")
                except ValueError:
                    inbound_date_value = datetime.now()
        
        db.execute(text("""
            INSERT INTO inbound_orders (tenant_id, order_number, inbound_type, purchase_order_id,
                warehouse, handler, inbound_date, total_quantity, total_amount, status, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :inbound_type, :purchase_order_id,
                :warehouse, :handler, :inbound_date, :total_quantity, :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "order_number": data.order_number,
            "inbound_type": data.inbound_type,
            "purchase_order_id": data.purchase_order_id,
            "warehouse": data.warehouse,
            "handler": data.handler,
            "inbound_date": inbound_date_value,
            "total_quantity": total_qty,
            "total_amount": total_amt,
            "notes": data.notes,
            "created_by": current_user.id,
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        # 确保 inbound_order_items 表有 purchase_order_item_id 字段
        try:
            db.execute(text("""
                ALTER TABLE inbound_order_items
                ADD COLUMN purchase_order_item_id INT NULL
                COMMENT '关联的采购单明细ID'
                AFTER notes
            """))
            db.commit()
        except Exception:
            pass  # 字段已存在则忽略

        for item in data.items:
            total_price = item.quantity * (item.unit_price or 0)
            db.execute(text("""
                INSERT INTO inbound_order_items (inbound_order_id, product_id, quantity, unit_price, total_price,
                    batch_number, production_date, expiry_date, warehouse, shelf_number, notes,
                    purchase_order_item_id, created_at, updated_at)
                VALUES (:inbound_order_id, :product_id, :quantity, :unit_price, :total_price,
                    :batch_number, :production_date, :expiry_date, :warehouse, :shelf_number, :notes,
                    :purchase_order_item_id, :created_at, :updated_at)
            """), {
                "inbound_order_id": order_id,
                "product_id": item.product_id,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "total_price": total_price,
                "batch_number": item.batch_number,
                "production_date": item.production_date,
                "expiry_date": item.expiry_date,
                "warehouse": item.warehouse or data.warehouse,
                "shelf_number": item.shelf_number,
                "notes": item.notes,
                "purchase_order_item_id": item.purchase_order_item_id,
                "created_at": datetime.now(),
                "updated_at": datetime.now(),
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "inbound", order_id, data.order_number,
                         {"order_number": data.order_number, "items_count": len(data.items), "total_quantity": total_qty})
        db.commit()

        return {"success": True, "message": "入库订单创建成功", "data": {"id": order_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建入库订单失败: {str(e)}")


@router.put("/{order_id}")
async def update_inbound_order(
    order_id: int,
    data: InboundOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:edit"))
):
    try:
        row = db.execute(text(
            "SELECT id, order_number, status, warehouse, notes FROM inbound_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="入库订单不存在")
        if row[2] != "draft":
            raise HTTPException(status_code=400, detail="只能修改草稿状态的订单")
        
        before_data = {"order_number": row[1], "status": row[2], "warehouse": row[3], "notes": row[4]}
        if data.items:
            before_data["items_count"] = db.execute(text(
                "SELECT COUNT(*) FROM inbound_order_items WHERE inbound_order_id = :oid AND deleted_at IS NULL"
            ), {"oid": order_id}).scalar()

        # 仓库未指定时自动选择最新创建的仓库
        if data.warehouse is not None and data.warehouse == "":
            latest_wh = db.execute(text("""
                SELECT name FROM warehouses
                WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'active'
                ORDER BY created_at DESC LIMIT 1
            """), {"tid": current_user.tenant_id}).fetchone()
            if latest_wh:
                data.warehouse = latest_wh[0]

        updates = []
        params = {"id": order_id}
        for field in ["order_number", "inbound_type", "purchase_order_id", "warehouse", "handler", "inbound_date", "notes"]:
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = :{field}")
                params[field] = val

        # 如果有items，先处理items
        if data.items:
            # 先软删除旧的items
            db.execute(text("UPDATE inbound_order_items SET deleted_at = NOW() WHERE inbound_order_id = :oid"), {"oid": order_id})
            
            # 计算新的总数和总金额
            total_qty = sum(item.quantity for item in data.items)
            total_amt = sum((item.quantity * (item.unit_price or 0)) for item in data.items)
            
            # 添加到更新列表
            updates.append("total_quantity = :total_qty")
            updates.append("total_amount = :total_amt")
            params["total_qty"] = total_qty
            params["total_amt"] = total_amt
            
            # 插入新的items
            # 确保 inbound_order_items 表有 purchase_order_item_id 字段
            try:
                db.execute(text("""
                    ALTER TABLE inbound_order_items
                    ADD COLUMN purchase_order_item_id INT NULL
                    COMMENT '关联的采购单明细ID'
                    AFTER notes
                """))
                db.commit()
            except Exception:
                pass  # 字段已存在则忽略

            for item in data.items:
                total_price = item.quantity * (item.unit_price or 0)
                db.execute(text("""
                    INSERT INTO inbound_order_items (inbound_order_id, product_id, quantity, unit_price, total_price,
                        batch_number, production_date, expiry_date, warehouse, shelf_number, notes,
                        purchase_order_item_id, created_at, updated_at)
                    VALUES (:inbound_order_id, :product_id, :quantity, :unit_price, :total_price,
                        :batch_number, :production_date, :expiry_date, :warehouse, :shelf_number, :notes,
                        :purchase_order_item_id, :created_at, :updated_at)
                """), {
                    "inbound_order_id": order_id,
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "total_price": total_price,
                    "batch_number": item.batch_number,
                    "production_date": item.production_date,
                    "expiry_date": item.expiry_date,
                    "warehouse": item.warehouse or data.warehouse,
                    "shelf_number": item.shelf_number,
                    "notes": item.notes,
                    "purchase_order_item_id": item.purchase_order_item_id,
                    "created_at": datetime.now(),
                    "updated_at": datetime.now(),
                })

        # 执行更新
        if updates:
            db.execute(text(f"UPDATE inbound_orders SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"), params)
            db.commit()

        after_data = {"order_number": row[1]}
        if data.items:
            after_data["items_count"] = len(data.items)
        log_order_update(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "inbound", order_id, row[1], before_data, after_data)
        db.commit()

        return {"success": True, "message": "入库订单更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新入库订单失败: {str(e)}")


@router.put("/{order_id}/confirm")
async def confirm_inbound_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:confirm"))
):
    """确认入库订单，校验采购单数量差异并更新采购单已收货数量"""
    try:
        # ========== 先执行所有DDL语句（DDL会隐式commit，必须在数据修改前执行）==========
        # 确保 inbound_order_items 表有 purchase_order_item_id 字段
        try:
            db.execute(text("""
                ALTER TABLE inbound_order_items
                ADD COLUMN purchase_order_item_id INT NULL
                COMMENT '关联的采购单明细ID'
                AFTER notes
            """))
        except Exception:
            pass  # 字段已存在则忽略
        
        # 确保 inventory_batches 表有组装入库相关字段
        try:
            db.execute(text("""
                ALTER TABLE inventory_batches
                ADD COLUMN batch_type VARCHAR(20) DEFAULT 'purchase' COMMENT '批次类型: purchase=采购入库, assembly=组装入库'
            """))
        except Exception:
            pass
        try:
            db.execute(text("""
                ALTER TABLE inventory_batches
                ADD COLUMN source_batch_id INT NULL COMMENT '来源批次ID(组装入库时记录配件批次)'
            """))
        except Exception:
            pass
        try:
            db.execute(text("""
                ALTER TABLE inventory_batches
                ADD COLUMN assembly_quantity INT NULL COMMENT '组装数量(每个成品消耗的配件数量)'
            """))
        except Exception:
            pass
        
        # ========== 开始数据操作（DDL的隐式commit已完成，后续操作在一个事务中）==========
        
        order = db.execute(text(
            "SELECT id, order_number, status, tenant_id, warehouse, total_quantity, created_at, purchase_order_id FROM inbound_orders WHERE id = :id AND deleted_at IS NULL"
        ), {"id": order_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="入库订单不存在")
        if order[2] != "draft":
            raise HTTPException(status_code=400, detail=f"当前状态'{order[2]}'不允许确认")

        # 检查是否有未处理的数量差异
        try:
            db.execute(text("SELECT diff_resolution FROM inbound_order_items LIMIT 1"))
            unresolved = db.execute(text("""
                SELECT ioi.id, p.name as product_name,
                       ioi.quantity as inbound_qty,
                       po.order_number as po_number,
                       (poi.quantity - COALESCE(poi.received_quantity, 0)) as remaining_qty
                FROM inbound_order_items ioi
                LEFT JOIN products p ON p.id = ioi.product_id
                LEFT JOIN purchase_order_items poi ON poi.id = ioi.purchase_order_item_id
                LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
                WHERE ioi.inbound_order_id = :oid AND ioi.deleted_at IS NULL
                  AND ioi.purchase_order_item_id IS NOT NULL
                  AND (ioi.diff_resolution IS NULL OR ioi.diff_resolution = '')
                  AND ioi.quantity <> (poi.quantity - COALESCE(poi.received_quantity, 0))
            """), {"oid": order_id}).fetchall()
            if unresolved:
                items_text = ", ".join(
                    f"{row[1] or '未知产品'}(入库{int(row[2])}件,应收{int(row[4])}件,差异{abs(int(row[2])-int(row[4]))}件)"
                    for row in unresolved[:5]
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"该入库单存在 {len(unresolved)} 条未处理的数量差异，请先在KPI页面处理差异后再审批。未处理项: {items_text}"
                )
        except HTTPException:
            raise
        except Exception:
            pass  # 字段不存在则跳过检查

        items = db.execute(text(
            """SELECT ioi.id, ioi.product_id, ioi.quantity, ioi.unit_price, ioi.warehouse,
                      ioi.batch_number, ioi.production_date, ioi.expiry_date, ioi.shelf_number,
                      ioi.purchase_order_item_id
               FROM inbound_order_items ioi
               WHERE ioi.inbound_order_id = :oid AND ioi.deleted_at IS NULL"""
        ), {"oid": order_id}).fetchall()

        before_status = order[2]
        created_at = order[6]

        if not isinstance(created_at, datetime):
            try:
                created_at = datetime.strptime(str(created_at), "%Y-%m-%d %H:%M:%S")
            except ValueError:
                created_at = datetime.now()

        inbound_date_str = created_at.strftime("%Y-%m-%d %H:%M:%S")

        # 获取入库单关联的采购单信息(用于获取store_group_id)
        purchase_order_id = order[7] if len(order) > 7 else None  # inbound_orders.purchase_order_id
        inbound_order_store_group_id = None
        if purchase_order_id:
            po_row = db.execute(text("""
                SELECT store_group_id FROM purchase_orders
                WHERE id = :po_id AND deleted_at IS NULL
            """), {"po_id": purchase_order_id}).fetchone()
            if po_row and po_row[0]:
                inbound_order_store_group_id = po_row[0]

        # 收集采购单数量差异警告
        warnings = []

        for item in items:
            inbound_item_id = item[0]
            product_id = item[1]
            inbound_qty = int(item[2])
            poi_id = item[9]  # purchase_order_item_id
            
            # 确定店铺分组ID：优先从入库明细关联的采购单明细获取，其次从入库单层面获取
            item_store_group_id = inbound_order_store_group_id
            
            # 如果关联了采购单明细，校验数量差异并获取店铺分组ID
            if poi_id:
                poi_row = db.execute(text("""
                    SELECT poi.id, poi.quantity as ordered_qty, poi.received_quantity,
                           po.order_number, p.name as product_name, po.store_group_id
                    FROM purchase_order_items poi
                    JOIN purchase_orders po ON po.id = poi.purchase_order_id
                    LEFT JOIN products p ON p.id = poi.product_id
                    WHERE poi.id = :poi_id AND poi.deleted_at IS NULL AND po.deleted_at IS NULL
                """), {"poi_id": poi_id}).fetchone()

                if poi_row:
                    ordered_qty = int(poi_row[1])
                    received_qty = int(poi_row[2]) or 0
                    remaining_qty = ordered_qty - received_qty
                    po_number = poi_row[3]
                    product_name = poi_row[4] or f"产品#{product_id}"
                    poi_store_group_id = poi_row[5]  # 采购单的店铺分组ID
                    
                    # 优先使用明细关联的采购单的店铺分组ID
                    if poi_store_group_id:
                        item_store_group_id = poi_store_group_id

                    if inbound_qty != remaining_qty:
                        diff_type = "超收" if inbound_qty > remaining_qty else "少收"
                        diff_abs = abs(inbound_qty - remaining_qty)
                        warnings.append({
                            "product_name": product_name,
                            "purchase_order_number": po_number,
                            "ordered_qty": ordered_qty,
                            "received_before": received_qty,
                            "remaining_qty": remaining_qty,
                            "inbound_qty": inbound_qty,
                            "diff_type": diff_type,
                            "diff_amount": diff_abs,
                        })

            # 创建库存批次(配件批次)
            batch_id, batch_number = create_inventory_batch(
                db, current_user.tenant_id, product_id, order_id, inbound_item_id,
                inbound_qty, item[3] or 0, item[4] or order[3],
                item[8], inbound_date_str, item[6], item[7],
                store_group_id=item_store_group_id  # 传递店铺分组ID
            )
            db.execute(text("""
                UPDATE inbound_order_items SET batch_number = :bn WHERE id = :iid
            """), {"bn": batch_number, "iid": inbound_item_id})
            recalculate_product_local_stock(db, current_user.tenant_id, product_id)

            # 更新采购单明细的已收货数量
            if poi_id:
                db.execute(text("""
                    UPDATE purchase_order_items
                    SET received_quantity = COALESCE(received_quantity, 0) + :inbound_qty,
                        updated_at = NOW()
                    WHERE id = :poi_id
                """), {"poi_id": poi_id, "inbound_qty": inbound_qty})

                # 检查该采购单是否全部到货，更新状态
                po_status_check = db.execute(text("""
                    SELECT po.id, po.status,
                           SUM(poi.quantity) as total_ordered,
                           SUM(COALESCE(poi.received_quantity, 0)) as total_received
                    FROM purchase_orders po
                    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id AND poi.deleted_at IS NULL
                    WHERE po.id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = :poi_id)
                      AND po.deleted_at IS NULL
                    GROUP BY po.id, po.status
                """), {"poi_id": poi_id}).fetchone()

                if po_status_check:
                    total_ordered = int(po_status_check[2])
                    total_received = int(po_status_check[3])
                    po_id_for_update = po_status_check[0]
                    current_po_status = po_status_check[1]

                    if total_received >= total_ordered:
                        # 全部收货完毕，无论当前状态如何都改为已完成
                        db.execute(text("""
                            UPDATE purchase_orders SET status = 'completed', updated_at = NOW() WHERE id = :po_id
                        """), {"po_id": po_id_for_update})
                        # 采购单变为已完成，自动更新关联补货单为已完成
                        rep_rows = db.execute(text("""
                            SELECT id FROM replenishment_orders
                            WHERE purchase_order_id = :po_id AND deleted_at IS NULL AND status IN ('pending', 'purchased')
                        """), {"po_id": po_id_for_update}).fetchall()
                        if rep_rows:
                            rep_ids = [r[0] for r in rep_rows]
                            rep_ph = ', '.join(f':rid{i}' for i in range(len(rep_ids)))
                            rep_params = {f'rid{i}': rep_ids[i] for i in range(len(rep_ids))}
                            db.execute(text(f"""
                                UPDATE replenishment_orders SET status = 'completed', updated_at = NOW()
                                WHERE id IN ({rep_ph}) AND deleted_at IS NULL
                            """), rep_params)
                    elif current_po_status == 'pending_reshipment':
                        # 待补发状态且未全部收货，保持待补发不变（等待后续补发入库）
                        pass
                    elif total_received > 0:
                        db.execute(text("""
                            UPDATE purchase_orders SET status = 'partial_received', updated_at = NOW()
                            WHERE id = :po_id AND status NOT IN ('completed', 'cancelled', 'pending_reshipment')
                        """), {"po_id": po_id_for_update})

        # ========== 统一组装入库逻辑 ==========
        # 收集本次入库的所有配件product_id
        accessory_ids_in_order = set()
        for item in items:
            accessory_ids_in_order.add(item[1])

        # 查找这些配件绑定的所有成品（去重）
        if accessory_ids_in_order:
            id_list = ','.join(str(x) for x in accessory_ids_in_order)
            finished_products = db.execute(text(f"""
                SELECT DISTINCT pb.finished_product_id
                FROM product_bindings pb
                LEFT JOIN products p ON p.id = pb.finished_product_id
                WHERE pb.accessory_product_id IN ({id_list})
                  AND pb.deleted_at IS NULL AND p.deleted_at IS NULL
            """)).fetchall()

            for fp_row in finished_products:
                finished_product_id = fp_row[0]

                # 获取该成品的所有配件绑定
                all_bindings = db.execute(text("""
                    SELECT pb.accessory_product_id, pb.quantity, p.name as accessory_name, p.purchase_price
                    FROM product_bindings pb
                    LEFT JOIN products p ON p.id = pb.accessory_product_id
                    WHERE pb.finished_product_id = :fp_id AND pb.deleted_at IS NULL AND p.deleted_at IS NULL
                """), {"fp_id": finished_product_id}).fetchall()

                # 对每个配件，计算当前可用库存能组装多少成品
                min_assembled = float('inf')
                for ab in all_bindings:
                    acc_product_id = ab[0]
                    required_qty = ab[1]
                    # 获取该配件当前可用库存（刚入库的采购批次 + 之前的库存）
                    acc_stock_row = db.execute(text("""
                        SELECT COALESCE(SUM(current_quantity), 0)
                        FROM inventory_batches
                        WHERE product_id = :acc_id AND tenant_id = :tid
                          AND status = 'active' AND current_quantity > 0 AND deleted_at IS NULL
                    """), {"acc_id": acc_product_id, "tid": current_user.tenant_id}).scalar()
                    available_qty = int(acc_stock_row or 0)
                    can_assemble = available_qty // required_qty
                    if can_assemble < min_assembled:
                        min_assembled = can_assemble

                if min_assembled == float('inf') or min_assembled <= 0:
                    continue

                assembled_qty = min_assembled

                # 获取成品信息
                finished_product_row = db.execute(text("""
                    SELECT name, purchase_price FROM products WHERE id = :fp_id AND deleted_at IS NULL
                """), {"fp_id": finished_product_id}).fetchone()
                finished_name = finished_product_row[0] if finished_product_row else f"成品#{finished_product_id}"
                finished_unit_price = float(finished_product_row[1]) if finished_product_row and finished_product_row[1] else 0

                # 获取第一个入库项的店铺分组ID、仓库等作为组装批次的信息
                # 优先从入库明细的采购单明细获取store_group_id，其次从入库单层面获取
                first_item_store_group_id = inbound_order_store_group_id
                first_item_warehouse = order[3]
                first_item_shelf = None
                print(f"[ASSEMBLY] Processing finished_product#{finished_product_id}, inbound_order_store_group_id={inbound_order_store_group_id}")
                for item in items:
                    if item[1] in accessory_ids_in_order:
                        if item[4]:
                            first_item_warehouse = item[4]
                        if item[8]:
                            first_item_warehouse = item[8]
                        # 尝试从入库明细的采购单明细获取store_group_id
                        poi_id = item[9]  # purchase_order_item_id
                        print(f"[ASSEMBLY] Found matching item: product_id={item[1]}, poi_id={poi_id}, first_item_store_group_id={first_item_store_group_id}")
                        if poi_id and not first_item_store_group_id:
                            poi_row = db.execute(text("""
                                SELECT po.store_group_id
                                FROM purchase_order_items poi
                                JOIN purchase_orders po ON po.id = poi.purchase_order_id
                                WHERE poi.id = :poi_id AND poi.deleted_at IS NULL
                            """), {"poi_id": poi_id}).fetchone()
                            print(f"[ASSEMBLY] POI query result: poi_row={poi_row}")
                            if poi_row and poi_row[0]:
                                first_item_store_group_id = poi_row[0]
                                print(f"[ASSEMBLY] Got store_group_id from POI: {first_item_store_group_id}")
                        break

                print(f"[ASSEMBLY] Final first_item_store_group_id={first_item_store_group_id} for finished_product#{finished_product_id}")

                # 为成品创建一个组装入库批次
                assembly_batch_number = f"A{finished_product_id:06d}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
                insert_params = {
                    "tenant_id": current_user.tenant_id,
                    "store_group_id": first_item_store_group_id,
                    "product_id": finished_product_id,
                    "inbound_order_id": order_id,
                    "batch_number": assembly_batch_number,
                    "initial_quantity": assembled_qty,
                    "current_quantity": assembled_qty,
                    "unit_price": finished_unit_price,
                    "warehouse": first_item_warehouse,
                    "shelf_number": first_item_shelf,
                    "inbound_date": inbound_date_str,
                    "production_date": None,
                    "expiry_date": None,
                    "source_batch_id": None,
                    "assembly_quantity": None,
                    "notes": f"组装入库: 入库{assembled_qty}件成品{finished_name}",
                    "created_at": datetime.now(),
                    "updated_at": datetime.now(),
                }
                print(f"[ASSEMBLY] INSERT params for finished_product#{finished_product_id}: store_group_id={insert_params['store_group_id']}")
                db.execute(text("""
                    INSERT INTO inventory_batches (tenant_id, store_group_id, product_id, inbound_order_id, batch_number,
                        initial_quantity, current_quantity, locked_quantity, unit_price, warehouse, shelf_number,
                        inbound_date, production_date, expiry_date, status, batch_type, source_batch_id, assembly_quantity, notes, created_at, updated_at)
                    VALUES (:tenant_id, :store_group_id, :product_id, :inbound_order_id, :batch_number,
                        :initial_quantity, :current_quantity, 0, :unit_price, :warehouse, :shelf_number,
                        :inbound_date, :production_date, :expiry_date, 'active', 'assembly', :source_batch_id, :assembly_quantity, :notes, :created_at, :updated_at)
                """), insert_params)

                recalculate_product_local_stock(db, current_user.tenant_id, finished_product_id)

                # 更新采购单中成品的入库数量（配件组装后成品入库）
                # 从配件明细关联的采购单明细中获取采购单ID
                # 收集本次入库配件关联的所有采购单ID
                related_purchase_order_ids = set()
                for item in items:
                    poi_id = item[9]  # purchase_order_item_id
                    if poi_id:
                        poi_po_row = db.execute(text("""
                            SELECT purchase_order_id FROM purchase_order_items
                            WHERE id = :poi_id AND deleted_at IS NULL
                        """), {"poi_id": poi_id}).fetchone()
                        if poi_po_row:
                            related_purchase_order_ids.add(poi_po_row[0])

                # 同时加入入库单层面关联的采购单ID
                if purchase_order_id:
                    related_purchase_order_ids.add(purchase_order_id)

                # 对每个相关采购单，更新成品的入库数量
                for po_id in related_purchase_order_ids:
                    # 查询采购单中是否有该成品
                    po_finished_item = db.execute(text("""
                        SELECT id, received_quantity
                        FROM purchase_order_items
                        WHERE purchase_order_id = :po_id AND product_id = :fp_id AND deleted_at IS NULL
                    """), {"po_id": po_id, "fp_id": finished_product_id}).fetchone()

                    if po_finished_item:
                        poi_id_for_finished = po_finished_item[0]
                        current_finished_received = int(po_finished_item[1] or 0)
                        new_finished_received = current_finished_received + assembled_qty

                        # 更新采购单中成品的已收货数量
                        db.execute(text("""
                            UPDATE purchase_order_items
                            SET received_quantity = :new_qty, updated_at = NOW()
                            WHERE id = :poi_id
                        """), {"new_qty": new_finished_received, "poi_id": poi_id_for_finished})
                        print(f"[ASSEMBLY-PO] 采购单#{po_id} 成品#{finished_product_id}({finished_name}) 已入库数量从{current_finished_received}增加到{new_finished_received}")

                        # 检查该采购单是否需要更新状态
                        po_status_check = db.execute(text("""
                            SELECT po.id, po.status,
                                   SUM(poi.quantity) as total_ordered,
                                   SUM(COALESCE(poi.received_quantity, 0)) as total_received
                            FROM purchase_orders po
                            JOIN purchase_order_items poi ON poi.purchase_order_id = po.id AND poi.deleted_at IS NULL
                            WHERE po.id = :po_id AND po.deleted_at IS NULL
                            GROUP BY po.id, po.status
                        """), {"po_id": po_id}).fetchone()

                        if po_status_check:
                            total_ordered = int(po_status_check[2])
                            total_received = int(po_status_check[3])
                            current_po_status = po_status_check[1]

                            if total_received >= total_ordered:
                                db.execute(text("""
                                    UPDATE purchase_orders SET status = 'completed', updated_at = NOW() WHERE id = :po_id
                                """), {"po_id": po_id})
                            elif current_po_status != 'pending_reshipment' and total_received > 0:
                                db.execute(text("""
                                    UPDATE purchase_orders SET status = 'partial_received', updated_at = NOW()
                                    WHERE id = :po_id AND status NOT IN ('completed', 'cancelled', 'pending_reshipment')
                                """), {"po_id": po_id})

                # 依次扣减各配件库存（FIFO）
                for ab in all_bindings:
                    acc_product_id = ab[0]
                    required_qty = ab[1]
                    acc_name = ab[2] or f"配件#{acc_product_id}"
                    accessory_qty_to_deduct = assembled_qty * required_qty
                    deduction_details, actual_deducted, fully_fulfilled = deduce_inventory_fifo(
                        db, current_user.tenant_id, acc_product_id, accessory_qty_to_deduct
                    )
                    if actual_deducted > 0:
                        apply_deduction(db, deduction_details)
                        recalculate_product_local_stock(db, current_user.tenant_id, acc_product_id)
                    print(f"[ASSEMBLY-DEDUCT] 配件#{acc_product_id}({acc_name})扣减库存{actual_deducted}件(组装成品消耗)")

                print(f"[ASSEMBLY] 成品#{finished_product_id}({finished_name})组装入库{assembled_qty}件")

        db.execute(text("""
            UPDATE inbound_orders SET status = 'confirmed', confirmed_by = :uid, confirmed_at = :now,
                inbound_date = :inbound_date, updated_at = :now WHERE id = :id
        """), {"uid": current_user.id, "now": datetime.now(), "inbound_date": created_at, "id": order_id})
        db.commit()

        log_order_confirm(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                          "inbound", order_id, order[1],
                          {"status": before_status}, {"status": "confirmed", "items_count": len(items)})
        db.commit()

        result = {
            "success": True,
            "message": "入库订单已确认，库存已自动更新",
            "warnings": warnings,
        }
        if warnings:
            result["warning_message"] = f"发现 {len(warnings)} 条入库数量与采购单数量不一致的记录"
        return result
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"确认入库订单失败: {str(e)}")


@router.delete("/{order_id}")
async def delete_inbound_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:delete"))
):
    try:
        row = db.execute(text(
            "SELECT id, order_number, status, tenant_id FROM inbound_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="入库订单不存在")
        
        order_status = row[2]
        
        # 如果是已确认的订单，需要先检查并回滚库存
        if order_status == "confirmed":
            # 获取该订单的入库明细
            items = db.execute(text("""
                SELECT id, product_id, quantity, batch_number
                FROM inbound_order_items
                WHERE inbound_order_id = :oid AND deleted_at IS NULL
            """), {"oid": order_id}).fetchall()
            
            # 检查是否有相关的出库记录（真正有效的、未删除的记录）
            for item in items:
                item_id = item[0]
                product_id = item[1]
                
                # 找到这个入库项对应的库存批次
                batches = db.execute(text("""
                    SELECT id, current_quantity, initial_quantity
                    FROM inventory_batches
                    WHERE inbound_item_id = :item_id AND deleted_at IS NULL
                """), {"item_id": item_id}).fetchall()
                
                for batch in batches:
                    batch_id = batch[0]
                    current_qty = int(batch[1])
                    initial_qty = int(batch[2])
                    used_qty = initial_qty - current_qty
                    
                    if used_qty > 0:
                        # 检查是否真的有未删除的出库订单在使用这个批次
                        outbound_usage = db.execute(text("""
                            SELECT COUNT(*) 
                            FROM outbound_order_items ooi
                            JOIN outbound_orders oo ON oo.id = ooi.outbound_order_id
                            WHERE ooi.batch_id = :bid 
                              AND oo.deleted_at IS NULL 
                              AND ooi.deleted_at IS NULL
                        """), {"bid": batch_id}).scalar()
                        
                        if outbound_usage > 0:
                            # 有实际在使用的出库单
                            raise HTTPException(
                                status_code=400, 
                                detail=f"无法删除：产品ID {product_id} 的库存已使用 {used_qty} 件，需先删除相关出库记录"
                            )
                        
                        # 检查是否有未删除的挪货单在使用这个批次
                        transfer_usage = db.execute(text("""
                            SELECT COUNT(*) 
                            FROM stock_transfer_order_items stoi
                            JOIN stock_transfer_orders sto ON sto.id = stoi.stock_transfer_order_id
                            WHERE stoi.batch_id = :bid 
                              AND sto.deleted_at IS NULL 
                              AND stoi.deleted_at IS NULL
                        """), {"bid": batch_id}).scalar()
                        
                        if transfer_usage > 0:
                            # 有实际在使用的挪货单
                            raise HTTPException(
                                status_code=400, 
                                detail=f"无法删除：产品ID {product_id} 的库存已用于挪货，需先删除相关挪货记录"
                            )
        
        before_data = {"order_number": row[1], "status": order_status}
        
        # 软删除相关的库存批次（仅在没有库存被使用时）
        if order_status == "confirmed":
            db.execute(text("""
                UPDATE inventory_batches SET deleted_at = NOW()
                WHERE inbound_order_id = :oid AND deleted_at IS NULL
            """), {"oid": order_id})

            # 回滚采购单明细的已收货数量
            poi_items = db.execute(text("""
                SELECT id, purchase_order_item_id, quantity
                FROM inbound_order_items
                WHERE inbound_order_id = :oid AND deleted_at IS NULL
                  AND purchase_order_item_id IS NOT NULL
            """), {"oid": order_id}).fetchall()

            print(f"[DELETE-ROLLBACK] 入库单#{order_id}({row[1]}) 开始回滚，共{len(poi_items)}条关联明细")

            for poi in poi_items:
                ioi_id, poi_id, ioi_qty = poi[0], poi[1], int(poi[2])

                # 查询回滚前的值用于日志
                before_poi = db.execute(text("""
                    SELECT received_quantity FROM purchase_order_items WHERE id = :poi_id AND deleted_at IS NULL
                """), {"poi_id": poi_id}).fetchone()
                old_received = int(before_poi[0]) if before_poi and before_poi[0] else 0

                db.execute(text("""
                    UPDATE purchase_order_items
                    SET received_quantity = GREATEST(COALESCE(received_quantity, 0) - :ioi_qty, 0),
                        updated_at = NOW()
                    WHERE id = :poi_id AND deleted_at IS NULL
                """), {"poi_id": poi_id, "ioi_qty": ioi_qty})

                # 查询回滚后的值
                after_poi = db.execute(text("""
                    SELECT received_quantity FROM purchase_order_items WHERE id = :poi_id AND deleted_at IS NULL
                """), {"poi_id": poi_id}).fetchone()
                new_received = int(after_poi[0]) if after_poi and after_poi[0] else 0

                print(f"[DELETE-ROLLBACK] 入库明细#{ioi_id}: POI#{poi_id} "
                      f"received_quantity {old_received} -> {new_received} (减去入库量 {ioi_qty})")

                # 检查采购单状态是否需要恢复
                po_status_row = db.execute(text("""
                    SELECT po.id, po.order_number, po.status,
                           SUM(poi.quantity) as total_ordered,
                           SUM(COALESCE(poi.received_quantity, 0)) as total_received
                    FROM purchase_orders po
                    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id AND poi.deleted_at IS NULL
                    WHERE po.id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = :poi_id)
                      AND po.deleted_at IS NULL
                    GROUP BY po.id
                """), {"poi_id": poi_id}).fetchone()

                if po_status_row:
                    po_id_for_update = po_status_row[0]
                    po_number = po_status_row[1]
                    current_po_status = po_status_row[2]
                    total_ordered = int(po_status_row[3])
                    total_received = int(po_status_row[4])

                    print(f"[DELETE-ROLLBACK] 采购单#{po_id_for_update}({po_number}) 当前状态={current_po_status}, "
                          f"总订购={total_ordered}, 总收货={total_received}")

                    if current_po_status == 'completed' and total_received < total_ordered:
                        # 从完成变为部分到货或已审批
                        new_status = 'partial_received' if total_received > 0 else 'approved'
                        db.execute(text("""
                            UPDATE purchase_orders SET status = :new_status, updated_at = NOW() WHERE id = :po_id
                        """), {"po_id": po_id_for_update, "new_status": new_status})
                        print(f"[DELETE-ROLLBACK] 采购单状态变更: {current_po_status} -> {new_status}")
                    elif current_po_status == 'partial_received' and total_received == 0:
                        db.execute(text("""
                            UPDATE purchase_orders SET status = 'approved', updated_at = NOW() WHERE id = :po_id
                        """), {"po_id": po_id_for_update})
                        print(f"[DELETE-ROLLBACK] 采购单状态回退: partial_received -> approved")

            # 重新计算产品库存
            items = db.execute(text("""
                SELECT DISTINCT product_id FROM inbound_order_items
                WHERE inbound_order_id = :oid AND deleted_at IS NULL
            """), {"oid": order_id}).fetchall()
            for item in items:
                recalculate_product_local_stock(db, current_user.tenant_id, item[0])
        
        db.execute(text("UPDATE inbound_orders SET deleted_at = NOW() WHERE id = :id"), {"id": order_id})
        db.execute(text("UPDATE inbound_order_items SET deleted_at = NOW() WHERE inbound_order_id = :oid"), {"oid": order_id})
        
        db.commit()

        log_order_delete(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                        "inbound", order_id, row[1], before_data)
        db.commit()

        return {"success": True, "message": "入库订单已删除"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除入库订单失败: {str(e)}")


@router.get("/template/download")
async def download_inbound_template(
    current_user: User = Depends(get_current_user)
):
    """下载入库单Excel模板"""
    try:
        file_stream = create_inbound_excel_template()
        filename = f"入库单模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
        encoded_filename = quote(filename)
        return StreamingResponse(
            file_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={encoded_filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


@router.get("/pending-purchase-items/{product_id}")
async def get_pending_purchase_items(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """根据产品ID查询待收货的采购单明细（按审批时间升序，先采购的排在前面）
    
    支持两种匹配方式：
    1. 直接匹配：采购单明细中的产品ID与传入的product_id一致
    2. 间接匹配：传入的product_id是配件，查找其绑定的成品对应的采购单
    """
    try:
        # 查询采购单明细：直接匹配 + 通过配件绑定关系匹配成品
        # 不合并同一采购单的多条明细，每条单独返回以便用户区分
        rows = db.execute(text("""
            SELECT poi.id as poi_id,
                   po.id as po_id,
                   po.order_number,
                   poi.supplier,
                   po.status as po_status,
                   po.approved_at,
                   poi.product_id,
                   poi.quantity as ordered_qty,
                   poi.received_quantity,
                   (poi.quantity - COALESCE(poi.received_quantity, 0)) as remaining_qty,
                   poi.unit_price,
                   p.name as product_name,
                   p.product_code,
                   pb.quantity as binding_qty,
                   p.name as finished_name,
                   p.product_code as finished_code
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.purchase_order_id
            LEFT JOIN products p ON p.id = poi.product_id
            LEFT JOIN product_bindings pb ON pb.finished_product_id = poi.product_id 
                AND pb.accessory_product_id = :product_id AND pb.deleted_at IS NULL
            WHERE po.tenant_id = :tenant_id
              AND po.deleted_at IS NULL
              AND poi.deleted_at IS NULL
              AND po.status IN ('approved', 'ordered', 'partial_received', 'pending_reshipment')
              AND (poi.quantity - COALESCE(poi.received_quantity, 0)) > 0
              AND (poi.product_id = :product_id OR pb.id IS NOT NULL)
            ORDER BY COALESCE(po.approved_at, po.created_at) ASC
        """), {
            "product_id": product_id,
            "tenant_id": current_user.tenant_id
        }).fetchall()

        raw_items = []
        for row in rows:
            binding_qty = row[13]  # 配件绑定数量（如果是配件匹配则为绑定数量，否则为NULL）
            # 如果是配件匹配，需要按绑定数量计算配件的剩余待收数量
            if binding_qty:
                # 配件入库数量 = 成品入库数量 × 绑定数量
                # 配件剩余待收 = 成品剩余待收 × 绑定数量
                remaining_qty = int(row[9]) * binding_qty
            else:
                remaining_qty = int(row[9])
            
            raw_items.append({
                "poi_id": row[0],
                "po_id": row[1],
                "order_number": row[2],
                "supplier": row[3] or "",
                "po_status": row[4],
                "approved_at": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else "",
                "product_id": row[6],
                "ordered_qty": int(row[7]),
                "received_quantity": int(row[8]),
                "remaining_qty": remaining_qty,
                "unit_price": float(row[10]) if row[10] else 0,
                "product_name": row[11] or "",
                "product_code": row[12] or "",
                "binding_qty": binding_qty or 1,  # 配件绑定数量，用于前端显示
                "is_accessory_match": bool(binding_qty),  # 标记是否为配件匹配
                "finished_name": row[14] or "",  # 成品名称（配件匹配时用于区分）
                "finished_code": row[15] or "",  # 成品编码
            })

        direct_match_po_ids = {
            item["po_id"]
            for item in raw_items
            if not item["is_accessory_match"] and item["product_id"] == product_id
        }
        items = [
            item for item in raw_items
            if not (item["is_accessory_match"] and item["po_id"] in direct_match_po_ids)
        ]

        return {"success": True, "data": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询待收货采购单失败: {str(e)}")


@router.post("/upload/preview")
async def upload_inbound_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """上传入库单Excel预览"""
    try:
        if not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="请上传Excel文件 (.xlsx/.xls)")
        
        file_bytes = await file.read()
        items = parse_inbound_excel(file_bytes, db, current_user.tenant_id)
        
        # 补充产品信息
        product_ids = [item["product_id"] for item in items]
        product_map = {}
        if product_ids:
            products = db.execute(text("""
                SELECT id, product_code, name 
                FROM products 
                WHERE id IN :ids AND deleted_at IS NULL
            """), {"ids": tuple(product_ids)}).fetchall()
            product_map = {p[0]: (p[1], p[2]) for p in products}
        
        for item in items:
            pc, pn = product_map.get(item["product_id"], ("", ""))
            item["product_code"] = pc
            item["product_name"] = pn
            if "shelf_number" not in item:
                item["shelf_number"] = ""
            if "notes" not in item:
                item["notes"] = ""
        
        return {"success": True, "data": items}
    except HTTPException:
        raise
    except ValueError as e:
        # 业务错误（如产品编码不存在）返回400
        raise HTTPException(status_code=400, detail=f"{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析Excel失败: {str(e)}")


@router.post("/fix-purchase-received-qty")
async def fix_purchase_received_quantity(
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:delete"))
):
    """修复采购单已收货数量：基于实际存在的入库单重新计算"""
    try:
        print(f"[FIX] 开始修复采购单收货数量，操作人: {current_user.nickname or current_user.username}, tenant_id: {current_user.tenant_id}")

        # 1. 查出所有非删除的入库单明细（含关联的采购单明细ID）
        all_inbound_items = db.execute(text("""
            SELECT ioi.purchase_order_item_id,
                   SUM(ioi.quantity) as total_inbound_qty
            FROM inbound_order_items ioi
            JOIN inbound_orders io ON io.id = ioi.inbound_order_id
            WHERE ioi.deleted_at IS NULL
              AND ioi.purchase_order_item_id IS NOT NULL
              AND io.tenant_id = :tenant_id
              AND io.status = 'confirmed'
            GROUP BY ioi.purchase_order_item_id
        """), {"tenant_id": current_user.tenant_id}).fetchall()

        # 构建每个 poi 的实际总入库量
        actual_received_map = {}
        for row in all_inbound_items:
            actual_received_map[row[0]] = int(row[1])

        print(f"[FIX] 共 {len(actual_received_map)} 个采购单明细有入库记录")

        # 2. 查出所有采购单明细当前值
        all_poi = db.execute(text("""
            SELECT poi.id, po.order_number, poi.product_id,
                   poi.quantity as ordered_qty, poi.received_quantity as current_received_qty,
                   po.status as po_status
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.purchase_order_id
            WHERE po.tenant_id = :tenant_id
              AND po.deleted_at IS NULL
              AND poi.deleted_at IS NULL
              AND po.status NOT IN ('cancelled')
            ORDER BY po.approved_at ASC
        """), {"tenant_id": current_user.tenant_id}).fetchall()

        fixed_count = 0
        fixed_details = []
        status_changed_count = 0

        for row in all_poi:
            poi_id = row[0]
            po_number = row[1]
            product_id = row[2]
            ordered_qty = int(row[3])
            current_received = int(row[4]) if row[4] else 0
            po_status = row[5]

            correct_received = actual_received_map.get(poi_id, 0)

            if current_received != correct_received:
                old_val = current_received
                print(f"[FIX] 修正 POI#{poi_id} ({po_number} 产品#{product_id}): "
                      f"received_quantity {old_val} -> {correct_received}")
                db.execute(text("""
                    UPDATE purchase_order_items
                    SET received_quantity = :correct_qty, updated_at = NOW()
                    WHERE id = :poi_id AND deleted_at IS NULL
                """), {"poi_id": poi_id, "correct_qty": correct_received})
                fixed_count += 1
                fixed_details.append({
                    "po_number": po_number,
                    "product_id": product_id,
                    "old_received": old_val,
                    "new_received": correct_received,
                })

        # 3. 基于修正后的数据重新计算采购单状态
        all_po_for_status = db.execute(text("""
            SELECT po.id, po.order_number, po.status,
                   SUM(poi.quantity) as total_ordered,
                   SUM(COALESCE(poi.received_quantity, 0)) as total_received
            FROM purchase_orders po
            JOIN purchase_order_items poi ON poi.purchase_order_id = po.id AND poi.deleted_at IS NULL
            WHERE po.tenant_id = :tenant_id
              AND po.deleted_at IS NULL
              AND po.status NOT IN ('cancelled', 'draft')
            GROUP BY po.id
        """), {"tenant_id": current_user.tenant_id}).fetchall()

        for row in all_po_for_status:
            po_id = row[0]
            po_number = row[1]
            current_po_status = row[2]
            total_ordered = int(row[3])
            total_received = int(row[4])

            if total_received >= total_ordered and current_po_status != 'completed':
                print(f"[FIX] 采购单 #{po_id} ({po_number}) 状态变更: "
                      f"{current_po_status} -> completed (全部到货)")
                db.execute(text("UPDATE purchase_orders SET status = 'completed', updated_at = NOW() WHERE id = :po_id"),
                          {"po_id": po_id})
                # 采购单变为已完成，自动更新关联补货单为已完成
                rep_rows = db.execute(text("""
                    SELECT id FROM replenishment_orders
                    WHERE purchase_order_id = :po_id AND deleted_at IS NULL AND status IN ('pending', 'purchased')
                """), {"po_id": po_id}).fetchall()
                if rep_rows:
                    rep_ids = [r[0] for r in rep_rows]
                    rep_ph = ', '.join(f':rid{i}' for i in range(len(rep_ids)))
                    rep_params = {f'rid{i}': rep_ids[i] for i in range(len(rep_ids))}
                    db.execute(text(f"""
                        UPDATE replenishment_orders SET status = 'completed', updated_at = NOW()
                        WHERE id IN ({rep_ph}) AND deleted_at IS NULL
                    """), rep_params)
                status_changed_count += 1
            elif total_received > 0 and total_received < total_ordered and current_po_status not in ('partial_received',):
                print(f"[FIX] 采购单 #{po_id} ({po_number}) 状态变更: "
                      f"{current_po_status} -> partial_received (部分到货)")
                db.execute(text("UPDATE purchase_orders SET status = 'partial_received', updated_at = NOW() WHERE id = :po_id"),
                          {"po_id": po_id})
                status_changed_count += 1
            elif total_received == 0 and current_po_status in ('completed', 'partial_received'):
                new_status = 'approved' if current_po_status != 'approved' else current_po_status
                print(f"[FIX] 采购单 #{po_id} ({po_number}) 状态回退: "
                      f"{current_po_status} -> {new_status} (无收货)")
                db.execute(text("UPDATE purchase_orders SET status = :new_status, updated_at = NOW() WHERE id = :po_id"),
                          {"po_id": po_id, "new_status": new_status})
                status_changed_count += 1

        db.commit()

        result = {
            "success": True,
            "message": f"修复完成",
            "data": {
                "fixed_poi_count": fixed_count,
                "status_changed_count": status_changed_count,
                "details": fixed_details,
            }
        }
        print(f"[FIX] 修复完成: 修正{fixed_count}条明细, 变更{status_changed_count}个状态")
        return result
    except Exception as e:
        import traceback
        db.rollback()
        print(f"[FIX] 修复失败: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"修复失败: {str(e)}")


class PurchaseDiffCheckItem(BaseModel):
    product_id: int
    quantity: int
    purchase_order_item_id: Optional[int] = None


@router.post("/check-purchase-diff")
async def check_purchase_diff(
    items: List[PurchaseDiffCheckItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:create"))
):
    """预检查入库数量与采购单数量的差异"""
    try:
        warnings = []
        notified_po_ids = set()

        for item in items:
            if not item.purchase_order_item_id:
                continue

            poi_row = db.execute(text("""
                SELECT poi.id, poi.quantity as ordered_qty, poi.received_quantity,
                       po.order_number, po.created_by,
                       p.name as product_name
                FROM purchase_order_items poi
                JOIN purchase_orders po ON po.id = poi.purchase_order_id
                LEFT JOIN products p ON p.id = poi.product_id
                WHERE poi.id = :poi_id AND poi.deleted_at IS NULL AND po.deleted_at IS NULL
                  AND po.tenant_id = :tenant_id
            """), {"poi_id": item.purchase_order_item_id, "tenant_id": current_user.tenant_id}).fetchone()

            if not poi_row:
                continue

            ordered_qty = int(poi_row[1])
            received_qty = int(poi_row[2]) or 0
            remaining_qty = ordered_qty - received_qty
            po_number = str(poi_row[3])
            po_creator_id = poi_row[4]
            product_name = poi_row[5] or f"产品#{item.product_id}"

            if item.quantity != remaining_qty:
                diff_type = "超收" if item.quantity > remaining_qty else "少收"
                diff_abs = abs(item.quantity - remaining_qty)
                warnings.append({
                    "product_name": product_name,
                    "purchase_order_number": po_number,
                    "ordered_qty": ordered_qty,
                    "received_before": received_qty,
                    "remaining_qty": remaining_qty,
                    "inbound_qty": item.quantity,
                    "diff_type": diff_type,
                    "diff_amount": diff_abs,
                    "po_creator_id": po_creator_id,
                })
                notified_po_ids.add(po_creator_id)

        return {
            "success": True,
            "has_warning": len(warnings) > 0,
            "warnings": warnings,
            "warning_message": f"发现 {len(warnings)} 条入库数量与采购单数量不一致的记录" if warnings else None,
            "notified_user_ids": list(notified_po_ids),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"检查采购单差异失败: {str(e)}")


class InboundDiffNotifyPayload(BaseModel):
    order_number: str
    warnings: List[dict]


@router.post("/notify-inbound-diff")
async def notify_inbound_diff(
    payload: InboundDiffNotifyPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:create"))
):
    """入库数量差异确认后，发送通知给对应采购人员（创建人和审批人，去重）"""
    try:
        # 收集需要通知的用户：采购单创建人 + 审批人，自动去重
        notified_user_ids = set()
        for w in payload.warnings:
            po_number = w.get('purchase_order_number', '')
            # 查询该采购单的创建人和审批人
            po_users = db.execute(text("""
                SELECT DISTINCT po.created_by, po.approved_by
                FROM purchase_orders po
                WHERE po.order_number = :po_number AND po.deleted_at IS NULL
                  AND po.tenant_id = :tenant_id
            """), {"po_number": po_number, "tenant_id": current_user.tenant_id}).fetchone()
            if po_users:
                if po_users[0]:
                    notified_user_ids.add(po_users[0])
                if po_users[1] and po_users[1] != po_users[0]:
                    notified_user_ids.add(po_users[1])

        if not notified_user_ids:
            return {"success": True, "message": "无需通知"}

        # 构建通知内容
        warning_lines = []
        for w in payload.warnings:
            warning_lines.append(
                f"  {w['product_name']} [采购单{w['purchase_order_number']}]: "
                f"采购{w['ordered_qty']}件 已收{w['received_before']}件 "
                f"剩余应收{w['remaining_qty']}件 实际入库{w['inbound_qty']}件 "
                f"({w['diff_type']}{w['diff_amount']}件)"
            )

        title = f"入库数量差异通知 - {payload.order_number}"
        content = (
            f"【入库数量差异】\n"
            f"入库单号：{payload.order_number}\n"
            f"操作人：{current_user.nickname or current_user.username}\n\n"
            f"以下商品入库数量与采购单数量不一致：\n"
            + "\n".join(warning_lines) +
            "\n\n请及时核对并处理。"
        )

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        notification_count = 0
        for uid in notified_user_ids:
            exists = db.execute(text("""
                SELECT COUNT(*) FROM notifications
                WHERE tenant_id = :tid AND user_id = :uid AND title = :title
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            """), {
                "tid": current_user.tenant_id,
                "uid": uid,
                "title": title,
            }).scalar()
            if exists > 0:
                continue
            db.execute(text("""
                INSERT INTO notifications (tenant_id, user_id, type, title, content, link, created_at)
                VALUES (:tid, :uid, 'warning', :title, :content, :link, :now)
            """), {
                "tid": current_user.tenant_id,
                "uid": uid,
                "title": title,
                "content": content,
                "link": "/inbound",
                "now": now_str,
            })
            notification_count += 1

        db.commit()

        print(f"[INBOUND-DIFF-NOTIFY] 入库单{payload.order_number} 差异通知已发送，"
              f"共{notification_count}条通知，覆盖{len(notified_user_ids)}人")

        return {
            "success": True,
            "message": f"已向 {len(notified_user_ids)} 位采购人员发送差异通知",
            "data": {
                "notification_count": notification_count,
                "user_count": len(notified_user_ids),
            },
        }
    except Exception as e:
        import traceback
        db.rollback()
        print(f"[INBOUND-DIFF-NOTIFY] 发送失败: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"发送差异通知失败: {str(e)}")


class DiffResolutionItem(BaseModel):
    inbound_item_id: int
    resolution: str  # 'reshipment' (厂家补发) | 'reduce_po' (减少采购单数量)


@router.get("/pending-diff-items")
async def get_pending_diff_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:view"))
):
    """获取所有待处理入库数量差异的明细列表（按权限过滤）"""
    try:
        # 确保 diff_resolution 字段存在
        try:
            db.execute(text("""
                ALTER TABLE inbound_order_items
                ADD COLUMN diff_resolution VARCHAR(20) NULL DEFAULT NULL
                COMMENT '差异处理方式: reshipment=厂家补发, reduce_po=减少采购单数量'
                AFTER purchase_order_item_id
            """))
            db.commit()
        except Exception:
            pass

        # 确保 purchase_order_items.received_quantity 字段存在
        try:
            db.execute(text("""
                ALTER TABLE purchase_order_items
                ADD COLUMN received_quantity INT NOT NULL DEFAULT 0
                COMMENT '已收货数量'
                AFTER quantity
            """))
            db.commit()
        except Exception:
            pass

        # 判断用户角色：admin/管理员可看全部，普通采购人员只看自己的采购单
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True

        # 构建权限过滤条件
        user_filter = ""
        params = {"tenant_id": current_user.tenant_id}
        if not is_admin:
            # 非管理员：只能看到自己创建的采购单的差异
            user_filter = "AND po.created_by = :user_id"
            params["user_id"] = current_user.id

        # 查询已确认（draft状态，刚创建）且关联了采购单、存在数量差异、尚未处理的入库明细
        rows = db.execute(text(f"""
            SELECT ioi.id as inbound_item_id,
                   io.id as inbound_order_id,
                   io.order_number,
                   ioi.product_id,
                   p.name as product_name,
                   p.product_code,
                   ioi.quantity as inbound_qty,
                   poi.id as poi_id,
                   po.order_number as po_number,
                   poi.quantity as ordered_qty,
                   COALESCE(poi.received_quantity, 0) as received_qty,
                   (poi.quantity - COALESCE(poi.received_quantity, 0)) as remaining_qty,
                   ioi.diff_resolution
            FROM inbound_order_items ioi
            JOIN inbound_orders io ON io.id = ioi.inbound_order_id
            LEFT JOIN products p ON p.id = ioi.product_id
            LEFT JOIN purchase_order_items poi ON poi.id = ioi.purchase_order_item_id
            LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
            WHERE io.tenant_id = :tenant_id
              AND io.deleted_at IS NULL
              AND ioi.deleted_at IS NULL
              AND io.status = 'draft'
              AND ioi.purchase_order_item_id IS NOT NULL
              AND (ioi.diff_resolution IS NULL OR ioi.diff_resolution = '')
              AND ioi.quantity <> (poi.quantity - COALESCE(poi.received_quantity, 0))
              {user_filter}
            ORDER BY io.created_at DESC
        """), params).fetchall()

        items = []
        for row in rows:
            # SQL列顺序: 0=inbound_item_id, 1=inbound_order_id, 2=order_number,
            #            3=product_id, 4=product_name, 5=product_code, 6=inbound_qty,
            #            7=poi_id, 8=po_number, 9=ordered_qty, 10=received_qty, 11=remaining_qty
            inbound_qty = int(row[6])
            received_qty_val = int(row[10]) if row[10] else 0
            remaining_qty = int(row[11])
            diff_type = "超收" if inbound_qty > remaining_qty else "少收"
            diff_amount = abs(inbound_qty - remaining_qty)
            items.append({
                "inbound_item_id": row[0],
                "inbound_order_id": row[1],
                "order_number": row[2],
                "product_id": row[3],
                "product_name": row[4] or f"产品#{row[3]}",
                "product_code": row[5],
                "inbound_qty": inbound_qty,
                "poi_id": row[7],
                "po_number": row[8],
                "ordered_qty": int(row[9]),
                "received_qty": received_qty_val,
                "remaining_qty": remaining_qty,
                "diff_type": diff_type,
                "diff_amount": diff_amount,
            })

        return {
            "success": True,
            "data": items,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取待处理差异列表失败: {str(e)}")


@router.post("/resolve-diffs")
async def resolve_diffs(
    resolutions: List[DiffResolutionItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("inbound:create"))
):
    """批量处理入库数量差异"""
    try:
        # 确保 diff_resolution 字段存在
        try:
            db.execute(text("""
                ALTER TABLE inbound_order_items
                ADD COLUMN diff_resolution VARCHAR(20) NULL DEFAULT NULL
                COMMENT '差异处理方式: reshipment=厂家补发, reduce_po=减少采购单数量'
                AFTER purchase_order_item_id
            """))
            db.commit()
        except Exception:
            pass

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        resolved_count = 0
        reduced_po_items = []

        for item in resolutions:
            if item.resolution not in ('reshipment', 'reduce_po'):
                continue

            # 获取当前入库明细信息
            ioi_row = db.execute(text("""
                SELECT ioi.id, ioi.quantity, ioi.purchase_order_item_id,
                       poi.quantity as po_ordered, COALESCE(poi.received_quantity, 0) as po_received
                FROM inbound_order_items ioi
                LEFT JOIN purchase_order_items poi ON poi.id = ioi.purchase_order_item_id
                WHERE ioi.id = :ioi_id AND ioi.deleted_at IS NULL
            """), {"ioi_id": item.inbound_item_id}).fetchone()

            if not ioi_row:
                continue

            inbound_qty = int(ioi_row[1])
            poi_id = ioi_row[2]
            po_ordered = int(ioi_row[3]) if ioi_row[3] else 0
            po_received = int(ioi_row[4])

            # 更新差异处理方式
            db.execute(text("""
                UPDATE inbound_order_items
                SET diff_resolution = :resolution, updated_at = NOW()
                WHERE id = :ioi_id AND deleted_at IS NULL
            """), {"ioi_id": item.inbound_item_id, "resolution": item.resolution})

            # 如果选择"减少采购单数量"，则减少采购单的订购量
            if item.resolution == 'reduce_po' and poi_id:
                new_ordered = po_received + inbound_qty  # 新订购量 = 已收货 + 本次入库
                if new_ordered < po_ordered:
                    db.execute(text("""
                        UPDATE purchase_order_items
                        SET quantity = :new_qty, updated_at = NOW()
                        WHERE id = :poi_id AND deleted_at IS NULL
                    """), {"poi_id": poi_id, "new_qty": new_ordered})

                    # 同步更新采购单总金额
                    db.execute(text("""
                        UPDATE purchase_orders po
                        SET total_amount = (
                            SELECT COALESCE(SUM(poi.quantity * COALESCE(poi.unit_price, 0)), 0)
                            FROM purchase_order_items poi
                            WHERE poi.purchase_order_id = po.id AND poi.deleted_at IS NULL
                        ),
                        updated_at = NOW()
                        WHERE po.id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = :poi_id)
                          AND po.deleted_at IS NULL
                    """), {"poi_id": poi_id})

                    reduced_po_items.append({
                        "poi_id": poi_id,
                        "old_ordered": po_ordered,
                        "new_ordered": new_ordered,
                    })

                    print(f"[RESOLVE-DIFF] 入库明细#{item.inbound_item_id} 选择减少采购单数量: "
                          f"POI#{poi_id} quantity {po_ordered} -> {new_ordered}")

                    # 减少数量后检查该采购单是否全部收货完毕（订购量=已收量），是则标记为已完成
                    po_check = db.execute(text("""
                        SELECT po.id,
                               SUM(poi.quantity) as total_ordered,
                               SUM(COALESCE(poi.received_quantity, 0)) as total_received
                        FROM purchase_orders po
                        JOIN purchase_order_items poi ON poi.purchase_order_id = po.id AND poi.deleted_at IS NULL
                        WHERE po.id = (SELECT purchase_order_id FROM purchase_order_items WHERE id = :poi_id)
                          AND po.deleted_at IS NULL
                        GROUP BY po.id
                    """), {"poi_id": poi_id}).fetchone()

                    if po_check:
                        total_ord = int(po_check[1])
                        total_recv = int(po_check[2])
                        if total_recv >= total_ord:
                            db.execute(text("""
                                UPDATE purchase_orders SET status = 'completed', updated_at = NOW()
                                WHERE id = :po_id AND status NOT IN ('cancelled')
                            """), {"po_id": po_check[0]})
                            # 采购单变为已完成，自动更新关联补货单为已完成
                            rep_rows = db.execute(text("""
                                SELECT id FROM replenishment_orders
                                WHERE purchase_order_id = :po_id AND deleted_at IS NULL AND status IN ('pending', 'purchased')
                            """), {"po_id": po_check[0]}).fetchall()
                            if rep_rows:
                                rep_ids = [r[0] for r in rep_rows]
                                rep_ph = ', '.join(f':rid{i}' for i in range(len(rep_ids)))
                                rep_params = {f'rid{i}': rep_ids[i] for i in range(len(rep_ids))}
                                db.execute(text(f"""
                                    UPDATE replenishment_orders SET status = 'completed', updated_at = NOW()
                                    WHERE id IN ({rep_ph}) AND deleted_at IS NULL
                                """), rep_params)
                            print(f"[RESOLVE-DIFF] 采购单#{po_check[0]} 数量已全部收齐，状态->已完成")

            elif item.resolution == 'reshipment':
                # 厂家补发：将关联的采购单状态改为"待补发"
                if poi_id:
                    db.execute(text("""
                        UPDATE purchase_orders
                        SET status = 'pending_reshipment', updated_at = NOW()
                        WHERE id = (
                            SELECT purchase_order_id FROM purchase_order_items WHERE id = :poi_id
                          ) AND deleted_at IS NULL
                          AND status NOT IN ('completed', 'cancelled')
                    """), {"poi_id": poi_id})
                    print(f"[RESOLVE-DIFF] 入库明细#{item.inbound_item_id} 选择厂家补发, 采购单状态->待补发")

            resolved_count += 1

        db.commit()

        return {
            "success": True,
            "message": f"已处理 {resolved_count} 条差异记录",
            "data": {
                "resolved_count": resolved_count,
                "reduced_po_items": reduced_po_items,
            },
        }
    except Exception as e:
        import traceback
        db.rollback()
        print(f"[RESOLVE-DIFF] 处理失败: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"处理差异失败: {str(e)}")
