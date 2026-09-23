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
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

from config import get_settings

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

# 工作流中的固定节点编号（与 workflow_template.json 对应）
NODE_DURATION = "132"
NODE_RESOLUTION = "115"
NODE_REF_IMAGE = "137"
NODE_H3_CONDITIONING = "136"    # MiniMax H3 节点，ref_images.ref_image_i 挂在这里
NODE_PROMPT = "138"
NODE_TURBO = "146"
NODE_TURBO_STEPS = "144"
NODE_SEED = "129"
NEW_IMAGE_NODE_BASE = 200   # 追加参考图时新增 LoadImage 节点的起始编号

_running: set = set()
_lock = threading.Lock()


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


def _upload_image(filename: str, content: bytes) -> str:
    """上传参考图到 ComfyUI，返回服务器端文件名"""
    resp = _api(
        "POST",
        "/upload/image",
        files={"image": (filename, content)},
        data={"overwrite": "true"},
    )
    return resp.json()["name"]


def _build_workflow(
    *,
    prompt: str,
    duration: int,
    resolution: str,
    ratio: str,
    image_names: List[str],
) -> Dict[str, Any]:
    """读取工作流模板并填入本次生成参数"""
    try:
        with open(settings.H3_WORKFLOW_PATH, encoding="utf-8") as f:
            wf = json.load(f)
    except Exception as e:
        raise H3VideoError(f"读取 H3 工作流模板失败: {e}")

    # 提示词中通过 <Picture i> 引用参考图（i 从 1 开始）
    ref_note = (
        f"参考图说明：<Picture 1> 至 <Picture {len(image_names)}> 为同一产品的多角度参考图，"
        "请严格保持商品的外观、颜色、材质、图案与包装一致性。\n\n"
    ) if image_names else ""

    wf[NODE_PROMPT]["inputs"]["value"] = ref_note + prompt
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

    # Turbo 加速：H3 与 H3-Lite 当前均开 Turbo 走 8 步
    wf[NODE_TURBO]["inputs"]["value"] = True
    wf[NODE_TURBO_STEPS]["inputs"]["value"] = 12

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
    """后台线程：轮询任务状态，完成后下载并上传 TOS"""
    from services import tos_service

    with _lock:
        if task_id in _running:
            return
        _running.add(task_id)

    logger.info(f"[H3视频] 任务 {task_id}（ComfyUI {h3_prompt_id}）开始轮询")
    interval = max(5, int(settings.H3_POLL_INTERVAL))
    max_polls = max(1, int(settings.H3_MAX_WAIT_MINUTES * 60 / interval))

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
                _update_task(task_id, status="生成中")
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

            _update_task(task_id, status="生成中")

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

    # 3. 上传参考图并提交工作流
    try:
        image_names = [_upload_image(name, content) for name, content in images]
        workflow = _build_workflow(
            prompt=prompt, duration=duration, resolution=resolution, ratio=ratio,
            image_names=image_names,
        )
        resp = _api("POST", "/prompt", json={"prompt": workflow})
        h3_prompt_id = resp.json()["prompt_id"]
    except Exception as e:
        logger.error(f"[H3视频] 任务 {task_id} 提交失败: {e}")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
        raise H3VideoError(f"提交 H3 生成任务失败: {e}")

    _update_task(task_id, h3_prompt_id=h3_prompt_id, status="生成中")
    logger.info(f"[H3视频] 任务 {task_id} 已提交，ComfyUI ID={h3_prompt_id}")

    # 4. 后台线程轮询进度直到完成
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
    # 生成总耗时（秒）：完成时间 - 提交时间
    cost_seconds = None
    if task.finished_at and task.created_at:
        try:
            cost_seconds = int((task.finished_at - task.created_at).total_seconds())
        except Exception:
            cost_seconds = None
    return {
        "id": task.id,
        "title": task.title or "视频生成任务",
        "status": task.status,
        "creator_name": task.creator_name or "",
        "prompt": task.prompt or "",
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


def list_video_tasks(tenant_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    """租户的视频生成任务列表（按时间倒序，不做账号隔离）"""
    from database.database import SessionLocal
    from models.ai_video_task import AIVideoTask

    db = SessionLocal()
    try:
        rows = (
            db.query(AIVideoTask)
            .filter(AIVideoTask.tenant_id == tenant_id, AIVideoTask.deleted_at.is_(None))
            .order_by(AIVideoTask.id.desc())
            .limit(limit)
            .all()
        )
        return [_serialize(r) for r in rows]
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