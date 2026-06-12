from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User

router = APIRouter(prefix="/api/product-bindings", tags=["product_bindings"])


class ProductBindingCreate(BaseModel):
    finished_product_id: int
    accessory_product_id: int
    quantity: int = 1


class ProductBindingResponse(BaseModel):
    id: int
    finished_product_id: int
    finished_product_name: str = ""
    finished_product_code: str = ""
    accessory_product_id: int
    accessory_product_name: str = ""
    accessory_product_code: str = ""
    quantity: int


@router.get("/by-finished/{product_id}")
async def get_bindings_by_finished(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取某个成品绑定的所有配件"""
    try:
        rows = db.execute(text("""
            SELECT pb.id, pb.finished_product_id, pb.accessory_product_id, pb.quantity,
                   p.name as accessory_name, p.product_code as accessory_code
            FROM product_bindings pb
            LEFT JOIN products p ON p.id = pb.accessory_product_id
            WHERE pb.finished_product_id = :pid AND pb.deleted_at IS NULL
              AND p.deleted_at IS NULL
        """), {"pid": product_id}).fetchall()

        bindings = []
        for row in rows:
            bindings.append({
                "id": row[0],
                "finished_product_id": row[1],
                "accessory_product_id": row[2],
                "quantity": int(row[3]),
                "accessory_name": row[4] or f"产品#{row[2]}",
                "accessory_code": row[5] or "",
            })

        return {"success": True, "data": bindings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取成品配件绑定失败: {str(e)}")


@router.get("/by-accessory/{product_id}")
async def get_bindings_by_accessory(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取某个配件被哪些成品绑定"""
    try:
        rows = db.execute(text("""
            SELECT pb.id, pb.finished_product_id, pb.accessory_product_id, pb.quantity,
                   p.name as finished_name, p.product_code as finished_code
            FROM product_bindings pb
            LEFT JOIN products p ON p.id = pb.finished_product_id
            WHERE pb.accessory_product_id = :pid AND pb.deleted_at IS NULL
              AND p.deleted_at IS NULL
        """), {"pid": product_id}).fetchall()

        bindings = []
        for row in rows:
            bindings.append({
                "id": row[0],
                "finished_product_id": row[1],
                "accessory_product_id": row[2],
                "quantity": int(row[3]),
                "finished_name": row[4] or f"产品#{row[1]}",
                "finished_code": row[5] or "",
            })

        return {"success": True, "data": bindings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取配件所属成品失败: {str(e)}")


@router.post("/")
async def create_binding(
    data: ProductBindingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:edit"))
):
    """创建成品配件绑定"""
    try:
        # 验证成品是否存在
        finished = db.execute(text(
            "SELECT id, name FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": data.finished_product_id, "tid": current_user.tenant_id}).fetchone()
        if not finished:
            raise HTTPException(status_code=404, detail="成品产品不存在")

        # 验证配件是否存在
        accessory = db.execute(text(
            "SELECT id, name FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": data.accessory_product_id, "tid": current_user.tenant_id}).fetchone()
        if not accessory:
            raise HTTPException(status_code=404, detail="配件产品不存在")

        # 不能绑定自己
        if data.finished_product_id == data.accessory_product_id:
            raise HTTPException(status_code=400, detail="不能绑定自己")

        if data.quantity <= 0:
            raise HTTPException(status_code=400, detail="配件数量必须大于0")

        # 检查是否已有绑定关系
        existing = db.execute(text("""
            SELECT id FROM product_bindings 
            WHERE finished_product_id = :fid AND accessory_product_id = :aid AND deleted_at IS NULL
        """), {"fid": data.finished_product_id, "aid": data.accessory_product_id}).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="该绑定关系已存在")

        db.execute(text("""
            INSERT INTO product_bindings (finished_product_id, accessory_product_id, quantity, created_at, updated_at)
            VALUES (:fid, :aid, :qty, :now, :now)
        """), {
            "fid": data.finished_product_id,
            "aid": data.accessory_product_id,
            "qty": data.quantity,
            "now": datetime.now(),
        })
        db.commit()

        return {"success": True, "message": "绑定成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建绑定失败: {str(e)}")


@router.put("/{binding_id}")
async def update_binding(
    binding_id: int,
    data: ProductBindingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:edit"))
):
    """更新绑定关系（配件数量）"""
    try:
        if data.quantity <= 0:
            raise HTTPException(status_code=400, detail="配件数量必须大于0")

        row = db.execute(text(
            "SELECT id FROM product_bindings WHERE id = :id AND deleted_at IS NULL"
        ), {"id": binding_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="绑定关系不存在")

        db.execute(text("""
            UPDATE product_bindings SET quantity = :qty, updated_at = :now WHERE id = :id
        """), {"qty": data.quantity, "now": datetime.now(), "id": binding_id})
        db.commit()

        return {"success": True, "message": "更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新绑定失败: {str(e)}")


@router.delete("/{binding_id}")
async def delete_binding(
    binding_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:delete"))
):
    """删除绑定关系"""
    try:
        row = db.execute(text(
            "SELECT id FROM product_bindings WHERE id = :id AND deleted_at IS NULL"
        ), {"id": binding_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="绑定关系不存在")

        db.execute(text("""
            UPDATE product_bindings SET deleted_at = :now WHERE id = :id
        """), {"now": datetime.now(), "id": binding_id})
        db.commit()

        return {"success": True, "message": "绑定关系已删除"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除绑定失败: {str(e)}")