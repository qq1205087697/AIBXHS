from typing import Optional, Tuple
import openai
from config import get_settings

settings = get_settings()

if settings.OPENAI_API_KEY:
    openai.api_key = settings.OPENAI_API_KEY
    openai.api_base = settings.OPENAI_API_BASE


def translate_text(text: str, source_lang: str = "en", target_lang: str = "zh") -> Optional[str]:
    if not settings.OPENAI_API_KEY:
        return None
    
    if not text or text.strip() == "":
        return ""
    
    try:
        prompt = f"""请将以下{source_lang}文本翻译成{target_lang}，保持原意不变：

{text}
"""
        
        response = openai.ChatCompletion.create(
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
    translated_title = None
    translated_content = None
    
    if title:
        translated_title = translate_text(title)
    
    translated_content = translate_text(content)
    
    return translated_title, translated_content
