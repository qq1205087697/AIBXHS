"""星拓 MCP Server 客户端（M1 星拓数据适配层）

依据《系统设计》v1.0 §3.2.M1 + 主理人 2026-09-21 PoC 实测契约：
- 端点：https://openmcp.startop.com/mcp-servers/startop-mcp（streamable HTTP JSON-RPC）
- 鉴权：请求头 X-Mcp-Key（密钥落 .env，不入代码库，N2）
- 工具：get_my_stores / query_search_word（Markdown 文本表格返回，pageSize/pageNum 分页，
        siteStores 需对象数组 [{site,storeId,profileId,accountType}]）
- 失败处理：3 次指数退避重试 → 拉取流水 FAILED_FALLBACK_READY（兜底切换依据，BD-01）
- 清理：startop_word_data 保留 90 天滚动删除；startop_pull_logs 保留 180 天

D2 冻结（经中间确认）：MCP 为 MVP 主通道；定时报告导入为兜底；REST API 移出边界。
"""
import json
import re
import time
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from config import get_settings
from models.tag import StartopPullLog, StartopWordData

MCP_PROTOCOL_VERSION = "2025-03-26"


class StartopMCPError(Exception):
    """星拓 MCP 调用失败（重试耗尽后抛出）"""


def _headers() -> dict:
    settings = get_settings()
    key = settings.STARTOP_MCP_KEY
    if not key:
        raise StartopMCPError("STARTOP_MCP_KEY 未配置（.env），无法调用星拓 MCP")
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "AIBXHS/1.0",
        "X-Mcp-Key": key,
    }


def _rpc(method: str, params: dict = None, rpc_id: int = 1, timeout: int = 30,
         max_retries: int = 3) -> dict:
    """JSON-RPC 调用（3 次指数退避重试）"""
    url = get_settings().STARTOP_MCP_URL
    body = {"jsonrpc": "2.0", "id": rpc_id, "method": method}
    if params is not None:
        body["params"] = params
    last_err = None
    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(
                url, data=json.dumps(body).encode("utf-8"), method="POST",
                headers=_headers(),
            )
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
            # streamable HTTP 可能返回 SSE（data: 前缀），容错解析
            if raw.lstrip().startswith("data:"):
                for line in raw.splitlines():
                    line = line.strip()
                    if line.startswith("data:"):
                        payload = line[len("data:"):].strip()
                        if payload and payload != "[DONE]":
                            return json.loads(payload)
                raise StartopMCPError("SSE 响应中无有效 JSON-RPC 数据")
            return json.loads(raw)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            last_err = e
            if attempt < max_retries:
                time.sleep(2 ** attempt)  # 1s, 2s, 4s 指数退避
        except json.JSONDecodeError as e:
            last_err = e
            break  # 响应非 JSON，重试无意义
    raise StartopMCPError(f"MCP 调用失败（method={method}）: {last_err}")


def _extract_tool_payload(rpc_resp: dict):
    """从 tools/call 响应提取文本内容（content[].text 拼接）"""
    if "error" in rpc_resp:
        raise StartopMCPError(f"MCP 返回错误: {rpc_resp['error']}")
    result = rpc_resp.get("result", {})
    if result.get("isError"):
        texts = [c.get("text", "") for c in result.get("content", []) if isinstance(c, dict)]
        raise StartopMCPError("MCP 工具执行失败: " + " | ".join(texts)[:500])
    parts = []
    for c in result.get("content", []):
        if isinstance(c, dict) and c.get("type") == "text":
            parts.append(c.get("text", ""))
    return "\n".join(parts)


def get_my_stores() -> list:
    """获取账号绑定的店铺列表（容错解析 JSON 或 Markdown）"""
    raw = _extract_tool_payload(_rpc("tools/call", {"name": "get_my_stores", "arguments": {}}))
    # 尝试 JSON 解析
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            data = data.get("data") or data.get("stores") or data.get("list") or [data]
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    # Markdown 表格解析兜底
    return _parse_markdown_rows(raw)


def query_search_word(profile_ids: list, store_ids: list, site_stores: list,
                      begin_date: str, end_date: str,
                      page_num: int = 1, page_size: int = None) -> list:
    """搜索词-关键词报表（Markdown 表格解析为 dict 行列表）

    site_stores: [{"site": "US", "storeId": "...", "profileId": "...", "accountType": "seller"}]
    """
    settings = get_settings()
    if page_size is None:
        page_size = settings.STARTOP_PAGE_SIZE
    args = {
        "beginDate": begin_date,
        "endDate": end_date,
        "profileIds": profile_ids,
        "storeIds": store_ids,
        "siteStores": site_stores,
        "pageNum": page_num,
        "pageSize": page_size,
    }
    raw = _extract_tool_payload(_rpc("tools/call", {"name": "query_search_word", "arguments": args},
                                     timeout=60))
    return _parse_markdown_rows(raw)


# ====================== Markdown 表格解析 ======================

def _parse_markdown_rows(raw: str) -> list:
    """解析 Markdown 表格为 dict 列表（容错：找不到表头返回空列表）"""
    rows = []
    header = None
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):  # 分隔行
            continue
        if header is None:
            if any(c for c in cells):
                header = cells
            continue
        if not any(c for c in cells):
            continue
        row = {}
        for i, c in enumerate(cells):
            key = header[i] if i < len(header) else f"col_{i}"
            row[key] = c
        rows.append(row)
    return rows


def _pick(row: dict, *names):
    """按候选列名（含模糊匹配）取值"""
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for n in names:
        if n in lowered:
            return lowered[n]
    for k, v in lowered.items():
        for n in names:
            if n in k:
                return v
    return None


def _to_date(val, fallback: date) -> date:
    if not val:
        return fallback
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(str(val).strip()[:19], fmt).date()
        except ValueError:
            continue
    return fallback


# ====================== 拉取编排（写词表 + 拉取流水） ======================

def pull_words_to_db(db: Session, tenant_id: int = 1, begin_date: str = None,
                     end_date: str = None, stores: list = None) -> dict:
    """每日拉取任务主体：拉取搜索词 → UPSERT startop_word_data → 写拉取流水。

    stores 为空时自动 get_my_stores。返回 {"stores": n, "rows": n, "failed": [...]}
    """
    from services.tag_service import _ensure_models_loaded
    _ensure_models_loaded()
    settings = get_settings()
    today = date.today()
    if not end_date:
        end_date = today.isoformat()
    if not begin_date:
        begin_date = (today - timedelta(days=6)).isoformat()  # 默认近 7 天

    if stores is None:
        stores = get_my_stores()

    total_rows = 0
    failed = []
    pulled_days = [begin_date, end_date]

    for store in stores:
        store_id = str(_pick(store, "storeid", "store_id", "id") or "")
        profile_id = str(_pick(store, "profileid", "profile_id") or "")
        site = str(_pick(store, "site", "country", "marketplace") or "US")
        account_type = str(_pick(store, "accounttype", "account_type") or "seller")
        scope = f"{site}/{profile_id or store_id}"
        if not profile_id and not store_id:
            continue

        started = time.time()
        page_num = 1
        store_rows = 0
        last_err = None
        while True:
            try:
                rows = query_search_word(
                    profile_ids=[profile_id] if profile_id else [],
                    store_ids=[store_id] if store_id else [],
                    site_stores=[{"site": site, "storeId": store_id,
                                  "profileId": profile_id, "accountType": account_type}],
                    begin_date=begin_date, end_date=end_date,
                    page_num=page_num, page_size=settings.STARTOP_PAGE_SIZE,
                )
            except StartopMCPError as e:
                last_err = str(e)
                break
            if not rows:
                break
            store_rows += _upsert_word_rows(db, tenant_id, site, store_id, profile_id,
                                            rows, fallback_date=today)
            if len(rows) < settings.STARTOP_PAGE_SIZE:
                break
            page_num += 1
            if page_num > 500:  # 安全上限
                break

        duration_ms = int((time.time() - started) * 1000)
        status = "SUCCESS" if last_err is None else (
            "FAILED_FALLBACK_READY" if page_num == 1 and store_rows == 0 else "PARTIAL")
        db.add(StartopPullLog(
            tenant_id=tenant_id, pull_date=today, tool="query_search_word",
            target_scope=scope, page_num=page_num, page_size=settings.STARTOP_PAGE_SIZE,
            status=status, rows_parsed=store_rows, retry_count=3 if last_err else 0,
            duration_ms=duration_ms, error_msg=(last_err or None)[:1000] if last_err else None,
            fallback_ready=1 if last_err else 0,
        ))
        db.commit()
        total_rows += store_rows
        if last_err:
            failed.append(scope)

    _cleanup_old_data(db, tenant_id)
    return {"stores": len(stores), "rows": total_rows, "failed": failed,
            "date_range": pulled_days}


def _upsert_word_rows(db: Session, tenant_id: int, site: str, store_id: str,
                      profile_id: str, rows: list, fallback_date: date,
                      data_source: str = "mcp", word_type: str = "search_term") -> int:
    """解析行 → UPSERT startop_word_data（uk_word 幂等）。返回成功行数。

    data_source / word_type 参数供兜底报告通道复用同一 UPSERT 口径
    （《系统设计》§3.2.M1 Step 3「同表 UPSERT（source=report）」），
    MCP 主通道调用保持默认值，行为不变。
    """
    inserted = 0
    for row in rows:
        keyword = _pick(row, "搜索词", "关键词", "keyword", "search term", "searchterm", "query")
        asin = _pick(row, "asin", "商品", "产品")
        if not keyword or not asin:
            continue  # 无法归因产品的词不落库（打标必须按 ASIN 归因）
        stat = _to_date(_pick(row, "日期", "数据日期", "date", "statdate"), fallback_date)
        raw_extra = json.dumps(row, ensure_ascii=False, default=str)[:2000]
        try:
            db.execute(text("""
                INSERT INTO startop_word_data
                (tenant_id, site, store_id, profile_id, word_type, keyword, asin, stat_date, data_source, raw_extra)
                VALUES (:tid, :site, :store_id, :profile_id, :wtype, :kw, :asin, :stat, :src, :raw)
                ON DUPLICATE KEY UPDATE raw_extra = VALUES(raw_extra),
                                        data_source = VALUES(data_source),
                                        updated_at = CURRENT_TIMESTAMP
            """), {"tid": tenant_id, "site": site[:10], "store_id": store_id[:64],
                   "profile_id": profile_id[:64], "wtype": word_type,
                   "kw": str(keyword)[:200],
                   "asin": str(asin)[:100], "stat": stat.isoformat(),
                   "src": data_source, "raw": raw_extra})
            inserted += 1
        except Exception:
            continue  # 单行失败不阻断批次
    db.commit()
    return inserted


def _cleanup_old_data(db: Session, tenant_id: int):
    """滚动清理：词数据保留 90 天、拉取流水保留 180 天（系统设计 §4.2.4/§4.2.5）"""
    try:
        db.execute(text(
            "DELETE FROM startop_word_data WHERE tenant_id = :tid "
            "AND stat_date < :d1"), {"tid": tenant_id, "d1": date.today() - timedelta(days=90)})
        db.execute(text(
            "DELETE FROM startop_pull_logs WHERE tenant_id = :tid "
            "AND pull_date < :d2"), {"tid": tenant_id, "d2": date.today() - timedelta(days=180)})
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[startop_client] 清理失败（不阻断）: {e}")


def get_pull_status(db: Session, tenant_id: int, limit: int = 20) -> list:
    """最近拉取流水（状态卡片数据源）"""
    logs = db.query(StartopPullLog).filter(
        StartopPullLog.tenant_id == tenant_id
    ).order_by(StartopPullLog.created_at.desc()).limit(limit).all()
    return [{
        "id": l.id, "pull_date": l.pull_date.isoformat(), "tool": l.tool,
        "target_scope": l.target_scope, "status": l.status,
        "rows_parsed": l.rows_parsed, "retry_count": l.retry_count,
        "duration_ms": l.duration_ms, "error_msg": l.error_msg,
        "fallback_ready": l.fallback_ready,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    } for l in logs]
