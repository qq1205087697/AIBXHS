"""视频超分（Topaz 星光 2.6）服务

与 H3 视频生成共用同一台 ComfyUI（串行排队）。流程：
下载源视频 → 上传 ComfyUI → 构建超分工作流入队 → 后台轮询 → 下载成片 → 上传 TOS。
"""
import io
import json
import logging
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

MAX_SCALE = 4.0  # 与工作流模板 TopazStarlight 放大倍数上限一致


class UpscaleError(Exception):
    """超分任务异常"""
    pass


def _api(method: str, path: str, timeout: int = 60, **kwargs) -> requests.Response:
    """带 Basic Auth 的 ComfyUI 接口请求"""
    url = settings.H3_BASE_URL.rstrip("/") + path
    resp = requests.request(
        method,
        url,
        auth=(settings.H3_AUTH_USER, settings.H3_AUTH_PASSWORD),
        timeout=timeout,
        **kwargs,
    )
    if resp.status_code == 401:
        raise UpscaleError("H3 服务认证失败，请检查账号密码")
    resp.raise_for_status()
    return resp


def _upload_video(content: bytes) -> str:
    """源视频上传 ComfyUI input 目录，返回服务器端文件名（失败重试一次）"""
    name = f"upscale-{int(time.time() * 1000)}.mp4"
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
            body = (e.response.text or "")[:200] if e.response is not None else ""
            last_err = f"{e}; {body}"
            logger.warning(f"[超分] 源视频上传第 {attempt} 次失败: {last_err}")
            threading.Event().wait(2)
        except Exception as e:
            last_err = str(e)
            logger.warning(f"[超分] 源视频上传第 {attempt} 次异常: {e}")
            threading.Event().wait(2)
    raise UpscaleError(f"源视频上传 ComfyUI 失败（已重试）: {last_err}")


def _build_workflow(video_name: str, scale: float) -> Dict[str, Any]:
    """读取超分工作流模板并填入本次参数"""
    try:
        with open(settings.UPSCALE_WORKFLOW_PATH, encoding="utf-8") as f:
            wf = json.load(f)
    except Exception as e:
        raise UpscaleError(f"读取超分工作流模板失败: {e}")

    wf["27"]["inputs"]["video"] = video_name
    wf["24"]["inputs"]["放大倍数"] = float(scale)
    return wf


def _extract_output_file(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """从 ComfyUI 结果中取出超分成片文件信息（VHS_VideoCombine 的 gifs/videos）"""
    finfo = None
    for node_out in (item.get("outputs") or {}).values():
        for key in ("gifs", "videos", "images"):
            for f in node_out.get(key) or []:
                finfo = f
    return finfo


def _download(url: str, timeout: int = 1800) -> bytes:
    """流式下载文件到内存"""
    resp = requests.get(url, timeout=timeout, stream=True)
    resp.raise_for_status()
    buf = io.BytesIO()
    for chunk in resp.iter_content(1 << 20):
        buf.write(chunk)
    return buf.getvalue()


def _download_comfy_file(finfo: Dict[str, Any]) -> Tuple[bytes, str]:
    """按 ComfyUI 文件信息下载结果文件"""
    resp = _api("GET", "/view", timeout=1800, params=finfo, stream=True)
    buf = io.BytesIO()
    for chunk in resp.iter_content(1 << 20):
        buf.write(chunk)
    return buf.getvalue(), finfo.get("filename") or "upscaled.mp4"


def _update_task(task_id: int, **fields) -> None:
    """独立会话更新任务记录（后台线程中使用）"""
    from database.database import SessionLocal
    from models.video_upscale_task import VideoUpscaleTask

    db = SessionLocal()
    try:
        db.query(VideoUpscaleTask).filter(VideoUpscaleTask.id == task_id).update(fields)
        db.commit()
    except Exception as e:
        logger.error(f"[超分] 更新任务 {task_id} 状态失败: {e}")
        db.rollback()
    finally:
        db.close()


_lock = threading.Lock()
_running: set = set()


def _run_task(task_id: int) -> None:
    """后台线程：下载源视频 → 上传入队 → 轮询 → 成片上传 TOS

    说明：源视频下载/上传在拿到 ComfyUI 队列位后才开始（线程内串行），
    期间任务状态保持「排队中」，入队成功后改「处理中」。
    """
    from services import tos_service

    with _lock:
        if task_id in _running:
            return
        _running.add(task_id)

    interval = max(5, int(settings.H3_POLL_INTERVAL))
    max_polls = max(1, int(settings.H3_MAX_WAIT_MINUTES * 60 / interval))
    last_status = ""
    started_written = False

    def set_status(status: str) -> None:
        nonlocal last_status, started_written
        if status != last_status:
            if status == "处理中" and not started_written:
                _update_task(task_id, status=status, started_at=datetime.now())
                started_written = True
            else:
                _update_task(task_id, status=status)
            last_status = status

    try:
        # 1. 取任务信息并下载源视频
        from database.database import SessionLocal
        from models.video_upscale_task import VideoUpscaleTask

        db = SessionLocal()
        try:
            task = db.query(VideoUpscaleTask).filter(VideoUpscaleTask.id == task_id).first()
            source_url = task.source_video_url if task else None
        finally:
            db.close()
        if not source_url:
            raise UpscaleError("找不到源视频地址")

        logger.info(f"[超分] 任务 {task_id} 开始下载源视频: {source_url}")
        content = _download(source_url)
        logger.info(f"[超分] 任务 {task_id} 源视频已下载，{len(content) // 1024}KB")

        # 2. 上传 ComfyUI 并提交工作流
        video_name = _upload_video(content)
        workflow = _build_workflow(video_name, _get_scale(task_id))
        resp = _api("POST", "/prompt", json={"prompt": workflow})
        prompt_id = resp.json()["prompt_id"]
        _update_task(task_id, comfy_prompt_id=prompt_id)
        logger.info(f"[超分] 任务 {task_id} 已提交，ComfyUI ID={prompt_id}")

        # 3. 轮询直到完成
        for _ in range(max_polls):
            threading.Event().wait(interval)
            try:
                history = _api("GET", f"/history/{prompt_id}").json()
            except Exception as e:
                logger.warning(f"[超分] 任务 {task_id} 查询失败，稍后重试: {e}")
                continue

            item = history.get(prompt_id)
            if item is None:
                try:
                    queue = _api("GET", "/queue").json()
                except Exception as e:
                    logger.warning(f"[超分] 任务 {task_id} 查询队列失败: {e}")
                    continue
                running_ids = {e[1] for e in (queue.get("queue_running") or []) if len(e) > 1}
                pending_ids = {e[1] for e in (queue.get("queue_pending") or []) if len(e) > 1}
                if prompt_id in running_ids:
                    set_status("处理中")
                elif prompt_id in pending_ids:
                    set_status("排队中")
                continue

            status_str = (item.get("status") or {}).get("status_str")
            if status_str == "success":
                finfo = _extract_output_file(item)
                if not finfo:
                    _update_task(task_id, status="失败", error_message="处理完成但未找到输出文件",
                                 finished_at=datetime.now())
                    logger.error(f"[超分] 任务 {task_id} 找不到输出文件: {item.get('outputs')}")
                    return
                result, filename = _download_comfy_file(finfo)
                logger.info(f"[超分] 任务 {task_id} 成片已下载，{len(result) // 1024}KB")
                video_url = tos_service.upload_file(
                    result, filename, content_type="video/mp4", subdir="upscale-video",
                )
                _update_task(task_id, status="已完成", video_url=video_url,
                             finished_at=datetime.now(), error_message=None)
                logger.info(f"[超分] 任务 {task_id} 完成: {video_url}")
                return

            if status_str in ("error", "failed"):
                msgs = json.dumps((item.get("status") or {}).get("messages", []),
                                  ensure_ascii=False)[:800]
                _update_task(task_id, status="失败", error_message=msgs or "处理失败",
                             finished_at=datetime.now())
                logger.error(f"[超分] 任务 {task_id} 处理失败: {msgs}")
                return

            set_status("处理中")

        _update_task(task_id, status="失败",
                     error_message=f"处理超时（超过 {settings.H3_MAX_WAIT_MINUTES} 分钟）",
                     finished_at=datetime.now())
        logger.error(f"[超分] 任务 {task_id} 等待超时")
    except Exception as e:
        logger.error(f"[超分] 任务 {task_id} 处理异常: {e}")
        _update_task(task_id, status="失败", error_message=str(e)[:900],
                     finished_at=datetime.now())
    finally:
        with _lock:
            _running.discard(task_id)


def _get_scale(task_id: int) -> float:
    """读取任务的放大倍数"""
    from database.database import SessionLocal
    from models.video_upscale_task import VideoUpscaleTask

    db = SessionLocal()
    try:
        task = db.query(VideoUpscaleTask).filter(VideoUpscaleTask.id == task_id).first()
        return float(task.scale) if task and task.scale else 2.0
    finally:
        db.close()


def _ensure_worker(task_id: int) -> None:
    """确保某任务有后台线程在跑（避免重复启动）"""
    with _lock:
        if task_id in _running:
            return
    threading.Thread(
        target=_run_task, args=(task_id,), daemon=True,
        name=f"upscale-task-{task_id}",
    ).start()


def submit_upscale_task(
    *,
    tenant_id: int,
    user_id: int,
    creator_name: str = "",
    title: str,
    source_video_url: str,
    source_width: int = 0,
    source_height: int = 0,
    scale: float = 2.0,
) -> Dict[str, Any]:
    """提交超分任务：落库 + 启动后台线程（下载/上传/入队/轮询均在后台）"""
    from database.database import SessionLocal
    from models.video_upscale_task import VideoUpscaleTask

    if not source_video_url:
        raise UpscaleError("缺少源视频地址")
    if not 1.0 <= float(scale) <= MAX_SCALE:
        raise UpscaleError(f"放大倍数需在 1.0 ~ {MAX_SCALE} 之间")

    db = SessionLocal()
    try:
        task = VideoUpscaleTask(
            tenant_id=tenant_id, user_id=user_id, creator_name=creator_name,
            title=title, status="排队中",
            source_video_url=source_video_url,
            source_width=source_width or None, source_height=source_height or None,
            scale=float(scale),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        task_id = task.id
    finally:
        db.close()

    logger.info(
        f"[超分] 用户 {user_id} 提交任务 {task_id}: 倍数={scale}, "
        f"源={source_width}x{source_height}, {source_video_url}"
    )
    _ensure_worker(task_id)

    db = SessionLocal()
    try:
        return _serialize(db.query(VideoUpscaleTask).filter(VideoUpscaleTask.id == task_id).first())
    finally:
        db.close()


def _serialize(task) -> Dict[str, Any]:
    """任务记录 → 前端结构"""
    if not task:
        return {}
    cost_seconds = None
    if task.started_at and task.finished_at:
        cost_seconds = int((task.finished_at - task.started_at).total_seconds())
    return {
        "id": task.id,
        "title": task.title or "",
        "creator_name": task.creator_name or "",
        "source_video_url": task.source_video_url or "",
        "source_width": task.source_width,
        "source_height": task.source_height,
        "scale": task.scale,
        "status": task.status,
        "error_message": task.error_message or "",
        "video_url": task.video_url or "",
        "created_at": task.created_at.strftime("%Y-%m-%d %H:%M") if task.created_at else "",
        "cost_seconds": cost_seconds,
    }


def list_upscale_tasks(
    tenant_id: int, page: int = 1, page_size: int = 20, keyword: str = ""
) -> Dict[str, Any]:
    """租户的超分任务列表（按时间倒序），keyword 模糊匹配任务标题"""
    from database.database import SessionLocal
    from models.video_upscale_task import VideoUpscaleTask
    from sqlalchemy import or_

    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    db = SessionLocal()
    try:
        query = db.query(VideoUpscaleTask).filter(
            VideoUpscaleTask.tenant_id == tenant_id,
            VideoUpscaleTask.deleted_at.is_(None),
        )
        keyword = (keyword or "").strip()
        if keyword:
            like = f"%{keyword}%"
            query = query.filter(or_(VideoUpscaleTask.title.ilike(like)))
        total = query.count()
        rows = (
            query.order_by(VideoUpscaleTask.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return {"items": [_serialize(r) for r in rows], "total": total}
    finally:
        db.close()


def delete_upscale_task(tenant_id: int, task_id: int) -> None:
    """软删除超分任务"""
    from database.database import SessionLocal
    from models.video_upscale_task import VideoUpscaleTask

    db = SessionLocal()
    try:
        now = datetime.now()
        updated = db.query(VideoUpscaleTask).filter(
            VideoUpscaleTask.id == task_id,
            VideoUpscaleTask.tenant_id == tenant_id,
            VideoUpscaleTask.deleted_at.is_(None),
        ).update({"deleted_at": now}, synchronize_session=False)
        db.commit()
        if not updated:
            raise UpscaleError("任务不存在或已删除")
    finally:
        db.close()


def resume_pending_tasks() -> None:
    """服务启动时恢复未完成的超分任务：重新挂上后台线程"""
    from database.database import SessionLocal
    from models.video_upscale_task import VideoUpscaleTask

    db = SessionLocal()
    try:
        rows = (
            db.query(VideoUpscaleTask)
            .filter(
                VideoUpscaleTask.status.in_(["排队中", "处理中"]),
                VideoUpscaleTask.deleted_at.is_(None),
            )
            .all()
        )
        pending = [r.id for r in rows]
    finally:
        db.close()

    for task_id in pending:
        logger.info(f"[超分] 恢复未完成任务 {task_id}")
        _ensure_worker(task_id)
