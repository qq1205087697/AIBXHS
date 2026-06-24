"""
广告优化规则集合

7 条规则:
1. BudgetUnderSpendRule - 预算花费不足
2. AcosTooHighRule - ACOS 过高
3. RoasTooLowRule - ROAS 过低
4. CtrLowRule - CTR 过低
5. CpcTooHighRule - CPC 过高
6. CvrLowRule - CVR 过低
7. BudgetUtilizationLowRule - 预算利用率过低
"""
from services.ad_rules.rules.rule_budget_under_spend import BudgetUnderSpendRule
from services.ad_rules.rules.rule_acos_too_high import AcosTooHighRule
from services.ad_rules.rules.rule_roas_too_low import RoasTooLowRule
from services.ad_rules.rules.rule_ctr_low import CtrLowRule
from services.ad_rules.rules.rule_cpc_too_high import CpcTooHighRule
from services.ad_rules.rules.rule_cvr_low import CvrLowRule
from services.ad_rules.rules.rule_budget_utilization_low import BudgetUtilizationLowRule

__all__ = [
    "BudgetUnderSpendRule",
    "AcosTooHighRule",
    "RoasTooLowRule",
    "CtrLowRule",
    "CpcTooHighRule",
    "CvrLowRule",
    "BudgetUtilizationLowRule",
]
