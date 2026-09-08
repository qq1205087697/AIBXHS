"""
广告优化规则基类定义

提供:
- RuleResult: 规则评估结果数据类
- BaseOptimizationRule: 优化规则抽象基类
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import date
from sqlalchemy.orm import Session


@dataclass
class RuleResult:
    """规则评估结果"""
    rule_name: str
    rule_priority: str  # 高/中
    target_type: str    # campaign/keyword/search_term/product
    target_id: str
    target_name: str
    triggered: bool
    current_value: float
    threshold: float
    condition_metrics: dict = field(default_factory=dict)
    suggestion_action: str = ""
    suggestion_reason: str = ""
    store_id: Optional[int] = None


class BaseOptimizationRule(ABC):
    """优化规则抽象基类"""
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def priority(self) -> str:
        pass  # 高/中

    @property
    @abstractmethod
    def description(self) -> str:
        pass

    @property
    def rule_type(self) -> str:
        """规则类型：adjust_bid/pause/add_negative/increase_budget/optimization"""
        return "optimization"

    @property
    def conditions(self) -> List[Dict[str, Any]]:
        """触发条件元信息（用于前端展示与编辑）

        返回格式: [{"metric": "acos", "operator": ">", "threshold": 0.30, "unit": "%"}]
        子类应覆盖此属性以暴露可编辑的阈值
        """
        return []

    @property
    def actions(self) -> List[str]:
        """执行动作列表（用于前端展示）"""
        return []

    @abstractmethod
    def evaluate(self, db: Session, tenant_id: int, evaluation_date: date) -> List[RuleResult]:
        """评估规则，返回触发结果列表"""
        pass
