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
from services.operation_log import log_order_create, log_order_update, log_order_confirm, log_order_cancel, log_order_delete
from services.excel_helper import create_purchase_excel_template, parse_purchase_excel

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase_orders"])


class PurchaseItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: Optional[float] = 0
    notes: Optional[str] = None


class PurchaseOrderCreate(BaseModel):
    order_number: str
    supplier: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    warehouse: Optional[str] = None
    expected_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[PurchaseItemCreate]


class PurchaseOrderUpdate(BaseModel):
    order_number: Optional[str] = None
    supplier: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    warehouse: Optional[str] = None
    expected_date: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


@router.get("/")
async def get_purchase_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    supplier: Optional[str] = None,
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
        if supplier:
            where_conditions.append("po.supplier LIKE :supplier")
            params["supplier"] = f"%{supplier}%"
        if search:
            where_conditions.append("(po.order_number LIKE :search OR po.supplier LIKE :search)")
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
            SELECT po.id, po.order_number, po.supplier, po.contact_person, po.contact_phone,
                   po.warehouse, po.expected_date, po.total_amount, po.status, po.notes, po.created_by,
                   po.approved_at, po.created_at, po.approved_by
            FROM purchase_orders po
            WHERE {where_clause}
            ORDER BY po.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()
        
        # 收集所有用户ID
        user_ids = set()
        for row in rows:
            if row[9]:  # created_by
                user_ids.add(row[9])
            if row[12]:  # approved_by
                user_ids.add(row[12])
        
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
                       poi.quantity, poi.received_quantity, poi.unit_price, poi.total_price, poi.notes
                FROM purchase_order_items poi
                LEFT JOIN products p ON p.id = poi.product_id
                WHERE poi.purchase_order_id = :oid AND poi.deleted_at IS NULL
            """), {"oid": row[0]}).fetchall()

            order_items = []
            for item in items:
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
                })

            orders.append({
                "id": row[0],
                "order_number": row[1],
                "supplier": row[2] or "",
                "contact_person": row[3] or "",
                "contact_phone": row[4] or "",
                "warehouse": row[5] or "",
                "expected_date": row[6].strftime("%Y-%m-%d") if row[6] else "",
                "total_amount": float(row[7]) if row[7] else 0,
                "status": row[8],
                "notes": row[9] or "",
                "created_by": row[10],
                "approved_at": row[11].strftime("%Y-%m-%d %H:%M:%S") if row[11] else "",
                "created_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else "",
                "approved_by": row[13],
                "creator_name": user_map.get(row[10], ""),
                "approver_name": user_map.get(row[13], ""),
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
        if not data.items:
            raise HTTPException(status_code=400, detail="请至少添加一条采购明细")

        total_amt = sum((item.quantity * (item.unit_price or 0)) for item in data.items)

        db.execute(text("""
            INSERT INTO purchase_orders (tenant_id, order_number, supplier, contact_person, contact_phone,
                warehouse, expected_date, total_amount, status, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :supplier, :contact_person, :contact_phone,
                :warehouse, :expected_date, :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "order_number": data.order_number,
            "supplier": data.supplier,
            "contact_person": data.contact_person,
            "contact_phone": data.contact_phone,
            "warehouse": data.warehouse,
            "expected_date": data.expected_date,
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
                INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price, total_price, notes, created_at, updated_at)
                VALUES (:oid, :pid, :qty, :up, :tp, :notes, :created_at, :updated_at)
            """), {
                "oid": order_id, "pid": item.product_id, "qty": item.quantity,
                "up": item.unit_price, "tp": total_price, "notes": item.notes,
                "created_at": datetime.now(), "updated_at": datetime.now(),
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "purchase", order_id, data.order_number,
                         {"order_number": data.order_number, "supplier": data.supplier, "items_count": len(data.items)})
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

        updates = []
        params = {"id": order_id}
        for field in ["order_number", "supplier", "contact_person", "contact_phone", "warehouse", "expected_date", "notes", "status"]:
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

        after_data = {"order_number": row[1], "status": data.status or before_status}
        
        if is_approve:
            log_order_confirm(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                             "purchase", order_id, row[1],
                             {"status": before_status}, {"status": "approved"})
            db.commit()
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
        db.execute(text("UPDATE purchase_orders SET deleted_at = NOW() WHERE id = :id"), {"id": order_id})
        db.execute(text("UPDATE purchase_order_items SET deleted_at = NOW() WHERE purchase_order_id = :oid"), {"oid": order_id})
        db.commit()

        log_order_delete(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "purchase", order_id, row[1], before_data)
        db.commit()

        return {"success": True, "message": "采购订单已删除"}
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
        
        return {"success": True, "data": items}
    except HTTPException:
        raise
    except ValueError as e:
        # 业务错误（如产品编码不存在）返回400
        raise HTTPException(status_code=400, detail=f"{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析Excel失败: {str(e)}")