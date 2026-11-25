"""星拓定时报告兜底导入器（M1 星拓数据适配层 / E-02 / F10 兜底通道）

依据《系统设计》v1.0 §3.2.M1：
- 通道定位：星拓 MCP 主通道（services/startop_client.py）连续批次失败时的兜底词数据来源
  （BD-01「兜底执行：E-02 报告文件经导入 → 复用 safe_read_excel → 字段映射到
  StartopWordRow → 同表 UPSERT（source=report）」）
- 复用链路：utils.excel_reader.safe_read_excel（与存量补货 Excel 导入同一读取器）→
  中文列名候选匹配 → startop_word_data UPSERT（data_source='report'），
  唯一键口径与 MCP 通道完全一致（uk_word），两通道可互相覆盖更新同一行
- 幂等：文件 SHA-256 去重 —— 同一文件重复上传直接返回上次结果，不重复写库
  （《系统设计》§3.2.M1.2 幂等列「文件哈希去重」）
- 审计：写 startop_pull_logs（tool='report_import'，
  target_scope='report:<文件名>#<哈希前16位>'，status SUCCESS/FAILED）
- 清理：与主通道共用 90 天滚动清理（startop_client._cleanup_old_data）

设计取舍：报告列名为中文且各报表口径不一，故每个业务字段给出候选列名（精确优先、
包含匹配兜底）；无法归因 ASIN 或缺关键词的行计入 rows_skipped 并统计原因，不阻断整批。
"""
import hashlib
import math
import time
from datetime import date

from sqlalchemy.orm import Session

from models.tag import StartopPullLog
from utils.excel_reader import safe_read_excel
# 复用主通道的列名匹配/日期解析/入库/清理实现（同一适配接口，避免双份口径）
from services.startop_client import _pick, _upsert_word_rows, _cleanup_old_data

REPORT_TOOL = "report_import"
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED = "FAILED"
STATUS_DUPLICATE = "DUPLICATE"

# ===== 列名候选（中文报告优先，兼容英文导出） =====
COL_KEYWORD = ("搜索词", "关键词", "买家搜索词", "keyword", "search term",
               "searchterm", "search_term", "query")
COL_ASIN = ("asin", "归因asin", "商品asin", "子asin", "商品", "产品")
COL_DATE = ("数据日期", "统计日期", "日期", "statdate", "stat_date", "date")
COL_SITE = ("站点", "国家", "site", "country", "marketplace")
COL_STORE = ("店铺标识", "店铺", "storeid", "store_id", "store")
COL_PROFILE = ("profileid", "profile_id", "广告profile", "广告账户", "profile")
# 注意：不列裸 "type"，避免 _pick 的包含匹配误命中 accountType 等列
COL_WORD_KIND = ("词类型", "wordtype", "word_type", "报表类型")

# 词类型归一
WORD_KIND_MAP = {
    "出单词": "search_term", "出单": "search_term", "搜索词": "search_term",
    "search_term": "search_term", "searchterm": "search_term", "conversion": "search_term",
    "流量词": "traffic_term", "流量": "traffic_term",
    "traffic_term": "traffic_term", "trafficterm": "traffic_term", "traffic": "traffic_term",
}


def _clean(val):
    """归一空值：None / NaN / 空串 / 纯空白 → None；其余去空白后返回"""
    if val is None:
        return None
    if isinstance(val, float) and math.isnan(val):
        return None
    s = str(val).strip()
    return s or None


def _fetch_last_success(db: Session, tenant_id: int, scope_key: str):
    """查询同哈希文件的最近一次成功导入流水（幂等判定依据）"""
    return db.query(StartopPullLog).filter(
        StartopPullLog.tenant_id == tenant_id,
        StartopPullLog.tool == REPORT_TOOL,
        StartopPullLog.target_scope == scope_key,
        StartopPullLog.status == STATUS_SUCCESS,
    ).order_by(StartopPullLog.id.desc()).first()


def _write_log(db: Session, tenant_id: int, scope_key: str, status: str,
               rows_parsed: int, duration_ms: int, error_msg=None) -> int:
    """写兜底导入流水（追加只写），返回 log_id"""
    log = StartopPullLog(
        tenant_id=tenant_id, pull_date=date.today(), tool=REPORT_TOOL,
        target_scope=scope_key, page_num=1, page_size=None,
        status=status, rows_parsed=rows_parsed, retry_count=0,
        duration_ms=duration_ms,
        error_msg=(str(error_msg)[:1000] if error_msg else None),
        fallback_ready=0 if status == STATUS_SUCCESS else 1,
    )
    db.add(log)
    db.commit()
    return log.id


def import_report_file(db: Session, tenant_id: int, file_name: str,
                       file_content: bytes, default_site: str = "US") -> dict:
    """星拓定时报告兜底导入（同一适配接口的离线通道）。

    Args:
        db: 会话
        tenant_id: 租户
        file_name: 上传文件名（用于流水与前端提示）
        file_content: 文件字节（xlsx/xls/csv）
        default_site: 报告无站点列时的兜底站点

    Returns:
        StartopImportResult 语义的 dict：
        status(SUCCESS/DUPLICATE/FAILED) / file_name / file_hash / rows_total /
        rows_imported / rows_skipped / skipped_reasons / duration_ms / log_id / message
    """
    from services.tag_service import _ensure_models_loaded
    _ensure_models_loaded()

    started = time.time()
    file_hash = hashlib.sha256(file_content).hexdigest()
    scope_key = f"report:{file_name}#{file_hash[:16]}"

    # ===== 幂等：同哈希文件已成功导入过 → 复用上次结果（不重复写库） =====
    prev = _fetch_last_success(db, tenant_id, scope_key)
    if prev is not None:
        return {
            "status": STATUS_DUPLICATE,
            "file_name": file_name,
            "file_hash": file_hash,
            "rows_total": None,
            "rows_imported": None,
            "rows_skipped": None,
            "skipped_reasons": {},
            "duration_ms": 0,
            "log_id": prev.id,
            "message": (f"该文件已于 {prev.created_at} 成功导入（哈希一致），"
                        f"本次跳过以满足幂等要求；如确需重导请修改文件内容或换文件名。"),
        }

    # ===== 解析（复用 safe_read_excel，与存量 Excel 导入同一读取器） =====
    try:
        df = safe_read_excel(file_content, engine="openpyxl")
    except Exception as e:
        dur = int((time.time() - started) * 1000)
        log_id = _write_log(db, tenant_id, scope_key, STATUS_FAILED, 0, dur, e)
        return {
            "status": STATUS_FAILED, "file_name": file_name, "file_hash": file_hash,
            "rows_total": 0, "rows_imported": 0, "rows_skipped": 0, "skipped_reasons": {},
            "duration_ms": dur, "log_id": log_id,
            "message": f"报告解析失败（safe_read_excel）: {e}",
        }

    if df is None or len(df) == 0:
        dur = int((time.time() - started) * 1000)
        log_id = _write_log(db, tenant_id, scope_key, STATUS_FAILED, 0, dur,
                            "报告解析成功但无数据行")
        return {
            "status": STATUS_FAILED, "file_name": file_name, "file_hash": file_hash,
            "rows_total": 0, "rows_imported": 0, "rows_skipped": 0, "skipped_reasons": {},
            "duration_ms": dur, "log_id": log_id,
            "message": "报告解析成功但无数据行（请确认上传的是含表头的词数据明细）",
        }

    records = df.to_dict(orient="records")
    rows_total = len(records)

    # ===== 逐行归一 + 分组（复用主通道 UPSERT：按 site/store/profile/word_type 分组） =====
    buckets = {}          # (site, store_id, profile_id, word_type) -> [row_dict, ...]
    skipped = 0
    reasons = {}
    for rec in records:
        keyword = _clean(_pick(rec, *COL_KEYWORD))
        asin = _clean(_pick(rec, *COL_ASIN))
        missing = []
        if not keyword:
            missing.append("缺关键词")
        if not asin:
            missing.append("缺 ASIN")
        if missing:
            skipped += 1
            for m in missing:
                reasons[m] = reasons.get(m, 0) + 1
            continue

        site = (_clean(_pick(rec, *COL_SITE)) or default_site)[:10]
        store_id = (_clean(_pick(rec, *COL_STORE)) or "")[:64]
        profile_id = (_clean(_pick(rec, *COL_PROFILE)) or store_id or "report")[:64]
        kind_raw = (_clean(_pick(rec, *COL_WORD_KIND)) or "").lower()
        word_type = WORD_KIND_MAP.get(kind_raw, "search_term")
        buckets.setdefault((site, store_id, profile_id, word_type), []).append(rec)

    rows_imported = 0
    for (site, store_id, profile_id, word_type), grouped in buckets.items():
        rows_imported += _upsert_word_rows(
            db, tenant_id, site, store_id, profile_id, grouped,
            fallback_date=date.today(), data_source="report", word_type=word_type,
        )

    # ===== 90 天滚动清理（与主通道共用策略） =====
    try:
        _cleanup_old_data(db, tenant_id)
    except Exception as e:  # 清理失败不阻断导入结果
        print(f"[startop_report_importer] 滚动清理失败（不阻断）: {e}")

    dur = int((time.time() - started) * 1000)
    status = STATUS_SUCCESS if rows_imported > 0 else STATUS_FAILED
    log_id = _write_log(
        db, tenant_id, scope_key, status, rows_imported, dur,
        None if status == STATUS_SUCCESS else "全部行均无法归因（缺关键词或缺 ASIN）",
    )

    message = (f"兜底导入完成：解析 {rows_total} 行，入库 {rows_imported} 行，"
               f"跳过 {skipped} 行")
    if skipped:
        message += "（" + "、".join(f"{k} {v} 行" for k, v in reasons.items()) + "）"
    if status != STATUS_SUCCESS:
        message = "兜底导入失败：全部行均无法归因到 ASIN/关键词，请检查报告列名是否符合星拓搜索词报表口径"

    return {
        "status": status, "file_name": file_name, "file_hash": file_hash,
        "rows_total": rows_total, "rows_imported": rows_imported,
        "rows_skipped": skipped, "skipped_reasons": reasons,
        "duration_ms": dur, "log_id": log_id, "message": message,
    }
