"""
规则 3: ROAS 过低 (RoasTooLowRule)

条件: ROAS < 2.5 且 spend >= $10
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


class RoasTooLowRule(BaseOptimizationRule):
    """ROAS 过低规则"""

    @property
    def name(self) -> str:
        return "roas_too_low"

    @property
    def priority(self) -> str:
        return "高"

    @property
    def description(self) -> str:
        return "ROAS 低于 2.5 且花费达到 $10 门槛，投入产出比不达标"

    @property
    def rule_type(self) -> str:
        return "adjust_bid"

    @property
    def conditions(self) -> List[dict]:
        return [
            {"metric": "roas", "operator": "<", "threshold": RuleThresholds.ROAS_TOO_LOW_THRESHOLD, "unit": ""},
            {"metric": "spend", "operator": ">=", "threshold": RuleThresholds.ROAS_TOO_LOW_MIN_SPEND, "unit": "$"},
        ]

    @property
    def actions(self) -> List[str]:
        return ["优化关键词", "调整竞价", "优化Listing"]

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

            threshold = RuleThresholds.ROAS_TOO_LOW_THRESHOLD
            min_spend = RuleThresholds.ROAS_TOO_LOW_MIN_SPEND

            for record in records:
                try:
                    roas = float(record.roas) if record.roas is not None else 0.0
                    spend = float(record.spend) if record.spend is not None else 0.0

                    # 条件: ROAS < 2.5 且 spend >= $10
                    if roas < threshold and spend >= min_spend:
                        condition_metrics = {
                            "roas": round(roas, 4),
                            "spend": round(spend, 2),
                            "sales": float(record.sales) if record.sales is not None else 0.0,
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_name) if record.campaign_name else "",
                            target_name=record.campaign_name or "",
                            triggered=True,
                            current_value=round(roas, 4),
                            threshold=threshold,
                            condition_metrics=condition_metrics,
                            suggestion_action=(
                                "优化关键词匹配方式或降低竞价，提升 ROAS；"
                                "考虑暂停持续低效的活动"
                            ),
                            suggestion_reason=(
                                f"ROAS {roas:.2f} 低于阈值 {threshold}，"
                                f"且花费 ${spend:.2f} 达到门槛 ${min_spend:.0f}，"
                                f"投入产出比不达标"
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
