from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_admin_user, get_current_user
from models.user import User
import random
import string

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantCreate(BaseModel):
    name: str
    code: str
    status: str = "active"


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    status: Optional[str] = None


class BindCompanyRequest(BaseModel):
    binding_code: str


@router.get("/")
async def get_tenants(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        query = text("""
            SELECT id, name, code, binding_code, status, is_personal, created_at, updated_at
            FROM tenants
            WHERE id = :tenant_id
            ORDER BY created_at DESC
        """)
        result = db.execute(query, {"tenant_id": current_user.tenant_id})
        tenants = []
        for row in result:
            tenants.append({
                "id": row[0],
                "name": row[1],
                "code": row[2],
                "binding_code": row[3] or "",
                "status": row[4],
                "is_personal": bool(row[5]) if row[5] is not None else False,
                "created_at": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else "",
                "updated_at": row[7].strftime("%Y-%m-%d %H:%M:%S") if row[7] else "",
            })
        return {"success": True, "data": tenants}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取公司列表失败: {str(e)}")


@router.get("/{tenant_id}")
async def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        if tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=403, detail="无权访问其他公司数据")
        query = text("""
            SELECT id, name, code, status, created_at, updated_at
            FROM tenants
            WHERE id = :tenant_id
        """)
        result = db.execute(query, {"tenant_id": tenant_id})
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="公司不存在")
        
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
        raise HTTPException(status_code=500, detail=f"获取公司详情失败: {str(e)}")


@router.put("/{tenant_id}")
async def update_tenant(
    tenant_id: int,
    tenant_data: TenantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        if tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=403, detail="无权修改其他公司数据")
        check = text("SELECT id FROM tenants WHERE id = :id")
        row = db.execute(check, {"id": tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="公司不存在")

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

        return {"success": True, "message": "公司更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新公司失败: {str(e)}")


@router.post("/")
async def create_tenant(
    tenant_data: TenantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        check = text("SELECT id FROM tenants WHERE code = :code")
        row = db.execute(check, {"code": tenant_data.code}).fetchone()
        if row:
            raise HTTPException(status_code=400, detail="租户编码已存在")

        db.execute(text("""
            INSERT INTO tenants (name, code, status, created_at, updated_at)
            VALUES (:name, :code, :status, NOW(), NOW())
        """), {
            "name": tenant_data.name,
            "code": tenant_data.code,
            "status": tenant_data.status,
        })
        db.commit()
        return {"success": True, "message": "租户创建成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建租户失败: {str(e)}")


@router.delete("/{tenant_id}")
async def delete_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        if tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=403, detail="无权删除其他公司")
        check = text("SELECT id FROM tenants WHERE id = :id")
        row = db.execute(check, {"id": tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="公司不存在")

        if tenant_id == 1:
            raise HTTPException(status_code=400, detail="不能删除默认公司")

        # 先删除关联数据（从子表到主表）
        db.execute(text("DELETE FROM operation_logs WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM inventory_actions WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM inventory_alerts WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM inventory_records WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM inventory_batches WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM warehouses WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 删除出库相关（通过父表关联删除子表）
        db.execute(text("""
            DELETE FROM outbound_order_items WHERE outbound_order_id IN (
                SELECT id FROM outbound_orders WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM outbound_orders WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 入库相关
        db.execute(text("""
            DELETE FROM inbound_order_items WHERE inbound_order_id IN (
                SELECT id FROM inbound_orders WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM inbound_orders WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 采购相关
        db.execute(text("""
            DELETE FROM purchase_order_items WHERE purchase_order_id IN (
                SELECT id FROM purchase_orders WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM purchase_orders WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 挪货相关
        db.execute(text("""
            DELETE FROM stock_transfer_order_items WHERE stock_transfer_order_id IN (
                SELECT id FROM stock_transfer_orders WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM stock_transfer_orders WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 商品/店铺/差评
        db.execute(text("DELETE FROM products WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM stores WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("""
            DELETE FROM review_analyses WHERE review_id IN (
                SELECT id FROM reviews WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM reviews WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 用户/部门/权限
        db.execute(text("""
            DELETE FROM user_departments WHERE user_id IN (
                SELECT id FROM users WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM users WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("""
            DELETE FROM user_departments WHERE department_id IN (
                SELECT id FROM departments WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM departments WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("""
            DELETE FROM role_permissions WHERE role_id IN (
                SELECT id FROM roles WHERE tenant_id = :id
            )
        """), {"id": tenant_id})
        db.execute(text("DELETE FROM roles WHERE tenant_id = :id"), {"id": tenant_id})
        db.execute(text("DELETE FROM permissions WHERE tenant_id = :id"), {"id": tenant_id})
        
        # 最后删除公司本身
        db.execute(text("DELETE FROM tenants WHERE id = :id"), {"id": tenant_id})
        db.commit()
        return {"success": True, "message": "公司删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除公司失败: {str(e)}")


def _generate_binding_code() -> str:
    """生成6位字母数字绑定码"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choices(chars, k=6))


@router.put("/{tenant_id}/generate-binding-code")
async def generate_binding_code(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        if tenant_id != current_user.tenant_id:
            raise HTTPException(status_code=403, detail="无权操作其他公司")
        check = text("SELECT id FROM tenants WHERE id = :id")
        row = db.execute(check, {"id": tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="公司不存在")

        # 生成唯一绑定码
        for _ in range(10):
            code = _generate_binding_code()
            existing = db.execute(text(
                "SELECT id FROM tenants WHERE binding_code = :bc AND id != :tid"
            ), {"bc": code, "tid": tenant_id}).fetchone()
            if not existing:
                break

        db.execute(text(
            "UPDATE tenants SET binding_code = :bc WHERE id = :id"
        ), {"bc": code, "id": tenant_id})
        db.commit()
        return {"success": True, "data": {"binding_code": code}, "message": "绑定码生成成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"生成绑定码失败: {str(e)}")


@router.post("/bind")
async def bind_company(
    data: BindCompanyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        code = data.binding_code.strip().upper()
        if not code:
            raise HTTPException(status_code=400, detail="请输入绑定码")

        tenant_row = db.execute(text("""
            SELECT id, name, code FROM tenants
            WHERE binding_code = :bc AND deleted_at IS NULL AND is_personal = 0
        """), {"bc": code}).fetchone()

        if not tenant_row:
            raise HTTPException(status_code=404, detail="绑定码无效，未找到对应公司")

        tenant_id = tenant_row[0]

        if current_user.tenant_id == tenant_id:
            raise HTTPException(status_code=400, detail="您已在该公司中")

        db.execute(text(
            "UPDATE users SET tenant_id = :tid WHERE id = :uid"
        ), {"tid": tenant_id, "uid": current_user.id})
        db.commit()

        return {
            "success": True,
            "message": f"成功加入公司「{tenant_row[1]}」",
            "data": {
                "tenant_id": tenant_id,
                "tenant_name": tenant_row[1],
                "tenant_code": tenant_row[2]
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"绑定公司失败: {str(e)}")
