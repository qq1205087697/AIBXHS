from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict
import json
import logging
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
from services.feishu_ozon_video_service import (
    is_configured as ozon_trace_configured,
    create_ozon_upload_records,
    new_batch_no,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video-bindings", tags=["video_bindings"])

SOURCE_LABELS = {"ai_video": "AI视频", "upscale": "高清处理", "ai_image": "AI生图"}
MEDIA_LABELS = {"video": "视频", "image": "图片"}

# 与产品详情页的限制保持一致
MAX_PRODUCT_VIDEOS = 6
MAX_PRODUCT_IMAGES = 9


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


def _load_platform_sku_entries(
    db: Session, tenant_id: int, product_id: int,
    platforms: List[str], id_filter: Optional[List[dict]] = None,
):
    """查产品指定平台的 SKU×店铺组合条目（含紫鸟/凭证可用性），id_filter 限定 (pp_id, store_id) 对

    amazon 条目：asin / has_asin / ziniao_account / ziniao_start_name
    ozon 条目：has_offer_id（sku 即 offer_id）/ has_credentials（店铺已配置 Ozon API 凭证，只回布尔不回明文）
    """
    product = db.execute(text("""
        SELECT id, product_code, name FROM products
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"pid": product_id, "tid": tenant_id}).fetchone()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    plat_list = [p.strip().lower() for p in platforms if p and p.strip()]
    plat_params = {f"plat_{i}": p for i, p in enumerate(plat_list)}
    plat_placeholders = ",".join([f":plat_{i}" for i in range(len(plat_list))])
    pp_rows = db.execute(text(f"""
        SELECT pp.id, pp.sku, pp.asin, pp.store_id, pp.platform, pp.platform_product_id FROM platform_products pp
        WHERE pp.product_id = :pid AND pp.tenant_id = :tid
          AND LOWER(pp.platform) IN ({plat_placeholders}) AND pp.deleted_at IS NULL
        ORDER BY pp.id
    """), {"pid": product_id, "tid": tenant_id, **plat_params}).fetchall()

    # 汇总店铺 ID 批量查店铺信息（Ozon 凭证仅用于 has_credentials 判定，不回传明文）
    all_store_ids = sorted({sid for row in pp_rows for sid in _parse_store_ids(row[3])})
    store_map = {}
    if all_store_ids:
        placeholders = ",".join([f":sid_{i}" for i in range(len(all_store_ids))])
        sid_params = {f"sid_{i}": sid for i, sid in enumerate(all_store_ids)}
        store_rows = db.execute(
            text(f"SELECT id, name, ziniao_account, site, ozon_client_id, ozon_api_key FROM stores WHERE id IN ({placeholders}) AND deleted_at IS NULL"),
            sid_params,
        ).fetchall()
        store_map = {r[0]: {
            "name": r[1] or "", "ziniao_account": r[2] or "", "site": r[3] or "",
            "ozon_client_id": r[4] or "", "ozon_api_key": r[5] or "",
        } for r in store_rows}

    allowed = None
    if id_filter is not None:
        allowed = {(int(x["pp_id"]), int(x["store_id"])) for x in id_filter}

    entries = []
    for row in pp_rows:
        platform = (row[4] or "").strip().lower()
        for sid in _parse_store_ids(row[3]):
            if allowed is not None and (int(row[0]), int(sid)) not in allowed:
                continue
            store = store_map.get(sid, {"name": "", "ziniao_account": "", "site": "", "ozon_client_id": "", "ozon_api_key": ""})
            sku = (row[1] or "").strip()
            entry = {
                "pp_id": int(row[0]),
                "store_id": int(sid),
                "platform": platform,
                "sku": sku,
                "store_name": store["name"],
                "site": store["site"],
            }
            if platform == "ozon":
                entry["has_offer_id"] = bool(sku)
                entry["has_credentials"] = bool(store["ozon_client_id"] and store["ozon_api_key"])
                entry["ozon_product_id"] = str(row[5] or "")
            else:
                asin = (row[2] or "").strip()
                account = store["ziniao_account"]
                entry["asin"] = asin
                entry["has_asin"] = bool(asin)
                entry["ziniao_account"] = account
                entry["ziniao_start_name"] = resolve_start_name(account)
            entries.append(entry)
    return product, entries


def _load_amazon_sku_entries(db: Session, tenant_id: int, product_id: int, id_filter: Optional[List[dict]] = None):
    """查产品 AMAZON 平台 SKU×店铺组合条目（兼容旧接口），id_filter 限定 (pp_id, store_id) 对"""
    return _load_platform_sku_entries(db, tenant_id, product_id, ["amazon"], id_filter)


def _load_ozon_store_credentials(db: Session, tenant_id: int, store_ids: List[int]) -> Dict[int, dict]:
    """按店铺 ID 查 Ozon API 凭证（仅后端内部使用，明文不回传前端）"""
    if not store_ids:
        return {}
    placeholders = ",".join([f":sid_{i}" for i in range(len(store_ids))])
    params = {f"sid_{i}": sid for i, sid in enumerate(store_ids)}
    params["tid"] = tenant_id
    rows = db.execute(
        text(f"SELECT id, name, ozon_client_id, ozon_api_key FROM stores WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL"),
        params,
    ).fetchall()
    return {r[0]: {"client_id": r[2] or "", "api_key": r[3] or "", "store_name": r[1] or ""} for r in rows}


class VideoBindingSubmit(BaseModel):
    video_url: str
    product_id: int
    source: str = "ai_video"
    # video=视频（写 products.videos，上限 6）/ image=图片（写 products.images，上限 9）
    media_type: str = "video"
    task_title: Optional[str] = None


class VideoBindingReject(BaseModel):
    reason: Optional[str] = None


@router.post("")
async def submit_video_binding(
    body: VideoBindingSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:use")),
):
    """提交「绑定至产品」审核申请（AI视频 / 高清处理 / AI生图），审核通过后才真正绑定"""
    media_url = body.video_url.strip()
    if not media_url:
        raise HTTPException(status_code=400, detail="媒体地址不能为空")
    media_type = body.media_type if body.media_type in MEDIA_LABELS else "video"
    kind = MEDIA_LABELS[media_type]
    if body.source not in SOURCE_LABELS:
        body.source = "ai_image" if media_type == "image" else "ai_video"

    product = db.execute(text("""
        SELECT id, product_code, name, video_url, videos, images FROM products
        WHERE id = :pid AND tenant_id = :tid AND deleted_at IS NULL
    """), {"pid": body.product_id, "tid": current_user.tenant_id}).fetchone()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    if media_type == "image":
        existing = _parse_json_images(product[5])
        limit = MAX_PRODUCT_IMAGES
    else:
        # 已绑定过的视频不再受理（兼容历史单视频字段）
        existing = _parse_json_images(product[4])
        if not existing and product[3]:
            existing = [product[3]]
        limit = MAX_PRODUCT_VIDEOS

    if media_url in existing:
        raise HTTPException(status_code=400, detail=f"该{kind}已绑定至该产品")
    if len(existing) >= limit:
        raise HTTPException(status_code=400, detail=f"产品已达到{kind}上限")

    duplicate = db.execute(text("""
        SELECT id FROM video_binding_requests
        WHERE tenant_id = :tid AND video_url = :url AND product_id = :pid
          AND media_type = :mtype AND status = 'pending' AND deleted_at IS NULL
        LIMIT 1
    """), {"tid": current_user.tenant_id, "url": media_url, "pid": body.product_id,
           "mtype": media_type}).fetchone()
    if duplicate:
        raise HTTPException(status_code=400, detail=f"该{kind}已提交过绑定申请，请等待审核")

    db.execute(text("""
        INSERT INTO video_binding_requests
            (tenant_id, video_url, media_type, product_id, product_code, product_name, source, task_title,
             status, requester_id, requester_name, created_at, updated_at)
        VALUES
            (:tid, :url, :mtype, :pid, :pcode, :pname, :source, :title,
             'pending', :uid, :uname, NOW(), NOW())
    """), {
        "tid": current_user.tenant_id,
        "url": media_url,
        "mtype": media_type,
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
        SELECT r.id, r.video_url, r.media_type, r.product_id, r.product_code, r.product_name,
               r.source, r.task_title,
               r.status, r.requester_name, r.reject_reason, r.reviewer_name, r.reviewed_at, r.created_at
        FROM video_binding_requests r
        WHERE {where_clause}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()

    items = []
    for row in rows:
        mtype = row[2] if row[2] in MEDIA_LABELS else "video"
        src = row[6] if row[6] in SOURCE_LABELS else "ai_video"
        items.append({
            "id": row[0],
            "video_url": row[1],
            "media_url": row[1],
            "media_type": mtype,
            "media_type_label": MEDIA_LABELS[mtype],
            "product_id": row[3],
            "product_code": row[4],
            "product_name": row[5],
            "source": src,
            "source_label": SOURCE_LABELS.get(src),
            "task_title": row[7],
            "status": row[8],
            "requester_name": row[9],
            "reject_reason": row[10],
            "reviewer_name": row[11],
            "reviewed_at": row[12].strftime("%Y-%m-%d %H:%M:%S") if row[12] else None,
            "created_at": row[13].strftime("%Y-%m-%d %H:%M:%S") if row[13] else None,
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


def _do_bind_media(db: Session, tenant_id: int, product_id: int, media_url: str,
                   media_type: str = "video"):
    """审核通过后执行真实绑定：视频写 products.videos（上限 6），图片写 products.images（上限 9）"""
    row = db.execute(text("""
        SELECT video_url, videos, images, product_code FROM products
        WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
    """), {"id": product_id, "tid": tenant_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="商品不存在")

    is_image = media_type == "image"
    kind = "图片" if is_image else "视频"
    if is_image:
        items = _parse_json_images(row[2])
        limit, column, subdir = MAX_PRODUCT_IMAGES, "images", "images"
    else:
        # 兼容历史单视频：videos 为空且 video_url 有值时，先把旧视频并入列表
        items = _parse_json_images(row[1])
        if not items and row[0]:
            items = [row[0]]
        limit, column, subdir = MAX_PRODUCT_VIDEOS, "videos", "videos"

    if media_url in items:
        raise HTTPException(status_code=400, detail=f"该{kind}已绑定至该产品")
    if len(items) >= limit:
        raise HTTPException(status_code=400, detail=f"产品已达到{kind}上限")

    # TOS 复制改名为「产品编码_序号_时间戳」（时间戳防删除重绑后 URL 复用命中缓存旧内容），
    # 失败回退原地址不阻断绑定
    final_url = media_url
    try:
        from services.tos_service import bound_video_target_name, rename_file
        final_url = rename_file(
            media_url, bound_video_target_name(row[3], len(items) + 1), subdir=subdir
        )
    except Exception as rename_err:
        import logging
        logging.getLogger(__name__).warning(
            "审核绑定%s TOS 改名失败，回退原地址: %s, err=%s", kind, media_url, rename_err
        )

    items.append(final_url)
    db.execute(text(f"""
        UPDATE products SET {column} = :items, updated_at = NOW()
        WHERE id = :id AND tenant_id = :tid
    """), {"items": _serialize_images(items), "id": product_id, "tid": tenant_id})
    return items


@router.post("/{request_id}/approve")
async def approve_video_binding(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve")),
):
    """通过绑定申请：视频写入产品 videos 列表，图片写入产品 images 列表"""
    req = db.execute(text("""
        SELECT id, video_url, product_id, status, media_type FROM video_binding_requests
        WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
    """), {"id": request_id, "tid": current_user.tenant_id}).fetchone()
    if not req:
        raise HTTPException(status_code=404, detail="申请不存在")
    if req[3] != "pending":
        raise HTTPException(status_code=400, detail="该申请已处理，请刷新列表")

    videos = _do_bind_media(
        db, current_user.tenant_id, req[2], req[1],
        req[4] if req[4] in MEDIA_LABELS else "video",
    )
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


# ==================== 视频统一上传（Amazon 写飞书 RPA / Ozon 走 API + 飞书留痕） ====================

@router.get("/platform-skus")
async def list_platform_skus(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve", "product:edit")),
):
    """产品 AMAZON+OZON 平台 SKU×店铺组合列表（视频统一上传数据源，分平台返回）"""
    _, entries = _load_platform_sku_entries(db, current_user.tenant_id, product_id, ["amazon", "ozon"])
    return {
        "success": True,
        "data": {
            "amazon": [e for e in entries if e["platform"] == "amazon"],
            "ozon": [e for e in entries if e["platform"] == "ozon"],
            "feishu_video_configured": feishu_video_configured(),
            "ozon_trace_configured": ozon_trace_configured(),
        },
    }


class SkuVideoUploadItem(BaseModel):
    pp_id: int
    store_id: int


class SkuVideoUploadBody(BaseModel):
    product_id: int
    video_url: Optional[str] = None
    video_urls: Optional[List[str]] = None
    items: List[SkuVideoUploadItem]


@router.post("/sku-video-upload")
async def upload_sku_video_unified(
    body: SkuVideoUploadBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve", "product:edit")),
):
    """视频统一上传：按勾选 SKU 的平台自动路由

    - Amazon SKU → 写飞书多维表（外部 RPA 消费），记录数 = 视频数 × SKU 数
    - Ozon SKU   → 按 store 调 /v1/product/attributes/update（覆盖语义），再写 Ozon 留痕表
    """
    video_urls = [u.strip() for u in (body.video_urls or []) if u and u.strip()]
    if not video_urls and body.video_url and body.video_url.strip():
        video_urls = [body.video_url.strip()]
    if not video_urls:
        raise HTTPException(status_code=400, detail="视频地址不能为空")
    if not body.items:
        raise HTTPException(status_code=400, detail="请至少勾选一个 SKU")

    # 服务端按 (pp_id, store_id) 重查条目，不信任前端回传的 ASIN/凭证信息
    product, entries = _load_platform_sku_entries(
        db, current_user.tenant_id, body.product_id, ["amazon", "ozon"],
        id_filter=[{"pp_id": it.pp_id, "store_id": it.store_id} for it in body.items],
    )
    if not entries:
        raise HTTPException(status_code=400, detail="所选 SKU 不存在或已删除")

    product_code = product[1] or ""
    product_name = product[2] or ""
    amazon_entries = [e for e in entries if e["platform"] == "amazon"]
    ozon_entries = [e for e in entries if e["platform"] == "ozon"]

    data: Dict = {"amazon": None, "ozon": None}
    msgs: List[str] = []

    # ---- Amazon 分支：写飞书多维表（外部 RPA 消费），行为与旧 /feishu-sku-upload 一致 ----
    if amazon_entries:
        if not feishu_video_configured():
            data["amazon"] = {"error": "飞书视频上传表未配置（FEISHU_VIDEO_BASE_TOKEN / FEISHU_VIDEO_TABLE_ID），Amazon 上传未执行"}
        else:
            no_asin = [e["sku"] or f"#{e['pp_id']}" for e in amazon_entries if not e.get("has_asin")]
            if no_asin:
                data["amazon"] = {"error": f"以下 Amazon SKU 未绑定 ASIN，无法上传：{'、'.join(no_asin)}"}
            else:
                from services.feishu_video_sku_service import create_sku_video_records as _create
                try:
                    result = await _create(video_urls, product_code, amazon_entries)
                    data["amazon"] = result
                    msgs.append(f"Amazon 已写入 {result['success']} 条飞书记录")
                    if result["failed"]:
                        logger.warning("统一上传 Amazon 部分失败 product=%s: %s", product_code, "; ".join(result["errors"]))
                except Exception as e:
                    logger.exception("统一上传 Amazon 失败 product=%s", product_code)
                    data["amazon"] = {"error": f"Amazon 上传失败：{e}"}

    # ---- Ozon 分支：attributes/update（覆盖语义）+ 飞书留痕 ----
    if ozon_entries:
        from services.ozon_video_service import validate_video_urls, update_product_videos
        verrs = validate_video_urls(video_urls)
        if verrs:
            data["ozon"] = {"error": "；".join(verrs), "results": []}
        else:
            no_offer = [e["sku"] or f"#{e['pp_id']}" for e in ozon_entries if not e.get("has_offer_id")]
            no_cred = sorted({e["store_name"] or f"店铺#{e['store_id']}" for e in ozon_entries if not e.get("has_credentials")})
            block_errors = []
            if no_offer:
                block_errors.append(f"以下 Ozon SKU 未填货号(offer_id)：{'、'.join(no_offer)}")
            if no_cred:
                block_errors.append(f"以下店铺未配置 Ozon 凭证，请先在店铺管理填写 Client-Id / Api-Key：{'、'.join(no_cred)}")
            if block_errors:
                data["ozon"] = {"error": "；".join(block_errors), "results": []}
            else:
                store_ids = sorted({e["store_id"] for e in ozon_entries})
                creds = _load_ozon_store_credentials(db, current_user.tenant_id, store_ids)
                results: List[Dict] = []
                task_map: Dict[int, int] = {}
                batch_no = new_batch_no()
                for sid in store_ids:
                    c = creds.get(sid) or {}
                    s_entries = [e for e in ozon_entries if e["store_id"] == sid]
                    offer_ids = [e["sku"] for e in s_entries]
                    store_label = c.get("store_name") or s_entries[0].get("store_name") or f"店铺#{sid}"
                    if not c.get("client_id") or not c.get("api_key"):
                        results.append({"store_id": sid, "store_name": store_label, "offer_ids": offer_ids, "ok": False,
                                        "error": "店铺未配置 Ozon 凭证"})
                        continue
                    try:
                        r = await update_product_videos(c["client_id"], c["api_key"], offer_ids, video_urls, product_code)
                        task_map[sid] = r["task_id"]
                        results.append({"store_id": sid, "store_name": store_label, "task_id": r["task_id"],
                                        "offer_ids": offer_ids, "ok": True})
                    except Exception as e:
                        logger.warning("统一上传 Ozon 失败 store=%s: %s", sid, e)
                        results.append({"store_id": sid, "store_name": store_label, "offer_ids": offer_ids,
                                        "ok": False, "error": str(e)})

                # 飞书留痕：只要存在成功提交的店铺任务就写入（未配置留痕表时跳过，不影响上传结果）
                trace_info = None
                feishu_traced = False
                if task_map and ozon_trace_configured():
                    try:
                        trace_entries = [
                            {
                                "sku": e["sku"], "store_id": e["store_id"],
                                "store_name": e.get("store_name") or "", "site": e.get("site") or "",
                                "ozon_product_id": e.get("ozon_product_id") or "",
                            }
                            for e in ozon_entries if e["store_id"] in task_map
                        ]
                        trace = await create_ozon_upload_records(
                            video_urls, product_code, product_name, trace_entries, task_map, batch_no
                        )
                        feishu_traced = trace["success"] > 0
                        trace_info = {"success": trace["success"], "failed": trace["failed"],
                                      "errors": trace["errors"][:5]}
                    except Exception as e:
                        logger.warning("Ozon 视频留痕失败 batch=%s: %s", batch_no, e)
                        trace_info = {"success": 0, "failed": 0, "errors": [f"留痕写入失败：{e}"]}
                elif task_map:
                    trace_info = {"success": 0, "failed": 0,
                                  "errors": ["Ozon 留痕表未配置（FEISHU_OZON_VIDEO_TABLE_ID），已跳过留痕"]}

                ok_stores = [r for r in results if r["ok"]]
                if ok_stores:
                    msgs.append(f"Ozon 已提交 {len(ok_stores)} 个店铺任务（异步审核）")
                data["ozon"] = {"results": results, "batch_no": batch_no,
                                "feishu_traced": feishu_traced, "trace": trace_info}

    amazon_ok = bool(data["amazon"] and isinstance(data["amazon"].get("success"), int) and data["amazon"]["success"] > 0)
    ozon_ok = bool(data["ozon"] and any(r.get("ok") for r in data["ozon"].get("results") or []))
    if msgs:
        message = "；".join(msgs)
    else:
        first_error = (data["amazon"] or {}).get("error") or (data["ozon"] or {}).get("error") or "未执行任何上传"
        message = first_error
    return {"success": amazon_ok or ozon_ok, "message": message, "data": data}


class OzonTaskStatusItem(BaseModel):
    store_id: int
    task_id: int
    batch_no: Optional[str] = None


class OzonTaskStatusBody(BaseModel):
    tasks: List[OzonTaskStatusItem]


@router.post("/ozon-upload-status")
async def ozon_upload_status(
    body: OzonTaskStatusBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("ai_video:approve", "product:edit")),
):
    """查询 Ozon 视频更新任务处理结果（/v1/product/import/info），终态时回写留痕表"""
    from services.ozon_video_service import get_import_status, summarize_import_items

    results: List[Dict] = []
    for t in body.tasks:
        creds = _load_ozon_store_credentials(db, current_user.tenant_id, [t.store_id])
        c = creds.get(t.store_id) or {}
        if not c.get("client_id") or not c.get("api_key"):
            results.append({"store_id": t.store_id, "task_id": t.task_id, "error": "店铺未配置 Ozon 凭证"})
            continue
        try:
            items = await get_import_status(c["client_id"], c["api_key"], t.task_id)
            status_text, error_text = summarize_import_items(items)
            # 终态时回写留痕表（处理中不回写，避免覆盖「已提交」）
            if t.batch_no and ozon_trace_configured() and status_text in ("成功", "失败"):
                try:
                    await update_status_by_task_trace(t.batch_no, t.task_id, status_text, error_text)
                except Exception as te:
                    logger.warning("Ozon 留痕状态回写失败 batch=%s task=%s: %s", t.batch_no, t.task_id, te)
            results.append({"store_id": t.store_id, "task_id": t.task_id,
                            "status": status_text, "error_text": error_text, "items": items})
        except Exception as e:
            results.append({"store_id": t.store_id, "task_id": t.task_id, "error": str(e)})
    return {"success": True, "data": {"results": results}}


def update_status_by_task_trace(batch_no: str, task_id: int, status_text: str, error_text: str):
    """延迟导入包装，避免模块顶层循环依赖"""
    from services.feishu_ozon_video_service import update_status_by_task
    return update_status_by_task(batch_no, task_id, status_text, error_text)
