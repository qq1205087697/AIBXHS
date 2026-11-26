from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.database import get_db
from dependencies import get_current_user, get_current_admin_user
from models.user import User

router = APIRouter(prefix="/api/group-permissions", tags=["group-permissions"])


class GroupMembersRequest(BaseModel):
    user_ids: List[int]


@router.get("/")
async def get_groups_with_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """群组管理列表：groups_fs 全部群 + 可见用户（可见/不可见两种状态）"""
    try:
        g_rows = db.execute(text("""
            SELECT g.group_id, g.group_name, g.created_at
            FROM groups_fs g
            ORDER BY g.group_id ASC
        """)).fetchall()

        p_rows = db.execute(text("""
            SELECT up.group_id, u.id,
                   COALESCE(NULLIF(u.nickname, ''), u.username) AS uname,
                   up.permission
            FROM group_user_permissions up
            INNER JOIN users u ON u.id = up.user_id AND u.deleted_at IS NULL
            WHERE up.deleted_at IS NULL
            ORDER BY up.group_id ASC, u.id ASC
        """)).fetchall()

        perms_map = {}
        for gid, uid, uname, perm in p_rows:
            perms_map.setdefault(gid, []).append({
                "id": int(uid),
                "name": uname,
                "permission": perm,
            })

        groups = []
        for row in g_rows:
            members = perms_map.get(row[0], [])
            groups.append({
                "group_id": int(row[0]),
                "group_name": (row[1] or "").strip() or "未命名群",
                "user_count": len(members),
                "members": members,
                "created_at": row[2].strftime("%Y-%m-%d %H:%M:%S") if row[2] else "",
            })
        return {"success": True, "data": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取群组列表失败: {str(e)}")


@router.get("/{group_id}/members")
async def get_group_members(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取指定群的可见用户及权限"""
    try:
        check = db.execute(
            text("SELECT group_id FROM groups_fs WHERE group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="群不存在")

        rows = db.execute(text("""
            SELECT u.id, u.username, COALESCE(NULLIF(u.nickname, ''), u.username) AS uname,
                   u.email, up.permission
            FROM group_user_permissions up
            INNER JOIN users u ON u.id = up.user_id AND u.deleted_at IS NULL
            WHERE up.group_id = :gid AND up.deleted_at IS NULL
            ORDER BY u.id ASC
        """), {"gid": group_id}).fetchall()
        members = [
            {"id": r[0], "username": r[1], "name": r[2], "email": r[3], "permission": r[4]}
            for r in rows
        ]
        return {"success": True, "data": members}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取群成员失败: {str(e)}")


@router.put("/{group_id}/members")
async def set_group_members(
    group_id: int,
    request: GroupMembersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """设置指定群的可见用户（全量覆盖：先删后插，permission 统一记为 read）"""
    try:
        check = db.execute(
            text("SELECT group_id FROM groups_fs WHERE group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        if not check:
            raise HTTPException(status_code=404, detail="群不存在")

        # 校验用户属于当前租户且未删除，并去重（同一用户只保留一条）
        valid_uids = []
        for uid in request.user_ids:
            if uid in valid_uids:
                continue
            user_check = db.execute(
                text("SELECT id FROM users WHERE id = :uid AND tenant_id = :tid AND deleted_at IS NULL"),
                {"uid": uid, "tid": current_user.tenant_id},
            ).fetchone()
            if user_check:
                valid_uids.append(uid)

        db.execute(
            text("DELETE FROM group_user_permissions WHERE group_id = :gid"),
            {"gid": group_id},
        )
        for uid in valid_uids:
            db.execute(
                text("""
                    INSERT INTO group_user_permissions (group_id, user_id, permission)
                    VALUES (:gid, :uid, 'read')
                """),
                {"gid": group_id, "uid": uid},
            )
        db.commit()
        return {"success": True, "message": f"已为群设置 {len(valid_uids)} 个可见用户"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"设置群成员失败: {str(e)}")
