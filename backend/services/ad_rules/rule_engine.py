"""
广告优化规则引擎协调器

职责:
1. 按优先级排序执行所有规则
2. 短路机制: 同一 target_id 只保留最高优先级的建议
3. 将结果写入 ad_optimization_suggestion 建议池
4. 返回执行摘要
"""
import json
import logging
from datetime import date, datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from models.ad_daily import AdOptimizationSuggestion
from services.ad_rules.rule_base import BaseOptimizationRule, RuleResult
from services.ad_rules.rules.rule_budget_under_spend import BudgetUnderSpendRule
from services.ad_rules.rules.rule_acos_too_high import AcosTooHighRule
from services.ad_rules.rules.rule_roas_too_low import RoasTooLowRule
from services.ad_rules.rules.rule_ctr_low import CtrLowRule
from services.ad_rules.rules.rule_cpc_too_high import CpcTooHighRule
from services.ad_rules.rules.rule_cvr_low import CvrLowRule
from services.ad_rules.rules.rule_budget_utilization_low import BudgetUtilizationLowRule

logger = logging.getLogger(__name__)

# 优先级排序权重: 高=0, 中=1, 其他=2
_PRIORITY_ORDER = {"高": 0, "中": 1}


class RuleEngine:
    """规则引擎协调器"""

    def __init__(self):
        self.RULES: List[BaseOptimizationRule] = [
            BudgetUnderSpendRule(),
            AcosTooHighRule(),
            RoasTooLowRule(),
            CtrLowRule(),
            CpcTooHighRule(),
            CvrLowRule(),
            BudgetUtilizationLowRule(),
        ]

    def run_all_rules(
        self,
        db: Session,
        tenant_id: int,
        evaluation_date: date,
        save_suggestions: bool = True,
    ) -> Dict[str, Any]:
        """
        执行所有规则，应用短路机制

        :param db: 数据库会话
        :param tenant_id: 租户ID
        :param evaluation_date: 评估数据日期
        :param save_suggestions: 是否将结果写入建议池
        :return: 摘要 dict
        """
        logger.info(
            f"规则引擎启动 tenant_id={tenant_id} date={evaluation_date} "
            f"save_suggestions={save_suggestions}"
        )

        # 1. 按优先级排序（高优先级先执行）
        sorted_rules = sorted(
            self.RULES,
            key=lambda r: _PRIORITY_ORDER.get(r.priority, 99),
        )

        all_results: List[RuleResult] = []

        # 2. 执行每条规则的 evaluate()
        for rule in sorted_rules:
            try:
                results = rule.evaluate(db, tenant_id, evaluation_date)
                triggered = [r for r in results if r.triggered]
                all_results.extend(triggered)
                logger.info(
                    f"规则 [{rule.name}] ({rule.priority}) 触发 {len(triggered)} 条建议"
                )
            except Exception as e:
                logger.error(
                    f"规则 [{rule.name}] 执行异常: {e}",
                    exc_info=True,
                )
                continue

        # 3. 短路机制：同一 target_id 只保留最高优先级的建议
        deduped_results = self._apply_short_circuit(all_results)

        logger.info(
            f"短路去重: {len(all_results)} -> {len(deduped_results)} 条建议"
        )

        # 4. 如果 save_suggestions=True，将结果写入建议池
        saved_count = 0
        if save_suggestions and deduped_results:
            try:
                saved_count = self._save_to_pool(db, tenant_id, deduped_results, evaluation_date)
            except Exception as e:
                logger.error(f"写入建议池失败: {e}", exc_info=True)

        # 5. 返回摘要
        high_count = sum(1 for r in deduped_results if r.rule_priority == "高")
        medium_count = sum(1 for r in deduped_results if r.rule_priority == "中")

        summary = {
            "total_triggered": len(deduped_results),
            "high_priority": high_count,
            "medium_priority": medium_count,
            "saved_count": saved_count,
            "evaluation_date": str(evaluation_date),
            "details": [self._result_to_dict(r) for r in deduped_results],
        }

        logger.info(
            f"规则引擎完成 tenant_id={tenant_id} date={evaluation_date} "
            f"总计 {summary['total_triggered']} 条建议 "
            f"(高 {high_count} / 中 {medium_count}) 已保存 {saved_count} 条"
        )

        return summary

    def _apply_short_circuit(self, results: List[RuleResult]) -> List[RuleResult]:
        """
        短路机制：同一 target_id 只保留最高优先级的建议

        对于每个 target_id:
        - 找到触发的最高优先级
        - 只保留该优先级的建议，丢弃更低优先级的建议
        """
        # 按 target_id 分组
        grouped: Dict[str, List[RuleResult]] = {}
        for r in results:
            key = f"{r.target_type}:{r.target_id}"
            grouped.setdefault(key, []).append(r)

        deduped: List[RuleResult] = []
        for key, group in grouped.items():
            # 找到该 target 的最高优先级
            min_weight = min(
                _PRIORITY_ORDER.get(r.rule_priority, 99) for r in group
            )
            # 只保留最高优先级的建议
            top_results = [
                r for r in group
                if _PRIORITY_ORDER.get(r.rule_priority, 99) == min_weight
            ]
            deduped.extend(top_results)

        return deduped

    def _save_to_pool(
        self,
        db: Session,
        tenant_id: int,
        results: List[RuleResult],
        evaluation_date: date,
    ) -> int:
        """
        将 RuleResult 列表写入建议池

        :return: 实际写入的记录数
        """
        saved_count = 0

        # 查询当天已存在的建议，避免重复插入
        existing_keys = set()
        try:
            existing = (
                db.query(
                    AdOptimizationSuggestion.rule_name,
                    AdOptimizationSuggestion.target_type,
                    AdOptimizationSuggestion.target_id,
                )
                .filter(
                    AdOptimizationSuggestion.tenant_id == tenant_id,
                    AdOptimizationSuggestion.evaluation_date == evaluation_date,
                    AdOptimizationSuggestion.deleted_at.is_(None),
                )
                .all()
            )
            for row in existing:
                existing_keys.add(f"{row[0]}:{row[1]}:{row[2]}")
        except Exception as e:
            logger.warning(f"查询已有建议失败，跳过去重: {e}")

        for result in results:
            dedup_key = f"{result.rule_name}:{result.target_type}:{result.target_id}"
            if dedup_key in existing_keys:
                logger.debug(f"跳过重复建议: {dedup_key}")
                continue

            try:
                suggestion = AdOptimizationSuggestion(
                    tenant_id=tenant_id,
                    store_id=result.store_id,
                    rule_name=result.rule_name,
                    rule_priority=result.rule_priority,
                    rule_version="1.0",
                    target_type=result.target_type,
                    target_id=result.target_id,
                    target_name=result.target_name,
                    condition_metrics=json.dumps(
                        result.condition_metrics, ensure_ascii=False
                    ) if result.condition_metrics else None,
                    current_value=result.current_value,
                    threshold=result.threshold,
                    suggestion_action=result.suggestion_action,
                    suggestion_reason=result.suggestion_reason,
                    status="待处理",
                    created_by=0,  # 系统
                    evaluation_date=evaluation_date,
                )
                db.add(suggestion)
                saved_count += 1
                existing_keys.add(dedup_key)
            except Exception as e:
                logger.error(
                    f"写入建议失败 rule={result.rule_name} "
                    f"target_id={result.target_id}: {e}"
                )
                continue

        if saved_count > 0:
            try:
                db.commit()
                logger.info(f"成功写入 {saved_count} 条建议到建议池")
            except Exception as e:
                db.rollback()
                logger.error(f"提交建议池事务失败: {e}", exc_info=True)
                saved_count = 0

        return saved_count

    def _result_to_dict(self, result: RuleResult) -> Dict[str, Any]:
        """将 RuleResult 转为摘要 dict"""
        return {
            "rule_name": result.rule_name,
            "rule_priority": result.rule_priority,
            "target_type": result.target_type,
            "target_id": result.target_id,
            "target_name": result.target_name,
            "current_value": result.current_value,
            "threshold": result.threshold,
            "condition_metrics": result.condition_metrics,
            "suggestion_action": result.suggestion_action,
            "suggestion_reason": result.suggestion_reason,
            "store_id": result.store_id,
        }
