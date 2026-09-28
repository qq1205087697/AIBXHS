"""MiniMax H3 提示词二次优化：中文口播方案 → H3 原生 Ref2VA 结构化提示词

H3 官方开源仓库（MiniMax-AI/MiniMax-H3）自带 h3-prompt-writing skill，含两份提示词指南：
    h3_base_guide_en.txt    基础模式：镜头、运镜、说话人、台词、音效的通用写法
    h3_ref2va_guide_en.txt  全参考模式：六段式结构、参考标签与留存分析

官方说明 H3-Context-IR（提示词预处理系统）未开源，建议按提示词指南自建上下文处理系统。
本模块即该自建实现：调用文本模型把中文方案改写为 Ref2VA 六段式英文提示词，再交给 H3 推理。
"""
import logging
import os
import re
from functools import lru_cache

from openai import OpenAI

from config import get_settings
from services.ai_concurrency import ai_call_slot

logger = logging.getLogger(__name__)
settings = get_settings()

GUIDE_BASE = "h3_base_guide_en.txt"
GUIDE_REF2VA = "h3_ref2va_guide_en.txt"

# 优化结果的软性长度目标（官方 API 提示词上限 7000 字符，便于后续切换云端时不越界）
MAX_PROMPT_CHARS = 6800

# 六段式必须出现的章节名，缺失即视为优化失败（回退原始提示词）
REQUIRED_SECTIONS = (
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
)

_SYSTEM_RULES = f"""【本次改写任务的硬性要求】
1. 只输出六段式正文，章节顺序固定为 subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music；除章节名与正文外不要输出任何解释，也不要使用 Markdown 代码块围栏。
2. 参考图按连接顺序编号：依次为 <Picture 1>、<Picture 2>……（张数以用户消息为准），分两类处理：
   - 商品图：同一件商品的多角度照片，在 subject_definitions 中定义成商品 <Subject N>，后续章节保持商品外观、颜色、材质、图案、包装一致；
   - 人物参考图：用户消息若标明"人物参考"对应某个 <Picture N>，该图即人物参考，需单独定义人物 <Subject N>：面部特征、发型发色、眼睛、肤色、身形等身份特征必须与该图及方案中的模特描述一致，且视频全程不变；服装以方案描述为准（可与参考图中的穿着不同），同样保持全程一致。
   用户消息未标明人物参考时，所有参考图均按商品图处理。
3. 正文写英文；模特与商品用可读英文描述；口播台词保留原语言，写成 <d>[English] 台词</d>（原台词若为其他语言，方括号内换成对应语言名）。
4. 分镜按方案中的镜头顺序改写为 [Shot 1]、[Shot 2]……；[Shot 1] 不带时间戳，之后的镜头用 "At MM:SS.mmm," 标出切换时间；时间必须与用户给出的总时长一致，最后一个镜头结束在总时长处。
5. 说话人统一编号：第一次出镜说话的人标 (S1)，同一人后续沿用同一编号；每句台词前都要交代说话人、语气与说话状态（持续讲话、口型清晰、边说边做动作等），保证模型生成时嘴部动作与台词同步。
6. 每个镜头要写清构图、主体外形与位置、环境与光线、动作与状态变化、镜头运动、当前声音，以及参考素材真正生效的位置；参考生成类任务的 detailed_description 通常 350~500 个英文词。
7. overall_soundscape 写环境音与动作音；方案里的背景音乐写进 non_diegetic_music；确实没有音乐时写 N/A。
8. 把方案里的中文标记（如【自拍】【内容】、口播：）全部转写成英文镜头语言，不要原样保留中文。
9. 全文总长度不超过 {MAX_PROMPT_CHARS} 个字符；超长时优先压缩次要场景描述，但六段结构、镜头切分与全部台词必须完整保留。"""


class H3PromptOptimizeError(Exception):
    """H3 提示词二次优化异常"""
    pass


@lru_cache(maxsize=4)
def _load_guide(filename: str) -> str:
    """读取官方提示词指南（进程内缓存）"""
    path = os.path.join(settings.H3_PROMPT_GUIDE_DIR, filename)
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        raise H3PromptOptimizeError(f"读取 H3 提示词指南失败: {path}: {e}")


def _build_system_prompt() -> str:
    """系统提示词：官方指南原文 + 本次改写要求"""
    return (
        "你是 MiniMax H3 视频模型的上下文预处理系统（官方 H3-Context-IR 的开源替代实现）。\n"
        "用户会给你一份中文的带货口播视频方案（含人物、场景、分镜与口播台词），"
        "你需要把它改写为 H3 Ref2VA（全参考模式）可直接消费的英文结构化提示词。\n\n"
        "必须严格遵守以下两份官方提示词指南的字段名、章节顺序、参考标签、时间表示法与用词规范"
        "（两份指南冲突时以 Ref2VA 指南为准）：\n\n"
        "===== 指南一：基础模式（镜头、运镜、说话人、台词、音效的通用写法）=====\n"
        + _load_guide(GUIDE_BASE)
        + "\n\n===== 指南二：全参考模式 Ref2VA（六段式结构、参考标签与留存分析）=====\n"
        + _load_guide(GUIDE_REF2VA)
        + "\n"
        + _SYSTEM_RULES
    )


def _build_user_prompt(
    *,
    plan_prompt: str,
    duration: int,
    ratio: str,
    image_count: int,
    voiceover_language: str,
    product_name: str,
    person_picture: int = 0,
) -> str:
    """用户消息：视频参数 + 待改写的中文方案"""
    person_note = (
        f"<Picture {person_picture}> 是人物参考图，其余参考图为同一商品的多角度照片。"
        if 1 <= person_picture <= image_count
        else "无人物参考图，所有参考图均为同一商品的多角度照片。"
    )
    return f"""【视频参数】
总时长：{duration} 秒
画面比例：{ratio}
参考图数量：{image_count} 张（连接顺序即 <Picture 1> … <Picture {image_count}>）
人物参考：{person_note}
口播语言：{voiceover_language}
产品名称：{product_name or "（未提供，请按方案内容归纳）"}

【待改写的中文口播视频方案】
{plan_prompt}
"""


def _strip_fence(text: str) -> str:
    """去掉模型可能输出的 Markdown 代码块围栏"""
    text = re.sub(r"^\s*```[a-zA-Z]*\s*\n?", "", text)
    text = re.sub(r"\n?\s*```\s*$", "", text)
    return text.strip()


def optimize_h3_prompt(
    *,
    plan_prompt: str,
    duration: int,
    ratio: str,
    image_count: int,
    voiceover_language: str = "自动",
    product_name: str = "",
    person_picture: int = 0,
) -> str:
    """把中文方案改写为 H3 Ref2VA 六段式英文提示词。

    :param person_picture: 人物参考图序号（1-based，0 表示无人物参考图）
    失败时抛 H3PromptOptimizeError，由调用方回退到原始方案文本。
    """
    if not settings.OPENAI_API_KEY:
        raise H3PromptOptimizeError("OpenAI API Key 未配置")
    if not (plan_prompt or "").strip():
        raise H3PromptOptimizeError("方案内容为空，无法优化提示词")

    model = settings.H3_PROMPT_MODEL or settings.OPENAI_MODEL
    client = OpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_API_BASE)

    messages = [
        {"role": "system", "content": _build_system_prompt()},
        {
            "role": "user",
            "content": _build_user_prompt(
                plan_prompt=plan_prompt,
                duration=duration,
                ratio=ratio,
                image_count=image_count,
                voiceover_language=voiceover_language,
                product_name=product_name,
                person_picture=person_picture,
            ),
        },
    ]

    logger.info(
        f"[H3提示词优化] 调用模型 {model}，方案 {len(plan_prompt)} 字符，"
        f"参考图 {image_count} 张，时长 {duration}s"
    )

    try:
        with ai_call_slot():
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.3,
                timeout=240,
            )
    except Exception as e:
        raise H3PromptOptimizeError(f"提示词优化调用失败: {e}")

    if not response.choices:
        raise H3PromptOptimizeError("提示词优化返回为空（choices 为空）")

    text = _strip_fence((response.choices[0].message.content or "").strip())
    if not text:
        raise H3PromptOptimizeError("提示词优化结果为空")

    missing = [name for name in REQUIRED_SECTIONS if name not in text]
    if missing:
        raise H3PromptOptimizeError(f"优化结果缺少必要的章节: {', '.join(missing)}")

    if len(text) > MAX_PROMPT_CHARS:
        logger.warning(
            f"[H3提示词优化] 结果 {len(text)} 字符，超出建议长度 {MAX_PROMPT_CHARS}，仍按原文提交"
        )

    return text