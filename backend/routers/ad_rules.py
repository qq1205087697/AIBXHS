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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    返回规则引擎中预定义的规则列表

    返回每条规则的完整元信息: {id, name, rule_type, priority, description, conditions, actions, is_enabled}
    - id: 序号（1-based），用于前端 update 调用
    - conditions: [{metric, operator, threshold, unit}]
    - is_enabled: 从 business_settings 读取覆盖（若未配置则默认 True）
    - conditions 中的 threshold: 从 business_settings 读取覆盖（若未配置则用默认值）
    """
    try:
        from services.ad_rules.rule_engine import RuleEngine
        from sqlalchemy import text as sql_text

        engine = RuleEngine()
        rules_meta = engine.get_rule_metadata()

        # 从 business_settings 读取每条规则的启用状态和阈值覆盖
        # 配置项格式: setting_type='ad_rule', setting_name=f'rule_{rule_name}_enabled' / f'rule_{rule_name}_threshold_{metric}'
        for rule in rules_meta:
            rule_name = rule["name"]

            # 读取启用状态覆盖
            try:
                enabled_row = db.execute(
                    sql_text(
                        "SELECT formula_config FROM business_settings "
                        "WHERE setting_type='ad_rule' AND setting_name=:sn "
                        "AND (tenant_id=:tid OR tenant_id IS NULL) AND is_active=1 "
                        "ORDER BY tenant_id DESC LIMIT 1"
                    ),
                    {"sn": f"rule_{rule_name}_enabled", "tid": current_user.tenant_id},
                ).fetchone()
                if enabled_row and enabled_row[0] is not None:
                    rule["is_enabled"] = str(enabled_row[0]).strip() in ("1", "true", "True")
            except Exception as e:
                logger.debug(f"读取规则 {rule_name} 启用状态失败（忽略，用默认值）: {e}")

            # 读取阈值覆盖
            try:
                threshold_rows = db.execute(
                    sql_text(
                        "SELECT setting_name, formula_config FROM business_settings "
                        "WHERE setting_type='ad_rule' AND setting_name LIKE :pattern "
                        "AND (tenant_id=:tid OR tenant_id IS NULL) AND is_active=1"
                    ),
                    {"pattern": f"rule_{rule_name}_threshold_%", "tid": current_user.tenant_id},
                ).fetchall()
                if threshold_rows:
                    # 构建 metric -> threshold 覆盖映射
                    overrides = {}
                    for row in threshold_rows:
                        # setting_name 格式: rule_{rule_name}_threshold_{metric}
                        metric = row[0].replace(f"rule_{rule_name}_threshold_", "")
                        try:
                            overrides[metric] = float(row[1])
                        except (ValueError, TypeError):
                            pass
                    # 应用覆盖到 conditions
                    if overrides:
                        new_conditions = []
                        for cond in rule["conditions"]:
                            metric = cond["metric"]
                            if metric in overrides:
                                cond = {**cond, "threshold": overrides[metric]}
                            new_conditions.append(cond)
                        rule["conditions"] = new_conditions
            except Exception as e:
                logger.debug(f"读取规则 {rule_name} 阈值覆盖失败（忽略，用默认值）: {e}")

        return {"success": True, "data": rules_meta}
    except Exception as e:
        logger.error(f"获取预定义规则列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取预定义规则列表失败: {str(e)}")


class PredefinedRuleUpdate(BaseModel):
    """预定义规则更新请求体"""
    is_enabled: Optional[bool] = None
    conditions: Optional[List[dict]] = None  # [{metric, operator, threshold, unit}]


@router.put("/predefined/{rule_id}")
async def update_predefined_rule(
    rule_id: int,
    body: PredefinedRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    更新预定义规则的启用状态或阈值

    - rule_id: 规则序号（1-7）
    - is_enabled: 启用状态，写入 business_settings.setting_name=f'rule_{rule_name}_enabled'
    - conditions: 阈值覆盖，每个 metric 写入 business_settings.setting_name=f'rule_{rule_name}_threshold_{metric}'

    持久化到 business_settings 表，运行时规则引擎下次启动会读取新阈值（当前进程内存中的规则实例仍用旧值，需重启服务生效）。
    """
    try:
        from services.ad_rules.rule_engine import RuleEngine
        from sqlalchemy import text as sql_text

        engine = RuleEngine()
        if rule_id < 1 or rule_id > len(engine.RULES):
            raise HTTPException(status_code=404, detail=f"预定义规则不存在: id={rule_id}")

        rule = engine.RULES[rule_id - 1]
        rule_name = rule.name

        # 更新启用状态
        if body.is_enabled is not None:
            setting_name = f"rule_{rule_name}_enabled"
            setting_value = "1" if body.is_enabled else "0"
            _upsert_business_setting(
                db=db,
                tenant_id=current_user.tenant_id,
                setting_type="ad_rule",
                setting_name=setting_name,
                value=setting_value,
            )

        # 更新阈值覆盖
        if body.conditions is not None:
            for cond in body.conditions:
                metric = cond.get("metric")
                threshold = cond.get("threshold")
                if not metric or threshold is None:
                    continue
                setting_name = f"rule_{rule_name}_threshold_{metric}"
                _upsert_business_setting(
                    db=db,
                    tenant_id=current_user.tenant_id,
                    setting_type="ad_rule",
                    setting_name=setting_name,
                    value=str(threshold),
                )

        db.commit()
        logger.info(
            f"更新预定义规则 tenant_id={current_user.tenant_id} rule_id={rule_id} "
            f"rule_name={rule_name} is_enabled={body.is_enabled} conditions_count={len(body.conditions or [])}"
        )
        return {"success": True, "data": {"rule_id": rule_id, "rule_name": rule_name}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"更新预定义规则失败 rule_id={rule_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新预定义规则失败: {str(e)}")


def _upsert_business_setting(
    db: Session,
    tenant_id: int,
    setting_type: str,
    setting_name: str,
    value: str,
):
    """business_settings 表的 upsert 辅助函数"""
    from sqlalchemy import text as sql_text
    existing = db.execute(
        sql_text(
            "SELECT id FROM business_settings "
            "WHERE setting_type=:st AND setting_name=:sn AND tenant_id=:tid LIMIT 1"
        ),
        {"st": setting_type, "sn": setting_name, "tid": tenant_id},
    ).fetchone()

    if existing:
        db.execute(
            sql_text(
                "UPDATE business_settings SET formula_config=:val, is_active=1, updated_at=NOW() "
                "WHERE id=:id"
            ),
            {"val": value, "id": existing[0]},
        )
    else:
        db.execute(
            sql_text(
                "INSERT INTO business_settings (tenant_id, setting_type, setting_name, formula_config, is_active, created_at, updated_at) "
                "VALUES (:tid, :st, :sn, :val, 1, NOW(), NOW())"
            ),
            {"tid": tenant_id, "st": setting_type, "sn": setting_name, "val": value},
        )