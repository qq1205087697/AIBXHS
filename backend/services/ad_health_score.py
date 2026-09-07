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
import math
from datetime import date
from typing import Dict, Any, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.ad_report import AdReportSnapshot
from services.ad_rules.constants import HealthScoreThresholds

logger = logging.getLogger(__name__)


def _safe_float(value, default: float = 0.0) -> float:
    """将 value 转 float，遇到 None/NaN/Inf 时返回 default。

    用于清洗上游 ETL 可能写入的脏数据（NaN/Inf），保证下游计算与
    JSON 序列化不污染。
    """
    if value is None:
        return default
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(f) or math.isinf(f):
        return default
    return f


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
                db.query(AdReportSnapshot)
                .filter(
                    AdReportSnapshot.tenant_id == tenant_id,
                    AdReportSnapshot.report_type == "campaign",
                    AdReportSnapshot.campaign_name == campaign_id,  # campaign_id 参数实际传入 campaign_name
                    AdReportSnapshot.date == evaluation_date,
                    AdReportSnapshot.deleted_at.is_(None),
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
                    func.coalesce(func.sum(AdReportSnapshot.spend), 0).label("total_spend"),
                    func.coalesce(func.sum(AdReportSnapshot.sales), 0).label("total_sales"),
                    func.coalesce(func.sum(AdReportSnapshot.impressions), 0).label("total_impressions"),
                    func.coalesce(func.sum(AdReportSnapshot.clicks), 0).label("total_clicks"),
                    func.coalesce(func.sum(AdReportSnapshot.orders), 0).label("total_orders"),
                )
                .filter(
                    AdReportSnapshot.tenant_id == tenant_id,
                    AdReportSnapshot.report_type == "campaign",
                    AdReportSnapshot.date == evaluation_date,
                    AdReportSnapshot.deleted_at.is_(None),
                )
                .first()
            )

            # 反推总预算：spend / budget_utilization（仅当 budget_utilization > 0 时有效）
            budget_records = (
                db.query(
                    func.sum(AdReportSnapshot.spend).label("spend_sum"),
                    func.avg(AdReportSnapshot.budget_utilization).label("avg_util"),
                )
                .filter(
                    AdReportSnapshot.tenant_id == tenant_id,
                    AdReportSnapshot.report_type == "campaign",
                    AdReportSnapshot.date == evaluation_date,
                    AdReportSnapshot.budget_utilization > 0,
                    AdReportSnapshot.deleted_at.is_(None),
                )
                .first()
            )
            total_budget = 0.0
            if budget_records and budget_records.avg_util and float(budget_records.avg_util) > 0:
                total_spend_for_budget = float(budget_records.spend_sum or 0)
                total_budget = total_spend_for_budget / float(budget_records.avg_util)

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
        # 防御性清洗：保证 NaN/Inf 不进入评分与结果（防止 JSON 序列化失败）
        safe_metrics = {k: _safe_float(v) for k, v in metrics.items()}

        dimensions = {
            "acos": {
                "score": self._score_acos(safe_metrics.get("acos", 0.0)),
                "max": self.DIMENSION_MAX["acos"],
                "value": round(safe_metrics.get("acos", 0.0), 4),
            },
            "roas": {
                "score": self._score_roas(safe_metrics.get("roas", 0.0)),
                "max": self.DIMENSION_MAX["roas"],
                "value": round(safe_metrics.get("roas", 0.0), 4),
            },
            "ctr": {
                "score": self._score_ctr(safe_metrics.get("ctr", 0.0)),
                "max": self.DIMENSION_MAX["ctr"],
                "value": round(safe_metrics.get("ctr", 0.0), 4),
            },
            "cvr": {
                "score": self._score_cvr(safe_metrics.get("cvr", 0.0)),
                "max": self.DIMENSION_MAX["cvr"],
                "value": round(safe_metrics.get("cvr", 0.0), 4),
            },
            "budget_utilization": {
                "score": self._score_budget_util(safe_metrics.get("budget_utilization", 0.0)),
                "max": self.DIMENSION_MAX["budget_utilization"],
                "value": round(safe_metrics.get("budget_utilization", 0.0), 4),
            },
            "cpc": {
                "score": self._score_cpc(safe_metrics.get("cpc", 0.0)),
                "max": self.DIMENSION_MAX["cpc"],
                "value": round(safe_metrics.get("cpc", 0.0), 4),
            },
        }

        total_score = sum(d["score"] for d in dimensions.values())
        level = self._get_level(total_score)

        return {
            "score": total_score,
            "level": level,
            "dimensions": dimensions,
            "metrics": {k: round(v, 4) for k, v in safe_metrics.items()},
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

    def _extract_metrics(self, record: AdReportSnapshot) -> Dict[str, float]:
        """从 AdReportSnapshot 记录中提取 6 维度指标，DECIMAL 转 float。

        使用 _safe_float 清洗 NaN/Inf，防止上游 ETL 脏数据污染结果。
        """
        spend = _safe_float(record.spend)
        sales = _safe_float(record.sales)
        clicks = int(_safe_float(record.clicks))
        impressions = int(_safe_float(record.impressions))
        orders = int(_safe_float(record.orders))
        # AdReportSnapshot 没有 budget 字段，使用 budget_utilization 反推
        budget_utilization_val = _safe_float(record.budget_utilization)
        budget = (spend / budget_utilization_val) if budget_utilization_val > 0 else 0.0

        # 优先使用表中已计算的派生指标，若为空则实时计算（_safe_float 处理 None/NaN/Inf）
        acos = _safe_float(record.acos) if record.acos is not None else (
            (spend / sales) if sales > 0 else 0.0
        )
        roas = _safe_float(record.roas) if record.roas is not None else (
            (sales / spend) if spend > 0 else 0.0
        )
        ctr = _safe_float(record.ctr) if record.ctr is not None else (
            (clicks / impressions) if impressions > 0 else 0.0
        )
        cvr = _safe_float(record.cvr) if record.cvr is not None else (
            (orders / clicks) if clicks > 0 else 0.0
        )
        budget_utilization = (
            _safe_float(record.budget_utilization)
            if record.budget_utilization is not None
            else ((spend / budget) if budget > 0 else 0.0)
        )
        cpc = _safe_float(record.cpc) if record.cpc is not None else (
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
