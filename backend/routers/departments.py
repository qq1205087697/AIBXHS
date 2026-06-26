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
    role_id: Optional[int] = None


class UpdateUserRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    nickname: Optional[str] = None
    role_id: Optional[int] = None


class ChangePasswordRequest(BaseModel):
    new_password: str


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
            SELECT u.id, u.username, u.nickname, u.email, u.role_id
            FROM users u
            INNER JOIN user_departments ud ON u.id = ud.user_id
            WHERE ud.department_id = :dept_id AND u.tenant_id = :tid
        """)
        result = db.execute(query, {"dept_id": department_id, "tid": current_user.tenant_id})
        members = []
        for row in result:
            role_code = None
            if row[4]:
                role_row = db.execute(
                    text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"),
                    {"role_id": row[4]}
                ).fetchone()
                if role_row:
                    role_code = role_row[0]
            members.append({
                "id": row[0],
                "username": row[1],
                "nickname": row[2] or row[1],
                "email": row[3] or "",
                "role": role_code,
                "role_id": row[4]
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
            SELECT u.id, u.username, u.nickname, u.email, u.status, u.role_id,
                   GROUP_CONCAT(d.name SEPARATOR ', ') as department_names,
                   GROUP_CONCAT(d.id SEPARATOR ',') as department_ids
            FROM users u
            LEFT JOIN user_departments ud ON u.id = ud.user_id
            LEFT JOIN departments d ON ud.department_id = d.id AND d.deleted_at IS NULL
            WHERE u.tenant_id = :tid AND u.deleted_at IS NULL
            GROUP BY u.id
            ORDER BY u.id
        """)
        result = db.execute(query, {"tid": current_user.tenant_id})
        users = []
        for row in result:
            role_code = None
            if row[5]:
                role_row = db.execute(
                    text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"),
                    {"role_id": row[5]}
                ).fetchone()
                if role_row:
                    role_code = role_row[0]
            users.append({
                "id": row[0],
                "username": row[1],
                "nickname": row[2] or row[1],
                "email": row[3] or "",
                "role": role_code,
                "status": row[4] or "active",
                "role_id": row[5],
                "department_names": row[6] or "",
                "department_ids": row[7] or ""
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
        
        # 获取角色信息
        role_id = user_data.role_id
        role_code = None
        if role_id:
            role_result = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND tenant_id = :tid AND deleted_at IS NULL"), {"role_id": role_id, "tid": current_user.tenant_id}).fetchone()
            if role_result:
                role_code = role_result[0]
        
        # 默认密码123456
        default_password = "123456"
        hashed_password = get_password_hash(default_password)
        
        # 创建用户，使用当前用户的租户，只写入 role_id，不写入 role
        insert_sql = text("""
            INSERT INTO users (tenant_id, username, email, password_hash, nickname, role_id)
            VALUES (:tenant_id, :username, :email, :password_hash, :nickname, :role_id)
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "username": user_data.username,
            "email": user_data.email,
            "password_hash": hashed_password,
            "nickname": user_data.username,
            "role_id": role_id
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
                "role_id": role_id
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建用户失败: {str(e)}")


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    user_data: UpdateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        # 检查用户是否存在
        check = text("SELECT id, username, email FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        row = db.execute(check, {"id": user_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        # 检查用户名是否已存在
        if user_data.username and user_data.username != row[1]:
            existing = text("SELECT id FROM users WHERE username = :username AND tenant_id = :tid AND deleted_at IS NULL")
            if db.execute(existing, {"username": user_data.username, "tid": current_user.tenant_id}).fetchone():
                raise HTTPException(status_code=400, detail="用户名已存在")
        
        # 检查邮箱是否已存在
        if user_data.email and user_data.email != row[2]:
            existing_email = text("SELECT id FROM users WHERE email = :email AND tenant_id = :tid AND deleted_at IS NULL")
            if db.execute(existing_email, {"email": user_data.email, "tid": current_user.tenant_id}).fetchone():
                raise HTTPException(status_code=400, detail="邮箱已存在")
        
        # 构建更新语句
        updates = []
        params = {"id": user_id, "tid": current_user.tenant_id}
        
        if user_data.username is not None:
            updates.append("username = :username")
            params["username"] = user_data.username
        if user_data.email is not None:
            updates.append("email = :email")
            params["email"] = user_data.email
        if user_data.nickname is not None:
            updates.append("nickname = :nickname")
            params["nickname"] = user_data.nickname
        
        # 处理角色，只更新 role_id
        role_id = user_data.role_id
        if role_id is not None:
            if role_id == 0:
                # 清空角色
                updates.append("role_id = NULL")
            else:
                # 验证角色是否存在
                role_result = db.execute(text("SELECT id FROM roles WHERE id = :role_id AND tenant_id = :tid AND deleted_at IS NULL"), {"role_id": role_id, "tid": current_user.tenant_id}).fetchone()
                if role_result:
                    updates.append("role_id = :role_id")
                    params["role_id"] = role_id
        
        if updates:
            updates.append("updated_at = NOW()")
            update_sql = text(f"UPDATE users SET {', '.join(updates)} WHERE id = :id AND tenant_id = :tid")
            db.execute(update_sql, params)
            db.commit()
        
        return {"success": True, "message": "用户更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新用户失败: {str(e)}")


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        # 检查用户是否存在
        check = text("SELECT id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        row = db.execute(check, {"id": user_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        # 不能删除自己
        if user_id == current_user.id:
            raise HTTPException(status_code=400, detail="不能删除自己")
        
        # 不能删除admin角色的用户
        # 通过 role_id 判断是否是 admin
        is_admin = False
        user_role_id = db.execute(text("SELECT role_id FROM users WHERE id = :id AND tenant_id = :tid"), {"id": user_id, "tid": current_user.tenant_id}).fetchone()
        if user_role_id and user_role_id[0]:
            role_code = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"), {"role_id": user_role_id[0]}).fetchone()
            if role_code and role_code[0] == "admin":
                is_admin = True
        
        if is_admin:
            raise HTTPException(status_code=400, detail="不能删除管理员用户")
        
        # 软删除用户
        db.execute(text("UPDATE users SET deleted_at = NOW() WHERE id = :id AND tenant_id = :tid"), {"id": user_id, "tid": current_user.tenant_id})
        db.commit()
        
        return {"success": True, "message": "用户删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除用户失败: {str(e)}")


@router.put("/users/{user_id}/toggle-status")
async def toggle_user_status(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        # 检查用户是否存在
        check = text("SELECT id, status, role_id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        row = db.execute(check, {"id": user_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        # 不能禁用自己
        if user_id == current_user.id:
            raise HTTPException(status_code=400, detail="不能禁用自己")
        
        # 不能禁用admin角色的用户
        is_admin = False
        if row[2]:
            role_code = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"), {"role_id": row[2]}).fetchone()
            if role_code and role_code[0] == "admin":
                is_admin = True
        
        if is_admin:
            raise HTTPException(status_code=400, detail="不能禁用管理员用户")
        
        # 切换状态
        new_status = "inactive" if row[1] == "active" else "active"
        db.execute(text("UPDATE users SET status = :status, updated_at = NOW() WHERE id = :id AND tenant_id = :tid"), {"status": new_status, "id": user_id, "tid": current_user.tenant_id})
        db.commit()
        
        return {"success": True, "message": f"用户状态已更改为{new_status}", "data": {"status": new_status}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"切换用户状态失败: {str(e)}")


@router.put("/users/{user_id}/change-password")
async def change_user_password(
    user_id: int,
    req: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        # 检查用户是否存在
        check = text("SELECT id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        row = db.execute(check, {"id": user_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        
        # 更新密码
        hashed_password = get_password_hash(req.new_password)
        db.execute(text("UPDATE users SET password_hash = :password_hash, updated_at = NOW() WHERE id = :id AND tenant_id = :tid"), {"password_hash": hashed_password, "id": user_id, "tid": current_user.tenant_id})
        db.commit()
        
        return {"success": True, "message": "密码修改成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"修改密码失败: {str(e)}")


class BatchUserRequest(BaseModel):
    user_ids: List[int]


class BatchPasswordRequest(BaseModel):
    user_ids: List[int]
    new_password: str


class BatchStatusRequest(BaseModel):
    user_ids: List[int]
    status: str


@router.post("/users/batch-assign")
async def batch_assign_departments(
    req: BatchAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        for user_id in req.user_ids:
            # 检查是否是当前用户或管理员
            is_admin = False
            user_role_id = db.execute(text("SELECT role_id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"), {"id": user_id, "tid": current_user.tenant_id}).fetchone()
            if user_role_id and user_role_id[0]:
                role_code = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"), {"role_id": user_role_id[0]}).fetchone()
                if role_code and role_code[0] == "admin":
                    is_admin = True
            
            if is_admin:
                continue
            if user_id == current_user.id:
                continue
                
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


@router.post("/users/batch-enable")
async def batch_enable_users(
    req: BatchUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        for user_id in req.user_ids:
            if user_id == current_user.id:
                continue
            db.execute(text("""
                UPDATE users SET status = 'active', updated_at = NOW() 
                WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """), {"id": user_id, "tid": current_user.tenant_id})
        db.commit()
        return {"success": True, "message": "批量启用成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量启用失败: {str(e)}")


@router.post("/users/batch-disable")
async def batch_disable_users(
    req: BatchUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        for user_id in req.user_ids:
            if user_id == current_user.id:
                continue
            is_admin = False
            user_role_id = db.execute(text("SELECT role_id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"), {"id": user_id, "tid": current_user.tenant_id}).fetchone()
            if user_role_id and user_role_id[0]:
                role_code = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"), {"role_id": user_role_id[0]}).fetchone()
                if role_code and role_code[0] == "admin":
                    is_admin = True
            
            if is_admin:
                continue
            db.execute(text("""
                UPDATE users SET status = 'inactive', updated_at = NOW() 
                WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """), {"id": user_id, "tid": current_user.tenant_id})
        db.commit()
        return {"success": True, "message": "批量禁用成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量禁用失败: {str(e)}")


@router.post("/users/batch-password")
async def batch_change_password(
    req: BatchPasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        hashed_password = get_password_hash(req.new_password)
        for user_id in req.user_ids:
            if user_id == current_user.id:
                continue
            is_admin = False
            user_role_id = db.execute(text("SELECT role_id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"), {"id": user_id, "tid": current_user.tenant_id}).fetchone()
            if user_role_id and user_role_id[0]:
                role_code = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"), {"role_id": user_role_id[0]}).fetchone()
                if role_code and role_code[0] == "admin":
                    is_admin = True
            
            if is_admin:
                continue
            db.execute(text("""
                UPDATE users SET password_hash = :password_hash, updated_at = NOW() 
                WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """), {"password_hash": hashed_password, "id": user_id, "tid": current_user.tenant_id})
        db.commit()
        return {"success": True, "message": "批量修改密码成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量修改密码失败: {str(e)}")


@router.post("/users/batch-delete")
async def batch_delete_users(
    req: BatchUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user)
):
    try:
        for user_id in req.user_ids:
            if user_id == current_user.id:
                continue
            is_admin = False
            user_role_id = db.execute(text("SELECT role_id FROM users WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"), {"id": user_id, "tid": current_user.tenant_id}).fetchone()
            if user_role_id and user_role_id[0]:
                role_code = db.execute(text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"), {"role_id": user_role_id[0]}).fetchone()
                if role_code and role_code[0] == "admin":
                    is_admin = True
            
            if is_admin:
                continue
            db.execute(text("UPDATE users SET deleted_at = NOW() WHERE id = :id AND tenant_id = :tid"), {"id": user_id, "tid": current_user.tenant_id})
        db.commit()
        return {"success": True, "message": "批量删除成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量删除失败: {str(e)}")
