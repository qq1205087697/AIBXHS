"""
规则 2: ACOS 过高 (AcosTooHighRule)

条件: ACOS > 30% 且 spend >= $10
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


class AcosTooHighRule(BaseOptimizationRule):
    """ACOS 过高规则"""

    @property
    def name(self) -> str:
        return "acos_too_high"

    @property
    def priority(self) -> str:
        return "高"

    @property
    def description(self) -> str:
        return "ACOS 超过 30% 且花费达到 $10 门槛，广告投入产出比偏低"

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

            threshold = RuleThresholds.ACOS_TOO_HIGH_THRESHOLD
            min_spend = RuleThresholds.ACOS_TOO_HIGH_MIN_SPEND

            for record in records:
                try:
                    acos = float(record.acos) if record.acos is not None else 0.0
                    spend = float(record.spend) if record.spend is not None else 0.0

                    # 条件: ACOS > 30% 且 spend >= $10
                    if acos > threshold and spend >= min_spend:
                        condition_metrics = {
                            "acos": round(acos, 4),
                            "spend": round(spend, 2),
                            "sales": float(record.sales) if record.sales is not None else 0.0,
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_id) if record.campaign_id else "",
                            target_name=record.campaign_name or "",
                            triggered=True,
                            current_value=round(acos, 4),
                            threshold=threshold,
                            condition_metrics=condition_metrics,
                            suggestion_action=(
                                "降低竞价或暂停高 ACOS 关键词，优化广告结构与投放精准度，"
                                "减少低效花费"
                            ),
                            suggestion_reason=(
                                f"ACOS {acos * 100:.1f}% 超过阈值 {threshold * 100:.0f}%，"
                                f"且花费 ${spend:.2f} 达到门槛 ${min_spend:.0f}，"
                                f"广告投入产出比偏低"
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
