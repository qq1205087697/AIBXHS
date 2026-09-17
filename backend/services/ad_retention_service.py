"""
广告数据保留策略服务

提供:
- get_retention_days: 读取保留天数配置
- set_retention_days: 更新保留天数配置
- cleanup_expired_data: 清理超过保留期的广告数据（7 张表，分批硬删除）
- get_retention_status: 查询当前配置与各表数据量

清理顺序（子表先于父表，避免 FK 冲突）:
1. ad_execution_log（按 execution_time，子表，FK 引用 ad_optimization_suggestion.id）
2. ad_optimization_suggestion（按 evaluation_date，父表）
3. ad_campaign_daily（按 date）
4. ad_keyword_daily（按 date）
5. ad_search_term_daily（按 date）
6. ad_product_daily（按 date）
7. ad_report_snapshots（按 date）

配置存储: business_settings 表，setting_type='ad_retention', setting_name='ad_data_retention_days', formula_config=数字字符串
"""
import logging
from datetime import date, datetime, timedelta
from typing import Optional, Dict, Any, List

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ==================== 常量 ====================

DEFAULT_RETENTION_DAYS = 90
MIN_RETENTION_DAYS = 7
MAX_RETENTION_DAYS = 365
BATCH_SIZE = 5000

RETENTION_SETTING_TYPE = "ad_retention"
RETENTION_SETTING_NAME = "ad_data_retention_days"

# 待清理的 7 张表配置（按清理顺序排列：子表先于父表）
# table_name: 表名
# date_column: 用于判断保留期的日期列
# date_type: 'date' 或 'datetime'
# 注意：ad_execution_log.suggestion_id → ad_optimization_suggestion.id (FK RESTRICT)，
#       必须先删子表 ad_execution_log，再删父表 ad_optimization_suggestion，
#       否则会触发外键约束错误。
CLEANUP_TABLES: List[Dict[str, str]] = [
    {"table_name": "ad_execution_log", "date_column": "execution_time", "date_type": "datetime"},
    {"table_name": "ad_optimization_suggestion", "date_column": "evaluation_date", "date_type": "date"},
    {"table_name": "ad_campaign_daily", "date_column": "date", "date_type": "date"},
    {"table_name": "ad_keyword_daily", "date_column": "date", "date_type": "date"},
    {"table_name": "ad_search_term_daily", "date_column": "date", "date_type": "date"},
    {"table_name": "ad_product_daily", "date_column": "date", "date_type": "date"},
    {"table_name": "ad_report_snapshots", "date_column": "date", "date_type": "date"},
]


# ==================== 配置管理 ====================

def get_retention_days(db: Session, tenant_id: Optional[int] = None) -> int:
    """
    读取广告数据保留天数配置。

    Args:
        db: 数据库会话
        tenant_id: 租户ID（可选，若提供则查询该租户的配置，否则查询全局配置）

    Returns:
        保留天数，默认 90
    """
    try:
        query = text(
            """
            SELECT formula_config
            FROM business_settings
            WHERE setting_type = :st
              AND setting_name = :sn
              AND is_active = 1
              AND (tenant_id = :tid OR :tid IS NULL)
            ORDER BY tenant_id DESC
            LIMIT 1
            """
        )
        result = db.execute(
            query,
            {"st": RETENTION_SETTING_TYPE, "sn": RETENTION_SETTING_NAME, "tid": tenant_id},
        ).fetchone()

        if not result or not result[0]:
            return DEFAULT_RETENTION_DAYS

        try:
            days = int(result[0])
        except (ValueError, TypeError):
            logger.warning(f"ad_data_retention_days 配置值无效: {result[0]}，使用默认值 {DEFAULT_RETENTION_DAYS}")
            return DEFAULT_RETENTION_DAYS

        if days < MIN_RETENTION_DAYS or days > MAX_RETENTION_DAYS:
            logger.warning(
                f"ad_data_retention_days 配置值 {days} 越界（[{MIN_RETENTION_DAYS}, {MAX_RETENTION_DAYS}]），使用默认值 {DEFAULT_RETENTION_DAYS}"
            )
            return DEFAULT_RETENTION_DAYS

        return days
    except Exception as e:
        logger.error(f"读取广告数据保留天数配置失败: {e}", exc_info=True)
        return DEFAULT_RETENTION_DAYS


def set_retention_days(db: Session, tenant_id: int, days: int) -> Dict[str, Any]:
    """
    更新或插入广告数据保留天数配置。

    Args:
        db: 数据库会话
        tenant_id: 租户ID
        days: 保留天数（必须 ∈ [7, 365]）

    Returns:
        {"retention_days": int, "updated": bool} updated=True 表示更新已有记录，False 表示新增
    """
    if not isinstance(days, int) or days < MIN_RETENTION_DAYS or days > MAX_RETENTION_DAYS:
        raise ValueError(f"retention_days 必须为整数且 ∈ [{MIN_RETENTION_DAYS}, {MAX_RETENTION_DAYS}]，当前值: {days}")

    # 检查是否已有配置
    check_query = text(
        """
        SELECT id FROM business_settings
        WHERE setting_type = :st
          AND setting_name = :sn
          AND tenant_id = :tid
        LIMIT 1
        """
    )
    existing = db.execute(
        check_query,
        {"st": RETENTION_SETTING_TYPE, "sn": RETENTION_SETTING_NAME, "tid": tenant_id},
    ).fetchone()

    if existing:
        update_query = text(
            """
            UPDATE business_settings
            SET formula_config = :val, is_active = 1, updated_at = NOW()
            WHERE id = :id
            """
        )
        db.execute(update_query, {"val": str(days), "id": existing[0]})
        db.commit()
        logger.info(f"更新广告数据保留天数 tenant_id={tenant_id} days={days}")
        return {"retention_days": days, "updated": True}
    else:
        insert_query = text(
            """
            INSERT INTO business_settings (tenant_id, setting_type, setting_name, formula_config, is_active, created_at, updated_at)
            VALUES (:tid, :st, :sn, :val, 1, NOW(), NOW())
            """
        )
        db.execute(
            insert_query,
            {"tid": tenant_id, "st": RETENTION_SETTING_TYPE, "sn": RETENTION_SETTING_NAME, "val": str(days)},
        )
        db.commit()
        logger.info(f"新增广告数据保留天数 tenant_id={tenant_id} days={days}")
        return {"retention_days": days, "updated": False}


# ==================== 清理逻辑 ====================

def _cleanup_table(
    db: Session,
    table_name: str,
    date_column: str,
    date_type: str,
    cutoff_value,
    tenant_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    清理单张表中早于 cutoff_value 的数据，分批删除。

    Args:
        db: 数据库会话
        table_name: 表名
        date_column: 日期列名
        date_type: 'date' 或 'datetime'
        cutoff_value: 截止值（date 或 datetime）
        tenant_id: 租户ID（可选，提供则只清理该租户数据）

    Returns:
        {"table": str, "deleted": int, "error": str | None}
    """
    result = {"table": table_name, "deleted": 0, "error": None}
    total_deleted = 0

    # 安全校验：表名和列名只允许字母数字下划线
    import re
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table_name):
        result["error"] = f"非法表名: {table_name}"
        return result
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", date_column):
        result["error"] = f"非法列名: {date_column}"
        return result

    # NULL 日期不清理（避免误删无日期记录），仅清理 date_column < cutoff
    # 注意：tenant_id IS NULL 时清理所有租户的数据
    if tenant_id is not None:
        tenant_clause = "AND tenant_id = :tid"
        params_base = {"cutoff": cutoff_value, "tid": tenant_id}
    else:
        tenant_clause = ""
        params_base = {"cutoff": cutoff_value}

    while True:
        try:
            # 使用子查询 + LIMIT 实现分批删除（MySQL 语法）
            delete_sql = text(
                f"""
                DELETE FROM {table_name}
                WHERE {date_column} IS NOT NULL
                  AND {date_column} < :cutoff
                  {tenant_clause}
                LIMIT :batch
                """
            )
            params = dict(params_base)
            params["batch"] = BATCH_SIZE
            delete_result = db.execute(delete_sql, params)
            affected = delete_result.rowcount or 0
            db.commit()
            total_deleted += affected

            if affected < BATCH_SIZE:
                break  # 没有更多数据需要删除

            # 防御性：避免无限循环
            if total_deleted > 10_000_000:
                logger.warning(f"{table_name} 清理数量超过 1000 万，中止后续批次")
                break
        except Exception as e:
            db.rollback()
            result["error"] = str(e)
            logger.error(f"清理 {table_name} 失败（已删除 {total_deleted} 条）: {e}", exc_info=True)
            break

    result["deleted"] = total_deleted
    return result


def cleanup_expired_data(
    db: Session,
    tenant_id: Optional[int] = None,
    retention_days: Optional[int] = None,
) -> Dict[str, Any]:
    """
    清理超过保留期的广告数据（7 张表，分批硬删除）。

    Args:
        db: 数据库会话
        tenant_id: 租户ID（可选，提供则只清理该租户数据）
        retention_days: 保留天数（可选，未提供则从配置读取）

    Returns:
        {
            "retention_days": int,
            "cutoff_date": str (YYYY-MM-DD),
            "tables": [{"table": str, "deleted": int, "error": str | None}, ...],
            "total_deleted": int,
            "success_count": int,
            "failed_count": int,
        }
    """
    if retention_days is None:
        retention_days = get_retention_days(db, tenant_id=tenant_id)

    today = date.today()
    cutoff_date = today - timedelta(days=retention_days)
    # 对于 datetime 列，使用 cutoff 当天的 00:00:00 作为截止值
    cutoff_datetime = datetime.combine(cutoff_date, datetime.min.time())

    logger.info(
        f"开始清理广告数据 tenant_id={tenant_id} retention_days={retention_days} cutoff_date={cutoff_date}"
    )

    tables_result: List[Dict[str, Any]] = []
    total_deleted = 0
    success_count = 0
    failed_count = 0

    for table_cfg in CLEANUP_TABLES:
        table_name = table_cfg["table_name"]
        date_column = table_cfg["date_column"]
        date_type = table_cfg["date_type"]

        cutoff_value = cutoff_datetime if date_type == "datetime" else cutoff_date

        try:
            r = _cleanup_table(db, table_name, date_column, date_type, cutoff_value, tenant_id=tenant_id)
        except Exception as e:
            r = {"table": table_name, "deleted": 0, "error": str(e)}

        tables_result.append(r)
        total_deleted += r["deleted"]
        if r["error"]:
            failed_count += 1
            logger.error(f"清理 {table_name} 失败: {r['error']}")
        else:
            success_count += 1
            logger.info(f"清理 {table_name} 完成，删除 {r['deleted']} 条")

    logger.info(
        f"广告数据清理完成 total_deleted={total_deleted} success={success_count} failed={failed_count}"
    )

    return {
        "retention_days": retention_days,
        "cutoff_date": cutoff_date.isoformat(),
        "tables": tables_result,
        "total_deleted": total_deleted,
        "success_count": success_count,
        "failed_count": failed_count,
    }


# ==================== 状态查询 ====================

def get_retention_status(db: Session, tenant_id: Optional[int] = None) -> Dict[str, Any]:
    """
    查询保留策略当前状态：配置、各表数据量、最早数据日期、预计下次清理时间。

    Args:
        db: 数据库会话
        tenant_id: 租户ID（可选）

    Returns:
        {
            "retention_days": int,
            "tenant_id": int | None,
            "tables": [{"table": str, "count": int, "earliest_date": str | None}, ...],
            "total_count": int,
            "next_cleanup_at": str (YYYY-MM-DD 03:00:00),
        }
    """
    retention_days = get_retention_days(db, tenant_id=tenant_id)

    # 计算下次清理时间（次日 03:00:00）
    now = datetime.now()
    next_cleanup = now.replace(hour=3, minute=0, second=0, microsecond=0)
    if next_cleanup <= now:
        next_cleanup = next_cleanup + timedelta(days=1)

    # 查询各表数据量和最早日期
    tables_info: List[Dict[str, Any]] = []
    total_count = 0

    if tenant_id is not None:
        count_sql_template = (
            "SELECT COUNT(*), MIN({col}) FROM {tbl} WHERE tenant_id = :tid"
        )
        params = {"tid": tenant_id}
    else:
        count_sql_template = "SELECT COUNT(*), MIN({col}) FROM {tbl}"
        params = {}

    for table_cfg in CLEANUP_TABLES:
        table_name = table_cfg["table_name"]
        date_column = table_cfg["date_column"]
        info = {"table": table_name, "count": 0, "earliest_date": None}
        try:
            sql = text(count_sql_template.format(tbl=table_name, col=date_column))
            row = db.execute(sql, params).fetchone()
            if row:
                info["count"] = int(row[0] or 0)
                earliest = row[1]
                if earliest is not None:
                    if isinstance(earliest, datetime):
                        info["earliest_date"] = earliest.strftime("%Y-%m-%d %H:%M:%S")
                    else:
                        info["earliest_date"] = str(earliest)
        except Exception as e:
            logger.error(f"查询 {table_name} 状态失败: {e}", exc_info=True)
            info["error"] = str(e)
        tables_info.append(info)
        total_count += info["count"]

    return {
        "retention_days": retention_days,
        "tenant_id": tenant_id,
        "tables": tables_info,
        "total_count": total_count,
        "next_cleanup_at": next_cleanup.strftime("%Y-%m-%d %H:%M:%S"),
    }
