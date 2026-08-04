"""
广告优化规则引擎常量定义

包含:
- RuleThresholds: 7 条规则的默认阈值
- HealthScoreThresholds: 健康分 6 维度阈值
"""
from dataclasses import dataclass


@dataclass
class RuleThresholds:
    """7条规则的默认阈值"""
    BUDGET_UNDER_SPEND_MIN_BUDGET = 30.0      # 预算下限
    BUDGET_UNDER_SPEND_RATIO = 0.50            # 花费/预算比率阈值
    ACOS_TOO_HIGH_THRESHOLD = 0.30             # ACOS上限
    ACOS_TOO_HIGH_MIN_SPEND = 10.0             # 最低花费门槛
    ROAS_TOO_LOW_THRESHOLD = 2.5               # ROAS下限
    ROAS_TOO_LOW_MIN_SPEND = 10.0
    CTR_LOW_THRESHOLD = 0.002                  # CTR下限 (0.2%)
    CTR_LOW_MIN_IMPRESSIONS = 1000
    CPC_TOO_HIGH_THRESHOLD = 1.5               # CPC上限
    CPC_TOO_HIGH_MIN_CLICKS = 10
    CVR_LOW_THRESHOLD = 0.05                   # CVR下限 (5%)
    CVR_LOW_MIN_CLICKS = 20
    BUDGET_UTILIZATION_LOW_THRESHOLD = 0.50    # 预算利用率下限


@dataclass
class HealthScoreThresholds:
    """健康分6维度阈值"""
    ACOS_EXCELLENT = 0.20
    ACOS_GOOD = 0.30
    ACOS_FAIR = 0.40
    ROAS_EXCELLENT = 4.0
    ROAS_GOOD = 3.0
    ROAS_FAIR = 2.5
    CTR_EXCELLENT = 0.008
    CTR_GOOD = 0.004
    CTR_FAIR = 0.002
    CVR_EXCELLENT = 0.12
    CVR_GOOD = 0.08
    CVR_FAIR = 0.05
    BUDGET_UTIL_EXCELLENT_MIN = 0.70
    BUDGET_UTIL_EXCELLENT_MAX = 0.90
    BUDGET_UTIL_GOOD_MIN = 0.50
    BUDGET_UTIL_GOOD_MAX = 1.00
    BUDGET_UTIL_FAIR_MIN = 0.30
    BUDGET_UTIL_FAIR_MAX = 1.10
    CPC_EXCELLENT = 0.8
    CPC_GOOD = 1.2
    CPC_FAIR = 1.8
