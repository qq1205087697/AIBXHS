"""
广告优化执行日志API路由

功能:
1. 执行日志列表查询（支持规则名/状态筛选 + 分页）
2. 执行日志详情
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies import get_current_user
from models.user import User
from models.ad_daily import AdExecutionLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ad-execution-logs", tags=["ad-execution-logs"])


# ==================== 辅助函数 ====================

def _log_to_dict(log: AdExecutionLog) -> dict:
    """将 AdExecutionLog 对象序列化为 dict"""
    return {
        "id": log.id,
        "tenant_id": log.tenant_id,
        "suggestion_id": log.suggestion_id,
        "rule_name": log.rule_name,
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "target_name": log.target_name,
        "result": log.result,
        "status": log.status,
        "error_message": log.error_message,
        "executed_by": log.executed_by,
        "execution_time": log.execution_time.isoformat() if log.execution_time else None,
        "execution_duration_ms": log.execution_duration_ms,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "updated_at": log.updated_at.isoformat() if log.updated_at else None,
    }


# ==================== 1. 日志列表 ====================

@router.get("/list")
async def list_execution_logs(
    rule_name: Optional[str] = Query(None, description="规则名称筛选"),
    status: Optional[str] = Query(None, description="状态筛选: 成功/失败"),
    page: int = Query(1, ge=1, description="页码，从1开始"),
    page_size: int = Query(20, ge=1, le=200, description="每页条数"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取广告执行日志列表（支持筛选 + 分页）"""
    try:
        query = db.query(AdExecutionLog).filter(
            AdExecutionLog.tenant_id == current_user.tenant_id,
            AdExecutionLog.deleted_at.is_(None),
        )

        if rule_name:
            query = query.filter(AdExecutionLog.rule_name == rule_name)
        if status:
            query = query.filter(AdExecutionLog.status == status)

        total = query.count()

        offset = (page - 1) * page_size
        items = (
            query.order_by(AdExecutionLog.created_at.desc())
            .offset(offset)
            .limit(page_size)
            .all()
        )

        return {
            "success": True,
            "data": {
                "items": [_log_to_dict(log) for log in items],
                "total": total,
                "page": page,
                "page_size": page_size,
            },
        }
    except Exception as e:
        logger.error(f"获取执行日志列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取执行日志列表失败: {str(e)}")


# ==================== 2. 日志详情 ====================

@router.get("/{log_id}")
async def get_execution_log_detail(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取单条执行日志详情"""
    try:
        log = db.query(AdExecutionLog).filter(
            AdExecutionLog.id == log_id,
            AdExecutionLog.tenant_id == current_user.tenant_id,
            AdExecutionLog.deleted_at.is_(None),
        ).first()

        if not log:
            raise HTTPException(status_code=404, detail="执行日志不存在")

        return {"success": True, "data": _log_to_dict(log)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取执行日志详情失败 log_id={log_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取执行日志详情失败: {str(e)}")
