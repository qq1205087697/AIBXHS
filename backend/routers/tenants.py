from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_admin_user
from models.user import User

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    status: Optional[str] = None


@router.get("/")
async def get_tenants(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        query = text("""
            SELECT id, name, code, status, created_at, updated_at
            FROM tenants
            ORDER BY created_at DESC
        """)
        result = db.execute(query)
        tenants = []
        for row in result:
            tenants.append({
                "id": row[0],
                "name": row[1],
                "code": row[2],
                "status": row[3],
                "created_at": row[4].strftime("%Y-%m-%d %H:%M:%S") if row[4] else "",
                "updated_at": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else "",
            })
        return {"success": True, "data": tenants}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取租户列表失败: {str(e)}")


@router.get("/{tenant_id}")
async def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        query = text("""
            SELECT id, name, code, status, created_at, updated_at
            FROM tenants
            WHERE id = :tenant_id
        """)
        result = db.execute(query, {"tenant_id": tenant_id})
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="租户不存在")
        
        tenant = {
            "id": row[0],
            "name": row[1],
            "code": row[2],
            "status": row[3],
            "created_at": row[4].strftime("%Y-%m-%d %H:%M:%S") if row[4] else "",
            "updated_at": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else "",
        }
        return {"success": True, "data": tenant}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取租户详情失败: {str(e)}")


@router.put("/{tenant_id}")
async def update_tenant(
    tenant_id: int,
    tenant_data: TenantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        check = text("SELECT id FROM tenants WHERE id = :id")
        row = db.execute(check, {"id": tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="租户不存在")

        updates = []
        params = {"id": tenant_id}
        if tenant_data.name is not None:
            updates.append("name = :name")
            params["name"] = tenant_data.name
        if tenant_data.code is not None:
            updates.append("code = :code")
            params["code"] = tenant_data.code
        if tenant_data.status is not None:
            updates.append("status = :status")
            params["status"] = tenant_data.status

        if updates:
            update_sql = text(f"UPDATE tenants SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id")
            db.execute(update_sql, params)
            db.commit()

        return {"success": True, "message": "租户更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新租户失败: {str(e)}")
