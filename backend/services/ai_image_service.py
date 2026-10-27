"""AI 商品套图生成服务（Qwen-Image-2.1 图生图，对接与 H3 共用的 ComfyUI API）

流程：参考图上传 TOS + ComfyUI → 按「生成类型 × 张数」展开子任务、逐个提交工作流
（不同 seed）→ 轮询 /history → 逐张下载 → 上传 TOS → 增量回写任务记录。

接口（均需 Basic Auth，复用 H3_* 配置）：
    POST /upload/image      上传参考图
    POST /prompt            提交任务（JSON 里是工作流）
    GET  /history/{任务ID}   查状态（完成后 GET /view 下载图片）
"""
import io
import json
import logging
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# 生成类型：key（前端/模板键）→ 中文名
GEN_TYPES: Dict[str, str] = {
    "white_background": "白底图",
    "scene": "场景图",
    "scene_person": "场景图（带人物）",
    "closeup": "特写图",
    "selling_point": "卖点图",
    "aplus": "A+图",
}

# 前端比例 → ComfyUI ResolutionSelector 选项字符串
# 2026-10-19 探测 /object_info/ResolutionSelector：8 项均在服务端 options 内（含 2:3/3:2/21:9）。
# 运行时以 _supported_ratio_options() 动态校验为准：选项缺失即报错，绝不静默降级到 1:1。
ASPECT_RATIO_MAP: Dict[str, str] = {
    "1:1": "1:1 (Square)",                 # 1248x1248
    "3:4": "3:4 (Portrait Standard)",      # 1088x1440
    "4:3": "4:3 (Standard)",               # 1440x1088
    "9:16": "9:16 (Portrait Widescreen)",  # 928x1664
    "16:9": "16:9 (Widescreen)",           # 1664x928
    "2:3": "2:3 (Portrait Photo)",
    "3:2": "3:2 (Photo)",
    "21:9": "21:9 (Ultrawide)",
}

# 各比例的数值（宽/高），用于「自适应」按参考图宽高比选最近项
RATIO_VALUES: Dict[str, float] = {
    "1:1": 1.0,
    "2:3": 2 / 3,
    "3:2": 1.5,
    "3:4": 0.75,
    "4:3": 4 / 3,
    "9:16": 9 / 16,
    "16:9": 16 / 9,
    "21:9": 21 / 9,
}

# ===== v2（2026-10-15）：A+ 与主副图分组 =====
# A+ 类型（单选）：gen_ratio=生成用比例（ResolutionSelector 支持项）；
# target_size=目标精确尺寸（Pillow 中心裁剪+缩放后处理，A+ 比例 2.44:1/1.62:1 不在节点选项内）
# megapixels=生成时的总像素（按 target_size 反推，避免无谓算力与超采样）
# - advanced 1464x600=0.88MP、目标比 2.44:1 → 用 21:9(2.33) 生成，中心裁剪仅损失约 4%
#   （旧配置 16:9(1.79) 需裁掉 26% 高度，主体/A+ 文案会被切）
APLUS_SPECS: Dict[str, Dict[str, Any]] = {
    "aplus_advanced": {"label": "高级A+图", "gen_ratio": "21:9", "target_size": (1464, 600),
                       "megapixels": 1.0},
    "aplus_normal":   {"label": "普通A+图", "gen_ratio": "16:9", "target_size": (970, 600),
                       "megapixels": 0.8},
    "aplus_mobile":   {"label": "手机A+图", "gen_ratio": "4:3",  "target_size": (600, 450),
                       "megapixels": 0.5},
}
# 主副图类型（多选）
# scene 与 scene_person 是「同一类型的两个变体」：scene 保留旧 key（历史任务回填依赖它），
# 语义收窄为「不带人物」；带人物另开 scene_person，因为两者的画面设计与合规约束完全不同。
MAIN_GEN_TYPES: Dict[str, str] = {
    "selling_point": "卖点图",
    "white_background": "白底图",
    "scene": "场景图（不带人物）",
    "scene_person": "场景图（带人物）",
    "closeup": "特写图",
    "closeup_white": "特写白底图",
}
# 品牌自定义设置选项（前端下拉用）
BRAND_OPTIONS: Dict[str, List[str]] = {
    "countries": ["US 美国", "CA 加拿大", "UK 英国", "DE 德国", "FR 法国",
                  "IT 意大利", "ES 西班牙", "JP 日本", "AU 澳大利亚"],
    "languages": ["英语", "德语", "法语", "意大利语", "西班牙语", "日语"],
    "platforms": ["亚马逊", "eBay", "独立站", "Temu", "Shein"],
    "font_styles": ["智能字体风格", "现代无衬线", "经典衬线", "圆润可爱", "硬朗工业"],
}

# 这三项缺失会让模型按自己偏好决定语境与文字语言，且详情页留空 —— 提交时统一补默认
DEFAULT_BRAND_SETTINGS: Dict[str, str] = {
    "country": "US 美国",
    "language": "英语",
    "platform": "亚马逊",
}


def _compile_brand_genes(bs: Optional[Dict[str, Any]]) -> str:
    """品牌设置 → 一行补充约束（只陈述，不展开成画面指令，避免压过 PE 的判断）"""
    if not bs:
        return ""
    parts = []
    if bs.get("main_color"):
        parts.append(f"主色调 {bs['main_color']}")
    if bs.get("font_style") and bs["font_style"] != "智能字体风格":
        parts.append(f"文字排版 {bs['font_style']}")
    if bs.get("custom_text"):
        parts.append(f"额外要求 {bs['custom_text']}")
    if bs.get("country"):
        parts.append(f"目标市场 {bs['country']}")
    if bs.get("language"):
        parts.append(f"画面文字语言 {bs['language']}")
    if bs.get("platform"):
        parts.append(f"发布平台 {bs['platform']}")
    return "；".join(parts)


def _fit_to_target(content: bytes, target: Tuple[int, int]) -> bytes:
    """A+ 图后处理：中心裁剪到目标宽高比 → 缩放到精确目标尺寸"""
    from io import BytesIO
    from PIL import Image as PILImage

    img = PILImage.open(BytesIO(content))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    tw, th = target
    tr = tw / th
    w, h = img.size
    r = w / h
    if abs(r - tr) > 0.01:
        if r > tr:      # 过宽 → 裁左右
            nw = int(h * tr)
            x = (w - nw) // 2
            img = img.crop((x, 0, x + nw, h))
        else:           # 过高 → 裁上下
            nh = int(w / tr)
            y = (h - nh) // 2
            img = img.crop((0, y, w, y + nh))
    img = img.resize((tw, th), PILImage.LANCZOS)
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


# 工作流节点编号（与 workflows/qwen_image_workflow.json 对应）
NODE_PROMPT = "571"        # PrimitiveStringMultiline，输入 value
NODE_REF_IMAGE = "475"     # LoadImage，输入 image
NODE_RESOLUTION = "13"     # ResolutionSelector，输入 aspect_ratio / megapixels
NODE_SEED = "502"          # rgthree Seed，输入 seed（-1 为随机，这里显式指定）
NODE_SAVE = "487"          # SaveImage，输入 filename_prefix
NODE_ENCODE = "497"        # TextEncodeQwenImage21，多图走 images.image_1..image_N（AUTOGROW）
NODE_PE = "565"            # TE_Qwen_Image_2_1_Prompt_Enhancer，多图走 图片/图片2..图片8
NODE_SCALE = "532"         # ImageScaleToTotalPixels，参考图统一到同一像素尺度

# 参考图上限：受 PE 节点可选输入约束（图片/图片2..图片8 共 8 个通道）。
# 编码器 images 通道虽支持 image_1..image_16，但第 9 张进不了 PE，故上限取 8。
MAX_REF_IMAGES = 8
# 单任务生成张数上限（A+ 张数 + 各主副图类型张数之和），防止一次性灌满 ComfyUI 队列
MAX_SHEETS_PER_TASK = 12
# 主副图默认生成像素（与工作流模板一致）
DEFAULT_MEGAPIXELS = 1.5

# ResolutionSelector 选项缓存（服务端能力探测，TTL 内复用，避免每张图都打 /object_info）
_RATIO_CACHE: Dict[str, Any] = {"at": 0.0, "options": None}
_RATIO_CACHE_TTL = 600
_ratio_lock = threading.Lock()

_running: set = set()
_lock = threading.Lock()
# 取消标记：轮询线程在每一轮开头检查，命中即停止回收未完成子项
_cancel_flags: set = set()
# 运行代号：同一任务每次执行（提交 / 重试）分配一个新代号，
# 旧线程落库前比对代号即可丢弃过期结果 —— 否则「取消后立刻重试」时，
# 旧线程跑完仍会写回「已完成」，覆盖重试的成果。
_run_tokens: Dict[int, int] = {}

# 用户级提交锁：「查有无活跃任务 → 插入新任务」是 check-then-insert，
# 双开页面/并发请求下两边都查不到活跃任务，会各自建单（用户级并发 1 失效）。
# 进程内锁对单 worker 足够；多 worker 需换 DB 唯一约束（同幂等实现备注）。
_user_submit_locks: Dict[int, threading.Lock] = {}
_user_locks_guard = threading.Lock()


def _user_submit_lock(user_id: int) -> threading.Lock:
    with _user_locks_guard:
        lock = _user_submit_locks.get(user_id)
        if lock is None:
            lock = _user_submit_locks[user_id] = threading.Lock()
        return lock


def _new_run_token(task_id: int) -> int:
    with _lock:
        tok = _run_tokens.get(task_id, 0) + 1
        _run_tokens[task_id] = tok
        return tok


def _is_current_token(task_id: int, token: int) -> bool:
    with _lock:
        return _run_tokens.get(task_id, 0) == token


def _is_cancelled(task_id: int) -> bool:
    with _lock:
        return task_id in _cancel_flags


def _clear_cancel(task_id: int) -> None:
    with _lock:
        _cancel_flags.discard(task_id)


# ComfyUI 串行队列：限制本服务同时轮询的任务数，与生视频互让
_slot_sem = threading.Semaphore(max(1, int(settings.IMAGE_MAX_CONCURRENT_TASKS)))

_MODELS_LOADED = False


def _ensure_models_loaded():
    """独立解释器（脚本/子进程）安全网：pkgutil 动态导入全部 models。

    项目已知坑：models/__init__.py 未导出全部模型类（缺 ProductSelection 等），
    Tenant 用字符串 relationship("ProductSelection")，若独立解释器只间接注册了
    少数类，首次 ORM 操作触发 mapper 全量配置即抛 InvalidRequestError。
    uvicorn 主进程经 database.init_db() 已导入全部模型，此处为幂等 no-op。
    """
    global _MODELS_LOADED
    if _MODELS_LOADED:
        return
    import pkgutil
    import models  # noqa: F401
    for m in pkgutil.iter_modules(models.__path__):
        __import__(f"models.{m.name}")
    _MODELS_LOADED = True


class AIImageError(Exception):
    """AI 生图异常"""
    pass


# 直连 ComfyUI：trust_env=False 绕过本地 HTTP 代理（实测代理隧道把 2MB 下载从 ~5s 拖到 11s+，
# 且偶发 502），同时复用 TCP 连接省掉每次 TLS 握手。每线程一个 Session（Session 非线程安全）。
_local = threading.local()


def _http_session() -> requests.Session:
    sess = getattr(_local, "session", None)
    if sess is None:
        sess = requests.Session()
        sess.trust_env = False
        _local.session = sess
    return sess


def _api(method: str, path: str, timeout: int = 60, **kwargs) -> requests.Response:
    """带 Basic Auth 的接口请求（复用连接、不走系统代理）"""
    url = settings.H3_BASE_URL.rstrip("/") + path
    resp = _http_session().request(
        method,
        url,
        auth=(settings.H3_AUTH_USER, settings.H3_AUTH_PASSWORD),
        timeout=timeout,
        **kwargs,
    )
    if resp.status_code == 401:
        raise AIImageError("ComfyUI 服务认证失败，请检查 H3 账号密码")
    resp.raise_for_status()
    return resp


def _supported_ratio_options(force: bool = False) -> Optional[List[str]]:
    """探测 ComfyUI ResolutionSelector 当前支持的 aspect_ratio 选项。

    返回选项字符串列表；服务不可达/节点缺失时返回 None（调用方自行决定放行还是报错）。
    结果缓存 TTL 10 分钟：节点装/卸不需要重启服务即可逐步生效。
    """
    now = time.time()
    with _ratio_lock:
        cached = _RATIO_CACHE.get("options")
        if not force and cached and now - float(_RATIO_CACHE.get("at") or 0) < _RATIO_CACHE_TTL:
            return list(cached)

    if not (settings.H3_BASE_URL or "").strip():
        return None
    try:
        info = _api("GET", "/object_info/ResolutionSelector", timeout=15).json()
        spec = (
            ((info.get("ResolutionSelector") or {}).get("input") or {})
            .get("required", {})
            .get("aspect_ratio")
        )
        options: Optional[List[str]] = None
        if isinstance(spec, list) and len(spec) >= 2 and isinstance(spec[1], dict):
            options = spec[1].get("options")
        if not options and isinstance(spec, list) and spec and isinstance(spec[0], list):
            options = spec[0]
        options = [str(o) for o in (options or [])]
        if not options:
            logger.warning("[AI生图] ResolutionSelector 未返回 aspect_ratio 选项")
            return None
        with _ratio_lock:
            _RATIO_CACHE["at"] = now
            _RATIO_CACHE["options"] = options
        return options
    except Exception as e:
        logger.warning(f"[AI生图] 探测比例选项失败（本次不校验）: {e}")
        return None


def resolve_ratio_label(aspect_ratio: str) -> str:
    """前端比例 key → ComfyUI 选项字符串；服务端不支持时**报错而不是降级**。"""
    label = ASPECT_RATIO_MAP.get(aspect_ratio)
    if not label:
        raise AIImageError(
            f"不支持的图片比例: {aspect_ratio}（可选：{'、'.join(ASPECT_RATIO_MAP)}）"
        )
    supported = _supported_ratio_options()
    if supported is not None and label not in supported:
        raise AIImageError(
            f"当前生图服务不支持 {aspect_ratio} 比例，请在比例卡片中改选"
            f"（服务端可用：{'、'.join(supported[:6])}…）"
        )
    return label


def _safe_text(value: Optional[str], limit: int) -> Optional[str]:
    """按数据库列宽截断，避免 MySQL 1406 Data too long 直接抛 500。

    前端已限制输入长度，但接口可被绕过；这里按列宽兜底而非报错（截断不改变语义）。
    """
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


# ComfyUI 原始报错 → 运营可读归因（按顺序命中，第一条优先）
_COMFY_ERROR_HINTS: List[Tuple[Tuple[str, ...], str]] = [
    (("out of memory", "oom", "allocation on device"), "显存不足：请减少单任务张数或降低生成像素后重试"),
    (("failed to load", "not found", "no such file", "checkpoint"), "模型缺失：生图服务端模型未加载，请联系管理员"),
    (("cannot identify image", "invalid image", "truncated", "broken data"), "参考图无法解析：请更换图片后重试"),
    (("timed out", "timeout", "connection reset", "connection refused"), "生图服务连接异常：请稍后重试"),
    (("invalid prompt", "validation", "required input"), "工作流参数校验失败：当前比例/张数组合不受支持"),
    (("cuda", "device"), "生图服务 GPU 异常：请联系管理员检查服务状态"),
]


def humanize_comfy_error(raw: Optional[str]) -> str:
    """把 ComfyUI 的英文报错归因成一句中文处置建议；无法归因返回空串。"""
    text = (raw or "").lower()
    if not text:
        return ""
    for keys, hint in _COMFY_ERROR_HINTS:
        if any(k in text for k in keys):
            return hint
    return ""


def _to_jpeg(content: bytes, filename: str, quality: int = 95) -> Tuple[bytes, str]:
    """回传前把 PNG 转 JPEG。

    外网带宽是瓶颈（实测 2.09MB PNG 下载 5.5s、回传 TOS 约 6.8s）；
    1248x1248 转 q=95 后约 0.29MB（14%），单张可省约 6s，多张任务线性放大。
    转换失败时回退原图，不阻塞任务。
    """
    try:
        from io import BytesIO
        from PIL import Image as PILImage

        img = PILImage.open(BytesIO(content))
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        return buf.getvalue(), filename.rsplit(".", 1)[0] + ".jpg"
    except Exception as e:
        logger.warning(f"[AI生图] 转 JPEG 失败，回传原图: {e}")
        return content, filename


def _normalize_for_comfy(content: bytes) -> bytes:
    """上传前统一压成 JPEG（长边 ≤2048、透明底合成白底），与生视频同策略"""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(content))
        img.load()
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            rgba = img.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        w, h = img.size
        if max(w, h) > 2048:
            scale = 2048 / float(max(w, h))
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90, optimize=True)
        return buf.getvalue()
    except Exception:
        return content


# 主参考图长边下限：低于此值模型开始编造细节（实测 175px 缩略图把皇冠认成海滩套装）
_MIN_MAIN_IMAGE_SIDE = 512


def _image_area(content: bytes) -> int:
    """参考图像素数；解码失败返回 0（按最不清晰处理）"""
    try:
        from io import BytesIO
        from PIL import Image as PILImage

        with PILImage.open(BytesIO(content)) as im:
            return im.size[0] * im.size[1]
    except Exception:
        return 0


def _order_images_by_clarity(images: List[Tuple[str, bytes]]) -> List[Tuple[str, bytes]]:
    """把像素最大的参考图排到第一位（同尺寸保持原顺序）。

    主参考图决定 local 的 LoadImage(475)/PE「图片」与 relay 的看图设计。
    产品库首图常是亚马逊 `_SL75_` 缩略图（175x175 / 2KB），实测会让模型把
    「金色月桂皇冠 4 件套」认成「海滩度假套装」——商品信息、件数清单、提示词全错。
    排序后主图自动取 1080x1080 那张。
    """
    if len(images) < 2:
        return list(images)
    indexed = list(enumerate(images))
    indexed.sort(key=lambda x: (-_image_area(x[1][1]), x[0]))
    return [item for _i, item in indexed]


def _upload_image(idx: int, content: bytes) -> str:
    """上传参考图到 ComfyUI，返回服务器端文件名；失败自动重试一次"""
    name = f"aiimage-{int(time.time() * 1000)}-{idx}.jpg"
    content = _normalize_for_comfy(content)

    last_err: Optional[str] = None
    for attempt in (1, 2):
        try:
            resp = _api(
                "POST",
                "/upload/image",
                files={"image": (name, content)},
                data={"overwrite": "true"},
            )
            return resp.json()["name"]
        except Exception as e:
            last_err = str(e)
            logger.warning(f"[AI生图] 参考图上传第 {attempt} 次失败: {last_err}")
            threading.Event().wait(2)

    raise AIImageError(f"参考图上传失败（已重试）: {last_err}")


def _load_prompt_templates() -> Dict[str, Dict[str, str]]:
    """读取生成类型提示词模板（运营可直接调优 JSON，无需改代码）

    `IMAGE_LOCAL_HARDENED_PROMPT=False` 时回退 v3 轻量版
    （v3 是「画面语言完全交给 PE」的老假设，保留以便一键撤回）。
    """
    path = settings.IMAGE_PROMPT_TEMPLATES_PATH
    if not bool(getattr(settings, "IMAGE_LOCAL_HARDENED_PROMPT", True)):
        legacy = path.replace(".json", "_v3.json")
        if os.path.exists(legacy):
            path = legacy
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise AIImageError(f"读取提示词模板失败: {e}")


# 带人物场景的差异化矩阵（中文版，本地链路用）：按 seq 轮换，
# 只描述构图/姿态/光线（与商品无关的部分），**不指定环境**——场景主题交给 PE
# 按「商品风格」自行设计（2026-10-26 裁定：环境指定曾导致草莓书包配石柱廊）。
PERSON_VARIATIONS_CN: List[Dict[str, str]] = [
    {
        "framing": "半身，正面 3/4 角度",
        "pose": "站姿自然，一只手垂在体侧，另一只手轻触商品所在位置",
        "light": "左侧低角度晨光，发丝带柔和轮廓光",
    },
    {
        "framing": "七分身，行走中",
        "pose": "迈步向前，手臂自然摆动，商品随动作显出且不被遮挡",
        "light": "黄昏逆光，头发边缘发光，空气略带薄雾",
    },
    {
        "framing": "近景（胸部以上到商品所在部位的局部）",
        "pose": "侧脸低头，一只手抬起整理商品，动作自然不做作",
        "light": "阴天柔和侧光，方向明确，均匀照亮材质纹理与金属件",
    },
    {
        "framing": "3/4 背面回眸",
        "pose": "转身回看镜头，一只手抬起轻搭在商品所在位置",
        "light": "暖色轮廓光勾出肩背剪影边缘",
    },
]


def _build_prompt(gen_type: str, product_info: str, extra_prompt: str,
                  brand_genes: str = "",
                  variation: Optional[Dict[str, str]] = None) -> str:
    """拼接原始提示词（轻量版）。

    PE 的「图片」输入接了参考图，它能看到商品形态与组合关系，会自行生成镜头/光线/构图。
    原始提示词只负责三件事：要什么类型的图、图片上看不出来的商品事实、必须保留的不变量。
    写死焦段/光圈/色温/构图占比反而会与 PE 的判断冲突（实测导致「蛋糕装饰」被拆成桌面摆件）。
    用 replace 而非 format，避免用户文本中的花括号报错。
    """
    templates = _load_prompt_templates()
    tpl = templates.get(gen_type, {}).get("template")
    if not tpl:
        raise AIImageError(f"生成类型 {gen_type} 缺少提示词模板")

    info = (product_info or "").strip() or "（未提供，请以参考图可见特征为准）"
    extra = (extra_prompt or "").strip()
    out = tpl.replace("{product_info}", info)
    out = out.replace("{extra_prompt}", f"\n补充要求：{extra}" if extra else "")
    if brand_genes:
        out += f"\n品牌与区域：{brand_genes}"
    if variation:
        parts = [
            f"构图 {variation['framing']}",
            f"姿态 {variation['pose']}",
            f"光线 {variation['light']}",
        ]
        if variation.get("setting"):
            parts.append(f"环境 {variation['setting']}")
        out += (
            "\n本张要求（与其他张必须不同）：" + "；".join(parts) + "。"
            "\n（其中「商品所在位置」按该商品实际的佩戴/使用部位理解，"
            "例如头饰在头部、腰带或腰包在腰部、护腕手镯在手腕、摆件在台面；"
            "场景环境由你按商品风格设计，不另行指定。）"
        )
    return out


_SPEED_CHAIN_CHECKED = False


def _warn_if_speed_chain_broken(wf: Dict[str, Any]) -> None:
    """加速链完整性自检（只告警一次，不阻断生成）。

    正式调用流的模型链：476 UNETLoader → 649 TESpeedQwenImage21 → 483 QwenImage21Cache → 481 KSampler。
    若运营替换工作流后丢了 649，任务仍能出图但会明显变慢且无人察觉 —— 实测关闭该节点
    单张 1:1@1MP 从 42.2s 增至 57.3s（-26%），故此处兜底告警。
    """
    global _SPEED_CHAIN_CHECKED
    if _SPEED_CHAIN_CHECKED:
        return
    _SPEED_CHAIN_CHECKED = True
    ok = (
        isinstance(wf.get("649"), dict)
        and ((wf.get("483") or {}).get("inputs") or {}).get("model") == ["649", 0]
        and ((wf.get("481") or {}).get("inputs") or {}).get("model") == ["483", 0]
    )
    if not ok:
        logger.warning(
            "[AI生图] 工作流加速链不完整（期望 476→649 TESpeed→483 Cache→481），"
            "生图会明显变慢；请检查 workflow 是否误删加速节点"
        )


def _build_workflow(
    *,
    prompt: str,
    aspect_ratio: str,
    seed: int,
    image_names: List[str],
    filename_prefix: str,
    megapixels: float = DEFAULT_MEGAPIXELS,
) -> Dict[str, Any]:
    """读取工作流模板并填入本次生成参数（switch=true 走 EmptyLatentImage 生图路径）

    多参考图：模板只接了 1 个 LoadImage(475) → 532 → 497.images.image_1 / 565.图片。
    这里按张数动态注入 LoadImage + ImageScaleToTotalPixels 节点，并挂到
    497 的 AUTOGROW 通道 images.image_N 与 PE 的 图片N（N=2..8）。
    """
    if not image_names:
        raise AIImageError("参考图为空")
    if len(image_names) > MAX_REF_IMAGES:
        raise AIImageError(f"最多 {MAX_REF_IMAGES} 张参考图")

    try:
        with open(settings.IMAGE_WORKFLOW_PATH, encoding="utf-8") as f:
            wf = json.load(f)
    except Exception as e:
        raise AIImageError(f"读取生图工作流模板失败: {e}")

    wf[NODE_PROMPT]["inputs"]["value"] = prompt
    wf[NODE_REF_IMAGE]["inputs"]["image"] = image_names[0]
    # 比例：服务端不支持时抛错（不静默降级 1:1）
    wf[NODE_RESOLUTION]["inputs"]["aspect_ratio"] = resolve_ratio_label(aspect_ratio)
    wf[NODE_RESOLUTION]["inputs"]["megapixels"] = float(megapixels)
    wf[NODE_SEED]["inputs"]["seed"] = int(seed)
    wf[NODE_SAVE]["inputs"]["filename_prefix"] = filename_prefix
    # UNET/CLIP/VAE/KSampler/增强器等固定节点均以模板为准，代码不再覆盖

    # 额外参考图：每张一个 LoadImage + 尺度对齐节点（与主图 532 同像素，避免尺度不一致）
    for i, name in enumerate(image_names[1:], start=2):
        load_id, scale_id = str(9000 + i), str(9100 + i)
        wf[load_id] = {
            "inputs": {"image": name},
            "class_type": "LoadImage",
            "_meta": {"title": f"加载参考图{i}"},
        }
        wf[scale_id] = {
            "inputs": {
                "upscale_method": "lanczos",
                "megapixels": DEFAULT_MEGAPIXELS,
                "resolution_steps": 32,
                "image": [load_id, 0],
            },
            "class_type": "ImageScaleToTotalPixels",
            "_meta": {"title": f"参考图{i}尺度对齐"},
        }
        wf[NODE_ENCODE]["inputs"][f"images.image_{i}"] = [scale_id, 0]
        wf[NODE_PE]["inputs"][f"图片{i}"] = [scale_id, 0]

    # PE 节点参数按配置注入（workflow 文件里的值可被 .env 覆盖，便于一键回退）
    pe_node = wf.get(NODE_PE)
    if isinstance(pe_node, dict):
        pe_inputs = pe_node.setdefault("inputs", {})
        pe_lang = (getattr(settings, "IMAGE_LOCAL_PE_LANGUAGE", "") or "").strip()
        if pe_lang:
            pe_inputs["输出语言"] = pe_lang
        pe_inputs["生成后自动卸载模型"] = bool(
            getattr(settings, "IMAGE_LOCAL_PE_UNLOAD", True)
        )

    _warn_if_speed_chain_broken(wf)
    return wf


def _extract_output_file(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """从 ComfyUI 任务结果中取出图片文件信息"""
    finfo = None
    for node_out in (item.get("outputs") or {}).values():
        for key in ("images", "gifs"):
            for f in node_out.get(key) or []:
                finfo = f
    return finfo


def _download_image(finfo: Dict[str, Any]) -> Tuple[bytes, str]:
    """下载生成图片，返回 (字节内容, 文件名)"""
    resp = _api("GET", "/view", timeout=300, params=finfo)
    return resp.content, finfo.get("filename") or "output.png"


def _comfy_gen_seconds(item: Dict[str, Any]) -> Optional[float]:
    """ComfyUI 实际执行时长（execution_start → execution_success），**不含排队时间**。

    用于回答「这张图到底跑了多久」：端到端含排队，队列被视频任务占用时会失真；
    history 里的时间戳才是模型真实耗时（冷启动会明显大于热态基线）。
    """
    msgs = ((item.get("status") or {}).get("messages") or [])
    t_start = t_end = None
    for m in msgs:
        if not isinstance(m, (list, tuple)) or len(m) < 2:
            continue
        ev, data = m[0], m[1] if isinstance(m[1], dict) else {}
        ts = data.get("timestamp")
        if not ts:
            continue
        if ev == "execution_start" and t_start is None:
            t_start = ts
        elif ev == "execution_success":
            t_end = ts
    if t_start and t_end and t_end >= t_start:
        return round((t_end - t_start) / 1000.0, 2)
    return None


def _update_task(task_id: int, **fields) -> None:
    """独立会话更新任务记录（后台线程中使用）"""
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        db.query(AIImageTask).filter(AIImageTask.id == task_id).update(fields)
        db.commit()
    except Exception as e:
        logger.error(f"[AI生图] 更新任务 {task_id} 状态失败: {e}")
        db.rollback()
    finally:
        db.close()


def _read_json_list(raw: Optional[str]) -> List[Dict[str, Any]]:
    try:
        return json.loads(raw) if raw else []
    except Exception:
        return []


# result_images 是 MySQL Text（65535 字节）。子项带上 final_prompt / prompt_cn /
# enhanced_prompt 后，长商品信息（product_info 允许 5000 字符 ≈ 15KB）+ 多类型任务
# 会超限，写库抛 1406 被 _update_task 吞成一行日志 —— 表现为「图已生成但任务永远
# 停在生成中」，直到 30 分钟超时才失败。所有写库点统一走 _dump_items 裁剪。
_RESULT_JSON_BUDGET = 48000     # 留 ~17KB 余量给列宽与转义膨胀
_PROMPT_FIELD_LIMIT = 3000      # 单条提示词落库上限（中文 UTF-8 三字节，再长没意义）
_PROMPT_CN_LIMIT = 800
_INVENTORY_MAX_ITEMS = 10


def _clip_text(value: Optional[str], limit: int) -> Optional[str]:
    if not value or limit <= 0:
        return None
    text = str(value)
    return text if len(text) <= limit else text[:limit] + "…"


def _dump_items(items: List[Dict[str, Any]]) -> str:
    """序列化 result_images：按总字节预算逐级收缩提示词。

    status/url/error 是业务字段，永不裁剪；提示词只用于详情展示，
    收缩到极短仍超预算时才整体丢弃（12 张 × 超长中文商品信息才会走到这一步）。
    """
    sources = [dict(it) for it in (items or [])]

    def render(limit: int, cn_limit: int, keep_inventory: bool) -> str:
        rows: List[Dict[str, Any]] = []
        for src in sources:
            row = dict(src)
            for key in ("final_prompt", "enhanced_prompt"):
                if key in row:
                    row[key] = _clip_text(row.get(key), limit)
            if "prompt_cn" in row:
                row["prompt_cn"] = _clip_text(row.get("prompt_cn"), cn_limit)
            inv = row.get("inventory")
            if isinstance(inv, list):
                row["inventory"] = inv[:_INVENTORY_MAX_ITEMS] if keep_inventory else None
            rows.append(row)
        return json.dumps(rows, ensure_ascii=False)

    raw = render(_PROMPT_FIELD_LIMIT, _PROMPT_CN_LIMIT, True)
    if len(raw.encode("utf-8")) <= _RESULT_JSON_BUDGET:
        return raw

    # 超预算：逐级缩短提示词（保留部分内容远好于整段丢弃）
    for limit in (1500, 800, 400, 200):
        raw = render(limit, min(_PROMPT_CN_LIMIT, limit), True)
        if len(raw.encode("utf-8")) <= _RESULT_JSON_BUDGET:
            logger.warning(
                f"[AI生图] result_images 超预算，提示词已收缩到 {limit} 字符"
                f"（{len(sources)} 个子项，{len(raw.encode('utf-8'))} 字节）"
            )
            return raw

    # 最后一档：丢提示词与清单，保住状态与图片地址
    raw = render(0, 0, False)
    logger.warning(
        f"[AI生图] result_images 极端超预算，已丢弃提示词"
        f"（{len(sources)} 个子项，{len(raw.encode('utf-8'))} 字节）"
    )
    return raw


def _aggregate_status(items: List[Dict[str, Any]]) -> str:
    """根据子项状态聚合任务级状态"""
    statuses = [it.get("status") for it in items]
    if not statuses:
        return "生成中"
    if all(s == "已完成" for s in statuses):
        return "已完成"
    if all(s == "失败" for s in statuses):
        return "失败"
    if all(s == "已取消" for s in statuses):
        return "已取消"
    # 仍有子项在排队/生成中 → 任务整体仍在进行
    if any(s in ("排队中", "生成中") for s in statuses):
        return "生成中"
    # 全部到达终态且有成功有失败（或含取消）
    return "部分完成"


def _finalize_status(task_id: int, agg: str) -> str:
    """中转站线程收尾时保住「已取消」终态。

    relay 取消是「先落终态、线程继续跑完 HTTP」：线程收尾若把 status 写成
    「部分完成」，前端（已停止轮询）刷新后会看到终态被翻回，以为取消失败。
    已全部完成（agg="已完成"）则如实显示完成 —— 事实比取消指令更准确。
    """
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        current = db.query(AIImageTask.status).filter(AIImageTask.id == task_id).scalar()
    except Exception:
        current = None
    finally:
        db.close()
    if current == "已取消" and agg != "已完成":
        return "已取消"
    return agg


def _pick_retry_targets(
    items: List[Dict[str, Any]], indices: Optional[List[int]], retryable: Tuple[str, ...]
) -> List[int]:
    """选出可重试子项下标：去重 + 越界/非可重试过滤。

    indices 来自前端且可为任意值（含重复与越界）；同一张图被提交两次会白花一次生成费。
    """
    if indices:
        return list(dict.fromkeys(
            i for i in indices
            if isinstance(i, int) and 0 <= i < len(items)
            and items[i].get("status") in retryable
        ))
    return [i for i, it in enumerate(items) if it.get("status") in retryable]


def _run_task(task_id: int, comfy_prompt_ids: List[str],
              index_map: Optional[Dict[str, int]] = None) -> None:
    """后台线程：轮询本任务全部子项的 ComfyUI 状态，逐张完成后下载并上传 TOS

    comfy_prompt_ids 与 result_images 按下标一一对应；
    index_map 用于「只重试部分子项」：{prompt_id: result_images 下标}。
    """
    from services import tos_service

    logger.info(f"[AI生图] 任务 {task_id} 开始轮询，{len(comfy_prompt_ids)} 个子项")
    interval = max(3, int(settings.IMAGE_POLL_INTERVAL))
    max_polls = max(1, int(settings.IMAGE_MAX_WAIT_MINUTES * 60 / interval))
    token = _new_run_token(task_id)

    with _slot_sem:
        try:
            pending = dict(index_map) if index_map else {
                pid: i for i, pid in enumerate(comfy_prompt_ids)
            }
            started_written = False
            cancelled = False
            abandoned = False
            t_poll_start = time.time()
            t_all_done: Optional[float] = None
            download_cost = 0.0
            poll_count = 0

            for _ in range(max_polls):
                if not pending:
                    break
                if _is_cancelled(task_id):
                    cancelled = True
                    break
                if not _is_current_token(task_id, token):
                    abandoned = True
                    logger.info(f"[AI生图] 任务 {task_id} 已被新的执行接管，旧轮询退出")
                    break
                # 首轮立即查询，不白等一个 interval（单张任务可省 2s 感知延迟）
                if poll_count:
                    threading.Event().wait(interval)
                poll_count += 1
                for pid in list(pending.keys()):
                    try:
                        history = _api("GET", f"/history/{pid}").json()
                    except Exception as e:
                        logger.warning(f"[AI生图] 任务 {task_id} 查询 {pid[:8]} 失败: {e}")
                        continue
                    item = history.get(pid)
                    if item is None:
                        continue  # 排队/执行中，保持现状

                    status_str = (item.get("status") or {}).get("status_str")
                    idx = pending[pid]

                    # 回读最新 result_images 再改写，避免覆盖其它子项的增量更新
                    db = None
                    from database.database import SessionLocal
                    from models.ai_image_task import AIImageTask
                    db = SessionLocal()
                    try:
                        task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
                        items = _read_json_list(task.result_images if task else None)
                        if idx >= len(items):
                            continue

                        def _save(sub: Dict[str, Any], extra: Dict[str, Any]) -> None:
                            nonlocal started_written
                            items[idx] = sub
                            agg = _aggregate_status(items)
                            fields = {
                                "result_images": _dump_items(items),
                                "status": agg,
                            }
                            if agg in ("已完成", "部分完成", "失败", "已取消") and all(
                                s in ("已完成", "失败", "已取消")
                                for s in [it.get("status") for it in items]
                            ):
                                fields["finished_at"] = datetime.now()
                            if agg == "生成中" and not started_written:
                                fields["started_at"] = datetime.now()
                                started_written = True
                            db.query(AIImageTask).filter(AIImageTask.id == task_id).update(fields)
                            db.commit()

                        if status_str == "success":
                            finfo = _extract_output_file(item)
                            if not finfo:
                                sub = dict(items[idx], status="失败", error="生成完成但未找到输出文件")
                                _save(sub, {})
                                logger.error(f"[AI生图] 任务 {task_id} 子项 {idx} 无输出文件")
                            else:
                                _dl_t0 = time.time()
                                content, filename = _download_image(finfo)
                                _ts = (items[idx] or {}).get("target_size")
                                if _ts and len(_ts) == 2:
                                    try:
                                        content = _fit_to_target(content, tuple(_ts))
                                        filename = filename.rsplit(".", 1)[0] + ".png"
                                    except Exception as fit_err:
                                        logger.warning(f"[AI生图] 任务 {task_id} 子项 {idx} 裁剪失败（用原图）: {fit_err}")
                                # 回传前转 JPEG：外网带宽是瓶颈，体积约为 PNG 的 14%
                                content, filename = _to_jpeg(content, filename)
                                url = tos_service.upload_file(
                                    content, filename, content_type="image/jpeg", subdir="ai-image",
                                )
                                download_cost += time.time() - _dl_t0
                                # 生成当下取一次 PE 输出并落库：ComfyUI /history 会过期，
                                # 只靠查询会让历史任务的提示词在几天后变成空白
                                enhanced = ""
                                try:
                                    info = get_comfy_prompt_history(pid)
                                    enhanced = info.get("enhanced_prompt") or ""
                                except Exception as eh:
                                    logger.warning(
                                        f"[AI生图] 任务 {task_id} 子项 {idx} 取 PE 提示词失败: {eh}"
                                    )
                                sub = dict(
                                    items[idx], status="已完成", url=url, error=None,
                                    enhanced_prompt=enhanced or None,
                                    # ComfyUI 真实执行时长（不含排队），用于排查「为什么这么久」
                                    gen_seconds=_comfy_gen_seconds(item),
                                )
                                _save(sub, {})
                                logger.info(
                                    f"[AI生图] 任务 {task_id} 子项 {idx} 完成: {url}"
                                    f" | ComfyUI 执行 {sub.get('gen_seconds')}s"
                                )
                            del pending[pid]
                        elif status_str in ("error", "failed"):
                            msgs = json.dumps(
                                (item.get("status") or {}).get("messages", []), ensure_ascii=False
                            )[:400]
                            hint = humanize_comfy_error(msgs)
                            err_text = (
                                f"{hint}（原始日志：{msgs}）" if hint else (msgs or "生成失败")
                            )
                            sub = dict(items[idx], status="失败", error=err_text)
                            _save(sub, {})
                            logger.error(f"[AI生图] 任务 {task_id} 子项 {idx} 失败: {msgs}")
                            del pending[pid]
                        else:
                            # history 里但仍在执行 → 首次改「生成中」
                            if items[idx].get("status") == "排队中":
                                items[idx] = dict(items[idx], status="生成中")
                                fields = {
                                    "result_images": _dump_items(items),
                                    "status": "生成中",
                                }
                                if not started_written:
                                    fields["started_at"] = datetime.now()
                                    started_written = True
                                db.query(AIImageTask).filter(AIImageTask.id == task_id).update(fields)
                                db.commit()
                    except Exception as e:
                        logger.error(f"[AI生图] 任务 {task_id} 子项 {idx} 处理异常: {e}")
                    finally:
                        if db is not None:
                            db.close()

            if not pending:
                t_all_done = time.time()

            # 兜底：取消或超时后，仍在排队的子项落到终态
            # abandoned：本线程已被更新的执行（重试）接管，不能落任何终态，否则会覆盖新结果
            if pending and not abandoned:
                from database.database import SessionLocal
                from models.ai_image_task import AIImageTask
                db = SessionLocal()
                try:
                    task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
                    items = _read_json_list(task.result_images if task else None)
                    changed = False
                    final_status = "已取消" if cancelled else "失败"
                    reason = "任务已取消" if cancelled else (
                        f"生成超时（超过 {settings.IMAGE_MAX_WAIT_MINUTES} 分钟）"
                    )
                    for pid, idx in pending.items():
                        if idx < len(items) and items[idx].get("status") not in (
                            "已完成", "失败", "已取消"
                        ):
                            items[idx] = dict(items[idx], status=final_status, error=reason)
                            changed = True
                    if changed:
                        db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
                            "result_images": _dump_items(items),
                            "status": _aggregate_status(items),
                            "finished_at": datetime.now(),
                        })
                        db.commit()
                finally:
                    db.close()
                if cancelled:
                    logger.info(f"[AI生图] 任务 {task_id} 已取消，{len(pending)} 个子项标记已取消")
                else:
                    logger.error(f"[AI生图] 任务 {task_id} 等待超时，{len(pending)} 个子项标记失败")
                    # 超时 != 图没出来：ComfyUI 可能稍后才跑完，交后台继续捞
                    threading.Thread(
                        target=_recover_timed_out,
                        args=(task_id, token, dict(pending)),
                        daemon=True, name=f"ai-image-recover-{task_id}",
                    ).start()
                    logger.info(
                        f"[AI生图] 任务 {task_id} 已排入超时结果回收"
                        f"（+{ '/+'.join(str(d) for d in _TIMEOUT_RECOVERY_DELAYS) } 秒各查一次）"
                    )
            else:
                if abandoned:
                    pass  # 已被新执行接管，不做任何收尾写库
                elif not pending:
                    # 分段耗时：定位端到端开销（轮询等待 vs 下载回传）
                    if t_all_done is None:
                        t_all_done = time.time()
                    logger.info(
                        f"[AI生图] 任务 {task_id} 全部子项处理完毕 | 轮询等待 "
                        f"{t_all_done - t_poll_start:.1f}s | 下载+回传TOS {download_cost:.1f}s "
                        f"| 轮询 {poll_count} 次"
                    )
        except Exception as e:
            logger.error(f"[AI生图] 任务 {task_id} 轮询异常: {e}")
            _update_task(task_id, status="失败", error_message=str(e)[:900],
                         finished_at=datetime.now())
        finally:
            with _lock:
                _running.discard(task_id)
                _cancel_flags.discard(task_id)


# ComfyUI 不会因为我们停止轮询而停止执行：队列被视频生成/超分占用时，
# 常见「判定超时 → 几分钟后图才出来」。不回收的话图只留在 ComfyUI 的 output
# 目录里，用户看到的是假失败（2026-10-26 实测任务 #57：15:46 判超时，
# ComfyUI 随后 success，产出 AIIMG-57-scene-0_00001_.png 无人认领）。
_TIMEOUT_RECOVERY_DELAYS = (300, 900, 1800)


def _should_reclaim_item(cur: Dict[str, Any]) -> bool:
    """该子项是否值得回收：只有「超时失败」才可以。

    重试已接手（排队中）、已回收（已完成）、用户取消（已取消）都不能动，
    否则会把重试后的新结果覆盖成旧图。
    """
    return cur.get("status") == "失败" and "超时" in str(cur.get("error") or "")


def _recover_timed_out(task_id: int, token: int, pending: Dict[str, int],
                       delays: Optional[Tuple[int, ...]] = None) -> None:
    """超时判定后继续尝试回收已生成的图（最多 3 轮）。

    只在「本执行仍是当前代号」且「该子项仍是超时失败」时改写，
    避免把重试后的新结果覆盖掉。
    """
    from services import tos_service
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    left = dict(pending)
    for round_no, delay in enumerate(delays or _TIMEOUT_RECOVERY_DELAYS, start=1):
        threading.Event().wait(delay)
        if not left:
            return
        if not _is_current_token(task_id, token):
            logger.info(f"[AI生图] 任务 {task_id} 超时回收退出（已有更新的执行）")
            return

        for pid in list(left.keys()):
            idx = left[pid]
            try:
                history = _api("GET", f"/history/{pid}", timeout=30).json()
            except Exception as e:
                logger.warning(f"[AI生图] 任务 {task_id} 超时回收查询 {pid[:8]} 失败: {e}")
                continue
            item = history.get(pid)
            if not item:
                continue                      # 仍在排队/执行，下一轮再看
            if (item.get("status") or {}).get("status_str") != "success":
                left.pop(pid, None)           # 明确失败或中断，不再等
                continue
            finfo = _extract_output_file(item)
            if not finfo:
                left.pop(pid, None)
                continue

            db = SessionLocal()
            try:
                task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
                if not task:
                    return
                items = _read_json_list(task.result_images)
                if idx >= len(items):
                    left.pop(pid, None)
                    continue
                cur = items[idx]
                # 只回收「超时失败」的子项：重试已接手 / 已回收 / 已取消都不动
                if not _should_reclaim_item(cur):
                    left.pop(pid, None)
                    continue
                if _is_cancelled(task_id):
                    logger.info(f"[AI生图] 任务 {task_id} 已取消，放弃超时回收")
                    return

                content, filename = _download_image(finfo)
                ts = cur.get("target_size")
                if ts and len(ts) == 2:
                    try:
                        content = _fit_to_target(content, tuple(ts))
                        filename = filename.rsplit(".", 1)[0] + ".png"
                    except Exception as fit_err:
                        logger.warning(f"[AI生图] 任务 {task_id} 回收裁剪失败（用原图）: {fit_err}")
                content, filename = _to_jpeg(content, filename)
                url = tos_service.upload_file(
                    content, filename, content_type="image/jpeg", subdir="ai-image",
                )
                enhanced = ""
                try:
                    enhanced = (get_comfy_prompt_history(pid) or {}).get("enhanced_prompt") or ""
                except Exception:
                    pass
                items[idx] = dict(
                    cur, status="已完成", url=url, error=None,
                    enhanced_prompt=enhanced or cur.get("enhanced_prompt"),
                    gen_seconds=_comfy_gen_seconds(item),
                )
                agg = _finalize_status(task.status or "", _aggregate_status(items))
                db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
                    "result_images": _dump_items(items),
                    "status": agg,
                    "finished_at": datetime.now(),
                    "error_message": None,
                })
                db.commit()
                left.pop(pid, None)
                logger.warning(
                    f"[AI生图] 任务 {task_id} 超时回收成功：子项 {idx}（第 {round_no} 轮，"
                    f"延迟 {delay}s）→ 任务状态 {agg}"
                )
            except Exception as e:
                logger.error(f"[AI生图] 任务 {task_id} 超时回收子项 {idx} 失败: {e}")
            finally:
                db.close()


def _ensure_worker(task_id: int, comfy_prompt_ids: Optional[List[str]] = None, *,
                   prep_kwargs: Optional[Dict[str, Any]] = None,
                   index_map: Optional[Dict[str, int]] = None) -> None:
    """确保某任务有后台线程在跑（避免重复启动）"""
    with _lock:
        if task_id in _running:
            return
        _running.add(task_id)
    if prep_kwargs is not None:
        threading.Thread(
            target=_prepare_and_run, args=(task_id,), kwargs=prep_kwargs,
            daemon=True, name=f"ai-image-task-{task_id}",
        ).start()
    else:
        threading.Thread(
            target=_run_task, args=(task_id, comfy_prompt_ids or []),
            kwargs={"index_map": index_map},
            daemon=True, name=f"ai-image-task-{task_id}",
        ).start()


def submit_image_task(
    *,
    tenant_id: int,
    user_id: int,
    creator_name: str = "",
    title: str,
    generation_types: List[str] = None,
    aspect_ratio: str = "1:1",
    image_count: int = 1,
    product_info: str = "",
    prompt: str = "",
    images: List[Tuple[str, bytes]],
    product_code: str = "",
    product_name: str = "",
    # ===== v2 分组参数（优先；为空时兼容 v1 旧参数）=====
    aplus_type: Optional[str] = None,
    main_types: Optional[List[str]] = None,
    main_aspect_ratio: Optional[str] = None,
    brand_settings: Optional[Dict[str, Any]] = None,
    provider: str = "local",
) -> Dict[str, Any]:
    """提交套图生成任务：落库后立即返回，准备与轮询全部在后台线程

    :param generation_types: 生成类型 key 列表（GEN_TYPES 的子集）
    :param images: [(文件名, 图片字节)]，1~8 张参考图
    """
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    if not images:
        raise AIImageError("请至少上传一张参考图")
    if len(images) > MAX_REF_IMAGES:
        raise AIImageError(f"最多上传 {MAX_REF_IMAGES} 张参考图")

    # 品牌/区域设置兜底：这三项决定画面语境与文字语言，缺省就用默认值，
    # 保证「未填」也一定会进提示词（否则模型按自己的偏好出图，且详情页显示空白）
    brand_settings = dict(brand_settings or {})
    for _k, _v in DEFAULT_BRAND_SETTINGS.items():
        if not str(brand_settings.get(_k) or "").strip():
            brand_settings[_k] = _v

    # 生成通道：local=本地 ComfyUI（Qwen Image 2.1）/ relay=中转站（Nano Banana 2）
    provider = (provider or "local").strip().lower()
    if provider not in ("local", "relay"):
        raise AIImageError(f"不支持的生成模型: {provider}")
    if provider == "relay":
        from services import relay_image_service
        if not relay_image_service.is_configured():
            raise AIImageError("中转站模型未配置（缺少 IMAGE_RELAY_API_BASE / IMAGE_RELAY_API_KEY）")
    image_count = min(max(1, int(image_count)), 4)

    # ===== v2 分组解析（兼容 v1：未传新参数时由旧参数映射）=====
    if aplus_type is None and main_types is None:
        legacy = [t for t in (generation_types or []) if t in MAIN_GEN_TYPES]
        main_types = legacy or None
        main_aspect_ratio = aspect_ratio
        if "aplus" in (generation_types or []):
            logger.warning("[AI生图] v1 调用含旧 'aplus' 类型，已忽略（请改用 aplus_type 分组参数）")
    if aplus_type is not None and aplus_type not in APLUS_SPECS:
        raise AIImageError(f"不支持的 A+ 类型: {aplus_type}")
    # main_types v2.1：支持 dict（类型→每类型独立张数）与 list（全部用 image_count）两种形态
    main_counts: Dict[str, int] = {}
    if isinstance(main_types, dict):
        for t, c in main_types.items():
            if t in MAIN_GEN_TYPES and c:
                main_counts[t] = min(max(1, int(c)), 4)
    else:
        for t in (main_types or []):
            if t in MAIN_GEN_TYPES:
                main_counts[t] = image_count
    bad = [t for t in main_counts if t not in MAIN_GEN_TYPES]
    if bad:
        raise AIImageError(f"不支持的主副图类型: {bad}")
    main_aspect_ratio = main_aspect_ratio or "1:1"
    if main_counts and main_aspect_ratio not in ASPECT_RATIO_MAP:
        raise AIImageError(f"不支持的主副图比例: {main_aspect_ratio}")
    if not aplus_type and not main_counts:
        raise AIImageError("请至少选择 A+ 类型或主副图类型")

    # 单任务总张数护栏：防止一次提交就把 ComfyUI 串行队列灌满（与生视频互抢）
    total_sheets = (image_count if aplus_type else 0) + sum(main_counts.values())
    if total_sheets > MAX_SHEETS_PER_TASK:
        raise AIImageError(
            f"单个任务最多生成 {MAX_SHEETS_PER_TASK} 张（当前 {total_sheets} 张），请减少类型或张数"
        )

    no_text_mode = bool((brand_settings or {}).get("no_text_mode"))

    # 生成计划：(类型键, 生成比例, 目标裁剪尺寸|None, 展示名, seq, no_text, megapixels)
    gen_plan: List[Tuple[str, str, Optional[Tuple[int, int]], str, int, bool, float]] = []
    if aplus_type:
        spec = APLUS_SPECS[aplus_type]
        aplus_mp = float(spec.get("megapixels") or DEFAULT_MEGAPIXELS)
        for seq in range(image_count):
            gen_plan.append((aplus_type, spec["gen_ratio"], spec["target_size"],
                             spec["label"], seq, False, aplus_mp))
    for t, c in main_counts.items():
        for seq in range(c):
            gen_plan.append((t, main_aspect_ratio, None, MAIN_GEN_TYPES[t], seq,
                             no_text_mode, DEFAULT_MEGAPIXELS))

    # 展开子任务（target_size 供轮询完成后裁剪；no_text 供提示词追加无文字指令）
    items: List[Dict[str, Any]] = []
    for (t, _ratio, target_size, label, seq, _no_text, _mp) in gen_plan:
        items.append({
            "type": t, "label": label, "seq": seq,
            "status": "排队中", "url": None, "error": None,
            "target_size": list(target_size) if target_size else None,
            "no_text": no_text_mode and t in MAIN_GEN_TYPES,
        })
    display_types = [aplus_type] if aplus_type else []
    display_types += list(main_counts.keys())

    db = SessionLocal()
    try:
        # 用户级并发 1：ComfyUI 是串行队列，同一用户多单并发只会互相拖慢并挤占生视频。
        # 查活跃 + 插入是 check-then-insert，并发下两边都查不到会各建一单，故加用户锁。
        with _user_submit_lock(user_id):
            active = (
                db.query(AIImageTask.id)
                .filter(
                    AIImageTask.user_id == user_id,
                    AIImageTask.status.in_(["排队中", "生成中"]),
                    AIImageTask.deleted_at.is_(None),
                )
                .first()
            )
            if active:
                raise AIImageError(
                    f"你还有任务 #{active[0]} 正在生成，请等它完成后再提交（可在生成记录中查看进度）"
                )

            task = AIImageTask(
                tenant_id=tenant_id, user_id=user_id,
                creator_name=_safe_text(creator_name, 100) or "",
                title=_safe_text(title, 200) or "商品套图", status="排队中",
                provider=provider,
                generation_types=json.dumps(display_types, ensure_ascii=False),
                aspect_ratio=main_aspect_ratio, image_count=image_count,
                product_info=_safe_text(product_info, 5000),
                prompt=_safe_text(prompt, 2000),
                product_code=_safe_text(product_code, 50),
                product_name=_safe_text(product_name, 200),
                aplus_type=aplus_type,
                main_types=json.dumps(main_counts, ensure_ascii=False) if main_counts else None,
                main_aspect_ratio=main_aspect_ratio if main_counts else None,
                brand_settings=json.dumps(brand_settings, ensure_ascii=False) if brand_settings else None,
                result_images=_dump_items(items),
            )
            db.add(task)
            db.commit()
            db.refresh(task)
            task_id = task.id
    finally:
        db.close()

    _ensure_worker(
        task_id,
        prep_kwargs={
            "images": images,
            "gen_plan": gen_plan,
            "image_count": image_count,
            "product_info": product_info,
            "extra_prompt": prompt,
            "brand_genes": _compile_brand_genes(brand_settings),
            "provider": provider,
            "product_name": product_name,
        },
    )

    db = SessionLocal()
    try:
        return _serialize(db.query(AIImageTask).filter(AIImageTask.id == task_id).first())
    finally:
        db.close()


def _merge_facts(user_text: str, auto_text: str) -> str:
    """用户填写的商品信息 与 看图分析结果 合并。

    自动分析只补用户没写的字段：两边都有「品名」时保留用户版本，
    否则提示词里会出现两行互相矛盾的品名，模型会自行挑一个。
    """
    user_text = (user_text or "").strip()
    auto_text = (auto_text or "").strip()
    if not auto_text:
        return user_text
    if not user_text:
        return auto_text
    existing = {
        ln.split("：", 1)[0].strip()
        for ln in user_text.splitlines() if "：" in ln
    }
    kept = [
        ln for ln in auto_text.splitlines()
        if not ("：" in ln and ln.split("：", 1)[0].strip() in existing)
    ]
    extra = "\n".join(kept).strip()
    return f"{user_text}\n{extra}" if extra else user_text


def _card_to_text(card: Dict[str, Any]) -> str:
    """生视频风格的商品信息卡 → 「品名：… 材质：…」文本（与前端 analysisToText 同结构）。

    含「无法确认/不确定/未知」的值直接丢弃：这类占位符进提示词后会被模型当成真实属性。
    """
    def _val(v: Any) -> str:
        if isinstance(v, (list, tuple)):
            items = [str(x).strip() for x in v if str(x).strip()]
        else:
            items = [str(v).strip()] if v else []
        keep = [
            x for x in items
            if not any(k in x for k in ("无法", "不确定", "未知", "unknown", "n/a", "N/A"))
        ]
        return "、".join(keep)

    rows = [
        ("品名", card.get("product_name_cn")),
        ("英文品名", card.get("product_name_en")),
        ("品类", card.get("product_type") or card.get("amazon_category")),
        # 风格锚点：让同一任务的多张图共享同一场景主题（人物不锁定，主题要一致）
        ("风格倾向", card.get("style_context")),
        ("材质", card.get("material")),
        ("颜色", card.get("colors")),
        ("组件", card.get("product_components")),
        ("产品尺寸", card.get("product_size")),
        ("核心卖点", card.get("selling_points")),
        ("使用方式", card.get("usage_methods")),
        ("使用场景", card.get("usage_scenarios")),
    ]
    out: List[str] = []
    for key, val in rows:
        text = _val(val)
        if text:
            out.append(f"{key}：{text}")
    return "\n".join(out)


def _plan_design_jobs(
    gen_plan: List[Tuple[str, str, Optional[Tuple[int, int]], str, int, bool, float]],
) -> List[Tuple[int, str, str, int]]:
    """设计任务编排：scene_person **每张一个任务**（构图/姿态/光位要不同），
    其余类型同类型多张复用一份（省调用，seed 变化即可）。

    返回 [(gen_plan 下标, 类型, 比例, seq)]
    """
    jobs: List[Tuple[int, str, str, int]] = []
    seen: set = set()
    for gi, (t, ratio, _ts, _label, seq, _nt, _mp) in enumerate(gen_plan):
        if t == "scene_person":
            jobs.append((gi, t, ratio, seq))
        elif t not in seen:
            seen.add(t)
            jobs.append((gi, t, ratio, 0))
    return jobs


def _prepare_and_run_relay(
    task_id: int,
    *,
    images: List[Tuple[str, bytes]],
    gen_plan: List[Tuple[str, str, Optional[Tuple[int, int]], str, int, bool, float]],
    product_info: str,
    extra_prompt: str,
    brand_genes: str = "",
    product_name: str = "",
) -> None:
    """中转站通道：按图类型设计提示词 → 并行生成 → 转存 TOS。

    与旧版的关键差异：不再"先提取商品事实、再套固定模板"。
    每一类图单独调用一次多模态模型，同时完成「读商品」与「设计这张图怎么拍」，
    产出的英文提示词直接驱动出图（与生视频 VOICEOVER_PLAN 的一次性多模态同思路）。
    同类型多张复用同一条设计结果，seed 不同即可。
    设计失败时回退到轻量模板，保证仍能出图。
    """
    from services import tos_service
    from services import relay_image_service as relay

    t0 = time.time()
    token = _new_run_token(task_id)
    try:
        with _lock:
            _running.add(task_id)

        # 1. 参考图存 TOS（供前端展示，失败不影响生成）
        def _to_tos(item: Tuple[str, bytes]) -> Optional[str]:
            name, content = item
            try:
                return tos_service.upload_file(content, name, subdir="ai-image")
            except Exception as e:
                logger.warning(f"[AI生图] 参考图上传 TOS 失败（不影响生成）: {e}")
                return None

        with ThreadPoolExecutor(max_workers=min(8, max(1, len(images)))) as ex:
            urls = [u for u in ex.map(_to_tos, images) if u]
        if urls:
            _update_task(task_id, images=json.dumps(urls, ensure_ascii=False))

        main_bytes = images[0][1]
        facts_text = (product_info or "").strip()

        # 2. 商品分析：与生视频页**同一套** SYSTEM_PROMPT / 全部参考图 / temperature=0.3 /
        #    结构化输出。分析必须单独成一步 —— 夹在"写英文提示词"里时注意力被抢走，
        #    实测同一张图会在两个图类型间给出互相矛盾的商品结论（海滩套装 vs 新娘新郎）。
        main_area = _image_area(main_bytes)
        if not bool(settings.IMAGE_RELAY_ANALYZE):
            logger.info(f"[AI生图] 任务 {task_id} 已关闭自动分析，沿用现有商品信息")
        elif main_area and main_area < _MIN_MAIN_IMAGE_SIDE ** 2:
            logger.warning(
                f"[AI生图] 任务 {task_id} 主参考图过小（约 {int(main_area ** 0.5)}px），"
                f"跳过自动分析以避免写入误识别结果"
            )
        else:
            try:
                from services.ai_creation_service import analyze_product_card

                card = analyze_product_card(images, product_name=product_name)   # 全部参考图一起送
                card_text = _card_to_text(card)
                if card_text:
                    facts_text = _merge_facts(facts_text, card_text)
                    _update_task(task_id, product_info=_safe_text(facts_text, 5000))
                logger.info(
                    f"[AI生图] 任务 {task_id} 商品分析完成（{len(images)} 张图）: "
                    f"{(card.get('product_name_cn') or card.get('product_name_en') or '')[:20]}"
                )
            except Exception as e:
                logger.warning(f"[AI生图] 任务 {task_id} 商品分析失败（继续用现有信息）: {e}")

        # 3. 设计提示词。
        #    scene_person **每张单独设计**（构图/姿态/光位要不同，逐张才有差异）；
        #    其他类型同类型多张复用一份（省调用，seed 变化即可）。
        per_shot_types = {"scene_person"}
        designed_tasks = _plan_design_jobs(gen_plan)

        designs_by_shot: Dict[int, Dict[str, Any]] = {}
        designs_by_type: Dict[str, Dict[str, Any]] = {}
        if bool(settings.IMAGE_RELAY_ANALYZE):
            # 同一张参考图只压缩一次（多类型并行设计时复用，避免重复解码大图）
            prepared = relay.prepare_reference(main_bytes)

            def _design_one(
                job: Tuple[int, str, str, int]
            ) -> Tuple[Tuple[int, str, str, int], Dict[str, Any]]:
                gi, t, ratio, seq = job
                variation = (
                    relay.PERSON_VARIATIONS[seq % len(relay.PERSON_VARIATIONS)]
                    if t in per_shot_types else None
                )
                try:
                    d = relay.design_shot_prompt(
                        main_bytes, gen_type=t, ratio=ratio,
                        # 传「已确认的事实卡」：design 只按它设计画面，不再二次识别
                        product_info=facts_text, extra=extra_prompt,
                        brand_genes=brand_genes, prepared=prepared,
                        variation=variation,
                    )
                    return job, d
                except Exception as e:
                    logger.warning(
                        f"[AI生图] 任务 {task_id} 类型 {t}#{seq} 提示词设计失败，回退模板: {e}"
                    )
                    return job, {}

            with ThreadPoolExecutor(max_workers=min(4, max(1, len(designed_tasks)))) as ex:
                for (gi, t, _r, _s), d in ex.map(_design_one, designed_tasks):
                    if not d:
                        continue
                    if t in per_shot_types:
                        designs_by_shot[gi] = d
                    elif t not in designs_by_type:
                        designs_by_type[t] = d

            logger.info(
                f"[AI生图] 任务 {task_id} 提示词设计完成 "
                f"{len(designs_by_shot) + len(designs_by_type)}/{len(designed_tasks)} 项"
            )

        # 4. 逐项确定最终提示词（设计结果优先，缺失回退模板）
        #    按下标取设计结果：scene_person 每张一份，其他类型共用一份
        prompt_cn_map: Dict[int, str] = {}
        shot_designs: List[Dict[str, Any]] = []
        prompts: List[str] = []
        for gi, (t, ratio, target_size, label, seq, no_text, mp) in enumerate(gen_plan):
            d = designs_by_shot.get(gi) or designs_by_type.get(t) or {}
            shot_designs.append(d)
            designed = d.get("prompt_en")
            if designed:
                p = designed
                prompt_cn_map[gi] = d.get("prompt_cn") or ""
                neg = d.get("negative") or ""
                if neg:
                    p += f"\n\nAvoid: {neg}"
            else:
                p = _build_prompt(
                    t, facts_text, extra_prompt, brand_genes,
                    variation=(
                        PERSON_VARIATIONS_CN[seq % len(PERSON_VARIATIONS_CN)]
                        if t == "scene_person" else None
                    ),
                )
            p += f"\n\n画面比例 {ratio}。只输出生成后的图片，不要输出任何文字说明。"
            # 除卖点图外一律禁止画面文字：模型容易自作主张加英文标签牌
            if t != "selling_point":
                p += "\n画面中不得出现任何文字、标签、价签、水印或标识。"
            if no_text:
                p += "\n画面中不要出现任何文字、标语、水印或标识。"
            prompts.append(p)

        _update_task(task_id, status="生成中", started_at=datetime.now())
        logger.info(f"[AI生图] 任务 {task_id} 走中转站生成，共 {len(prompts)} 张")

        # 4. 并行生成（失败项独立，不影响其它张）
        results = relay.generate_batch(main_bytes, prompts)

        # 5. 落库 + 转存 TOS
        items: List[Dict[str, Any]] = []
        ok = 0
        for gi, ((t, ratio, target_size, label, seq, no_text, mp), r) in enumerate(
            zip(gen_plan, results)
        ):
            item: Dict[str, Any] = {
                "type": t, "label": label, "seq": seq,
                "status": "排队中", "url": None, "error": None,
                "target_size": list(target_size) if target_size else None,
                "no_text": no_text,
                # 中转站实际提交的完整提示词（无 PE，这就是最终提示词）
                "final_prompt": prompts[gi] if gi < len(prompts) else None,
                # 中文对照（运营阅读用，不参与出图）
                "prompt_cn": prompt_cn_map.get(gi) or None,
                # 该张是否由 AI 按产品定制（否则为模板回退）
                "prompt_designed": bool(shot_designs[gi]) if gi < len(shot_designs) else False,
                # AI 清点出的商品件数清单（用于核对一致性）
                "inventory": (shot_designs[gi] if gi < len(shot_designs) else {}).get("inventory") or None,
                # 该张的差异化维度（仅带人物场景），便于排查"为什么这几张构图不同"
                "variation": (
                    relay.PERSON_VARIATIONS[seq % len(relay.PERSON_VARIATIONS)]
                    if t == "scene_person" else None
                ),
            }
            if not r.get("ok"):
                item.update(status="失败", error=r.get("error") or "生成失败")
                items.append(item)
                continue
            try:
                content = r["data"]
                if target_size:
                    content = _fit_to_target(content, tuple(target_size))
                content, fname = _to_jpeg(content, f"relay-{task_id}-{t}-{seq}.png")
                url = tos_service.upload_file(
                    content, fname, content_type="image/jpeg", subdir="ai-image",
                )
                item.update(status="已完成", url=url)
                ok += 1
            except Exception as e:
                item.update(status="失败", error=str(e)[:300])
            items.append(item)

        # 过期执行：取消后用户已重试（新代号已接管），本次结果必须丢弃，
        # 否则会把重试的成果覆盖回旧结果
        if not _is_current_token(task_id, token):
            logger.info(f"[AI生图] 任务 {task_id} 已有更新的执行，丢弃本次中转站结果")
            return

        # 取消检查：中转站是普通 HTTP 调用，无法像 ComfyUI 那样删队列项，
        # 只能在结果落库前丢弃未完成项，否则用户点了取消仍会看到「已完成」
        if _is_cancelled(task_id):
            for i, it in enumerate(items):
                if it.get("status") not in ("已完成", "失败"):
                    items[i] = dict(it, status="已取消", error="任务已取消")
            ok = 0
        agg = _aggregate_status(items)
        _update_task(
            task_id,
            result_images=_dump_items(items),
            status=_finalize_status(task_id, agg),
            finished_at=datetime.now(),
        )
        logger.info(
            f"[AI生图] 任务 {task_id} 中转站完成 {ok}/{len(items)} 张，"
            f"耗时 {time.time() - t0:.1f}s"
        )
    except Exception as e:
        logger.exception(f"[AI生图] 中转站任务 {task_id} 异常")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
    finally:
        with _lock:
            _running.discard(task_id)
            _cancel_flags.discard(task_id)


def _prepare_and_run(
    task_id: int,
    *,
    images: List[Tuple[str, bytes]],
    gen_plan: List[Tuple[str, str, Optional[Tuple[int, int]], str, int, bool, float]],
    image_count: int,
    product_info: str,
    extra_prompt: str,
    brand_genes: str = "",
    provider: str = "local",
    product_name: str = "",
) -> None:
    """后台线程：参考图传 TOS → 传 ComfyUI → 逐项提交工作流（不同 seed）→ 轮询到完成"""
    from services import tos_service

    # 主参考图必须是清晰的那张：产品库首图常是 75px 缩略图，会让看图分析严重失真
    images = _order_images_by_clarity(images)

    # 中转站通道走独立的并行实现（无 ComfyUI 队列、无 PE 节点）
    if (provider or "local") == "relay":
        _prepare_and_run_relay(
            task_id, images=images, gen_plan=gen_plan,
            product_info=product_info, extra_prompt=extra_prompt,
            brand_genes=brand_genes, product_name=product_name,
        )
        return

    items: List[Dict[str, Any]] = []
    prompt_ids: List[str] = []
    try:
        with _lock:
            _running.add(task_id)

        # 0. ComfyUI 配置守卫
        if not (settings.H3_BASE_URL or "").strip():
            _update_task(task_id, status="失败",
                         error_message="H3_BASE_URL 未配置（.env 需配置 ComfyUI 服务地址/账号密码）",
                         finished_at=datetime.now())
            with _lock:
                _running.discard(task_id)
            return

        # 1+2. 参考图并行上传：TOS（供前端展示）与 ComfyUI（生成用）同时进行
        t_upload = time.time()

        def _to_tos(item: Tuple[str, bytes]) -> Optional[str]:
            name, content = item
            try:
                return tos_service.upload_file(content, name, subdir="ai-image")
            except Exception as e:
                logger.warning(f"[AI生图] 参考图上传 TOS 失败（不影响生成）: {e}")
                return None

        def _to_comfy(item) -> str:
            idx, (_, content) = item
            return _upload_image(idx, content)

        with ThreadPoolExecutor(max_workers=min(10, max(2, len(images) * 2))) as ex:
            tos_futs = [ex.submit(_to_tos, it) for it in images]
            comfy_futs = [ex.submit(_to_comfy, it) for it in enumerate(images)]
            urls: List[str] = []
            for f in tos_futs:
                u = f.result()
                if u:
                    urls.append(u)
            image_names = [f.result() for f in comfy_futs]
        if urls:
            _update_task(task_id, images=json.dumps(urls, ensure_ascii=False))
        t_upload_done = time.time()

        # 3. 按「类型 × 张数」逐项提交工作流，不同 seed；先全部提交后统一轮询
        for (t, gen_ratio, target_size, label, seq, no_text, mp) in gen_plan:
            # 带人物场景按 seq 轮换构图/姿态/光位，避免多张撞图（PE 的 seed 固定为 666）
            shot_variation = (
                PERSON_VARIATIONS_CN[seq % len(PERSON_VARIATIONS_CN)]
                if t == "scene_person" else None
            )
            prompt_text = _build_prompt(t, product_info, extra_prompt, brand_genes,
                                        variation=shot_variation)
            if no_text:
                prompt_text += "\n无文字模式：画面中不要出现任何文字、标语、水印或标识。"
            seed = random.randint(1, 2**31 - 1)
            workflow = _build_workflow(
                prompt=prompt_text,
                aspect_ratio=gen_ratio,
                seed=seed,
                image_names=image_names,
                filename_prefix=f"AIIMG-{task_id}-{t}-{seq}",
                megapixels=mp,
            )
            resp = _api("POST", "/prompt", json={"prompt": workflow})
            pid = resp.json()["prompt_id"]
            prompt_ids.append(pid)
            items.append({
                "type": t, "label": label, "seq": seq,
                "status": "排队中", "url": None, "error": None,
                "target_size": list(target_size) if target_size else None,
                "no_text": no_text,
                "prompt_id": pid,
                # 实际提交给 ComfyUI 571 节点的完整提示词（详情弹窗直接读库，不再依赖 /history）
                "final_prompt": prompt_text,
                "variation": shot_variation,
            })

        t_submit_done = time.time()
        _update_task(
            task_id,
            comfy_prompt_ids=json.dumps(prompt_ids, ensure_ascii=False),
            result_images=_dump_items(items),
        )
        logger.info(
            f"[AI生图] 任务 {task_id} 已提交 {len(prompt_ids)} 个子任务 | "
            f"参考图上传(并行) {t_upload_done - t_upload:.1f}s | "
            f"工作流提交 {t_submit_done - t_upload_done:.1f}s"
        )

        # 4. 同线程继续轮询直到完成（成功后 finally 里清除 _running）
        _run_task(task_id, prompt_ids)
    except Exception as e:
        logger.error(f"[AI生图] 任务 {task_id} 准备阶段异常: {e}")
        msg = str(e)[:900]
        with _lock:
            _running.discard(task_id)

        # 已成功提交的子任务若丢弃，ComfyUI 会继续空跑且无人回收 → 回写后照常轮询
        if prompt_ids:
            for (rt, _rr, rts, rlb, rsq, _rnt, _rmp) in gen_plan[len(items):]:
                items.append({
                    "type": rt, "label": rlb, "seq": rsq,
                    "status": "失败", "url": None,
                    "error": f"提交中断：{msg}",
                    "target_size": list(rts) if rts else None,
                    "no_text": _rnt,
                })
            _update_task(
                task_id,
                comfy_prompt_ids=json.dumps(prompt_ids, ensure_ascii=False),
                result_images=_dump_items(items),
                error_message=msg,
            )
            logger.warning(
                f"[AI生图] 任务 {task_id} 提交中断，已回写 {len(prompt_ids)} 个已提交子任务并继续回收"
            )
            try:
                _run_task(task_id, prompt_ids)
            except Exception as poll_err:
                logger.error(f"[AI生图] 任务 {task_id} 中断后回收失败: {poll_err}")
        else:
            # 一个子任务都没提交成功（如参考图上传 404）：子项必须一起落终态，
            # 否则会永远停在「排队中」——前端不轮询、详情转圈、重试按钮不出现。
            pending_items = [
                i for i, it in enumerate(items)
                if it.get("status") not in ("已完成", "失败", "已取消")
            ]
            for i in pending_items:
                items[i] = dict(items[i], status="失败", error=f"提交失败：{msg}")
            _update_task(task_id, status="失败", error_message=msg,
                         result_images=_dump_items(items),
                         finished_at=datetime.now())
            if pending_items:
                logger.warning(
                    f"[AI生图] 任务 {task_id} 未提交任何子任务，"
                    f"{len(pending_items)} 个子项一并标记失败"
                )


def _serialize(task) -> Dict[str, Any]:
    """任务记录 → 前端结构"""
    if not task:
        return {}
    result_images = _read_json_list(task.result_images)
    images = _read_json_list(task.images)
    cost_seconds = None
    if task.finished_at:
        start = task.started_at or task.created_at
        if start:
            try:
                cost_seconds = int((task.finished_at - start).total_seconds())
            except Exception:
                cost_seconds = None
    return {
        "id": task.id,
        "title": task.title or "商品套图任务",
        "status": task.status,
        "provider": getattr(task, "provider", None) or "local",
        "provider_label": (
            (settings.IMAGE_RELAY_LABEL or "Nano Banana 2")
            if (getattr(task, "provider", None) or "local") == "relay"
            else "Qwen Image 2.1"
        ),
        "creator_name": task.creator_name or "",
        "generation_types": _read_json_list(task.generation_types) if task.generation_types else [],
        "aspect_ratio": task.aspect_ratio,
        "aplus_type": task.aplus_type,
        "main_types": _read_json_list(task.main_types) if task.main_types else [],
        "main_aspect_ratio": task.main_aspect_ratio,
        "brand_settings": (json.loads(task.brand_settings) if task.brand_settings else None),
        "image_count": task.image_count,
        "product_info": task.product_info or "",
        "prompt": task.prompt or "",
        "product_code": task.product_code or "",
        "product_name": task.product_name or "",
        "images": images,
        "result_images": result_images,
        "comfy_prompt_ids": _read_json_list(task.comfy_prompt_ids),
        "cost_seconds": cost_seconds,
        "error_message": task.error_message,
        "created_at": task.created_at.strftime("%Y-%m-%d %H:%M") if task.created_at else "",
    }


def get_comfy_prompt_history(prompt_id: str) -> Dict[str, Any]:
    """按 prompt_id 查 ComfyUI 执行历史，提取两级提示词（生图详情弹窗用）：
    - 原始提示词：提交工作流 PrimitiveStringMultiline(571) 的 value（后端拼接后的完整原文）
    - 优化后提示词：执行输出 TE_text_display(569) 的 text（本地官方 PE 增强后的英文）
    """
    pid = (prompt_id or "").strip()
    if not (settings.H3_BASE_URL or "").strip():
        raise AIImageError("H3_BASE_URL 未配置")
    if not pid:
        raise AIImageError("prompt_id 不能为空")
    try:
        data = _api("GET", f"/history/{pid}", timeout=20).json()
    except AIImageError:
        raise
    except Exception as e:
        raise AIImageError(f"查询 ComfyUI 历史失败: {e}")

    entry = data.get(pid) or {}

    original = ""
    prompt_part = entry.get("prompt")
    # ComfyUI 各版本 history.prompt 结构不一：工作流 dict 可能在 prompt[1] 或 prompt[2]，
    # 其余元素可能为 int/str —— 统一遍历取第一个包含提示词节点的 dict
    workflow = None
    if isinstance(prompt_part, dict):
        workflow = prompt_part
    elif isinstance(prompt_part, list):
        for part in prompt_part:
            if isinstance(part, dict) and NODE_PROMPT in part:
                workflow = part
                break
    if workflow:
        node = workflow.get(NODE_PROMPT) or {}
        original = (node.get("inputs") or {}).get("value") or ""

    enhanced = ""
    node_out = (entry.get("outputs") or {}).get("569") or {}
    texts = node_out.get("text") or []
    if texts:
        enhanced = texts[0] or ""

    return {
        "prompt_id": pid,
        "found": bool(entry),
        "original_prompt": original,
        "enhanced_prompt": enhanced,
    }


def list_image_tasks(
    tenant_id: int, page: int = 1, page_size: int = 10, keyword: str = "",
    status: str = "",
) -> Dict[str, Any]:
    """租户的套图生成任务列表（按时间倒序）。keyword 模糊匹配产品编码/品名/标题"""
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask
    from sqlalchemy import or_

    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    db = SessionLocal()
    try:
        query = db.query(AIImageTask).filter(
            AIImageTask.tenant_id == tenant_id,
            AIImageTask.deleted_at.is_(None),
        )
        status = (status or "").strip()
        if status:
            # 白名单：直接拼进 WHERE 前先限定为已知状态值（须与前端下拉/STATUS_COLORS 完全对齐）
            if status not in ("排队中", "生成中", "已完成", "部分完成", "失败", "已取消"):
                raise AIImageError(f"不支持的任务状态: {status}")
            query = query.filter(AIImageTask.status == status)
        keyword = (keyword or "").strip()
        if keyword:
            # 转义 LIKE 通配符：用户输入 % 或 _ 时按字面匹配，否则 % 会命中全部记录
            escaped = (
                keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            like = f"%{escaped}%"
            query = query.filter(
                or_(
                    AIImageTask.product_code.ilike(like, escape="\\"),
                    AIImageTask.product_name.ilike(like, escape="\\"),
                    AIImageTask.title.ilike(like, escape="\\"),
                )
            )
        total = query.count()
        rows = (
            query.order_by(AIImageTask.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return {"items": [_serialize(r) for r in rows], "total": total}
    finally:
        db.close()


def get_image_task(tenant_id: int, task_id: int) -> Dict[str, Any]:
    """单任务详情（带租户隔离）"""
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        row = (
            db.query(AIImageTask)
            .filter(
                AIImageTask.id == task_id,
                AIImageTask.tenant_id == tenant_id,
                AIImageTask.deleted_at.is_(None),
            )
            .first()
        )
        if not row:
            raise AIImageError("任务不存在或已删除")
        return _serialize(row)
    finally:
        db.close()


def prompt_belongs_to_tenant(tenant_id: int, prompt_id: str) -> bool:
    """ComfyUI prompt_id 是否属于该租户的任务（详情弹窗查历史前的归属校验）"""
    import re

    pid = (prompt_id or "").strip()
    # 白名单字符 + 长度，避免 LIKE 通配符注入（_ / % 会被当哨兵）
    if not re.fullmatch(r"[A-Za-z0-9\-]{8,64}", pid):
        return False

    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        hit = (
            db.query(AIImageTask.id)
            .filter(
                AIImageTask.tenant_id == tenant_id,
                AIImageTask.comfy_prompt_ids.like(f"%{pid}%"),
            )
            .first()
        )
        return hit is not None
    finally:
        db.close()


def delete_image_task(tenant_id: int, task_id: int) -> None:
    """删除任务记录（软删除，不影响已生成的图片）"""
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        db.query(AIImageTask).filter(
            AIImageTask.id == task_id, AIImageTask.tenant_id == tenant_id
        ).update({"deleted_at": datetime.now()})
        db.commit()
    finally:
        db.close()


def cancel_image_task(tenant_id: int, task_id: int) -> Dict[str, Any]:
    """取消排队中/生成中的任务：标记取消 + 清 ComfyUI 待执行队列。

    已在 KSampler 里执行的那一张无法精准中断（/interrupt 是全局的，会波及生视频），
    因此只放弃回收，等它自然结束。
    """
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        task = (
            db.query(AIImageTask)
            .filter(
                AIImageTask.id == task_id,
                AIImageTask.tenant_id == tenant_id,
                AIImageTask.deleted_at.is_(None),
            )
            .first()
        )
        if not task:
            raise AIImageError("任务不存在或已删除")
        if task.status not in ("排队中", "生成中"):
            raise AIImageError("只有排队中/生成中的任务可以取消")

        pids = _read_json_list(task.comfy_prompt_ids)
        with _lock:
            _cancel_flags.add(task_id)
            alive = task_id in _running

        for pid in pids:
            try:
                _api("POST", "/queue", json={"delete": [pid]}, timeout=10)
            except Exception as e:
                logger.warning(f"[AI生图] 任务 {task_id} 移除 ComfyUI 队列项失败: {e}")

        # 无活跃线程（服务重启过）：直接落终态，避免永远停在生成中。
        # 中转站任务没有 ComfyUI 队列项可删（pids 为空），线程也无法中断 HTTP 调用，
        # 因此同样先落终态；线程收尾时会读到取消标志并把未完成项写成「已取消」。
        if not alive or not pids:
            items = _read_json_list(task.result_images)
            for it in items:
                if it.get("status") not in ("已完成", "失败"):
                    it["status"] = "已取消"
                    it["error"] = "任务已取消"
            db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
                "result_images": _dump_items(items),
                "status": _aggregate_status(items),
                "finished_at": datetime.now(),
            })
            db.commit()
            if not alive:
                _clear_cancel(task_id)
        return {"success": True, "message": "已取消"}
    finally:
        db.close()


def _retry_relay_items(
    task_id: int,
    snapshot: List[Tuple[int, Dict[str, Any]]],
    datas: List[Tuple[str, bytes]],
    product_info: str,
    extra_prompt: str,
    brand_genes: str,
    main_ratio: str,
) -> Dict[str, Any]:
    """中转站任务的重试：先按类型重设计提示词，再后台并行重生成（不阻塞 HTTP 请求）"""
    plan: List[Tuple[int, str, Optional[Tuple[int, int]], str, str, bool]] = []
    skipped: List[str] = []

    # 重试与首次生成保持同一套口径：scene_person 逐张设计（各自 variation），其余按类型复用
    ratio_by_pos: Dict[int, str] = {}
    for pos, (_idx, it) in enumerate(snapshot):
        _t = it.get("type") or ""
        if _t in APLUS_SPECS:
            ratio_by_pos[pos] = APLUS_SPECS[_t]["gen_ratio"]
        elif _t in MAIN_GEN_TYPES:
            ratio_by_pos[pos] = main_ratio

    design_jobs: List[Tuple[int, str, str, int]] = []   # (snapshot 位置, 类型, 比例, seq)
    seen_types: set = set()
    for pos, (_idx, it) in enumerate(snapshot):
        t = it.get("type") or ""
        ratio = ratio_by_pos.get(pos)
        if not ratio:
            continue
        seq = int(it.get("seq") or 0)
        if t == "scene_person":
            design_jobs.append((pos, t, ratio, seq))
        elif t not in seen_types:
            seen_types.add(t)
            design_jobs.append((pos, t, ratio, 0))

    designs_by_pos: Dict[int, Dict[str, Any]] = {}
    designs_by_type: Dict[str, Dict[str, Any]] = {}
    if bool(settings.IMAGE_RELAY_ANALYZE) and design_jobs:
        from services import relay_image_service as relay

        prepared = relay.prepare_reference(datas[0][1])

        def _design(job: Tuple[int, str, str, int]) -> Tuple[Tuple[int, str, str, int], Dict[str, Any]]:
            pos, t, ratio, seq = job
            variation = (
                relay.PERSON_VARIATIONS[seq % len(relay.PERSON_VARIATIONS)]
                if t == "scene_person" else None
            )
            try:
                return job, relay.design_shot_prompt(
                    datas[0][1], gen_type=t, ratio=ratio,
                    product_info=product_info, extra=extra_prompt,
                    brand_genes=brand_genes, prepared=prepared,
                    variation=variation,
                )
            except Exception as e:
                logger.warning(
                    f"[AI生图] 任务 {task_id} 重试时类型 {t}#{seq} 设计失败，回退模板: {e}"
                )
                return job, {}

        with ThreadPoolExecutor(max_workers=min(4, max(1, len(design_jobs)))) as ex:
            for (pos, t, _r, _s), d in ex.map(_design, design_jobs):
                if not d:
                    continue
                if t == "scene_person":
                    designs_by_pos[pos] = d
                elif t not in designs_by_type:
                    designs_by_type[t] = d

    for pos, (_idx, it) in enumerate(snapshot):
        idx = _idx
        t = it.get("type") or ""
        if t in APLUS_SPECS:
            ratio = APLUS_SPECS[t]["gen_ratio"]
            target: Optional[Tuple[int, int]] = tuple(APLUS_SPECS[t]["target_size"])
        elif t in MAIN_GEN_TYPES:
            ratio = main_ratio
            ts = it.get("target_size")
            target = tuple(ts) if isinstance(ts, list) and len(ts) == 2 else None
        else:
            skipped.append(f"{t} 类型已不支持")
            continue
        d = designs_by_pos.get(pos) or designs_by_type.get(t) or {}
        designed = d.get("prompt_en")
        prompt_cn = d.get("prompt_cn") or ""
        if designed:
            prompt_text = designed
            neg = d.get("negative") or ""
            if neg:
                prompt_text += f"\n\nAvoid: {neg}"
        else:
            prompt_text = _build_prompt(
                t, product_info, extra_prompt, brand_genes,
                variation=(
                    PERSON_VARIATIONS_CN[int(it.get("seq") or 0) % len(PERSON_VARIATIONS_CN)]
                    if t == "scene_person" else None
                ),
            )
        prompt_text += f"\n\n画面比例 {ratio}。只输出生成后的图片，不要输出任何文字说明。"
        if t != "selling_point":
            prompt_text += "\n画面中不得出现任何文字、标签、价签、水印或标识。"
        if it.get("no_text"):
            prompt_text += "\n画面中不要出现任何文字、标语、水印或标识。"
        plan.append((idx, prompt_text, target, t, prompt_cn, bool(designed)))

    if not plan:
        raise AIImageError("重试提交失败：" + "；".join(skipped[:3] or ["未知原因"]))

    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    # 先落库：目标子项回到排队中、任务回到生成中，前端立刻能轮询到进度
    db = SessionLocal()
    try:
        task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
        items = _read_json_list(task.result_images if task else None)
        for idx, _p, _t, _ty, _cn, _ds in plan:
            if idx < len(items):
                items[idx] = dict(
                    items[idx], status="排队中", error=None, url=None,
                    final_prompt=_p,
                    prompt_cn=_cn or None,
                    prompt_designed=_ds,
                    retried_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
                )
        db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
            "result_images": _dump_items(items),
            "status": "生成中",
            "finished_at": None,
        })
        db.commit()
    finally:
        db.close()

    _clear_cancel(task_id)
    token = _new_run_token(task_id)
    with _lock:
        _running.add(task_id)
    threading.Thread(
        target=_run_relay_retry, args=(task_id, plan, datas[0][1], token),
        daemon=True, name=f"ai-image-retry-relay-{task_id}",
    ).start()
    return {"retried": len(plan), "failed": skipped}


def _run_relay_retry(
    task_id: int,
    plan: List[Tuple[int, str, Optional[Tuple[int, int]], str, str, bool]],
    main_bytes: bytes,
    token: int,
) -> None:
    """后台线程：中转站重试生成 → 裁剪/转 JPEG → TOS → 回写子项"""
    from services import relay_image_service as relay
    from services import tos_service
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    try:
        results = relay.generate_batch(main_bytes, [p for _i, p, _t, _ty, _cn, _ds in plan])
        if not _is_current_token(task_id, token):
            logger.info(f"[AI生图] 任务 {task_id} 已有更新的执行，丢弃本次中转站重试结果")
            return
        db = SessionLocal()
        try:
            task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
            items = _read_json_list(task.result_images if task else None)
            for (idx, _p, target, t, _cn, _ds), r in zip(plan, results):
                if idx >= len(items):
                    continue
                if not r.get("ok"):
                    items[idx] = dict(
                        items[idx], status="失败", url=None,
                        error=(r.get("error") or "生成失败")[:300],
                    )
                    continue
                try:
                    content = r["data"]
                    if target:
                        content = _fit_to_target(content, target)
                    content, fname = _to_jpeg(content, f"relay-{task_id}-{t}-{idx}-retry.png")
                    url = tos_service.upload_file(
                        content, fname, content_type="image/jpeg", subdir="ai-image",
                    )
                    items[idx] = dict(items[idx], status="已完成", url=url, error=None)
                except Exception as e:
                    items[idx] = dict(items[idx], status="失败", error=str(e)[:300])
            db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
                "result_images": _dump_items(items),
                "status": _finalize_status(task_id, _aggregate_status(items)),
                "finished_at": datetime.now(),
            })
            db.commit()
        finally:
            db.close()
        logger.info(f"[AI生图] 任务 {task_id} 中转站重试完成 {len(plan)} 项")
    except Exception as e:
        logger.exception(f"[AI生图] 任务 {task_id} 中转站重试异常")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
    finally:
        with _lock:
            _running.discard(task_id)
            _cancel_flags.discard(task_id)


def retry_image_items(tenant_id: int, task_id: int,
                      indices: Optional[List[int]] = None) -> Dict[str, Any]:
    """重试失败子项（复用已存参考图，不要求用户重新上传）。

    :param indices: 指定子项下标；为空则重试全部失败项
    """
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        task = (
            db.query(AIImageTask)
            .filter(
                AIImageTask.id == task_id,
                AIImageTask.tenant_id == tenant_id,
                AIImageTask.deleted_at.is_(None),
            )
            .first()
        )
        if not task:
            raise AIImageError("任务不存在或已删除")
        if task.status in ("排队中", "生成中"):
            raise AIImageError("任务仍在生成中，请等它结束或先取消")

        items = _read_json_list(task.result_images)
        # 可重试范围：失败 + 已取消（取消后想补齐是常见诉求，前端按钮口径与此一致）
        targets = _pick_retry_targets(items, indices, ("失败", "已取消"))
        if not targets:
            raise AIImageError("没有可重试的失败或已取消图片")

        image_urls = _read_json_list(task.images)
        if not image_urls:
            raise AIImageError("参考图已丢失，请重新提交任务")

        product_info = task.product_info or ""
        extra_prompt = task.prompt or ""
        try:
            brand = json.loads(task.brand_settings) if task.brand_settings else None
        except Exception:
            brand = None
        brand_genes = _compile_brand_genes(brand)
        main_ratio = task.main_aspect_ratio or task.aspect_ratio or "1:1"
        provider = getattr(task, "provider", None) or "local"
        snapshot = [(i, dict(items[i])) for i in targets]
    finally:
        db.close()

    # 参考图：TOS 下载 → 重新上传 ComfyUI（上传的临时文件不长期保留）
    datas: List[Tuple[str, bytes]] = []
    # 直连：走系统代理时隧道抖动会把下载拖到超时
    _http = requests.Session()
    _http.trust_env = False
    for u in image_urls:
        try:
            resp = _http.get(u, timeout=60)
            resp.raise_for_status()
        except Exception as e:
            raise AIImageError(f"参考图下载失败，请重新提交任务: {e}")
        datas.append((u.rsplit("/", 1)[-1] or "ref.jpg", resp.content))

    # 主参考图必须是清晰的那张（与首次生成同口径，否则重试结果会再次跑偏）
    datas = _order_images_by_clarity(datas)

    # 中转站任务必须回中转站重试：换成本地 ComfyUI 会换模型、换风格，还要抢串行队列
    if provider == "relay":
        return _retry_relay_items(
            task_id, snapshot, datas, product_info, extra_prompt, brand_genes, main_ratio,
        )

    # datas 元素是 (filename, bytes)，上传只需要 bytes（勿把元组当内容传进去）
    image_names = [_upload_image(i, _c) for i, (_n, _c) in enumerate(datas)]

    prompt_map: Dict[str, int] = {}
    prompt_text_map: Dict[int, str] = {}
    failed: List[str] = []
    for idx, it in snapshot:
        t = it.get("type") or ""
        if t in APLUS_SPECS:
            ratio = APLUS_SPECS[t]["gen_ratio"]
            mp = float(APLUS_SPECS[t].get("megapixels") or DEFAULT_MEGAPIXELS)
        elif t in MAIN_GEN_TYPES:
            ratio = main_ratio
            mp = DEFAULT_MEGAPIXELS
        else:
            failed.append(f"{t} 类型已不支持")
            continue
        prompt_text = _build_prompt(t, product_info, extra_prompt, brand_genes)
        if it.get("no_text"):
            prompt_text += "\n无文字模式：画面中不要出现任何文字、标语、水印或标识。"
        try:
            wf = _build_workflow(
                prompt=prompt_text,
                aspect_ratio=ratio,
                seed=random.randint(1, 2**31 - 1),
                image_names=image_names,
                filename_prefix=f"AIIMG-{task_id}-{t}-{it.get('seq', idx)}-retry",
                megapixels=mp,
            )
            resp = _api("POST", "/prompt", json={"prompt": wf})
            prompt_map[resp.json()["prompt_id"]] = idx
            prompt_text_map[idx] = prompt_text
        except AIImageError:
            raise
        except Exception as e:
            failed.append(f"{t}: {e}")

    if not prompt_map:
        raise AIImageError("重试提交失败：" + "；".join(failed[:3] or ["未知原因"]))

    # 落库：目标子项回到排队中，任务回到生成中
    db = SessionLocal()
    try:
        task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
        items = _read_json_list(task.result_images if task else None)
        for pid, idx in prompt_map.items():
            if idx < len(items):
                items[idx] = dict(
                    items[idx], status="排队中", error=None, url=None,
                    prompt_id=pid,
                    final_prompt=prompt_text_map.get(idx),
                    retried_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
                )
        db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
            "result_images": _dump_items(items),
            "status": _aggregate_status(items),
            "finished_at": None,
        })
        db.commit()
    finally:
        db.close()

    _clear_cancel(task_id)
    _ensure_worker(task_id, list(prompt_map.keys()), index_map=prompt_map)
    return {"retried": len(prompt_map), "failed": failed}


def build_task_zip(tenant_id: int, task_id: int) -> Tuple[bytes, str]:
    """把任务已生成的图片打包成 zip（服务端拉取，规避逐张点击与跨域）"""
    import re
    import zipfile

    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        task = (
            db.query(AIImageTask)
            .filter(
                AIImageTask.id == task_id,
                AIImageTask.tenant_id == tenant_id,
                AIImageTask.deleted_at.is_(None),
            )
            .first()
        )
        if not task:
            raise AIImageError("任务不存在或已删除")
        items = [
            it for it in _read_json_list(task.result_images)
            if it.get("status") == "已完成" and it.get("url")
        ]
        if not items:
            raise AIImageError("没有可下载的图片")
        raw_title = task.title or f"任务{task_id}"
    finally:
        db.close()

    safe_title = re.sub(r'[\\/:*?"<>|\s]+', "_", raw_title).strip("_")[:60] or "ai-image"
    buf = io.BytesIO()
    used = set()
    failed: List[str] = []
    first_error = ""
    # 直连取图：走系统代理时隧道抖动会把下载拖到超时（沙箱环境尤其明显）
    http = requests.Session()
    http.trust_env = False
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for it in items:
            try:
                resp = http.get(it["url"], timeout=120)
                resp.raise_for_status()
            except Exception as e:
                logger.warning(f"[AI生图] 任务 {task_id} 打包下载失败: {e}")
                failed.append(it.get("label") or it.get("type") or "image")
                if not first_error:
                    first_error = str(e)[:120]
                continue
            # 扩展名按实际地址推断：中转站产出 jpg，硬编码 .png 会让文件名与内容不符
            ext = os.path.splitext(urlparse(it["url"]).path)[1].lower()
            if ext not in (".png", ".jpg", ".jpeg", ".webp"):
                ext = ".png"
            name = (
                f"{safe_title}-{it.get('label') or it.get('type') or 'image'}"
                f"-{(it.get('seq') or 0) + 1}{ext}"
            )
            base, n = name, 2
            while name in used:
                name = f"{base[:-len(ext)]}-{n}{ext}"
                n += 1
            used.add(name)
            zf.writestr(name, resp.content)

        # 部分失败时写入清单，避免用户以为图片全都在
        if failed and used:
            zf.writestr(
                "_未下载.txt",
                "以下图片源地址已失效或下载失败，请在页面里重新生成：\n"
                + "\n".join(f"- {x}" for x in failed)
                + (f"\n\n首个错误：{first_error}" if first_error else ""),
            )

    if not used:
        raise AIImageError(
            f"图片下载失败（{len(items)} 张均无法取回）：{first_error or '源地址无响应'}"
        )
    return buf.getvalue(), f"{safe_title}.zip"


def resume_pending_tasks() -> None:
    """服务启动时恢复未完成的任务：重新挂上后台轮询线程"""
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    db = SessionLocal()
    try:
        rows = (
            db.query(AIImageTask)
            .filter(
                AIImageTask.status.in_(["排队中", "生成中"]),
                AIImageTask.comfy_prompt_ids.isnot(None),
                AIImageTask.deleted_at.is_(None),
            )
            .all()
        )
        pending = [(r.id, _read_json_list(r.comfy_prompt_ids)) for r in rows]

        # 未拿到 ComfyUI 任务 ID 的记录已无法追踪，直接标记失败。
        # 必须连子项一起落终态：只改任务级会让子项永远停在「排队中」，
        # 前端就不再轮询、详情弹窗一直转圈，且「重试未完成」按钮也不会出现。
        orphan_rows = (
            db.query(AIImageTask)
            .filter(
                AIImageTask.status.in_(["排队中", "生成中"]),
                AIImageTask.comfy_prompt_ids.is_(None),
                AIImageTask.deleted_at.is_(None),
            )
            .all()
        )
        for row in orphan_rows:
            items = _read_json_list(row.result_images)
            touched = False
            for i, it in enumerate(items):
                if it.get("status") not in ("已完成", "失败", "已取消"):
                    items[i] = dict(it, status="失败",
                                    error="服务重启导致任务中断，请重新提交")
                    touched = True
            row.status = "失败"
            row.error_message = "服务重启导致任务中断，请重新提交"
            row.finished_at = datetime.now()
            if touched:
                row.result_images = _dump_items(items)
        db.commit()
        if orphan_rows:
            logger.warning(f"[AI生图] {len(orphan_rows)} 条未提交成功的任务已标记为失败（含子项）")
    finally:
        db.close()

    for task_id, pids in pending:
        if pids:
            logger.info(f"[AI生图] 恢复未完成任务 {task_id}（{len(pids)} 个子任务）")
            _ensure_worker(task_id, pids)
