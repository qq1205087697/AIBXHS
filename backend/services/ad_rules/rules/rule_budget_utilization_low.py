"""
规则 7: 预算利用率过低 (BudgetUtilizationLowRule)

条件: 预算利用率 < 50%
优先级: 中
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


class BudgetUtilizationLowRule(BaseOptimizationRule):
    """预算利用率过低规则"""

    @property
    def name(self) -> str:
        return "budget_utilization_low"

    @property
    def priority(self) -> str:
        return "中"

    @property
    def description(self) -> str:
        return "预算利用率低于 50%，预算未被充分使用"

    @property
    def rule_type(self) -> str:
        return "increase_budget"

    @property
    def conditions(self) -> List[dict]:
        return [
            {"metric": "budget_utilization", "operator": "<", "threshold": RuleThresholds.BUDGET_UTILIZATION_LOW_THRESHOLD, "unit": ""},
        ]

    @property
    def actions(self) -> List[str]:
        return ["增加预算", "优化投放时段", "扩展关键词"]

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

            threshold = RuleThresholds.BUDGET_UTILIZATION_LOW_THRESHOLD

            for record in records:
                try:
                    spend = float(record.spend) if record.spend is not None else 0.0
                    budget_util = float(record.budget_utilization) if record.budget_utilization is not None else None

                    # 快照表无 budget 绝对值，直接使用 budget_utilization 字段
                    if budget_util is None:
                        continue

                    utilization = budget_util

                    # 条件: 预算利用率 < 50%
                    if utilization < threshold:
                        condition_metrics = {
                            "budget_utilization": round(utilization, 4),
                            "spend": round(spend, 2),
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_name) if record.campaign_name else "",
                            target_name=record.campaign_name or "",
                            triggered=True,
                            current_value=round(utilization, 4),
                            threshold=threshold,
                            condition_metrics=condition_metrics,
                            suggestion_action=(
                                "提高竞价或增加关键词覆盖范围，提升预算消耗；"
                                "检查活动是否因竞价过低导致曝光不足"
                            ),
                            suggestion_reason=(
                                f"预算利用率 {utilization * 100:.1f}% 低于阈值 {threshold * 100:.0f}%，"
                                f"花费 ${spend:.2f}，预算未被充分使用"
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
