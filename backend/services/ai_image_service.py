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
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# 生成类型：key（前端/模板键）→ 中文名
GEN_TYPES: Dict[str, str] = {
    "white_background": "白底图",
    "scene": "场景图",
    "closeup": "特写图",
    "selling_point": "卖点图",
    "aplus": "A+图",
}

# 前端比例 → ComfyUI ResolutionSelector 选项字符串
# 2026-10-15 实测：以下 5 项均真实渲染（尺寸见注释）；"2:3"/"3:2" 不在节点动态选项表内，
# 提交后静默跳过渲染（status success 但无输出），故不提供。
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
APLUS_SPECS: Dict[str, Dict[str, Any]] = {
    "aplus_advanced": {"label": "高级A+图", "gen_ratio": "16:9", "target_size": (1464, 600)},
    "aplus_normal":   {"label": "普通A+图", "gen_ratio": "16:9", "target_size": (970, 600)},
    "aplus_mobile":   {"label": "手机A+图", "gen_ratio": "4:3",  "target_size": (600, 450)},
}
# 主副图类型（多选）
MAIN_GEN_TYPES: Dict[str, str] = {
    "selling_point": "卖点图",
    "white_background": "白底图",
    "scene": "场景图",
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


def _compile_brand_genes(bs: Optional[Dict[str, Any]]) -> str:
    """品牌自定义设置 → 注入提示词的视觉基因文本"""
    if not bs:
        return ""
    parts = []
    if bs.get("main_color"):
        parts.append(f"主色调：{bs['main_color']}（场景配色与道具呼应主色）")
    if bs.get("font_style") and bs["font_style"] != "智能字体风格":
        parts.append(f"文字排版风格：{bs['font_style']}")
    if bs.get("custom_text"):
        parts.append(f"自定义视觉要求：{bs['custom_text']}")
    if bs.get("country"):
        parts.append(f"销售国家/地区：{bs['country']}（场景、人物与审美符合当地习惯）")
    if bs.get("language"):
        parts.append(f"画面文字语言：{bs['language']}")
    if bs.get("platform"):
        parts.append(f"发布平台：{bs['platform']}（符合该平台图片规范）")
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

_running: set = set()
_lock = threading.Lock()
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


def _api(method: str, path: str, timeout: int = 60, **kwargs) -> requests.Response:
    """带 Basic Auth 的接口请求"""
    url = settings.H3_BASE_URL.rstrip("/") + path
    resp = requests.request(
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
    """读取生成类型提示词模板（运营可直接调优 JSON，无需改代码）"""
    try:
        with open(settings.IMAGE_PROMPT_TEMPLATES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise AIImageError(f"读取提示词模板失败: {e}")


def _build_prompt(gen_type: str, product_info: str, extra_prompt: str,
                  brand_genes: str = "") -> str:
    """按生成类型拼接提示词。用 replace 而非 format，避免用户文本中的花括号报错"""
    templates = _load_prompt_templates()
    tpl = templates.get(gen_type, {}).get("template")
    if not tpl:
        raise AIImageError(f"生成类型 {gen_type} 缺少提示词模板")
    out = (tpl
           .replace("{product_info}", f"商品信息：{product_info}" if product_info else "")
           .replace("{extra_prompt}", f"\n补充要求：{extra_prompt}" if extra_prompt else ""))
    if brand_genes:
        out += f"\n品牌与视觉要求：{brand_genes}"
    return out


def _build_workflow(
    *,
    prompt: str,
    aspect_ratio: str,
    seed: int,
    image_name: str,
    filename_prefix: str,
) -> Dict[str, Any]:
    """读取工作流模板并填入本次生成参数（switch=true 走 EmptyLatentImage 生图路径）"""
    try:
        with open(settings.IMAGE_WORKFLOW_PATH, encoding="utf-8") as f:
            wf = json.load(f)
    except Exception as e:
        raise AIImageError(f"读取生图工作流模板失败: {e}")

    wf[NODE_PROMPT]["inputs"]["value"] = prompt
    wf[NODE_REF_IMAGE]["inputs"]["image"] = image_name
    wf[NODE_RESOLUTION]["inputs"]["aspect_ratio"] = ASPECT_RATIO_MAP.get(
        aspect_ratio, ASPECT_RATIO_MAP["1:1"]
    )
    wf[NODE_RESOLUTION]["inputs"]["megapixels"] = 1.5
    wf[NODE_SEED]["inputs"]["seed"] = int(seed)
    wf[NODE_SAVE]["inputs"]["filename_prefix"] = filename_prefix
    # UNET/CLIP/VAE/KSampler/增强器等固定节点均以模板为准，代码不再覆盖
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


def _aggregate_status(items: List[Dict[str, Any]]) -> str:
    """根据子项状态聚合任务级状态"""
    statuses = [it.get("status") for it in items]
    if not statuses:
        return "生成中"
    if all(s == "已完成" for s in statuses):
        return "已完成"
    if all(s == "失败" for s in statuses):
        return "失败"
    # 仍有子项在排队/生成中 → 任务整体仍在进行
    if any(s in ("排队中", "生成中") for s in statuses):
        return "生成中"
    # 全部到达终态且有成功有失败
    return "部分完成"


def _run_task(task_id: int, comfy_prompt_ids: List[str]) -> None:
    """后台线程：轮询本任务全部子项的 ComfyUI 状态，逐张完成后下载并上传 TOS

    comfy_prompt_ids 与 result_images 按下标一一对应。
    """
    from services import tos_service

    logger.info(f"[AI生图] 任务 {task_id} 开始轮询，{len(comfy_prompt_ids)} 个子项")
    interval = max(3, int(settings.IMAGE_POLL_INTERVAL))
    max_polls = max(1, int(settings.IMAGE_MAX_WAIT_MINUTES * 60 / interval))

    with _slot_sem:
        try:
            pending = {pid: i for i, pid in enumerate(comfy_prompt_ids)}
            started_written = False

            for _ in range(max_polls):
                if not pending:
                    break
                threading.Event().wait(interval)
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
                                "result_images": json.dumps(items, ensure_ascii=False),
                                "status": agg,
                            }
                            if agg in ("已完成", "部分完成", "失败") and all(
                                s in ("已完成", "失败") for s in [it.get("status") for it in items]
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
                                content, filename = _download_image(finfo)
                                _ts = (items[idx] or {}).get("target_size")
                                if _ts and len(_ts) == 2:
                                    try:
                                        content = _fit_to_target(content, tuple(_ts))
                                        filename = filename.rsplit(".", 1)[0] + ".png"
                                    except Exception as fit_err:
                                        logger.warning(f"[AI生图] 任务 {task_id} 子项 {idx} 裁剪失败（用原图）: {fit_err}")
                                url = tos_service.upload_file(
                                    content, filename, content_type="image/png", subdir="ai-image",
                                )
                                sub = dict(items[idx], status="已完成", url=url, error=None)
                                _save(sub, {})
                                logger.info(f"[AI生图] 任务 {task_id} 子项 {idx} 完成: {url}")
                            del pending[pid]
                        elif status_str in ("error", "failed"):
                            msgs = json.dumps(
                                (item.get("status") or {}).get("messages", []), ensure_ascii=False
                            )[:400]
                            sub = dict(items[idx], status="失败", error=msgs or "生成失败")
                            _save(sub, {})
                            logger.error(f"[AI生图] 任务 {task_id} 子项 {idx} 失败: {msgs}")
                            del pending[pid]
                        else:
                            # history 里但仍在执行 → 首次改「生成中」
                            if items[idx].get("status") == "排队中":
                                items[idx] = dict(items[idx], status="生成中")
                                fields = {
                                    "result_images": json.dumps(items, ensure_ascii=False),
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

            # 超时兜底：仍在排队的子项标记失败
            if pending:
                from database.database import SessionLocal
                from models.ai_image_task import AIImageTask
                db = SessionLocal()
                try:
                    task = db.query(AIImageTask).filter(AIImageTask.id == task_id).first()
                    items = _read_json_list(task.result_images if task else None)
                    changed = False
                    for pid, idx in pending.items():
                        if idx < len(items) and items[idx].get("status") not in ("已完成", "失败"):
                            items[idx] = dict(
                                items[idx], status="失败",
                                error=f"生成超时（超过 {settings.IMAGE_MAX_WAIT_MINUTES} 分钟）",
                            )
                            changed = True
                    if changed:
                        db.query(AIImageTask).filter(AIImageTask.id == task_id).update({
                            "result_images": json.dumps(items, ensure_ascii=False),
                            "status": _aggregate_status(items),
                            "finished_at": datetime.now(),
                        })
                        db.commit()
                finally:
                    db.close()
                logger.error(f"[AI生图] 任务 {task_id} 等待超时，{len(pending)} 个子项标记失败")
            else:
                logger.info(f"[AI生图] 任务 {task_id} 全部子项处理完毕")
        except Exception as e:
            logger.error(f"[AI生图] 任务 {task_id} 轮询异常: {e}")
            _update_task(task_id, status="失败", error_message=str(e)[:900],
                         finished_at=datetime.now())
        finally:
            with _lock:
                _running.discard(task_id)


def _ensure_worker(task_id: int, comfy_prompt_ids: Optional[List[str]] = None, *,
                   prep_kwargs: Optional[Dict[str, Any]] = None) -> None:
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
) -> Dict[str, Any]:
    """提交套图生成任务：落库后立即返回，准备与轮询全部在后台线程

    :param generation_types: 生成类型 key 列表（GEN_TYPES 的子集）
    :param images: [(文件名, 图片字节)]，1~5 张参考图
    """
    _ensure_models_loaded()
    from database.database import SessionLocal
    from models.ai_image_task import AIImageTask

    if not images:
        raise AIImageError("请至少上传一张参考图")
    if len(images) > 5:
        raise AIImageError("最多上传 5 张参考图")
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

    no_text_mode = bool((brand_settings or {}).get("no_text_mode"))

    # 生成计划：(类型键, 生成比例, 目标裁剪尺寸|None, 展示名, seq, no_text)
    gen_plan: List[Tuple[str, str, Optional[Tuple[int, int]], str, int, bool]] = []
    if aplus_type:
        spec = APLUS_SPECS[aplus_type]
        for seq in range(image_count):
            gen_plan.append((aplus_type, spec["gen_ratio"], spec["target_size"], spec["label"], seq, False))
    for t, c in main_counts.items():
        for seq in range(c):
            gen_plan.append((t, main_aspect_ratio, None, MAIN_GEN_TYPES[t], seq, no_text_mode))

    # 展开子任务（target_size 供轮询完成后裁剪；no_text 供提示词追加无文字指令）
    items: List[Dict[str, Any]] = []
    for (t, _ratio, target_size, label, seq, _no_text) in gen_plan:
        items.append({
            "type": t, "label": label, "seq": seq,
            "status": "排队中", "url": None, "error": None,
            "target_size": list(target_size) if target_size else None,
            "no_text": no_text_mode and t in MAIN_GEN_TYPES,
        })
    display_types = [aplus_type] if aplus_type else []
    display_types += list(main_counts.keys())
    total_sheets = (image_count if aplus_type else 0) + sum(main_counts.values())

    db = SessionLocal()
    try:
        task = AIImageTask(
            tenant_id=tenant_id, user_id=user_id, creator_name=creator_name,
            title=title, status="排队中",
            generation_types=json.dumps(display_types, ensure_ascii=False),
            aspect_ratio=main_aspect_ratio, image_count=image_count,
            product_info=product_info or None, prompt=prompt or None,
            product_code=product_code or None, product_name=product_name or None,
            aplus_type=aplus_type,
            main_types=json.dumps(main_counts, ensure_ascii=False) if main_counts else None,
            main_aspect_ratio=main_aspect_ratio if main_counts else None,
            brand_settings=json.dumps(brand_settings, ensure_ascii=False) if brand_settings else None,
            result_images=json.dumps(items, ensure_ascii=False),
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
        },
    )

    db = SessionLocal()
    try:
        return _serialize(db.query(AIImageTask).filter(AIImageTask.id == task_id).first())
    finally:
        db.close()


def _prepare_and_run(
    task_id: int,
    *,
    images: List[Tuple[str, bytes]],
    gen_plan: List[Tuple[str, str, Optional[Tuple[int, int]], str]],
    image_count: int,
    product_info: str,
    extra_prompt: str,
    brand_genes: str = "",
) -> None:
    """后台线程：参考图传 TOS → 传 ComfyUI → 逐项提交工作流（不同 seed）→ 轮询到完成"""
    from services import tos_service

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

        # 1. 参考图存 TOS（并行上传），供前端展示
        def _to_tos(item: Tuple[str, bytes]) -> Optional[str]:
            name, content = item
            try:
                return tos_service.upload_file(content, name, subdir="ai-image")
            except Exception as e:
                logger.warning(f"[AI生图] 参考图上传 TOS 失败（不影响生成）: {e}")
                return None

        with ThreadPoolExecutor(max_workers=5) as ex:
            urls = [u for u in ex.map(_to_tos, images) if u]
        if urls:
            _update_task(task_id, images=json.dumps(urls, ensure_ascii=False))

        # 2. 参考图上传 ComfyUI（首张作为主参考）
        def _to_comfy(item) -> str:
            idx, (_, content) = item
            return _upload_image(idx, content)

        with ThreadPoolExecutor(max_workers=5) as ex:
            image_names = list(ex.map(_to_comfy, enumerate(images)))

        # 3. 按「类型 × 张数」逐项提交工作流，不同 seed；先全部提交后统一轮询
        items: List[Dict[str, Any]] = []
        prompt_ids: List[str] = []
        for (t, gen_ratio, target_size, label, seq, no_text) in gen_plan:
            prompt_text = _build_prompt(t, product_info, extra_prompt, brand_genes)
            if no_text:
                prompt_text += "\n无文字模式：画面中不要出现任何文字、标语、水印或标识。"
            seed = random.randint(1, 2**31 - 1)
            workflow = _build_workflow(
                prompt=prompt_text,
                aspect_ratio=gen_ratio,
                seed=seed,
                image_name=image_names[0],
                filename_prefix=f"AIIMG-{task_id}-{t}-{seq}",
            )
            resp = _api("POST", "/prompt", json={"prompt": workflow})
            pid = resp.json()["prompt_id"]
            prompt_ids.append(pid)
            items.append({
                "type": t, "label": label, "seq": seq,
                "status": "排队中", "url": None, "error": None,
                "target_size": list(target_size) if target_size else None,
                "no_text": no_text,
            })

        _update_task(
            task_id,
            comfy_prompt_ids=json.dumps(prompt_ids, ensure_ascii=False),
            result_images=json.dumps(items, ensure_ascii=False),
        )
        logger.info(f"[AI生图] 任务 {task_id} 已提交 {len(prompt_ids)} 个子任务")

        # 4. 同线程继续轮询直到完成（成功后 finally 里清除 _running）
        _run_task(task_id, prompt_ids)
    except Exception as e:
        logger.error(f"[AI生图] 任务 {task_id} 准备阶段异常: {e}")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
        with _lock:
            _running.discard(task_id)


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
        "cost_seconds": cost_seconds,
        "error_message": task.error_message,
        "created_at": task.created_at.strftime("%Y-%m-%d %H:%M") if task.created_at else "",
    }


def list_image_tasks(
    tenant_id: int, page: int = 1, page_size: int = 10, keyword: str = ""
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
        keyword = (keyword or "").strip()
        if keyword:
            like = f"%{keyword}%"
            query = query.filter(
                or_(
                    AIImageTask.product_code.ilike(like),
                    AIImageTask.product_name.ilike(like),
                    AIImageTask.title.ilike(like),
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

        # 未拿到 ComfyUI 任务 ID 的记录已无法追踪，直接标记失败
        orphan = db.query(AIImageTask).filter(
            AIImageTask.status.in_(["排队中", "生成中"]),
            AIImageTask.comfy_prompt_ids.is_(None),
            AIImageTask.deleted_at.is_(None),
        )
        orphan_count = orphan.update(
            {"status": "失败", "error_message": "服务重启导致任务中断，请重新提交",
             "finished_at": datetime.now()},
            synchronize_session=False,
        )
        db.commit()
        if orphan_count:
            logger.warning(f"[AI生图] {orphan_count} 条未提交成功的任务已标记为失败")
    finally:
        db.close()

    for task_id, pids in pending:
        if pids:
            logger.info(f"[AI生图] 恢复未完成任务 {task_id}（{len(pids)} 个子任务）")
            _ensure_worker(task_id, pids)
