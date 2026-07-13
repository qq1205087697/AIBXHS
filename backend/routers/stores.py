from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_user, get_current_admin_user
from models.user import User

router = APIRouter(prefix="/api/stores", tags=["stores"])


class StoreCreate(BaseModel):
    inventory_name: str
    name: Optional[str] = None
    ziniao_account: Optional[str] = None
    platform: str = "amazon"
    site: Optional[str] = None
    shop_abbr: str
    department_id: Optional[int] = None


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    ziniao_account: Optional[str] = None
    platform: Optional[str] = None
    site: Optional[str] = None
    inventory_name: Optional[str] = None
    shop_abbr: Optional[str] = None
    department_id: Optional[int] = None
    group_id: Optional[int] = None
    status: Optional[str] = None


@router.get("/all")
async def get_all_stores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["s.tenant_id = :tenant_id", "s.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        is_admin = False
        if current_user.role_id:
            role_row = db.execute(
                text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"),
                {"role_id": current_user.role_id}
            ).fetchone()
            if role_row and role_row[0] == "admin":
                is_admin = True

        if not is_admin:
            store_ids = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in store_ids]
            if store_id_list:
                store_placeholders = ",".join([f":store_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    params[f"store_{i}"] = sid
                where_conditions.append(f"s.id IN ({store_placeholders})")
            else:
                where_conditions.append("1=0")

        where_clause = " AND ".join(where_conditions)
        
        query = text(f"""
            SELECT s.id, s.name, s.ziniao_account, s.platform, s.site, s.status,
                   s.department_id, d.name as department_name, s.created_at,
                   s.group_id, sg.name as group_name,
                   s.inventory_name, s.shop_abbr
            FROM stores s
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN store_groups sg ON s.group_id = sg.id AND sg.deleted_at IS NULL
            WHERE {where_clause}
            ORDER BY s.created_at DESC, s.inventory_name ASC
        """)
        result = db.execute(query, params)
        stores = []
        for row in result:
            stores.append({
                "id": row[0],
                "name": row[1],
                "ziniao_account": row[2] or "",
                "platform": row[3],
                "site": row[4] or "",
                "status": row[5],
                "department_id": row[6],
                "department_name": row[7] or "未分配",
                "created_at": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else "",
                "group_id": row[9],
                "group_name": row[10] or "",
                "inventory_name": row[11] or "",
                "shop_abbr": row[12] or "",
            })
        return {"success": True, "data": stores}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取店铺列表失败: {str(e)}")


@router.get("/")
async def get_stores(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        where_conditions = ["s.tenant_id = :tenant_id", "s.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        is_admin = False
        if current_user.role_id:
            role_row = db.execute(
                text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"),
                {"role_id": current_user.role_id}
            ).fetchone()
            if role_row and role_row[0] == "admin":
                is_admin = True

        if not is_admin:
            store_ids = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in store_ids]
            if store_id_list:
                store_placeholders = ",".join([f":store_{i}" for i in range(len(store_id_list))])
                for i, sid in enumerate(store_id_list):
                    params[f"store_{i}"] = sid
                where_conditions.append(f"s.id IN ({store_placeholders})")
            else:
                where_conditions.append("1=0")

        if search:
            where_conditions.append("(s.name LIKE :search OR s.inventory_name LIKE :search OR s.site LIKE :search)")
            params["search"] = f"%{search}%"

        where_clause = " AND ".join(where_conditions)
        
        # 计算总数
        count_query = text(f"""
            SELECT COUNT(*) FROM stores s
            LEFT JOIN departments d ON s.department_id = d.id
            WHERE {where_clause}
        """)
        total_result = db.execute(count_query, params)
        total = total_result.fetchone()[0]
        
        # 分页查询数据
        offset = (page - 1) * page_size
        params["offset"] = offset
        params["page_size"] = page_size
        
        query = text(f"""
            SELECT s.id, s.name, s.ziniao_account, s.platform, s.site, s.status,
                   s.department_id, d.name as department_name, s.inventory_name, s.shop_abbr, s.created_at,
                   s.group_id, sg.name as group_name
            FROM stores s
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN store_groups sg ON s.group_id = sg.id AND sg.deleted_at IS NULL
            WHERE {where_clause}
            ORDER BY s.created_at DESC, s.inventory_name ASC
            LIMIT :page_size OFFSET :offset
        """)
        result = db.execute(query, params)
        stores = []
        for row in result:
            stores.append({
                "id": row[0],
                "name": row[1],
                "ziniao_account": row[2] or "",
                "platform": row[3],
                "site": row[4] or "",
                "status": row[5],
                "department_id": row[6],
                "department_name": row[7] or "未分配",
                "inventory_name": row[8] or "",
                "shop_abbr": row[9] or "",
                "created_at": row[10].strftime("%Y-%m-%d %H:%M:%S") if row[10] else "",
                "group_id": row[11],
                "group_name": row[12] or "",
            })
        return {"success": True, "data": stores, "total": total}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取店铺列表失败: {str(e)}")


@router.post("/")
async def create_store(
    store_data: StoreCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        insert_sql = text("""
            INSERT INTO stores (tenant_id, name, ziniao_account, platform, site, inventory_name, shop_abbr, department_id)
            VALUES (:tenant_id, :name, :ziniao_account, :platform, :site, :inventory_name, :shop_abbr, :department_id)
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "name": store_data.name or store_data.inventory_name,
            "ziniao_account": store_data.ziniao_account,
            "platform": store_data.platform,
            "site": store_data.site,
            "inventory_name": store_data.inventory_name,
            "shop_abbr": store_data.shop_abbr,
            "department_id": store_data.department_id,
        })
        db.commit()
        return {
            "success": True,
            "message": "店铺创建成功",
            "data": {"id": result.lastrowid}
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建店铺失败: {str(e)}")


@router.put("/{store_id}")
async def update_store(
    store_id: int,
    store_data: StoreUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        check = text("SELECT id FROM stores WHERE id = :id AND tenant_id = :tid")
        row = db.execute(check, {"id": store_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="店铺不存在")

        updates = []
        params = {"id": store_id}
        if store_data.name is not None:
            updates.append("name = :name")
            params["name"] = store_data.name
        if store_data.ziniao_account is not None:
            updates.append("ziniao_account = :ziniao_account")
            params["ziniao_account"] = store_data.ziniao_account
        if store_data.inventory_name is not None:
            updates.append("inventory_name = :inventory_name")
            params["inventory_name"] = store_data.inventory_name
        if store_data.platform is not None:
            updates.append("platform = :platform")
            params["platform"] = store_data.platform
        if store_data.site is not None:
            updates.append("site = :site")
            params["site"] = store_data.site
        if store_data.shop_abbr is not None:
            updates.append("shop_abbr = :shop_abbr")
            params["shop_abbr"] = store_data.shop_abbr
        if store_data.department_id is not None:
            updates.append("department_id = :department_id")
            params["department_id"] = store_data.department_id
        if hasattr(store_data, 'group_id'):
            updates.append("group_id = :group_id")
            params["group_id"] = store_data.group_id
        if store_data.status is not None:
            updates.append("status = :status")
            params["status"] = store_data.status

        if updates:
            update_sql = text(f"UPDATE stores SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id")
            db.execute(update_sql, params)
            db.commit()

        return {"success": True, "message": "店铺更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新店铺失败: {str(e)}")


@router.delete("/{store_id}")
async def delete_store(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        db.execute(text("DELETE FROM stores WHERE id = :id AND tenant_id = :tid"), {
            "id": store_id,
            "tid": current_user.tenant_id
        })
        db.commit()
        return {"success": True, "message": "店铺删除成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除店铺失败: {str(e)}")


class BatchUpdateDepartmentRequest(BaseModel):
    store_ids: List[int]
    department_id: Optional[int] = None


@router.post("/batch-update-department")
async def batch_update_department(
    request: BatchUpdateDepartmentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        if not request.store_ids:
            raise HTTPException(status_code=400, detail="请选择要更新的店铺")
        
        # 验证所有店铺都属于当前租户
        placeholders = ",".join([f":id_{i}" for i in range(len(request.store_ids))])
        params = {f"id_{i}": store_id for i, store_id in enumerate(request.store_ids)}
        params["tenant_id"] = current_user.tenant_id
        
        check_query = text(f"""
            SELECT COUNT(*) FROM stores 
            WHERE id IN ({placeholders}) AND tenant_id = :tenant_id
        """)
        count_result = db.execute(check_query, params)
        count = count_result.fetchone()[0]
        
        if count != len(request.store_ids):
            raise HTTPException(status_code=400, detail="部分店铺不存在或无权限")
        
        # 批量更新
        update_params = params.copy()
        update_params["department_id"] = request.department_id
        
        update_query = text(f"""
            UPDATE stores 
            SET department_id = :department_id, updated_at = NOW()
            WHERE id IN ({placeholders}) AND tenant_id = :tenant_id
        """)
        db.execute(update_query, update_params)
        db.commit()
        
        return {"success": True, "message": f"成功更新 {count} 个店铺的部门"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量更新失败: {str(e)}")


# ==================== 店铺分配人员 ====================

class StoreMemberRequest(BaseModel):
    user_ids: List[int]


@router.get("/{store_id}/members")
async def get_store_members(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """获取店铺关联的人员列表"""
    try:
        # 验证店铺存在且属于当前租户
        check = db.execute(
            text("SELECT id FROM stores WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": store_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="店铺不存在")

        query = text("""
            SELECT u.id, u.username, u.nickname, u.email
            FROM users u
            INNER JOIN user_stores us ON u.id = us.user_id
            WHERE us.store_id = :store_id AND us.tenant_id = :tid AND u.deleted_at IS NULL
            ORDER BY u.nickname ASC
        """)
        rows = db.execute(query, {"store_id": store_id, "tid": current_user.tenant_id}).fetchall()
        members = [{"id": r[0], "username": r[1], "name": r[2] or r[1], "email": r[3]} for r in rows]
        return {"success": True, "data": members}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取人员列表失败: {str(e)}")


@router.post("/{store_id}/members")
async def add_store_members(
    store_id: int,
    request: StoreMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """为店铺添加人员"""
    try:
        # 验证店铺存在且属于当前租户
        check = db.execute(
            text("SELECT id FROM stores WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": store_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="店铺不存在")

        if not request.user_ids:
            raise HTTPException(status_code=400, detail="请选择要添加的人员")

        added_count = 0
        for user_id in request.user_ids:
            # 验证用户存在且属于当前租户
            user_check = db.execute(
                text("SELECT id FROM users WHERE id = :uid AND tenant_id = :tid AND deleted_at IS NULL"),
                {"uid": user_id, "tid": current_user.tenant_id}
            ).fetchone()
            if not user_check:
                continue

            # 检查是否已关联
            existing = db.execute(
                text("SELECT id FROM user_stores WHERE user_id = :uid AND store_id = :sid"),
                {"uid": user_id, "sid": store_id}
            ).fetchone()
            if existing:
                continue

            db.execute(
                text("INSERT INTO user_stores (tenant_id, user_id, store_id) VALUES (:tid, :uid, :sid)"),
                {"tid": current_user.tenant_id, "uid": user_id, "sid": store_id}
            )
            added_count += 1

        db.commit()
        return {"success": True, "message": f"成功添加 {added_count} 个人员"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"添加人员失败: {str(e)}")


@router.delete("/{store_id}/members/{user_id}")
async def remove_store_member(
    store_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """移除店铺的人员"""
    try:
        db.execute(
            text("DELETE FROM user_stores WHERE user_id = :uid AND store_id = :sid AND tenant_id = :tid"),
            {"uid": user_id, "sid": store_id, "tid": current_user.tenant_id}
        )
        db.commit()
        return {"success": True, "message": "已移除人员"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"移除失败: {str(e)}")


@router.put("/{store_id}/members")
async def set_store_members(
    store_id: int,
    request: StoreMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    """批量设置店铺的人员（先清空再添加）"""
    try:
        # 验证店铺存在且属于当前租户
        check = db.execute(
            text("SELECT id FROM stores WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": store_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="店铺不存在")

        # 先清空现有人员
        db.execute(
            text("DELETE FROM user_stores WHERE store_id = :sid AND tenant_id = :tid"),
            {"sid": store_id, "tid": current_user.tenant_id}
        )

        # 添加新人员
        added_count = 0
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
        return {"success": True, "message": f"成功设置 {added_count} 个人员"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"设置人员失败: {str(e)}")
