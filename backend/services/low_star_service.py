# -*- coding: utf-8 -*-
"""低分产品统计数据服务（数据库存储，按租户隔离）

- 真实租户：lingxing_low_star_stats.py 拉取后直接调用 sync_low_star_snapshot 落库
- 演示租户：启动时按租户自动播种内置演示数据（不再读取 CSV/JSON 文件）
"""

import csv
import io
import logging
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from models.low_star import LowStarListing, LowStarSnapshot
from services.low_star_demo_data import DEMO_CSV

logger = logging.getLogger(__name__)

DEMO_THRESHOLD = "0 < last_star <= 3"
DEMO_SCANNED_TOTAL = 286


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _normalize_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in rows:
        sid = _to_int(row.get("sid"))
        if sid is None:
            continue
        out.append({
            "sid": sid,
            "store_name": (row.get("store_name") or "")[:200],
            "seller_sku": (row.get("seller_sku") or "")[:200],
            "asin": (row.get("asin") or "")[:50],
            "last_star": _to_float(row.get("last_star")),
            "price": _to_float(row.get("price")),
            "currency_code": (row.get("currency_code") or "")[:10],
            "status": _to_int(row.get("status")),
            "item_name": (row.get("item_name") or "")[:1000],
        })
    return out


def sync_low_star_snapshot(
    db: Session,
    tenant_id: int,
    rows: Iterable[Dict[str, Any]],
    generated_at: Optional[datetime] = None,
    threshold: Optional[str] = None,
    scanned_total: Optional[int] = None,
) -> int:
    """覆盖写入指定租户的低分统计快照，返回写入条数。"""
    normalized = _normalize_rows(rows)
    db.query(LowStarListing).filter(LowStarListing.tenant_id == tenant_id).delete(
        synchronize_session=False
    )
    if normalized:
        db.bulk_insert_mappings(
            LowStarListing,
            [{**row, "tenant_id": tenant_id} for row in normalized],
        )

    snapshot = (
        db.query(LowStarSnapshot)
        .filter(LowStarSnapshot.tenant_id == tenant_id)
        .first()
    )
    if snapshot is None:
        snapshot = LowStarSnapshot(tenant_id=tenant_id)
        db.add(snapshot)
    snapshot.generated_at = generated_at or datetime.now()
    snapshot.threshold = threshold or "last_star <= 3"
    snapshot.scanned_total = scanned_total
    db.commit()
    return len(normalized)


def _load_demo_rows() -> List[Dict[str, Any]]:
    """解析内置演示 CSV 字符串（不读文件）。"""
    rows: List[Dict[str, Any]] = []
    for item in csv.DictReader(io.StringIO(DEMO_CSV)):
        rows.append({
            "sid": item.get("sid"),
            "store_name": item.get("店铺名"),
            "seller_sku": item.get("seller_sku"),
            "asin": item.get("asin"),
            "last_star": item.get("last_star"),
            "price": item.get("price"),
            "currency_code": item.get("currency_code"),
            "status": item.get("status"),
            "item_name": item.get("item_name"),
        })
    return rows


def seed_demo_low_star(db: Session) -> int:
    """为演示租户播种内置低分数据；已有数据则跳过。返回播种租户数。"""
    tenants = db.execute(text("""
        SELECT id FROM tenants
        WHERE deleted_at IS NULL AND LOWER(name) LIKE '%demo%'
    """)).fetchall()
    if not tenants:
        return 0

    rows = _load_demo_rows()
    seeded = 0
    for (tenant_id,) in tenants:
        exists = (
            db.query(LowStarListing.id)
            .filter(LowStarListing.tenant_id == int(tenant_id))
            .first()
        )
        if exists:
            continue
        try:
            sync_low_star_snapshot(
                db,
                int(tenant_id),
                rows,
                generated_at=datetime.now(),
                threshold=DEMO_THRESHOLD,
                scanned_total=DEMO_SCANNED_TOTAL,
            )
            seeded += 1
        except Exception as e:  # noqa: BLE001
            db.rollback()
            logger.warning("演示低分数据播种失败 tenant=%s: %s", tenant_id, e)
    if seeded:
        logger.info("低分产品统计演示数据已播种：%s 个租户", seeded)
    return seeded
