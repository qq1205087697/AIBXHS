from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_user, get_current_admin_user
from models.user import User
from services.auth_service import get_password_hash

router = APIRouter(prefix="/api/departments", tags=["departments"])


class DepartmentCreate(BaseModel):
    name: str
    description: Optional[str] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AssignUserRequest(BaseModel):
    user_id: int


class CreateUserRequest(BaseModel):
    username: str
    email: EmailStr
    role: Optional[str] = "operator"


class BatchAssignRequest(BaseModel):
    user_ids: List[int]
    department_ids: List[int]


@router.get("/")
async def get_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        query = text("""
            SELECT d.id, d.name, d.description, d.created_at,
                   (SELECT COUNT(*) FROM user_departments ud WHERE ud.department_id = d.id) as member_count
            FROM departments d
            WHERE d.tenant_id = :tenant_id AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC
        """)
        result = db.execute(query, {"tenant_id": current_user.tenant_id})
        departments = []
        for row in result:
            departments.append({
                "id": row[0],
                "name": row[1],
                "description": row[2] or "",
                "created_at": row[3].strftime("%Y-%m-%d %H:%M:%S") if row[3] else "",
                "member_count": row[4]
            })
        return {"success": True, "data": departments}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取部门列表失败: {str(e)}")


@router.post("/")
async def create_department(
    dept_data: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        insert_sql = text("""
            INSERT INTO departments (tenant_id, name, description)
            VALUES (:tenant_id, :name, :description)
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "name": dept_data.name,
            "description": dept_data.description
        })
        db.commit()
        return {
            "success": True,
            "message": "部门创建成功",
            "data": {"id": result.lastrowid}
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建部门失败: {str(e)}")


@router.put("/{department_id}")
async def update_department(
    department_id: int,
    dept_data: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        check = text("SELECT id FROM departments WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        row = db.execute(check, {"id": department_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="部门不存在")

        updates = []
        params = {"id": department_id}
        if dept_data.name is not None:
            updates.append("name = :name")
            params["name"] = dept_data.name
        if dept_data.description is not None:
            updates.append("description = :description")
            params["description"] = dept_data.description

        if updates:
            update_sql = text(f"UPDATE departments SET {', '.join(updates)} WHERE id = :id")
            db.execute(update_sql, params)
            db.commit()

        return {"success": True, "message": "部门更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新部门失败: {str(e)}")


@router.delete("/{department_id}")
async def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        db.execute(text("DELETE FROM user_departments WHERE department_id = :id"), {"id": department_id})
        db.execute(text("DELETE FROM departments WHERE id = :id AND tenant_id = :tid"), {
            "id": department_id,
            "tid": current_user.tenant_id
        })
        db.commit()
        return {"success": True, "message": "部门删除成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除部门失败: {str(e)}")


@router.get("/{department_id}/members")
async def get_department_members(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        query = text("""
            SELECT u.id, u.username, u.nickname, u.email, u.role
            FROM users u
            INNER JOIN user_departments ud ON u.id = ud.user_id
            WHERE ud.department_id = :dept_id AND u.tenant_id = :tid
        """)
        result = db.execute(query, {"dept_id": department_id, "tid": current_user.tenant_id})
        members = []
        for row in result:
            members.append({
                "id": row[0],
                "username": row[1],
                "nickname": row[2] or row[1],
                "email": row[3] or "",
                "role": row[4]
            })
        return {"success": True, "data": members}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取部门成员失败: {str(e)}")


@router.post("/{department_id}/members")
async def add_department_member(
    department_id: int,
    req: AssignUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        existing = text("SELECT id FROM user_departments WHERE user_id = :uid AND department_id = :did")
        if db.execute(existing, {"uid": req.user_id, "did": department_id}).fetchone():
            return {"success": True, "message": "用户已在部门中"}

        insert_sql = text("""
            INSERT INTO user_departments (tenant_id, user_id, department_id)
            VALUES (:tid, :uid, :did)
        """)
        db.execute(insert_sql, {
            "tid": current_user.tenant_id,
            "uid": req.user_id,
            "did": department_id
        })
        db.commit()
        return {"success": True, "message": "成员添加成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"添加成员失败: {str(e)}")


@router.delete("/{department_id}/members/{user_id}")
async def remove_department_member(
    department_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        db.execute(text("DELETE FROM user_departments WHERE user_id = :uid AND department_id = :did"), {
            "uid": user_id,
            "did": department_id
        })
        db.commit()
        return {"success": True, "message": "成员移除成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"移除成员失败: {str(e)}")


@router.get("/users/all")
async def get_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        query = text("""
            SELECT u.id, u.username, u.nickname, u.email, u.role,
                   GROUP_CONCAT(d.name SEPARATOR ', ') as department_names,
                   GROUP_CONCAT(d.id SEPARATOR ',') as department_ids
            FROM users u
            LEFT JOIN user_departments ud ON u.id = ud.user_id
            LEFT JOIN departments d ON ud.department_id = d.id AND d.deleted_at IS NULL
            WHERE u.tenant_id = :tid
            GROUP BY u.id
            ORDER BY u.id
        """)
        result = db.execute(query, {"tid": current_user.tenant_id})
        users = []
        for row in result:
            users.append({
                "id": row[0],
                "username": row[1],
                "nickname": row[2] or row[1],
                "email": row[3] or "",
                "role": row[4],
                "department_names": row[5] or "",
                "department_ids": row[6] or ""
            })
        return {"success": True, "data": users}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取用户列表失败: {str(e)}")


@router.put("/users/{user_id}/departments")
async def update_user_departments(
    user_id: int,
    department_ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        db.execute(text("DELETE FROM user_departments WHERE user_id = :uid AND tenant_id = :tid"), {
            "uid": user_id,
            "tid": current_user.tenant_id
        })
        for dept_id in department_ids:
            db.execute(text("""
                INSERT INTO user_departments (tenant_id, user_id, department_id)
                VALUES (:tid, :uid, :did)
            """), {
                "tid": current_user.tenant_id,
                "uid": user_id,
                "did": dept_id
            })
        db.commit()
        return {"success": True, "message": "用户部门更新成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新用户部门失败: {str(e)}")


@router.post("/users")
async def create_user_for_tenant(
    user_data: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        # 检查用户名是否已存在
        existing = text("SELECT id FROM users WHERE username = :username")
        if db.execute(existing, {"username": user_data.username}).fetchone():
            raise HTTPException(status_code=400, detail="用户名已存在")
        
        # 检查邮箱是否已存在
        existing_email = text("SELECT id FROM users WHERE email = :email")
        if db.execute(existing_email, {"email": user_data.email}).fetchone():
            raise HTTPException(status_code=400, detail="邮箱已存在")
        
        # 默认密码123456
        default_password = "123456"
        hashed_password = get_password_hash(default_password)
        
        # 创建用户，使用当前用户的租户
        insert_sql = text("""
            INSERT INTO users (tenant_id, username, email, password_hash, nickname, role)
            VALUES (:tenant_id, :username, :email, :password_hash, :nickname, :role)
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "username": user_data.username,
            "email": user_data.email,
            "password_hash": hashed_password,
            "nickname": user_data.username,
            "role": user_data.role
        })
        db.commit()
        
        return {
            "success": True,
            "message": "用户创建成功",
            "data": {
                "id": result.lastrowid,
                "username": user_data.username,
                "email": user_data.email,
                "password": default_password,
                "role": user_data.role
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建用户失败: {str(e)}")


@router.post("/users/batch-assign")
async def batch_assign_departments(
    req: BatchAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        for user_id in req.user_ids:
            # 删除该用户的所有部门
            db.execute(text("DELETE FROM user_departments WHERE user_id = :uid AND tenant_id = :tid"), {
                "uid": user_id,
                "tid": current_user.tenant_id
            })
            # 分配新部门
            for dept_id in req.department_ids:
                db.execute(text("""
                    INSERT INTO user_departments (tenant_id, user_id, department_id)
                    VALUES (:tid, :uid, :did)
                """), {
                    "tid": current_user.tenant_id,
                    "uid": user_id,
                    "did": dept_id
                })
        db.commit()
        return {"success": True, "message": "批量分配部门成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量分配部门失败: {str(e)}")
