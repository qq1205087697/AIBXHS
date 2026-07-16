from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create, log_order_confirm, log_order_cancel, log_order_delete, log_order_update
from services.inventory_batch import deduce_inventory_fifo, deduce_inventory_from_specific_batch, apply_deduction, rollback_deduction, recalculate_product_local_stock
from services.excel_helper import create_outbound_excel_template, parse_outbound_excel
import json

router = APIRouter(prefix="/api/outbound-orders", tags=["outbound_orders"])


class OutboundItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: Optional[float] = 0
    notes: Optional[str] = None
    selected_batch_id: Optional[int] = None  # 用户选择的批次
    selected_batch_number: Optional[str] = None


class OutboundOrderCreate(BaseModel):
    order_number: str
    outbound_type: str = "other"
    warehouse: Optional[str] = None
    handler: Optional[str] = None
    outbound_date: Optional[str] = None
    store_group_id: Optional[int] = None
    notes: Optional[str] = None
    items: List[OutboundItemCreate]


class OutboundOrderUpdate(BaseModel):
    order_number: Optional[str] = None
    outbound_type: Optional[str] = None
    warehouse: Optional[str] = None
    handler: Optional[str] = None
    outbound_date: Optional[str] = None
    store_group_id: Optional[int] = None
    notes: Optional[str] = None


@router.get("/")
async def get_outbound_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    outbound_type: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    store_group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["oo.tenant_id = :tenant_id", "oo.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if status:
            where_conditions.append("oo.status = :status")
            params["status"] = status
        if outbound_type:
            where_conditions.append("oo.outbound_type = :outbound_type")
            params["outbound_type"] = outbound_type
        if search:
            where_conditions.append("(oo.order_number LIKE :search OR oo.handler LIKE :search)")
            params["search"] = f"%{search}%"
        if start_date:
            where_conditions.append("DATE(oo.created_at) >= :start_date")
            params["start_date"] = start_date
        if end_date:
            where_conditions.append("DATE(oo.created_at) <= :end_date")
            params["end_date"] = end_date
        if store_group_id:
            where_conditions.append("oo.store_group_id = :store_group_id")
            params["store_group_id"] = store_group_id

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM outbound_orders oo WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT oo.id, oo.order_number, oo.outbound_type, oo.warehouse,
                   oo.handler, oo.outbound_date, oo.total_quantity, oo.total_amount,
                   oo.status, oo.notes, oo.created_by, oo.confirmed_at, oo.created_at,
                   oo.confirmed_by, oo.store_group_id, sg.name as store_group_name
            FROM outbound_orders oo
            LEFT JOIN store_groups sg ON oo.store_group_id = sg.id AND sg.deleted_at IS NULL
            WHERE {where_clause}
            ORDER BY oo.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()
        
        # 收集所有用户ID
        user_ids = set()
        for row in rows:
            if row[10]:  # created_by
                user_ids.add(row[10])
            if row[13]:  # confirmed_by
                user_ids.add(row[13])
        
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
                SELECT ooi.id, ooi.product_id, p.name as product_name, p.product_code,
                       ooi.quantity, ooi.unit_price, ooi.total_price,
                       ooi.batch_id, ooi.batch_number, ooi.batch_details, ooi.notes
                FROM outbound_order_items ooi
                LEFT JOIN products p ON p.id = ooi.product_id
                WHERE ooi.outbound_order_id = :oid AND ooi.deleted_at IS NULL
            """), {"oid": row[0]}).fetchall()

            order_items = []
            for item in items:
                batch_details = None
                if item[9]:
                    try:
                        batch_details = json.loads(item[9]) if isinstance(item[9], str) else item[9]
                    except (json.JSONDecodeError, TypeError):
                        pass

                order_items.append({
                    "id": item[0],
                    "product_id": item[1],
                    "product_name": item[2] or f"产品#{item[1]}",
                    "product_code": item[3] or "",
                    "quantity": int(item[4]),
                    "unit_price": float(item[5]) if item[5] else 0,
                    "total_price": float(item[6]) if item[6] else 0,
                    "batch_id": item[7],
                    "batch_number": item[8] or "",
                    "batch_details": batch_details,
                    "notes": item[10] or "",
                })

            orders.append({
                "id": row[0],
                "order_number": row[1],
                "outbound_type": row[2],
                "warehouse": row[3] or "",
                "handler": row[4] or "",
                "outbound_date": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else "",
                "total_quantity": int(row[6]),
                "total_amount": float(row[7]) if row[7] else 0,
                "status": row[8],
                "notes": row[9] or "",
                "created_by": row[10],
                "confirmed_at": row[11].strftime("%Y-%m-%d %H:%M:%S") if row[11] else "",
                "created_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else "",
                "confirmed_by": row[13],
                "store_group_id": row[14],
                "store_group_name": row[15] or "",
                "creator_name": user_map.get(row[10], ""),
                "confirmer_name": user_map.get(row[13], ""),
                "items": order_items,
            })

        return {"success": True, "data": orders, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取出库订单失败: {str(e)}")


@router.post("/")
async def create_outbound_order(
    data: OutboundOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("outbound:create"))
):
    try:
        if not data.items:
            raise HTTPException(status_code=400, detail="请至少添加一条出库明细")

        # 验证：如果是报废类型，每个商品必须选择批次
        if data.outbound_type == "scrap":
            for item in data.items:
                if not item.selected_batch_id:
                    raise HTTPException(status_code=400, detail="报废类型的出库单必须为每个商品选择指定批次")

        # 验证：如果指定了store_group_id，需要验证是否存在
        if data.store_group_id:
            group_check = db.execute(text(
                "SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
            ), {"id": data.store_group_id, "tid": current_user.tenant_id}).fetchone()
            if not group_check:
                raise HTTPException(status_code=400, detail="指定的店铺分组不存在")

        total_qty = sum(item.quantity for item in data.items)
        total_amt = sum((item.quantity * (item.unit_price or 0)) for item in data.items)

        # 正确处理出库日期
        outbound_date_value = datetime.now()
        if data.outbound_date:
            try:
                # 如果传入的是字符串，尝试解析
                outbound_date_value = datetime.strptime(data.outbound_date, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                try:
                    outbound_date_value = datetime.strptime(data.outbound_date, "%Y-%m-%d")
                except ValueError:
                    outbound_date_value = datetime.now()

        db.execute(text("""
            INSERT INTO outbound_orders (tenant_id, order_number, outbound_type,
                warehouse, handler, outbound_date, total_quantity, total_amount, status, store_group_id, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :outbound_type,
                :warehouse, :handler, :outbound_date, :total_quantity, :total_amount, 'draft', :store_group_id, :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "order_number": data.order_number,
            "outbound_type": data.outbound_type,
            "warehouse": data.warehouse,
            "handler": data.handler,
            "outbound_date": outbound_date_value,
            "total_quantity": total_qty,
            "total_amount": total_amt,
            "store_group_id": data.store_group_id,
            "notes": data.notes,
            "created_by": current_user.id,
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        for item in data.items:
            total_price = item.quantity * (item.unit_price or 0)
            db.execute(text("""
                INSERT INTO outbound_order_items (outbound_order_id, product_id, quantity, unit_price, total_price, notes, batch_id, batch_number, created_at, updated_at)
                VALUES (:oid, :pid, :qty, :up, :tp, :notes, :bid, :bn, :created_at, :updated_at)
            """), {
                "oid": order_id, "pid": item.product_id, "qty": item.quantity,
                "up": item.unit_price, "tp": total_price, "notes": item.notes,
                "bid": item.selected_batch_id, "bn": item.selected_batch_number,
                "created_at": datetime.now(), "updated_at": datetime.now(),
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "outbound", order_id, data.order_number,
                         {"order_number": data.order_number, "items_count": len(data.items), "total_quantity": total_qty})
        db.commit()

        return {"success": True, "message": "出库订单创建成功", "data": {"id": order_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建出库订单失败: {str(e)}")


@router.put("/{order_id}")
async def update_outbound_order(
    order_id: int,
    data: OutboundOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("outbound:edit"))
):
    try:
        row = db.execute(text(
            "SELECT id, order_number, status FROM outbound_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="出库订单不存在")
        if row[2] != "draft":
            raise HTTPException(status_code=400, detail="只能修改草稿状态的订单")

        before_data = {"order_number": row[1], "status": row[2]}

        # 验证：如果指定了store_group_id，需要验证是否存在
        if data.store_group_id:
            group_check = db.execute(text(
                "SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
            ), {"id": data.store_group_id, "tid": current_user.tenant_id}).fetchone()
            if not group_check:
                raise HTTPException(status_code=400, detail="指定的店铺分组不存在")

        updates = []
        params = {"id": order_id}
        for field in ["order_number", "outbound_type", "warehouse", "handler", "outbound_date", "store_group_id", "notes"]:
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = :{field}")
                params[field] = val

        if updates:
            db.execute(text(f"UPDATE outbound_orders SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"), params)
            db.commit()

        log_order_update(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "outbound", order_id, row[1], before_data,
                         {"order_number": row[1], "status": "draft"})
        db.commit()

        return {"success": True, "message": "出库订单更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新出库订单失败: {str(e)}")


@router.put("/{order_id}/confirm")
async def confirm_outbound_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("outbound:confirm"))
):
    try:
        order = db.execute(text(
            "SELECT id, order_number, status, tenant_id, outbound_type, store_group_id FROM outbound_orders WHERE id = :id AND deleted_at IS NULL"
        ), {"id": order_id}).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="出库订单不存在")
        if order[2] != "draft":
            raise HTTPException(status_code=400, detail=f"当前状态'{order[2]}'不允许确认")

        outbound_type = order[4]
        store_group_id = order[5]  # 获取店铺分组ID

        items = db.execute(text(
            "SELECT ooi.id, ooi.product_id, ooi.quantity, p.name as product_name, p.product_code, ooi.batch_id "
            "FROM outbound_order_items ooi "
            "LEFT JOIN products p ON p.id = ooi.product_id "
            "WHERE ooi.outbound_order_id = :oid AND ooi.deleted_at IS NULL"
        ), {"oid": order_id}).fetchall()

        # 验证：如果是报废类型，每个商品必须选择批次
        if outbound_type == "scrap":
            for item in items:
                if not item[5]:  # item[5] is batch_id
                    raise HTTPException(status_code=400, detail="报废类型的出库单必须为每个商品选择指定批次")

        # 合并同产品的数量，避免重复扣减库存
        product_quantity_map = {}
        product_items_map = {}  # 记录每个产品对应的行项目
        for item in items:
            item_id, product_id, quantity, product_name, product_code, selected_batch_id = item
            if product_id not in product_quantity_map:
                product_quantity_map[product_id] = 0
                product_items_map[product_id] = []
            product_quantity_map[product_id] += int(quantity)
            product_items_map[product_id].append(item)

        deduction_results = []
        deduction_details_all = []

        # 按产品合并扣减库存
        for product_id, total_quantity in product_quantity_map.items():
            # 检查该产品是否有指定批次（如果有多个行，只要有指定批次就按指定批次处理）
            selected_batch_ids = [item[5] for item in product_items_map[product_id] if item[5]]

            if selected_batch_ids:
                # 有指定批次，从指定批次扣减（取第一个指定批次）
                details, actual_qty, fulfilled = deduce_inventory_from_specific_batch(
                    db, current_user.tenant_id, product_id, total_quantity, selected_batch_ids[0], store_group_id
                )
                if not fulfilled:
                    group_msg = f"（店铺分组#{store_group_id}）" if store_group_id else ""
                    raise HTTPException(
                        status_code=400,
                        detail=f"产品#{product_id}选择的批次库存不足{group_msg}: 需要{total_quantity}件，当前可用{actual_qty}件"
                    )
            else:
                # 未选择批次，按 FIFO 自动分配
                details, actual_qty, fulfilled = deduce_inventory_fifo(
                    db, current_user.tenant_id, product_id, total_quantity, store_group_id
                )
                if not fulfilled:
                    group_msg = f"（店铺分组#{store_group_id}）" if store_group_id else ""
                    raise HTTPException(
                        status_code=400,
                        detail=f"产品#{product_id}库存不足{group_msg}: 需要{total_quantity}件，当前可用{actual_qty}件"
                    )
            deduction_details_all.extend(details)

            batch_info = []
            for d in details:
                batch_info.append(f"批次{d['batch_number']}扣减{d['quantity']}件")

            # 保存所有批次明细为 JSON 字符串
            batch_details_json = json.dumps(details, ensure_ascii=False)
            # 取第一个批次作为主批次
            first_batch_id = details[0]["batch_id"] if len(details) > 0 else None
            first_batch_number = details[0]["batch_number"] if len(details) > 0 else None
            
            # 更新该产品的所有行项目
            for item in product_items_map[product_id]:
                db.execute(text("""
                    UPDATE outbound_order_items SET
                        batch_id = :bid, batch_number = :bn, batch_details = :bd, updated_at = :now
                    WHERE id = :iid
                """), {
                    "bid": first_batch_id, "bn": first_batch_number,
                    "bd": batch_details_json, "now": datetime.now(), "iid": item[0]
                })

            deduction_results.append({
                "product_id": product_id,
                "product_name": product_items_map[product_id][0][3] or f"产品#{product_id}",
                "product_code": product_items_map[product_id][0][4] or "",
                "details": details,
                "batch_info": batch_info,
            })

        apply_deduction(db, deduction_details_all)
        for item in items:
            recalculate_product_local_stock(db, current_user.tenant_id, item[1])

        before_status = order[2]
        db.execute(text("""
            UPDATE outbound_orders SET status = 'confirmed', confirmed_by = :uid, confirmed_at = :now, updated_at = :now WHERE id = :id
        """), {"uid": current_user.id, "now": datetime.now(), "id": order_id})
        db.commit()

        # 构建日志消息
        deduction_msg = "FIFO逻辑: 优先出库最早批次"
        if store_group_id:
            deduction_msg += f"，限定在店铺分组#{store_group_id}范围内"

        log_order_confirm(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                          "outbound", order_id, order[1],
                          {"status": before_status, "store_group_id": store_group_id},
                          {"status": "confirmed", "deduction_by_batch": deduction_msg})
        db.commit()

        success_msg = "出库订单已确认，按FIFO规则自动扣减库存"
        if store_group_id:
            success_msg += f"（店铺分组#{store_group_id}）"

        return {"success": True, "message": success_msg, "data": {"deduction_results": deduction_results}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"确认出库订单失败: {str(e)}")


@router.delete("/{order_id}")
async def delete_outbound_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("outbound:delete"))
):
    try:
        row = db.execute(text(
            "SELECT id, order_number, status, tenant_id FROM outbound_orders WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="出库订单不存在")
        
        order_status = row[2]
        
        # 如果是已确认的订单，需要先回滚库存
        if order_status == "confirmed":
            # 获取该订单的出库明细
            items = db.execute(text("""
                SELECT id, product_id, quantity, batch_id, batch_details
                FROM outbound_order_items
                WHERE outbound_order_id = :oid AND deleted_at IS NULL
            """), {"oid": order_id}).fetchall()
            
            # 对于每个出库项，找到对应的库存批次并回滚
            product_ids = set()
            for item in items:
                item_id = item[0]
                product_id = item[1]
                quantity = int(item[2])
                batch_id = item[3]
                batch_details_json = item[4]
                
                product_ids.add(product_id)
                
                if batch_details_json:
                    # 使用 batch_details 中的完整扣减明细来回滚
                    try:
                        if isinstance(batch_details_json, str):
                            batch_details = json.loads(batch_details_json)
                        else:
                            batch_details = batch_details_json
                        
                        if batch_details and len(batch_details) > 0:
                            rollback_deduction(db, batch_details)
                            continue
                    except (json.JSONDecodeError, TypeError):
                        pass
                # 回退方案：如果没有 batch_details，使用原来的单个批次
                if batch_id:
                    # 回滚库存
                    db.execute(text("""
                        UPDATE inventory_batches
                        SET current_quantity = current_quantity + :qty,
                            status = CASE WHEN current_quantity + :qty > 0 THEN 'active' ELSE status END,
                            updated_at = NOW()
                        WHERE id = :batch_id
                    """), {"qty": quantity, "batch_id": batch_id})
            
            # 重新计算产品库存
            for product_id in product_ids:
                recalculate_product_local_stock(db, current_user.tenant_id, product_id)
        
        before_data = {"order_number": row[1], "status": order_status}
        db.execute(text("UPDATE outbound_orders SET deleted_at = NOW() WHERE id = :id"), {"id": order_id})
        db.execute(text("UPDATE outbound_order_items SET deleted_at = NOW() WHERE outbound_order_id = :oid"), {"oid": order_id})
        db.commit()

        log_order_delete(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                        "outbound", order_id, row[1], before_data)
        db.commit()

        return {"success": True, "message": "出库订单已删除"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除出库订单失败: {str(e)}")


@router.get("/template/download")
async def download_outbound_template(
    current_user: User = Depends(get_current_user)
):
    """下载出库单Excel模板"""
    try:
        file_stream = create_outbound_excel_template()
        filename = f"出库单模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
        encoded_filename = quote(filename)
        return StreamingResponse(
            file_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={encoded_filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


@router.post("/upload/preview")
async def upload_outbound_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """上传出库单Excel预览"""
    try:
        if not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="请上传Excel文件 (.xlsx/.xls)")
        
        file_bytes = await file.read()
        items = parse_outbound_excel(file_bytes, db, current_user.tenant_id)
        
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
            code, name = product_map.get(item["product_id"], ("", ""))
            item["product_code"] = code
            item["product_name"] = name
            if "notes" not in item:
                item["notes"] = ""
        
        return {"success": True, "data": items}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析Excel失败: {str(e)}")