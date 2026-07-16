"""
广告AI分析服务
使用OpenAI生成广告优化建议
"""
import json
import logging
from typing import Optional, List
from sqlalchemy.orm import Session
from services.ad_service import (
    get_ad_overview,
    get_keyword_analysis,
    get_search_term_analysis,
)
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def generate_ad_suggestions(
    db: Session,
    tenant_id: int,
    department_ids: List[int],
    account: Optional[List[str]] = None,
    country: Optional[List[str]] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    suggestion_type: str = "all",
) -> dict:
    """生成AI广告优化建议"""
    filters = {
        "account": account,
        "country": country,
        "date_from": date_from,
        "date_to": date_to,
    }

    # 收集数据
    overview = get_ad_overview(db, tenant_id, department_ids, **filters)
    keyword_data = get_keyword_analysis(db, tenant_id, department_ids, **filters)
    search_term_data = get_search_term_analysis(db, tenant_id, department_ids, **filters)

    suggestions = {
        "overview": overview,
        "keyword_bid_suggestions": [],
        "negative_keyword_suggestions": [],
        "budget_suggestions": [],
        "new_keyword_suggestions": [],
    }

    # 规则驱动的基础建议（无需AI也能生成）
    if suggestion_type in ("all", "keyword_bid"):
        suggestions["keyword_bid_suggestions"] = _generate_bid_suggestions(keyword_data)
    if suggestion_type in ("all", "negative_keyword"):
        suggestions["negative_keyword_suggestions"] = _generate_negative_keyword_suggestions(search_term_data)
    if suggestion_type in ("all", "budget"):
        suggestions["budget_suggestions"] = _generate_budget_suggestions(keyword_data)
    if suggestion_type in ("all", "new_keyword"):
        suggestions["new_keyword_suggestions"] = _generate_new_keyword_suggestions(search_term_data)

    # 尝试AI增强分析
    try:
        ai_analysis = _call_ai_analysis(overview, keyword_data, search_term_data)
        if ai_analysis:
            suggestions["ai_analysis"] = ai_analysis
    except Exception as e:
        logger.warning(f"AI分析调用失败，使用规则引擎结果: {e}")

    return suggestions


def _generate_bid_suggestions(keyword_data: dict) -> List[dict]:
    """基于规则生成竞价调整建议"""
    suggestions = []

    for kw in keyword_data.get("money_burner", [])[:5]:
        suggestions.append({
            "type": "reduce_bid",
            "target": kw["keyword"],
            "reason": f"高花费(${kw['spend']:.2f})零转化，ACOS极高",
            "action": "建议降价50%或暂停",
            "current_spend": kw["spend"],
            "current_acos": kw["acos"],
        })

    for kw in keyword_data.get("high_conversion", [])[:5]:
        if kw["acos"] < 15:
            suggestions.append({
                "type": "increase_bid",
                "target": kw["keyword"],
                "reason": f"高转化低ACOS({kw['acos']}%)，有提升空间",
                "action": "建议提价10%-20%抢占更多流量",
                "current_spend": kw["spend"],
                "current_acos": kw["acos"],
            })

    return suggestions


def _generate_negative_keyword_suggestions(search_term_data: dict) -> List[dict]:
    """生成否定关键词建议"""
    return [
        {
            "search_term": item["search_term"],
            "spend": item["spend"],
            "clicks": item["clicks"],
            "reason": f"花费${item['spend']:.2f}，{item['clicks']}次点击，0订单",
            "action": "建议添加为否定精准关键词",
        }
        for item in search_term_data.get("negative_keyword_suggestions", [])[:10]
    ]


def _generate_budget_suggestions(keyword_data: dict) -> List[dict]:
    """生成预算调整建议"""
    suggestions = []
    all_kw = keyword_data.get("all", [])
    total_spend = sum(kw["spend"] for kw in all_kw)
    money_burner_spend = sum(kw["spend"] for kw in keyword_data.get("money_burner", []))

    if money_burner_spend > 0 and total_spend > 0:
        suggestions.append({
            "type": "reallocate_budget",
            "reason": f"烧钱词浪费了${money_burner_spend:.2f}（占总花费{money_burner_spend/total_spend*100:.1f}%）",
            "action": "建议将这部分预算转移到高转化词",
        })

    return suggestions


def _generate_new_keyword_suggestions(search_term_data: dict) -> List[dict]:
    """生成新关键词挖掘建议"""
    high_cvr_terms = [
        item for item in search_term_data.get("items", [])
        if item["orders"] > 0 and item["cvr"] > 10
    ]
    high_cvr_terms.sort(key=lambda x: x["orders"], reverse=True)

    return [
        {
            "search_term": item["search_term"],
            "orders": item["orders"],
            "cvr": item["cvr"],
            "acos": item["acos"],
            "reason": f"高转化({item['cvr']}%)，{item['orders']}单",
            "action": "建议添加为精准匹配关键词投放",
        }
        for item in high_cvr_terms[:10]
    ]


def _call_ai_analysis(overview: dict, keyword_data: dict, search_term_data: dict) -> Optional[str]:
    """调用OpenAI进行深度分析

    AI 仅负责解读数据和诊断问题，不生成优化操作决策。
    决策由规则引擎和运营人员决定。
    """
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )

        prompt = f"""你是广告数据分析师，仅负责解读数据和诊断问题，不生成优化操作决策。

请基于以下结构化数据（健康分 + 规则结果 + 核心指标）进行数据解读、问题诊断和风险预警。

【广告概览 - 核心指标】
- 总花费: ${overview['total_spend']:,.2f}
- 总销售额: ${overview['total_sales']:,.2f}
- ACOS: {overview['acos']}%
- ROAS: {overview['roas']}
- CTR: {overview['ctr']}%
- CPC: ${overview['cpc']}
- CVR: {overview['cvr']}%
- 总订单: {overview['total_orders']}

【关键词表现 Top5（按花费）】
{json.dumps(keyword_data.get('all', [])[:5], ensure_ascii=False, indent=2)}

【烧钱词（高花费零转化）】
{json.dumps(keyword_data.get('money_burner', [])[:5], ensure_ascii=False, indent=2)}

请输出以下内容（用中文回复）：
1. 数据解读：概括当前广告整体表现，指出关键指标的健康状况
2. 问题诊断：识别存在的核心问题（如花费浪费、转化瓶颈、竞价异常等）
3. 风险预警：提示需要关注的潜在风险

约束：
- 只做数据解读、问题诊断、风险预警
- 不生成优化操作决策（如调价、加预算、否定关键词等具体操作建议由规则引擎和运营人员决定）
- 每部分约50-100字，共3部分"""

        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL or "gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1000,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.warning(f"OpenAI调用失败: {e}")
        return None


def execute_optimization_rules(
    db: Session,
    tenant_id: int,
    rule_ids: Optional[List[int]] = None,
) -> List[dict]:
    """执行自动化优化规则"""
    from models.ad_report import AdOptimizationRule, AdOptimizationLog
    from datetime import datetime
    import json as json_module

    query = db.query(AdOptimizationRule).filter(
        AdOptimizationRule.tenant_id == tenant_id,
        AdOptimizationRule.is_enabled == 1,
        AdOptimizationRule.deleted_at.is_(None),
    )
    if rule_ids:
        query = query.filter(AdOptimizationRule.id.in_(rule_ids))

    rules = query.all()
    results = []

    for rule in rules:
        try:
            conditions = json_module.loads(rule.conditions)
            actions = json_module.loads(rule.actions)

            # 执行规则逻辑
            result_text = _evaluate_rule(db, tenant_id, conditions, actions)

            # 记录日志
            log = AdOptimizationLog(
                tenant_id=tenant_id,
                rule_id=rule.id,
                action_type=rule.rule_type,
                target=rule.name,
                result=result_text,
                status="success",
            )
            db.add(log)

            # 更新最后执行时间
            rule.last_executed_at = datetime.now()

            results.append({
                "rule_id": rule.id,
                "rule_name": rule.name,
                "status": "success",
                "result": result_text,
            })
        except Exception as e:
            logger.error(f"执行规则 {rule.name} 失败: {e}")
            results.append({
                "rule_id": rule.id,
                "rule_name": rule.name,
                "status": "failed",
                "error": str(e),
            })

    db.commit()
    return results


def _evaluate_rule(db: Session, tenant_id: int, conditions: dict, actions: dict) -> str:
    """评估并执行单个规则"""
    overview = get_ad_overview(db, tenant_id, [])

    metric = conditions.get("metric", "acos")
    operator = conditions.get("operator", "gt")
    threshold = conditions.get("value", 30)

    current_value = overview.get(metric, 0)

    triggered = False
    if operator == "gt":
        triggered = current_value > threshold
    elif operator == "lt":
        triggered = current_value < threshold
    elif operator == "gte":
        triggered = current_value >= threshold
    elif operator == "lte":
        triggered = current_value <= threshold

    if triggered:
        action_type = actions.get("action", "unknown")
        return f"条件触发: {metric}={current_value} {operator} {threshold} → 建议执行: {action_type}"
    else:
        return f"条件未触发: {metric}={current_value} {operator} {threshold}"