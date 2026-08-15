"""
规则 7: 预算利用率过低 (BudgetUtilizationLowRule)

条件: 预算利用率 < 50%
优先级: 中
数据源: AdCampaignDaily
"""
import logging
from typing import List
from datetime import date
from sqlalchemy.orm import Session

from models.ad_daily import AdCampaignDaily
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

    def evaluate(self, db: Session, tenant_id: int, evaluation_date: date) -> List[RuleResult]:
        """评估规则，返回触发结果列表"""
        results: List[RuleResult] = []
        try:
            records = (
                db.query(AdCampaignDaily)
                .filter(
                    AdCampaignDaily.tenant_id == tenant_id,
                    AdCampaignDaily.date == evaluation_date,
                    AdCampaignDaily.deleted_at.is_(None),
                )
                .all()
            )

            threshold = RuleThresholds.BUDGET_UTILIZATION_LOW_THRESHOLD

            for record in records:
                try:
                    budget = float(record.budget) if record.budget is not None else 0.0
                    spend = float(record.spend) if record.spend is not None else 0.0

                    # 预算利用率: spend / budget，需 budget > 0 才有意义
                    if budget <= 0:
                        continue

                    utilization = float(record.budget_utilization) if record.budget_utilization is not None else (spend / budget)

                    # 条件: 预算利用率 < 50%
                    if utilization < threshold:
                        condition_metrics = {
                            "budget_utilization": round(utilization, 4),
                            "budget": round(budget, 2),
                            "spend": round(spend, 2),
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_id) if record.campaign_id else "",
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
                                f"日预算 ${budget:.2f} 仅花费 ${spend:.2f}，"
                                f"预算未被充分使用"
                            ),
                            store_id=record.store_id,
                        ))
                except Exception as row_err:
                    logger.warning(
                        f"[{self.name}] 处理记录 campaign_id={record.campaign_id} 失败: {row_err}"
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
