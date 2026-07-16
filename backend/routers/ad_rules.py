"""
广告自动化规则API路由
"""
import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database.database import get_db
from dependencies import get_current_user
from models.user import User
from models.ad_report import AdOptimizationRule, AdOptimizationLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ad-rules", tags=["ad-rules"])


class RuleCreate(BaseModel):
    name: str
    rule_type: str  # adjust_bid/pause/add_negative/increase_budget
    conditions: dict  # {"metric": "acos", "operator": "gt", "value": 30, "spend_min": 100}
    actions: dict     # {"action": "reduce_bid", "value": 0.1}


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    rule_type: Optional[str] = None
    conditions: Optional[dict] = None
    actions: Optional[dict] = None
    is_enabled: Optional[int] = None


@router.get("/list")
async def list_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取规则列表"""
    rules = db.query(AdOptimizationRule).filter(
        AdOptimizationRule.tenant_id == current_user.tenant_id,
        AdOptimizationRule.deleted_at.is_(None)
    ).order_by(AdOptimizationRule.created_at.desc()).all()

    return {
        "success": True,
        "data": [
            {
                "id": r.id,
                "name": r.name,
                "rule_type": r.rule_type,
                "conditions": r.conditions,
                "actions": r.actions,
                "is_enabled": r.is_enabled,
                "last_executed_at": r.last_executed_at.isoformat() if r.last_executed_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rules
        ]
    }


@router.post("/create")
async def create_rule(
    rule: RuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建规则"""
    import json
    new_rule = AdOptimizationRule(
        tenant_id=current_user.tenant_id,
        name=rule.name,
        rule_type=rule.rule_type,
        conditions=json.dumps(rule.conditions, ensure_ascii=False),
        actions=json.dumps(rule.actions, ensure_ascii=False),
        is_enabled=1,
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return {"success": True, "data": {"id": new_rule.id}}


@router.put("/{rule_id}")
async def update_rule(
    rule_id: int,
    rule: RuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新规则"""
    import json
    existing = db.query(AdOptimizationRule).filter(
        AdOptimizationRule.id == rule_id,
        AdOptimizationRule.tenant_id == current_user.tenant_id,
        AdOptimizationRule.deleted_at.is_(None)
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="规则不存在")

    if rule.name is not None:
        existing.name = rule.name
    if rule.rule_type is not None:
        existing.rule_type = rule.rule_type
    if rule.conditions is not None:
        existing.conditions = json.dumps(rule.conditions, ensure_ascii=False)
    if rule.actions is not None:
        existing.actions = json.dumps(rule.actions, ensure_ascii=False)
    if rule.is_enabled is not None:
        existing.is_enabled = rule.is_enabled

    db.commit()
    return {"success": True}


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """软删除规则"""
    from datetime import datetime
    existing = db.query(AdOptimizationRule).filter(
        AdOptimizationRule.id == rule_id,
        AdOptimizationRule.tenant_id == current_user.tenant_id,
        AdOptimizationRule.deleted_at.is_(None)
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="规则不存在")

    existing.deleted_at = datetime.now()
    db.commit()
    return {"success": True}


@router.post("/execute")
async def execute_rules(
    rule_ids: Optional[List[int]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """手动执行规则（可指定规则ID列表，不传则执行所有启用规则）"""
    from services.ad_ai_service import execute_optimization_rules
    try:
        results = execute_optimization_rules(
            db=db,
            tenant_id=current_user.tenant_id,
            rule_ids=rule_ids,
        )
        return {"success": True, "data": results}
    except Exception as e:
        logger.error(f"执行规则失败: {e}")
        raise HTTPException(status_code=500, detail=f"执行规则失败: {str(e)}")


@router.get("/predefined")
async def list_predefined_rules(
    current_user: User = Depends(get_current_user)
):
    """
    返回规则引擎中预定义的规则列表

    返回每条规则的 {name, priority, description}
    """
    try:
        from services.ad_rules.rule_engine import RuleEngine
        engine = RuleEngine()
        rules = [
            {
                "name": rule.name,
                "priority": rule.priority,
                "description": rule.description,
            }
            for rule in engine.RULES
        ]
        return {"success": True, "data": rules}
    except Exception as e:
        logger.error(f"获取预定义规则列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取预定义规则列表失败: {str(e)}")