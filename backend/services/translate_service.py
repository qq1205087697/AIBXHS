import re
from typing import Optional, Tuple
import openai
from config import get_settings

settings = get_settings()

if settings.OPENAI_API_KEY:
    openai.api_key = settings.OPENAI_API_KEY
    openai.api_base = settings.OPENAI_API_BASE


def _contains_chinese(text: str) -> bool:
    """检测文本是否包含中文字符"""
    return bool(re.search(r'[\u4e00-\u9fff]', text))


def _is_mostly_chinese(text: str, threshold: float = 0.5) -> bool:
    """检测文本是否主要为中文"""
    if not text:
        return False
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
    total_chars = len(re.sub(r'\s', '', text))
    if total_chars == 0:
        return False
    return chinese_chars / total_chars >= threshold


def translate_text(text: str, source_lang: str = "auto", target_lang: str = "zh") -> Optional[str]:
    """
    使用AI翻译文本

    :param text: 要翻译的文本
    :param source_lang: 源语言，默认自动检测
    :param target_lang: 目标语言，默认中文
    :return: 翻译后的文本，如果失败返回None
    """
    if not client:
        return None

    text = (text or "").strip()
    if not text:
        return ""

    # 如果已经是中文，直接返回原文
    if _is_mostly_chinese(text):
        return text

    def _is_mostly_english(text: str) -> bool:
        """检测文本是否主要为英文字母"""
        if not text:
            return False
        letters = len(re.findall(r'[a-zA-Z]', text))
        total = len(re.sub(r'\s', '', text))
        return total > 0 and letters / total > 0.4

    def _call_translate(prompt_text: str, system_content: str, temperature: float = 0.3) -> Optional[str]:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": prompt_text}
                ],
                temperature=temperature,
                max_tokens=2048,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"翻译失败: {str(e)}")
            return None

    # 第一次翻译：强制要求输出中文
    system_msg = (
        "你是专业翻译助手。规则：\n"
        "1. 必须将用户提供的文本翻译成流利的中文。\n"
        "2. 输出必须是中文，禁止输出英文原文。\n"
        "3. 专有名词、品牌名、ASIN可保留英文，但整句必须是中文。\n"
        "4. 只输出翻译结果，不要解释、不要加引号。"
    )
    prompt = f"""将以下英文差评翻译成中文：

{text}
"""
    result = _call_translate(prompt, system_msg)

    if result is None:
        return None

    result_clean = re.sub(r'^["\']|["\']$', '', result.strip())

    # 如果结果仍然是英文（或等于原文），用更高温度重试
    if _is_mostly_english(result_clean) or result_clean.lower() == text.lower():
        retry_prompt = f"""这是英文评论，必须翻译成中文。不要返回任何英文：

{text}
"""
        retry_result = _call_translate(retry_prompt, system_msg, temperature=0.5)
        if retry_result:
            retry_clean = re.sub(r'^["\']|["\']$', '', retry_result.strip())
            if not _is_mostly_english(retry_clean):
                return retry_clean

    return result_clean


def translate_review(title: Optional[str], content: str) -> Tuple[Optional[str], Optional[str]]:
    """
    翻译评论的标题和内容

    :param title: 评论标题（可为空）
    :param content: 评论内容
    :return: 翻译后的标题和内容
    """
    translated_title = None
    translated_content = None

    if title:
        translated_title = translate_text(title)

    translated_content = translate_text(content)

    return translated_title, translated_content
