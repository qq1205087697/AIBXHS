#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在途字段（发货日期 / 运输方式）的缺失判定规则

导入解析与补填通知共用同一份规则，避免两处判定不一致：
- 导入侧：把占位符（如 "-"）归一为 None，不写脏值
- 通知侧：SQL 用同一份占位符清单判定缺失

注意：SQL 侧无法调用本模块函数，`collect_missing_fba` 使用 PLACEHOLDER_VALUES
拼接参数化 IN 条件，两处必须保持同源（都引用本模块常量）。
"""

from typing import Optional

# 源报表 / 飞书里表示「未填」的常见写法（比较时统一 lower）
PLACEHOLDER_VALUES = frozenset({
    "-", "—", "–", "－", "/", "\\", "无", "空", "未填", "待定", "tbd",
    "n/a", "na", "null", "none",
})

TRANSPORT_FIELD_LABEL = "运输方式"
SHIP_DATE_FIELD_LABEL = "发货日期"


def normalize_transport(value) -> Optional[str]:
    """占位符 / 空白 → None；其余 strip 后返回。"""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in PLACEHOLDER_VALUES:
        return None
    return s


def is_blank_transport(value) -> bool:
    """运输方式是否视为未填（None / 空串 / 占位符）。"""
    return normalize_transport(value) is None


def sql_placeholder_args() -> list:
    """给 SQL 的 IN 条件用；保持 list 稳定顺序便于测试断言。"""
    return sorted(PLACEHOLDER_VALUES)
