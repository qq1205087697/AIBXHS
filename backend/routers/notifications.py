from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_user
from models.user import User
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/")
async def get_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"用户 {current_user.username} (ID:{current_user.id}) 请求获取通知列表")
    try:
        # 检查表是否存在
        check_table = db.execute(text("SHOW TABLES LIKE 'notifications'")).fetchone()
        if not check_table:
            logger.warning("notifications 表不存在")
            return {
                "success": True,
                "data": [],
                "total": 0,
                "page": page,
                "page_size": page_size
            }
        
        where_conditions = ["n.user_id = :user_id"]
        params = {
            "user_id": current_user.id,
            "limit": page_size,
            "offset": (page - 1) * page_size
        }
        if unread_only:
            where_conditions.append("n.read_at IS NULL")
        where_clause = " AND ".join(where_conditions)

        count_query = text(f"SELECT COUNT(*) FROM notifications n WHERE {where_clause}")
        total = db.execute(count_query, params).scalar()

        query = text(f"""
            SELECT n.id, n.type, n.title, n.content, n.link, n.read_at, n.created_at
            FROM notifications n
            WHERE {where_clause}
            ORDER BY n.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        result = db.execute(query, params)
        notifications = []
        for row in result:
            notifications.append({
                "id": row[0],
                "type": row[1],
                "title": row[2],
                "content": row[3] or "",
                "link": row[4] or "",
                "is_read": row[5] is not None,
                "read_at": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else None,
                "created_at": row[6].strftime("%Y-%m-%d %H:%M:%S") if row[6] else ""
            })
        logger.info(f"返回 {len(notifications)} 条通知，总数 {total}")
        return {
            "success": True,
            "data": notifications,
            "total": total,
            "page": page,
            "page_size": page_size
        }
    except Exception as e:
        logger.error(f"获取通知列表失败: {e}")
        # 表不存在或其他错误返回空列表
        return {
            "success": True,
            "data": [],
            "total": 0,
            "page": page,
            "page_size": page_size
        }


@router.get("/unread-count")
async def get_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"用户 {current_user.username} (ID:{current_user.id}) 请求未读通知数量")
    try:
        # 检查表是否存在
        check_table = db.execute(text("SHOW TABLES LIKE 'notifications'")).fetchone()
        if not check_table:
            logger.warning("notifications 表不存在，返回 0")
            return {"success": True, "data": {"count": 0}}
        
        query = text("""
            SELECT COUNT(*) FROM notifications
            WHERE user_id = :user_id AND read_at IS NULL
        """)
        count = db.execute(query, {"user_id": current_user.id}).scalar()
        logger.info(f"用户 {current_user.id} 有 {count} 条未读通知")
        return {"success": True, "data": {"count": count}}
    except Exception as e:
        logger.error(f"获取未读通知数量失败: {e}")
        # 表不存在或其他错误都返回0
        return {"success": True, "data": {"count": 0}}


@router.put("/{notification_id}/read")
async def mark_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"用户 {current_user.username} (ID:{current_user.id}) 标记通知 {notification_id} 为已读")
    try:
        # 检查表是否存在
        check_table = db.execute(text("SHOW TABLES LIKE 'notifications'")).fetchone()
        if not check_table:
            logger.warning("notifications 表不存在")
            return {"success": True, "message": "已标记为已读"}
        
        result = db.execute(text("""
            UPDATE notifications SET read_at = NOW()
            WHERE id = :nid AND user_id = :uid AND read_at IS NULL
        """), {"nid": notification_id, "uid": current_user.id})
        db.commit()
        logger.info(f"已更新 {result.rowcount} 条记录")
        return {"success": True, "message": "已标记为已读"}
    except Exception as e:
        logger.error(f"标记已读失败: {e}")
        db.rollback()
        # 忽略表不存在的错误
        return {"success": True, "message": "已标记为已读"}


@router.put("/read-all")
async def mark_all_as_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    logger.info(f"用户 {current_user.username} (ID:{current_user.id}) 标记全部通知为已读")
    try:
        # 检查表是否存在
        check_table = db.execute(text("SHOW TABLES LIKE 'notifications'")).fetchone()
        if not check_table:
            logger.warning("notifications 表不存在")
            return {"success": True, "message": "全部标记为已读"}
        
        result = db.execute(text("""
            UPDATE notifications SET read_at = NOW()
            WHERE user_id = :uid AND read_at IS NULL
        """), {"uid": current_user.id})
        db.commit()
        logger.info(f"已标记 {result.rowcount} 条通知为已读")
        return {"success": True, "message": "全部标记为已读"}
    except Exception as e:
        logger.error(f"标记全部已读失败: {e}")
        db.rollback()
        # 忽略表不存在的错误
        return {"success": True, "message": "全部标记为已读"}
