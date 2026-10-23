from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
import json
from sqlalchemy.orm import Session
from sqlalchemy import text

from database.database import get_db
from dependencies import PermissionChecker
from models.user import User
from routers.products import _parse_json_images, _serialize_images
from services.feishu_video_sku_service import (
    is_configured as feishu_video_configured,
    resolve_start_name,
)

router = APIRouter(prefix="/api/video-bindings", tags=["video_bindings"])

SOURCE_LABELS = {"ai_video": "AI视频", "upscale": "高清处理"}


def _parse_store_ids(raw) -> List[int]:
    """platform_products.store_id 兼容解析：JSON 数组 / 单个数字 / 数字字符串"""
    if not raw:
        return []
    try:
        if isinstance(raw, (int, float)):
            return [int(raw)]
        if isinstance(raw, str):
            s = raw.strip()
            if not s:
                return []
            try:
                parsed = json.loads(s)
                if isinstance(parsed, (int, float)):
                    return [int(parsed)]
                if isinstance(parsed, list):
                    return [int(x) for x in parsed if x is not None]
            except Exception:
                return [int(s)]
        if isinstance(raw, (list, tuple)):
            return [int(x) for x in raw if x is not None]
    except Exception:
        return []
    return []


def _load_amazon_sku_entries(db: Session, tenant_id: int, product_id: int, id_filter: Optional[List[dict]] = None):
    """查产品 AMAZON 平台 SKU×店铺组合条目（含紫鸟登录账号/启动名），id_filter 限定 (pp_id, store_id) 对"""
    product = db.execute(text("""
        SELECT id, product_code, name FROM products
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"pid": product_id, "tid": tenant_id}).fetchone()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    pp_rows = db.execute(text("""
        SELECT pp.id, pp.sku, pp.asin, pp.store_id FROM platform_products pp
        WHERE pp.product_id = :pid AND pp.tenant_id = :tid
          AND pp.platform = 'amazon' AND pp.deleted_at IS NULL
        ORDER BY pp.id
    """), {"pid": product_id, "tid": tenant_id}).fetchall()

    # 汇总店铺 ID 批量查店铺信息
    all_store_ids = sorted({sid for row in pp_rows for sid in _parse_store_ids(row[3])})
    store_map = {}
    if all_store_ids:
        placeholders = ",".join([f":sid_{i}" for i in range(len(all_store_ids))])
        sid_params = {f"sid_{i}": sid for i, sid in enumerate(all_store_ids)}
        store_rows = db.execute(
            text(f"SELECT id, name, ziniao_account, site FROM stores WHERE id IN ({placeholders}) AND deleted_at IS NULL"),
            sid_params,
        ).fetchall()
        store_map = {r[0]: {"name": r[1] or "", "ziniao_account": r[2] or "", "site": r[3] or ""} for r in store_rows}

    allowed = None
    if id_filter is not None:
        allowed = {(int(x["pp_id"]), int(x["store_id"])) for x in id_filter}

    entries = []
    for row in pp_rows:
        for sid in _parse_store_ids(row[3]):
            if allowed is not None and (int(row[0]), int(sid)) not in allowed:
                continue
            store = store_map.get(sid, {"name": "", "ziniao_account": "", "site": ""})
            asin = (row[2] or "").strip()
            account = store["ziniao_account"]
            entries.append({
                "pp_id": int(row[0]),
                "store_id": int(sid),
                "sku": row[1] or "",
                "asin": asin,
                "has_asin": bool(asin),
                "store_name": store["name"],
                "site": store["site"],
                "ziniao_account": account,
                "ziniao_start_name": resolve_start_name(account),
            })
    return product, entries


class VideoBindingSubmit(BaseModel):
    video_url: str
    product_id: int
    source: str = "ai_video"
    task_title: Optional[str] = None


class VideoBindingReject(BaseModel):
    reason: Optional[str] = None


@router.post("")
async def submit_video_binding(
    body: VideoBindingSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:use")),
):
    """提交「绑定至产品」审核申请（AI视频 / 高清处理页），审核通过后才真正绑定"""
    video_url = body.video_url.strip()
    if not video_url:
        raise HTTPException(status_code=400, detail="视频地址不能为空")
    if body.source not in SOURCE_LABELS:
        body.source = "ai_video"

    product = db.execute(text("""
        SELECT id, product_code, name, video_url, videos FROM products
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"pid": body.product_id, "tid": current_user.tenant_id}).fetchone()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    # 已绑定过的视频不再受理（兼容历史单视频字段）
    existing_videos = _parse_json_images(product[4])
    if not existing_videos and product[3]:
        existing_videos = [product[3]]
    if video_url in existing_videos:
        raise HTTPException(status_code=400, detail="该视频已绑定至该产品")

    duplicate = db.execute(text("""
        SELECT id FROM video_binding_requests
        WHERE tenant_id = :tid AND video_url = :url AND product_id = :pid
          AND status = 'pending' AND deleted_at IS NULL
        LIMIT 1
    """), {"tid": current_user.tenant_id, "url": video_url, "pid": body.product_id}).fetchone()
    if duplicate:
        raise HTTPException(status_code=400, detail="该视频已提交过绑定申请，请等待审核")

    db.execute(text("""
        INSERT INTO video_binding_requests
            (tenant_id, video_url, product_id, product_code, product_name, source, task_title,
             status, requester_id, requester_name, created_at, updated_at)
        VALUES
            (:tid, :url, :pid, :pcode, :pname, :source, :title,
             'pending', :uid, :uname, NOW(), NOW())
    """), {
        "tid": current_user.tenant_id,
        "url": video_url,
        "pid": product[0],
        "pcode": product[1],
        "pname": product[2],
        "source": body.source,
        "title": (body.task_title or "").strip()[:200] or None,
        "uid": current_user.id,
        "uname": current_user.username,
    })
    db.commit()
    return {"success": True, "message": "绑定申请已提交，等待审核"}


@router.get("/pending-count")
async def get_pending_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve")),
):
    """待审核绑定申请数量（首页视频机器人KPI卡片）"""
    count = db.execute(text("""
        SELECT COUNT(*) FROM video_binding_requests
        WHERE tenant_id = :tid AND status = 'pending' AND deleted_at IS NULL
    """), {"tid": current_user.tenant_id}).scalar() or 0
    return {"success": True, "pending_count": int(count)}


@router.get("")
async def list_video_bindings(
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve")),
):
    """绑定申请列表（审核页），按状态筛选 + 编码/品名/提交人搜索"""
    where = ["r.tenant_id = :tid", "r.deleted_at IS NULL"]
    params = {"tid": current_user.tenant_id}
    if status in ("pending", "approved", "rejected"):
        where.append("r.status = :status")
        params["status"] = status
    if search and search.strip():
        where.append("(r.product_code LIKE :kw OR r.product_name LIKE :kw OR r.requester_name LIKE :kw)")
        params["kw"] = f"%{search.strip()}%"

    where_clause = " AND ".join(where)
    total = db.execute(text(f"""
        SELECT COUNT(*) FROM video_binding_requests r WHERE {where_clause}
    """), params).scalar() or 0

    page_size = max(1, min(page_size, 100))
    page = max(1, page)
    rows = db.execute(text(f"""
        SELECT r.id, r.video_url, r.product_id, r.product_code, r.product_name, r.source, r.task_title,
               r.status, r.requester_name, r.reject_reason, r.reviewer_name, r.reviewed_at, r.created_at
        FROM video_binding_requests r
        WHERE {where_clause}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()

    items = []
    for row in rows:
        items.append({
            "id": row[0],
            "video_url": row[1],
            "product_id": row[2],
            "product_code": row[3],
            "product_name": row[4],
            "source": row[5] if row[5] in SOURCE_LABELS else "ai_video",
            "source_label": SOURCE_LABELS.get(row[5] if row[5] in SOURCE_LABELS else "ai_video"),
            "task_title": row[6],
            "status": row[7],
            "requester_name": row[8],
            "reject_reason": row[9],
            "reviewer_name": row[10],
            "reviewed_at": row[11].strftime("%Y-%m-%d %H:%M:%S") if row[11] else None,
            "created_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else None,
        })

    # 各状态计数（审核页页签括号展示，不受搜索条件影响）
    count_rows = db.execute(text("""
        SELECT status, COUNT(*) FROM video_binding_requests
        WHERE tenant_id = :tid AND deleted_at IS NULL
        GROUP BY status
    """), {"tid": current_user.tenant_id}).fetchall()
    by_status = {row[0]: int(row[1]) for row in count_rows}
    status_counts = {
        "pending": by_status.get("pending", 0),
        "approved": by_status.get("approved", 0),
        "rejected": by_status.get("rejected", 0),
        "all": sum(by_status.values()),
    }
    return {"success": True, "data": {"items": items, "total": int(total), "status_counts": status_counts}}


def _do_bind_video(db: Session, tenant_id: int, product_id: int, video_url: str):
    """审核通过后执行真实绑定（与 POST /products/{id}/videos 逻辑一致）"""
    row = db.execute(text("""
        SELECT video_url, videos, product_code FROM products
        WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
    """), {"id": product_id, "tid": tenant_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="商品不存在")

    # 兼容历史单视频：videos 为空且 video_url 有值时，先把旧视频并入列表
    videos = _parse_json_images(row[1])
    if not videos and row[0]:
        videos = [row[0]]
    if video_url in videos:
        raise HTTPException(status_code=400, detail="该视频已绑定至该产品")
    if len(videos) >= 6:
        raise HTTPException(status_code=400, detail="产品已达到视频上限")

    # TOS 复制改名为「产品编码_序号_时间戳」（时间戳防删除重绑后 URL 复用命中缓存旧内容），
    # 失败回退原地址不阻断绑定
    final_url = video_url
    try:
        from services.tos_service import bound_video_target_name, rename_file
        final_url = rename_file(video_url, bound_video_target_name(row[2], len(videos) + 1))
    except Exception as rename_err:
        import logging
        logging.getLogger(__name__).warning(
            "审核绑定视频 TOS 改名失败，回退原地址: %s, err=%s", video_url, rename_err
        )

    videos.append(final_url)
    db.execute(text("""
        UPDATE products SET videos = :videos, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"videos": _serialize_images(videos), "id": product_id, "tid": tenant_id})
    return videos


@router.post("/{request_id}/approve")
async def approve_video_binding(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve")),
):
    """通过绑定申请：视频真正写入产品 videos 列表"""
    req = db.execute(text("""
        SELECT id, video_url, product_id, status FROM video_binding_requests
        WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
    """), {"id": request_id, "tid": current_user.tenant_id}).fetchone()
    if not req:
        raise HTTPException(status_code=404, detail="申请不存在")
    if req[3] != "pending":
        raise HTTPException(status_code=400, detail="该申请已处理，请刷新列表")

    videos = _do_bind_video(db, current_user.tenant_id, req[2], req[1])
    db.execute(text("""
        UPDATE video_binding_requests
        SET status = 'approved', reviewer_id = :uid, reviewer_name = :uname,
            reviewed_at = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"uid": current_user.id, "uname": current_user.username,
           "id": request_id, "tid": current_user.tenant_id})
    db.commit()
    # 首条视频标记（len==1 即绑定前产品无任何视频）；飞书视频表未配置时不出弹窗
    return {
        "success": True,
        "message": "已通过并绑定至产品详情",
        "data": {"videos": videos, "is_first_video": len(videos) == 1 and feishu_video_configured()},
    }


@router.post("/{request_id}/reject")
async def reject_video_binding(
    request_id: int,
    body: VideoBindingReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve")),
):
    """拒绝绑定申请，可填写拒绝原因"""
    req = db.execute(text("""
        SELECT id, status FROM video_binding_requests
        WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
    """), {"id": request_id, "tid": current_user.tenant_id}).fetchone()
    if not req:
        raise HTTPException(status_code=404, detail="申请不存在")
    if req[1] != "pending":
        raise HTTPException(status_code=400, detail="该申请已处理，请刷新列表")

    reason = (body.reason or "").strip()[:500] or None
    db.execute(text("""
        UPDATE video_binding_requests
        SET status = 'rejected', reject_reason = :reason, reviewer_id = :uid, reviewer_name = :uname,
            reviewed_at = NOW(), updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"reason": reason, "uid": current_user.id, "uname": current_user.username,
           "id": request_id, "tid": current_user.tenant_id})
    db.commit()
    return {"success": True, "message": "已拒绝该绑定申请"}


# ==================== 首条视频直传飞书 SKU（审核通过后弹窗触发） ====================

class FeishuSkuUploadItem(BaseModel):
    pp_id: int
    store_id: int


@router.get("/amazon-skus")
async def list_amazon_skus(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve", "product:edit")),
):
    """产品 AMAZON 平台 SKU×店铺组合列表（首条视频/详情页视频上传弹窗数据源）"""
    if not feishu_video_configured():
        raise HTTPException(status_code=400, detail="飞书视频上传表未配置，功能未启用")
    _, entries = _load_amazon_sku_entries(db, current_user.tenant_id, product_id)
    return {"success": True, "data": {"items": entries}}


class FeishuSkuUploadBody(BaseModel):
    product_id: int
    video_url: Optional[str] = None
    # 多视频（产品详情页「视频上传」勾选已有视频场景），与 video_url 二选一
    video_urls: Optional[List[str]] = None
    items: List[FeishuSkuUploadItem]


@router.post("/feishu-sku-upload")
async def upload_sku_video_to_feishu(
    body: FeishuSkuUploadBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve", "product:edit")),
):
    """把视频写入飞书多维表 SKU 记录（ASIN/紫鸟登录账号/紫鸟启动名/站点/视频附件/填报人/填报日期）

    记录数 = 视频数 × 勾选 SKU 数
    """
    if not feishu_video_configured():
        raise HTTPException(status_code=400, detail="飞书视频上传表未配置（FEISHU_VIDEO_BASE_TOKEN / FEISHU_VIDEO_TABLE_ID）")
    video_urls = [u.strip() for u in (body.video_urls or []) if u and u.strip()]
    if not video_urls and body.video_url and body.video_url.strip():
        video_urls = [body.video_url.strip()]
    if not video_urls:
        raise HTTPException(status_code=400, detail="视频地址不能为空")
    if not body.items:
        raise HTTPException(status_code=400, detail="请至少勾选一个 SKU")

    # 服务端按 (pp_id, store_id) 重查条目，不信任前端回传的 ASIN/紫鸟信息
    product, entries = _load_amazon_sku_entries(
        db, current_user.tenant_id, body.product_id,
        id_filter=[{"pp_id": it.pp_id, "store_id": it.store_id} for it in body.items],
    )
    if not entries:
        raise HTTPException(status_code=400, detail="所选 SKU 不存在或已删除")
    no_asin = [e["sku"] or f"#{e['pp_id']}" for e in entries if not e["has_asin"]]
    if no_asin:
        raise HTTPException(status_code=400, detail=f"以下 SKU 未绑定 ASIN，无法上传：{'、'.join(no_asin)}")

    from services.feishu_video_sku_service import create_sku_video_records as _create
    result = await _create(video_urls, product[1] or "", entries)
    if result["failed"]:
        import logging
        logging.getLogger(__name__).warning(
            "SKU视频上传飞书部分失败 product=%s: %s", product[1], "; ".join(result["errors"])
        )
    message = f"已上传 {result['success']} 条 SKU 记录"
    if result["failed"]:
        message += f"，失败 {result['failed']} 条"
    return {"success": True, "message": message, "data": result}
