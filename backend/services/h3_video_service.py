"""MiniMax H3 视频生成服务（对接本地部署的 ComfyUI API）

流程：上传参考图 → 提交工作流 → 每 15 秒轮询进度 → 生成完自动下载 → 上传 TOS → 回写任务状态。

接口（均需 Basic Auth）：
    POST /upload/image      上传参考图
    POST /prompt            提交任务（JSON 里是工作流）
    GET  /history/{任务ID}   查状态（完成后 GET /view 下载成片）
"""
import io
import json
import logging
import re
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

from config import get_settings
from services.h3_prompt_optimizer import optimize_h3_prompt

logger = logging.getLogger(__name__)
settings = get_settings()

# 分辨率档位 → megapixels（0.4 草稿 ~ 0.98 满画幅）
RESOLUTION_MP: Dict[str, float] = {
    "0.3": 0.3,
    "0.5": 0.5,
    "768P": 0.98,   # 0.98 即官方 768p（1344x768）
}

# 视频比例 → ComfyUI ResolutionSelector 的选项字符串
ASPECT_RATIO_MAP: Dict[str, str] = {
    "auto": "9:16 (Portrait Widescreen)",
    "9:16": "9:16 (Portrait Widescreen)",
    "16:9": "16:9 (Widescreen)",
    "1:1": "1:1 (Square)",
    "4:3": "4:3 (Standard)",
    "3:4": "3:4 (Portrait Standard)",
    "21:9": "21:9 (Ultrawide)",
}

# 工作流中的固定节点编号（与 workflows/h3_workflow_template.json 对应，2026-09-27 三重加速版：
# UNET 26 → SAGE Attention 27 → Turbo LoRA 29 → TE-Speed 45 → BasicGuider 31）
NODE_DURATION = "48"          # PrimitiveFloat，时长（秒），输入 value
NODE_RESOLUTION = "46"        # ResolutionSelector，输入 aspect_ratio / megapixels
NODE_REF_IMAGE = "42"         # 首张参考图 LoadImage
NODE_H3_CONDITIONING = "43"   # MiniMaxH3ReferenceToVideo：prompt 直接写在 inputs.prompt，ref_images.ref_image_i 也挂在这里
NEW_IMAGE_NODE_BASE = 200     # 追加参考图时新增 LoadImage 节点的起始编号（模板最大节点号 51，不会冲突）

_running: set = set()
_lock = threading.Lock()

# 中文数字 → 序号（参考图最多 9 张）
_CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _detect_person_picture(prompt: str, image_count: int) -> int:
    """从方案文本提取人物参考图序号（1-based，0 表示无）。

    方案生成时若参考图含人物，模特字段会带“（人物参考图：第 N 张）”标注。
    """
    m = re.search(r"人物参考图\s*[：:]\s*第\s*([0-9一二三四五六七八九]+)\s*张", prompt or "")
    if not m:
        return 0
    token = m.group(1)
    n = _CN_NUM.get(token) or (int(token) if token.isdigit() else 0)
    return n if 1 <= n <= image_count else 0


class H3VideoError(Exception):
    """H3 视频生成异常"""
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
        raise H3VideoError("H3 服务认证失败，请检查账号密码")
    resp.raise_for_status()
    return resp


def _normalize_for_comfy(content: bytes) -> bytes:
    """上传前统一压成 JPEG（长边 ≤2048、透明底合成白底）。

    超大原图或特殊格式会导致上传/解析偶发失败，且 H3 参考图管线本身就会缩到 2048。
    压缩失败时回退原始字节。
    """
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
    """上传参考图到 ComfyUI，返回服务器端文件名。

    文件名统一为纯 ASCII，避免特殊字符问题；失败自动重试一次。
    """
    name = f"aivideo-{int(time.time() * 1000)}-{idx}.jpg"
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
        except requests.HTTPError as e:
            body = ""
            if e.response is not None:
                body = (e.response.text or "")[:200]
            last_err = f"{e}; {body}"
            logger.warning(f"[H3视频] 参考图上传第 {attempt} 次失败: {last_err}")
            threading.Event().wait(2)
        except Exception as e:
            last_err = str(e)
            logger.warning(f"[H3视频] 参考图上传第 {attempt} 次异常: {e}")
            threading.Event().wait(2)

    raise H3VideoError(f"H3 参考图上传失败（已重试）: {last_err}")


def _build_workflow(
    *,
    prompt: str,
    duration: int,
    resolution: str,
    ratio: str,
    image_names: List[str],
    with_ref_note: bool = True,
    person_picture: int = 0,
) -> Dict[str, Any]:
    """读取工作流模板并填入本次生成参数

    :param with_ref_note: 是否附加中文参考图说明。二次优化后的提示词已按官方格式
        定义 <Picture N>，不再需要该说明（混入中文会破坏结构化格式）。
    :param person_picture: 人物参考图序号（1-based，0 表示无），用于回退说明文案。
    """
    try:
        with open(settings.H3_WORKFLOW_PATH, encoding="utf-8") as f:
            wf = json.load(f)
    except Exception as e:
        raise H3VideoError(f"读取 H3 工作流模板失败: {e}")

    # 提示词中通过 <Picture i> 引用参考图（i 从 1 开始）
    if with_ref_note and image_names:
        if 1 <= person_picture <= len(image_names):
            ref_note = (
                f"参考图说明：<Picture {person_picture}> 为人物参考图，模特形象以其为准；"
                f"其余 <Picture> 为同一产品的多角度参考图，"
                "请严格保持人物形象与商品外观、颜色、材质、图案、包装的一致性。\n\n"
            )
        else:
            ref_note = (
                f"参考图说明：<Picture 1> 至 <Picture {len(image_names)}> 为同一产品的多角度参考图，"
                "请严格保持商品的外观、颜色、材质、图案与包装一致性。\n\n"
            )
    else:
        ref_note = ""

    # 提示词直接写在 H3 节点的 prompt 输入上（三重加速版模板没有独立的提示词节点）
    wf[NODE_H3_CONDITIONING]["inputs"]["prompt"] = ref_note + prompt
    wf[NODE_DURATION]["inputs"]["value"] = float(duration)
    wf[NODE_RESOLUTION]["inputs"]["megapixels"] = RESOLUTION_MP.get(resolution, 0.5)
    wf[NODE_RESOLUTION]["inputs"]["aspect_ratio"] = ASPECT_RATIO_MAP.get(
        ratio, ASPECT_RATIO_MAP["9:16"]
    )
    wf[NODE_REF_IMAGE]["inputs"]["image"] = image_names[0]

    # 追加参考图：新增 LoadImage 节点，挂到 ref_images.ref_image_1 ... 上
    for idx, name in enumerate(image_names[1:], start=1):
        node_id = str(NEW_IMAGE_NODE_BASE + idx)
        wf[node_id] = {
            "inputs": {"image": name},
            "class_type": "LoadImage",
            "_meta": {"title": "加载图像"},
        }
        wf[NODE_H3_CONDITIONING]["inputs"][f"ref_images.ref_image_{idx}"] = [node_id, 0]

    # 步数/LoRA/TE-Speed 参数均以模板为准（BasicScheduler 39 已写死 15 步），代码不再覆盖
    # 随机种子：模板用 rgthree Seed 节点且值为 -1，服务端执行时会自动生成随机种子

    return wf


def _extract_output_file(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """从 ComfyUI 任务结果中取出成片文件信息"""
    finfo = None
    for node_out in (item.get("outputs") or {}).values():
        for key in ("gifs", "videos", "images"):
            for f in node_out.get(key) or []:
                finfo = f
    return finfo


def _download_video(finfo: Dict[str, Any]) -> Tuple[bytes, str]:
    """下载成片，返回 (字节内容, 文件名)"""
    resp = _api("GET", "/view", timeout=1800, params=finfo, stream=True)
    buf = io.BytesIO()
    for chunk in resp.iter_content(1 << 20):
        buf.write(chunk)
    return buf.getvalue(), finfo.get("filename") or "output.mp4"


def _update_task(task_id: int, **fields) -> None:
    """独立会话更新任务记录（后台线程中使用）"""
    from database.database import SessionLocal
    from models.ai_video_task import AIVideoTask

    db = SessionLocal()
    try:
        db.query(AIVideoTask).filter(AIVideoTask.id == task_id).update(fields)
        db.commit()
    except Exception as e:
        logger.error(f"[H3视频] 更新任务 {task_id} 状态失败: {e}")
        db.rollback()
    finally:
        db.close()


def _run_task(task_id: int, h3_prompt_id: str) -> None:
    """后台线程：轮询任务状态，完成后下载并上传 TOS

    ComfyUI 串行执行：任务先在 queue_pending 排队，开始执行进入 queue_running，
    执行完移入 history。据此区分「排队中」与「生成中」。
    """
    from services import tos_service

    with _lock:
        if task_id in _running:
            return
        _running.add(task_id)

    logger.info(f"[H3视频] 任务 {task_id}（ComfyUI {h3_prompt_id}）开始轮询")
    interval = max(5, int(settings.H3_POLL_INTERVAL))
    max_polls = max(1, int(settings.H3_MAX_WAIT_MINUTES * 60 / interval))
    last_status = ""  # 仅状态变化时写库，避免每轮空写
    started_written = False  # 首次进入「生成中」记录开始时间，耗时不含排队

    def set_status(status: str) -> None:
        nonlocal last_status, started_written
        if status != last_status:
            if status == "生成中" and not started_written:
                _update_task(task_id, status=status, started_at=datetime.now())
                started_written = True
            else:
                _update_task(task_id, status=status)
            last_status = status

    try:
        for _ in range(max_polls):
            threading.Event().wait(interval)
            try:
                history = _api("GET", f"/history/{h3_prompt_id}").json()
            except Exception as e:
                logger.warning(f"[H3视频] 任务 {task_id} 查询失败，稍后重试: {e}")
                continue

            item = history.get(h3_prompt_id)
            if item is None:
                # 不在 history：查队列区分排队/执行中
                try:
                    queue = _api("GET", "/queue").json()
                except Exception as e:
                    logger.warning(f"[H3视频] 任务 {task_id} 查询队列失败: {e}")
                    continue
                running_ids = {e[1] for e in (queue.get("queue_running") or []) if len(e) > 1}
                pending_ids = {e[1] for e in (queue.get("queue_pending") or []) if len(e) > 1}
                if h3_prompt_id in running_ids:
                    set_status("生成中")
                elif h3_prompt_id in pending_ids:
                    set_status("排队中")
                # 两者都不在：瞬态（刚提交待入队/刚完成待写入 history），保持现状
                continue

            status_str = (item.get("status") or {}).get("status_str")
            if status_str == "success":
                finfo = _extract_output_file(item)
                if not finfo:
                    _update_task(
                        task_id, status="失败", error_message="生成完成但未找到成片文件",
                        finished_at=datetime.now(),
                    )
                    logger.error(f"[H3视频] 任务 {task_id} 找不到输出文件: {item.get('outputs')}")
                    return

                content, filename = _download_video(finfo)
                logger.info(f"[H3视频] 任务 {task_id} 成片已下载，{len(content) // 1024}KB")
                video_url = tos_service.upload_file(
                    content, filename, content_type="video/mp4", subdir="ai-video",
                )
                _update_task(
                    task_id, status="已完成", video_url=video_url,
                    finished_at=datetime.now(), error_message=None,
                )
                logger.info(f"[H3视频] 任务 {task_id} 完成: {video_url}")
                return

            if status_str in ("error", "failed"):
                msgs = json.dumps(
                    (item.get("status") or {}).get("messages", []), ensure_ascii=False
                )[:800]
                _update_task(
                    task_id, status="失败", error_message=msgs or "生成失败",
                    finished_at=datetime.now(),
                )
                logger.error(f"[H3视频] 任务 {task_id} 生成失败: {msgs}")
                return

            # history 里但状态异常，兜底视为执行中
            set_status("生成中")

        _update_task(
            task_id, status="失败",
            error_message=f"生成超时（超过 {settings.H3_MAX_WAIT_MINUTES} 分钟）",
            finished_at=datetime.now(),
        )
        logger.error(f"[H3视频] 任务 {task_id} 等待超时")
    except Exception as e:
        logger.error(f"[H3视频] 任务 {task_id} 处理异常: {e}")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
    finally:
        with _lock:
            _running.discard(task_id)


def _ensure_worker(task_id: int, h3_prompt_id: str) -> None:
    """确保某任务有后台线程在跑（避免重复启动）"""
    with _lock:
        if task_id in _running:
            return
    threading.Thread(
        target=_run_task, args=(task_id, h3_prompt_id), daemon=True,
        name=f"h3-video-task-{task_id}",
    ).start()


def submit_video_task(
    *,
    tenant_id: int,
    user_id: int,
    creator_name: str = "",
    title: str,
    prompt: str,
    images: List[Tuple[str, bytes]],
    duration: int,
    resolution: str,
    ratio: str,
    model: str,
    market: str,
    voiceover_language: str = "自动",
    product_code: str = "",
    product_name: str = "",
) -> Dict[str, Any]:
    """提交视频生成任务：参考图上传 ComfyUI + 落库 + 启动后台轮询

    :param images: [(文件名, 图片字节)]，1~9 张
    """
    from database.database import SessionLocal
    from models.ai_video_task import AIVideoTask
    from services import tos_service

    if not images:
        raise H3VideoError("请至少上传一张参考图")
    if len(images) > 9:
        raise H3VideoError("最多上传 9 张参考图")

    # 1. 先落库，拿到任务 ID（后续进度都回写到这条记录）
    db = SessionLocal()
    try:
        task = AIVideoTask(
            tenant_id=tenant_id, user_id=user_id, creator_name=creator_name,
            title=title, status="排队中", prompt=prompt,
            product_code=product_code or None, product_name=product_name or None,
            market=market, voiceover_language=voiceover_language, model=model,
            resolution=resolution, duration=duration, ratio=ratio,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        task_id = task.id
    finally:
        db.close()

    # 2. 参考图存 TOS，供前端「参考图片」展示（原图上传 ComfyUI 后本地不再持有）
    image_urls: List[str] = []
    for name, content in images:
        try:
            image_urls.append(tos_service.upload_file(content, name, subdir="ai-video"))
        except Exception as e:
            logger.warning(f"[H3视频] 参考图上传 TOS 失败（不影响生成）: {e}")
    _update_task(task_id, images=json.dumps(image_urls, ensure_ascii=False))

    # 3. 提示词二次优化：按 H3 官方指南改写为 Ref2VA 六段式英文提示词；失败回退原始方案文本
    person_picture = _detect_person_picture(prompt, len(images))
    optimized_prompt = ""
    if settings.H3_PROMPT_OPTIMIZE:
        try:
            optimized_prompt = optimize_h3_prompt(
                plan_prompt=prompt,
                duration=duration,
                ratio=ratio,
                image_count=len(images),
                voiceover_language=voiceover_language,
                product_name=title,
                person_picture=person_picture,
            )
            _update_task(task_id, h3_prompt=optimized_prompt)
            logger.info(
                f"[H3视频] 任务 {task_id} 提示词已优化，{len(optimized_prompt)} 字符"
                + (f"，人物参考 <Picture {person_picture}>" if person_picture else "")
            )
        except Exception as e:
            logger.warning(f"[H3视频] 任务 {task_id} 提示词优化失败，回退原始提示词: {e}")

    # 4. 上传参考图并提交工作流
    try:
        image_names = [_upload_image(i, content) for i, (_, content) in enumerate(images)]
        workflow = _build_workflow(
            prompt=optimized_prompt or prompt,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            image_names=image_names,
            with_ref_note=not optimized_prompt,
            person_picture=person_picture,
        )
        resp = _api("POST", "/prompt", json={"prompt": workflow})
        h3_prompt_id = resp.json()["prompt_id"]
    except Exception as e:
        logger.error(f"[H3视频] 任务 {task_id} 提交失败: {e}")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
        raise H3VideoError(f"提交 H3 生成任务失败: {e}")

    # 提交成功仅代表进入 ComfyUI 队列，保持「排队中」；开始执行后由轮询线程按 /queue 判定改「生成中」
    _update_task(task_id, h3_prompt_id=h3_prompt_id)
    logger.info(f"[H3视频] 任务 {task_id} 已提交，ComfyUI ID={h3_prompt_id}")

    # 5. 后台线程轮询进度直到完成
    _ensure_worker(task_id, h3_prompt_id)

    db = SessionLocal()
    try:
        return _serialize(db.query(AIVideoTask).filter(AIVideoTask.id == task_id).first())
    finally:
        db.close()


def _serialize(task) -> Dict[str, Any]:
    """任务记录 → 前端结构"""
    if not task:
        return {}
    try:
        images = json.loads(task.images) if task.images else []
    except Exception:
        images = []
    # 生成耗时（秒）：完成时间 - 开始生成时间（无开始时间回退提交时间，兼容历史数据）
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
        "title": task.title or "视频生成任务",
        "status": task.status,
        "creator_name": task.creator_name or "",
        "prompt": task.prompt or "",
        "h3_prompt": task.h3_prompt or "",
        "product_code": task.product_code or "",
        "product_name": task.product_name or "",
        "market": task.market,
        "voiceover_language": task.voiceover_language or "自动",
        "model": task.model,
        "resolution": task.resolution,
        "duration": task.duration,
        "ratio": task.ratio,
        "images": images,
        "video_url": task.video_url,
        "h3_prompt_id": task.h3_prompt_id or "",
        "cost_seconds": cost_seconds,
        "error_message": task.error_message,
        "created_at": task.created_at.strftime("%Y-%m-%d %H:%M") if task.created_at else "",
    }


def list_video_tasks(
    tenant_id: int, page: int = 1, page_size: int = 10, keyword: str = ""
) -> Dict[str, Any]:
    """租户的视频生成任务列表（按时间倒序，不做账号隔离）。含失败任务及其失败原因。

    keyword 模糊匹配产品编码 / 产品品名 / 任务标题。
    返回 {"items": [...], "total": 总条数}，供前端分页。
    """
    from database.database import SessionLocal
    from models.ai_video_task import AIVideoTask
    from sqlalchemy import or_

    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    db = SessionLocal()
    try:
        query = db.query(AIVideoTask).filter(
            AIVideoTask.tenant_id == tenant_id,
            AIVideoTask.deleted_at.is_(None),
        )
        keyword = (keyword or "").strip()
        if keyword:
            like = f"%{keyword}%"
            query = query.filter(
                or_(
                    AIVideoTask.product_code.ilike(like),
                    AIVideoTask.product_name.ilike(like),
                    AIVideoTask.title.ilike(like),
                )
            )
        total = query.count()
        rows = (
            query.order_by(AIVideoTask.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        items = [_serialize(r) for r in rows]
        # 附加已完成的超分结果（按源视频地址匹配，取最新一条），供前端并排对比展示
        try:
            from models.video_upscale_task import VideoUpscaleTask

            video_urls = [r.video_url for r in rows if r.video_url]
            if video_urls:
                up_rows = (
                    db.query(VideoUpscaleTask)
                    .filter(
                        VideoUpscaleTask.tenant_id == tenant_id,
                        VideoUpscaleTask.status == "已完成",
                        VideoUpscaleTask.deleted_at.is_(None),
                        VideoUpscaleTask.source_video_url.in_(video_urls),
                    )
                    .order_by(VideoUpscaleTask.id.desc())
                    .all()
                )
                mapping: Dict[str, str] = {}
                for up in up_rows:
                    if up.source_video_url and up.video_url:
                        mapping.setdefault(up.source_video_url, up.video_url)
                for r, item in zip(rows, items):
                    if r.video_url and r.video_url in mapping:
                        item["upscale_video_url"] = mapping[r.video_url]
        except Exception as e:
            logger.warning(f"生成历史附加超分结果失败: {e}")
        return {"items": items, "total": total}
    finally:
        db.close()


def delete_video_task(tenant_id: int, task_id: int) -> None:
    """删除任务记录（软删除，不影响已生成的成片）"""
    from database.database import SessionLocal
    from models.ai_video_task import AIVideoTask

    db = SessionLocal()
    try:
        db.query(AIVideoTask).filter(
            AIVideoTask.id == task_id, AIVideoTask.tenant_id == tenant_id
        ).update({"deleted_at": datetime.now()})
        db.commit()
    finally:
        db.close()


def resume_pending_tasks() -> None:
    """服务启动时恢复未完成的任务：重新挂上后台轮询线程"""
    from database.database import SessionLocal
    from models.ai_video_task import AIVideoTask

    db = SessionLocal()
    try:
        rows = (
            db.query(AIVideoTask)
            .filter(
                AIVideoTask.status.in_(["排队中", "生成中"]),
                AIVideoTask.h3_prompt_id.isnot(None),
                AIVideoTask.deleted_at.is_(None),
            )
            .all()
        )
        pending = [(r.id, r.h3_prompt_id) for r in rows]

        # 未拿到 ComfyUI 任务 ID 的记录已无法追踪，直接标记失败，避免一直停在“排队中”
        orphan = db.query(AIVideoTask).filter(
            AIVideoTask.status.in_(["排队中", "生成中"]),
            AIVideoTask.h3_prompt_id.is_(None),
            AIVideoTask.deleted_at.is_(None),
        )
        orphan_count = orphan.update(
            {"status": "失败", "error_message": "服务重启导致任务中断，请重新提交",
             "finished_at": datetime.now()},
            synchronize_session=False,
        )
        db.commit()
        if orphan_count:
            logger.warning(f"[H3视频] {orphan_count} 条未提交成功的任务已标记为失败")
    finally:
        db.close()

    for task_id, h3_prompt_id in pending:
        logger.info(f"[H3视频] 恢复未完成任务 {task_id}（ComfyUI {h3_prompt_id}）")
        _ensure_worker(task_id, h3_prompt_id)