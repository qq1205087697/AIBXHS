from datetime import datetime

from fastapi import Depends, HTTPException, Response, status
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

# 角色权限映射
ROLE_PERMISSIONS = {
    "admin": ["view", "edit", "delete", "execute", "confirm", "manage_users"],
    "operator": ["view", "edit", "delete", "execute", "confirm"],
    "ad_specialist": ["view", "execute", "confirm"],
    "supervisor": ["view", "confirm"],
    "read_only": ["view"],
}


# token 剩余有效期低于该阈值时自动续签（token 总有效期 7 天，剩 2 天开始续）
RENEW_THRESHOLD_SECONDS = 2 * 24 * 3600


def _maybe_renew_token(response: Response, payload: dict) -> None:
    """滑动续期：临近过期时签发新 token 并写入响应头 `X-Renewed-Token`

    前端拦截器收到后自动替换 localStorage 里的 token。失败静默（不能让续期影响鉴权）。
    """
    try:
        exp_ts = int(payload.get("exp") or 0)
        remain = exp_ts - int(datetime.utcnow().timestamp())
        if not (0 < remain < RENEW_THRESHOLD_SECONDS):
            return
        data = {k: payload[k] for k in ("sub", "uid", "tid") if payload.get(k) is not None}
        if not data:
            return
        from services.auth_service import create_access_token
        response.headers["X-Renewed-Token"] = create_access_token(data=data)
    except Exception:  # noqa: BLE001 续期失败不影响本次鉴权
        pass


async def get_current_user(
    response: Response,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """获取当前用户

    滑动续期：token 剩余有效期不足 RENEW_THRESHOLD_SECONDS 时，签发新 token 并通过
    响应头 `X-Renewed-Token` 下发（前端拦截器自动替换 localStorage）。
    这样只要用户在用，登录态就不会因为「7 天硬过期」突然失效；不改数据库、不新增接口。
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        token = credentials.credentials
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: Optional[str] = payload.get("sub")
        user_id = payload.get("uid")
        tenant_id = payload.get("tid")
        if username is None and user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    _maybe_renew_token(response, payload)

    from services.auth_service import get_user_by_identity
    user = get_user_by_identity(
        db,
        user_id=int(user_id) if user_id is not None else None,
        tenant_id=int(tenant_id) if tenant_id is not None else None,
        username=username
    )
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


async def get_current_user_department_ids(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> List[int]:
    """获取当前用户的部门ID列表"""
    rows = db.execute(text("""
        SELECT department_id FROM user_departments
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {"user_id": current_user.id}).fetchall()
    return [row[0] for row in rows]


class PermissionChecker:
    """权限检查工厂（传多个权限码时任一满足即通过）"""

    def __init__(self, *required_permissions: str):
        self.required_permissions = [p for p in required_permissions if p]
        self.required_permission = self.required_permissions[0] if self.required_permissions else ""

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

        # 2. 检查RBAC权限（任一权限码命中即通过）
        has_perm = False
        if current_user.role_id and self.required_permissions:
            placeholders = ",".join([f":p{i}" for i in range(len(self.required_permissions))])
            params = {"role_id": current_user.role_id}
            for i, code in enumerate(self.required_permissions):
                params[f"p{i}"] = code
            has_perm = db.execute(text(f"""
                SELECT 1
                FROM role_permissions rp
                JOIN permissions p ON rp.permission_id = p.id AND p.deleted_at IS NULL
                WHERE rp.role_id = :role_id AND rp.deleted_at IS NULL AND p.code IN ({placeholders})
                LIMIT 1
            """), params).fetchone()
        
        if not has_perm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"缺少权限: {self.required_permission}"
            )
        
        return current_user
