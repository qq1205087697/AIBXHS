from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from models.user import User
from config import get_settings
from typing import List, Optional

settings = get_settings()

# 认证 Scheme
security = HTTPBearer()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> User:
    """获取当前用户"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        token = credentials.credentials
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    from services.auth_service import get_user
    user = get_user(db, username=username)
    if user is None:
        raise credentials_exception

    # 加载租户/公司信息
    tenant_row = db.execute(text(
        "SELECT name, code, COALESCE(is_personal, 0) FROM tenants WHERE id = :tid AND deleted_at IS NULL"
    ), {"tid": user.tenant_id}).fetchone()
    if tenant_row:
        user._tenant_name = tenant_row[0]
        user._tenant_code = tenant_row[1]
        user._is_personal = bool(tenant_row[2])

    return user


async def get_current_admin_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """获取当前管理员用户"""
    # 检查是否是管理员角色（只通过 role_id 检查）
    is_admin = False
    if current_user.role_id:
        role = db.execute(text("""
            SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
        """), {"role_id": current_user.role_id}).fetchone()
        if role and role[0] == "admin":
            is_admin = True
    
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


async def get_user_permission_codes(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> List[str]:
    """获取当前用户的所有权限代码列表（通过RBAC角色）"""
    permission_codes = []
    
    # 1. 通过 role_id 关联权限表查询
    if current_user.role_id:
        rows = db.execute(text("""
            SELECT DISTINCT p.code
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id AND p.deleted_at IS NULL
            WHERE rp.role_id = :role_id AND rp.deleted_at IS NULL
        """), {"role_id": current_user.role_id}).fetchall()
        permission_codes = [row[0] for row in rows]
    
    # 2. 检查是否是 admin 角色（只通过 role_id 检查）
    is_admin = False
    if current_user.role_id:
        role = db.execute(text("""
            SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
        """), {"role_id": current_user.role_id}).fetchone()
        if role and role[0] == "admin":
            is_admin = True
    
    if is_admin:
        all_perms = db.execute(text("""
            SELECT code FROM permissions
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL
        """), {"tenant_id": current_user.tenant_id}).fetchall()
        permission_codes = [row[0] for row in all_perms]
    
    return permission_codes


class PermissionChecker:
    """权限检查工厂"""
    
    def __init__(self, required_permission: str):
        self.required_permission = required_permission
    
    async def __call__(
        self,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> User:
        # 1. 先检查是否是管理员角色（只通过 role_id 检查）
        is_admin = False
        if current_user.role_id:
            role = db.execute(text("""
                SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
            """), {"role_id": current_user.role_id}).fetchone()
            if role and role[0] == "admin":
                is_admin = True
        
        if is_admin:
            return current_user
        
        # 2. 检查RBAC权限
        has_perm = False
        if current_user.role_id:
            has_perm = db.execute(text("""
                SELECT 1
                FROM role_permissions rp
                JOIN permissions p ON rp.permission_id = p.id AND p.deleted_at IS NULL
                WHERE rp.role_id = :role_id AND rp.deleted_at IS NULL AND p.code = :perm_code
                LIMIT 1
            """), {"role_id": current_user.role_id, "perm_code": self.required_permission}).fetchone()
        
        if not has_perm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"缺少权限: {self.required_permission}"
            )
        
        return current_user
