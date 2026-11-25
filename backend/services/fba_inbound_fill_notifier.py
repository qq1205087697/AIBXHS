#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FBA 在途信息补填通知

两个调用入口（双触发）：
1) services/feishu_sync_service.py::_do_sync 收尾 —— 导入 / 手动同步后即时提醒
2) services/scheduler.py::fba_infill_notify_job —— 每日 09:30 定时兜底

实现范式对齐「超期未入库提醒」（scheduler.py:1218-1395）：
- title 带业务键（批次日期）
- 按天去重：tenant + user + title + DATE(created_at)=今天
- 先聚合再一次 executemany
- type='warning'，link 指向可操作位置（飞书多维表）
- 异常只记日志、不抛出、不阻塞同步

校验口径：ship_date IS NULL；transport_method 为 NULL / 空串 / 占位符（"-"、"无" 等）。
占位符清单与导入侧共用 services/inbound_field_rules.py，保持单一来源。
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from config import get_settings
from database.database import SessionLocal
from services.inbound_field_rules import (
    PLACEHOLDER_VALUES,
    SHIP_DATE_FIELD_LABEL,
    TRANSPORT_FIELD_LABEL,
    is_blank_transport,
)

logger = logging.getLogger(__name__)

WAREHOUSE_ROLE_CODE = "warehouseman"   # 仓库角色
ADMIN_ROLE_CODE = "admin"              # 兜底角色
NOTIFY_TITLE_PREFIX = "FBA在途信息补填提醒"
NOTIFY_TYPE = "warning"
FALLBACK_LINK = "/inventory"           # 配置缺失时回退（仓库角色无该页菜单权限，仅兜底）
MAX_LISTED_FBA = 50                    # content 最多列出 50 个编号，防 TEXT 溢出
FEISHU_BASE_URL = "https://www.feishu.cn/base"


def _fmt_date(value) -> str:
    """批次日期统一输出 YYYY-MM-DD；异常/空值兜底为空串"""
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        try:
            return value.strftime("%Y-%m-%d")
        except Exception:
            pass
    return str(value)[:10]


def build_link() -> str:
    """通知跳转地址：飞书多维表（可操作）；配置缺失回退库存机器人页"""
    settings = get_settings()
    token = (getattr(settings, "FEISHU_SYNC_BASE_TOKEN", "") or "").strip()
    table_id = (getattr(settings, "FEISHU_SYNC_TABLE_ID", "") or "").strip()
    if token and table_id:
        return f"{FEISHU_BASE_URL}/{token}?table={table_id}"
    return FALLBACK_LINK


def build_title(max_date) -> str:
    """title 带业务键（批次日期），便于按天去重与前端检索"""
    day = _fmt_date(max_date)
    return f"{NOTIFY_TITLE_PREFIX} - 批次 {day}" if day else NOTIFY_TITLE_PREFIX


def collect_missing_fba(db: Session) -> Dict[int, dict]:
    """收集各租户「发货日期 / 运输方式」缺失的 FBA 编号

    返回 {tenant_id: {"max_date": 该租户最新快照日期, "items": [
        {"shipment_id": str, "miss_ship_date": bool, "miss_transport": bool}]}}
    只有存在缺失的租户才会出现；同一 FBA 编号只出现一次。

    SQL 两段式（先取每租户最新快照日，再逐租户查），兼容 MySQL 5.7 / SQLite：
    - 空值判定：ship_date IS NULL；transport_method 为 NULL / 空串 / 占位符
    - 同一编号下任一行缺失即纳入，缺失字段取 MAX 聚合
    - 排除：明细软删、shipment_id 为空、快照软删、非该租户最新快照的行
    """
    result: Dict[int, dict] = {}
    placeholders = sorted(PLACEHOLDER_VALUES)

    step1 = db.execute(text(
        "SELECT tenant_id, MAX(snapshot_date) AS max_date "
        "FROM inventory_snapshots "
        "WHERE deleted_at IS NULL "
        "GROUP BY tenant_id"
    )).fetchall()

    step2_sql = text(
        "SELECT d.shipment_id, "
        "       MAX(d.ship_date IS NULL)                                  AS miss_ship_date, "
        "       MAX(d.transport_method IS NULL "
        "           OR TRIM(d.transport_method) = '' "
        "           OR LOWER(TRIM(d.transport_method)) IN :ph)             AS miss_transport "
        "FROM inbound_shipment_details d "
        "JOIN inventory_snapshots s ON s.id = d.snapshot_id "
        "WHERE d.tenant_id = :tid "
        "  AND s.tenant_id = :tid "
        "  AND s.snapshot_date = :max_date "
        "  AND s.deleted_at IS NULL "
        "  AND d.deleted_at IS NULL "
        "  AND d.shipment_id IS NOT NULL AND TRIM(d.shipment_id) <> '' "
        "  AND (d.ship_date IS NULL "
        "       OR d.transport_method IS NULL "
        "       OR TRIM(d.transport_method) = '' "
        "       OR LOWER(TRIM(d.transport_method)) IN :ph) "
        "GROUP BY d.shipment_id "
        "ORDER BY d.shipment_id"
    ).bindparams(bindparam("ph", expanding=True))

    for row in step1:
        tenant_id, max_date = row[0], row[1]
        max_date_str = _fmt_date(max_date)
        if not max_date_str:
            continue  # 该租户没有任何有效快照

        missing = db.execute(step2_sql, {
            "tid": tenant_id, "max_date": max_date_str, "ph": placeholders,
        }).fetchall()

        items = [
            {
                "shipment_id": r[0],
                "miss_ship_date": bool(r[1]),
                "miss_transport": bool(r[2]),
            }
            for r in missing
        ]
        if items:
            result[tenant_id] = {"max_date": max_date, "items": items}

    return result


def _build_feishu_state(feishu_data: Optional[List[dict]]) -> Optional[Dict[str, dict]]:
    """把本次同步拿到的飞书记录转成 {shipment_id: {"exists": True, ...}}。

    传 None 或空列表返回 None —— 文案走中性表述（不区分「飞书无记录」与「字段未填」）。
    定时任务没有 feishu_data，同样走中性表述。
    """
    if not feishu_data:
        return None
    state: Dict[str, dict] = {}
    for rec in feishu_data:
        sid = str(rec.get("shipment_id") or "").strip()
        if not sid:
            continue
        st = state.setdefault(sid, {"exists": True})
        if rec.get("ship_date") is None:
            st["miss_ship_date"] = True
        if is_blank_transport(rec.get("transport_method")):
            st["miss_transport"] = True
    return state


def render_content(items: List[dict], max_date,
                   feishu_state: Optional[Dict[str, dict]] = None) -> str:
    """渲染通知正文；feishu_state 有值时，对「飞书无此记录」单独标注"""
    lines = [
        "【FBA在途信息补填提醒】",
        "当前库存数据中，以下 FBA 编号的发货日期或运输方式未填写，请仓库角色前往飞书补填：",
    ]

    for item in items[:MAX_LISTED_FBA]:
        sid = item.get("shipment_id")
        if feishu_state is not None and sid not in feishu_state:
            lines.append(f"  {sid}：飞书中无此记录，请新增并填齐字段")
            continue
        missing = []
        if item.get("miss_ship_date"):
            missing.append(SHIP_DATE_FIELD_LABEL)
        if item.get("miss_transport"):
            missing.append(TRANSPORT_FIELD_LABEL)
        label = "、".join(missing) if missing else "—"
        lines.append(f"  {sid}：缺 {label}")

    if len(items) > MAX_LISTED_FBA:
        lines.append(f"  ...等共 {len(items)} 个 FBA 编号")

    lines.append("补填字段：发货日期（飞书列「发货日期」）、运输方式（飞书列「渠道（仓库填）」）。")
    lines.append("补填完成后，下次同步或导入即生效。")
    lines.append(f"批次日期：{_fmt_date(max_date)}")
    return "\n".join(lines)


def _user_ids_by_role(db: Session, tenant_id: int, role_code: str) -> List[int]:
    """指定角色的在职用户 id 列表（按 tenant_id 隔离）"""
    rows = db.execute(text(
        "SELECT DISTINCT u.id "
        "FROM users u "
        "JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL "
        "WHERE u.tenant_id = :tid "
        "  AND r.code = :code "
        "  AND u.deleted_at IS NULL "
        "  AND u.status = 'active' "
        "ORDER BY u.id"
    ), {"tid": tenant_id, "code": role_code}).fetchall()
    return [r[0] for r in rows]


def _notify_targets(db: Session, tenant_id: int):
    """收件人解析：仓库角色 → 租户管理员 → 空。

    返回 (user_ids, fallback_used)；fallback_used=True 表示走了 admin 兜底。
    """
    ids = _user_ids_by_role(db, tenant_id, WAREHOUSE_ROLE_CODE)
    if ids:
        return ids, False
    ids = _user_ids_by_role(db, tenant_id, ADMIN_ROLE_CODE)
    return ids, bool(ids)


def _has_notified_today(db: Session, tenant_id: int, user_id: int,
                        title: str, today_str: str) -> bool:
    """同一 (tenant, user, title) 当天已发过 → 跳过（对齐「超期未入库提醒」按天去重）"""
    count = db.execute(text(
        "SELECT COUNT(*) FROM notifications "
        "WHERE tenant_id = :tid AND user_id = :uid "
        "  AND title = :title AND deleted_at IS NULL "
        "  AND DATE(created_at) = :today"
    ), {"tid": tenant_id, "uid": user_id,
        "title": title, "today": today_str}).scalar()
    return bool(count)


def notify_missing_fba_info(feishu_data: Optional[List[dict]] = None) -> dict:
    """主入口：校验缺失 → 解析收件人 → 按天去重 → 批量写入 notifications

    feishu_data: 本次同步返回的飞书记录（可选）。传入时文案能区分「飞书无此记录」；
                 不传（定时任务）时走中性表述。

    自建 SessionLocal，任何异常内部吞掉、不抛出。
    正常返回 {"ok": True, "tenants", "fba_count", "notified", "skipped",
              "fallback_tenants", "no_target_tenants"}
    失败返回 {"ok": False, "error": str}
    """
    db = None
    try:
        db = SessionLocal()
        collected = collect_missing_fba(db)
        if not collected:
            logger.info("FBA在途补填通知: 各租户均无缺失的发货日期/运输方式，未产生通知")
            return {"ok": True, "tenants": 0, "fba_count": 0, "notified": 0,
                    "skipped": 0, "fallback_tenants": [], "no_target_tenants": []}

        feishu_state = _build_feishu_state(feishu_data)
        link = build_link()
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        today_str = now.strftime("%Y-%m-%d")

        rows: List[dict] = []
        tenants_done = 0
        fba_count = 0
        skipped = 0
        fallback_tenants: List[int] = []
        no_target_tenants: List[int] = []

        for tenant_id, payload in collected.items():
            max_date = payload.get("max_date")
            items: List[dict] = payload.get("items") or []
            if not items:
                continue
            fba_count += len(items)

            title = build_title(max_date)
            content = render_content(items, max_date, feishu_state)

            user_ids, fallback = _notify_targets(db, tenant_id)
            if not user_ids:
                no_target_tenants.append(tenant_id)
                logger.warning(
                    "FBA在途补填通知: 租户 %s 既无「仓库」也无「管理员」在职用户，"
                    "缺失 %s 个 FBA 编号未通知", tenant_id, len(items),
                )
                continue
            if fallback:
                fallback_tenants.append(tenant_id)
                content += "\n（本租户未配置「仓库」角色，本条已改发管理员，请转达或补配角色）"

            tenants_done += 1
            for user_id in user_ids:
                if _has_notified_today(db, tenant_id, user_id, title, today_str):
                    skipped += 1
                    continue
                rows.append({
                    "tid": tenant_id, "uid": user_id, "type": NOTIFY_TYPE,
                    "title": title, "content": content, "link": link, "now": now_str,
                })

        if rows:
            db.execute(text(
                "INSERT INTO notifications "
                "(tenant_id, user_id, type, title, content, link, created_at, updated_at) "
                "VALUES (:tid, :uid, :type, :title, :content, :link, :now, :now)"
            ), rows)
        db.commit()

        logger.info(
            "FBA在途补填通知: 租户 %s 个，FBA 编号 %s 个，写入 %s 条，去重跳过 %s 条，"
            "兜底租户 %s，无收件人租户 %s",
            tenants_done, fba_count, len(rows), skipped,
            fallback_tenants, no_target_tenants,
        )
        return {
            "ok": True, "tenants": tenants_done, "fba_count": fba_count,
            "notified": len(rows), "skipped": skipped,
            "fallback_tenants": fallback_tenants,
            "no_target_tenants": no_target_tenants,
        }

    except Exception as e:  # noqa: BLE001 任何失败都不允许阻塞同步
        try:
            if db is not None:
                db.rollback()
        except Exception:
            pass
        logger.warning("FBA在途补填通知失败（不阻塞同步）: %s", e)
        return {"ok": False, "error": str(e)}
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
