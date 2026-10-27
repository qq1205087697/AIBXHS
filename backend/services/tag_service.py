"""标签服务：过滤优先级引擎（M4）+ 标签管理（M3）+ 自动打标（M2）

冻结口径（《高层架构设计》v0.2 / 《系统设计》v1.0）：
- K1 负利润 = gross_margin 小于可配置阈值（BusinessSettings，默认 0），NULL 不误杀
- K2 可计算不显示 = 计算落库 + 展示层过滤（决策行照常写入，filter_status 标记）
- K3 优先级链（经中间确认）= 停售 > 强制补货 > 节日排除 > 负利润排除
      override 不能复活停售产品
- K4 标签产品维度持久（跨快照保留）
- K5 人工打标锁定优先，可解锁恢复自动（锁定按「产品+节日」粒度）
- K6 is_holiday 枚举冻结（""+万圣节/感恩节黑五/圣诞节/情人节/复活节/独立日/
      母亲节/父亲节/返校季/PrimeDay/其他），新增节日走 holiday_lexicon 配置
- Q-2（经中间确认）is_holiday 多值存储：同一产品命中多个节日全部记录（本表 product_tags 多行），
  节日排除语义 = 命中任一节日即排除
"""
import json
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

from models.restock import InventorySnapshot, ReplenishmentDecision
from models.tag import HolidayLexicon, ProductTag, TagAuditLog, StartopWordData
from models.business_settings import BusinessSettings

_MODELS_LOADED = False


def _ensure_models_loaded():
    """独立解释器（脚本/子进程）安全网：pkgutil 动态导入全部 models。

    项目已知坑：models/__init__.py 未导出全部模型类（缺 ProductSelection 等），
    Tenant 用字符串 relationship("ProductSelection")，若独立解释器只间接注册了
    少数类，首次 ORM query 触发 mapper 全量配置即抛 InvalidRequestError。
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

# ===== FilterStatus 枚举（与《系统设计》§4.2.6 一致） =====
FILTER_KEEP = "KEEP"                                # 正常参与补货展示
FILTER_DISCONTINUED = "DISCONTINUED"                # 停售（最高优先级，K3）
FILTER_NEG_MARGIN = "NEG_MARGIN_EXCLUDED"           # 负利润排除（K1）
FILTER_HOLIDAY = "HOLIDAY_EXCLUDED"                 # 节日排除

TAG_TYPE_HOLIDAY = "holiday"
TAG_TYPE_FORCE = "force_replenish"

SOURCE_AUTO = "auto"
SOURCE_MANUAL = "manual"
SOURCE_IMPORT = "import"

# K6 冻结枚举（校验用；新增节日走 holiday_lexicon 配置，代码不硬编码扩展）
K6_HOLIDAY_NAMES = ["万圣节", "感恩节黑五", "圣诞节", "情人节", "复活节", "独立日",
                    "母亲节", "父亲节", "返校季", "PrimeDay", "其他"]

# 默认配置（BusinessSettings 缺失时回退，与 _get_daily_sales_weights 模式一致）
DEFAULT_FILTER_CONFIG = {
    "negative_margin_threshold": 0,   # K1：毛利率阈值（小于该值排除），默认 0
    "tag_window_days": 28,            # 自动打标搜索词回看窗口（天）
}


# ====================== 配置读取 ======================

def get_filter_config(db: Session) -> dict:
    """从 BusinessSettings 读取过滤/打标配置（setting_type='replenishment_filter'）"""
    try:
        setting = db.query(BusinessSettings).filter(
            BusinessSettings.setting_type == "replenishment_filter"
        ).first()
        if setting and setting.formula_config:
            cfg = json.loads(setting.formula_config)
            merged = dict(DEFAULT_FILTER_CONFIG)
            for k in merged:
                if k in cfg:
                    merged[k] = cfg[k]
            return merged
    except Exception as e:
        print(f"[tag_service] 读取过滤配置失败，回退默认: {e}")
    return dict(DEFAULT_FILTER_CONFIG)


def save_filter_config(db: Session, config: dict, operator: str = "system") -> dict:
    """保存过滤/打标配置到 BusinessSettings"""
    merged = dict(DEFAULT_FILTER_CONFIG)
    for k in merged:
        if k in config:
            merged[k] = config[k]
    setting = db.query(BusinessSettings).filter(
        BusinessSettings.setting_type == "replenishment_filter"
    ).first()
    if setting is None:
        setting = BusinessSettings(setting_type="replenishment_filter")
        db.add(setting)
    setting.formula_config = json.dumps(merged, ensure_ascii=False)
    db.commit()
    return merged


# ====================== 审计流水（同事务写入，V4 100% 覆盖） ======================

def _clip(v, limit: int = 200):
    """审计值长度护栏：列宽 String(200)。词库维度写入的是「节日:关键词」，
    关键词上限 100 字符 → 最长可达 107，旧列宽 String(20) 会被撑爆（DataError 1406）。
    这里做防御性截断，宁可审计值被截断，也不让业务写操作整体 500。"""
    if v is None:
        return None
    s = str(v)
    return s if len(s) <= limit else s[:limit]


def write_audit(db: Session, tenant_id: int, asin: str, sku: str, tag_type: str,
                action: str, old_value, new_value, source: str, operator: str,
                reason=None, trace_id=None):
    """审计流水写入：与标签变更同事务（调用方 commit），event_id 唯一兼作幂等键"""
    log = TagAuditLog(
        tenant_id=tenant_id,
        event_id=uuid.uuid4().hex,
        trace_id=trace_id,
        asin=asin or "",
        sku=sku or "",
        tag_type=tag_type,
        action=action,
        old_value=_clip(old_value),
        new_value=_clip(new_value),
        source=source,
        operator=operator or "system",
        reason=reason,
    )
    db.add(log)
    return log


# ====================== 标签读取（行级作用域 (asin, account)） ======================

WILDCARD_ACCOUNT = ""   # 空串 = 该 ASIN 的全部店铺行（存量数据与自动打标使用）


def _norm_account(account) -> str:
    return (account or "").strip()


def load_active_tags(db: Session, tenant_id: int) -> dict:
    """加载生效标签，**按行级作用域 (asin, account) 索引**。

    返回 {"force": {(asin, account)}, "holidays": {(asin, account): [values]},
          "locked": {(asin, account)}}
    - account 为空串表示**通配**：作用于该 ASIN 的全部店铺行。
    - 取行级有效标签请用 `resolve_row_tags()` / `row_is_locked()`（通配 ∪ 本行）。
    - locked：存在 active 且 locked=1 的标签（K5 人工锁定）。
    """
    _ensure_models_loaded()
    rows = db.query(ProductTag.asin, ProductTag.account, ProductTag.tag_type,
                    ProductTag.tag_value, ProductTag.locked).filter(
        ProductTag.tenant_id == tenant_id,
        ProductTag.active == 1,
        ProductTag.deleted_at.is_(None),
    ).all()
    force, holidays, locked = set(), {}, set()
    for asin, account, tag_type, tag_value, is_locked in rows:
        key = (asin, _norm_account(account))
        if is_locked:
            locked.add(key)
        if tag_type == TAG_TYPE_FORCE:
            force.add(key)
        elif tag_type == TAG_TYPE_HOLIDAY and tag_value:
            holidays.setdefault(key, []).append(tag_value)
    return {"force": force, "holidays": holidays, "locked": locked}


def resolve_row_tags(tags: dict, asin: str, account) -> dict:
    """把「通配 ∪ 本行」合并成该行的有效标签，保持 evaluate_status 的入参契约。

    返回 {"force_asins": set[asin], "holidays": {asin: [values]}}（无则缺省）。
    """
    if not tags or not asin:
        return {}
    acct = _norm_account(account)
    keys = {(asin, WILDCARD_ACCOUNT), (asin, acct)}
    out = {}
    if any(k in (tags.get("force") or set()) for k in keys):
        out["force_asins"] = {asin}
    vals = []
    holiday_map = tags.get("holidays") or {}
    for k in keys:
        for v in holiday_map.get(k, []):
            if v not in vals:
                vals.append(v)
    if vals:
        out["holidays"] = {asin: vals}
    return out


def row_is_locked(tags: dict, asin: str, account) -> bool:
    """该行是否处于人工锁定（K5）：通配或本行任一命中即锁定。"""
    if not tags or not asin:
        return False
    acct = _norm_account(account)
    locked = tags.get("locked") or set()
    return (asin, WILDCARD_ACCOUNT) in locked or (asin, acct) in locked


def _latest_snapshot_date(db: Session, tenant_id: int):
    """最新快照日（写入链路里只应查一次：全表 MAX 在 5.9 万行上约 50-100ms）。"""
    return db.query(func.max(InventorySnapshot.snapshot_date)).filter(
        InventorySnapshot.tenant_id == tenant_id
    ).scalar()


def _affected_snapshot_ids(db: Session, tenant_id: int, asin: str, accounts,
                           latest=None) -> list:
    """该 (asin, accounts) 在最新快照日的 snapshot_id 列表。

    用途：标签变更只需重算**该产品的决策行**，避免每次点击全量重算所有决策行
    （实测全量 2040ms vs 局部 7.4ms @5.9 万决策行）。
    accounts 含空串（通配）时不过滤店铺 → 该 ASIN 全部店铺行。
    """
    if not asin:
        return []
    if latest is None:
        latest = _latest_snapshot_date(db, tenant_id)
    if not latest:
        return []
    q = db.query(InventorySnapshot.id).filter(
        InventorySnapshot.tenant_id == tenant_id,
        InventorySnapshot.snapshot_date == latest,
        InventorySnapshot.deleted_at.is_(None),
        InventorySnapshot.asin == asin,
    )
    accs = [a for a in (accounts or []) if a]
    if accs and "" not in (accounts or []):
        q = q.filter(InventorySnapshot.account.in_(accs))
    return [r[0] for r in q.all()]


def _recompute_decisions(db: Session, tenant_id: int, asin: str, accounts,
                         latest=None) -> dict:
    """标签变更后的局部重算（只覆盖受影响产品的决策行）。

    找不到快照行时**跳过重算**（该 ASIN 无库存行 → 无决策行可更新），
    绝不退化为全量重算。
    """
    sids = _affected_snapshot_ids(db, tenant_id, asin, accounts, latest)
    if not sids:
        return {"updated": 0, "status_counts": {}, "scope": "none"}
    res = apply_tags_to_decisions(db, tenant_id, snapshot_ids=sids)
    res["scope"] = f"{len(sids)} snapshot rows"
    return res


def suppress_holiday_tags(db: Session, tenant_id: int, asin: str, account, operator: str,
                          reason: str = "人工取消标记") -> dict:
    """人工取消标记：清除该行适用的节日标签（通配 account='' ∪ 本行 account）。

    为什么需要它：`/restock/mark-product-status` 的 clear 只清 **快照列**
    （`inventory_snapshots.is_holiday`），而自动打标写入的节日标签在 `product_tags`
    里 —— 只清快照列时「节日标签」列仍显示节日，表现为「取消标记去不掉」。

    同时写为**人工抑制态**（active=0 + locked=1 + source=manual）：
    否则 `run_auto_tagging` 的「inactive → 复激活」分支会把人工取消的标签又加回来。
    """
    _ensure_models_loaded()
    acct = _norm_account(account)
    rows = db.query(ProductTag).filter(
        ProductTag.tenant_id == tenant_id,
        ProductTag.asin == asin,
        ProductTag.tag_type == TAG_TYPE_HOLIDAY,
        ProductTag.active == 1,
        ProductTag.account.in_([WILDCARD_ACCOUNT, acct]),
    ).all()
    if not rows:
        return {"asin": asin, "account": acct, "changed": False, "suppressed": 0}

    now = datetime.now()
    for r in rows:
        r.active = 0
        r.locked = 1          # 人工抑制：自动打标不得复激活（K5 人工优先）
        r.source = SOURCE_MANUAL
        r.deleted_at = now
        write_audit(db, tenant_id, asin, acct, TAG_TYPE_HOLIDAY, "clear",
                    r.tag_value, None, SOURCE_MANUAL, operator,
                    reason=f"{reason}（抑制自动打标复激活）")
    db.commit()
    # 局部重算：受影响的是「通配 ∪ 本行」两把键
    _recompute_decisions(db, tenant_id, asin, [WILDCARD_ACCOUNT, acct])
    return {"asin": asin, "account": acct, "changed": True, "suppressed": len(rows)}


def expand_accounts(db: Session, tenant_id: int, asin: str, account,
                    latest=None) -> list:
    """点击某行时实际要打标的 account 集合（与「停售」的展开规则一致）。

    - account 为空串（通配）→ 直接返回 [""]，本身就是全店铺。
    - 该行是汇总行（summary_flag='是'）→ 本行 + 其共享库存子行；
      其余行 → 仅本行。
    """
    acct = _norm_account(account)
    if not acct or not asin:
        return [acct]
    try:
        if latest is None:
            latest = _latest_snapshot_date(db, tenant_id)
        if not latest:
            return [acct]
        row = db.query(InventorySnapshot.summary_flag).filter(
            InventorySnapshot.tenant_id == tenant_id,
            InventorySnapshot.snapshot_date == latest,
            InventorySnapshot.deleted_at.is_(None),
            InventorySnapshot.asin == asin,
            InventorySnapshot.account == acct,
        ).first()
        accounts = {acct}
        if row and row[0] == "是":
            for (child_acct,) in db.query(InventorySnapshot.account).filter(
                InventorySnapshot.tenant_id == tenant_id,
                InventorySnapshot.snapshot_date == latest,
                InventorySnapshot.deleted_at.is_(None),
                InventorySnapshot.asin == asin,
                InventorySnapshot.summary_flag == "共享库存",
            ).all():
                if child_acct:
                    accounts.add(_norm_account(child_acct))
        return sorted(accounts)
    except Exception as e:  # noqa: BLE001
        print(f"[tag_service] expand_accounts 失败，退化为仅本行: {e}")
        return [acct]


# ====================== M4：过滤优先级引擎（K3 单一裁决入口） ======================

def evaluate_status(is_discontinued, is_holiday, gross_margin, tags, threshold) -> tuple:
    """单产品裁决（K3 优先级链）：返回 (filter_status, force_replenish)

    停售 > 强制补货 > 节日排除 > 负利润排除；
    gross_margin 为 NULL 时不误杀（K1，沿用现有空值跳过策略）。
    """
    if is_discontinued:
        return FILTER_DISCONTINUED, 0
    force = 1 if is_discontinued is False and _is_force(tags) else 0
    if force:
        return FILTER_KEEP, 1
    if _has_holiday(is_holiday, tags):
        return FILTER_HOLIDAY, 0
    if gross_margin is not None and gross_margin < threshold:
        return FILTER_NEG_MARGIN, 0
    return FILTER_KEEP, 0


def _is_force(tags) -> bool:
    return bool(tags and tags.get("force_asins"))


def _has_holiday(is_holiday, tags) -> bool:
    """节日命中判断：快照标记 OR 自动/人工节日标签（Q-2 多值：命中任一即排除）"""
    if is_holiday and str(is_holiday).strip():
        return True
    if tags and tags.get("holidays"):
        return True
    return False


def merge_holiday_values(*sources) -> str:
    """多值合并为逗号分隔串（US-6 §5.6.4④ / US-2 AC2「多值渲染（逗号分隔），页面与导出取值一致」）。

    入参可为字符串（逗号分隔或单值）或字符串集合（如 load_active_tags 的 holidays[asin]）。
    规则：去重 → 按 K6 枚举序稳定排序（枚举外值排最后）→ 逗号连接。
    快照 `is_holiday` 单值传入时排首位（其值恒为 K6 枚举内，排序后位置由枚举序决定）。
    """
    seen = []
    for src in sources:
        if src is None:
            continue
        items = list(src) if isinstance(src, (list, tuple, set)) else str(src).split(",")
        for it in items:
            v = str(it).strip()
            if v and v not in seen:
                seen.append(v)
    order = {n: i for i, n in enumerate(K6_HOLIDAY_NAMES)}
    seen.sort(key=lambda v: order.get(v, len(order)))
    return ",".join(seen)


def apply_tags_to_decisions(db: Session, tenant_id: int, snapshot_date=None,
                            snapshot_ids=None) -> dict:
    """过滤引擎批量落点：把 K3 裁决结果写入 replenishment_decisions.filter_status / force_replenish。

    计算链路照常覆盖全部产品（K2：负利润产品决策行照常落库，仅标记不展示）。
    调用时机：补货计算完成后 + 标签/词库/阈值变更后。

    Returns: {"updated": n, "status_counts": {KEEP: x, ...}}
    """
    _ensure_models_loaded()
    # 1. 定位决策行
    dq = db.query(ReplenishmentDecision).filter(
        ReplenishmentDecision.tenant_id == tenant_id,
        ReplenishmentDecision.deleted_at.is_(None),
    )
    if snapshot_ids:
        dq = dq.filter(ReplenishmentDecision.snapshot_id.in_(snapshot_ids))
    else:
        if snapshot_date is None:
            snapshot_date = db.query(func.max(InventorySnapshot.snapshot_date)).filter(
                InventorySnapshot.tenant_id == tenant_id
            ).scalar()
        if snapshot_date is None:
            return {"updated": 0, "status_counts": {}}
        dq = dq.filter(ReplenishmentDecision.snapshot_date == snapshot_date)
    decisions = dq.all()
    if not decisions:
        return {"updated": 0, "status_counts": {}}

    # 2. 快照状态（停售/节日/毛利率/店铺作用域）
    sids = [d.snapshot_id for d in decisions if d.snapshot_id]
    snap_map = {}
    if sids:
        for s in db.query(
            InventorySnapshot.id, InventorySnapshot.is_discontinued,
            InventorySnapshot.is_holiday, InventorySnapshot.gross_margin,
            InventorySnapshot.asin, InventorySnapshot.account
        ).filter(InventorySnapshot.id.in_(sids)).all():
            snap_map[s.id] = s

    # 3. 标签 + 阈值
    tags = load_active_tags(db, tenant_id)
    cfg = get_filter_config(db)
    threshold = cfg["negative_margin_threshold"]

    # 4. 逐行裁决（diff 后批量 UPDATE，减少无谓写）
    updates = []   # (filter_status, force_replenish, snapshot_id)
    status_counts = {}
    for d in decisions:
        s = snap_map.get(d.snapshot_id)
        dis = bool(s.is_discontinued) if s else False
        hol = (s.is_holiday or "") if s else ""
        gm = s.gross_margin if s else None
        # 行级标签：按 (asin, account) 解析（通配 ∪ 本行）
        asin = s.asin if s else d.asin
        acct = s.account if s else None
        row_tags = resolve_row_tags(tags, asin, acct)
        status, force = evaluate_status(dis, hol, gm, row_tags, threshold)
        status_counts[status] = status_counts.get(status, 0) + 1
        cur_status = d.filter_status or "KEEP"
        cur_force = int(d.force_replenish or 0)
        if cur_status != status or cur_force != force:
            updates.append((status, force, d.snapshot_id))

    if updates:
        # executemany 批量更新
        db.execute(
            text("UPDATE replenishment_decisions SET filter_status = :s, force_replenish = :f "
                 "WHERE snapshot_id = :sid AND tenant_id = :tid"),
            [{"s": st, "f": fc, "sid": sid, "tid": tenant_id} for st, fc, sid in updates],
        )
        db.commit()

    return {"updated": len(updates), "status_counts": status_counts}


# ====================== M3：强制补货标签（override） ======================

def set_force_replenish(db: Session, tenant_id: int, asin: str, operator: str,
                        reason: str, sku: str = "", trace_id=None,
                        account: str = "") -> dict:
    """设置强制补货标签（K3：停售产品拒绝；理由必填；审计同事务）

    行级作用域：`account` 指定店铺行（汇总行会展开到其共享库存子行）；
    `account=""` 表示该 ASIN 的全部店铺（兼容旧调用与自动打标）。
    """
    _ensure_models_loaded()
    if not reason or not str(reason).strip():
        raise ValueError("设置强制补货必须填写理由")

    # K3：停售产品不能 override（查询最新快照停售状态）
    latest = _latest_snapshot_date(db, tenant_id)
    if latest:
        dis_rows = db.query(InventorySnapshot.id).filter(
            InventorySnapshot.tenant_id == tenant_id,
            InventorySnapshot.snapshot_date == latest,
            InventorySnapshot.deleted_at.is_(None),
            InventorySnapshot.asin == asin,
            InventorySnapshot.is_discontinued == True,  # noqa: E712
        ).first()
        if dis_rows:
            raise ValueError("停售产品不能设置强制补货，请先解除停售")

    # 行级作用域：account 空串=该 ASIN 全部店铺（通配）；汇总行展开到其共享库存子行，
    # 与「停售/标记节日」的展开规则一致（用户裁定行级粒度）。
    accounts = expand_accounts(db, tenant_id, asin, account, latest=latest)
    created = 0
    for acct in accounts:
        row = db.query(ProductTag).filter(
            ProductTag.tenant_id == tenant_id,
            ProductTag.asin == asin,
            ProductTag.account == acct,
            ProductTag.tag_type == TAG_TYPE_FORCE,
        ).first()
        old_value = "1" if (row and row.active == 1) else None
        if row is None:
            db.add(ProductTag(
                tenant_id=tenant_id, asin=asin, account=acct, sku=sku or "",
                tag_type=TAG_TYPE_FORCE, tag_value="1",
                source=SOURCE_MANUAL, locked=1, active=1, reason=reason,
            ))
        else:
            row.active = 1
            row.reason = reason
            row.source = SOURCE_MANUAL
            row.locked = 1
            row.deleted_at = None
        write_audit(db, tenant_id, asin, acct or sku, TAG_TYPE_FORCE, "set",
                    old_value, "1", SOURCE_MANUAL, operator, reason=reason, trace_id=trace_id)
        created += 1

    db.commit()
    # 标签变更即时生效于决策口径（**只重算本产品的决策行**：实测 7ms vs 全量 2040ms）
    _recompute_decisions(db, tenant_id, asin, accounts, latest=latest)
    return {"asin": asin, "account": _norm_account(account),
            "accounts": accounts, "force_replenish": 1, "tagged": created}


def clear_force_replenish(db: Session, tenant_id: int, asin: str, operator: str,
                          sku: str = "", trace_id=None, account: str = "") -> dict:
    """解除强制补货标签（软删 + 审计，恢复常规过滤规则）

    **行级解除**：只影响 `account` 指定的店铺行（汇总行会展开到其共享库存子行）；
    `account=""` 表示该 ASIN 的全部店铺行（兼容旧调用）。
    """
    _ensure_models_loaded()
    latest = _latest_snapshot_date(db, tenant_id)
    accounts = expand_accounts(db, tenant_id, asin, account, latest=latest)
    rows = db.query(ProductTag).filter(
        ProductTag.tenant_id == tenant_id,
        ProductTag.asin == asin,
        ProductTag.account.in_(accounts),
        ProductTag.tag_type == TAG_TYPE_FORCE,
        ProductTag.active == 1,
    ).all()
    if not rows:
        return {"asin": asin, "account": _norm_account(account),
                "force_replenish": 0, "changed": False}

    now = datetime.now()
    for row in rows:
        row.active = 0
        row.deleted_at = now
    write_audit(db, tenant_id, asin, _norm_account(account) or sku, TAG_TYPE_FORCE, "clear",
                "1", None, SOURCE_MANUAL, operator, trace_id=trace_id)
    db.commit()
    # 局部重算（只覆盖本产品决策行）
    _recompute_decisions(db, tenant_id, asin, accounts, latest=latest)
    return {"asin": asin, "account": _norm_account(account), "force_replenish": 0,
            "changed": True, "cleared": len(rows)}


# ====================== M3：人工节日打标（K5 人工锁定） ======================

def set_holiday_tag(db: Session, tenant_id: int, asin: str, holiday_value: str,
                    operator: str, sku: str = "", trace_id=None,
                    account: str = "") -> dict:
    """人工打节日标签（K5：人工锁定优先，不被自动打标覆盖；K6 枚举校验）

    行级作用域：`account` 指定店铺行（汇总行展开到共享库存子行）；`""` = 该 ASIN 全部店铺。
    """
    _ensure_models_loaded()
    if holiday_value and holiday_value not in K6_HOLIDAY_NAMES:
        raise ValueError(f"节日名 {holiday_value} 不在 K6 枚举内，请走词库配置新增")

    latest = _latest_snapshot_date(db, tenant_id)
    accounts = expand_accounts(db, tenant_id, asin, account, latest=latest)
    created = 0
    for acct in accounts:
        row = db.query(ProductTag).filter(
            ProductTag.tenant_id == tenant_id,
            ProductTag.asin == asin,
            ProductTag.account == acct,
            ProductTag.tag_type == TAG_TYPE_HOLIDAY,
            ProductTag.tag_value == holiday_value,
        ).first()
        old_value = holiday_value if (row and row.active == 1) else None
        if row is None:
            db.add(ProductTag(
                tenant_id=tenant_id, asin=asin, account=acct, sku=sku or "",
                tag_type=TAG_TYPE_HOLIDAY, tag_value=holiday_value,
                source=SOURCE_MANUAL, locked=1, active=1,
            ))
        else:
            row.active = 1
            row.locked = 1
            row.source = SOURCE_MANUAL
            row.deleted_at = None
        write_audit(db, tenant_id, asin, acct or sku, TAG_TYPE_HOLIDAY, "set",
                    old_value, holiday_value, SOURCE_MANUAL, operator, trace_id=trace_id)
        created += 1

    db.commit()
    # 局部重算（只覆盖本产品决策行）
    _recompute_decisions(db, tenant_id, asin, accounts, latest=latest)
    return {"asin": asin, "account": _norm_account(account), "accounts": accounts,
            "holiday": holiday_value, "locked": 1, "tagged": created}


def unlock_holiday_tag(db: Session, tenant_id: int, asin: str, holiday_value: str,
                       operator: str, clear: bool = False, sku: str = "",
                       trace_id=None, account: str = "") -> dict:
    """解除人工锁定：clear=False 仅恢复自动管辖（K5），clear=True 同时清除标签

    **行级**：只影响 `account` 指定的店铺行（汇总行展开到共享库存子行）；`""` = 全部店铺。
    """
    _ensure_models_loaded()
    latest = _latest_snapshot_date(db, tenant_id)
    accounts = expand_accounts(db, tenant_id, asin, account, latest=latest)
    rows = db.query(ProductTag).filter(
        ProductTag.tenant_id == tenant_id,
        ProductTag.asin == asin,
        ProductTag.account.in_(accounts),
        ProductTag.tag_type == TAG_TYPE_HOLIDAY,
        ProductTag.tag_value == holiday_value,
    ).all()
    if not rows:
        return {"asin": asin, "account": _norm_account(account),
                "holiday": holiday_value, "changed": False}

    action = "clear" if clear else "unlock"
    now = datetime.now()
    for row in rows:
        if clear:
            row.active = 0
            row.locked = 0
            row.deleted_at = now
        else:
            row.locked = 0
            row.source = SOURCE_AUTO
    write_audit(db, tenant_id, asin, _norm_account(account) or sku, TAG_TYPE_HOLIDAY, action,
                holiday_value, None if clear else holiday_value,
                SOURCE_MANUAL, operator, trace_id=trace_id)
    db.commit()
    # 局部重算（只覆盖本产品决策行）
    _recompute_decisions(db, tenant_id, asin, accounts, latest=latest)
    return {"asin": asin, "holiday": holiday_value, "changed": True, "updated": len(rows)}


# ====================== M2：自动打标（词库匹配 + 日期窗口） ======================

def run_auto_tagging(db: Session, tenant_id: int, window_days: int = None,
                     asin_filter: str = None) -> dict:
    """自动打标批处理：搜索词 × 词库匹配 → product_tags（人工锁定保护 K5）

    - 窗口：最近 N 天（默认 28，可配置）startop_word_data
    - 匹配：contains / exact；节日日期窗口内的词库条目才生效
    - Q-2 多值：命中多个节日全部写入；节日排除语义 = 命中任一即排除（引擎侧）
    - K5：locked=1 的标签不被覆盖/清除
    """
    _ensure_models_loaded()
    cfg = get_filter_config(db)
    if window_days is None:
        window_days = int(cfg.get("tag_window_days") or 28)
    today = date.today()
    window_start = today - timedelta(days=window_days)

    # 1. 词库（启用条目）
    lexicon = db.query(HolidayLexicon).filter(
        HolidayLexicon.tenant_id == tenant_id,
        HolidayLexicon.status == 1,
        HolidayLexicon.deleted_at.is_(None),
    ).all()
    if not lexicon:
        return {"tagged": 0, "cleared": 0, "message": "词库为空"}

    # 2. 窗口内搜索词（按 asin 聚合）
    wq = db.query(
        StartopWordData.asin,
        StartopWordData.keyword,
    ).filter(
        StartopWordData.tenant_id == tenant_id,
        StartopWordData.stat_date >= window_start,
        StartopWordData.stat_date <= today,
    )
    if asin_filter:
        wq = wq.filter(StartopWordData.asin == asin_filter)
    word_rows = wq.all()
    asin_words = {}
    for asin, keyword in word_rows:
        if asin and keyword:
            asin_words.setdefault(asin, set()).add(str(keyword).lower())

    # 3. 匹配：节日 → 命中 asin 集合（含依据词）
    matched = {}   # {holiday_name: {asin: basis_word}}
    for entry in lexicon:
        # 日期窗口过滤：窗口存在且当前不在窗口内 → 本轮不生效
        if entry.window_start and entry.window_end:
            if not (entry.window_start <= today <= entry.window_end):
                continue
        kw = str(entry.keyword or "").lower()
        if not kw:
            continue
        hit_map = {}
        for asin, words in asin_words.items():
            for w in words:
                if (entry.match_type == "exact" and w == kw) or \
                   (entry.match_type != "exact" and kw in w):
                    hit_map[asin] = w
                    break
        if hit_map:
            matched.setdefault(entry.holiday_name, {}).update(hit_map)

    # 4. 写标签（diff：新增/复激活；locked=1 跳过；审计 auto_set）
    #    自动打标只管理**通配**行（account=''）：星拓搜索词按 ASIN 归因、无法区分店铺，
    #    故自动命中等同于「该 ASIN 全部店铺」；人工在具体店铺行上打的标签互不干扰。
    tagged = 0
    existing_rows = db.query(ProductTag).filter(
        ProductTag.tenant_id == tenant_id,
        ProductTag.tag_type == TAG_TYPE_HOLIDAY,
        ProductTag.account == WILDCARD_ACCOUNT,
    ).all()
    existing_map = {(r.asin, r.tag_value): r for r in existing_rows}

    for holiday_name, asin_map in matched.items():
        for asin, basis in asin_map.items():
            row = existing_map.get((asin, holiday_name))
            if row is not None and row.active == 1:
                if row.locked == 1:
                    continue  # K5：人工锁定优先
                # 已生效：仅更新依据词
                basis_json = json.dumps({"keyword": basis, "stat_date": today.isoformat()},
                                        ensure_ascii=False)
                if row.match_basis != basis_json:
                    row.match_basis = basis_json
                continue
            if row is None:
                row = ProductTag(
                    tenant_id=tenant_id, asin=asin, account=WILDCARD_ACCOUNT, sku="",
                    tag_type=TAG_TYPE_HOLIDAY, tag_value=holiday_name,
                    source=SOURCE_AUTO, locked=0, active=1,
                    match_basis=json.dumps({"keyword": basis, "stat_date": today.isoformat()},
                                           ensure_ascii=False),
                )
                db.add(row)
                existing_map[(asin, holiday_name)] = row
            else:
                # inactive → 复激活。**但人工抑制过的不复激活**（locked=1）：
                # 用户在库存页点过「取消标记」，自动打标不得把它加回来（K5 人工优先）；
                # 否则「取消标记」会在下一轮自动打标后复原，表现为「去不掉」。
                if row.locked == 1:
                    continue
                row.active = 1
                row.locked = 0
                row.source = SOURCE_AUTO
                row.deleted_at = None
                row.match_basis = json.dumps({"keyword": basis, "stat_date": today.isoformat()},
                                             ensure_ascii=False)
            write_audit(db, tenant_id, asin, "", TAG_TYPE_HOLIDAY, "auto_set",
                        None, holiday_name, SOURCE_AUTO, "system",
                        reason=f"搜索词命中：{basis}")
            tagged += 1

    # 5. auto_clear：auto 来源且未锁定、本轮未命中、且该节日在窗口内（避免窗口外误清）
    cleared = 0
    active_auto_tags = [r for r in existing_rows
                        if r.active == 1 and r.source == SOURCE_AUTO and r.locked == 0]
    for row in active_auto_tags:
        if row.tag_value in matched and row.asin in matched[row.tag_value]:
            continue
        lex_entry = next((e for e in lexicon if e.holiday_name == row.tag_value), None)
        if lex_entry and lex_entry.window_start and lex_entry.window_end:
            if not (lex_entry.window_start <= today <= lex_entry.window_end):
                continue  # 窗口外不判定清除
        row.active = 0
        row.deleted_at = datetime.now()
        write_audit(db, tenant_id, row.asin, "", TAG_TYPE_HOLIDAY, "auto_clear",
                    row.tag_value, None, SOURCE_AUTO, "system",
                    reason="窗口内搜索词不再命中")
        cleared += 1

    db.commit()
    # 6. 标签变更 → 决策口径刷新
    apply_tags_to_decisions(db, tenant_id)
    return {"tagged": tagged, "cleared": cleared,
            "window_days": window_days, "asins_scanned": len(asin_words)}


# 允许在函数内引用（避免循环导入写法问题）：startop 词表别名
# （StartopWordData 已在文件头部导入，此处无需重复导入）


# ====================== 试算预览（US-8 AC3：只读，不落标签） ======================

def preview_match(db: Session, tenant_id: int, asin: str = None,
                  keywords: list = None) -> dict:
    """匹配试算预览：输入产品或词样本 → 输出将命中的节日标签与依据词（不产生任何变更）"""
    _ensure_models_loaded()
    today = date.today()
    lexicon = db.query(HolidayLexicon).filter(
        HolidayLexicon.tenant_id == tenant_id,
        HolidayLexicon.status == 1,
        HolidayLexicon.deleted_at.is_(None),
    ).all()

    if keywords is None and asin:
        window_start = today - timedelta(days=int(get_filter_config(db)["tag_window_days"]))
        rows = db.query(StartopWordData.keyword).filter(
            StartopWordData.tenant_id == tenant_id,
            StartopWordData.asin == asin,
            StartopWordData.stat_date >= window_start,
            StartopWordData.stat_date <= today,
        ).all()
        keywords = [r[0] for r in rows]

    words = [str(k).lower() for k in (keywords or []) if k]
    hits = []
    for entry in lexicon:
        if entry.window_start and entry.window_end:
            if not (entry.window_start <= today <= entry.window_end):
                continue
        kw = str(entry.keyword or "").lower()
        if not kw:
            continue
        basis = next((w for w in words
                      if (entry.match_type == "exact" and w == kw) or
                      (entry.match_type != "exact" and kw in w)), None)
        if basis:
            hits.append({"holiday": entry.holiday_name, "keyword": entry.keyword,
                         "matched_word": basis, "match_type": entry.match_type})
    return {"asin": asin, "words_scanned": len(words), "hits": hits,
            "holidays": sorted({h["holiday"] for h in hits})}
