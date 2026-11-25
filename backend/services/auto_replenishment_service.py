#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动补货：库存机器人最新快照决策 → 进销存补货单（按店铺分组拆单）

口径（单一真源，不重复实现补货规则）：
- 只取 filter_status='KEEP' AND suggest_qty>0 的决策行（负利润 K1 / 节日 / 停售已被
  补货计算排除；force_replenish 标签行由 override 保持 KEEP）。
- summary_flag='0'（单店铺库存池）与 '是'（共享库存汇总行）代表不同库存池，均取且互不重复
  （实测汇总行的成员店铺不会再有独立 '0' 行）。
- 数据权限：非 admin 按 user_stores 可见店铺隔离（与库存列表同一份 visible_store_names 口径）；
  合并行（account='A、B'）按成员精确匹配，比 LIKE 子串更严。admin 不隔离。
- product_id：ASIN 主匹配 products，SKU 经 platform_products 兜底（与 AI 补货同源）。
  匹配不到的行跳过并回显（replenishment_items.product_id 为非空外键，禁止写 NULL）。
- 店铺分组：account 按顿号拆分 → stores.inventory_name 匹配 → 成员组唯一则归该组，
  否则 store_group_id=NULL（未分组单）；group_ids 可只补选中分组（0 代表未分组）。
- 聚合：同组内按 product_id 合并 SUM(建议量)，避免同品多行重复采购。
- 增量：skip_existing=True 时排除已在「待审批/已审批」补货单中的 product_id（含配件行），
  重复点击只补新增，避免重复采购。
- 配件：product_bindings 展开，parent_product_id 记录来源成品（与 AI 补货一致）。
- 防重：notes 以 auto:{snapshot_date}: 开头标记批次；skip_existing=False 且同批次已有自动单时
  返回 need_confirm 供二次确认；scheduler_locks 分布式锁防并发双击。
"""
import logging
import math
import time
from collections import OrderedDict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import bindparam, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from utils.order_number import generate_replenishment_order_number

logger = logging.getLogger(__name__)

AUTO_NOTE_PREFIX = "auto:"
MAX_ITEMS_PER_RUN = 5000        # 单次生成明细总数（含配件）防呆上限
MAX_BINDINGS_PER_PRODUCT = 50   # 单成品配件展开上限（防脏绑定数据爆明细）
MAX_SKIPPED_RETURNED = 50       # 返回给前端的跳过清单条数上限（防 payload 过大）
CHUNK_SIZE = 1000               # IN 条件分批大小（2300 ASIN ≈ 3 次往返）
PREVIEW_CACHE_TTL = 300         # 预检结果缓存秒数：重复打开/切开关秒开
PREVIEW_CACHE_MAX = 128         # LRU 容量（按用户×租户×快照×开关，超限淘汰最久未用）
RUN_LOCK_MINUTES = 30           # 运行锁超时：须大于一次大批量生成耗时（24 组约 2400 明细）
# 缓存只存「统计摘要」：skipped 明细（可达数百行）不进内存，避免 128 条 × 大 payload 撑爆进程
_PREVIEW_CACHE: "OrderedDict[tuple, Tuple[float, Dict[str, Any]]]" = OrderedDict()
UNGROUPED_ID = 0                # 前端「未分组」选项的虚拟组 ID（映射回 DB 的 NULL）

# 视为「占用中」的补货单状态（用户口径：仅待审批 + 已审批；已采购允许再补）
OCCUPIED_STATUSES = ("pending", "approved")


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------

def _acquire_run_lock(db: Session, tenant_id: int) -> bool:
    """运行级互斥锁（scheduler_locks 表，跨连接带过期）；拿不到说明有并发生成"""
    from services.scheduler import acquire_distributed_lock  # 函数内 import 便于测试替换

    return acquire_distributed_lock(db, f"auto_replenishment:{tenant_id}",
                                    timeout_minutes=RUN_LOCK_MINUTES)


def _release_run_lock(db: Session, tenant_id: int) -> None:
    try:
        from services.scheduler import release_distributed_lock

        release_distributed_lock(db, f"auto_replenishment:{tenant_id}")
    except Exception as e:  # noqa: BLE001
        logger.warning("自动补货锁释放失败（将由过期时间兜底）: %s", e)


def _latest_snapshot_date(db: Session, tenant_id: int) -> Optional[Any]:
    return db.execute(text(
        "SELECT MAX(snapshot_date) FROM inventory_snapshots "
        "WHERE tenant_id = :tid AND deleted_at IS NULL"
    ), {"tid": tenant_id}).scalar()


def _split_members(account: str) -> List[str]:
    """account 可能是多店铺合并串（顿号/逗号分隔）"""
    s = (account or "").strip()
    if not s:
        return []
    parts = [m.strip() for m in s.replace("，", "、").replace(",", "、").split("、") if m.strip()]
    return parts or [s]


def _account_matches(account: str, allowed_upper: Set[str]) -> bool:
    """合并行任一成员在可见店铺集合内即视为可见（精确成员匹配，比 LIKE 子串更严）"""
    return any(m.upper() in allowed_upper for m in _split_members(account))


def _collect_decision_rows(db: Session, tenant_id: int, snapshot_date,
                           allowed_stores: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """最新快照下 KEEP 且建议数量>0 的行；按可见店铺在 Python 层过滤（避免 LIKE 转义问题）"""
    if allowed_stores is not None and not allowed_stores:
        return []
    rows = db.execute(text("""
        SELECT d.asin, d.sku, d.account, d.country, d.suggest_qty, d.summary_flag
        FROM replenishment_decisions d
        JOIN inventory_snapshots s ON s.id = d.snapshot_id
        WHERE s.tenant_id = :tid AND s.deleted_at IS NULL
          AND d.tenant_id = :tid AND d.deleted_at IS NULL
          AND s.snapshot_date = :sd
          AND d.filter_status = 'KEEP' AND d.suggest_qty > 0
    """), {"tid": tenant_id, "sd": snapshot_date}).fetchall()
    items = [
        {
            "asin": str(r[0] or "").strip(),
            "sku": str(r[1] or "").strip(),
            "account": str(r[2] or "").strip(),
            "country": str(r[3] or ""),
            "suggest_qty": float(r[4] or 0),
        }
        for r in rows
    ]
    if allowed_stores is not None:
        allowed_upper = {n.upper() for n in allowed_stores if n}
        items = [r for r in items if _account_matches(r["account"], allowed_upper)]
    return items


def _existing_auto_orders(db: Session, tenant_id: int, snapshot_date) -> List[Dict[str, Any]]:
    """同快照批次已生成的自动补货单（notes 以 auto:{date} 开头；date 不含 LIKE 通配符）"""
    rows = db.execute(text("""
        SELECT id, order_number, store_group_id, notes, created_at
        FROM replenishment_orders
        WHERE tenant_id = :tid AND deleted_at IS NULL
          AND notes LIKE :prefix
        ORDER BY id DESC
    """), {"tid": tenant_id, "prefix": f"{AUTO_NOTE_PREFIX}{snapshot_date}:%"}).fetchall()
    return [
        {
            "id": r[0], "order_number": r[1], "store_group_id": r[2],
            "notes": r[3], "created_at": str(r[4]) if r[4] else None,
        }
        for r in rows
    ]


def _occupied_product_ids(db: Session, tenant_id: int) -> Set[int]:
    """已在「待审批/已审批」补货单中的 product_id（含配件行），用于增量补货去重"""
    rows = db.execute(text("""
        SELECT DISTINCT ri.product_id
        FROM replenishment_items ri
        JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id
        WHERE ri.tenant_id = :tid AND ri.deleted_at IS NULL
          AND ro.tenant_id = :tid AND ro.deleted_at IS NULL
          AND ro.status IN ('pending', 'approved')
    """), {"tid": tenant_id}).fetchall()
    return {int(r[0]) for r in rows if r[0] is not None}


def _chunked_in(db: Session, sql: str, params: Dict[str, Any], key: str, values: List) -> List:
    """expanding IN 分批执行；空列表直接返回空"""
    if not values:
        return []
    stmt = text(sql).bindparams(bindparam(key, expanding=True))
    out: List = []
    for i in range(0, len(values), CHUNK_SIZE):
        out.extend(db.execute(stmt, {**params, key: tuple(values[i:i + CHUNK_SIZE])}).fetchall())
    return out


def _resolve_product_id_map(db: Session, tenant_id: int,
                            asins: List[str], skus: List[str]) -> Dict[str, int]:
    """ASIN 主匹配 products + SKU 经 platform_products 兜底；键统一 upper(strip)"""
    result: Dict[str, int] = {}
    asin_list = sorted({a.upper() for a in asins if a})
    for asin, pid in _chunked_in(
        db,
        "SELECT asin, id FROM products "
        "WHERE tenant_id = :tid AND deleted_at IS NULL AND asin IN :asins",
        {"tid": tenant_id}, "asins", asin_list,
    ):
        if pid is not None and str(asin).strip():
            result.setdefault(str(asin).strip().upper(), pid)

    sku_list = sorted({s.upper() for s in skus if s})
    for sku, pid in _chunked_in(
        db,
        "SELECT pp.sku, pp.product_id FROM platform_products pp "
        "WHERE pp.tenant_id = :tid AND pp.deleted_at IS NULL AND pp.sku IN :skus",
        {"tid": tenant_id}, "skus", sku_list,
    ):
        if pid is not None and str(sku).strip():
            result.setdefault(str(sku).strip().upper(), pid)
    return result


def _store_group_map(db: Session, tenant_id: int) -> Dict[str, Optional[int]]:
    """库存店铺名 → 店铺分组（stores.inventory_name 为与库存快照 account 匹配的官方字段）"""
    rows = db.execute(text(
        "SELECT inventory_name, group_id FROM stores "
        "WHERE tenant_id = :tid AND deleted_at IS NULL AND inventory_name IS NOT NULL"
    ), {"tid": tenant_id}).fetchall()
    return {str(r[0]).strip().upper(): r[1] for r in rows if str(r[0] or "").strip()}


def _group_names(db: Session, tenant_id: int) -> Dict[int, str]:
    rows = db.execute(text(
        "SELECT id, name FROM store_groups WHERE tenant_id = :tid AND deleted_at IS NULL"
    ), {"tid": tenant_id}).fetchall()
    return {r[0]: r[1] for r in rows}


def _resolve_group_id(account: str, group_map: Dict[str, Optional[int]]) -> Optional[int]:
    """account（可能顿号合并多店铺）→ 成员店铺组；成员组唯一才归组，否则未分组"""
    members = _split_members(account)
    if not members:
        return None
    group_ids = {group_map.get(m.upper()) for m in members}
    group_ids.discard(None)
    if len(group_ids) == 1:
        return group_ids.pop()
    return None


def _group_key(gid: Optional[int]) -> int:
    return UNGROUPED_ID if gid is None else int(gid)


def _aggregate_by_group(rows: List[Dict[str, Any]], product_map: Dict[str, int],
                        group_map: Dict[str, Optional[int]],
                        skip_pids: Optional[Set[int]] = None,
                        ) -> Tuple[Dict[Any, Dict[int, Dict[str, Any]]], List[Dict[str, Any]], int]:
    """按 (分组, product) 聚合建议量；返回 (grouped, 未匹配行, 因已存在而跳过的行数)"""
    grouped: Dict[Any, Dict[int, Dict[str, Any]]] = {}
    skipped: List[Dict[str, Any]] = []
    skipped_existing = 0
    skip_pids = skip_pids or set()
    for r in rows:
        pid = product_map.get(r["asin"].upper())
        if pid is None:
            pid = product_map.get(r["sku"].upper())
        if pid is None:
            skipped.append(r)
            continue
        if pid in skip_pids:
            skipped_existing += 1
            continue
        gid = _resolve_group_id(r["account"], group_map)
        qty = max(1, math.ceil(r["suggest_qty"]))  # 建议量向上取整且至少 1
        bucket = grouped.setdefault(gid, {})
        if pid in bucket:
            bucket[pid]["quantity"] += qty
            bucket[pid]["accounts"].add(r["account"])
        else:
            bucket[pid] = {"quantity": qty, "asin": r["asin"], "accounts": {r["account"]}}
    return grouped, skipped, skipped_existing


def _load_bindings(db: Session, tenant_id: int,
                   product_ids: Iterable[int]) -> Dict[int, List[Tuple[int, int]]]:
    """成品 → [(配件product_id, 每件倍数)]；超上限的成品忽略配件并记日志

    注意：product_bindings 表没有 tenant_id 列（实测），租户安全由上游
    products 查询已限定 tenant_id 的 product_id 保证。
    """
    rows = _chunked_in(
        db,
        "SELECT finished_product_id, accessory_product_id, quantity FROM product_bindings "
        "WHERE deleted_at IS NULL AND finished_product_id IN :fids",
        {}, "fids", sorted({int(p) for p in product_ids}),
    )
    mapping: Dict[int, List[Tuple[int, int]]] = {}
    for fid, aid, qty in rows:
        if fid is None or aid is None:
            continue
        lst = mapping.setdefault(int(fid), [])
        if len(lst) >= MAX_BINDINGS_PER_PRODUCT:
            logger.warning("成品 %s 配件绑定超过 %d 条，忽略多余绑定", fid, MAX_BINDINGS_PER_PRODUCT)
            continue
        lst.append((int(aid), max(1, int(qty or 1))))
    return mapping


def _visible_store_list(db: Session, tenant_id: int, user_id: int, user_role: str):
    """与库存列表同一份可见店铺口径：None=不隔离(admin)，[]=无可见店铺"""
    from services.inventory_service import visible_store_names  # 函数内 import，避免循环依赖

    return visible_store_names(db, tenant_id, user_id, user_role)


def _plan(db: Session, tenant_id: int, user_id: int, user_role: str,
          snapshot_date, allowed_stores: Optional[List[str]],
          group_ids: Optional[List[int]], skip_existing: bool,
          ) -> Dict[str, Any]:
    """取数 + 匹配 + 聚合 + 分组筛选（preview 与真实生成共用，保证两者口径一致）"""
    rows = _collect_decision_rows(db, tenant_id, snapshot_date, allowed_stores)
    product_map = _resolve_product_id_map(
        db, tenant_id, [r["asin"] for r in rows], [r["sku"] for r in rows],
    )
    group_map = _store_group_map(db, tenant_id)
    skip_pids = _occupied_product_ids(db, tenant_id) if skip_existing else set()
    grouped, skipped_unmatched, skipped_existing = _aggregate_by_group(
        rows, product_map, group_map, skip_pids,
    )

    # 分组筛选（group_ids=None 表示全选；UNGROUPED_ID 映射回 None）
    if group_ids is not None:
        wanted = {int(g) for g in group_ids}
        grouped = {gid: bucket for gid, bucket in grouped.items()
                   if _group_key(gid) in wanted}

    all_pids = [pid for bucket in grouped.values() for pid in bucket.keys()]
    bindings_map = _load_bindings(db, tenant_id, all_pids)
    item_count = sum(
        len(bucket) + sum(len(bindings_map.get(pid, [])) for pid in bucket.keys())
        for bucket in grouped.values()
    )
    return {
        "rows": rows,
        "grouped": grouped,
        "bindings_map": bindings_map,
        "skipped_unmatched": skipped_unmatched,
        "skipped_existing": skipped_existing,
        "item_count": item_count,
        "group_map": group_map,
    }


def _group_stats(grouped: Dict[Any, Dict[int, Dict[str, Any]]],
                 names: Dict[int, str],
                 bindings_map: Optional[Dict[int, List[Tuple[int, int]]]] = None,
                 ) -> List[Dict[str, Any]]:
    """每组统计（含配件按今日绑定展开后的明细数），供前端本地求和，避免每次勾选都请求后端"""
    bindings_map = bindings_map or {}
    stats = []
    for gid, bucket in grouped.items():
        stats.append({
            "id": _group_key(gid),
            "name": names.get(gid, "未分组") if gid is not None else "未分组",
            "products": len(bucket),
            "rows": len(bucket),
            "items": len(bucket) + sum(len(bindings_map.get(pid, [])) for pid in bucket.keys()),
            "qty": sum(int(i["quantity"]) for i in bucket.values()),
        })
    stats.sort(key=lambda x: (-x["products"], x["id"]))
    return stats


def _with_retry(db: Session, fn):
    """只读查询遇到连接失效（MySQL 2006/2013）时重建连接重试一次（网络抖动兜底）"""
    try:
        return fn()
    except OperationalError as e:
        code = getattr(getattr(e, "orig", None), "args", [None])[0]
        if code not in (2006, 2013):
            raise
        logger.warning("自动补货预检连接失效(%s)，重建连接后重试一次", code)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return fn()


# ---------------------------------------------------------------------------
# 对外入口
# ---------------------------------------------------------------------------

def _cache_get(key: tuple) -> Optional[Dict[str, Any]]:
    item = _PREVIEW_CACHE.get(key)
    if not item:
        return None
    expire_at, payload = item
    if expire_at < time.time():
        _PREVIEW_CACHE.pop(key, None)
        return None
    _PREVIEW_CACHE.move_to_end(key)  # LRU：命中后置为最近使用
    return payload


def _slim_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """缓存前瘦身：去掉 skipped 明细（只保留计数），避免单条 payload 达数百 KB"""
    slim = dict(payload)
    if isinstance(slim.get("skipped"), list):
        slim["skipped"] = []
    return slim


def _cache_set(key: tuple, payload: Dict[str, Any]) -> None:
    _PREVIEW_CACHE[key] = (time.time() + PREVIEW_CACHE_TTL, _slim_payload(payload))
    _PREVIEW_CACHE.move_to_end(key)
    while len(_PREVIEW_CACHE) > PREVIEW_CACHE_MAX:
        _PREVIEW_CACHE.popitem(last=False)  # 只淘汰最久未用，不再 clear() 全清


def _invalidate_preview_cache(tenant_id: int) -> None:
    """生成补货单后清租户缓存，避免下次预览仍显示旧占用数"""
    for k in [k for k in _PREVIEW_CACHE if k[0] == tenant_id]:
        _PREVIEW_CACHE.pop(k, None)


def preview_auto_replenishment(db: Session, tenant_id: int, user_id: int, user_role: str,
                               group_ids: Optional[List[int]] = None,
                               skip_existing: bool = True) -> Dict[str, Any]:
    """预检（只读）：分组统计 + 跳过数 + 预计单数/明细数

    - 结果按 (tenant, user, 快照日, skip_existing) 缓存 5 分钟：重复打开/切开关秒开
    - group_ids 不参与统计口径（前端按分组本地求和），保留参数仅为兼容
    - 连接抖动（MySQL 2006/2013）自动重试一次
    """
    snapshot_date = _latest_snapshot_date(db, tenant_id)
    cache_key = (tenant_id, user_id, str(snapshot_date), bool(skip_existing))
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    payload = _with_retry(
        db,
        lambda: _preview_once(db, tenant_id, user_id, user_role, None, skip_existing),
    )
    if payload.get("success") and payload.get("snapshot_date") == str(snapshot_date):
        _cache_set(cache_key, payload)
    return payload


def _preview_once(db: Session, tenant_id: int, user_id: int, user_role: str,
                  group_ids: Optional[List[int]] = None,
                  skip_existing: bool = True) -> Dict[str, Any]:
    """预检实现（单次）：可选分组及行数、跳过数、预计单数/明细数，供前端确认弹窗展示"""
    snapshot_date = _latest_snapshot_date(db, tenant_id)
    if not snapshot_date:
        return {"success": False, "message": "没有可用的库存快照，请先导入库存数据"}
    allowed_stores = _visible_store_list(db, tenant_id, user_id, user_role)
    if allowed_stores is not None and not allowed_stores:
        return {"success": False, "message": "当前账号未绑定任何店铺，无法生成补货单，请联系管理员分配店铺"}

    names = _group_names(db, tenant_id)
    base = _plan(db, tenant_id, user_id, user_role, snapshot_date, allowed_stores,
                 None, skip_existing)  # 先看全部可见组的分布
    visible_groups = _group_stats(base["grouped"], names, base["bindings_map"])
    selected = group_ids if group_ids is not None else [g["id"] for g in visible_groups]
    selected_set = {int(g) for g in selected}
    grouped_sel = {gid: bucket for gid, bucket in base["grouped"].items()
                   if _group_key(gid) in selected_set}
    item_count = sum(
        len(bucket) + sum(len(base["bindings_map"].get(pid, [])) for pid in bucket.keys())
        for bucket in grouped_sel.values()
    )
    return {
        "success": True,
        "snapshot_date": str(snapshot_date),
        "visible_groups": visible_groups,
        "selected_group_ids": sorted(selected_set),
        "estimated_orders": len(grouped_sel),
        "estimated_items": item_count,
        "estimated_products": sum(len(b) for b in grouped_sel.values()),
        "total_qty": sum(int(i["quantity"]) for b in grouped_sel.values() for i in b.values()),
        "skipped_existing": base["skipped_existing"],
        "skipped_unmatched": len(base["skipped_unmatched"]),
        "unmatched_sample": [s["asin"] for s in base["skipped_unmatched"][:5]],
        "skipped_sample": [s["asin"] for s in base["skipped_unmatched"][:MAX_SKIPPED_RETURNED]],
        "exists_auto_orders": bool(_existing_auto_orders(db, tenant_id, snapshot_date)),
    }


def _generate_unique_number(used: set) -> str:
    """生成批内不重复的单号；跨请求的唯一性由唯一索引 + IntegrityError 换号重试兜底"""
    num = generate_replenishment_order_number()
    while num in used:
        time.sleep(0.002)
        num = generate_replenishment_order_number()
    used.add(num)
    return num


def run_auto_replenishment(db: Session, tenant_id: int, user_id: int,
                           user_role: str = "admin",
                           group_ids: Optional[List[int]] = None,
                           skip_existing: bool = True,
                           force: bool = False) -> Dict[str, Any]:
    """主入口：预检同口径 → 单事务写入进销存（按店铺分组拆单）

    - user_role='admin' 不隔离店铺；其他角色按 user_stores 可见店铺取数
    - group_ids=None 全选可见组；UNGROUPED_ID(0) 代表未分组单
    - skip_existing=True 增量补货（排除 pending/approved 单中的 product_id）
    - skip_existing=False 且同批次已有自动单 → need_confirm（force=True 跳过确认）
    """
    if not _acquire_run_lock(db, tenant_id):
        return {"success": False, "message": "已有自动补货正在生成，请稍后再试"}
    try:
        snapshot_date = _latest_snapshot_date(db, tenant_id)
        if not snapshot_date:
            return {"success": False, "message": "没有可用的库存快照，请先导入库存数据"}
        allowed_stores = _visible_store_list(db, tenant_id, user_id, user_role)
        if allowed_stores is not None and not allowed_stores:
            return {"success": False, "message": "当前账号未绑定任何店铺，无法生成补货单"}

        if not skip_existing and not force:
            existing = _existing_auto_orders(db, tenant_id, snapshot_date)
            if existing:
                return {"success": True, "need_confirm": True,
                        "snapshot_date": str(snapshot_date), "existing_orders": existing}

        plan = _plan(db, tenant_id, user_id, user_role, snapshot_date, allowed_stores,
                     group_ids, skip_existing)
        grouped = plan["grouped"]
        if not grouped:
            hint = "全部待补行都匹配不到产品档案" if plan["skipped_unmatched"] else \
                   "选中分组内没有待补行（或相关产品已在补货单中）"
            return {"success": False, "message": f"没有可写入的补货明细：{hint}",
                    "skipped_unmatched_count": len(plan["skipped_unmatched"]),
                    "skipped_existing_count": plan["skipped_existing"]}

        total_items = plan["item_count"]
        if total_items > MAX_ITEMS_PER_RUN:
            return {"success": False,
                    "message": f"本次预计生成 {total_items} 条明细，超过单次上限 {MAX_ITEMS_PER_RUN}，"
                               f"请减少勾选分组或先在补货单中处理已存在产品"}

        bindings_map = plan["bindings_map"]
        names = _group_names(db, tenant_id)
        used_numbers: set = set()
        orders_result: List[Dict[str, Any]] = []
        try:
            for gid in sorted(grouped.keys(), key=lambda x: (_group_key(x),)):
                bucket = grouped[gid]
                order_number = _generate_unique_number(used_numbers)
                item_count = len(bucket) + sum(len(bindings_map.get(pid, [])) for pid in bucket.keys())
                total_qty = sum(item["quantity"] for item in bucket.values())
                note = (f"{AUTO_NOTE_PREFIX}{snapshot_date}: 自动补货 {item_count} 条明细 "
                        f"(成品 {len(bucket)} 件/{total_qty} 件) · 分组[{names.get(gid, '未分组') if gid is not None else '未分组'}]")
                now = datetime.now()
                # 唯一索引 uk_replenishment_orders_tenant_number 兜底：撞号则换号重试。
                # 用 savepoint 包住单条 INSERT，回滚只影响这一条，不牵连已插入的其他单。
                order_id = None
                for _ in range(5):
                    try:
                        with db.begin_nested():
                            res = db.execute(text("""
                                INSERT INTO replenishment_orders
                                    (tenant_id, order_number, store_group_id, platform, status, notes,
                                     created_by, created_at, updated_at)
                                VALUES (:tid, :num, :gid, 'amazon', 'pending', :notes, :uid, :now, :now2)
                            """), {"tid": tenant_id, "num": order_number, "gid": gid, "notes": note,
                                   "uid": user_id, "now": now, "now2": now})
                        order_id = res.lastrowid  # pymysql / sqlite3 均返回自增主键
                        break
                    except IntegrityError:
                        logger.warning("补货单号冲突，换号重试: tenant=%s num=%s",
                                       tenant_id, order_number)
                        order_number = _generate_unique_number(used_numbers)
                if not order_id:
                    raise RuntimeError("补货单号连续冲突，请稍后重试")

                count = 0
                for pid, item in bucket.items():
                    qty = item["quantity"]
                    accounts = "、".join(sorted(a for a in item["accounts"] if a)) or item["asin"]
                    db.execute(text("""
                        INSERT INTO replenishment_items
                            (tenant_id, replenishment_order_id, product_id, quantity, notes,
                             created_at, updated_at)
                        VALUES (:tid, :oid, :pid, :qty, :notes, :now, :now2)
                    """), {"tid": tenant_id, "oid": order_id, "pid": pid, "qty": qty,
                           "notes": f"自动补货 · ASIN {item['asin']} · {accounts}", "now": now, "now2": now})
                    count += 1
                    for aid, base_qty in bindings_map.get(pid, []):
                        db.execute(text("""
                            INSERT INTO replenishment_items
                                (tenant_id, replenishment_order_id, product_id, parent_product_id,
                                 quantity, notes, created_at, updated_at)
                            VALUES (:tid, :oid, :pid, :parent, :qty, :notes, :now, :now2)
                        """), {"tid": tenant_id, "oid": order_id, "pid": aid, "parent": pid,
                               "qty": qty * base_qty,
                               "notes": f"自动补货配件 · 来源成品ID {pid}", "now": now, "now2": now})
                        count += 1

                orders_result.append({
                    "id": order_id, "order_number": order_number,
                    "group_id": _group_key(gid),
                    "group_name": names.get(gid, "未分组") if gid is not None else "未分组",
                    "item_count": count, "total_qty": total_qty,
                })

            db.commit()
            _invalidate_preview_cache(tenant_id)
            logger.info("自动补货完成: tenant=%s snapshot=%s orders=%s rows=%s "
                        "skipped_unmatched=%s skipped_existing=%s",
                        tenant_id, snapshot_date, len(orders_result), len(plan["rows"]),
                        len(plan["skipped_unmatched"]), plan["skipped_existing"])
            return {
                "success": True,
                "snapshot_date": str(snapshot_date),
                "row_count": len(plan["rows"]),
                "orders": orders_result,
                "skipped": plan["skipped_unmatched"][:MAX_SKIPPED_RETURNED],
                "skipped_count": len(plan["skipped_unmatched"]),
                "skipped_existing_count": plan["skipped_existing"],
            }
        except Exception:
            db.rollback()
            raise
    except Exception as e:
        logger.error("自动补货失败: tenant=%s %s", tenant_id, e, exc_info=True)
        return {"success": False, "message": f"自动补货失败: {e}"}
    finally:
        _release_run_lock(db, tenant_id)
