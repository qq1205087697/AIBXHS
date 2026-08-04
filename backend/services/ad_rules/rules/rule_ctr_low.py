"""
规则 4: CTR 过低 (CtrLowRule)

条件: CTR < 0.2% 且 impressions >= 1000
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


class CtrLowRule(BaseOptimizationRule):
    """CTR 过低规则"""

    @property
    def name(self) -> str:
        return "ctr_low"

    @property
    def priority(self) -> str:
        return "中"

    @property
    def description(self) -> str:
        return "CTR 低于 0.2% 且曝光量达到 1000 门槛，广告点击率偏低"

    def evaluate(self, db: Session, tenant_id: int, evaluation_date: date) -> List[RuleResult]:
        """评估规则，返回触发结果列表"""
        results: List[RuleResult] = []
        try:
            # impressions 为 Integer 类型，可在 SQL 中过滤
            records = (
                db.query(AdCampaignDaily)
                .filter(
                    AdCampaignDaily.tenant_id == tenant_id,
                    AdCampaignDaily.date == evaluation_date,
                    AdCampaignDaily.deleted_at.is_(None),
                    AdCampaignDaily.impressions >= RuleThresholds.CTR_LOW_MIN_IMPRESSIONS,
                )
                .all()
            )

            threshold = RuleThresholds.CTR_LOW_THRESHOLD
            min_impressions = RuleThresholds.CTR_LOW_MIN_IMPRESSIONS

            for record in records:
                try:
                    ctr = float(record.ctr) if record.ctr is not None else 0.0
                    impressions = int(record.impressions) if record.impressions is not None else 0

                    # 条件: CTR < 0.2% (impressions 已在 SQL 中过滤)
                    if ctr < threshold:
                        condition_metrics = {
                            "ctr": round(ctr, 4),
                            "impressions": impressions,
                            "clicks": int(record.clicks) if record.clicks is not None else 0,
                        }
                        results.append(RuleResult(
                            rule_name=self.name,
                            rule_priority=self.priority,
                            target_type="campaign",
                            target_id=str(record.campaign_id) if record.campaign_id else "",
                            target_name=record.campaign_name or "",
                            triggered=True,
                            current_value=round(ctr, 4),
                            threshold=threshold,
                            condition_metrics=condition_metrics,
                            suggestion_action=(
                                "优化广告创意、主图和标题，提升广告点击吸引力；"
                                "检查关键词与产品的相关性"
                            ),
                            suggestion_reason=(
                                f"CTR {ctr * 100:.2f}% 低于阈值 {threshold * 100:.1f}%，"
                                f"且曝光量 {impressions} 达到门槛 {min_impressions}，"
                                f"广告点击率偏低"
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
