from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User

router = APIRouter(prefix="/api/warehouses", tags=["warehouses"])


class WarehouseCreate(BaseModel):
    name: str
    code: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/")
async def get_warehouses(
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where = ["w.tenant_id = :tid", "w.deleted_at IS NULL"]
        params = {"tid": current_user.tenant_id}

        if search:
            where.append("(w.name LIKE :search OR w.code LIKE :search)")
            params["search"] = f"%{search}%"
        if status:
            where.append("w.status = :status")
            params["status"] = status

        where_clause = " AND ".join(where)
        
        # 获取总数
        count_result = db.execute(text(f"""
            SELECT COUNT(*) FROM warehouses w WHERE {where_clause}
        """), params).scalar()
        total = count_result or 0
        
        # 获取分页数据
        offset = (page - 1) * page_size
        rows = db.execute(text(f"""
            SELECT w.id, w.name, w.code, w.address, w.contact_person,
                   w.contact_phone, w.status, w.notes, w.created_at
            FROM warehouses w
            WHERE {where_clause}
            ORDER BY w.created_at DESC
            LIMIT :limit OFFSET :offset
        """), {**params, "limit": page_size, "offset": offset}).fetchall()

        result = []
        for r in rows:
            result.append({
                "id": r[0], "name": r[1], "code": r[2],
                "address": r[3] or "", "contact_person": r[4] or "",
                "contact_phone": r[5] or "", "status": r[6],
                "notes": r[7] or "", "created_at": r[8].strftime("%Y-%m-%d %H:%M:%S") if r[8] else "",
            })
        return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取仓库列表失败: {str(e)}")


@router.post("/")
async def create_warehouse(
    data: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("warehouse:create"))
):
    try:
        warehouse_code = data.code
        if not warehouse_code:
            # 自动生成编码：WH + YYYYMMDD + 序号（3位）
            today = datetime.now().strftime("%Y%m%d")
            count = db.execute(text("""
                SELECT COUNT(*) FROM warehouses 
                WHERE tenant_id = :tid AND code LIKE :prefix AND deleted_at IS NULL
            """), {"tid": current_user.tenant_id, "prefix": f"WH{today}%"}).scalar() or 0
            warehouse_code = f"WH{today}{(count + 1):03d}"

        if data.code:
            existing = db.execute(text(
                "SELECT id FROM warehouses WHERE tenant_id = :tid AND code = :code AND deleted_at IS NULL"
            ), {"tid": current_user.tenant_id, "code": warehouse_code}).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="仓库编码已存在")

        result = db.execute(text("""
            INSERT INTO warehouses (tenant_id, name, code, address, contact_person,
                contact_phone, status, notes, created_at, updated_at)
            VALUES (:tid, :name, :code, :addr, :cp, :cphone, 'active', :notes, NOW(), NOW())
        """), {
            "tid": current_user.tenant_id, "name": data.name, "code": warehouse_code,
            "addr": data.address, "cp": data.contact_person,
            "cphone": data.contact_phone, "notes": data.notes,
        })
        db.commit()
        return {"success": True, "id": result.lastrowid, "message": "创建成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建仓库失败: {str(e)}")


@router.put("/{warehouse_id}")
async def update_warehouse(
    warehouse_id: int,
    data: WarehouseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("warehouse:edit"))
):
    try:
        existing = db.execute(text(
            "SELECT id FROM warehouses WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": warehouse_id, "tid": current_user.tenant_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="仓库不存在")

        updates = ["updated_at = NOW()"]
        params = {"id": warehouse_id}

        if data.name is not None:
            updates.append("name = :name")
            params["name"] = data.name
        if data.code is not None:
            code_check = db.execute(text(
                "SELECT id FROM warehouses WHERE tenant_id = :tid AND code = :code AND id != :id AND deleted_at IS NULL"
            ), {"tid": current_user.tenant_id, "code": data.code, "id": warehouse_id}).fetchone()
            if code_check:
                raise HTTPException(status_code=400, detail="仓库编码已存在")
            updates.append("code = :code")
            params["code"] = data.code
        if data.address is not None:
            updates.append("address = :addr")
            params["addr"] = data.address
        if data.contact_person is not None:
            updates.append("contact_person = :cp")
            params["cp"] = data.contact_person
        if data.contact_phone is not None:
            updates.append("contact_phone = :cphone")
            params["cphone"] = data.contact_phone
        if data.status is not None:
            updates.append("status = :status")
            params["status"] = data.status
        if data.notes is not None:
            updates.append("notes = :notes")
            params["notes"] = data.notes

        db.execute(text(f"UPDATE warehouses SET {', '.join(updates)} WHERE id = :id"), params)
        db.commit()
        return {"success": True, "message": "更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新仓库失败: {str(e)}")


@router.delete("/{warehouse_id}")
async def delete_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("warehouse:delete"))
):
    try:
        existing = db.execute(text(
            "SELECT id, name FROM warehouses WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": warehouse_id, "tid": current_user.tenant_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="仓库不存在")

        usage = db.execute(text(
            "SELECT COUNT(*) FROM inventory_batches WHERE warehouse = :wn AND tenant_id = :tid AND deleted_at IS NULL AND current_quantity > 0"
        ), {"wn": existing[1], "tid": current_user.tenant_id}).scalar() or 0
        if usage > 0:
            raise HTTPException(status_code=400, detail=f"仓库'{existing[1]}'中有库存，无法删除")

        db.execute(text("UPDATE warehouses SET deleted_at = NOW() WHERE id = :id"), {"id": warehouse_id})
        db.commit()
        return {"success": True, "message": "删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除仓库失败: {str(e)}")