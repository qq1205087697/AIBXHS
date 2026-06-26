from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
import json

from database.database import get_db
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/api/operation-logs", tags=["operation_logs"])


@router.get("/")
async def get_operation_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    module: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["ol.tenant_id = :tenant_id"]
        params = {"tenant_id": current_user.tenant_id}

        if module:
            where_conditions.append("ol.module = :module")
            params["module"] = module
        if action:
            where_conditions.append("ol.action = :action")
            params["action"] = action
        if user_id:
            where_conditions.append("ol.user_id = :user_id")
            params["user_id"] = user_id
        if start_date:
            where_conditions.append("ol.created_at >= :start_date")
            params["start_date"] = start_date
        if end_date:
            where_conditions.append("ol.created_at <= :end_date")
            params["end_date"] = end_date + " 23:59:59"
        if search:
            where_conditions.append("(ol.summary LIKE :search OR ol.username LIKE :search OR ol.target_name LIKE :search)")
            params["search"] = f"%{search}%"

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM operation_logs ol WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT ol.id, ol.user_id, ol.username, ol.module, ol.action,
                   ol.target_type, ol.target_id, ol.target_name,
                   ol.before_data, ol.after_data, ol.summary, ol.ip_address, ol.created_at
            FROM operation_logs ol
            WHERE {where_clause}
            ORDER BY ol.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        logs = []
        for row in rows:
            before_data = row[8]
            after_data = row[9]
            if isinstance(before_data, str):
                try:
                    before_data = json.loads(before_data)
                except:
                    pass
            if isinstance(after_data, str):
                try:
                    after_data = json.loads(after_data)
                except:
                    pass

            logs.append({
                "id": row[0],
                "user_id": row[1],
                "username": row[2] or "",
                "module": row[3],
                "action": row[4],
                "target_type": row[5] or "",
                "target_id": row[6],
                "target_name": row[7] or "",
                "before_data": before_data,
                "after_data": after_data,
                "summary": row[10] or "",
                "ip_address": row[11] or "",
                "created_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else "",
            })

        return {"success": True, "data": logs, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取操作日志失败: {str(e)}")


@router.get("/modules")
async def get_log_modules():
    return {
        "success": True,
        "data": ["inbound", "outbound", "purchase", "product"]
    }


@router.get("/actions")
async def get_log_actions():
    return {
        "success": True,
        "data": ["create", "update", "delete", "confirm", "cancel"]
    }