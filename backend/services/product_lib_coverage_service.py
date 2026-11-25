#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""产品库覆盖度：找出「有销量但产品库无此产品」的库存行

背景（2026-11-13 正式库实测，详见 docs/plans/2026-11-13_..._coding文档.md）：
- `products.asin` 仅 4 行非空（测试数据）、`products.sku` 全空、`products.product_code`
  是 `BXHS-CP-00001` 这类系统编码 → 三者与库存快照的 SKU/ASIN 命中率均为 0%
- 唯一有效关联是 `platform_products.sku`（92.5%）∪ `platform_products.asin`（合计 93.1%）
- `products.name` ↔ `snapshot.product_name` 命中 97.5%，但一名多品极严重
  （单个品名最多对应 269 个产品），只能做「问题分类」提示，不能做存在性判定

性能约束：`NOT EXISTS (... UPPER(TRIM(pp.sku)) = UPPER(TRIM(s.sku)) ...)` 这类相关子查询
在本库会超时（1.4 万行 × 7 万映射逐行函数计算，实测被中断）。因此采用
「产品库键集合一次拉取（TTL 缓存） + 内存比对 + 未收录 id 回注」的方案：
只有 2~3 条简单 SQL，未收录 id 规模小（默认口径约 659），回注 `IN (...)` 无参数爆炸风险。

口径约定（与 coding 文档 §2.2 一致）：
- 生效快照：调用方传入 latest（通常 MAX(snapshot_date)）
- 有销量：`sales_{window}d > min_sales`，默认 window=30 / min_sales=0
- 主行：排除 `summary_flag='共享库存'` 子行（与页面展示口径一致）
- 已收录：快照 sku（按 、,; 拆分后任一段）或 asin 命中 platform_products 的 sku/asin
- 分类：品名唯一命中 → 疑似缺平台SKU映射；一名多品 → 品名歧义待确认；不命中 → 疑似未建档
"""

import logging
import re
import threading
import time
from typing import Dict, List, Optional, Set

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models.restock import InventorySnapshot

logger = logging.getLogger(__name__)

# 可选的销量窗口（天） → 快照列名
SALES_WINDOW_FIELDS = {
    7: "sales_7d",
    14: "sales_14d",
    30: "sales_30d",
    60: "sales_60d",
    90: "sales_90d",
}
DEFAULT_SALES_WINDOW = 30

# 产品库键集合缓存：产品库变更不频繁，5 分钟 TTL 足够；列表/概览共用
KEYS_CACHE_TTL_SECONDS = 300
# 覆盖度结果缓存（同一快照日 + 同一口径），避免概览与列表同一页各算一遍
RESULT_CACHE_TTL_SECONDS = 60

# 问题分类（与前端 Tag / 导出列一一对应）
ISSUE_MISSING_MAPPING = "疑似缺平台SKU映射"
ISSUE_NOT_CREATED = "疑似未建档"
ISSUE_NAME_AMBIGUOUS = "品名歧义待确认"

ACTION_BY_ISSUE = {
    ISSUE_MISSING_MAPPING: "补平台SKU映射",
    ISSUE_NOT_CREATED: "新建产品档案",
    ISSUE_NAME_AMBIGUOUS: "人工确认同名产品",
}

_SKU_SPLIT_RE = re.compile(r"[、,;，；]+")

_keys_cache: Dict[int, dict] = {}
_result_cache: Dict[tuple, dict] = {}
_cache_lock = threading.Lock()


def _norm(value) -> str:
    """统一归一化：去空格 + 大写（与 auto_replenishment_service 的键口径一致）"""
    if value is None:
        return ""
    return str(value).strip().upper()


def split_sku(value) -> List[str]:
    """拆分拼接 SKU：`CA-A-887、USA-A-1188` → ['CA-A-887', 'USA-A-1188']"""
    if not value:
        return []
    return [k for k in (_norm(p) for p in _SKU_SPLIT_RE.split(str(value))) if k]


def _load_keys(db: Session, tenant_id: int) -> dict:
    """一次性加载产品库键集合（不缓存，调用方负责缓存）

    性能注意（2026-11-13 实测，远程库）：`platform_products` 有 7 万行映射，
    直接 `SELECT sku, asin` 全量传输约 4.5s；改用 `SELECT DISTINCT` 后
    降到 1.9 万个 SKU，传输量减少约 3/4。
    """
    from sqlalchemy import text

    sku_set: Set[str] = set()
    asin_set: Set[str] = set()

    # 只保留 products 侧仍有效（未软删、同租户）的映射行；DISTINCT 在库侧去重
    rows = db.execute(text(
        "SELECT DISTINCT pp.sku FROM platform_products pp "
        "JOIN products p ON p.id = pp.product_id "
        "WHERE pp.tenant_id = :tid AND pp.deleted_at IS NULL "
        "  AND p.tenant_id = :tid AND p.deleted_at IS NULL "
        "  AND pp.sku IS NOT NULL AND TRIM(pp.sku) <> ''"
    ), {"tid": tenant_id}).fetchall()
    sku_set = {_norm(r[0]) for r in rows if _norm(r[0])}

    rows = db.execute(text(
        "SELECT DISTINCT pp.asin FROM platform_products pp "
        "JOIN products p ON p.id = pp.product_id "
        "WHERE pp.tenant_id = :tid AND pp.deleted_at IS NULL "
        "  AND p.tenant_id = :tid AND p.deleted_at IS NULL "
        "  AND pp.asin IS NOT NULL AND TRIM(pp.asin) <> ''"
    ), {"tid": tenant_id}).fetchall()
    asin_set = {_norm(r[0]) for r in rows if _norm(r[0])}

    # 品名统计不在此处加载：全量 1.5 万个品名传输约 1s，而分类只需要「未收录行涉及的品名」，
    # 由 _load_name_counts 按需查询（通常只有几百个）。

    return {
        "sku": sku_set,
        "asin": asin_set,
        "loaded_at": time.time(),
    }


def _load_name_counts(db: Session, tenant_id: int, names: Set[str]) -> Dict[str, int]:
    """按需查询指定品名在 products 中的重复数量（仅用于分类提示）

    只对「未收录行涉及的品名」查询，避免全量加载 1.5 万个品名。
    """
    from sqlalchemy import bindparam, text

    wanted = [n for n in names if n]
    if not wanted:
        return {}
    result: Dict[str, int] = {}
    for i in range(0, len(wanted), 500):
        chunk = wanted[i:i + 500]
        stmt = text(
            "SELECT TRIM(name) AS name, COUNT(*) AS n FROM products "
            "WHERE tenant_id = :tid AND deleted_at IS NULL "
            "  AND name IS NOT NULL AND TRIM(name) IN :names "
            "GROUP BY TRIM(name)"
        ).bindparams(bindparam("names", expanding=True))
        for row in db.execute(stmt, {"tid": tenant_id, "names": chunk}).fetchall():
            result[row[0]] = int(row[1] or 0)
    return result


def get_product_lib_keys(db: Session, tenant_id: int, *, use_cache: bool = True) -> dict:
    """产品库键集合（带 TTL 缓存）

    返回 `{"sku": set, "asin": set, "loaded_at": ts}`
    （品名统计走 `_load_name_counts` 按需查询，不进缓存）
    """
    now = time.time()
    if use_cache:
        with _cache_lock:
            cached = _keys_cache.get(tenant_id)
            if cached and now - cached["loaded_at"] < KEYS_CACHE_TTL_SECONDS:
                return cached

    keys = _load_keys(db, tenant_id)

    with _cache_lock:
        _keys_cache[tenant_id] = keys
    logger.info(
        "产品库键集合已加载: tenant=%s sku=%s asin=%s",
        tenant_id, len(keys["sku"]), len(keys["asin"]),
    )
    return keys


def invalidate_product_lib_cache(tenant_id: Optional[int] = None) -> None:
    """清除缓存（产品库新增/导入映射后调用；tenant_id=None 清全部）"""
    with _cache_lock:
        if tenant_id is None:
            _keys_cache.clear()
            _result_cache.clear()
        else:
            _keys_cache.pop(tenant_id, None)
            for k in [k for k in _result_cache if k and k[0] == tenant_id]:
                _result_cache.pop(k, None)


def _classify(product_name: Optional[str], name_counts: Dict[str, int]) -> tuple:
    """返回 (issue, action)；只做提示，不改变「是否未收录」的判定"""
    name = (product_name or "").strip()
    if not name:
        return ISSUE_NOT_CREATED, ACTION_BY_ISSUE[ISSUE_NOT_CREATED]
    count = name_counts.get(name, 0)
    if count > 1:
        return ISSUE_NAME_AMBIGUOUS, ACTION_BY_ISSUE[ISSUE_NAME_AMBIGUOUS]
    if count == 1:
        return ISSUE_MISSING_MAPPING, ACTION_BY_ISSUE[ISSUE_MISSING_MAPPING]
    return ISSUE_NOT_CREATED, ACTION_BY_ISSUE[ISSUE_NOT_CREATED]


def find_uncovered_snapshots(db: Session, tenant_id: int, latest, *,
                             sales_window: int = DEFAULT_SALES_WINDOW,
                             min_sales: float = 0,
                             exclude_summary: bool = False) -> dict:
    """找出「有销量但产品库无此产品」的生效快照行

    返回::

        {
          "snapshot_date": date,
          "sales_window": 30, "min_sales": 0.0,
          "missing_ids": [int, ...],          # 未收录的快照行 id（已去重、升序稳定）
          "scanned_ids": [int, ...],          # 参与比对的快照行 id（有键且有销量；已收录 ∪ 未收录）
          "classify": {id: {"issue":..., "action":..., "skipped": 0|1}},
          "total": int,
          "by_type": {issue: n},
          "scanned_rows": int,                # 已按「销量阈值 + 有标识」过滤后参与比对的行数
          "uncovered_sku_count": int,         # 未收录行涉及的 SKU 去重数
        }
    """
    window = int(sales_window or DEFAULT_SALES_WINDOW)
    if window not in SALES_WINDOW_FIELDS:
        window = DEFAULT_SALES_WINDOW
    sales_col_name = SALES_WINDOW_FIELDS[window]
    sales_col = getattr(InventorySnapshot, sales_col_name, None)
    if sales_col is None:  # 防御：模型列缺失时退化为 30 天
        window, sales_col = 30, InventorySnapshot.sales_30d

    threshold = float(min_sales or 0)

    cache_key = (tenant_id, latest, window, threshold, bool(exclude_summary))
    now = time.time()
    with _cache_lock:
        hit = _result_cache.get(cache_key)
        if hit and now - hit["_cached_at"] < RESULT_CACHE_TTL_SECONDS:
            return hit

    keys = get_product_lib_keys(db, tenant_id)
    covered_sku: Set[str] = keys["sku"]
    covered_asin: Set[str] = keys["asin"]

    # 阶段1：只取 4 列做比对（带 2 个文本列约 3.4s，去掉后约 1.4s，实测远程库）
    # 销量阈值与「有标识」条件下推到 SQL：主行 18705 → 有销量约 8524。
    q = db.query(
        InventorySnapshot.id,
        InventorySnapshot.sku,
        InventorySnapshot.asin,
        sales_col,
    ).filter(
        InventorySnapshot.tenant_id == tenant_id,
        InventorySnapshot.snapshot_date == latest,
        InventorySnapshot.deleted_at.is_(None),
        or_(InventorySnapshot.summary_flag != "共享库存",
            InventorySnapshot.summary_flag.is_(None)),
        sales_col > threshold,
        or_(
            and_(InventorySnapshot.sku.isnot(None), InventorySnapshot.sku != ""),
            and_(InventorySnapshot.asin.isnot(None), InventorySnapshot.asin != ""),
        ),
    )
    if exclude_summary:
        q = q.filter(
            or_(InventorySnapshot.summary_flag != "是",
                InventorySnapshot.summary_flag.is_(None))
        )

    missing_ids: List[int] = []
    scanned_ids: List[int] = []
    sku_keys_of: Dict[int, List[str]] = {}
    asin_of: Dict[int, str] = {}
    scanned = 0

    for snap_id, sku, asin, sales_value in q.all():
        scanned += 1
        if float(sales_value or 0) <= threshold:
            continue

        sku_keys = split_sku(sku)
        asin_key = _norm(asin)
        if not sku_keys and not asin_key:
            continue

        sid = int(snap_id)
        # 参与比对的行（有键且有销量）= 未收录 ∪ 已收录；用于全部视图给已收录行补状态
        scanned_ids.append(sid)
        if (asin_key and asin_key in covered_asin) or any(
                k in covered_sku for k in sku_keys):
            continue

        missing_ids.append(sid)
        sku_keys_of[sid] = sku_keys
        asin_of[sid] = asin_key

    # 阶段2：只对未收录行补查品名 + 汇总标记（用于分类），几百行，成本可忽略
    names_of: Dict[int, str] = {}
    summary_flags: Dict[int, str] = {}
    for i in range(0, len(missing_ids), 500):
        chunk = missing_ids[i:i + 500]
        for sid, product_name, summary_flag in db.query(
            InventorySnapshot.id,
            InventorySnapshot.product_name,
            InventorySnapshot.summary_flag,
        ).filter(InventorySnapshot.id.in_(chunk)).all():
            names_of[int(sid)] = product_name or ""
            summary_flags[int(sid)] = (summary_flag or "")

    name_counts = _load_name_counts(db, tenant_id, set(names_of.values()))

    classify: Dict[int, dict] = {}
    by_type: Dict[str, int] = {}
    sku_seen: Set[str] = set()
    for sid in missing_ids:
        issue, action = _classify(names_of.get(sid), name_counts)
        classify[sid] = {"issue": issue, "action": action, "status": "未收录"}
        by_type[issue] = by_type.get(issue, 0) + 1
        if summary_flags.get(sid) == "是":
            sku_seen.add("__SUMMARY__" + str(names_of.get(sid) or ""))
        else:
            sku_seen.update(sku_keys_of.get(sid) or {asin_of.get(sid, "")})

    result = {
        "snapshot_date": latest,
        "sales_window": window,
        "min_sales": threshold,
        "missing_ids": missing_ids,
        "scanned_ids": scanned_ids,
        "classify": classify,
        "total": len(missing_ids),
        "by_type": by_type,
        "scanned_rows": scanned,
        "uncovered_sku_count": len(sku_seen),
        "_cached_at": now,
    }
    logger.info(
        "产品库覆盖度: tenant=%s date=%s window=%sd min=%s → 扫描 %s 行 / 未收录 %s 行 %s",
        tenant_id, latest, window, threshold, scanned, result["total"], by_type,
    )

    with _cache_lock:
        _result_cache[cache_key] = result
    return result
