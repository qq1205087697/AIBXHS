"""
规则 1: 预算花费不足 (BudgetUnderSpendRule)

条件: budget > $30 且 spend < budget x 50%
优先级: 高
数据源: AdReportSnapshot
"""
import logging
from typing import List
from datetime import date
from sqlalchemy.orm import Session

from models.ad_report import AdReportSnapshot
from services.ad_rules.constants import RuleThresholds
from services.ad_rules.rule_base import BaseOptimizationRule, RuleResult

logger = logging.getLogger(__name__)


class BudgetUnderSpendRule(BaseOptimizationRule):
    """预算花费不足规则"""

    @property
    def name(self) -> str:
        return "budget_under_spend"

    @property
    def priority(self) -> str:
        return "高"

    @property
    def description(self) -> str:
        return "日预算超过 $30 但花费不足预算的 50%，预算未被有效利用"

    @property
    def rule_type(self) -> str:
        return "increase_budget"

    @property
    def conditions(self) -> List[dict]:
        return [
            {"metric": "budget", "operator": ">=", "threshold": RuleThresholds.BUDGET_UNDER_SPEND_MIN_BUDGET, "unit": "$"},
            {"metric": "budget_utilization", "operator": "<", "threshold": RuleThresholds.BUDGET_UNDER_SPEND_RATIO, "unit": ""},
        ]

    @property
    def actions(self) -> List[str]:
        return ["增加预算", "优化投放时段"]

    def evaluate(self, db: Session, tenant_id: int, evaluation_date: date) -> List[RuleResult]:
        """评估规则，返回触发结果列表"""
        results: List[RuleResult] = []
        try:
            records = (
                db.query(AdReportSnapshot)
                .filter(
                    AdReportSnapshot.tenant_id == tenant_id,
                    AdReportSnapshot.report_type == "campaign",
                    AdReportSnapshot.date == evaluation_date,
                    AdReportSnapshot.deleted_at.is_(None),
                )
                .all()
            )

            min_budget = RuleThresholds.BUDGET_UNDER_SPEND_MIN_BUDGET
            ratio_threshold = RuleThresholds.BUDGET_UNDER_SPEND_RATIO

            for record in records:
                try:
                    spend = float(record.spend) if record.spend is not None else 0.0
                    budget_util = float(record.budget_utilization) if record.budget_utilization is not None else 0.0

                    # 反推 budget：spend / budget_utilization（仅当 utilization > 0 时有效）
                    if budget_util <= 0:
                        continue
                    budget = spend / budget_util

                    # 条件: budget > $30 且 spend < budget x 50%
                    if budget > min_budget:
                        spend_ratio = budget_util  # 直接使用 Excel 原始 budget_utilization
                        if spend_ratio < ratio_threshold:
                            condition_metrics = {
                                "budget": round(budget, 2),
                                "spend": round(spend, 2),
                                "spend_ratio": round(spend_ratio, 4),
                            }
                            results.append(RuleResult(
                                rule_name=self.name,
                                rule_priority=self.priority,
                                target_type="campaign",
                                target_id=str(record.campaign_name) if record.campaign_name else "",
                                target_name=record.campaign_name or "",
                                triggered=True,
                                current_value=round(spend_ratio, 4),
                                threshold=ratio_threshold,
                                condition_metrics=condition_metrics,
                                suggestion_action=(
                                    "检查活动竞价与关键词覆盖，建议提高竞价或扩展关键词以增加花费，"
                                    "使预算得到有效利用"
                                ),
                                suggestion_reason=(
                                    f"日预算 ${budget:.2f} 但仅花费 ${spend:.2f}"
                                    f"（利用率 {spend_ratio * 100:.1f}%），"
                                    f"低于阈值 {ratio_threshold * 100:.0f}%，预算未被有效利用"
                                ),
                                store_id=None,
                            ))
                except Exception as row_err:
                    logger.warning(
                        f"[{self.name}] 处理记录 campaign_name={record.campaign_name} 失败: {row_err}"
                    )
                    continue

            logger.info(
                f"[{self.name}] 评估完成 tenant_id={tenant_id} date={evaluation_date} "
                f"触发 {len(results)} 条建议"
            )
        except Exception as e:
            logger.error(
                f"[{self.name}] 评估失败 tenant_id={tenant_id} date={evaluation_date}: {e}",
                exc_info=True,
            )

        return results
