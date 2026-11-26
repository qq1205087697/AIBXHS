"""媒体语言校验：视频语言 vs 目标 SKU/ASIN 所属站点语言。

- 视频语言来源：AI 视频任务的口播语言（「自动」时跟随目标市场）；
  媒体任务中心方案里的 language 字段（生成视频时同样按首个目标站点语言生成）。
- 站点语言来源：platform_products → stores.site（库里既有「美国/英国/德国」这类
  中文国家名，也有「US/UK/DE」这类站点码，这里统一归一化）。
- 仅在能确定视频语言且能识别站点语言时返回不匹配项，识别不了的站点直接跳过。
"""

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import text

# 语言名归一化：英文名 / 中文名 → 基础中文语言名
_LANGUAGE_ALIASES: Dict[str, str] = {
    "english": "英语", "en": "英语", "英语": "英语",
    "german": "德语", "de": "德语", "德语": "德语",
    "french": "法语", "fr": "法语", "法语": "法语",
    "spanish": "西班牙语", "es": "西班牙语", "西班牙语": "西班牙语",
    "italian": "意大利语", "it": "意大利语", "意大利语": "意大利语",
    "japanese": "日语", "ja": "日语", "日语": "日语",
    "korean": "韩语", "ko": "韩语", "韩语": "韩语",
    "portuguese": "葡萄牙语", "pt": "葡萄牙语", "葡萄牙语": "葡萄牙语",
    "arabic": "阿拉伯语", "ar": "阿拉伯语", "阿拉伯语": "阿拉伯语",
    "russian": "俄语", "ru": "俄语", "俄语": "俄语",
    "dutch": "荷兰语", "nl": "荷兰语", "荷兰语": "荷兰语",
    "swedish": "瑞典语", "sv": "瑞典语", "瑞典语": "瑞典语",
    "polish": "波兰语", "pl": "波兰语", "波兰语": "波兰语",
    "turkish": "土耳其语", "tr": "土耳其语", "土耳其语": "土耳其语",
    "chinese": "中文", "zh": "中文", "中文": "中文",
    "thai": "泰语", "th": "泰语", "泰语": "泰语",
    "vietnamese": "越南语", "vi": "越南语", "越南语": "越南语",
    "indonesian": "印尼语", "id": "印尼语", "印尼语": "印尼语",
}

# 目标市场代码 → 默认口播语言（与 AI 视频「自动」语言的映射保持一致）
_MARKET_LANGUAGE: Dict[str, str] = {
    "US": "英语", "CA": "英语", "AU": "英语", "UK": "英语", "GB": "英语", "IE": "英语",
    "DE": "德语", "AT": "德语", "CH": "德语",
    "FR": "法语",
    "ES": "西班牙语", "MX": "西班牙语",
    "IT": "意大利语",
    "JP": "日语",
    "KR": "韩语",
    "BR": "葡萄牙语",
    "ME": "阿拉伯语",
    "SEA": "英语",
    "CN": "中文",
}

# 站点中文名 → 站点语言（按包含匹配，长的放前面避免短词误命中）
_CN_SITE_LANGUAGE: List[tuple] = [
    ("澳大利亚", "英语"), ("新西兰", "英语"), ("加拿大", "英语"), ("新加坡", "英语"),
    ("爱尔兰", "英语"), ("美国", "英语"), ("英国", "英语"), ("印度", "英语"),
    ("奥地利", "德语"), ("德国", "德语"), ("瑞士", "德语"),
    ("法国", "法语"), ("比利时", "法语"),
    ("西班牙", "西班牙语"), ("墨西哥", "西班牙语"),
    ("意大利", "意大利语"), ("日本", "日语"), ("韩国", "韩语"),
    ("葡萄牙", "葡萄牙语"), ("巴西", "葡萄牙语"),
    ("荷兰", "荷兰语"), ("瑞典", "瑞典语"), ("波兰", "波兰语"),
    ("土耳其", "土耳其语"), ("阿联酋", "阿拉伯语"), ("沙特", "阿拉伯语"),
    ("俄罗斯", "俄语"), ("中国", "中文"),
]

# 站点码 → 站点语言（独立两位字母 token 匹配，避免 "USA" 命中等误判）
_SITE_CODE_LANGUAGE: Dict[str, str] = {
    "US": "英语", "CA": "英语", "UK": "英语", "GB": "英语", "AU": "英语", "NZ": "英语",
    "IE": "英语", "SG": "英语", "IN": "英语",
    "DE": "德语", "AT": "德语", "CH": "德语",
    "FR": "法语", "BE": "法语",
    "ES": "西班牙语", "MX": "西班牙语",
    "IT": "意大利语",
    "JP": "日语", "KR": "韩语",
    "BR": "葡萄牙语", "PT": "葡萄牙语",
    "NL": "荷兰语", "SE": "瑞典语", "PL": "波兰语",
    "TR": "土耳其语",
    "AE": "阿拉伯语", "SA": "阿拉伯语",
    "RU": "俄语",
    "CN": "中文",
}

_SITE_CODE_RE = re.compile(r"(?<![A-Za-z])([A-Za-z]{2})(?![A-Za-z])")


def normalize_language(value: Optional[str], market: Optional[str] = None) -> Optional[str]:
    """把口播语言/方案语言归一化成基础中文语言名；「自动」按目标市场解析。"""
    text_value = (value or "").strip()
    if not text_value or text_value.lower() in ("auto", "自动"):
        return _MARKET_LANGUAGE.get((market or "").strip().upper())
    # 去掉「英语（英式拼写）」这类括号修饰，只比较基础语言
    base = re.split(r"[（(]", text_value, 1)[0].strip()
    return _LANGUAGE_ALIASES.get(base.lower())


def resolve_site_language(site: Optional[str]) -> Optional[str]:
    """站点（美国 / 美国US / US / 德国DE …）→ 站点语言；无法识别返回 None。"""
    text_value = (site or "").strip()
    if not text_value:
        return None
    for keyword, language in _CN_SITE_LANGUAGE:
        if keyword in text_value:
            return language
    for code in _SITE_CODE_RE.findall(text_value):
        language = _SITE_CODE_LANGUAGE.get(code.upper())
        if language:
            return language
    return None


def find_site_language_mismatches(video_language: Optional[str], sites: Sequence[Optional[str]]) -> List[Dict[str, str]]:
    """返回视频语言与目标站点语言不一致的站点列表（去重、跳过无法识别的站点）。"""
    video_lang = normalize_language(video_language)
    if not video_lang:
        return []
    seen = set()
    mismatches: List[Dict[str, str]] = []
    for site in sites:
        label = (site or "").strip()
        if not label or label in seen:
            continue
        seen.add(label)
        site_lang = resolve_site_language(label)
        if site_lang and site_lang != video_lang:
            mismatches.append({"site": label, "site_language": site_lang})
    return mismatches


def _lookup_language_by_url(db: Any, tenant_id: int, urls: Sequence[str]) -> Tuple[Optional[str], bool]:
    """按成片地址回查 AI 视频任务（高清成片会再回到源视频地址）。

    返回 (语言, 是否有口播)：
    - (语言, True)  命中任务且解析出语言
    - (None, False) 命中「产品展示」任务，无口播
    - (None, True)  未命中任务，语言未知
    """
    cleaned = [u.strip() for u in urls if u and u.strip()]
    if not cleaned:
        return None, True
    placeholders = ",".join(f":u{i}" for i in range(len(cleaned)))
    params: Dict[str, Any] = {f"u{i}": url for i, url in enumerate(cleaned)}
    params["tid"] = tenant_id

    # AI 视频成片：直接按成片地址命中
    row = db.execute(text(f"""
        SELECT t.voiceover_language, t.market, t.video_type
        FROM ai_video_tasks t
        WHERE t.tenant_id = :tid AND t.deleted_at IS NULL AND t.video_url IN ({placeholders})
        ORDER BY t.id DESC LIMIT 1
    """), params).fetchone()
    if not row:
        # 高清处理成片/源视频：先回到源视频地址，再关联 AI 视频任务
        row = db.execute(text(f"""
            SELECT t.voiceover_language, t.market, t.video_type
            FROM video_upscale_tasks u
            JOIN ai_video_tasks t
              ON t.video_url = u.source_video_url AND t.tenant_id = u.tenant_id AND t.deleted_at IS NULL
            WHERE u.tenant_id = :tid AND u.deleted_at IS NULL
              AND (u.video_url IN ({placeholders}) OR u.source_video_url IN ({placeholders}))
            ORDER BY u.id DESC LIMIT 1
        """), params).fetchone()
    if not row:
        return None, True
    if (row[2] or "") == "产品展示":
        return None, False
    return normalize_language(row[0], row[1]), True


def _resolve_product_language(db: Any, tenant_id: int, product_id: int) -> Tuple[Optional[str], bool]:
    """视频地址被 TOS 改名后无法直接命中任务时，按产品已绑定视频 / AI 视频任务兜底。

    返回 (语言, 是否有口播)：
    - (语言, True)  产品已知语言唯一
    - (None, False) 产品已知视频全部是「产品展示」，无口播
    - (None, True)  多语言或信息不足，仍需人工核对
    """
    languages = set()
    has_voiceover = False
    saw_any = False

    # 绑定申请保留绑定前的原始地址，可回查 AI 视频 / 高清处理任务语言
    bind_rows = db.execute(text("""
        SELECT video_url FROM video_binding_requests
        WHERE tenant_id = :tid AND product_id = :pid AND status = 'approved'
          AND media_type = 'video' AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 20
    """), {"tid": tenant_id, "pid": product_id}).fetchall()
    for (url,) in bind_rows:
        saw_any = True
        language, voice = _lookup_language_by_url(db, tenant_id, [url])
        has_voiceover = has_voiceover or voice
        if language:
            languages.add(language)
    if len(languages) == 1:
        return next(iter(languages)), True
    if languages:
        return None, True

    # 产品编码关联的 AI 视频任务（人工上传的老视频也能借用产品已知语言）
    product_code = db.execute(text("""
        SELECT product_code FROM products
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"pid": product_id, "tid": tenant_id}).scalar()
    if product_code:
        task_rows = db.execute(text("""
            SELECT voiceover_language, market, video_type FROM ai_video_tasks
            WHERE tenant_id = :tid AND product_code = :pcode AND deleted_at IS NULL
              AND video_url IS NOT NULL
            ORDER BY id DESC LIMIT 20
        """), {"tid": tenant_id, "pcode": product_code}).fetchall()
        for voiceover_language, market, task_video_type in task_rows:
            saw_any = True
            if (task_video_type or "") == "产品展示":
                continue
            has_voiceover = True
            language = normalize_language(voiceover_language, market)
            if language:
                languages.add(language)
        if len(languages) == 1:
            return next(iter(languages)), True
        if languages:
            return None, True

    # 有记录且全部是「产品展示」→ 无口播；完全没记录 → 语言未知
    if saw_any and not has_voiceover:
        return None, False
    return None, True


def resolve_video_language(
    db: Any,
    tenant_id: int,
    video_urls: Sequence[str],
    explicit_language: Optional[str] = None,
    market: Optional[str] = None,
    video_type: Optional[str] = None,
    product_id: Optional[int] = None,
) -> Tuple[Optional[str], bool]:
    """解析视频语言：优先显式传入，其次按地址回查 AI 视频 / 高清处理任务。

    产品视频绑定时会由 TOS 复制改为「产品编码_序号」新地址，原地址只保留在
    绑定申请里；直接查不到时按 product_id 用绑定记录 / 产品 AI 任务兜底。

    返回 (语言, 是否有口播)：
    - (语言, True)  已识别语言
    - (None, False) 产品展示视频，无口播
    - (None, True)  语言无法识别（前端需弹确认框提醒人工核对）
    """
    if (video_type or "").strip() == "产品展示":
        # 产品展示视频无口播，不存在语言不匹配
        return None, False
    if explicit_language:
        language = normalize_language(explicit_language, market)
        if language:
            return language, True

    language, has_voiceover = _lookup_language_by_url(db, tenant_id, video_urls)
    if language:
        return language, True
    if not has_voiceover:
        return None, False
    if product_id:
        language, product_has_voiceover = _resolve_product_language(db, tenant_id, product_id)
        if language:
            return language, True
        if not product_has_voiceover:
            return None, False
    return None, True


def language_mismatch_detail(video_language: str, mismatches: List[Dict[str, str]]) -> Dict[str, Any]:
    """统一的 409 detail 结构，前端据 code=language_mismatch 弹出确认框。"""
    return {
        "code": "language_mismatch",
        "message": "视频语言与目标站点语言不匹配",
        "video_language": video_language,
        "mismatches": mismatches,
    }


def language_unknown_detail(sites: Sequence[Optional[str]]) -> Dict[str, Any]:
    """语言无法识别时的 409 detail，前端弹「请检查视频与站点语言」确认框。"""
    cleaned: List[str] = []
    seen = set()
    for site in sites:
        label = (site or "").strip()
        if label and label not in seen:
            seen.add(label)
            cleaned.append(label)
    return {
        "code": "language_unknown",
        "message": "系统无法识别视频语言，请检查视频和上传站点的语言是否匹配。",
        "sites": cleaned,
    }
