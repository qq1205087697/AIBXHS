import json
import base64
import asyncio
import logging
from typing import List, Dict, Any, Optional
from openai import OpenAI
from fastapi import UploadFile

from config import get_settings
from services.ai_concurrency import ai_call_slot

settings = get_settings()
logger = logging.getLogger(__name__)


# Amazon 产品图片分析 JSON Schema
AMAZON_PRODUCT_ANALYSIS_SCHEMA = {
    "type": "json_schema",
    "name": "amazon_product_analysis",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "product_name_cn": {"type": "string"},
            "product_name_en": {"type": "string"},
            "product_type": {"type": "string"},
            "target_audience": {
                "type": "array",
                "items": {"type": "string"},
            },
            "selling_points": {
                "type": "array",
                "items": {"type": "string"},
            },
            "material": {
                "type": "array",
                "items": {"type": "string"},
            },
            "usage_scenarios": {
                "type": "array",
                "items": {"type": "string"},
            },
            "usage_methods": {
                "type": "array",
                "items": {"type": "string"},
            },
            "product_components": {
                "type": "array",
                "items": {"type": "string"},
            },
            "colors": {
                "type": "array",
                "items": {"type": "string"},
            },
            "amazon_category": {"type": "string"},
            "keywords": {
                "type": "array",
                "items": {"type": "string"},
            },
            "visible_text": {
                "type": "array",
                "items": {"type": "string"},
            },
            "confidence": {"type": "number"},
            "uncertain_information": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": [
            "product_name_cn",
            "product_name_en",
            "product_type",
            "target_audience",
            "selling_points",
            "material",
            "usage_scenarios",
            "usage_methods",
            "product_components",
            "colors",
            "amazon_category",
            "keywords",
            "visible_text",
            "confidence",
            "uncertain_information",
        ],
        "additionalProperties": False,
    },
}


SYSTEM_PROMPT = """你是一名 Amazon 跨境电商产品分析专家。

你的任务是：
根据用户提供的商品图片，识别图片中的实际商品，并生成 Amazon 产品信息。

重要规则：

1. 只能根据图片中可以观察到的信息进行判断。
2. 不要把无法从图片确认的信息当成事实。
3. 对材质、尺寸、数量、食品级、安全认证、是否可重复使用等信息，
   如果图片无法确认，必须明确标记为“无法从图片确认”。
4. 可以根据商品外观和使用场景推测目标消费者，但必须保持合理。
5. Amazon 类目需要根据商品实际用途进行判断。
6. 产品名称应该是 Amazon 风格的英文商品名称，同时提供中文名称。
7. 卖点必须围绕图片中真实可见的产品特征。
8. 不要描述蛋糕本身是商品，如果图片展示的是蛋糕装饰品，
   应识别真正销售的商品为蛋糕装饰品。
9. 不要把背景中的道具误认为商品组成部分。
10. 如果图片中存在文字，可以进行 OCR，并结合文字判断产品。

请特别区分：

- 图片中明确可见的信息
- 根据视觉特征合理推测的信息
- 无法确认的信息

不要编造产品参数。
如果上传图片中包含尺寸图则可得出产品尺寸，否则产品尺寸留空，不得猜测。

必须按以下 JSON 格式返回，不要包含任何其他说明文字：

{
    "product_name_cn": "中文名称",
    "product_name_en": "Amazon 英文名称",
    "product_type": "产品类型",
    "target_audience": ["受众1", "受众2"],
    "selling_points": ["卖点1", "卖点2"],
    "material": ["材质1"],
    "usage_scenarios": ["场景1"],
    "usage_methods": ["使用方式1", "使用方式2"],
    "product_components": ["组件1"],
    "colors": ["颜色1"],
    "amazon_category": "Amazon 类目",
    "keywords": ["关键词1"],
    "visible_text": ["图片中可见文字1"],
    "confidence": 0.85,
    "uncertain_information": ["无法确认的信息1"]
}
"""


def _build_user_content(files: List[UploadFile]) -> List[Dict[str, Any]]:
    """构建包含图片的用户消息内容"""
    content: List[Dict[str, Any]] = [
        {"type": "text", "text": "请根据以下商品图片进行 Amazon 产品信息分析。"}
    ]

    for file in files:
        try:
            file.file.seek(0)
            image_bytes = file.file.read()
            mime_type = file.content_type or "image/jpeg"
            encoded = base64.b64encode(image_bytes).decode("utf-8")
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{encoded}",
                },
            })
        except Exception as e:
            logger.error(f"读取图片失败 {file.filename}: {e}")
        finally:
            try:
                file.file.close()
            except Exception:
                pass

    return content


class AIAnalysisError(Exception):
    """AI 分析异常"""
    pass


def _create_chat_completion(
    client: OpenAI,
    model: str,
    messages: List[Dict[str, Any]],
    response_format: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """单次调用 OpenAI 聊天补全，返回文本内容"""
    # OpenAI 要求 json_object 模式下消息中必须出现 "json" 字样
    if response_format and response_format.get("type") == "json_object":
        all_text = " ".join(str(m.get("content", "")) for m in messages).lower()
        if "json" not in all_text:
            messages = [dict(m) for m in messages]
            if messages:
                last = messages[-1]
                last_content = last.get("content", "")
                if isinstance(last_content, str):
                    last["content"] = last_content + "\n\nPlease return the result as valid JSON."
                else:
                    # content 为数组时追加 text 片段
                    last["content"] = list(last_content) + [
                        {"type": "text", "text": "\n\nPlease return the result as valid JSON."}
                    ]

    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "timeout": 180,
    }
    if response_format:
        kwargs["response_format"] = response_format

    logger.info(f"[AI创作中心] 调用模型 {model}, response_format={response_format.get('type') if response_format else 'none'}")

    try:
        with ai_call_slot():
            response = client.chat.completions.create(**kwargs)
    except Exception as e:
        logger.error(f"OpenAI 调用失败: {e}")
        raise AIAnalysisError(f"AI 模型调用失败: {str(e)}")

    if not response.choices:
        logger.warning("OpenAI 响应 choices 为空")
        return None

    message = response.choices[0].message
    logger.info(f"[AI创作中心] 模型响应 finish_reason={response.choices[0].finish_reason}, content 长度={len(message.content or '')}")
    logger.debug(f"[AI创作中心] 模型响应内容: {message.content[:500] if message.content else '空'}")

    # 部分渠道会把 JSON 放在 tool_calls / function_call 中
    if message.tool_calls:
        logger.info(f"[AI创作中心] 响应包含 tool_calls: {len(message.tool_calls)}")
        for tool_call in message.tool_calls:
            if tool_call.function and tool_call.function.arguments:
                return tool_call.function.arguments

    return (message.content or "").strip()


def _call_openai_vision_sync(files: List[UploadFile]) -> Optional[str]:
    """同步调用 OpenAI 视觉模型进行产品分析，支持多种 response_format 回退"""
    if not settings.OPENAI_API_KEY:
        raise AIAnalysisError("OpenAI API Key 未配置")

    client = OpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_API_BASE,
    )

    content = _build_user_content(files)
    if len(content) <= 1:
        raise AIAnalysisError("没有可用的图片内容")

    model = settings.OPENAI_VISION_MODEL or "gpt-4o"
    logger.info(f"[AI创作中心] 使用模型: {model}, 图片数量: {len(content) - 1}")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ]

    response_format_mode = (settings.OPENAI_VISION_RESPONSE_FORMAT or "json_object").lower()
    logger.info(f"[AI创作中心] 响应格式配置: {response_format_mode}")

    response_format: Optional[Dict[str, Any]] = None
    if response_format_mode == "json_schema":
        response_format = AMAZON_PRODUCT_ANALYSIS_SCHEMA
    elif response_format_mode == "json_object":
        response_format = {"type": "json_object"}

    # 按配置调用模型，避免多次重试导致重复扣费
    answer_text = _create_chat_completion(client, model, messages, response_format=response_format)

    if not answer_text:
        raise AIAnalysisError("AI 模型返回内容为空，请尝试切换 OPENAI_VISION_RESPONSE_FORMAT 配置（如 json_object / text）")

    logger.debug(f"OpenAI 视觉模型响应: {answer_text[:300]}...")
    return answer_text


async def analyze_product_images(files: List[UploadFile]) -> Optional[Dict[str, Any]]:
    """异步分析商品图片，返回结构化 Amazon 产品信息"""
    try:
        raw_text = await asyncio.wait_for(
            asyncio.to_thread(_call_openai_vision_sync, files),
            timeout=240,
        )
    except asyncio.TimeoutError:
        raise AIAnalysisError("AI 图片分析超时（240秒）")

    if not raw_text:
        raise AIAnalysisError("AI 模型返回内容为空")

    result = parse_analysis_result(raw_text)
    if not result:
        raise AIAnalysisError(f"无法解析 AI 返回内容为结构化数据: {raw_text[:200]}")

    return result


def parse_analysis_result(raw_text: Optional[str]) -> Optional[Dict[str, Any]]:
    """解析 AI 返回的 JSON 文本"""
    if not raw_text:
        return None

    text = raw_text.strip()

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

    logger.error(f"无法解析 AI 分析结果为 JSON: {text[:300]}")
    return None


# ============ 带货口播 AI 视频提示词生成 ============

SHOT_SCHEMA = {
    "type": "object",
    "properties": {
        "timestamp": {"type": "string"},
        "shot_purpose": {"type": "string"},
        "shot_type": {"type": "string"},
        "camera_movement": {"type": "string"},
        "character_action": {"type": "string"},
        "character_expression": {"type": "string"},
        "product_action": {"type": "string"},
        "product_position": {"type": "string"},
        "composition": {"type": "string"},
        "environment": {"type": "string"},
        "voiceover": {"type": "string"},
        "voiceover_cn": {"type": "string"},
        "sound": {"type": "string"},
    },
    "required": [
        "timestamp",
        "shot_purpose",
        "shot_type",
        "camera_movement",
        "character_action",
        "character_expression",
        "product_action",
        "product_position",
        "composition",
        "environment",
        "voiceover",
        "voiceover_cn",
        "sound",
    ],
    "additionalProperties": False,
}


VIDEO_CONCEPT_SCHEMA = {
    "type": "json_schema",
    "name": "video_concepts",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "concepts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "concept_title": {"type": "string"},
                        "marketing_goal": {"type": "string"},
                        "creative_strategy": {
                            "type": "object",
                            "properties": {
                                "persona_identity": {"type": "string"},
                                "persona_role": {"type": "string"},
                                "age": {"type": "string"},
                                "relationship_to_product": {"type": "string"},
                                "story_background": {"type": "string"},
                                "consumption_scene": {"type": "string"},
                                "core_pain_point": {"type": "string"},
                                "core_selling_point": {"type": "string"},
                                "emotion": {"type": "string"},
                                "video_style": {"type": "string"},
                                "camera_language": {"type": "string"},
                            },
                            "required": [
                                "persona_identity",
                                "persona_role",
                                "age",
                                "relationship_to_product",
                                "story_background",
                                "consumption_scene",
                                "core_pain_point",
                                "core_selling_point",
                                "emotion",
                                "video_style",
                                "camera_language",
                            ],
                            "additionalProperties": False,
                        },
                        "story": {"type": "string"},
                        "character": {"type": "string"},
                        "environment": {"type": "string"},
                        "music": {"type": "string"},
                        "storyboard": {
                            "type": "array",
                            "items": SHOT_SCHEMA,
                        },
                    },
                    "required": [
                        "concept_title",
                        "marketing_goal",
                        "creative_strategy",
                        "story",
                        "character",
                        "environment",
                        "music",
                        "storyboard",
                    ],
                    "additionalProperties": False,
                },
                "minItems": 3,
                "maxItems": 3,
            },
        },
        "required": ["concepts"],
        "additionalProperties": False,
    },
}


VIDEO_PROMPT_SCHEMA = {
    "type": "json_schema",
    "name": "video_prompts",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "prompts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "concept_title": {"type": "string"},
                        "final_prompt": {"type": "string"},
                    },
                    "required": ["concept_title", "final_prompt"],
                    "additionalProperties": False,
                },
                "minItems": 3,
                "maxItems": 3,
            },
        },
        "required": ["prompts"],
        "additionalProperties": False,
    },
}


VIDEO_CONCEPT_SYSTEM_PROMPT = """You are an elite short-form ecommerce video creative director specialized in TikTok/Instagram Reels style UGC ads.

Your task: create 3 highly differentiated, dynamically generated video advertising concepts for the product described in the Product Profile.

=== DYNAMIC GENERATION RULES ===

DO NOT use fixed templates like "方案一 = 妈妈UGC, 方案二 = 专业达人, 方案三 = 居家分享".

Every concept must be dynamically generated from scratch based on:
- Product Profile
- Target Market (e.g. US)
- Video Duration

Each concept must define its own Creative Strategy with these fields:
1. persona_identity — who is the character
2. persona_role — their job/role/status
3. age — approximate age range
4. relationship_to_product — how they relate to the product
5. story_background — the setup/context
6. consumption_scene — where they use/buy the product
7. core_pain_point — the problem they face
8. core_selling_point — the key benefit for them
9. emotion — the dominant emotional tone
10. video_style — the presentation style
11. camera_language — camera/workflow approach

Marketing goals must be dynamically assigned. Choose from:
- 推荐款
- 场景种草
- 促销转化
- 情绪共鸣
- 专业评测
- DIY教程
- 问题解决
- 前后对比
- 真实体验
- 开箱体验
- 生活方式种草
- 礼物推荐

The 3 concepts must have DIFFERENT marketing goals when possible.

DIFFERENTIATION REQUIREMENTS:
The 3 concepts must differ significantly in at least 4 of these dimensions:
- character/persona
- story
- hook
- core pain point
- marketing angle
- usage scene
- emotion
- filming style
- product presentation
- purchase reason

Do NOT just swap names. Each concept must feel like a genuinely different creative direction.

=== DURATION RULES ===

Duration is a core parameter. Design the story structure from the beginning for the given duration:

- 15 seconds: 4-5 shots, minimal setup, immediate product focus
- 30 seconds: 6-8 shots, short hook, product demo, CTA
- 45 seconds: 8-10 shots, add background/pain point/details
- 60 seconds: 10-14 shots, full arc: background, pain point, unboxing, details, usage, transformation, emotion, CTA

Do not generate a 30s script and trim it. Start from the duration.

=== MARKET ADAPTATION ===

If market = US:
- Characters must feel like real American consumers
- Clothing, home decor, furniture, props, lifestyle must match American culture
- Do NOT use Chinese-style homes, furniture, clothing, or behavior
- Voiceover must be natural spoken American English, not translated Chinese

Characters can be: young American mom, new American dad, party planner, baking enthusiast, professional baker, parent throwing first birthday party, etc. Choose dynamically based on product.

=== PRODUCT FACT CONSTRAINTS ===

Stories, characters, and emotions can be fictional.
BUT product facts must NOT be invented:
- material
- size
- quantity
- certifications
- food-grade claims
- safety claims
- functions
- packaging contents
- product components

If uncertain from the Product Profile, do NOT state it as fact in the voiceover.

[product_anchor] = the exact product shown in the reference image, including all visible components.
Throughout the video, keep the product unchanged in:
- color
- shape
- structure
- components
- proportions
- design

The product is the sales subject. The cake is only the usage scene, not the product being sold.

=== STORYBOARD FORMAT (Linkfox style) ===

For each shot, provide in Chinese for visual fields and market-appropriate language for voiceover:

- timestamp: e.g. "0-3秒"
- shot_purpose: e.g. "视觉钩子"
- shot_type: e.g. "手机前置自拍，中近景" (Chinese)
- camera_movement: e.g. "手持自然晃动，快速甩镜" (Chinese)
- character_action: Chinese
- character_expression: Chinese
- product_action: Chinese
- product_position: Chinese
- composition: Chinese
- environment: Chinese
- voiceover: natural spoken English for US market
- voiceover_cn: Chinese translation of the voiceover
- sound: music / sound effects

=== STRUCTURE ===

Each video should feel like authentic UGC, not a traditional commercial.

- First 3 seconds: strong visual hook
- Middle: demonstrate product appearance, use case, and benefits
- Final section: create purchase intent + clear CTA

Generate exactly 3 concepts as valid JSON using this structure:
{
  "concepts": [
    {
      "concept_title": "...",
      "marketing_goal": "...",
      "creative_strategy": {
        "persona_identity": "...",
        "persona_role": "...",
        "age": "...",
        "relationship_to_product": "...",
        "story_background": "...",
        "consumption_scene": "...",
        "core_pain_point": "...",
        "core_selling_point": "...",
        "emotion": "...",
        "video_style": "...",
        "camera_language": "..."
      },
      "story": "...",
      "character": "...",
      "environment": "...",
      "music": "...",
      "storyboard": [
        {
          "timestamp": "0-3秒",
          "shot_purpose": "视觉钩子",
          "shot_type": "手机前置自拍，中近景",
          "camera_movement": "手持自然晃动",
          "character_action": "...",
          "character_expression": "...",
          "product_action": "...",
          "product_position": "...",
          "composition": "...",
          "environment": "...",
          "voiceover": "Natural spoken English for US market",
          "voiceover_cn": "中文翻译",
          "sound": "..."
        }
      ]
    }
  ]
}
"""


VIDEO_PROMPT_SYSTEM_PROMPT = """You are an expert prompt engineer for AI video generation models (Sora, Runway, Pika, Kling, etc.).

You will receive a product profile and three video advertising concepts with detailed Chinese storyboards.
For each concept, write one final, detailed video generation prompt in English.

Requirements for each final prompt:

1. The prompt must be a single cohesive scene-by-scene description suitable for text-to-video AI.
2. Use vivid cinematic language: lighting, camera movement, shot type, mood, setting, character action, environment.
3. The exact product ([product_anchor]) must remain visually faithful to the product profile:
   - do not change appearance, color, structure, components, or proportions
   - do not invent unsupported specifications
4. Preserve the unique storytelling approach, character, environment, music feel, and emotional tone of each concept.
5. Translate the Chinese storyboard into English cinematic instructions shot by shot.
6. Include voiceover/dialogue lines naturally within the prompt.
7. The first 3 seconds must emphasize the hook.
8. The middle must demonstrate product use and benefits.
9. The end must include a clear call to action.
10. Keep the prompt concise but rich (roughly 200-500 words).

Output valid JSON with exactly 3 prompt objects.
"""


def _call_text_model_sync(
    system_prompt: str,
    user_text: str,
    response_format: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """调用文本模型（非视觉）"""
    if not settings.OPENAI_API_KEY:
        raise AIAnalysisError("OpenAI API Key 未配置")

    model = settings.OPENAI_MODEL or "deepseek-v4-flash"
    client = OpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_API_BASE,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]

    logger.info(f"[AI创作中心] 调用文本模型 {model}")
    return _create_chat_completion(client, model, messages, response_format=response_format)


def _select_response_format(schema: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """根据配置选择是否使用结构化输出"""
    mode = (settings.OPENAI_VISION_RESPONSE_FORMAT or "json_object").lower()
    if mode == "json_schema":
        return schema
    elif mode == "json_object":
        return {"type": "json_object"}
    return None


async def generate_video_concepts(
    product_profile: Dict[str, Any],
    market: str = "US",
    duration: int = 30,
    previous_concepts: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """根据产品画像生成 3 个差异化视频创意"""
    if duration not in (15, 30, 45, 60):
        raise AIAnalysisError("视频时长仅支持 15 / 30 / 45 / 60 秒")

    user_text_parts = [
        f"Target Market: {market}",
        f"Video Duration: {duration} seconds",
        "",
        "Product Profile:",
        json.dumps(product_profile, ensure_ascii=False, indent=2),
    ]

    if previous_concepts:
        user_text_parts.extend([
            "",
            "Previously generated concepts (DO NOT repeat these characters, stories, hooks, core selling points, scenes, or marketing angles):",
            json.dumps(previous_concepts, ensure_ascii=False, indent=2),
        ])

    user_text_parts.append(
        "\nPlease generate exactly 3 highly differentiated video advertising concepts based on the above."
    )

    user_text = "\n".join(user_text_parts)

    def _sync_call():
        raw = _call_text_model_sync(
            VIDEO_CONCEPT_SYSTEM_PROMPT,
            user_text,
            response_format=_select_response_format(VIDEO_CONCEPT_SCHEMA),
        )
        if not raw:
            return None
        return parse_analysis_result(raw)

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_sync_call),
            timeout=240,
        )
    except asyncio.TimeoutError:
        raise AIAnalysisError("视频创意生成超时（240秒）")

    if not result or "concepts" not in result:
        raise AIAnalysisError("无法解析视频创意结果")

    return result["concepts"]


async def generate_video_prompts(
    product_profile: Dict[str, Any],
    concepts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """根据产品画像和 3 个创意生成 3 套最终视频提示词"""
    user_text = (
        "Product Profile:\n"
        f"{json.dumps(product_profile, ensure_ascii=False, indent=2)}\n\n"
        "Video Concepts:\n"
        f"{json.dumps(concepts, ensure_ascii=False, indent=2)}\n\n"
        "Please generate exactly 3 final video generation prompts, one for each concept."
    )

    def _sync_call():
        raw = _call_text_model_sync(
            VIDEO_PROMPT_SYSTEM_PROMPT,
            user_text,
            response_format=_select_response_format(VIDEO_PROMPT_SCHEMA),
        )
        if not raw:
            return None
        return parse_analysis_result(raw)

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_sync_call),
            timeout=240,
        )
    except asyncio.TimeoutError:
        raise AIAnalysisError("视频提示词生成超时（240秒）")

    if not result or "prompts" not in result:
        raise AIAnalysisError("无法解析视频提示词结果")

    return result["prompts"]
