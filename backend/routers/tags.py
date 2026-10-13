"""标签管理 API（M3 标签管理服务 + M2 词库配置 + 审计查询 + 拉取状态）

路由前缀：/api/tags
依据：《系统设计》v1.0 §3.2.M3 / UserStory US-3/US-4/US-6/US-8/US-9
"""
import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies import get_current_user
from models.user import User
from models.tag import HolidayLexicon, ProductTag, TagAuditLog
from services import tag_service
from services.startop_client import get_pull_status, StartopMCPError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tags", tags=["tags"])


# ==================== 产品标签 ====================

@router.get("")
async def list_tags(
    asin: Optional[str] = Query(None, description="按 ASIN 过滤"),
    account: Optional[str] = Query(None, description="按店铺作用域过滤（行级；空串=通配）"),
    tag_type: Optional[str] = Query(None, description="holiday / force_replenish"),
    keyword: Optional[str] = Query(None, description="ASIN/产品名模糊搜索"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """产品标签列表（含来源/锁定状态/依据词/店铺作用域，US-8）"""
    from models.restock import InventorySnapshot

    tenant_id = current_user.tenant_id
    q = db.query(ProductTag).filter(
        ProductTag.tenant_id == tenant_id,
        ProductTag.deleted_at.is_(None),
    )
    if asin:
        q = q.filter(ProductTag.asin == asin)
    if account is not None and account != "":
        # 行级查询：本店铺行 + 通配（account='' 作用于全部店铺）
        q = q.filter(ProductTag.account.in_([account, ""]))
    elif account is not None:
        q = q.filter(ProductTag.account == "")
    if tag_type in ("holiday", "force_replenish"):
        q = q.filter(ProductTag.tag_type == tag_type)

    # 模糊搜索：先查匹配 ASIN 集合（标签表无产品名，联合快照表）
    if keyword:
        kw = f"%{keyword}%"
        asins = db.query(InventorySnapshot.asin).filter(
            InventorySnapshot.tenant_id == tenant_id,
            InventorySnapshot.deleted_at.is_(None),
            (InventorySnapshot.asin.like(kw)) | (InventorySnapshot.product_name.like(kw)),
        ).distinct().limit(500).all()
        asin_list = [a[0] for a in asins if a[0]]
        q = q.filter(ProductTag.asin.in_(asin_list)) if asin_list else q.filter(text("1=0"))

    total = q.count()
    rows = q.order_by(ProductTag.updated_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = [{
        "id": r.id, "asin": r.asin, "account": r.account, "sku": r.sku,
        "tag_type": r.tag_type,
        "tag_value": r.tag_value, "source": r.source, "locked": r.locked,
        "active": r.active, "match_basis": r.match_basis, "reason": r.reason,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    } for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/force-replenish")
async def set_force_replenish(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """设置强制补货标签（US-3：理由必填 + 二次确认由前端保证；K3 停售拒绝）

    `account` 为店铺作用域（行级）：汇总行会展开到其共享库存子行；缺省/空串 = 该 ASIN 全部店铺。
    """
    asin = (body.get("asin") or "").strip()
    reason = (body.get("reason") or "").strip()
    sku = (body.get("sku") or "").strip()
    account = (body.get("account") or "").strip()
    if not asin:
        raise HTTPException(status_code=400, detail="asin 不能为空")
    if not reason:
        raise HTTPException(status_code=400, detail="设置强制补货必须填写理由")
    try:
        result = tag_service.set_force_replenish(
            db, current_user.tenant_id, asin,
            operator=current_user.username or f"user_{current_user.id}",
            reason=reason, sku=sku, account=account,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "data": result}


@router.delete("/force-replenish/{asin}")
async def clear_force_replenish(
    asin: str,
    account: str = Query("", description="店铺作用域（行级）；空=该 ASIN 全部店铺"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """解除强制补货标签（恢复常规过滤规则，审计留痕）

    **行级**：只影响 `account` 指定的店铺行（汇总行展开到共享库存子行）；空=全部店铺。
    """
    result = tag_service.clear_force_replenish(
        db, current_user.tenant_id, asin,
        operator=current_user.username or f"user_{current_user.id}",
        account=account,
    )
    return {"success": True, "data": result}


@router.post("/holiday")
async def set_holiday_tag(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """人工打节日标签（K5：人工锁定优先；K6 枚举校验）

    `account` 为店铺作用域（行级）：汇总行会展开到其共享库存子行；空串 = 该 ASIN 全部店铺。
    """
    asin = (body.get("asin") or "").strip()
    holiday = (body.get("holiday_value") or body.get("holiday") or "").strip()
    clear = body.get("clear", False)
    account = (body.get("account") or "").strip()
    if not asin:
        raise HTTPException(status_code=400, detail="asin 不能为空")
    if not clear and not holiday:
        raise HTTPException(status_code=400, detail="holiday_value 不能为空")
    operator = current_user.username or f"user_{current_user.id}"
    try:
        if clear:
            result = tag_service.unlock_holiday_tag(
                db, current_user.tenant_id, asin, holiday or "其他",
                operator=operator, clear=True, account=account)
        else:
            result = tag_service.set_holiday_tag(
                db, current_user.tenant_id, asin, holiday, operator=operator,
                account=account)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "data": result}


@router.post("/holiday/unlock")
async def unlock_holiday_tag(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """解除人工锁定、恢复自动打标管辖（K5）

    **行级**：`account` 指定店铺行（汇总行展开到共享库存子行）；空串 = 全部店铺。
    """
    asin = (body.get("asin") or "").strip()
    holiday = (body.get("holiday_value") or "").strip()
    account = (body.get("account") or "").strip()
    if not asin or not holiday:
        raise HTTPException(status_code=400, detail="asin 与 holiday_value 不能为空")
    result = tag_service.unlock_holiday_tag(
        db, current_user.tenant_id, asin, holiday,
        operator=current_user.username or f"user_{current_user.id}", clear=False,
        account=account)
    return {"success": True, "data": result}


# ==================== 自动打标 ====================

@router.post("/auto-tagging/run")
async def run_auto_tagging(
    body: dict = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """手动触发自动打标批处理（US-6；每日定时任务亦调用同一入口）"""
    window_days = (body or {}).get("window_days")
    try:
        result = tag_service.run_auto_tagging(db, current_user.tenant_id, window_days=window_days)
    except Exception as e:
        logger.error(f"自动打标失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"自动打标失败: {e}")
    return {"success": True, "data": result}


@router.post("/preview")
async def preview_match(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """匹配试算预览（US-8 AC3：只读，不产生任何标签变更）"""
    asin = (body.get("asin") or "").strip() or None
    keywords = body.get("keywords")
    result = tag_service.preview_match(db, current_user.tenant_id, asin=asin, keywords=keywords)
    return {"success": True, "data": result}


# ==================== 词库配置（F7 / US-4） ====================

@router.get("/lexicon")
async def list_lexicon(
    holiday_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """词库列表（按节日分组返回）"""
    q = db.query(HolidayLexicon).filter(
        HolidayLexicon.tenant_id == current_user.tenant_id,
        HolidayLexicon.deleted_at.is_(None),
    )
    if holiday_name:
        q = q.filter(HolidayLexicon.holiday_name == holiday_name)
    rows = q.order_by(HolidayLexicon.holiday_name, HolidayLexicon.keyword).all()
    items = [{
        "id": r.id, "holiday_name": r.holiday_name, "keyword": r.keyword,
        "match_type": r.match_type, "site": r.site,
        "window_start": r.window_start.isoformat() if r.window_start else None,
        "window_end": r.window_end.isoformat() if r.window_end else None,
        "status": r.status, "remark": r.remark, "created_by": r.created_by,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    } for r in rows]
    return {"items": items, "holiday_names": tag_service.K6_HOLIDAY_NAMES}


@router.post("/lexicon")
async def create_lexicon_entry(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """新增词库条目（K6 枚举校验；变更即生效于下一轮打标）"""
    holiday_name = (body.get("holiday_name") or "").strip()
    keyword = (body.get("keyword") or "").strip()
    if not holiday_name or not keyword:
        raise HTTPException(status_code=400, detail="holiday_name 与 keyword 不能为空")
    if holiday_name not in tag_service.K6_HOLIDAY_NAMES:
        raise HTTPException(status_code=400,
                            detail=f"节日名 {holiday_name} 不在 K6 枚举内，请在枚举内选择或使用「其他」")
    exists = db.query(HolidayLexicon).filter(
        HolidayLexicon.tenant_id == current_user.tenant_id,
        HolidayLexicon.holiday_name == holiday_name,
        HolidayLexicon.keyword == keyword,
        HolidayLexicon.deleted_at.is_(None),
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="该词库条目已存在")

    # 节日日期窗口（可选，YYYY-MM-DD；窗口内命中才打标）
    window_start = window_end = None
    from datetime import date as _date
    try:
        if body.get("window_start"):
            window_start = _date.fromisoformat(str(body["window_start"])[:10])
        if body.get("window_end"):
            window_end = _date.fromisoformat(str(body["window_end"])[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="日期窗口格式应为 YYYY-MM-DD")

    entry = HolidayLexicon(
        tenant_id=current_user.tenant_id,
        holiday_name=holiday_name,
        keyword=keyword[:100],
        match_type=body.get("match_type", "contains") if body.get("match_type") in ("contains", "exact") else "contains",
        window_start=window_start,
        window_end=window_end,
        site=body.get("site", "ALL") if body.get("site") in ("ALL", "US", "UK") else "ALL",
        status=1,
        remark=(body.get("remark") or "")[:200],
        created_by=current_user.username or f"user_{current_user.id}",
    )
    db.add(entry)
    tag_service.write_audit(db, current_user.tenant_id, "", "", "lexicon", "set",
                            None, f"{holiday_name}:{keyword}", "manual",
                            current_user.username or f"user_{current_user.id}",
                            reason="词库新增")
    db.commit()
    return {"success": True, "data": {"id": entry.id}}


@router.put("/lexicon/{entry_id}")
async def update_lexicon_entry(
    entry_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """修改词库条目（US-4 AC2：节日/关键词/匹配方式/站点/日期窗口/启用状态/备注）

    - 仅更新请求体中出现的字段；未出现的字段保持原值
    - 校验口径与新增一致：K6 枚举 + (节日, 关键词) 唯一 + 窗口区间
    - 变更即生效于下一轮打标；100% 入审计（V4，old_value → new_value）
    """
    from datetime import date as _date, datetime as _dt

    entry = db.query(HolidayLexicon).filter(
        HolidayLexicon.id == entry_id,
        HolidayLexicon.tenant_id == current_user.tenant_id,
        HolidayLexicon.deleted_at.is_(None),
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="词库条目不存在")

    # ===== 第一步：只做校验，不触碰 ORM 对象（避免 autoflush 在唯一键冲突时抛 IntegrityError） =====
    target_holiday = entry.holiday_name
    target_keyword = entry.keyword

    if "holiday_name" in body:
        v = (body.get("holiday_name") or "").strip()
        if not v:
            raise HTTPException(status_code=400, detail="holiday_name 不能为空")
        if v not in tag_service.K6_HOLIDAY_NAMES:
            raise HTTPException(status_code=400,
                                detail=f"节日名 {v} 不在 K6 枚举内，请在枚举内选择或使用「其他」")
        target_holiday = v

    if "keyword" in body:
        v = (body.get("keyword") or "").strip()
        if not v:
            raise HTTPException(status_code=400, detail="keyword 不能为空")
        target_keyword = v[:100]

    clash = db.query(HolidayLexicon).filter(
        HolidayLexicon.tenant_id == current_user.tenant_id,
        HolidayLexicon.holiday_name == target_holiday,
        HolidayLexicon.keyword == target_keyword,
        HolidayLexicon.deleted_at.is_(None),
        HolidayLexicon.id != entry.id,
    ).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"「{target_holiday}」下已存在关键词「{target_keyword}」")

    if "match_type" in body and body.get("match_type") not in ("contains", "exact"):
        raise HTTPException(status_code=400, detail="match_type 应为 contains / exact")
    if "site" in body and body.get("site") not in ("ALL", "US", "UK"):
        raise HTTPException(status_code=400, detail="site 应为 ALL / US / UK")

    window_target = {}
    for key in ("window_start", "window_end"):
        if key not in body:
            continue
        raw = body.get(key)
        if raw in (None, ""):
            window_target[key] = None
            continue
        try:
            window_target[key] = _date.fromisoformat(str(raw)[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="日期窗口格式应为 YYYY-MM-DD")
    ws = window_target.get("window_start", entry.window_start)
    we = window_target.get("window_end", entry.window_end)
    if ws and we and ws > we:
        raise HTTPException(status_code=400, detail="日期窗口起始不得晚于截止")

    # ===== 第二步：应用变更并 diff（只记真正变化的字段） =====
    operator = current_user.username or f"user_{current_user.id}"
    old_repr = f"{entry.holiday_name}:{entry.keyword}"
    changed = []

    if target_holiday != entry.holiday_name:
        entry.holiday_name = target_holiday
        changed.append("holiday_name")
    if target_keyword != entry.keyword:
        entry.keyword = target_keyword
        changed.append("keyword")
    if "match_type" in body and body["match_type"] != entry.match_type:
        entry.match_type = body["match_type"]
        changed.append("match_type")
    if "site" in body and body["site"] != entry.site:
        entry.site = body["site"]
        changed.append("site")
    for key, new_val in window_target.items():
        if new_val != getattr(entry, key):
            setattr(entry, key, new_val)
            changed.append(key)
    if "status" in body:
        v = 1 if int(body.get("status") or 0) == 1 else 0
        if v != entry.status:
            entry.status = v
            changed.append("status")
    if "remark" in body:
        v = (body.get("remark") or "")[:200]
        if v != (entry.remark or ""):
            entry.remark = v
            changed.append("remark")

    if not changed:
        return {"success": True, "data": {"id": entry.id, "changed": []}}

    entry.updated_at = _dt.now()
    tag_service.write_audit(db, current_user.tenant_id, "", "", "lexicon", "set",
                            old_repr, f"{entry.holiday_name}:{entry.keyword}", "manual",
                            operator, reason=f"词库修改（{','.join(changed)}）")
    db.commit()
    return {
        "success": True,
        "data": {"id": entry.id, "changed": changed,
                 "item": {
                     "id": entry.id, "holiday_name": entry.holiday_name,
                     "keyword": entry.keyword, "match_type": entry.match_type,
                     "site": entry.site,
                     "window_start": entry.window_start.isoformat() if entry.window_start else None,
                     "window_end": entry.window_end.isoformat() if entry.window_end else None,
                     "status": entry.status, "remark": entry.remark,
                 }},
    }


@router.delete("/lexicon/{entry_id}")
async def delete_lexicon_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除词库条目（软删；人工锁定标签不受影响，K5）"""
    entry = db.query(HolidayLexicon).filter(
        HolidayLexicon.id == entry_id,
        HolidayLexicon.tenant_id == current_user.tenant_id,
        HolidayLexicon.deleted_at.is_(None),
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="词库条目不存在")
    entry.status = 0
    entry.deleted_at = entry.updated_at
    from datetime import datetime
    entry.deleted_at = datetime.now()
    tag_service.write_audit(db, current_user.tenant_id, "", "", "lexicon", "clear",
                            f"{entry.holiday_name}:{entry.keyword}", None, "manual",
                            current_user.username or f"user_{current_user.id}",
                            reason="词库删除")
    db.commit()
    return {"success": True}


# ==================== 审计查询（US-9） ====================

@router.get("/audit")
async def query_audit(
    asin: Optional[str] = Query(None),
    operator: Optional[str] = Query(None),
    source: Optional[str] = Query(None, description="auto / manual"),
    action: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """标签变更审计记录（V4 100% 覆盖；只读，US-9）"""
    q = db.query(TagAuditLog).filter(TagAuditLog.tenant_id == current_user.tenant_id)
    if asin:
        q = q.filter(TagAuditLog.asin == asin)
    if operator:
        q = q.filter(TagAuditLog.operator.like(f"%{operator}%"))
    if source in ("auto", "manual", "import"):
        q = q.filter(TagAuditLog.source == source)
    if action:
        q = q.filter(TagAuditLog.action == action)
    total = q.count()
    rows = q.order_by(TagAuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{
            "id": r.id, "event_id": r.event_id, "asin": r.asin, "sku": r.sku,
            "tag_type": r.tag_type, "action": r.action, "old_value": r.old_value,
            "new_value": r.new_value, "source": r.source, "operator": r.operator,
            "reason": r.reason, "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows],
        "total": total, "page": page, "page_size": page_size,
    }


# ==================== 拉取状态与手动触发（US-5） ====================

@router.get("/startop/status")
async def startop_status(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """最近拉取流水（状态卡片：最近拉取时间/页数/成败/兜底标记）+ 主通道配置状态"""
    from config import get_settings
    logs_list = get_pull_status(db, current_user.tenant_id, limit)
    configured = bool(get_settings().STARTOP_MCP_KEY)
    return {"success": True, "data": {
        "configured": configured,
        "fallback_ready": any(l.get("fallback_ready") for l in logs_list),
        "last_pull": (logs_list[0] if logs_list else None),
        "items": logs_list,
    }}


@router.post("/startop/pull")
async def startop_pull_now(
    body: dict = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """手动触发一次星拓搜索词拉取 + 自动打标（US-5；密钥不出服务端）"""
    from services.startop_client import pull_words_to_db
    try:
        pull = pull_words_to_db(db, current_user.tenant_id)
    except StartopMCPError as e:
        raise HTTPException(status_code=502, detail=f"星拓 MCP 拉取失败: {e}")
    tagging = tag_service.run_auto_tagging(db, current_user.tenant_id)
    return {"success": True, "data": {"pull": pull, "tagging": tagging}}


@router.post("/startop/report-import")
async def startop_report_import(
    file: UploadFile = File(..., description="星拓定时报告文件（xlsx/xls/csv）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """星拓定时报告兜底导入（F10 / E-02；MCP 主通道不可用时的词数据来源，US-5）

    - 链路：复用 safe_read_excel → 列名映射 → startop_word_data UPSERT（source=report），
      唯一键与 MCP 主通道一致，因此报告可覆盖/补齐主通道同一行
    - 幂等：文件 SHA-256 去重，同一文件重复上传返回上次结果而不重复写库
    - 权限：设计口径为「已登录 + 角色 admin」
    """
    from routers.restock import is_admin_user
    from services.startop_report_importer import import_report_file

    if not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="仅管理员可执行兜底报告导入")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    result = import_report_file(
        db, current_user.tenant_id,
        file_name=file.filename or "startop_report.xlsx",
        file_content=content,
    )

    # 与 MCP 主通道一致：导入成功后触发一轮自动打标（通道差异不外溢到下游）
    tagging = None
    if result.get("status") == "SUCCESS":
        tagging = tag_service.run_auto_tagging(db, current_user.tenant_id)

    return {
        "success": result.get("status") != "FAILED",
        "data": {"import": result, "tagging": tagging},
    }


# ==================== 过滤配置（K1 阈值） ====================

@router.get("/filter-config")
async def get_filter_config_api(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return {"success": True, "data": tag_service.get_filter_config(db)}


@router.post("/filter-config")
async def save_filter_config_api(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """保存过滤/打标配置（负利润阈值 K1、打标窗口 Q-3 等），下一次计算/查询即生效"""
    if not current_user.role_id:
        raise HTTPException(status_code=403, detail="无权限修改过滤配置")
    cfg = tag_service.save_filter_config(db, body)
    # 阈值变更 → 决策口径刷新
    tag_service.apply_tags_to_decisions(db, current_user.tenant_id)
    return {"success": True, "data": cfg}
