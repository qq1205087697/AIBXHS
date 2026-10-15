from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from database.database import get_db
from dependencies import PermissionChecker
from models.user import User
from routers.products import _parse_json_images, _serialize_images

router = APIRouter(prefix="/api/video-bindings", tags=["video_bindings"])

SOURCE_LABELS = {"ai_video": "AI视频", "upscale": "高清处理"}


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
    return {"success": True, "data": {"items": items, "total": int(total)}}


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

    # TOS 复制改名为「产品编码_序号」，失败回退原地址不阻断绑定
    final_url = video_url
    try:
        from services.tos_service import rename_file
        final_url = rename_file(video_url, f"{row[2]}_{len(videos) + 1}")
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
    return {"success": True, "message": "已通过并绑定至产品详情", "data": {"videos": videos}}


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
