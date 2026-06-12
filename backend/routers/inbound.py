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
from services.inventory_batch import create_inventory_batch, recalculate_product_local_stock
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
                       ioi.production_date, ioi.expiry_date, ioi.warehouse, ioi.shelf_number, ioi.notes
                FROM inbound_order_items ioi
                LEFT JOIN products p ON p.id = ioi.product_id
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

        for item in data.items:
            total_price = item.quantity * (item.unit_price or 0)
            db.execute(text("""
                INSERT INTO inbound_order_items (inbound_order_id, product_id, quantity, unit_price, total_price,
                    batch_number, production_date, expiry_date, warehouse, shelf_number, notes, created_at, updated_at)
                VALUES (:inbound_order_id, :product_id, :quantity, :unit_price, :total_price,
                    :batch_number, :production_date, :expiry_date, :warehouse, :shelf_number, :notes, :created_at, :updated_at)
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
            for item in data.items:
                total_price = item.quantity * (item.unit_price or 0)
                db.execute(text("""
                    INSERT INTO inbound_order_items (inbound_order_id, product_id, quantity, unit_price, total_price,
                        batch_number, production_date, expiry_date, warehouse, shelf_number, notes, created_at, updated_at)
                    VALUES (:inbound_order_id, :product_id, :quantity, :unit_price, :total_price,
                        :batch_number, :production_date, :expiry_date, :warehouse, :shelf_number, :notes, :created_at, :updated_at)
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
    try:
        order = db.execute(text(
            "SELECT id, order_number, status, tenant_id, warehouse, total_quantity, created_at FROM inbound_orders WHERE id = :id AND deleted_at IS NULL"
        ), {"id": order_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="入库订单不存在")
        if order[2] != "draft":
            raise HTTPException(status_code=400, detail=f"当前状态'{order[2]}'不允许确认")

        items = db.execute(text(
            "SELECT id, product_id, quantity, unit_price, warehouse, batch_number, production_date, expiry_date, shelf_number FROM inbound_order_items WHERE inbound_order_id = :oid AND deleted_at IS NULL"
        ), {"oid": order_id}).fetchall()

        before_status = order[2]
        # 使用入库单创建时间作为入库时间
        created_at = order[6]
        
        # 确保 created_at 是 datetime 类型
        if not isinstance(created_at, datetime):
            try:
                created_at = datetime.strptime(str(created_at), "%Y-%m-%d %H:%M:%S")
            except ValueError:
                created_at = datetime.now()
        
        inbound_date_str = created_at.strftime("%Y-%m-%d %H:%M:%S")

        for item in items:
            batch_id, batch_number = create_inventory_batch(
                db, current_user.tenant_id, item[1], order_id, item[0],
                int(item[2]), item[3] or 0, item[4] or order[3],
                item[8], inbound_date_str, item[6], item[7]
            )
            # 把批次号回写到入库明细中
            db.execute(text("""
                UPDATE inbound_order_items SET batch_number = :bn WHERE id = :iid
            """), {"bn": batch_number, "iid": item[0]})
            recalculate_product_local_stock(db, current_user.tenant_id, item[1])

        db.execute(text("""
            UPDATE inbound_orders SET status = 'confirmed', confirmed_by = :uid, confirmed_at = :now, inbound_date = :inbound_date, updated_at = :now WHERE id = :id
        """), {"uid": current_user.id, "now": datetime.now(), "inbound_date": created_at, "id": order_id})
        db.commit()

        log_order_confirm(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                          "inbound", order_id, order[1],
                          {"status": before_status}, {"status": "confirmed", "items_count": len(items)})
        db.commit()

        return {"success": True, "message": "入库订单已确认，库存已自动更新"}
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