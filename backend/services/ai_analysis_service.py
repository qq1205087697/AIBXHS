import json
import logging
import asyncio
from typing import Dict, Any, Optional, Tuple
from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


# ========== Prompt 模板 ==========

def _build_seasonality_prompt(product_data: Dict[str, Any]) -> str:
    title = product_data.get('product_title', '未知')
    trend = product_data.get('traffic_trend', '未知')

    return f"""你是一个跨境电商数据分析专家，擅长根据产品流量趋势判断季节性和销售规律。 
 你接收的输入是某个产品的每日/每周/每月流量数据（可为访问量、搜索量、点击量等），格式为时间序列。 
 你的任务是： 
 1. 判断产品是否具有季节性（高峰期是否集中在特定月份/节日）。 
 2. 如果有季节性，指出高峰月份或周期。 
 3. 说明季节性强度（如高、中、低）。 
 4. 给出简要的原因分析（例如节日、气候、促销活动）。 
 5. 输出格式严格为 JSON： 
 {{ 
   "是否季节性": "是/否", 
   "季节性强度": "高/中/低/无", 
   "高峰期": ["月份1", "月份2", ...], 
   "分析理由": "简要说明原因" 
 }} 
 不要额外输出其他信息。 
 产品名称：{title} 
 流量趋势：{trend}
"""



def _build_infringement_prompt(product_data: Dict[str, Any]) -> str:
    title = product_data.get('product_title', '未知')
    img = product_data.get('image_url', '无图片')

    return f"""# 角色 
 你是一名跨境电商产品侵权风险分析专家，熟悉亚马逊、美国专利、欧盟知识产权、版权、商标等规则。 
 
 # 输出要求 
 - 你必须基于输入的标题、图片、产品描述进行侵权风险分析。 
 - 不能幻想信息，不能创造不存在的侵权点，所有判断必须基于输入内容。 
 - 输出必须使用我提供的 JSON 模板，不得使用代码块，不得包含多余内容。 
 - 每一个风险点都必须给出对应的证据，证据必须能证明实际的侵权可能（如图片中出现的知名卡通形象、刻意模仿的品牌特征），不能仅凭"标题中出现某品牌词"作为风险证据。 
 - 如果信息不足以判断，你必须说明"不足以判断"并给出建议补充材料。 
 
 # 禁止 
 - 不得给出法律建议，仅能给出侵权"可能性"和"风险等级"。 
 - 不得输出 Markdown 或代码框，只能纯 JSON。 
 # 输入数据 
 标题：{title} 
 图片：{img} 
 
 # 任务 
 请分析该产品是否存在以下侵权风险： 
 1. 商标侵权（Trademark） 
 2. 版权侵权（Copyright） 
 3. 外观专利侵权（Design Patent） 
 4. 实用专利侵权（Utility Patent） 
 5. 品牌暗示（使用了可能让人误认为知名品牌的风格/图案/文字） 
 
 # 商标侵权判定规则（必须严格遵守，防止误判） 
 标题中出现品牌名称≠商标侵权，必须先区分使用性质： 
 - 兼容/配件表述（如 "for XXX"、"Compatible with XXX"、"Fit for XXX"、"Replacement for XXX"、"Suitable for XXX"）：属于合法的指示性使用，商标评分只能在 0-30 之间。 
 - 正品转售（标题描述的商品本身就是该品牌商品，如某品牌胶卷、某品牌手表）：正品销售一般不构成商标侵权，商标评分只能在 0-20 之间。 
 - 卖家自有品牌或不知名小品牌（无广泛公众认知）：不构成商标侵权风险，商标评分只能在 0-15 之间。 
 - 只有当出现【知名第三方品牌】（如 Disney、Marvel、Apple、Nike、Barbie、Hello Kitty 等具有广泛公众认知度的品牌），且该商品并非正品、也非兼容/配件说明、无任何授权迹象，甚至刻意模仿品牌风格（品牌暗示/仿冒）时，才能给出高风险评分（60-100）。 
 - 如果无法确认某品牌是否为知名品牌，按不知名小品牌处理，商标单项评分不得超过 40。 
 - "无法判断"不能作为高风险依据：凡主要依据为"无法判断/不足以确认"时，商标评分不得超过 40。 
 
 # 评分总体要求 
 - 评分必须基于确凿证据，推测和"可能性"不得推高评分。 
 - 各类型评分互相独立，未被证据支持的类型评分应为 0-10。 
 - 总体风险评分应贴近有确凿证据的最高单项，而不是各项猜测的累加。 
 
 请基于输入内容给出侵权风险评分（0–100），并生成风险原因列表。 
 
 # JSON 输出模板（必须严格使用此格式） 
 {{ 
   "总体风险等级": "低 / 中 / 高", 
   "总体风险评分": 数字（0-100）, 
 
   "侵权类型分析": {{ 
     "商标侵权": {{ 
       "风险评分": 数字, 
       "是否可能侵权": "是/否/无法判断", 
       "证据": ["标题中出现...", "图片中看到..."] 
     }}, 
     "版权侵权": {{ 
       "风险评分": 数字, 
       "是否可能侵权": "是/否/无法判断", 
       "证据": ["图案类似某动画...", "卡通形象..."] 
     }}, 
     "外观专利侵权": {{ 
       "风险评分": 数字, 
       "是否可能侵权": "是/否/无法判断", 
       "证据": ["结构形状类似...", "不足以判断"] 
     }}, 
     "实用专利侵权": {{ 
       "风险评分": 数字, 
       "是否可能侵权": "是/否/无法判断", 
       "证据": ["产品功能特殊...", "无法判断"] 
     }}
   }}, 
   "最终结论总结": "一句话总结该产品是否存在明显或潜在侵权风险。" 
 }}
"""


# ========== OpenAI 调用 ==========

def _call_openai_sync(system_prompt: str, user_prompt: str) -> Optional[str]:
    """同步调用OpenAI接口（在线程池中运行，不阻塞事件循环）"""
    from openai import OpenAI

    if not settings.OPENAI_API_KEY:
        logger.error("OpenAI API Key 未配置")
        return None

    client = OpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_API_BASE,
    )

    response = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        timeout=120,
    )

    answer_text = response.choices[0].message.content.strip() if response.choices else ""
    if not answer_text:
        logger.warning("OpenAI返回空内容")
        return None

    logger.debug(f"OpenAI 响应: {answer_text[:200]}...")
    return answer_text


async def _call_openai(system_prompt: str, user_prompt: str) -> Optional[str]:
    """异步调用OpenAI接口，通过线程池避免阻塞事件循环"""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_call_openai_sync, system_prompt, user_prompt),
            timeout=180,
        )
    except asyncio.TimeoutError:
        logger.error("OpenAI 调用超时（180秒）")
        return None
    except Exception as e:
        logger.error(f"OpenAI 调用失败: {e}")
        return None


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """从文本中提取JSON"""
    if not text:
        return None

    text = text.strip()

    # 去掉 markdown 代码块包裹
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().endswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试正则提取 JSON 对象
    import re
    json_match = re.search(r'\{[\s\S]*\}', text)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    logger.error(f"无法解析AI响应为JSON: {text[:300]}")
    return None


# ========== 分析入口 ==========

async def analyze_product_selection(product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """选品AI分析主入口：侵权分析（流量评分由公式计算，不经过AI）"""
    results = {}

    # 1. 侵权分析（唯一需要AI调用的部分）
    logger.info("开始侵权分析...")
    infringement_resp = await _call_openai(
        "你是跨境电商产品侵权风险分析专家。只输出纯JSON，不要输出Markdown或代码框。",
        _build_infringement_prompt(product_data),
    )
    infringement_data = _extract_json(infringement_resp) if infringement_resp else None
    if infringement_data:
        results["infringement_analysis"] = json.dumps(infringement_data, ensure_ascii=False, indent=2)
        results["infringement_conclusion"] = infringement_data.get("最终结论总结", "")
        infr_score = int(infringement_data.get("总体风险评分", 100)) or 100
    else:
        results["infringement_analysis"] = ""
        results["infringement_conclusion"] = ""
        infr_score = 100

    logger.info(f"侵权分析完成，总体风险评分: {infr_score}")

    # 2. 季节性分析：仅当侵权评分 < 75 时才进行
    if infr_score < 75:
        logger.info(f"侵权评分({infr_score}) < 75，继续进行季节性分析")
        seasonality_resp = await _call_openai(
            "你是专业的跨境电商数据分析专家。所有分析结果必须使用中文输出。只输出JSON，不要输出其他内容。",
            _build_seasonality_prompt(product_data),
        )
        seasonality_data = _extract_json(seasonality_resp) if seasonality_resp else None
        if seasonality_data:
            results["seasonality"] = json.dumps(seasonality_data, ensure_ascii=False)
        else:
            results["seasonality"] = ""
    else:
        logger.info(f"侵权评分({infr_score}) >= 75，跳过季节性分析（产品存在较高侵权风险）")
        results["seasonality"] = json.dumps({
            "是否季节性": "跳过",
            "季节性强度": "无",
            "高峰期": [],
            "分析理由": f"该产品侵权风险评分为{infr_score}（>=75），属于高风险产品，跳过季节性分析"
        }, ensure_ascii=False)

    return results
