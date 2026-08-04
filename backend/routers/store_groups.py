from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_user, get_current_admin_user
from models.user import User

router = APIRouter(prefix="/api/store-groups", tags=["store-groups"])


class StoreGroupCreate(BaseModel):
    name: str
    description: Optional[str] = None


class StoreGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class BatchAddStoresRequest(BaseModel):
    store_ids: List[int]


@router.get("/")
async def get_store_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        query = text("""
            SELECT sg.id, sg.name, sg.description, sg.created_at,
                   COUNT(s.id) as store_count
            FROM store_groups sg
            LEFT JOIN stores s ON s.group_id = sg.id AND s.deleted_at IS NULL
            WHERE sg.tenant_id = :tenant_id AND sg.deleted_at IS NULL
            GROUP BY sg.id, sg.name, sg.description, sg.created_at
            ORDER BY sg.created_at DESC
        """)
        rows = db.execute(query, {"tenant_id": current_user.tenant_id}).fetchall()
        groups = []
        for row in rows:
            groups.append({
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "created_at": row[3].strftime("%Y-%m-%d %H:%M:%S") if row[3] else "",
                "store_count": row[4],
            })
        return {"success": True, "data": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取分组列表失败: {str(e)}")


@router.get("/{group_id}/stores")
async def get_group_stores(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        check = db.execute(
            text("SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": group_id, "tid": current_user.tenant_id},
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="分组不存在")

        query = text("""
            SELECT s.id, s.name, s.ziniao_account, s.inventory_name, s.platform, s.site, s.status
            FROM stores s
            WHERE s.group_id = :group_id AND s.tenant_id = :tenant_id AND s.deleted_at IS NULL
            ORDER BY s.name ASC, s.site ASC
        """)
        rows = db.execute(query, {"group_id": group_id, "tenant_id": current_user.tenant_id}).fetchall()
        stores = [{"id": r[0], "name": r[1], "ziniao_account": r[2], "inventory_name": r[3], "platform": r[4], "site": r[5], "status": r[6]} for r in rows]
        return {"success": True, "data": stores}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取分组店铺失败: {str(e)}")


@router.post("/")
async def create_store_group(
    data: StoreGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    try:
        result = db.execute(
            text("""
                INSERT INTO store_groups (tenant_id, name, description)
                VALUES (:tenant_id, :name, :description)
            """),
            {"tenant_id": current_user.tenant_id, "name": data.name, "description": data.description},
        )
        db.commit()
        return {"success": True, "message": "分组创建成功", "data": {"id": result.lastrowid}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建分组失败: {str(e)}")


@router.put("/{group_id}")
async def update_store_group(
    group_id: int,
    data: StoreGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    try:
        check = db.execute(
            text("SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": group_id, "tid": current_user.tenant_id},
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="分组不存在")

        updates = []
        params: dict = {"id": group_id}
        if data.name is not None:
            updates.append("name = :name")
            params["name"] = data.name
        if data.description is not None:
            updates.append("description = :description")
            params["description"] = data.description

        if updates:
            db.execute(
                text(f"UPDATE store_groups SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                params,
            )
            db.commit()
        return {"success": True, "message": "分组更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新分组失败: {str(e)}")


@router.delete("/{group_id}")
async def delete_store_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    try:
        check = db.execute(
            text("SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": group_id, "tid": current_user.tenant_id},
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="分组不存在")

        db.execute(
            text("UPDATE stores SET group_id = NULL, updated_at = NOW() WHERE group_id = :gid AND tenant_id = :tid"),
            {"gid": group_id, "tid": current_user.tenant_id},
        )
        db.execute(
            text("UPDATE store_groups SET deleted_at = NOW() WHERE id = :id"),
            {"id": group_id},
        )
        db.commit()
        return {"success": True, "message": "分组删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除分组失败: {str(e)}")


@router.post("/{group_id}/stores")
async def batch_add_stores_to_group(
    group_id: int,
    data: BatchAddStoresRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    try:
        check = db.execute(
            text("SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": group_id, "tid": current_user.tenant_id},
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="分组不存在")

        if not data.store_ids:
            raise HTTPException(status_code=400, detail="请选择要添加的店铺")

        placeholders = ",".join([f":id_{i}" for i in range(len(data.store_ids))])
        params: dict = {f"id_{i}": sid for i, sid in enumerate(data.store_ids)}
        params["tenant_id"] = current_user.tenant_id
        params["group_id"] = group_id

        db.execute(
            text(f"""
                UPDATE stores SET group_id = :group_id, updated_at = NOW()
                WHERE id IN ({placeholders}) AND tenant_id = :tenant_id
            """),
            params,
        )
        db.commit()
        return {"success": True, "message": f"成功添加 {len(data.store_ids)} 个店铺到分组"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"添加店铺到分组失败: {str(e)}")


@router.delete("/{group_id}/stores/{store_id}")
async def remove_store_from_group(
    group_id: int,
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    try:
        db.execute(
            text("""
                UPDATE stores SET group_id = NULL, updated_at = NOW()
                WHERE id = :store_id AND group_id = :group_id AND tenant_id = :tenant_id
            """),
            {"store_id": store_id, "group_id": group_id, "tenant_id": current_user.tenant_id},
        )
        db.commit()
        return {"success": True, "message": "已从分组移除"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"移除失败: {str(e)}")


# ==================== 店铺分组人员管理 ====================

class GroupMemberRequest(BaseModel):
    user_ids: List[int]


@router.get("/{group_id}/members")
async def get_group_members(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """获取店铺分组关联的人员列表（合并分组下所有店铺的人员）"""
    try:
        # 验证分组存在且属于当前租户
        check = db.execute(
            text("SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": group_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="分组不存在")

        # 获取分组下所有店铺的人员（去重）
        query = text("""
            SELECT DISTINCT u.id, u.username, u.nickname, u.email
            FROM users u
            INNER JOIN user_stores us ON u.id = us.user_id
            INNER JOIN stores s ON us.store_id = s.id
            WHERE s.group_id = :group_id AND us.tenant_id = :tid AND u.deleted_at IS NULL
            ORDER BY u.nickname ASC
        """)
        rows = db.execute(query, {"group_id": group_id, "tid": current_user.tenant_id}).fetchall()
        members = [{"id": r[0], "username": r[1], "name": r[2] or r[1], "email": r[3]} for r in rows]
        return {"success": True, "data": members}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取人员列表失败: {str(e)}")


@router.put("/{group_id}/members")
async def set_group_members(
    group_id: int,
    request: GroupMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """批量为店铺分组下所有店铺设置人员"""
    try:
        # 验证分组存在且属于当前租户
        check = db.execute(
            text("SELECT id FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": group_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="分组不存在")

        # 获取分组下所有店铺
        stores = db.execute(
            text("SELECT id FROM stores WHERE group_id = :gid AND tenant_id = :tid AND deleted_at IS NULL"),
            {"gid": group_id, "tid": current_user.tenant_id}
        ).fetchall()
        store_ids = [s[0] for s in stores]

        if not store_ids:
            return {"success": True, "message": "分组下没有店铺"}

        # 清空分组下所有店铺的现有人员
        placeholders = ",".join([f":sid_{i}" for i in range(len(store_ids))])
        params = {f"sid_{i}": sid for i, sid in enumerate(store_ids)}
        params["tid"] = current_user.tenant_id
        db.execute(
            text(f"DELETE FROM user_stores WHERE store_id IN ({placeholders}) AND tenant_id = :tid"),
            params
        )

        # 为每个店铺添加人员
        added_count = 0
        for store_id in store_ids:
            for user_id in request.user_ids:
                # 验证用户存在且属于当前租户
                user_check = db.execute(
                    text("SELECT id FROM users WHERE id = :uid AND tenant_id = :tid AND deleted_at IS NULL"),
                    {"uid": user_id, "tid": current_user.tenant_id}
                ).fetchone()
                if not user_check:
                    continue
                db.execute(
                    text("INSERT INTO user_stores (tenant_id, user_id, store_id) VALUES (:tid, :uid, :sid)"),
                    {"tid": current_user.tenant_id, "uid": user_id, "sid": store_id}
                )
                added_count += 1

        db.commit()
        return {"success": True, "message": f"成功为 {len(store_ids)} 个店铺分配 {len(request.user_ids)} 个人员"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"设置人员失败: {str(e)}")
