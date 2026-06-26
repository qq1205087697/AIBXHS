# 临时存根，用于启动服务器
import logging

logger = logging.getLogger(__name__)


def translate_review(title: str, content: str) -> tuple:
    """临时翻译函数，直接返回原文"""
    logger.warning("translate_service 未加载完整，返回原文")
    return title, content