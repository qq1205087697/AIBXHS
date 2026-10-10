from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database.database import get_db
from models.group_message import GroupMessage
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/group-messages", tags=["group-messages"])


@router.get("/recent")
async def get_recent_messages(
    limit: int = Query(50, ge=1, le=200),
    days: int = Query(7, ge=1, le=3650),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    all_time: int = Query(0, ge=0, le=1, description="1=不限时间查全部"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取群消息（按接收时间倒序，供首页消息通知板块使用）

    优先级：all_time=1 查全部 > start_date+end_date 指定范围 > days 最近N天（默认7）
    """
    query = db.query(GroupMessage).filter(GroupMessage.deleted_at.is_(None))
    if all_time == 1:
        pass
    elif start_date and end_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            return {"success": False, "message": "日期格式错误，应为 YYYY-MM-DD", "data": []}
        query = query.filter(GroupMessage.received_at >= start_dt, GroupMessage.received_at < end_dt)
    else:
        query = query.filter(GroupMessage.received_at >= datetime.now() - timedelta(days=days))
    rows = (
        query
        .order_by(GroupMessage.received_at.desc(), GroupMessage.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "success": True,
        "data": [
            {
                "id": r.id,
                "group_id": r.group_id,
                "group_name": (r.group_name or "").strip() or "未命名群",
                "sender_name": r.sender_name or "",
                "message_body": r.message_body or "",
                "received_at": r.received_at.strftime("%Y-%m-%d %H:%M") if r.received_at else "",
            }
            for r in rows
        ],
    }
