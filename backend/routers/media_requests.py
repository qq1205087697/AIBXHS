"""媒体创作中心 · 视频需求流转

运营提报 → 运营主管审核需求 → 美工填写/微调提示词并生成 → 美工审核成片
→ 运营二次审核 → 待上传 → Amazon / Ozon 真实上传 → 已上传

数据落库到 media_requests / media_request_logs；生成复用 AI 视频（MiniMax H3），
上传复用 video_bindings 的统一上传通道（Amazon 写飞书 RPA / Ozon Seller API）。
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import asyncio
import json
import logging

from sqlalchemy.orm import Session
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from database.database import get_db
from dependencies import PermissionChecker
from models.user import User
from routers.products import _parse_json_images
from routers.video_bindings import (
    _load_platform_sku_entries,
    SkuVideoUploadBody,
    SkuVideoUploadItem,
    upload_sku_video_unified,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media-requests", tags=["media_requests"])

STAGES = ["待提交", "待审核", "待生成", "已生成", "待确认", "待高清", "待绑定", "待上传", "已上传"]
# 图片类需求类型：与 AI 生图模块（ai_image_service.GEN_TYPES / APLUS_SPECS）对齐
IMAGE_TYPES = ["白底图", "场景图（不带人物）", "场景图（带人物）", "特写图", "特写白底图", "卖点图", "高级A+图", "普通A+图", "手机A+图"]
DEMAND_TYPES = ["口播带货视频", "产品展示视频"] + IMAGE_TYPES
# 已有素材图片提报的用途类型（写图片上传多维表「类型」字段）
IMAGE_STYLES = ["主图", "附图", "A+"]
VIDEO_TYPES = ["口播带货视频", "产品展示视频"]
VIDEO_TYPE_MAP = {"口播带货视频": "口播带货", "产品展示视频": "产品展示"}
RATIOS = ["9:16", "16:9", "1:1", "3:4"]
RESOLUTIONS = ["0.3", "0.5", "0.9"]
DURATIONS = [5, 10, 15]
SITE_MARKET = {"英国UK": "UK", "德国DE": "DE", "俄罗斯RU": "RU"}

READ_PERM = PermissionChecker("ai_video:use", "ai_video:approve", "product:edit")
REVIEW_PERM = PermissionChecker("ai_video:approve")
WORK_PERM = PermissionChecker("ai_video:use", "product:edit")
UPLOAD_PERM = PermissionChecker("ai_video:approve", "product:edit")


# ==================== 工具 ====================

def _json(raw, default):
    if raw is None or raw == "":
        return default
    try:
        if isinstance(raw, (list, dict)):
            return raw
        return json.loads(raw)
    except Exception:
        return default


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _fmt(value) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _add_log(db: Session, tenant_id: int, request_id: int, user: Optional[User],
             action: str, note: str = "") -> None:
    db.execute(text("""
        INSERT INTO media_request_logs (tenant_id, request_id, actor_id, actor_name, action, note)
        VALUES (:tid, :rid, :uid, :uname, :action, :note)
    """), {
        "tid": tenant_id,
        "rid": request_id,
        "uid": user.id if user else None,
        "uname": user.username if user else "系统",
        "action": action,
        "note": (note or "")[:1000],
    })


def _load_row(db: Session, tenant_id: int, request_id: int):
    row = db.execute(text("""
        SELECT * FROM media_requests
        WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
    """), {"id": request_id, "tid": tenant_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="单据不存在")
    return row


def _serialize(row) -> Dict[str, Any]:
    d = dict(row._mapping)
    d["demand_types"] = _json(d.get("demand_types"), [])
    d["ref_images"] = _json(d.get("ref_images"), [])
    d["platform_items"] = _json(d.get("platform_items"), [])
    d["plan"] = _json(d.get("plan"), None)
    d["gen_options"] = _json(d.get("gen_options"), {})
    d["upload_result"] = _json(d.get("upload_result"), None)
    for key in ("gen_time", "hd_time", "upload_time", "submit_time", "reviewer_at", "created_at", "updated_at"):
        d[key] = _fmt(d.get(key))
    return d


def _defaults_for(demand_type: str) -> Dict[str, Any]:
    # 图片类需求不走视频生成管线，video_type 留空；生成方式为美工在待生成页直接上传成片
    return {
        "ratio": "9:16",
        "resolution": "0.3",
        "duration": 15,
        "video_type": VIDEO_TYPE_MAP.get(demand_type, "" if demand_type in IMAGE_TYPES else "口播带货"),
    }


SITE_MARKET_LABEL = {"英国UK": "英国", "德国DE": "德国", "俄罗斯RU": "俄罗斯"}
SITE_LANGUAGE = {"英国UK": "英语", "德国DE": "德语", "俄罗斯RU": "俄语"}
CN_NUMBERS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"]


def _format_plan_prompt(plan: Dict[str, Any], video_type: str) -> str:
    """把单套方案转成 AI 视频生成提示词（与 AI 视频页选方案后的格式一致）。"""
    lines: List[str] = []
    if video_type != "产品展示":
        lines.append(f"[目标语言]：{plan.get('language') or '英语'}口播")
    for label, key in (("情节", "story"), ("模特", "character"), ("环境", "environment"), ("音乐", "music")):
        value = (plan.get(key) or "").strip()
        if value:
            lines.append(f"[{label}]：{value}")
    lines.append("[分镜]：")
    for idx, shot in enumerate(plan.get("storyboard") or []):
        num = CN_NUMBERS[idx] if idx < len(CN_NUMBERS) else str(idx + 1)
        head = f"[镜头{num}]：{shot.get('timestamp') or ''}".rstrip()
        if shot.get("shot_purpose"):
            head += f" | {shot['shot_purpose']}"
        content = f"[内容]：{(shot.get('description') or '').strip()}"
        if video_type != "产品展示" and (shot.get("voiceover") or "").strip():
            content += f"；口播：{shot['voiceover'].strip()}"
        lines.extend([head, content])
    return "\n".join(lines)


def _download_ref_images(urls: List[str], limit: int = 9, timeout: int = 60) -> List[tuple]:
    """服务端下载参考图字节（TOS 同区域直连），任一张失败即报错。"""
    import requests

    out = []
    for idx, url in enumerate(urls[:limit]):
        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
        except Exception as e:
            raise ValueError(f"参考图 {idx + 1} 下载失败：{str(e)[:120]}")
        ctype = (resp.headers.get("content-type") or "").split(";")[0].strip()
        if not ctype.startswith("image/"):
            raise ValueError(f"参考图 {idx + 1} 地址不是图片")
        out.append((f"ref-{idx + 1}.jpg", resp.content))
    return out


def _promote_queued_image_rows(db: Session, tenant_id: int) -> None:
    """排队中的生图单自动流转：同一美工前一张生图完成后，自动提交下一张。

    按单据顺序逐张补位（一次轮询每用户最多提交 1 张），避免并发冲突；
    参考图下载/提交失败时标记「失败」，可人工重新生成。
    """
    from services.ai_image_service import submit_image_task, AIImageError, AIImageBusyError

    queued = db.execute(text("""
        SELECT id, gen_user_id, demand_type, description, prompt, ref_images, product_code, product_name, gen_options
        FROM media_requests
        WHERE tenant_id = :tid AND stage = '待生成' AND gen_status = '排队中'
          AND gen_kind = 'image' AND gen_task_id IS NULL AND deleted_at IS NULL
        ORDER BY gen_user_id, id
    """), {"tid": tenant_id}).fetchall()
    if not queued:
        return

    from models.ai_image_task import AIImageTask

    # 每个用户只保留最早的一条排队单尝试补位
    first_by_user: Dict[int, Any] = {}
    for r in queued:
        first_by_user.setdefault(r[1], r)

    for uid, r in first_by_user.items():
        active = db.query(AIImageTask.id).filter(
            AIImageTask.user_id == uid,
            AIImageTask.status.in_(["排队中", "生成中"]),
            AIImageTask.deleted_at.is_(None),
        ).first()
        if active:
            continue  # 该用户仍有生图任务在跑，继续排队

        demand_type = (r[2] or "").strip()
        gen_params = IMAGE_GEN_PARAMS.get(demand_type)
        if not gen_params:
            db.execute(text("""
                UPDATE media_requests SET gen_status = '失败', gen_time = NOW(), updated_at = NOW()
                WHERE id = :id AND tenant_id = :tid
            """), {"id": r[0], "tid": tenant_id})
            _add_log(db, tenant_id, r[0], None, "生成失败", f"需求类型 {demand_type} 不支持自动生图，请人工处理")
            continue

        uname = db.execute(text("SELECT username FROM users WHERE id = :uid"), {"uid": uid}).scalar() or ""
        try:
            images = _download_ref_images([u for u in _json(r[5], []) if u], 8, 30)
        except ValueError as e:
            db.execute(text("""
                UPDATE media_requests SET gen_status = '失败', gen_time = NOW(), updated_at = NOW()
                WHERE id = :id AND tenant_id = :tid
            """), {"id": r[0], "tid": tenant_id})
            _add_log(db, tenant_id, r[0], None, "生成失败", f"排队自动提交失败：{str(e)[:200]}")
            continue

        try:
            task = submit_image_task(
                tenant_id=tenant_id, user_id=uid, creator_name=uname,
                title=f"{r[6] or ''} {demand_type}".strip()[:200] or "商品套图",
                product_info=(r[3] or "").strip()[:5000],
                prompt=(r[4] or "").strip()[:2000],
                images=images,
                product_code=r[6] or "", product_name=r[7] or "",
                provider="local", **gen_params,
                **_image_generate_options(demand_type, _json(r[8], {})),
            )
        except AIImageBusyError:
            continue  # 极端并发下被抢，下轮再试
        except AIImageError as e:
            db.execute(text("""
                UPDATE media_requests SET gen_status = '失败', gen_time = NOW(), updated_at = NOW()
                WHERE id = :id AND tenant_id = :tid
            """), {"id": r[0], "tid": tenant_id})
            _add_log(db, tenant_id, r[0], None, "生成失败", f"排队自动提交失败：{str(e)[:200]}")
            continue

        db.execute(text("""
            UPDATE media_requests
            SET gen_status = '生成中', gen_task_id = :task_id, gen_time = NOW(), updated_at = NOW()
            WHERE id = :id AND tenant_id = :tid
        """), {"task_id": task.get("id"), "id": r[0], "tid": tenant_id})
        _add_log(db, tenant_id, r[0], None, "自动提交生图",
                 f"排队流转：{demand_type}（AI生图任务 #{task.get('id')}）")
    db.commit()


def _sync_generation(db: Session, tenant_id: int) -> None:
    """把「生成中 / 排队中」单据与生成任务状态对齐；完成后自动流入「已生成」。

    gen_kind='video' 对齐 AI 视频任务（AIVideoTask），
    gen_kind='image' 对齐 AI 生图任务（AIImageTask）；
    排队中的生图单在前一张完成后自动逐张提交（_promote_queued_image_rows）。
    """
    _promote_queued_image_rows(db, tenant_id)

    # 同时回看「失败」单据：AI生图页重试/任务恢复后同一 task 可能已完成，
    # 若只盯「生成中」，媒体单据会一直停在失败状态。
    rows = db.execute(text("""
        SELECT id, gen_task_id, gen_kind, gen_status FROM media_requests
        WHERE tenant_id = :tid AND gen_status IN ('生成中', '失败')
          AND gen_task_id IS NOT NULL AND deleted_at IS NULL
    """), {"tid": tenant_id}).fetchall()
    if not rows:
        return

    from models.ai_video_task import AIVideoTask
    from models.ai_image_task import AIImageTask

    video_ids = [r[1] for r in rows if (r[2] or "video") == "video"]
    image_ids = [r[1] for r in rows if r[2] == "image"]
    video_tasks = {
        t.id: t for t in db.query(AIVideoTask).filter(AIVideoTask.id.in_(video_ids)).all()
    } if video_ids else {}
    image_tasks = {
        t.id: t for t in db.query(AIImageTask).filter(AIImageTask.id.in_(image_ids)).all()
    } if image_ids else {}

    def _first_image_url(task) -> Optional[str]:
        """从生图任务 result_images（[{type,url,status}]）取第一张已完成的图。"""
        for item in (_json(task.result_images, []) or []):
            if isinstance(item, dict) and item.get("status") == "已完成" and item.get("url"):
                return item["url"]
        return None

    changed = False
    for r in rows:
        kind = r[2] or "video"
        if kind == "image":
            task = image_tasks.get(r[1])
            if not task:
                continue
            url = _first_image_url(task)
            if task.status in ("已完成", "部分完成") and url:
                db.execute(text("""
                    UPDATE media_requests
                    SET stage = '已生成', gen_status = NULL, media_url = :url,
                        gen_time = COALESCE(:t, NOW()), updated_at = NOW()
                    WHERE id = :id AND tenant_id = :tid
                """), {"url": url, "t": task.finished_at, "id": r[0], "tid": tenant_id})
                _add_log(db, tenant_id, r[0], None, "生成成功", "AI 生图完成，自动流转「已生成」")
                changed = True
            elif task.status in ("失败", "已取消"):
                # 已经是失败状态的不重复写日志，避免每次列表刷新都刷一条失败记录
                if (r[3] or "") != "失败":
                    db.execute(text("""
                        UPDATE media_requests
                        SET gen_status = '失败', gen_time = NOW(), updated_at = NOW()
                        WHERE id = :id AND tenant_id = :tid
                    """), {"id": r[0], "tid": tenant_id})
                    _add_log(db, tenant_id, r[0], None, "生成失败",
                             (task.error_message or "AI 生图失败，可修改提示词后重新生图")[:1000])
                    changed = True
            continue

        task = video_tasks.get(r[1])
        if not task:
            continue
        if task.status == "已完成" and task.video_url:
            db.execute(text("""
                UPDATE media_requests
                SET stage = '已生成', gen_status = NULL, media_url = :url,
                    gen_time = COALESCE(:t, NOW()), updated_at = NOW()
                WHERE id = :id AND tenant_id = :tid
            """), {"url": task.video_url, "t": task.finished_at, "id": r[0], "tid": tenant_id})
            _add_log(db, tenant_id, r[0], None, "生成成功", "AI 视频生成完成，自动流转「已生成」")
            changed = True
        elif task.status == "失败":
            if (r[3] or "") != "失败":
                db.execute(text("""
                    UPDATE media_requests
                    SET gen_status = '失败', gen_time = NOW(), updated_at = NOW()
                    WHERE id = :id AND tenant_id = :tid
                """), {"id": r[0], "tid": tenant_id})
                _add_log(db, tenant_id, r[0], None, "生成失败",
                         (task.error_message or "AI 视频生成失败，可修改提示词后重新生成")[:1000])
                changed = True
    if changed:
        db.commit()


def _sync_upscale(db: Session, tenant_id: int) -> None:
    """把「高清中」单据与超分任务状态对齐；完成后自动流入「待绑定」。

    高清是绑定前的强制门禁：成片必须先完成高清（或明确失败可重试），
    才允许进入绑定环节。
    """
    rows = db.execute(text("""
        SELECT id, hd_task_id FROM media_requests
        WHERE tenant_id = :tid AND hd_status = '高清中'
          AND hd_task_id IS NOT NULL AND deleted_at IS NULL
    """), {"tid": tenant_id}).fetchall()
    if not rows:
        return

    from models.video_upscale_task import VideoUpscaleTask

    task_ids = [r[1] for r in rows]
    tasks = {
        t.id: t for t in db.query(VideoUpscaleTask).filter(VideoUpscaleTask.id.in_(task_ids)).all()
    }
    changed = False
    for r in rows:
        task = tasks.get(r[1])
        if not task:
            continue
        if task.status == "已完成" and task.video_url:
            db.execute(text("""
                UPDATE media_requests
                SET stage = '待绑定', hd_status = NULL, hd_url = :url,
                    hd_time = COALESCE(:t, NOW()), updated_at = NOW()
                WHERE id = :id AND tenant_id = :tid
            """), {"url": task.video_url, "t": task.finished_at, "id": r[0], "tid": tenant_id})
            _add_log(db, tenant_id, r[0], None, "高清完成", "超分处理完成，自动流转「待绑定」")
            changed = True
        elif task.status == "失败":
            db.execute(text("""
                UPDATE media_requests
                SET hd_status = '失败', hd_time = NOW(), updated_at = NOW()
                WHERE id = :id AND tenant_id = :tid
            """), {"id": r[0], "tid": tenant_id})
            _add_log(db, tenant_id, r[0], None, "高清失败",
                     (task.error_message or "超分处理失败，可重新提交高清")[:1000])
            changed = True
    if changed:
        db.commit()


def _stage_counts(db: Session, tenant_id: int) -> Dict[str, int]:
    rows = db.execute(text("""
        SELECT stage, COUNT(*) FROM media_requests
        WHERE tenant_id = :tid AND deleted_at IS NULL
        GROUP BY stage
    """), {"tid": tenant_id}).fetchall()
    counts = {s: 0 for s in STAGES}
    for stage, n in rows:
        if stage in counts:
            counts[stage] = int(n)
    return counts


# ==================== 请求体 ====================

class PlatformItemIn(BaseModel):
    pp_id: int
    store_id: int


class MediaRequestCreate(BaseModel):
    product_id: int
    demand_types: List[str] = []
    description: str = ""
    prompt: str = ""
    ref_images: List[str] = []
    platform_items: List[PlatformItemIn]
    # 已有素材提报（待绑定/待上传页签）：运营直接上传成片，跳过生成/审核/高清，落在「待绑定」
    media_url: Optional[str] = None
    media_kind: Optional[str] = None  # video / image
    media_style: Optional[str] = None  # 图片用途：主图 / 附图 / A+（写图片表「类型」字段）


class MediaRequestUpdate(BaseModel):
    description: Optional[str] = None
    demand_types: Optional[List[str]] = None
    prompt: Optional[str] = None
    ref_images: Optional[List[str]] = None
    ratio: Optional[str] = None
    resolution: Optional[str] = None
    duration: Optional[int] = None
    # 图片类需求生图参数（A+ 版式 / 张数 / 无文字模式），仅「待生成」阶段可改
    gen_options: Optional[Dict[str, Any]] = None


class ReviewBody(BaseModel):
    passed: bool
    reason: Optional[str] = None


# ==================== 提报弹窗：跨产品 SKU 列表（按产品分组，可展开） ====================

@router.get("/product-skus")
async def list_product_skus(
    keyword: str = "",
    platform: str = "",
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    """提报弹窗数据源：按产品分组返回其平台 SKU×店铺条目（含可上传性标记，不回传紫鸟/凭证明文）。"""
    from routers.video_bindings import _parse_store_ids

    plat_filter = ""
    params: Dict[str, Any] = {"tid": current_user.tenant_id}
    plat = (platform or "").strip().lower()
    if plat in ("amazon", "ozon"):
        plat_filter = " AND pp.platform = :plat"
        params["plat"] = plat
    kw = (keyword or "").strip()
    kw_filter = ""
    if kw:
        kw_filter = (" AND (p.product_code LIKE :kw OR p.name LIKE :kw"
                     " OR EXISTS (SELECT 1 FROM platform_products pp2 WHERE pp2.product_id = p.id"
                     " AND pp2.deleted_at IS NULL AND pp2.sku LIKE :kw))")
        params["kw"] = f"%{kw}%"

    base_join = """
        FROM products p
        WHERE p.tenant_id = :tid AND p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM platform_products pp
            WHERE pp.product_id = p.id AND pp.deleted_at IS NULL
              AND LOWER(pp.platform) IN ('amazon', 'ozon'){plat}
          ){kw}
    """
    base_join = base_join.format(plat=plat_filter, kw=kw_filter)

    page = max(1, page)
    page_size = max(1, min(page_size, 50))
    total = db.execute(text(f"SELECT COUNT(DISTINCT p.id) {base_join}"), params).scalar() or 0

    products = db.execute(text(f"""
        SELECT p.id, p.product_code, p.name, p.main_image, p.images {base_join}
        ORDER BY p.id DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()
    if not products:
        return {"success": True, "data": {"items": [], "total": int(total)}}

    product_ids = [r[0] for r in products]
    ph = ",".join([f":pid{i}" for i in range(len(product_ids))])
    pparams = {f"pid{i}": pid for i, pid in enumerate(product_ids)}
    pparams["tid"] = current_user.tenant_id
    pp_rows = db.execute(text(f"""
        SELECT pp.id, pp.sku, pp.platform, pp.asin, pp.store_id, pp.product_id
        FROM platform_products pp
        WHERE pp.product_id IN ({ph}) AND pp.tenant_id = :tid AND pp.deleted_at IS NULL
          AND LOWER(pp.platform) IN ('amazon', 'ozon')
        ORDER BY pp.product_id, pp.id
    """), pparams).fetchall()

    all_store_ids = sorted({sid for r in pp_rows for sid in _parse_store_ids(r[4])})
    store_map: Dict[int, dict] = {}
    if all_store_ids:
        placeholders = ",".join([f":sid{i}" for i in range(len(all_store_ids))])
        sparams = {f"sid{i}": sid for i, sid in enumerate(all_store_ids)}
        sparams["tid"] = current_user.tenant_id
        srows = db.execute(text(f"""
            SELECT id, name, site, ziniao_account, ozon_client_id, ozon_api_key FROM stores
            WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL
        """), sparams).fetchall()
        store_map = {r[0]: {"name": r[1] or "", "site": r[2] or "",
                            "ocid": r[4] or "", "okey": r[5] or ""} for r in srows}

    entries_by_product: Dict[int, List[Dict[str, Any]]] = {}
    for r in pp_rows:
        platform = (r[2] or "").lower()
        for sid in _parse_store_ids(r[4]):
            store = store_map.get(sid, {})
            if platform == "ozon":
                usable = bool(r[1]) and bool(store.get("ocid") and store.get("okey"))
                reason = None if usable else ("未填货号(offer_id)" if not r[1] else "店铺未配置 Ozon 凭证")
            else:
                usable = bool((r[3] or "").strip())
                reason = None if usable else "未绑定 ASIN"
            entries_by_product.setdefault(int(r[5]), []).append({
                "pp_id": int(r[0]),
                "store_id": int(sid),
                "product_id": int(r[5]),
                "platform": platform,
                "sku": r[1] or "",
                "asin": (r[3] or "").strip(),
                "store_name": store.get("name") or f"店铺#{sid}",
                "site": store.get("site") or "",
                "usable": usable,
                "unusable_reason": reason,
            })

    items: List[Dict[str, Any]] = []
    for r in products:
        main_image = r[3]
        if not main_image:
            imgs = _json(r[4], [])
            main_image = imgs[0] if imgs else None
        pid = int(r[0])
        items.append({
            "product_id": pid,
            "product_code": r[1] or "",
            "product_name": r[2] or "",
            "product_image": main_image,
            "entries": entries_by_product.get(pid, []),
        })
    return {"success": True, "data": {"items": items, "total": int(total)}}


@router.get("/aplus-layouts")
async def list_aplus_layouts(
    current_user: User = Depends(READ_PERM),
):
    """待生成页 A+ 参数：版式库（官方推荐 / 我的上传 / 收藏）。"""
    from services.ai_image_layout_service import LayoutError, list_layouts

    try:
        return {
            "success": True,
            "data": list_layouts(current_user.id, current_user.tenant_id or 0),
        }
    except LayoutError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("读取 A+ 版式库失败")
        raise HTTPException(status_code=500, detail="读取 A+ 版式库失败")


# ==================== 列表 / 详情 ====================

@router.get("")
async def list_media_requests(
    stage: str = "待提交",
    op: str = "",
    platform: str = "",
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    """按阶段查询流转单据（生成/高清中的单据会先与后台任务对齐状态）。"""
    _sync_generation(db, current_user.tenant_id)
    _sync_upscale(db, current_user.tenant_id)

    if stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"不支持的阶段: {stage}")

    where = ["tenant_id = :tid", "stage = :stage", "deleted_at IS NULL"]
    params: Dict[str, Any] = {"tid": current_user.tenant_id, "stage": stage}
    if op.strip():
        where.append("submitter_name LIKE :op")
        params["op"] = f"%{op.strip()}%"
    if platform.strip():
        where.append("platform = :platform")
        params["platform"] = platform.strip().lower()
    if keyword.strip():
        where.append("(product_code LIKE :kw OR product_name LIKE :kw OR seq LIKE :kw OR platform_items LIKE :kw)")
        params["kw"] = f"%{keyword.strip()}%"
    where_sql = " AND ".join(where)

    total = db.execute(text(f"SELECT COUNT(*) FROM media_requests WHERE {where_sql}"), params).scalar() or 0
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    rows = db.execute(text(f"""
        SELECT * FROM media_requests WHERE {where_sql}
        ORDER BY updated_at DESC, id DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()

    return {
        "success": True,
        "data": {
            "items": [_serialize(r) for r in rows],
            "total": int(total),
            "counts": _stage_counts(db, current_user.tenant_id),
        },
    }


@router.get("/counts")
async def get_media_request_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    _sync_generation(db, current_user.tenant_id)
    _sync_upscale(db, current_user.tenant_id)
    return {"success": True, "data": _stage_counts(db, current_user.tenant_id)}


@router.get("/{request_id}")
async def get_media_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    _sync_generation(db, current_user.tenant_id)
    _sync_upscale(db, current_user.tenant_id)
    row = _load_row(db, current_user.tenant_id, request_id)
    logs = db.execute(text("""
        SELECT id, actor_name, action, note, created_at FROM media_request_logs
        WHERE request_id = :rid AND tenant_id = :tid
        ORDER BY id ASC
    """), {"rid": request_id, "tid": current_user.tenant_id}).fetchall()
    item = _serialize(row)
    item["logs"] = [
        {"id": l[0], "actor_name": l[1], "action": l[2], "note": l[3], "created_at": _fmt(l[4])}
        for l in logs
    ]
    return {"success": True, "data": item}


# ==================== 运营提报 ====================

@router.post("")
async def create_media_request(
    body: MediaRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    """运营提报：选产品 + 目标平台 SKU；需求类型/描述可在添加后逐条填写（提交前必填）。"""
    demand_types = [t for t in dict.fromkeys(body.demand_types or []) if t in DEMAND_TYPES]

    ref_images = [u.strip() for u in (body.ref_images or []) if u and u.strip()]
    if len(ref_images) > 9:
        raise HTTPException(status_code=400, detail="参考图最多 9 张")

    if not body.platform_items:
        raise HTTPException(status_code=400, detail="请选择要上传的平台 SKU")

    product, entries = _load_platform_sku_entries(
        db, current_user.tenant_id, body.product_id, ["amazon", "ozon"],
        id_filter=[{"pp_id": it.pp_id, "store_id": it.store_id} for it in body.platform_items],
    )
    if not entries:
        raise HTTPException(status_code=400, detail="所选平台 SKU 不存在或已删除")

    product_row = db.execute(text("""
        SELECT main_image, images FROM products
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"pid": body.product_id, "tid": current_user.tenant_id}).fetchone()
    images = _parse_json_images(product_row[1] if product_row else None)
    product_image = (product_row[0] if product_row else None) or (images[0] if images else None)

    next_no = db.execute(text("""
        SELECT COALESCE(MAX(no), 0) + 1 FROM media_requests WHERE tenant_id = :tid
    """), {"tid": current_user.tenant_id}).scalar() or 1

    # 只保留上传需要的展示字段，不回传紫鸟/凭证等敏感信息
    safe_items = [{
        "pp_id": e["pp_id"], "store_id": e["store_id"], "platform": e["platform"],
        "sku": e.get("sku") or "", "store_name": e.get("store_name") or "",
        "site": e.get("site") or "", "asin": e.get("asin") or "",
        "offer_id": e.get("sku") or "", "has_asin": bool(e.get("has_asin")),
        "has_credentials": bool(e.get("has_credentials")),
    } for e in entries]

    # 已有素材提报：跳过生成/审核/高清，直接落「待绑定」；
    # 视频同时把 hd_url 置为素材地址（视为已是成片，通过高清门禁），图片绑定走 media_url
    external = bool((body.media_url or "").strip())
    media_url_val: Optional[str] = None
    media_kind = (body.media_kind or "video").lower()
    media_style_val: Optional[str] = None
    if external:
        media_url_val = body.media_url.strip()
        if media_kind not in ("video", "image"):
            raise HTTPException(status_code=400, detail="素材类型只支持 video / image")
        if not media_url_val.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="素材地址无效")
        if media_kind == "image":
            media_style_val = (body.media_style or "附图").strip()
            if media_style_val not in IMAGE_STYLES:
                raise HTTPException(status_code=400, detail="图片类型只支持：主图 / 附图 / A+")

    result = db.execute(text("""
        INSERT INTO media_requests
            (tenant_id, no, seq, product_id, product_code, product_name, product_image,
             platform, platform_items, demand_types, description, prompt, ref_images,
             ratio, resolution, duration, video_type, stage,
             media_url, media_type, media_style, hd_url,
             submitter_id, submitter_name, created_at, updated_at)
        VALUES
            (:tid, :no, :seq, :pid, :pcode, :pname, :pimg,
             :platform, :items, :types, :desc, :prompt, :refs,
             :ratio, :resolution, :duration, :vtype, :stage,
             :media_url, :media_type, :media_style, :hd_url,
             :uid, :uname, NOW(), NOW())
    """), {
        "tid": current_user.tenant_id,
        "no": int(next_no),
        "seq": str(next_no),
        "pid": body.product_id,
        "pcode": product[1] or "",
        "pname": product[2] or "",
        "pimg": product_image,
        "platform": (safe_items[0]["platform"] or "").lower(),
        "items": _dumps(safe_items),
        "types": _dumps(demand_types),
        "desc": (body.description or "").strip(),
        "prompt": (body.prompt or "").strip(),
        "refs": _dumps(ref_images),
        # 已有素材不写视频参数（那是 AI 生成链的参数，对现成素材无意义）
        "ratio": None if external else "9:16",
        "resolution": None if external else "0.3",
        "duration": None if external else 15,
        "vtype": VIDEO_TYPE_MAP.get(demand_types[0], "") if demand_types else "",
        "stage": "待绑定" if external else "待提交",
        "media_url": media_url_val,
        "media_type": media_kind if external else None,
        "media_style": media_style_val,
        "hd_url": media_url_val if (external and media_kind == "video") else None,
        "uid": current_user.id,
        "uname": current_user.username,
    })
    request_id = result.lastrowid
    if external:
        kind_label = "图片" if media_kind == "image" else "视频"
        style_label = f"（{media_style_val}）" if media_style_val else ""
        _add_log(db, current_user.tenant_id, request_id, current_user, "创建提报（已有素材）",
                 f"运营上传已有{kind_label}{style_label}，跳过生成/审核/高清直接进入绑定；目标 SKU {len(safe_items)} 个")
    else:
        _add_log(db, current_user.tenant_id, request_id, current_user, "创建提报",
                 f"需求类型：{'、'.join(demand_types)}；目标 SKU {len(safe_items)} 个")
    db.commit()

    row = _load_row(db, current_user.tenant_id, request_id)
    return {"success": True,
            "message": "已创建素材提报，直接进入「待绑定」" if external else "提报已创建",
            "data": _serialize(row)}


@router.patch("/{request_id}")
async def update_media_request(
    request_id: int,
    body: MediaRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    """待提交页可改需求描述/类型；待生成页可改提示词/参考图/视频参数。"""
    row = _load_row(db, current_user.tenant_id, request_id)
    stage = row.stage
    fields: Dict[str, Any] = {}

    if stage == "待提交":
        if body.description is not None:
            fields["description"] = body.description.strip()
        if body.demand_types is not None:
            # 行内多选允许先清空再勾选；提交时才校验至少 1 个
            types = [t for t in dict.fromkeys(body.demand_types) if t in DEMAND_TYPES]
            fields["demand_types"] = _dumps(types)
            fields["video_type"] = VIDEO_TYPE_MAP.get(types[0], "") if types else ""
    elif stage == "待生成":
        if body.prompt is not None:
            fields["prompt"] = body.prompt.strip()
        if body.ref_images is not None:
            refs = [u.strip() for u in body.ref_images if u and u.strip()]
            if len(refs) > 9:
                raise HTTPException(status_code=400, detail="参考图最多 9 张")
            fields["ref_images"] = _dumps(refs)
        if body.ratio is not None:
            if body.ratio not in RATIOS:
                raise HTTPException(status_code=400, detail="不支持的比例")
            fields["ratio"] = body.ratio
        if body.resolution is not None:
            if body.resolution not in RESOLUTIONS:
                raise HTTPException(status_code=400, detail="不支持的分辨率档位")
            fields["resolution"] = body.resolution
        if body.duration is not None:
            if body.duration not in DURATIONS:
                raise HTTPException(status_code=400, detail="视频时长仅支持 5 / 10 / 15 秒")
            fields["duration"] = body.duration
        if body.gen_options is not None:
            if (row.demand_type or "") not in IMAGE_TYPES:
                raise HTTPException(status_code=400, detail="只有图片类需求可以设置生图参数")
            current = _json(row.gen_options, {})
            incoming = body.gen_options
            if "aplus_layout_ids" in incoming:
                raw_ids = incoming.get("aplus_layout_ids") or []
                if not isinstance(raw_ids, list):
                    raise HTTPException(status_code=400, detail="A+ 版式参数格式不正确")
                current["aplus_layout_ids"] = [
                    str(x).strip() for x in raw_ids if str(x).strip()
                ][:8]
            if "aplus_image_count" in incoming:
                try:
                    count = int(incoming.get("aplus_image_count") or 1)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail="A+ 生成张数格式不正确")
                current["aplus_image_count"] = max(1, min(4, count))
            if "aplus_text_mode" in incoming:
                mode = str(incoming.get("aplus_text_mode") or "").strip()
                if mode not in ("no_text", "with_text"):
                    raise HTTPException(status_code=400, detail="A+ 文字模式仅支持 no_text / with_text")
                current["aplus_text_mode"] = mode
            fields["gen_options"] = _dumps(current)
    else:
        raise HTTPException(status_code=400, detail="当前阶段不可编辑")

    if not fields:
        return {"success": True, "data": _serialize(row)}

    sets = ", ".join(f"{k} = :{k}" for k in fields)
    db.execute(text(f"""
        UPDATE media_requests SET {sets}, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {**fields, "id": request_id, "tid": current_user.tenant_id})
    db.commit()
    return {"success": True, "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


@router.post("/{request_id}/submit")
async def submit_media_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待提交":
        raise HTTPException(status_code=400, detail="只有「待提交」的单据可以提交审核")
    types = _json(row.demand_types, [])
    if not (row.description or "").strip():
        raise HTTPException(status_code=400, detail="请先填写需求描述")
    if not types:
        raise HTTPException(status_code=400, detail="请先选择需求类型")

    db.execute(text("""
        UPDATE media_requests
        SET stage = '待审核', submit_time = NOW(), submitter_id = :uid,
            submitter_name = :uname, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"uid": current_user.id, "uname": current_user.username,
           "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "提交审核",
             "需求描述与需求类型已填写，提交运营主管审核")
    db.commit()
    return {"success": True, "message": "已提交至「待审核」",
            "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


@router.delete("/{request_id}")
async def delete_media_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(READ_PERM),
):
    """删除单据（软删，不可恢复）。任何阶段均可删除，拆单子单亦可。"""
    row = _load_row(db, current_user.tenant_id, request_id)

    db.execute(text("""
        UPDATE media_requests SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "删除单据",
             f"{current_user.username} 删除了「{row.stage}」阶段的单据")
    db.commit()
    return {"success": True, "message": "已删除"}


# ==================== 运营主管审核（通过时按需求类型拆单） ====================

@router.post("/{request_id}/review")
async def review_media_request(
    request_id: int,
    body: ReviewBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(REVIEW_PERM),
):
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待审核":
        raise HTTPException(status_code=400, detail="只有「待审核」的单据可以审核")

    if not body.passed:
        db.execute(text("""
            UPDATE media_requests
            SET stage = '待提交', reviewer_id = :uid, reviewer_name = :uname,
                reviewer_at = NOW(), updated_at = NOW()
            WHERE id = :id AND tenant_id = :tid
        """), {"uid": current_user.id, "uname": current_user.username,
               "id": request_id, "tid": current_user.tenant_id})
        _add_log(db, current_user.tenant_id, request_id, current_user, "审核驳回",
                 (body.reason or "需求不完整，退回修改")[:1000])
        db.commit()
        return {"success": True, "message": "已驳回，退回「待提交」"}

    types = [t for t in (_json(row.demand_types, []) or []) if t in DEMAND_TYPES]
    if not types:
        raise HTTPException(status_code=400, detail="单据缺少需求类型，无法审核通过")

    db.execute(text("""
        UPDATE media_requests
        SET reviewer_id = :uid, reviewer_name = :uname, reviewer_at = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"uid": current_user.id, "uname": current_user.username,
           "id": request_id, "tid": current_user.tenant_id})

    created = 0
    if len(types) > 1:
        # 按需求类型拆成 N 条子单：父子同 no，子单 seq = 主单号-序号
        for idx, demand_type in enumerate(types):
            defaults = _defaults_for(demand_type)
            child = db.execute(text("""
                INSERT INTO media_requests
                    (tenant_id, no, seq, parent_id, product_id, product_code, product_name, product_image,
                     platform, platform_items, demand_types, demand_type, description, prompt, ref_images,
                     ratio, resolution, duration, video_type, stage,
                     submitter_id, submitter_name, submit_time)
                SELECT tenant_id, no, :seq, :parent_id, product_id, product_code, product_name, product_image,
                       platform, platform_items, demand_types, :demand_type, description, prompt, ref_images,
                       :ratio, :resolution, :duration, :video_type, '待生成',
                       submitter_id, submitter_name, submit_time
                FROM media_requests WHERE id = :src AND tenant_id = :tid
            """), {
                "seq": f"{row.no}-{idx + 1}", "parent_id": row.parent_id or row.id,
                "demand_type": demand_type, **defaults, "src": request_id, "tid": current_user.tenant_id,
            })
            _add_log(db, current_user.tenant_id, child.lastrowid, current_user, "审核通过",
                     f"按需求类型拆分为子单 {row.no}-{idx + 1}（{demand_type}）")
            created += 1
        db.execute(text("""
            UPDATE media_requests SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = :id AND tenant_id = :tid
        """), {"id": request_id, "tid": current_user.tenant_id})
        db.commit()
        return {"success": True,
                "message": f"审核通过，已按需求类型拆成 {created} 条待生成子单（单据关联号 {row.no}-1 …）"}

    demand_type = types[0]
    defaults = _defaults_for(demand_type)
    db.execute(text("""
        UPDATE media_requests
        SET stage = '待生成', demand_type = :demand_type, demand_types = :types,
            ratio = :ratio, resolution = :resolution, duration = :duration,
            video_type = :video_type, gen_status = NULL, gen_task_id = NULL,
            media_url = NULL, gen_time = NULL, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"demand_type": demand_type, "types": _dumps([demand_type]), **defaults,
           "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "审核通过",
             f"需求明确，转美工生成视频（需求类型：{demand_type}）")
    db.commit()
    return {"success": True, "message": "审核通过，已流转至「待生成」"}


# ==================== 美工生成 ====================

@router.post("/{request_id}/generate")
async def generate_media_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待生成":
        raise HTTPException(status_code=400, detail="只有「待生成」的单据可以触发生成")
    if (row.demand_type or "") in IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="图片类需求不走 AI 视频，请在 AI生图 完成后于本页直接上传成片")
    if row.gen_status == "生成中":
        raise HTTPException(status_code=400, detail="该单据正在生成中，请等待完成")

    prompt = (row.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="请先填写/微调视频提示词")
    refs = [u for u in _json(row.ref_images, []) if u]
    if not refs:
        raise HTTPException(status_code=400, detail="请先上传参考图（1~9 张）")
    if len(refs) > 9:
        raise HTTPException(status_code=400, detail="参考图最多 9 张")

    duration = int(row.duration or 15)
    if duration not in DURATIONS:
        raise HTTPException(status_code=400, detail="视频时长仅支持 5 / 10 / 15 秒")
    ratio = row.ratio if row.ratio in RATIOS else "9:16"
    resolution = row.resolution if row.resolution in RESOLUTIONS else "0.3"

    items = _json(row.platform_items, [])
    market = SITE_MARKET.get((items[0].get("site") if items else "") or "", "US")

    try:
        images = await run_in_threadpool(_download_ref_images, refs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from services.h3_video_service import submit_video_task, H3VideoError

    try:
        task = await run_in_threadpool(
            submit_video_task,
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            creator_name=current_user.username,
            title=f"{row.product_code or ''} {row.demand_type or ''}".strip()[:200] or "视频生成任务",
            prompt=prompt,
            images=images,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            model="minimax-h3",
            market=market,
            voiceover_language="自动",
            video_type=row.video_type or "口播带货",
            product_code=row.product_code or "",
            product_name=row.product_name or "",
        )
    except H3VideoError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("媒体单据 %s 提交 AI 视频生成失败", request_id)
        raise HTTPException(status_code=500, detail=f"提交生成失败：{str(e)[:200]}")

    db.execute(text("""
        UPDATE media_requests
        SET gen_status = '生成中', gen_task_id = :task_id, gen_time = NOW(),
            media_url = NULL, upload_status = NULL, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"task_id": task.get("id"), "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "提交生成",
             f"视频 · {duration}s · {ratio} · 分辨率档 {resolution}（AI 任务 #{task.get('id')}）")
    db.commit()
    return {"success": True, "message": "已提交 AI 生成，完成后自动进入「已生成」",
            "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


# 图片需求类型 → AI 生图参数（main_types=主副图类型 / aplus_type=A+ 类型）
IMAGE_GEN_PARAMS: Dict[str, Dict[str, Any]] = {
    "白底图": {"main_types": ["white_background"]},
    "场景图（不带人物）": {"main_types": ["scene"]},
    "场景图（带人物）": {"main_types": ["scene_person"]},
    "特写图": {"main_types": ["closeup"]},
    "特写白底图": {"main_types": ["closeup_white"]},
    "卖点图": {"main_types": ["selling_point"]},
    "高级A+图": {"aplus_type": "aplus_advanced"},
    "普通A+图": {"aplus_type": "aplus_normal"},
    "手机A+图": {"aplus_type": "aplus_mobile"},
}


def _image_generate_options(demand_type: str, gen_options: Dict[str, Any]) -> Dict[str, Any]:
    """解析图片生图参数：A+ 版式 / 张数 / 无文字模式；非 A+ 保持默认 1 张。"""
    if not (IMAGE_GEN_PARAMS.get(demand_type) or {}).get("aplus_type"):
        return {"image_count": 1, "layout_keys": [], "brand_settings": None}
    layout_keys = [
        str(x).strip() for x in (gen_options.get("aplus_layout_ids") or []) if str(x).strip()
    ][:8]
    try:
        count = int(gen_options.get("aplus_image_count") or 1)
    except (TypeError, ValueError):
        count = 1
    # 选了版式时张数由版式数量决定（与 AI生图页一致）
    image_count = len(layout_keys) or max(1, min(4, count))
    text_mode = str(gen_options.get("aplus_text_mode") or "no_text").strip()
    brand_settings = {"text_mode": text_mode if text_mode in ("no_text", "with_text") else "no_text"}
    return {"image_count": image_count, "layout_keys": layout_keys, "brand_settings": brand_settings}


@router.post("/{request_id}/generate-image")
async def generate_media_image(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    """图片类需求：待生成页直接调用 AI 生图（复用 AI生图 服务，Qwen Image 2.1）。

    参考图 + 需求描述（作商品信息）+ 行内提示词（作附加提示词），
    按需求类型映射生图类型，1:1 比例生成 1 张；
    提交后单据进入「生成中」，完成后由 _sync_generation 自动流转「已生成」。
    """
    row = _load_row(db, current_user.tenant_id, request_id)
    demand_type = (row.demand_type or "").strip()
    if row.stage != "待生成":
        raise HTTPException(status_code=400, detail="只有「待生成」的单据可以生图")
    if demand_type not in IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="仅图片类需求支持在任务中心直接生图")
    if row.gen_status == "生成中":
        raise HTTPException(status_code=400, detail="该单据正在生图中，请等待完成")
    gen_params = IMAGE_GEN_PARAMS.get(demand_type)
    if not gen_params:
        raise HTTPException(status_code=400, detail=f"需求类型 {demand_type} 暂不支持生图")

    # A+ 生图参数：版式（每种版式一张）、张数、无文字模式；主副图沿用默认 1 张
    gen_options = _json(row.gen_options, {})
    is_aplus = bool(gen_params.get("aplus_type"))
    gen_kwargs = _image_generate_options(demand_type, gen_options)
    image_count = int(gen_kwargs["image_count"])
    layout_keys = gen_kwargs["layout_keys"]
    brand_settings = gen_kwargs["brand_settings"]

    refs = [u for u in _json(row.ref_images, []) if u]
    if not refs:
        raise HTTPException(status_code=400, detail="请先上传/选择参考图（1~8 张），再提交生图")

    try:
        images = await run_in_threadpool(_download_ref_images, refs, 8, 30)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from services.ai_image_service import submit_image_task, AIImageError, AIImageBusyError

    def _queue_row():
        """并发冲突（同一美工已有生图任务在跑）：转入排队，前面完成由 _sync_generation 自动提交。"""
        db.execute(text("""
            UPDATE media_requests
            SET gen_status = '排队中', gen_task_id = NULL, gen_kind = 'image', gen_user_id = :uid,
                gen_time = NOW(), media_url = NULL, updated_at = NOW()
            WHERE id = :id AND tenant_id = :tid
        """), {"uid": current_user.id, "id": request_id, "tid": current_user.tenant_id})
        _add_log(db, current_user.tenant_id, request_id, current_user, "排队等待",
                 f"{demand_type} 已加入生图队列，前面的生图完成后自动提交")

    try:
        try:
            task = await run_in_threadpool(
                submit_image_task,
                tenant_id=current_user.tenant_id,
                user_id=current_user.id,
                creator_name=current_user.username or "",
                title=f"{row.product_code or ''} {demand_type}".strip()[:200] or "商品套图",
                product_info=(row.description or "").strip()[:5000],
                prompt=(row.prompt or "").strip()[:2000],
                images=images,
                product_code=row.product_code or "",
                product_name=row.product_name or "",
                provider="local",
                **gen_params,
                **gen_kwargs,
            )
        except AIImageBusyError:
            _queue_row()
            db.commit()
            return {"success": True, "message": "已有生图任务在进行，本单已加入排队，完成后自动提交",
                    "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}
    except AIImageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("媒体单据 %s 提交 AI 生图失败", request_id)
        raise HTTPException(status_code=500, detail=f"提交生图失败：{str(e)[:200]}")

    db.execute(text("""
        UPDATE media_requests
        SET gen_status = '生成中', gen_task_id = :task_id, gen_kind = 'image', gen_user_id = :uid, gen_time = NOW(),
            media_url = NULL, upload_status = NULL, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"task_id": task.get("id"), "uid": current_user.id, "id": request_id, "tid": current_user.tenant_id})
    log_note = f"{demand_type} · 1:1 · {image_count} 张"
    if is_aplus:
        log_note += f" · 版式 {len(layout_keys)} 个" if layout_keys else " · 随机版式"
        log_note += " · 无文字" if (brand_settings or {}).get("text_mode") != "with_text" else " · 含文字"
    _add_log(db, current_user.tenant_id, request_id, current_user, "提交生图",
             f"{log_note}（AI生图任务 #{task.get('id')}）")
    db.commit()
    return {"success": True, "message": "已提交 AI 生图，完成后自动进入「已生成」",
            "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


@router.post("/{request_id}/generate-plan")
async def generate_media_plan(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    """待生成页「AI 生成方案」：按参考图 + 需求描述只生成 1 套方案，并回填提示词。"""
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待生成":
        raise HTTPException(status_code=400, detail="只有「待生成」的单据可以生成方案")
    if (row.demand_type or "") in IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="图片类需求不需要视频方案，请上传成片")

    refs = [u for u in _json(row.ref_images, []) if u]
    if not refs:
        raise HTTPException(status_code=400, detail="请先选择/上传参考图（1~9 张）")
    if len(refs) > 9:
        raise HTTPException(status_code=400, detail="参考图最多 9 张")

    duration = int(row.duration or 15)
    if duration not in DURATIONS:
        raise HTTPException(status_code=400, detail="视频时长仅支持 5 / 10 / 15 秒")
    ratio = row.ratio if row.ratio in RATIOS else "9:16"

    items = _json(row.platform_items, [])
    site = (items[0].get("site") if items else "") or ""
    market_label = SITE_MARKET_LABEL.get(site, "美国")
    language = SITE_LANGUAGE.get(site, "英语")
    video_type = row.video_type or "口播带货"

    try:
        images = await run_in_threadpool(_download_ref_images, refs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from services.ai_creation_service import (
        generate_single_video_plan_from_bytes,
        AIAnalysisError,
    )

    try:
        result = await generate_single_video_plan_from_bytes(
            images,
            duration=duration,
            target_market=market_label,
            voiceover_language="自动",
            aspect_ratio=ratio,
            product_name=row.product_name or "",
            demand_description=(row.description or "").strip(),
            video_type=video_type,
        )
    except AIAnalysisError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("媒体单据 %s 生成方案失败", request_id)
        raise HTTPException(status_code=500, detail=f"生成方案失败：{str(e)[:200]}")

    concept = result.get("concept") or {}
    plan = {
        "concept_title": concept.get("concept_title") or "视频方案",
        "marketing_goal": concept.get("marketing_goal") or "",
        "story": concept.get("story") or "",
        "character": concept.get("character") or "",
        "environment": concept.get("environment") or "",
        "music": concept.get("music") or "",
        "storyboard": concept.get("storyboard") or [],
        "video_type": video_type,
        "duration": duration,
        "ratio": ratio,
        "language": language,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "product": result.get("product") or {},
    }
    prompt = _format_plan_prompt(plan, video_type)
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="AI 未返回有效分镜，请调整参考图后重试")

    db.execute(text("""
        UPDATE media_requests
        SET prompt = :prompt, plan = :plan, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"prompt": prompt, "plan": _dumps(plan), "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "生成方案",
             f"{plan['concept_title']} · {duration}s · {ratio}")
    db.commit()

    return {
        "success": True,
        "message": "已生成 1 套视频方案，并回填提示词",
        "data": {"prompt": prompt, "plan": plan},
    }


# ==================== 图片类需求：待生成页直接上传成片 ====================

class UploadMediaBody(BaseModel):
    media_url: str


@router.post("/{request_id}/upload-media")
async def upload_media_for_request(
    request_id: int,
    body: UploadMediaBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    """图片类需求：美工在 AI生图 完成后，把成片地址上传到单据，直接进入「已生成」审核。"""
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待生成":
        raise HTTPException(status_code=400, detail="只有「待生成」的单据可以上传成片")
    if (row.demand_type or "") not in IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="仅图片类需求支持直接上传成片")
    media_url = (body.media_url or "").strip()
    if not media_url:
        raise HTTPException(status_code=400, detail="成片地址不能为空")

    db.execute(text("""
        UPDATE media_requests
        SET stage = '已生成', media_url = :url, gen_status = NULL,
            gen_time = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"url": media_url, "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "上传成片",
             "图片需求成片已上传，进入「已生成」审核")
    db.commit()
    return {"success": True, "message": "成片已上传，进入「已生成」审核",
            "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


# ==================== 美工审核成片 / 运营二次审核 ====================

@router.post("/{request_id}/gen-review")
async def review_generated_media(
    request_id: int,
    body: ReviewBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "已生成":
        raise HTTPException(status_code=400, detail="只有「已生成」的单据可以审核成片")

    if body.passed:
        db.execute(text("""
            UPDATE media_requests
            SET stage = '待确认', reviewer_id = :uid, reviewer_name = :uname,
                reviewer_at = NOW(), updated_at = NOW()
            WHERE id = :id AND tenant_id = :tid
        """), {"uid": current_user.id, "uname": current_user.username,
               "id": request_id, "tid": current_user.tenant_id})
        _add_log(db, current_user.tenant_id, request_id, current_user, "成片审核通过",
                 "成片内容符合要求，转运营二次审核")
        db.commit()
        return {"success": True, "message": "成片审核通过，已流转「待确认」"}

    db.execute(text("""
        UPDATE media_requests
        SET stage = '待生成', media_url = NULL, gen_status = NULL, gen_task_id = NULL,
            gen_time = NULL, upload_status = NULL, upload_result = NULL,
            reviewer_id = :uid, reviewer_name = :uname, reviewer_at = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"uid": current_user.id, "uname": current_user.username,
           "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "成片审核不通过",
             (body.reason or "成片不符合要求，退回重新生成")[:1000])
    db.commit()
    return {"success": True, "message": "已退回「待生成」重新生成"}


@router.post("/{request_id}/confirm")
async def confirm_media_request(
    request_id: int,
    body: ReviewBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(REVIEW_PERM),
):
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待确认":
        raise HTTPException(status_code=400, detail="只有「待确认」的单据可以二次审核")

    if body.passed:
        # 图片类需求不需要视频高清（Topaz 超分仅针对视频），确认通过后直接进入「待绑定」
        next_stage = "待绑定" if (row.demand_type or "") in IMAGE_TYPES else "待高清"
        db.execute(text("""
            UPDATE media_requests
            SET stage = :stage, reviewer_id = :uid, reviewer_name = :uname,
                reviewer_at = NOW(), updated_at = NOW()
            WHERE id = :id AND tenant_id = :tid
        """), {"stage": next_stage, "uid": current_user.id, "uname": current_user.username,
               "id": request_id, "tid": current_user.tenant_id})
        if next_stage == "待绑定":
            _add_log(db, current_user.tenant_id, request_id, current_user, "运营确认通过",
                     "二次审核通过；图片需求免高清，直接进入「待绑定」")
            db.commit()
            return {"success": True, "message": "二次审核通过；图片需求免高清，已进入「待绑定」"}
        _add_log(db, current_user.tenant_id, request_id, current_user, "运营确认通过",
                 "二次审核通过，进入「待高清」（高清为绑定前强制环节）")
        db.commit()
        return {"success": True, "message": "二次审核通过，已进入「待高清」"}

    db.execute(text("""
        UPDATE media_requests
        SET stage = '待生成', media_url = NULL, gen_status = NULL, gen_task_id = NULL,
            gen_time = NULL, upload_status = NULL, upload_result = NULL,
            reviewer_id = :uid, reviewer_name = :uname, reviewer_at = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"uid": current_user.id, "uname": current_user.username,
           "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "运营驳回",
             (body.reason or "二次审核未通过，退回重新生成")[:1000])
    db.commit()
    return {"success": True, "message": "已驳回，退回「待生成」重新生成"}


# ==================== 待高清 → 提交超分（强制门禁） ====================

class UpscaleBody(BaseModel):
    scale: float = 2.0


@router.post("/{request_id}/upscale")
async def upscale_media_request(
    request_id: int,
    body: UpscaleBody = UpscaleBody(),
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    """待高清页提交超分任务（Topaz 星光 2.6，档位 1.0~4.0x）：完成后自动流入「待绑定」。"""
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待高清":
        raise HTTPException(status_code=400, detail="只有「待高清」的单据可以提交高清")
    if row.hd_status == "高清中":
        raise HTTPException(status_code=400, detail="该单据正在高清处理中，请等待完成")
    scale = float(body.scale or 2.0)
    if not 1.0 <= scale <= 4.0:
        raise HTTPException(status_code=400, detail="高清倍数仅支持 1.0 ~ 4.0")
    media_url = (row.media_url or "").strip()
    if not media_url:
        raise HTTPException(status_code=400, detail="单据缺少成片地址，无法提交高清")

    from services.upscale_service import submit_upscale_task, UpscaleError

    try:
        task = await run_in_threadpool(
            submit_upscale_task,
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            creator_name=current_user.username,
            title=f"{row.product_code or ''} 高清处理".strip()[:200] or "高清处理任务",
            source_video_url=media_url,
            scale=scale,
        )
    except UpscaleError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("媒体单据 %s 提交高清失败", request_id)
        raise HTTPException(status_code=500, detail=f"提交高清失败：{str(e)[:200]}")

    db.execute(text("""
        UPDATE media_requests
        SET hd_status = '高清中', hd_task_id = :task_id, hd_url = NULL,
            hd_time = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"task_id": task.get("id"), "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "提交高清",
             f"超分任务 #{task.get('id')} · {scale}x")
    db.commit()
    return {"success": True, "message": "已提交高清处理，完成后自动进入「待绑定」",
            "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


# ==================== 待绑定 → 提交绑定（上传前门禁） ====================

@router.post("/{request_id}/bind")
async def bind_media_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(WORK_PERM),
):
    """待绑定页提交「绑定至产品」申请：复用媒体绑定审核通道，审核通过后才能上传。

    视频提交高清成片地址（hd_url），图片类需求免高清直接用原成片（media_url）；
    审核通过后视频写 products.videos、图片写 products.images，
    并由 video_bindings 审核钩子把单据推进「待上传」。
    """
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待绑定":
        raise HTTPException(status_code=400, detail="只有「待绑定」的单据可以提交绑定申请")
    if row.bind_status == "审核中":
        raise HTTPException(status_code=400, detail="绑定申请审核中，请等待审核结果")
    # 图片类：需求类型为图片，或已有素材提报标记 media_type='image'
    is_image = (row.media_type == "image") or ((row.demand_type or "") in IMAGE_TYPES)
    bind_url = (row.media_url or "").strip() if is_image else (row.hd_url or "").strip()
    if not bind_url:
        raise HTTPException(status_code=400,
                            detail="单据缺少成片地址，图片需求请先上传成片，视频需求请先完成高清")
    bind_media_kind = "image" if is_image else "video"

    from routers.video_bindings import submit_video_binding, VideoBindingSubmit

    body = VideoBindingSubmit(
        video_url=bind_url,
        product_id=row.product_id,
        source="upscale",
        media_type=bind_media_kind,
        task_title=f"媒体任务 {row.seq} · {row.product_code or ''}".strip()[:200],
    )
    result = await submit_video_binding(body=body, db=db, current_user=current_user)
    binding_id = None
    try:
        # 申请已落库，按唯一约束回查刚创建的申请 ID（同 url+product+pending）
        r = db.execute(text("""
            SELECT id FROM video_binding_requests
            WHERE tenant_id = :tid AND video_url = :url AND product_id = :pid
              AND media_type = :mtype AND status = 'pending' AND deleted_at IS NULL
            ORDER BY id DESC LIMIT 1
        """), {"tid": current_user.tenant_id, "url": bind_url, "pid": row.product_id,
               "mtype": bind_media_kind}).fetchone()
        binding_id = r[0] if r else None
    except Exception:
        pass

    db.execute(text("""
        UPDATE media_requests
        SET bind_status = '审核中', binding_request_id = :bid, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"bid": binding_id, "id": request_id, "tid": current_user.tenant_id})
    _add_log(db, current_user.tenant_id, request_id, current_user, "提交绑定申请",
             f"绑定申请 #{binding_id} · 高清成片提交产品绑定审核")
    db.commit()
    return {"success": True, "message": "绑定申请已提交，审核通过后进入「待上传」",
            "data": _serialize(_load_row(db, current_user.tenant_id, request_id))}


# ==================== 待上传 → 平台上传 ====================

class UploadConfirmBody(BaseModel):
    # 视频语言与目标站点语言不匹配的警告已确认
    confirm_language_mismatch: bool = False
    # 视频语言无法识别的提醒已确认
    confirm_language_unknown: bool = False


@router.post("/{request_id}/upload")
async def upload_media_request(
    request_id: int,
    body: Optional[UploadConfirmBody] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(UPLOAD_PERM),
):
    row = _load_row(db, current_user.tenant_id, request_id)
    if row.stage != "待上传":
        raise HTTPException(status_code=400, detail="只有「待上传」的单据可以上传")
    if (row.upload_status or "").strip() in ("上传排队中", "上传中"):
        raise HTTPException(status_code=400, detail="该单据正在由 RPA 处理（排队中/上传中），请勿重复提交")
    # 绑定门禁：成片必须已通过绑定审核并写入产品，才允许上传至平台
    if row.bind_status != "已通过":
        raise HTTPException(status_code=400, detail="该素材尚未通过绑定审核（未绑定到产品），不能上传至平台")
    # 上传优先使用高清成片；无高清地址时回退原成片（图片素材直接用 media_url）
    media_url = (row.hd_url or "").strip() or (row.media_url or "").strip()
    if not media_url:
        raise HTTPException(status_code=400, detail="单据缺少成片地址，无法上传")

    items = _json(row.platform_items, [])
    pairs = [{"pp_id": int(i["pp_id"]), "store_id": int(i["store_id"])} for i in items if i.get("pp_id")]
    if not pairs:
        raise HTTPException(status_code=400, detail="单据缺少目标平台 SKU")

    is_image = (row.media_type or "").strip() == "image"
    if is_image:
        # 图片：写入 Amazon 图片上传多维表（SKU/紫鸟账号/店铺/站点/图片/类型），RPA 消费。
        # Ozon 图片上传暂未接入，只取 Amazon SKU。
        from services.feishu_image_sku_service import create_sku_image_records, feishu_image_configured

        if not feishu_image_configured():
            raise HTTPException(status_code=400,
                                detail="飞书图片上传表未配置，请在 backend/.env 填写 FEISHU_IMAGE_BASE_TOKEN / FEISHU_IMAGE_TABLE_ID 后重启服务")
        product, entries = _load_platform_sku_entries(
            db, current_user.tenant_id, row.product_id, ["amazon"], id_filter=pairs
        )
        amazon_entries = [e for e in entries if (e.get("platform") or "").lower() == "amazon"]
        if not amazon_entries:
            raise HTTPException(status_code=400, detail="图片上传暂仅支持 Amazon 平台 SKU（Ozon 图片上传未接入）")
        image_style = (row.media_style or "附图").strip()
        try:
            stats = await create_sku_image_records(
                media_url, product[1] or "", amazon_entries, image_style, request_id=request_id
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("媒体单据 %s 图片上传失败", request_id)
            raise HTTPException(status_code=500, detail=f"图片上传失败：{str(e)[:200]}")
        ok = bool(stats.get("success"))
        message = (f"图片已写入 {stats.get('success', 0)} 条 Amazon 图片表记录（类型：{image_style}）"
                   + (f"，失败 {stats['failed']} 条：{'；'.join(stats['errors'][:3])}" if stats.get("failed") else ""))
        result = {"success": ok, "message": message, "data": stats}
    else:
        # 视频：走统一上传通道（Amazon 写视频多维表由 RPA 上传 / Ozon Seller API 直传）
        # 语言门禁：方案语言（或 AI 生成任务口播语言）与目标 SKU 站点语言不一致时，
        # 统一上传通道会返回 409，前端确认后带 confirm_language_mismatch=true 重试。
        plan = _json(row.plan, {}) or {}
        sku_body = SkuVideoUploadBody(
            product_id=row.product_id,
            video_urls=[media_url],
            items=[SkuVideoUploadItem(**p) for p in pairs],
            confirm_language_mismatch=bool(body and body.confirm_language_mismatch),
            confirm_language_unknown=bool(body and body.confirm_language_unknown),
            video_language=(plan.get("language") or None),
            video_type=(row.video_type or plan.get("video_type") or None),
        )
        try:
            result = await upload_sku_video_unified(body=sku_body, db=db, current_user=current_user)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("媒体单据 %s 上传失败", request_id)
            raise HTTPException(status_code=500, detail=f"上传失败：{str(e)[:200]}")

    ok = bool(result.get("success"))
    message = result.get("message") or ("提交成功" if ok else "提交失败")
    # 点击上传只负责把素材写入平台通道（Amazon 视频表/图片表 → 影刀 RPA 消费；
    # Ozon Seller API 直传），单据置「上传排队中」并留在待上传页签。
    # RPA/外部流程完成实际上传后直接改库即可进入已上传：
    #   UPDATE media_requests SET stage='已上传', upload_status='已完成', upload_time=NOW()
    #   WHERE id=... AND deleted_at IS NULL
    # 失败时只写 upload_status='上传失败'（留在待上传，前端出现「重新上传」）。
    db.execute(text("""
        UPDATE media_requests
        SET stage = '待上传', upload_status = :status, upload_time = NULL,
            upload_result = :result, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {
        "status": "上传排队中" if ok else "上传失败",
        "result": _dumps(result),
        "id": request_id,
        "tid": current_user.tenant_id,
    })
    _add_log(db, current_user.tenant_id, request_id, current_user,
             "提交上传" if ok else "上传失败", message[:1000])
    db.commit()
    return {"success": ok, "message": message if not ok else f"{message}，已进入上传队列（上传排队中）",
            "data": result,
            "item": _serialize(_load_row(db, current_user.tenant_id, request_id))}
