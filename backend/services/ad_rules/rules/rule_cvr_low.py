"""
规则 6: CVR 过低 (CvrLowRule)

条件: CVR < 5% 且 clicks >= 20
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


class CvrLowRule(BaseOptimizationRule):
    """CVR 过低规则"""

    @property
    def name(self) -> str:
        return "cvr_low"

    @property
    def priority(self) -> str:
        return "中"

    @property
    def description(self) -> str:
        return "CVR 低于 5% 且点击量达到 20 门槛，转化率偏低"

    def evaluate(self, db: Session, tenant_id: int, evaluation_date: date) -> List[RuleResult]:
        """评估规则，返回触发结果列表"""
        results: List[RuleResult] = []
        try:
            # clicks 为 Integer 类型，可在 SQL 中过滤
            records = (
                db.query(AdCampaignDaily)
                .filter(
                    AdCampaignDaily.tenant_id == tenant_id,
                    AdCampaignDaily.date == evaluation_date,
                    AdCampaignDaily.deleted_at.is_(None),
                    AdCampaignDaily.clicks >= RuleThresholds.CVR_LOW_MIN_CLICKS,
                )
                .all()
            )

            threshold = RuleThresholds.CVR_LOW_THRESHOLD
            min_clicks = RuleThresholds.CVR_LOW_MIN_CLICKS

            for record in records:
                try:
                    cvr = float(record.cvr) if record.cvr is not None else 0.0
                    clicks = int(record.clicks) if record.clicks is not None else 0

                    # 条件: CVR < 5% (clicks 已在 SQL 中过滤)
                    if cvr < threshold:
                        condition_metrics = {
                            "cvr": round(cvr, 4),
                            "clicks": clicks,
                            "orders": int(record.orders) if record.orders is not None else 0,
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_id) if record.campaign_id else "",
                            target_name=record.campaign_name or "",
                            triggered=True,
                            current_value=round(cvr, 4),
                            threshold=threshold,
                            condition_metrics=condition_metrics,
                            suggestion_action=(
                                "检查落地页相关性与 Listing 质量，优化产品详情页；"
                                "调整关键词精准度，排除低转化流量"
                            ),
                            suggestion_reason=(
                                f"CVR {cvr * 100:.1f}% 低于阈值 {threshold * 100:.0f}%，"
                                f"且点击量 {clicks} 达到门槛 {min_clicks}，"
                                f"转化率偏低"
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
