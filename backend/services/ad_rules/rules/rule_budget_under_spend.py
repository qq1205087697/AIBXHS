"""
规则 1: 预算花费不足 (BudgetUnderSpendRule)

条件: budget > $30 且 spend < budget x 50%
优先级: 高
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

            min_budget = RuleThresholds.BUDGET_UNDER_SPEND_MIN_BUDGET
            ratio_threshold = RuleThresholds.BUDGET_UNDER_SPEND_RATIO

            for record in records:
                try:
                    budget = float(record.budget) if record.budget is not None else 0.0
                    spend = float(record.spend) if record.spend is not None else 0.0

                    # 条件: budget > $30 且 spend < budget x 50%
                    if budget > min_budget and budget > 0:
                        spend_ratio = spend / budget
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
                                target_id=str(record.campaign_id) if record.campaign_id else "",
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
