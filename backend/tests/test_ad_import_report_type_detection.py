"""
广告报表类型识别 TDD 测试

业务规则（参见 services/ad_import_service.py:_detect_report_type）:
    5 个生产 Excel 文件都包含"广告活动"列（作为外键），但报告类型不同。
    _detect_report_type 必须按"主体字段"识别，而非"外键字段"。

生产文件表头（实测）:
    1. 广告活动数据.xlsx: 主体=广告活动（campaign），无"广告"列
    2. 关键词数据.xlsx:    主体=关键词（keyword）
    3. 搜索词数据.xlsx:    主体=搜索词（search_term）
    4. 商品投放数据.xlsx:  主体=商品投放（product）
    5. 广告数据.xlsx:      主体=广告（product，"广告"列存 ASIN/SKU）

当前缺陷：
    广告数据.xlsx 同时含"广告活动"和"广告"，因检测顺序中"广告活动"
    先于"广告"，被误判为 campaign，导致数据被写入 AdCampaignDaily
    而非 AdProductDaily。

修复方案：
    调整检测优先级，"广告"列优先于"广告活动"列；并要求"广告活动"列
    存在但无其他主体字段时才识别为 campaign。
"""
from __future__ import annotations

import sys
import os
from typing import List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from services.ad_import_service import _detect_report_type


# ==================== 生产 Excel 实测表头 ====================
# 从实际 5 个文件中读取的列名（去除空格差异）

PROD_HEADERS = {
    "广告活动数据": [
        "站点/店铺", "广告活动", "状态", "服务状态", "广告类型", "开始时间",
        "预算", "预算使用比例", "广告花费", "广告花费占比", "曝光",
        "搜索结果首页首位(IS)", "点击", "CPC", "广告订单", "广告销量",
        "广告销售额", "CVR", "ACOS", "CPO", "竞价优化", "广告组合",
        "竞价策略", "listing浏览量",
    ],
    "关键词数据": [
        "站点/店铺", "关键词", "状态", "匹配类型", "服务状态", "竞价",
        "建议竞价", "基准值", "广告活动", "ABA日排名", "广告花费", "曝光",
        "搜索结果首页首位(IS)", "点击", "CTR", "CPC", "广告订单",
        "广告销量", "广告销售额", "CVR", "ACOS", "ROAS", "CPO", "广告花费占比",
    ],
    "搜索词数据": [
        "站点/店铺", "搜索词", "搜索词来源", "匹配类型", "广告活动",
        "ABA日排名", "广告花费", "曝光", "点击", "CTR", "CPC",
        "广告订单", "广告销量", "广告销售额", "CVR", "ACOS", "ROAS",
        "CPO", "广告花费占比",
    ],
    "商品投放数据": [
        "站点/店铺", "商品投放", "状态", "服务状态", "竞价", "建议竞价",
        "基准值", "广告活动", "广告花费", "曝光", "搜索结果首页首位(IS)",
        "点击", "CTR", "CPC", "广告订单", "广告销量", "广告销售额",
        "CVR", "ACOS", "ROAS", "CPO", "广告花费占比",
    ],
    "广告数据": [
        "站点/店铺", "广告", "状态", "服务状态", "SPV视频", "价格",
        "评分", "评分数", "广告类型", "广告活动", "FBM可售", "FBA可用库存",
        "广告花费", "曝光", "点击", "CTR", "CPC", "广告订单",
        "广告销量", "广告销售额", "CVR", "ACOS", "ROAS", "CPO", "广告花费占比",
    ],
}


# ==================== 测试：5 个生产文件正确识别 ====================

class TestProdFileDetection:
    """5 个生产 Excel 文件必须识别为正确的报告类型"""

    def test_campaign_file_detected_as_campaign(self):
        """广告活动数据.xlsx → campaign"""
        assert _detect_report_type(PROD_HEADERS["广告活动数据"]) == "campaign", (
            "广告活动数据.xlsx 应识别为 campaign"
        )

    def test_keyword_file_detected_as_keyword(self):
        """关键词数据.xlsx → keyword"""
        assert _detect_report_type(PROD_HEADERS["关键词数据"]) == "keyword", (
            "关键词数据.xlsx 应识别为 keyword"
        )

    def test_search_term_file_detected_as_search_term(self):
        """搜索词数据.xlsx → search_term"""
        assert _detect_report_type(PROD_HEADERS["搜索词数据"]) == "search_term", (
            "搜索词数据.xlsx 应识别为 search_term"
        )

    def test_product_targeting_file_detected_as_product(self):
        """商品投放数据.xlsx → product"""
        assert _detect_report_type(PROD_HEADERS["商品投放数据"]) == "product", (
            "商品投放数据.xlsx 应识别为 product"
        )

    def test_ad_data_file_detected_as_product(self):
        """广告数据.xlsx → product（关键缺陷：当前被误判为 campaign）

        广告数据.xlsx 的"广告"列存的是 ASIN/SKU（如 B0C4GHGWRC/USA-A-341），
        属于商品投放报告的变体，应识别为 product。
        """
        assert _detect_report_type(PROD_HEADERS["广告数据"]) == "product", (
            "广告数据.xlsx 应识别为 product（含'广告'列即 ASIN/SKU），"
            "当前被误判为 campaign"
        )


# ==================== 测试：检测优先级 ====================

class TestDetectionPriority:
    """检测优先级：主体字段 > 外键字段"""

    def test_ad_column_takes_priority_over_campaign(self):
        """同时含'广告'和'广告活动'时，应识别为 product（'广告'是主体）"""
        cols = ["站点/店铺", "广告", "广告活动", "广告花费", "点击"]
        assert _detect_report_type(cols) == "product", (
            "同时含'广告'+'广告活动'时应识别为 product"
        )

    def test_campaign_alone_detected_as_campaign(self):
        """只有'广告活动'列（无其他主体字段）时识别为 campaign"""
        cols = ["站点/店铺", "广告活动", "广告花费", "曝光", "点击", "CPC"]
        assert _detect_report_type(cols) == "campaign"

    def test_search_term_takes_priority_over_campaign(self):
        """同时含'搜索词'和'广告活动'时，应识别为 search_term"""
        cols = ["站点/店铺", "搜索词", "广告活动", "广告花费"]
        assert _detect_report_type(cols) == "search_term"

    def test_keyword_takes_priority_over_campaign(self):
        """同时含'关键词'和'广告活动'时，应识别为 keyword"""
        cols = ["站点/店铺", "关键词", "广告活动", "广告花费"]
        assert _detect_report_type(cols) == "keyword"

    def test_product_targeting_takes_priority_over_campaign(self):
        """同时含'商品投放'和'广告活动'时，应识别为 product"""
        cols = ["站点/店铺", "商品投放", "广告活动", "广告花费"]
        assert _detect_report_type(cols) == "product"


# ==================== 测试：兜底场景 ====================

class TestFallbackScenarios:
    """无主体字段时的兜底识别"""

    def test_empty_columns_defaults_to_campaign(self):
        """空列名列表默认 campaign"""
        assert _detect_report_type([]) == "campaign"

    def test_only_metric_columns_defaults_to_campaign(self):
        """只有指标列（无主体字段）默认 campaign"""
        cols = ["广告花费", "曝光", "点击", "CPC", "ACOS"]
        assert _detect_report_type(cols) == "campaign"

    def test_english_columns_supported(self):
        """英文表头也应支持"""
        assert _detect_report_type(
            ["campaign_name", "impressions", "clicks", "spend"]
        ) == "campaign"
        assert _detect_report_type(
            ["keyword", "campaign_name", "impressions"]
        ) == "keyword"
        assert _detect_report_type(
            ["search_term", "campaign_name", "impressions"]
        ) == "search_term"
        assert _detect_report_type(
            ["advertised_asin", "campaign_name", "impressions"]
        ) == "product"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
