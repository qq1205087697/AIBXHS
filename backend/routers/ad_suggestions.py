"""
广告优化建议管理API路由

功能:
1. 建议列表查询（支持状态/优先级/目标类型筛选 + 分页）
2. 建议详情
3. 建议状态流转（待处理 → 已确认 → 已执行 / 已忽略 / 已失效）
4. 触发规则引擎生成建议
5. 软删除建议
"""
import logging
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies import get_current_user
from models.user import User
from models.ad_daily import AdOptimizationSuggestion, AdExecutionLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ad-suggestions", tags=["ad-suggestions"])


# ==================== 请求体模型 ====================

class SuggestionStatusUpdate(BaseModel):
    """建议状态流转请求体"""
    status: str  # 已确认 / 已执行 / 已忽略 / 已失效


class RunRulesRequest(BaseModel):
    """触发规则引擎请求体"""
    date: str  # YYYY-MM-DD


# ==================== 辅助函数 ====================

def _suggestion_to_dict(s: AdOptimizationSuggestion) -> dict:
    """将 AdOptimizationSuggestion 对象序列化为 dict"""
    return {
        "id": s.id,
        "tenant_id": s.tenant_id,
        "store_id": s.store_id,
        "rule_name": s.rule_name,
        "rule_priority": s.rule_priority,
        "rule_version": s.rule_version,
        "target_type": s.target_type,
        "target_id": s.target_id,
        "target_name": s.target_name,
        "condition_metrics": s.condition_metrics,
        "current_value": float(s.current_value) if s.current_value is not None else None,
        "threshold": float(s.threshold) if s.threshold is not None else None,
        "suggestion_action": s.suggestion_action,
        "suggestion_reason": s.suggestion_reason,
        "ai_analysis": s.ai_analysis,
        "status": s.status,
        "created_by": s.created_by,
        "confirmed_by": s.confirmed_by,
        "confirmed_at": s.confirmed_at.isoformat() if s.confirmed_at else None,
        "executed_at": s.executed_at.isoformat() if s.executed_at else None,
        "expired_at": s.expired_at.isoformat() if s.expired_at else None,
        "evaluation_date": s.evaluation_date.isoformat() if s.evaluation_date else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ==================== 1. 建议列表 ====================

@router.get("/list")
async def list_suggestions(
    status: Optional[str] = Query(None, description="状态筛选: 待处理/已确认/已执行/已忽略/已失效"),
    priority: Optional[str] = Query(None, description="优先级筛选: 高/中"),
    target_type: Optional[str] = Query(None, description="目标类型: campaign/keyword/search_term/product"),
    page: int = Query(1, ge=1, description="页码，从1开始"),
    page_size: int = Query(20, ge=1, le=200, description="每页条数"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取广告优化建议列表（支持筛选 + 分页）"""
    try:
        query = db.query(AdOptimizationSuggestion).filter(
            AdOptimizationSuggestion.tenant_id == current_user.tenant_id,
            AdOptimizationSuggestion.deleted_at.is_(None),
        )

        if status:
            query = query.filter(AdOptimizationSuggestion.status == status)
        if priority:
            query = query.filter(AdOptimizationSuggestion.rule_priority == priority)
        if target_type:
            query = query.filter(AdOptimizationSuggestion.target_type == target_type)

        total = query.count()

        offset = (page - 1) * page_size
        items = (
            query.order_by(AdOptimizationSuggestion.created_at.desc())
            .offset(offset)
            .limit(page_size)
            .all()
        )

        return {
            "success": True,
            "data": {
                "items": [_suggestion_to_dict(s) for s in items],
                "total": total,
                "page": page,
                "page_size": page_size,
            },
        }
    except Exception as e:
        logger.error(f"获取建议列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取建议列表失败: {str(e)}")


# ==================== 2. 建议详情 ====================

@router.get("/{suggestion_id}")
async def get_suggestion_detail(
    suggestion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取单条建议详情"""
    try:
        suggestion = db.query(AdOptimizationSuggestion).filter(
            AdOptimizationSuggestion.id == suggestion_id,
            AdOptimizationSuggestion.tenant_id == current_user.tenant_id,
            AdOptimizationSuggestion.deleted_at.is_(None),
        ).first()

        if not suggestion:
            raise HTTPException(status_code=404, detail="建议不存在")

        return {"success": True, "data": _suggestion_to_dict(suggestion)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取建议详情失败 suggestion_id={suggestion_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取建议详情失败: {str(e)}")


# ==================== 3. 状态流转 ====================

@router.put("/{suggestion_id}/status")
async def update_suggestion_status(
    suggestion_id: int,
    body: SuggestionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    建议状态流转

    支持的目标状态:
    - 已确认: 记录 confirmed_by / confirmed_at
    - 已执行: 记录 executed_by / executed_at，并自动创建 AdExecutionLog
    - 已忽略: 仅更新状态
    - 已失效: 记录 expired_at
    """
    valid_statuses = {"已确认", "已执行", "已忽略", "已失效"}
    if body.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"无效状态，可选值: {', '.join(valid_statuses)}",
        )

    try:
        suggestion = db.query(AdOptimizationSuggestion).filter(
            AdOptimizationSuggestion.id == suggestion_id,
            AdOptimizationSuggestion.tenant_id == current_user.tenant_id,
            AdOptimizationSuggestion.deleted_at.is_(None),
        ).first()

        if not suggestion:
            raise HTTPException(status_code=404, detail="建议不存在")

        now = datetime.now()
        previous_status = suggestion.status
        suggestion.status = body.status

        if body.status == "已确认":
            suggestion.confirmed_by = current_user.id
            suggestion.confirmed_at = now
        elif body.status == "已执行":
            suggestion.executed_at = now
            # 自动创建执行日志
            log = AdExecutionLog(
                tenant_id=current_user.tenant_id,
                suggestion_id=suggestion.id,
                rule_name=suggestion.rule_name,
                action=suggestion.suggestion_action,
                target_type=suggestion.target_type,
                target_id=suggestion.target_id,
                target_name=suggestion.target_name,
                result=suggestion.suggestion_reason or "",
                status="成功",
                executed_by=current_user.id,
                execution_time=now,
            )
            db.add(log)
        elif body.status == "已失效":
            suggestion.expired_at = now

        db.commit()
        db.refresh(suggestion)

        return {
            "success": True,
            "data": {
                "id": suggestion.id,
                "previous_status": previous_status,
                "current_status": suggestion.status,
                "confirmed_by": suggestion.confirmed_by,
                "executed_by": current_user.id if body.status == "已执行" else None,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"更新建议状态失败 suggestion_id={suggestion_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新建议状态失败: {str(e)}")


# ==================== 4. 触发规则引擎 ====================

@router.post("/run-rules")
async def run_rules(
    body: RunRulesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    触发规则引擎，针对指定日期执行所有规则

    请求体: {date: "YYYY-MM-DD"}
    返回执行摘要
    """
    try:
        try:
            evaluation_date = date.fromisoformat(body.date)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="日期格式无效，应为 YYYY-MM-DD",
            )

        from services.ad_rules.rule_engine import RuleEngine
        engine = RuleEngine()
        summary = engine.run_all_rules(db, current_user.tenant_id, evaluation_date)

        return {"success": True, "data": summary}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"触发规则引擎失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"触发规则引擎失败: {str(e)}")


# ==================== 5. 软删除建议 ====================

@router.delete("/{suggestion_id}")
async def delete_suggestion(
    suggestion_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """软删除建议（设置 deleted_at）"""
    try:
        suggestion = db.query(AdOptimizationSuggestion).filter(
            AdOptimizationSuggestion.id == suggestion_id,
            AdOptimizationSuggestion.tenant_id == current_user.tenant_id,
            AdOptimizationSuggestion.deleted_at.is_(None),
        ).first()

        if not suggestion:
            raise HTTPException(status_code=404, detail="建议不存在")

        suggestion.deleted_at = datetime.now()
        db.commit()

        return {"success": True, "data": {"id": suggestion_id, "deleted": True}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"软删除建议失败 suggestion_id={suggestion_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"软删除建议失败: {str(e)}")
