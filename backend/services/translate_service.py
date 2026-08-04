from typing import Optional, Tuple
from openai import OpenAI
from config import get_settings

settings = get_settings()

client = OpenAI(
    api_key=settings.OPENAI_API_KEY,
    base_url=settings.OPENAI_API_BASE
) if settings.OPENAI_API_KEY else None


def translate_text(text: str, source_lang: str = "en", target_lang: str = "zh") -> Optional[str]:
    """
    使用AI翻译文本
    
    :param text: 要翻译的文本
    :param source_lang: 源语言，默认英语
    :param target_lang: 目标语言，默认中文
    :return: 翻译后的文本，如果失败返回None
    """
    if not client:
        return None
    
    if not text or text.strip() == "":
        return ""
    
    try:
        prompt = f"""请将以下{source_lang}文本翻译成{target_lang}，保持原意不变：

{text}
"""
        
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": f"你是一个专业的翻译助手，擅长将{source_lang}翻译成{target_lang}。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3
        )
        
        return response.choices[0].message.content.strip()
    
    except Exception as e:
        print(f"翻译失败: {str(e)}")
        return None


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
