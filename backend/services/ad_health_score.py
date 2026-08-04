"""
广告健康分计算服务 - 100分制6维度

6 个维度及满分:
- ACOS:              25 分
- ROAS:              25 分
- CTR:               15 分
- CVR:               15 分
- 预算利用率:         10 分
- CPC:               10 分

四等级:
- 优秀: 90-100
- 良好: 70-89
- 一般: 50-69
- 差:   <50
"""
import logging
from datetime import date
from typing import Dict, Any, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.ad_daily import AdCampaignDaily
from services.ad_rules.constants import HealthScoreThresholds

logger = logging.getLogger(__name__)


class AdHealthScoreService:
    """广告健康分计算服务 - 100分制6维度"""

    DIMENSION_MAX = {
        "acos": 25,
        "roas": 25,
        "ctr": 15,
        "cvr": 15,
        "budget_utilization": 10,
        "cpc": 10,
    }

    # ==================== 公共方法 ====================

    def calculate_campaign(
        self,
        db: Session,
        tenant_id: int,
        campaign_id: str,
        evaluation_date: date,
    ) -> Dict[str, Any]:
        """
        计算单个活动健康分

        :param db: 数据库会话
        :param tenant_id: 租户ID
        :param campaign_id: 广告活动ID
        :param evaluation_date: 评估日期
        :return: 健康分结果 dict
        """
        try:
            record = (
                db.query(AdCampaignDaily)
                .filter(
                    AdCampaignDaily.tenant_id == tenant_id,
                    AdCampaignDaily.campaign_id == campaign_id,
                    AdCampaignDaily.date == evaluation_date,
                    AdCampaignDaily.deleted_at.is_(None),
                )
                .first()
            )

            if not record:
                logger.warning(
                    f"未找到活动数据 tenant_id={tenant_id} "
                    f"campaign_id={campaign_id} date={evaluation_date}"
                )
                return {
                    "score": 0,
                    "level": "无数据",
                    "dimensions": {},
                    "metrics": {},
                    "campaign_id": campaign_id,
                    "campaign_name": "",
                    "evaluation_date": str(evaluation_date),
                    "message": "未找到活动数据",
                }

            metrics = self._extract_metrics(record)
            result = self._calculate(metrics)
            result["campaign_id"] = campaign_id
            result["campaign_name"] = record.campaign_name or ""
            result["evaluation_date"] = str(evaluation_date)
            result["store_id"] = record.store_id

            logger.info(
                f"活动健康分计算完成 campaign_id={campaign_id} "
                f"score={result['score']} level={result['level']}"
            )
            return result

        except Exception as e:
            logger.error(
                f"计算活动健康分失败 tenant_id={tenant_id} "
                f"campaign_id={campaign_id} date={evaluation_date}: {e}",
                exc_info=True,
            )
            return {
                "score": 0,
                "level": "计算失败",
                "dimensions": {},
                "metrics": {},
                "campaign_id": campaign_id,
                "evaluation_date": str(evaluation_date),
                "error": str(e),
            }

    def calculate_overall(
        self,
        db: Session,
        tenant_id: int,
        evaluation_date: date,
    ) -> Dict[str, Any]:
        """
        计算整体账户健康分（聚合所有活动）

        :param db: 数据库会话
        :param tenant_id: 租户ID
        :param evaluation_date: 评估日期
        :return: 健康分结果 dict
        """
        try:
            result = (
                db.query(
                    func.coalesce(func.sum(AdCampaignDaily.spend), 0).label("total_spend"),
                    func.coalesce(func.sum(AdCampaignDaily.sales), 0).label("total_sales"),
                    func.coalesce(func.sum(AdCampaignDaily.impressions), 0).label("total_impressions"),
                    func.coalesce(func.sum(AdCampaignDaily.clicks), 0).label("total_clicks"),
                    func.coalesce(func.sum(AdCampaignDaily.orders), 0).label("total_orders"),
                    func.coalesce(func.sum(AdCampaignDaily.budget), 0).label("total_budget"),
                )
                .filter(
                    AdCampaignDaily.tenant_id == tenant_id,
                    AdCampaignDaily.date == evaluation_date,
                    AdCampaignDaily.deleted_at.is_(None),
                )
                .first()
            )

            if not result:
                logger.warning(
                    f"未找到账户数据 tenant_id={tenant_id} date={evaluation_date}"
                )
                return {
                    "score": 0,
                    "level": "无数据",
                    "dimensions": {},
                    "metrics": {},
                    "evaluation_date": str(evaluation_date),
                    "message": "未找到账户数据",
                }

            total_spend = float(result.total_spend or 0)
            total_sales = float(result.total_sales or 0)
            total_impressions = int(result.total_impressions or 0)
            total_clicks = int(result.total_clicks or 0)
            total_orders = int(result.total_orders or 0)
            total_budget = float(result.total_budget or 0)

            # 计算聚合派生指标
            metrics = {
                "acos": (total_spend / total_sales) if total_sales > 0 else 0.0,
                "roas": (total_sales / total_spend) if total_spend > 0 else 0.0,
                "ctr": (total_clicks / total_impressions) if total_impressions > 0 else 0.0,
                "cvr": (total_orders / total_clicks) if total_clicks > 0 else 0.0,
                "budget_utilization": (total_spend / total_budget) if total_budget > 0 else 0.0,
                "cpc": (total_spend / total_clicks) if total_clicks > 0 else 0.0,
            }

            score_result = self._calculate(metrics)
            score_result["evaluation_date"] = str(evaluation_date)
            score_result["aggregate"] = {
                "total_spend": round(total_spend, 2),
                "total_sales": round(total_sales, 2),
                "total_impressions": total_impressions,
                "total_clicks": total_clicks,
                "total_orders": total_orders,
                "total_budget": round(total_budget, 2),
            }

            logger.info(
                f"账户整体健康分计算完成 tenant_id={tenant_id} "
                f"score={score_result['score']} level={score_result['level']}"
            )
            return score_result

        except Exception as e:
            logger.error(
                f"计算账户整体健康分失败 tenant_id={tenant_id} "
                f"date={evaluation_date}: {e}",
                exc_info=True,
            )
            return {
                "score": 0,
                "level": "计算失败",
                "dimensions": {},
                "metrics": {},
                "evaluation_date": str(evaluation_date),
                "error": str(e),
            }

    # ==================== 核心计算 ====================

    def _calculate(self, metrics: Dict[str, float]) -> Dict[str, Any]:
        """
        核心计算：6维度各自评分后求和

        :param metrics: 包含 acos, roas, ctr, cvr, budget_utilization, cpc 的 dict
        :return: 健康分结果 dict
        """
        dimensions = {
            "acos": {
                "score": self._score_acos(metrics.get("acos", 0.0)),
                "max": self.DIMENSION_MAX["acos"],
                "value": round(metrics.get("acos", 0.0), 4),
            },
            "roas": {
                "score": self._score_roas(metrics.get("roas", 0.0)),
                "max": self.DIMENSION_MAX["roas"],
                "value": round(metrics.get("roas", 0.0), 4),
            },
            "ctr": {
                "score": self._score_ctr(metrics.get("ctr", 0.0)),
                "max": self.DIMENSION_MAX["ctr"],
                "value": round(metrics.get("ctr", 0.0), 4),
            },
            "cvr": {
                "score": self._score_cvr(metrics.get("cvr", 0.0)),
                "max": self.DIMENSION_MAX["cvr"],
                "value": round(metrics.get("cvr", 0.0), 4),
            },
            "budget_utilization": {
                "score": self._score_budget_util(metrics.get("budget_utilization", 0.0)),
                "max": self.DIMENSION_MAX["budget_utilization"],
                "value": round(metrics.get("budget_utilization", 0.0), 4),
            },
            "cpc": {
                "score": self._score_cpc(metrics.get("cpc", 0.0)),
                "max": self.DIMENSION_MAX["cpc"],
                "value": round(metrics.get("cpc", 0.0), 4),
            },
        }

        total_score = sum(d["score"] for d in dimensions.values())
        level = self._get_level(total_score)

        return {
            "score": total_score,
            "level": level,
            "dimensions": dimensions,
            "metrics": {k: round(v, 4) for k, v in metrics.items()},
        }

    def _get_level(self, score: float) -> str:
        """
        转换为四等级

        - 优秀: 90-100
        - 良好: 70-89
        - 一般: 50-69
        - 差:   <50
        """
        if score >= 90:
            return "优秀"
        elif score >= 70:
            return "良好"
        elif score >= 50:
            return "一般"
        else:
            return "差"

    # ==================== 6 个维度评分方法 ====================

    def _score_acos(self, acos: float) -> int:
        """
        ACOS 评分 (25分)
        - <20%:  25 (优秀)
        - 20-30%: 20 (良好)
        - 30-40%: 15 (一般)
        - >40%:   5 (差)
        """
        if acos <= 0:
            # 无花费或无销售，ACOS 无意义，给中等分
            return 15
        if acos < HealthScoreThresholds.ACOS_EXCELLENT:
            return 25
        elif acos < HealthScoreThresholds.ACOS_GOOD:
            return 20
        elif acos < HealthScoreThresholds.ACOS_FAIR:
            return 15
        else:
            return 5

    def _score_roas(self, roas: float) -> int:
        """
        ROAS 评分 (25分)
        - >4:    25 (优秀)
        - 3-4:   20 (良好)
        - 2.5-3: 15 (一般)
        - <2.5:   5 (差)
        """
        if roas <= 0:
            return 5
        if roas >= HealthScoreThresholds.ROAS_EXCELLENT:
            return 25
        elif roas >= HealthScoreThresholds.ROAS_GOOD:
            return 20
        elif roas >= HealthScoreThresholds.ROAS_FAIR:
            return 15
        else:
            return 5

    def _score_ctr(self, ctr: float) -> int:
        """
        CTR 评分 (15分)
        - >0.8%:   15 (优秀)
        - 0.4-0.8%: 12 (良好)
        - 0.2-0.4%:  8 (一般)
        - <0.2%:     3 (差)
        """
        if ctr >= HealthScoreThresholds.CTR_EXCELLENT:
            return 15
        elif ctr >= HealthScoreThresholds.CTR_GOOD:
            return 12
        elif ctr >= HealthScoreThresholds.CTR_FAIR:
            return 8
        else:
            return 3

    def _score_cvr(self, cvr: float) -> int:
        """
        CVR 评分 (15分)
        - >12%:   15 (优秀)
        - 8-12%:  12 (良好)
        - 5-8%:    8 (一般)
        - <5%:     3 (差)
        """
        if cvr >= HealthScoreThresholds.CVR_EXCELLENT:
            return 15
        elif cvr >= HealthScoreThresholds.CVR_GOOD:
            return 12
        elif cvr >= HealthScoreThresholds.CVR_FAIR:
            return 8
        else:
            return 3

    def _score_budget_util(self, util: float) -> int:
        """
        预算利用率评分 (10分)
        - 70-90%:  10 (优秀)
        - 50-100%:  8 (良好)
        - 30-110%:  5 (一般)
        - 其他:     2 (差)
        """
        # 优秀区间: 70%-90%
        if (HealthScoreThresholds.BUDGET_UTIL_EXCELLENT_MIN
                <= util <= HealthScoreThresholds.BUDGET_UTIL_EXCELLENT_MAX):
            return 10
        # 良好区间: 50%-100%
        elif (HealthScoreThresholds.BUDGET_UTIL_GOOD_MIN
                <= util <= HealthScoreThresholds.BUDGET_UTIL_GOOD_MAX):
            return 8
        # 一般区间: 30%-110%
        elif (HealthScoreThresholds.BUDGET_UTIL_FAIR_MIN
                <= util <= HealthScoreThresholds.BUDGET_UTIL_FAIR_MAX):
            return 5
        else:
            return 2

    def _score_cpc(self, cpc: float) -> int:
        """
        CPC 评分 (10分)
        - <$0.8:    10 (优秀)
        - $0.8-1.2:  8 (良好)
        - $1.2-1.8:  5 (一般)
        - >$1.8:     2 (差)
        """
        if cpc <= 0:
            return 5
        if cpc < HealthScoreThresholds.CPC_EXCELLENT:
            return 10
        elif cpc < HealthScoreThresholds.CPC_GOOD:
            return 8
        elif cpc < HealthScoreThresholds.CPC_FAIR:
            return 5
        else:
            return 2

    # ==================== 辅助方法 ====================

    def _extract_metrics(self, record: AdCampaignDaily) -> Dict[str, float]:
        """从 AdCampaignDaily 记录中提取 6 维度指标，DECIMAL 转 float"""
        spend = float(record.spend) if record.spend is not None else 0.0
        sales = float(record.sales) if record.sales is not None else 0.0
        clicks = int(record.clicks) if record.clicks is not None else 0
        impressions = int(record.impressions) if record.impressions is not None else 0
        orders = int(record.orders) if record.orders is not None else 0
        budget = float(record.budget) if record.budget is not None else 0.0

        # 优先使用表中已计算的派生指标，若为空则实时计算
        acos = float(record.acos) if record.acos is not None else (
            (spend / sales) if sales > 0 else 0.0
        )
        roas = float(record.roas) if record.roas is not None else (
            (sales / spend) if spend > 0 else 0.0
        )
        ctr = float(record.ctr) if record.ctr is not None else (
            (clicks / impressions) if impressions > 0 else 0.0
        )
        cvr = float(record.cvr) if record.cvr is not None else (
            (orders / clicks) if clicks > 0 else 0.0
        )
        budget_utilization = (
            float(record.budget_utilization)
            if record.budget_utilization is not None
            else ((spend / budget) if budget > 0 else 0.0)
        )
        cpc = float(record.cpc) if record.cpc is not None else (
            (spend / clicks) if clicks > 0 else 0.0
        )

        return {
            "acos": acos,
            "roas": roas,
            "ctr": ctr,
            "cvr": cvr,
            "budget_utilization": budget_utilization,
            "cpc": cpc,
        }
