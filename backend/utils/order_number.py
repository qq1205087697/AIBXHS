"""单号生成工具函数"""
from datetime import datetime


def generate_replenishment_order_number() -> str:
    """生成补货单号：RO + 年月日时分秒 + 3位毫秒"""
    now = datetime.now()
    ms = now.microsecond // 1000
    return f"RO{now.strftime('%Y%m%d%H%M%S')}{ms:03d}"
