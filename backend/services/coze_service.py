import json
import logging
import httpx
from typing import Dict, Any, Optional
from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _build_analysis_prompt(product_data: Dict[str, Any]) -> str:
    return f"""请对以下亚马逊/跨境电商产品进行多维度的选品分析，并给出评分和判断：

【产品标题】：{product_data.get('product_title', '未知')}
【ASIN】：{product_data.get('asin', '未知')}
【URL】：{product_data.get('url', '未知')}
【关键词】：{product_data.get('keywords', '未知')}
【评分】：{product_data.get('rating', '未知')}星
【评论数】：{product_data.get('review_count', '未知')}条
【价格】：${product_data.get('price', '未知')}
【佣金】：${product_data.get('commission', '未知')}
【头程】：${product_data.get('first_leg_cost', '未知')}
【尾程】：${product_data.get('last_mile_cost', '未知')}
【重量】：{product_data.get('weight_kg', '未知')}kg
【15%毛利时成本】：${product_data.get('cost_at_15_profit', '未知')}
【类型】：{product_data.get('product_type', '未知')}
【近一个月销量】：{product_data.get('monthly_sales', '未知')}件
【流量趋势】：{product_data.get('traffic_trend', '未知')}

请从以下维度进行专业分析（每项评分满分10分，惩罚因子取值1-10，综合评分满分10分）：
1. 季节性判断：分析该产品是否具有明显的季节性特征
2. 侵权分析：评估该产品是否存在外观、专利、商标等侵权风险
3. 侵权分析结论：简洁总结侵权风险结论
4. 流量评分结果：解释流量评分的依据
5. 流量评分：根据流量趋势评估市场热度（0-10分）
6. 销量评分：根据近一个月销量评估销售表现（0-10分）
7. 星级评分：根据产品评分评估口碑（0-10分）
8. 惩罚因子：若有负面因素（如退货率高、差评多等）给予惩罚（1-10分）
9. 综合评分：综合所有维度给出最终评分（0-10分）

请严格按照以下JSON格式输出（不要输出其他内容）：
{{
    "seasonality": "季节性分析结论",
    "infringement_analysis": "侵权分析详细内容",
    "infringement_conclusion": "侵权分析结论",
    "traffic_score_result": "流量评分结果说明",
    "traffic_score": 8.5,
    "sales_score": 7.2,
    "rating_score": 9.0,
    "penalty_factor": 1.0,
    "composite_score": 8.1
}}
"""


async def analyze_product_selection(product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not settings.COZE_API_KEY:
        logger.warning("Coze API Key 未配置，使用本地OpenAI代替")
        return await _analyze_with_openai(product_data)

    return await _analyze_with_coze(product_data)


async def _analyze_with_coze(product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        prompt = _build_analysis_prompt(product_data)

        headers = {
            "Authorization": f"Bearer {settings.COZE_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        payload = {
            "bot_id": settings.COZE_BOT_ID,
            "user": "product_selection",
            "query": prompt,
            "stream": False
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{settings.COZE_API_BASE}/open_api/v2/chat",
                json=payload,
                headers=headers
            )

            if response.status_code != 200:
                logger.error(f"Coze API 请求失败: {response.status_code} {response.text}")
                logger.info("Coze调用失败，回退到OpenAI")
                return await _analyze_with_openai(product_data)

            result = response.json()
            logger.debug(f"Coze API 原始响应: {json.dumps(result, ensure_ascii=False)[:500]}")

            messages = result.get("messages", [])
            answer_text = ""
            for msg in messages:
                if msg.get("role") == "assistant" and msg.get("type") == "answer":
                    answer_text = msg.get("content", "")
                    break

            if not answer_text:
                chat_id = result.get("conversation_id")
                if chat_id:
                    answer_text = await _get_coze_chat_result(chat_id)
                if not answer_text:
                    logger.warning("Coze未返回有效答案，回退到OpenAI")
                    return await _analyze_with_openai(product_data)

            return _parse_ai_response(answer_text)

    except Exception as e:
        logger.error(f"Coze AI分析失败: {e}")
        try:
            return await _analyze_with_openai(product_data)
        except Exception as e2:
            logger.error(f"OpenAI备选分析也失败: {e2}")
            return None


async def _get_coze_chat_result(conversation_id: str) -> Optional[str]:
    try:
        headers = {
            "Authorization": f"Bearer {settings.COZE_API_KEY}",
            "Accept": "application/json"
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{settings.COZE_API_BASE}/open_api/v2/chat/retrieve",
                params={"conversation_id": conversation_id},
                headers=headers
            )
            if response.status_code == 200:
                result = response.json()
                messages = result.get("messages", [])
                for msg in messages:
                    if msg.get("role") == "assistant" and msg.get("type") == "answer":
                        return msg.get("content", "")
    except Exception as e:
        logger.error(f"获取Coze对话结果失败: {e}")
    return None


async def _analyze_with_openai(product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        from openai import OpenAI

        if not settings.OPENAI_API_KEY:
            logger.warning("OpenAI API Key 未配置")
            return None

        client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE
        )

        prompt = _build_analysis_prompt(product_data)

        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "你是专业的跨境电商选品分析师。所有分析结果必须使用中文输出。只输出JSON，不要输出其他内容。"
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            timeout=120
        )

        answer_text = response.choices[0].message.content.strip()
        return _parse_ai_response(answer_text)

    except Exception as e:
        logger.error(f"OpenAI分析失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


def _parse_ai_response(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None

    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().endswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        import re
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            try:
                result = json.loads(json_match.group(0))
            except json.JSONDecodeError:
                logger.error(f"无法解析AI响应: {text[:300]}")
                return None
        else:
            logger.error(f"无法解析AI响应: {text[:300]}")
            return None

    return {
        "seasonality": str(result.get("seasonality", "")),
        "infringement_analysis": str(result.get("infringement_analysis", "")),
        "infringement_conclusion": str(result.get("infringement_conclusion", "")),
        "traffic_score_result": str(result.get("traffic_score_result", "")),
        "traffic_score": float(result.get("traffic_score", 0)),
        "sales_score": float(result.get("sales_score", 0)),
        "rating_score": float(result.get("rating_score", 0)),
        "penalty_factor": float(result.get("penalty_factor", 1)),
        "composite_score": float(result.get("composite_score", 0))
    }