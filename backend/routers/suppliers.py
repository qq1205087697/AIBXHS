from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from database.database import get_db
from dependencies import PermissionChecker, get_current_user
from models.user import User

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


class SupplierCreate(BaseModel):
    name: str
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


@router.get("/list-all")
async def list_all_suppliers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有供应商（无分页，用于下拉选择）"""
    try:
        rows = db.execute(text("""
            SELECT s.id, s.name, s.contact_person, s.contact_phone
            FROM suppliers s
            WHERE s.tenant_id = :tid AND s.deleted_at IS NULL
            ORDER BY s.name ASC
        """), {"tid": current_user.tenant_id}).fetchall()

        result = []
        for r in rows:
            result.append({
                "id": r[0],
                "name": r[1],
                "contact_person": r[2] or "",
                "contact_phone": r[3] or "",
            })
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取供应商列表失败: {str(e)}")


@router.get("/")
async def get_suppliers(
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取供应商列表（分页+搜索）"""
    try:
        where = ["s.tenant_id = :tid", "s.deleted_at IS NULL"]
        params = {"tid": current_user.tenant_id}

        if search:
            where.append("(s.name LIKE :search OR s.contact_person LIKE :search OR s.contact_phone LIKE :search)")
            params["search"] = f"%{search}%"

        where_clause = " AND ".join(where)

        # 获取总数
        count_result = db.execute(text(f"""
            SELECT COUNT(*) FROM suppliers s WHERE {where_clause}
        """), params).scalar()
        total = count_result or 0

        # 获取分页数据
        offset = (page - 1) * page_size
        rows = db.execute(text(f"""
            SELECT s.id, s.name, s.contact_person, s.contact_phone,
                   s.address, s.notes, s.created_at
            FROM suppliers s
            WHERE {where_clause}
            ORDER BY s.created_at DESC
            LIMIT :limit OFFSET :offset
        """), {**params, "limit": page_size, "offset": offset}).fetchall()

        result = []
        for r in rows:
            result.append({
                "id": r[0],
                "name": r[1],
                "contact_person": r[2] or "",
                "contact_phone": r[3] or "",
                "address": r[4] or "",
                "notes": r[5] or "",
                "created_at": r[6].strftime("%Y-%m-%d %H:%M:%S") if r[6] else "",
            })
        return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取供应商列表失败: {str(e)}")


@router.post("/")
async def create_supplier(
    data: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("supplier:create"))
):
    """创建供应商"""
    try:
        # 检查同名供应商是否已存在
        existing = db.execute(text("""
            SELECT id FROM suppliers
            WHERE tenant_id = :tid AND name = :name AND deleted_at IS NULL
        """), {"tid": current_user.tenant_id, "name": data.name}).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="供应商名称已存在")

        result = db.execute(text("""
            INSERT INTO suppliers (tenant_id, name, contact_person, contact_phone,
                address, notes, created_at, updated_at)
            VALUES (:tid, :name, :cp, :cphone, :addr, :notes, NOW(), NOW())
        """), {
            "tid": current_user.tenant_id,
            "name": data.name,
            "cp": data.contact_person,
            "cphone": data.contact_phone,
            "addr": data.address,
            "notes": data.notes,
        })
        db.commit()

        # 查询新建记录返回完整数据
        row = db.execute(text("""
            SELECT s.id, s.name, s.contact_person, s.contact_phone,
                   s.address, s.notes, s.created_at
            FROM suppliers s
            WHERE s.id = :id
        """), {"id": result.lastrowid}).fetchone()

        return {
            "success": True,
            "data": {
                "id": row[0],
                "name": row[1],
                "contact_person": row[2] or "",
                "contact_phone": row[3] or "",
                "address": row[4] or "",
                "notes": row[5] or "",
                "created_at": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建供应商失败: {str(e)}")


@router.put("/{supplier_id}")
async def update_supplier(
    supplier_id: int,
    data: SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("supplier:edit"))
):
    """更新供应商"""
    try:
        existing = db.execute(text("""
            SELECT id FROM suppliers
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """), {"id": supplier_id, "tid": current_user.tenant_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="供应商不存在")

        updates = ["updated_at = NOW()"]
        params = {"id": supplier_id}

        if data.name is not None:
            # 检查同名供应商是否已存在（排除自身）
            name_check = db.execute(text("""
                SELECT id FROM suppliers
                WHERE tenant_id = :tid AND name = :name AND id != :id AND deleted_at IS NULL
            """), {"tid": current_user.tenant_id, "name": data.name, "id": supplier_id}).fetchone()
            if name_check:
                raise HTTPException(status_code=400, detail="供应商名称已存在")
            updates.append("name = :name")
            params["name"] = data.name
        if data.contact_person is not None:
            updates.append("contact_person = :cp")
            params["cp"] = data.contact_person
        if data.contact_phone is not None:
            updates.append("contact_phone = :cphone")
            params["cphone"] = data.contact_phone
        if data.address is not None:
            updates.append("address = :addr")
            params["addr"] = data.address
        if data.notes is not None:
            updates.append("notes = :notes")
            params["notes"] = data.notes

        db.execute(text(f"UPDATE suppliers SET {', '.join(updates)} WHERE id = :id"), params)
        db.commit()

        # 查询更新后的完整数据
        row = db.execute(text("""
            SELECT s.id, s.name, s.contact_person, s.contact_phone,
                   s.address, s.notes, s.created_at
            FROM suppliers s
            WHERE s.id = :id
        """), {"id": supplier_id}).fetchone()

        return {
            "success": True,
            "data": {
                "id": row[0],
                "name": row[1],
                "contact_person": row[2] or "",
                "contact_phone": row[3] or "",
                "address": row[4] or "",
                "notes": row[5] or "",
                "created_at": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新供应商失败: {str(e)}")


@router.delete("/{supplier_id}")
async def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("supplier:delete"))
):
    """软删除供应商"""
    try:
        existing = db.execute(text("""
            SELECT id, name FROM suppliers
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """), {"id": supplier_id, "tid": current_user.tenant_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="供应商不存在")

        db.execute(text("UPDATE suppliers SET deleted_at = NOW() WHERE id = :id"), {"id": supplier_id})
        db.commit()
        return {"success": True, "data": {"id": supplier_id}, "message": "删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除供应商失败: {str(e)}")
