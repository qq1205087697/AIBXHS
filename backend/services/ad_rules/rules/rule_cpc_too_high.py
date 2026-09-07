"""
规则 5: CPC 过高 (CpcTooHighRule)

条件: CPC > $1.5 且 clicks >= 10
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


class CpcTooHighRule(BaseOptimizationRule):
    """CPC 过高规则"""

    @property
    def name(self) -> str:
        return "cpc_too_high"

    @property
    def priority(self) -> str:
        return "中"

    @property
    def description(self) -> str:
        return "CPC 超过 $1.5 且点击量达到 10 门槛，单次点击成本偏高"

    @property
    def rule_type(self) -> str:
        return "adjust_bid"

    @property
    def conditions(self) -> List[dict]:
        return [
            {"metric": "cpc", "operator": ">", "threshold": RuleThresholds.CPC_TOO_HIGH_THRESHOLD, "unit": "$"},
            {"metric": "clicks", "operator": ">=", "threshold": RuleThresholds.CPC_TOO_HIGH_MIN_CLICKS, "unit": ""},
        ]

    @property
    def actions(self) -> List[str]:
        return ["降低竞价", "优化关键词", "调整匹配类型"]

    def evaluate(self, db: Session, tenant_id: int, evaluation_date: date) -> List[RuleResult]:
        """评估规则，返回触发结果列表"""
        results: List[RuleResult] = []
        try:
            # clicks 为 Integer 类型，可在 SQL 中过滤
            records = (
                db.query(AdReportSnapshot)
                .filter(
                    AdReportSnapshot.tenant_id == tenant_id,
                    AdReportSnapshot.report_type == "campaign",
                    AdReportSnapshot.date == evaluation_date,
                    AdReportSnapshot.deleted_at.is_(None),
                    AdReportSnapshot.clicks >= RuleThresholds.CPC_TOO_HIGH_MIN_CLICKS,
                )
                .all()
            )

            threshold = RuleThresholds.CPC_TOO_HIGH_THRESHOLD
            min_clicks = RuleThresholds.CPC_TOO_HIGH_MIN_CLICKS

            for record in records:
                try:
                    cpc = float(record.cpc) if record.cpc is not None else 0.0
                    clicks = int(record.clicks) if record.clicks is not None else 0

                    # 条件: CPC > $1.5 (clicks 已在 SQL 中过滤)
                    if cpc > threshold:
                        condition_metrics = {
                            "cpc": round(cpc, 4),
                            "clicks": clicks,
                            "spend": float(record.spend) if record.spend is not None else 0.0,
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_name) if record.campaign_name else "",
                            target_name=record.campaign_name or "",
                            triggered=True,
                            current_value=round(cpc, 4),
                            threshold=threshold,
                            condition_metrics=condition_metrics,
                            suggestion_action=(
                                "降低竞价或优化关键词匹配方式，控制单次点击成本；"
                                "考虑使用精准匹配减少无效点击"
                            ),
                            suggestion_reason=(
                                f"CPC ${cpc:.2f} 超过阈值 ${threshold:.2f}，"
                                f"且点击量 {clicks} 达到门槛 {min_clicks}，"
                                f"点击成本偏高"
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
