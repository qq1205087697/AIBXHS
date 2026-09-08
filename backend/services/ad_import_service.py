"""
广告报表异步导入服务
参考 inventory_import_service.py 的异步导入模式
"""
import logging
import re
import pandas as pd
import io
import threading
from datetime import datetime, date as date_type
from decimal import Decimal
from typing import Dict, Any, Optional
from database.database import SessionLocal
from models.ad_report import AdReportSnapshot
from models.ad_daily import (
    AdCampaignDaily,
    AdKeywordDaily,
    AdSearchTermDaily,
    AdProductDaily,
)
from utils.excel_reader import safe_read_excel

logger = logging.getLogger(__name__)

# 按租户隔离的导入状态：{tenant_id: {running, task_id, progress, total, message, error}}
# 项目约束：tenant_id 必须显式传入，不能在 service 内硬编码
_import_status: Dict[int, Dict[str, Any]] = {}


def _get_tenant_status(tenant_id: int) -> Dict[str, Any]:
    """获取指定租户的导入状态（不存在时返回空闲状态）"""
    return _import_status.get(tenant_id, {
        "running": False,
        "task_id": None,
        "progress": 0,
        "total": 0,
        "message": "",
        "error": None,
    })


def _set_tenant_status(tenant_id: int, **kwargs) -> None:
    """更新指定租户的导入状态字段"""
    if tenant_id not in _import_status:
        _import_status[tenant_id] = {
            "running": False,
            "task_id": None,
            "progress": 0,
            "total": 0,
            "message": "",
            "error": None,
        }
    _import_status[tenant_id].update(kwargs)


def start_ad_import_async(file_content: bytes, filename: str, tenant_id: int, report_date: str = None) -> dict:
    """启动异步广告导入任务

    同租户内同时只允许一个导入任务（去重），不同租户互不阻塞。
    """
    # 仅检查当前租户的状态（不影响其他租户）
    if _get_tenant_status(tenant_id)["running"]:
        existing_task_id = _get_tenant_status(tenant_id)["task_id"]
        return {"task_id": existing_task_id, "message": "已有导入任务在运行中"}

    task_id = f"ad_import_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{tenant_id}"
    _set_tenant_status(
        tenant_id,
        running=True,
        task_id=task_id,
        progress=0,
        total=0,
        message="正在解析Excel文件...",
        error=None,
    )

    thread = threading.Thread(
        target=_import_ad_excel,
        args=(file_content, filename, tenant_id, task_id, report_date),
        daemon=True,
    )
    thread.start()
    return {"task_id": task_id, "message": "导入任务已启动"}


def get_ad_import_status(tenant_id: Optional[int] = None) -> dict:
    """获取导入状态

    Args:
        tenant_id: 租户ID。必须从认证端点传入，避免跨租户信息泄漏。
                   若为 None（用于后台监控），返回所有租户状态的合并快照。

    Returns:
        指定租户的状态 dict（或 None 时的合并视图）
    """
    if tenant_id is not None:
        return dict(_get_tenant_status(tenant_id))
    # 未指定租户时返回空闲状态（保守默认，不泄漏任何租户信息）
    return {
        "running": False,
        "task_id": None,
        "progress": 0,
        "total": 0,
        "message": "",
        "error": None,
    }


def _import_ad_excel(file_content: bytes, filename: str, tenant_id: int, task_id: str, report_date: str = None):
    """后台线程：执行Excel导入"""
    db = SessionLocal()
    batch_id = task_id

    try:
        # 日期获取优先级：URL参数 > 文件名提取 > 当天
        if report_date:
            try:
                target_date = datetime.strptime(report_date, "%Y-%m-%d").date()
            except ValueError:
                target_date = date_type.today()
        else:
            # 从文件名提取日期（如"广告活动数据_20260715.xlsx"或"广告活动数据20260715.xlsx"）
            date_match = re.search(r'(\d{4})(\d{2})(\d{2})', filename or '')
            if date_match:
                try:
                    target_date = date_type(int(date_match.group(1)), int(date_match.group(2)), int(date_match.group(3)))
                except ValueError:
                    target_date = date_type.today()
            else:
                target_date = date_type.today()

        print(f"[广告导入] 报告日期: {target_date}")

        # 读取Excel
        df = safe_read_excel(file_content)
        _set_tenant_status(tenant_id, total=len(df), message=f"正在导入 {len(df)} 行数据...")

        # 检测报告类型
        report_type = _detect_report_type(list(df.columns))

        records = []
        daily_records = []  # 日度分表数据
        for idx, row in df.iterrows():
            try:
                record = _parse_ad_row(row, tenant_id, batch_id, report_type, target_date)
                if record:
                    records.append(record)
                    # 构建日度分表数据（与主表同步，独立异常处理不影响主表写入）
                    try:
                        daily_row_data = _build_daily_row_data(row, report_type, target_date=target_date)
                        if daily_row_data:
                            daily_records.append(daily_row_data)
                    except Exception as daily_err:
                        logger.warning(f"第{idx+2}行日度分表数据构建失败: {daily_err}")
            except Exception as row_err:
                logger.warning(f"跳过第{idx+2}行: {row_err}")

            _set_tenant_status(tenant_id, progress=idx + 1)
            if (idx + 1) % 500 == 0:
                _set_tenant_status(tenant_id, message=f"已处理 {idx+1}/{len(df)} 行...")

        # 批量写入数据库 - AdReportSnapshot（原有逻辑，向后兼容）
        _set_tenant_status(tenant_id, message=f"正在写入数据库 ({len(records)} 条记录)...")
        if records:
            # 分批插入，每批500条
            batch_size = 500
            for i in range(0, len(records), batch_size):
                batch = records[i:i + batch_size]
                db.bulk_save_objects(batch)
                db.commit()
                _set_tenant_status(
                    tenant_id,
                    message=f"已写入 {min(i+batch_size, len(records))}/{len(records)} 条...",
                )

        # 写入日度分表（新增逻辑：upsert 到对应分表）
        if daily_records:
            _set_tenant_status(tenant_id, message=f"正在写入日度分表 ({len(daily_records)} 条记录)...")
            daily_success = 0
            daily_failed = 0
            for idx, row_data in enumerate(daily_records):
                try:
                    _write_to_daily_table(db, report_type, row_data, tenant_id, batch_id)
                    daily_success += 1
                    if (idx + 1) % 500 == 0:
                        _set_tenant_status(
                            tenant_id,
                            message=f"日度分表已写入 {idx+1}/{len(daily_records)} 条...",
                        )
                except Exception as daily_err:
                    daily_failed += 1
                    logger.warning(f"日度分表写入失败 (第{idx+1}条): {daily_err}")
            logger.info(f"日度分表写入完成: 成功 {daily_success}, 失败 {daily_failed}")

        _set_tenant_status(tenant_id, message=f"导入完成！共 {len(records)} 条记录")

        # 导入成功后自动触发规则引擎（仅 campaign 报告或所有报告都触发）
        # 异常不影响导入结果返回，仅记录日志
        if records:
            try:
                from services.ad_rules.rule_engine import RuleEngine
                rule_engine = RuleEngine()
                rule_summary = rule_engine.run_all_rules(
                    db=db,
                    tenant_id=tenant_id,
                    evaluation_date=target_date,
                    save_suggestions=True,
                )
                logger.info(
                    f"规则引擎自动触发完成 tenant_id={tenant_id} date={target_date} "
                    f"触发 {rule_summary.get('total_triggered', 0)} 条建议 "
                    f"已保存 {rule_summary.get('saved_count', 0)} 条"
                )
                _set_tenant_status(
                    tenant_id,
                    message=(
                        f"导入完成！共 {len(records)} 条记录，"
                        f"规则引擎触发 {rule_summary.get('total_triggered', 0)} 条建议"
                    ),
                )
            except Exception as rule_err:
                logger.error(
                    f"导入后规则引擎触发失败（不影响导入结果）: {rule_err}",
                    exc_info=True,
                )

        _set_tenant_status(tenant_id, running=False)

    except Exception as e:
        logger.error(f"广告导入失败: {e}")
        db.rollback()
        _set_tenant_status(
            tenant_id,
            error=str(e),
            message=f"导入失败: {str(e)}",
            running=False,
        )
    finally:
        db.close()


def _detect_report_type(columns: list) -> str:
    """根据列名检测报告类型

    按"主体字段"精确匹配列名（而非子串匹配），覆盖 5 个生产 Excel 场景：
      - 含"搜索词"列         → search_term
      - 含"商品投放"列       → product
      - 含"关键词"列         → keyword
      - 含"广告"列（ASIN/SKU）→ product（广告数据.xlsx，"广告"是主体）
      - 含"advertised_asin"列 → product（英文表头）
      - 含"广告活动"列（且无上述主体字段）→ campaign
      - 默认                  → campaign

    注意：5 个生产文件都含"广告活动"列（作为外键），但只有广告活动数据.xlsx
    把"广告活动"作为主体；其他 4 个文件的主体分别是关键词/搜索词/广告/商品投放。
    因此检测顺序必须主体字段优先，"广告活动"作为兜底。
    """
    # 标准化列名集合（去空格、转 str）
    col_set = {str(c).strip() for c in columns if c is not None}

    # 主体字段优先级检测（精确匹配，避免"广告花费"被误匹配为"广告"）
    if "搜索词" in col_set or "search_term" in col_set or "Customer Search Term" in col_set:
        return "search_term"
    if "商品投放" in col_set:
        return "product"
    if "关键词" in col_set or "keyword" in col_set or "Keyword" in col_set:
        return "keyword"
    # "广告"列存 ASIN/SKU（广告数据.xlsx），属于 product 报告变体
    if "广告" in col_set or "advertised_asin" in col_set or "Advertised ASIN" in col_set:
        return "product"
    # "广告活动"作为主体（广告活动数据.xlsx），无其他主体字段时才识别为 campaign
    if "广告活动" in col_set or "campaign_name" in col_set or "Campaign Name" in col_set:
        return "campaign"
    return "campaign"  # 默认


# ==================== 值解析辅助函数 ====================

def _parse_store(value):
    """解析站点/店铺：US/A → (country=US, account=A)"""
    if not value or pd.isna(value):
        return None, None
    s = str(value).strip()
    if "/" in s:
        parts = s.split("/", 1)
        country = parts[0].strip() if parts[0].strip() else None
        account = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        return country, account
    return s, None


def _parse_budget(value):
    """解析预算：$45.00 每日 → 45.00"""
    if not value or pd.isna(value):
        return None
    s = str(value).strip()
    # 提取数字部分（含小数）
    m = re.search(r'[\d.]+', s.replace(',', ''))
    if m:
        try:
            return float(m.group())
        except ValueError:
            return None
    return None


def _parse_ad_type(value):
    """解析广告类型：SP自动 → (campaign_type=SP, targeting_type=Auto)

    返回 (campaign_type, targeting_type)。
    其中 campaign_type 取 SP/SB/SD；targeting_type 取 Auto/Manual。
    """
    if not value or pd.isna(value):
        return None, None
    s = str(value).strip().upper()
    raw = str(value)
    campaign_type = None
    targeting_type = None
    if s.startswith("SP"):
        campaign_type = "SP"
    elif s.startswith("SB"):
        campaign_type = "SB"
    elif s.startswith("SD"):
        campaign_type = "SD"
    if "自动" in raw:
        targeting_type = "Auto"
    elif "手动" in raw:
        targeting_type = "Manual"
    return campaign_type, targeting_type


def _parse_suggested_bid(value):
    """解析建议竞价：$0.36 ($0.3-$0.45) → 0.36"""
    if not value or pd.isna(value):
        return None
    s = str(value).strip()
    # 匹配第一个 $ 后的数字
    m = re.search(r'\$([\d.]+)', s)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


def _parse_special_value(value):
    """处理特殊值：∞/--/空 → None，其余返回原字符串"""
    if value is None or pd.isna(value):
        return None
    s = str(value).strip()
    if s in ("", "--", "∞", "-", "——", "---"):
        return None
    return s


def _parse_special_float(value):
    """处理特殊值的浮点解析：∞/--/空 → None，否则尝试转为 float"""
    s = _parse_special_value(value)
    if s is None:
        return None
    try:
        return float(str(s).replace(',', '').replace('%', ''))
    except (ValueError, TypeError):
        return None


def _parse_special_int(value):
    """处理特殊值的整数解析：∞/--/空 → None，否则尝试转为 int"""
    f = _parse_special_float(value)
    if f is None:
        return None
    try:
        return int(f)
    except (ValueError, TypeError):
        return None


def _parse_decimal_or_none(value):
    """将解析后的数值转为 Decimal，None 保持 None"""
    if value is None:
        return None
    try:
        return Decimal(str(round(float(value), 4)))
    except (ValueError, TypeError):
        return None


def _parse_date_value(value):
    """解析日期值，支持 datetime/字符串/Excel日期"""
    if value is None or pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date_type):
        return value
    try:
        return pd.to_datetime(value).date()
    except Exception:
        return None


def _parse_ad_field(value):
    """解析"广告"字段：B0C4GHGWRC/USA-A-341 → (asin=B0C4GHGWRC, sku=USA-A-341)"""
    if not value or pd.isna(value):
        return None, None
    s = str(value).strip()
    if "/" in s:
        parts = s.split("/", 1)
        asin = parts[0].strip() if parts[0].strip() else None
        sku = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        return asin, sku
    # 若无分隔符，按 ASIN 格式（10位字母数字）判断
    if len(s) == 10 and s.isalnum():
        return s, None
    return None, s


def _safe_get(row, *keys):
    """安全地从行中获取值，支持多个备选键名"""
    for key in keys:
        if key in row:
            val = row[key]
            if pd.notna(val):
                return val
    return None


def _safe_float(row, *keys):
    """安全获取浮点数"""
    val = _safe_get(row, *keys)
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _safe_int(row, *keys):
    """安全获取整数"""
    val = _safe_get(row, *keys)
    if val is None:
        return 0
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def _safe_decimal(row, *keys):
    """安全获取Decimal"""
    val = _safe_float(row, *keys)
    return Decimal(str(round(val, 2)))


def _parse_ad_row(row, tenant_id: int, batch_id: str, report_type: str, target_date=None):
    """解析Excel行数据为AdReportSnapshot对象

    支持中文表头映射与特殊值解析（∞/--/空 → None）。
    ACOS/ROAS/CPC 等派生指标，Excel 有值时优先使用，None 时由系统重算。
    """
    # ---- 站点/店铺：US/A → country=US, account=A ----
    store_val = _safe_get(row, '站点/店铺', '站点', '店铺', 'store', 'account', 'Account', '店铺名', '账号', 'country', 'Country', '国家')
    country_parsed, account_parsed = _parse_store(store_val)
    country = country_parsed if country_parsed is not None else _safe_get(row, 'country', 'Country', '国家', '站点')
    account = account_parsed if account_parsed is not None else _safe_get(row, 'account', 'Account', '店铺', '店铺名', '账号')

    # ---- 基础指标 ----
    impressions = _safe_int(row, 'impressions', 'Impressions', '展示量', '展示', '曝光')
    clicks = _safe_int(row, 'clicks', 'Clicks', '点击量', '点击')
    spend = _safe_decimal(row, 'spend', 'Spend', '花费', '成本', '广告花费')
    orders = _safe_int(row, 'orders', 'Orders', '订单量', '订单', '广告订单')
    sales = _safe_decimal(row, 'sales', 'Sales', '销售额', '销售', '广告销售额')

    # ---- 派生指标：Excel 优先，缺失/特殊值时由系统重算 ----
    ctr_raw = _parse_special_float(_safe_get(row, 'ctr', 'CTR', '点击率'))
    cpc_raw = _parse_special_float(_safe_get(row, 'cpc', 'CPC', '单次点击成本'))
    cvr_raw = _parse_special_float(_safe_get(row, 'cvr', 'CVR', '转化率'))
    acos_raw = _parse_special_float(_safe_get(row, 'acos', 'ACOS', '广告销售成本'))
    roas_raw = _parse_special_float(_safe_get(row, 'roas', 'ROAS', '投入产出比'))

    ctr = _parse_decimal_or_none(ctr_raw) if ctr_raw is not None else (
        Decimal(str(round(clicks / impressions, 4))) if impressions > 0 else Decimal('0')
    )
    cpc = _parse_decimal_or_none(cpc_raw) if cpc_raw is not None else (
        Decimal(str(round(float(spend) / clicks, 4))) if clicks > 0 else Decimal('0')
    )
    cvr = _parse_decimal_or_none(cvr_raw) if cvr_raw is not None else (
        Decimal(str(round(orders / clicks, 4))) if clicks > 0 else Decimal('0')
    )
    # ACOS：∞ → None 时由系统重算
    if acos_raw is not None:
        acos = _parse_decimal_or_none(acos_raw)
    else:
        acos = Decimal(str(round(float(spend) / float(sales), 4))) if float(sales) > 0 else Decimal('0')
    # ROAS：∞ → None 时由系统重算
    if roas_raw is not None:
        roas = _parse_decimal_or_none(roas_raw)
    else:
        roas = Decimal(str(round(float(sales) / float(spend), 4))) if float(spend) > 0 else Decimal('0')

    cpa = Decimal(str(round(float(spend) / orders, 4))) if orders > 0 else Decimal('0')

    # ---- CPO ----
    cpo_raw = _parse_special_float(_safe_get(row, 'cpo', 'CPO', '单次订单成本'))
    cpo = _parse_decimal_or_none(cpo_raw) if cpo_raw is not None else (
        Decimal(str(round(float(spend) / orders, 4))) if orders > 0 else None
    )

    # ---- 维度字段（按报告类型/列名映射） ----
    campaign_name = _safe_get(row, 'campaign_name', 'Campaign Name', '广告活动', '广告活动名称', '活动名称')
    ad_group_name = _safe_get(row, 'ad_group_name', 'Ad Group Name', '广告组名称', '广告组')
    keyword_text = _safe_get(row, 'keyword', 'Keyword', '关键词', '投放关键词')
    match_type = _safe_get(row, 'match_type', 'Match Type', '匹配类型')
    search_term = _safe_get(row, 'search_term', 'Search Term', 'Customer Search Term', '客户搜索词', '搜索词')

    # 广告类型：SP自动 / SP手动 → 原值存入 ad_type（campaign_type/targeting_type 仅用于日度分表）
    ad_type_raw = _safe_get(row, 'ad_type', 'Ad Type', '广告类型', '类型')
    ad_type = _parse_special_value(ad_type_raw)

    # "广告"字段：B0C4GHGWRC/USA-A-341 → ASIN/SKU
    ad_field = _safe_get(row, '广告', 'ad', 'Ad')
    parsed_asin, parsed_sku = _parse_ad_field(ad_field)
    advertised_asin = _safe_get(row, 'advertised_asin', 'Advertised ASIN', '推广ASIN', '推广的ASIN', 'ASIN') or parsed_asin
    advertised_sku = _safe_get(row, 'advertised_sku', 'Advertised SKU', '推广SKU', 'SKU') or parsed_sku

    # 状态 / 服务状态
    status = _parse_special_value(_safe_get(row, 'status', 'Status', '状态'))
    service_status = _parse_special_value(_safe_get(row, 'service_status', 'Service Status', '服务状态'))

    # 预算使用比例（注：AdReportSnapshot 无 budget 字段，仅保留 budget_utilization）
    budget_utilization_raw = _parse_special_float(
        _safe_get(row, 'budget_utilization', 'Budget Utilization', '预算使用比例', '预算使用率')
    )
    budget_utilization = _parse_decimal_or_none(budget_utilization_raw)

    # 广告花费占比
    spend_ratio_raw = _parse_special_float(_safe_get(row, 'spend_ratio', 'Spend Ratio', '广告花费占比', '花费占比'))
    spend_ratio = _parse_decimal_or_none(spend_ratio_raw)

    # 搜索结果首页首位(IS)
    tos_raw = _parse_special_float(
        _safe_get(row, 'top_of_search_impressions', 'Top of Search Impressions',
                  '搜索结果首页首位(IS)', '搜索结果首页首位', '首页首位')
    )
    top_of_search_impressions = _parse_decimal_or_none(tos_raw)

    # ABA日排名（-- → None）
    aba_rank = _parse_special_int(_safe_get(row, 'aba_rank', 'ABA Rank', 'ABA日排名', 'ABA排名'))

    # 建议竞价：$0.36 ($0.3-$0.45) → 0.36
    suggested_bid_raw = _safe_get(row, 'suggested_bid', 'Suggested Bid', '建议竞价')
    suggested_bid = _parse_decimal_or_none(_parse_suggested_bid(suggested_bid_raw))

    # 开始时间
    start_date = _parse_date_value(_safe_get(row, 'start_date', 'Start Date', '开始时间', '活动开始时间'))

    # 广告组合
    portfolio_name = _parse_special_value(
        _safe_get(row, 'portfolio_name', 'Portfolio Name', '广告组合', '组合名称')
    )

    # listing 浏览量（-- → None）
    listing_views = _parse_special_int(
        _safe_get(row, 'listing_views', 'Listing Views', 'listing浏览量', 'Listing浏览量')
    )

    # 价格 / 评分 / 评分数
    price = _parse_decimal_or_none(_parse_special_float(_safe_get(row, 'price', 'Price', '价格')))
    rating = _parse_decimal_or_none(_parse_special_float(_safe_get(row, 'rating', 'Rating', '评分')))
    rating_count = _parse_special_int(_safe_get(row, 'rating_count', 'Rating Count', '评分数', '评价数'))

    # FBM 可售 / FBA 库存
    fbm_available = _parse_special_int(_safe_get(row, 'fbm_available', 'FBM Available', 'FBM可售', 'FBM 可售'))
    fba_stock = _parse_special_int(_safe_get(row, 'fba_stock', 'FBA Stock', 'FBA可用库存', 'FBA 可用库存'))

    # 搜索词来源
    search_term_source = _parse_special_value(
        _safe_get(row, 'search_term_source', 'Search Term Source', '搜索词来源')
    )

    return AdReportSnapshot(
        tenant_id=tenant_id,
        account=account,
        country=country,
        date=target_date,
        campaign_name=campaign_name,
        ad_group_name=ad_group_name,
        report_type=report_type,
        keyword=keyword_text,
        match_type=match_type,
        search_term=search_term,
        ad_type=ad_type,
        advertised_asin=advertised_asin,
        advertised_sku=advertised_sku,
        impressions=impressions,
        clicks=clicks,
        spend=spend,
        orders=orders,
        sales=sales,
        ctr=ctr,
        cpc=cpc,
        acos=acos,
        roas=roas,
        cvr=cvr,
        cpa=cpa,
        cpo=cpo,
        spend_ratio=spend_ratio,
        top_of_search_impressions=top_of_search_impressions,
        aba_rank=aba_rank,
        suggested_bid=suggested_bid,
        budget_utilization=budget_utilization,
        start_date=start_date,
        portfolio_name=portfolio_name,
        listing_views=listing_views,
        price=price,
        rating=rating,
        rating_count=rating_count,
        fbm_available=fbm_available,
        fba_stock=fba_stock,
        search_term_source=search_term_source,
        service_status=service_status,
        status=status,
        batch_id=batch_id,
    )


# ==================== 日度分表写入逻辑（新增） ====================

def _parse_date(row):
    """从Excel行解析日期值"""
    date_val = _safe_get(row, 'date', 'Date', '日期', '日期时间')
    if date_val is None:
        return None
    if isinstance(date_val, datetime):
        return date_val.date()
    try:
        return pd.to_datetime(date_val).date()
    except Exception:
        return None


def _safe_str(val):
    """安全转换为字符串，None 保持为 None"""
    if val is None:
        return None
    return str(val)


def _build_daily_row_data(row, report_type, target_date=None):
    """从Excel行构建日度分表数据字典

    根据 report_type 提取对应分表所需的字段。
    返回 dict，键为模型字段名，值为解析后的数据。
    支持中文表头与特殊值解析。

    Args:
        row: pandas DataFrame 行
        report_type: 报告类型 campaign/keyword/search_term/product
        target_date: 报告日期（生产 Excel 无 date 列时由调用方传入，
                     优先级行内 date 列 > target_date > None）
    """
    # ---- 站点/店铺解析 ----
    store_val = _safe_get(row, '站点/店铺', '站点', '店铺', 'store', 'account', 'Account', '店铺名', '账号', 'country', 'Country', '国家')
    country_parsed, account_parsed = _parse_store(store_val)
    country = country_parsed if country_parsed is not None else _safe_get(row, 'country', 'Country', '国家', '站点')
    account = account_parsed if account_parsed is not None else _safe_get(row, 'account', 'Account', '店铺', '店铺名', '账号')

    # 日期：行内有 date 列时优先用行内值，否则用 target_date
    row_date = _parse_date(row)
    data_date = row_date if row_date is not None else target_date

    # 公共字段
    data = {
        'account': account,
        'country': country,
        'date': data_date,
        'campaign_name': _safe_get(row, 'campaign_name', 'Campaign Name', '广告活动', '广告活动名称', '活动名称'),
        'ad_group_name': _safe_get(row, 'ad_group_name', 'Ad Group Name', '广告组名称', '广告组'),
        'impressions': _safe_int(row, 'impressions', 'Impressions', '展示量', '展示', '曝光'),
        'clicks': _safe_int(row, 'clicks', 'Clicks', '点击量', '点击'),
        'spend': _safe_decimal(row, 'spend', 'Spend', '花费', '成本', '广告花费'),
        'orders': _safe_int(row, 'orders', 'Orders', '订单量', '订单', '广告订单'),
        'sales': _safe_decimal(row, 'sales', 'Sales', '销售额', '销售', '广告销售额'),
    }

    # 派生指标计算（Excel 优先，None 时由系统重算）
    impressions = data['impressions']
    clicks = data['clicks']
    spend_f = float(data['spend'])
    sales_f = float(data['sales'])
    orders = data['orders']

    ctr_raw = _parse_special_float(_safe_get(row, 'ctr', 'CTR', '点击率'))
    cpc_raw = _parse_special_float(_safe_get(row, 'cpc', 'CPC', '单次点击成本'))
    cvr_raw = _parse_special_float(_safe_get(row, 'cvr', 'CVR', '转化率'))
    acos_raw = _parse_special_float(_safe_get(row, 'acos', 'ACOS', '广告销售成本'))
    roas_raw = _parse_special_float(_safe_get(row, 'roas', 'ROAS', '投入产出比'))

    data['ctr'] = _parse_decimal_or_none(ctr_raw) if ctr_raw is not None else (
        Decimal(str(round(clicks / impressions, 4))) if impressions > 0 else Decimal('0')
    )
    data['cpc'] = _parse_decimal_or_none(cpc_raw) if cpc_raw is not None else (
        Decimal(str(round(spend_f / clicks, 4))) if clicks > 0 else Decimal('0')
    )
    data['cvr'] = _parse_decimal_or_none(cvr_raw) if cvr_raw is not None else (
        Decimal(str(round(orders / clicks, 4))) if clicks > 0 else Decimal('0')
    )
    if acos_raw is not None:
        data['acos'] = _parse_decimal_or_none(acos_raw)
    else:
        data['acos'] = Decimal(str(round(spend_f / sales_f, 4))) if sales_f > 0 else Decimal('0')
    if roas_raw is not None:
        data['roas'] = _parse_decimal_or_none(roas_raw)
    else:
        data['roas'] = Decimal(str(round(sales_f / spend_f, 4))) if spend_f > 0 else Decimal('0')

    # 按报告类型添加特有字段
    if report_type == 'campaign':
        data['campaign_id'] = _safe_str(_safe_get(row, 'campaign_id', 'Campaign ID', '广告活动ID'))
        # 广告类型：SP自动 → campaign_type=SP, targeting_type=Auto
        ad_type_raw = _safe_get(row, '广告类型', 'ad_type', 'Ad Type', 'campaign_type', 'Campaign Type', '类型')
        ct, tt = _parse_ad_type(ad_type_raw)
        data['campaign_type'] = ct if ct is not None else _parse_special_value(ad_type_raw)
        data['targeting_type'] = tt
        data['bidding_strategy'] = _parse_special_value(
            _safe_get(row, 'bidding_strategy', 'Bidding Strategy', '竞价策略')
        )
        # 预算：$45.00 每日 → 45.00
        budget_raw = _safe_get(row, 'budget', 'Budget', '预算', '日预算')
        budget_parsed = _parse_budget(budget_raw)
        data['budget'] = _parse_decimal_or_none(budget_parsed) if budget_parsed is not None else Decimal('0')
        data['status'] = _parse_special_value(_safe_get(row, 'status', 'Status', '状态'))
        data['portfolio_name'] = _parse_special_value(
            _safe_get(row, 'portfolio_name', 'Portfolio Name', '广告组合', '组合名称')
        )
        # 预算使用比例
        budget_util_raw = _parse_special_float(
            _safe_get(row, 'budget_utilization', 'Budget Utilization', '预算使用比例', '预算使用率')
        )
        data['budget_utilization'] = _parse_decimal_or_none(budget_util_raw)
    elif report_type == 'keyword':
        data['campaign_id'] = _safe_str(_safe_get(row, 'campaign_id', 'Campaign ID', '广告活动ID'))
        data['keyword_id'] = _safe_str(_safe_get(row, 'keyword_id', 'Keyword ID', '关键词ID'))
        data['keyword_text'] = _safe_get(row, 'keyword', 'Keyword', '关键词', '投放关键词')
        data['match_type'] = _safe_get(row, 'match_type', 'Match Type', '匹配类型')
        data['bid'] = _safe_decimal(row, 'bid', 'Bid', '出价', '竞价')
    elif report_type == 'search_term':
        data['campaign_id'] = _safe_str(_safe_get(row, 'campaign_id', 'Campaign ID', '广告活动ID'))
        data['search_term'] = _safe_get(row, 'search_term', 'Search Term', 'Customer Search Term', '客户搜索词', '搜索词')
        data['keyword_text'] = _safe_get(row, 'keyword', 'Keyword', '关键词', '投放关键词')
        data['match_type'] = _safe_get(row, 'match_type', 'Match Type', '匹配类型')
    elif report_type == 'product':
        data['campaign_id'] = _safe_str(_safe_get(row, 'campaign_id', 'Campaign ID', '广告活动ID'))
        data['ad_id'] = _safe_str(_safe_get(row, 'ad_id', 'Ad ID', '广告ID'))
        # "广告"字段：B0C4GHGWRC/USA-A-341 → ASIN/SKU（广告数据.xlsx 格式）
        ad_field = _safe_get(row, '广告', 'ad', 'Ad')
        parsed_asin, parsed_sku = _parse_ad_field(ad_field)
        # "商品投放"字段（商品投放数据.xlsx 格式）：
        #   - 'asin = B0CDPNGTN8'
        #   - 'asin = B0XXX, sku = YYY'
        #   - 直接 ASIN 'B0XXX'
        # "广告"列优先，"商品投放"列作为回退
        product_targeting_field = _safe_get(row, '商品投放', 'product_targeting', 'Product Targeting')
        pt_asin, pt_sku = _parse_product_targeting_field(product_targeting_field)
        data['advertised_asin'] = (
            _safe_get(row, 'advertised_asin', 'Advertised ASIN', '推广ASIN', '推广的ASIN', 'ASIN')
            or parsed_asin
            or pt_asin
        )
        data['advertised_sku'] = (
            _safe_get(row, 'advertised_sku', 'Advertised SKU', '推广SKU', 'SKU')
            or parsed_sku
            or pt_sku
        )

    return data


def _parse_product_targeting_field(value):
    """解析"商品投放"列字符串为 (asin, sku)。

    支持的格式（商品投放数据.xlsx 实测）:
      - 'asin = B0CDPNGTN8'                 → ('B0CDPNGTN8', None)
      - 'asin = B0XXX, sku = YYY'           → ('B0XXX', 'YYY')
      - 'B0XXX' (直接 ASIN，无前缀)         → ('B0XXX', None)
      - None / 空 / 非字符串                 → (None, None)
    """
    if not value or not isinstance(value, str):
        return None, None
    text = value.strip()
    if not text:
        return None, None
    import re as _re
    # 匹配 'asin = B0XXX' 格式
    asin_match = _re.search(r'asin\s*=\s*([A-Za-z0-9]+)', text, _re.IGNORECASE)
    sku_match = _re.search(r'sku\s*=\s*([A-Za-z0-9\-_]+)', text, _re.IGNORECASE)
    if asin_match:
        asin = asin_match.group(1)
        sku = sku_match.group(1) if sku_match else None
        return asin, sku
    # 直接 ASIN（无前缀，假设是 B 开头的字母数字串，长度 10）
    direct_match = _re.match(r'^([A-Z0-9]{10})$', text)
    if direct_match:
        return direct_match.group(1), None
    return None, None


def _write_to_daily_table(db, report_type, row_data, tenant_id, batch_id):
    """将数据写入对应的日度分表（upsert 逻辑）

    根据 report_type 选择对应日表模型：
      - campaign    → AdCampaignDaily
      - keyword     → AdKeywordDaily
      - search_term → AdSearchTermDaily
      - product     → AdProductDaily

    Upsert 规则（按优先级）：
      1. 业务ID 存在时：tenant_id + date + business_id
      2. 业务ID 缺失时（生产 Excel 无 ID 列）：使用复合键
         - campaign    → tenant_id + date + account + campaign_name
         - keyword     → tenant_id + date + account + campaign_name + keyword_text
         - search_term → tenant_id + date + account + campaign_name + search_term
         - product     → tenant_id + date + account + campaign_name + advertised_asin
      3. 主体字段（campaign_name/keyword_text/search_term/advertised_asin）缺失时跳过

    生产场景：5 个 Excel 均无业务 ID 列，必须依赖复合键。
    """
    # report_type → 模型映射
    model_map = {
        'campaign': AdCampaignDaily,
        'keyword': AdKeywordDaily,
        'search_term': AdSearchTermDaily,
        'product': AdProductDaily,
    }

    # report_type → 业务ID字段映射（优先用业务ID）
    business_id_map = {
        'campaign': 'campaign_id',
        'keyword': 'keyword_id',
        'search_term': 'search_term',
        'product': 'ad_id',
    }

    # report_type → 复合键字段映射（业务ID缺失时回退使用）
    # 复合键 = (tenant_id, date) + 这些字段
    composite_key_map = {
        'campaign': ['account', 'campaign_name'],
        'keyword': ['account', 'campaign_name', 'keyword_text'],
        'search_term': ['account', 'campaign_name', 'search_term'],
        'product': ['account', 'campaign_name', 'advertised_asin'],
    }

    model = model_map.get(report_type)
    if not model:
        logger.warning(f"未知的报告类型: {report_type}，跳过分表写入")
        return

    business_id_field = business_id_map[report_type]
    business_id_value = row_data.get(business_id_field)
    date_val = row_data.get('date')

    if not date_val:
        logger.warning(
            f"缺少日期，跳过分表写入: date={date_val}, report_type={report_type}"
        )
        return

    # 决定 upsert 键：业务ID 优先，否则用复合键
    use_composite = not business_id_value
    if use_composite:
        # 检查复合键字段是否齐全
        composite_fields = composite_key_map[report_type]
        composite_values = {f: row_data.get(f) for f in composite_fields}
        missing_fields = [f for f, v in composite_values.items() if not v]
        if missing_fields:
            logger.warning(
                f"缺少业务ID({business_id_field})且复合键字段缺失({missing_fields})，"
                f"跳过分表写入: date={date_val}, report_type={report_type}"
            )
            return

    try:
        # 构建查询过滤条件
        query_filter = [
            model.tenant_id == tenant_id,
            model.date == date_val,
        ]
        if use_composite:
            for field, value in composite_values.items():
                query_filter.append(getattr(model, field) == value)
            key_desc = f"复合键({'+'.join(composite_fields)})"
        else:
            query_filter.append(getattr(model, business_id_field) == business_id_value)
            key_desc = f"{business_id_field}={business_id_value}"

        existing = db.query(model).filter(*query_filter).first()

        if existing:
            # 更新已有记录（跳过 upsert 键字段）
            skip_keys = {'tenant_id', 'date'}
            if use_composite:
                skip_keys.update(composite_fields)
            else:
                skip_keys.add(business_id_field)
            for key, value in row_data.items():
                if key in skip_keys:
                    continue
                if hasattr(existing, key) and value is not None:
                    setattr(existing, key, value)
            existing.batch_id = batch_id
            logger.debug(
                f"更新{report_type}分表: {key_desc}, date={date_val}"
            )
        else:
            # 插入新记录
            insert_data = dict(row_data)  # 复制一份，避免修改原始数据
            insert_data['tenant_id'] = tenant_id
            insert_data['batch_id'] = batch_id
            new_record = model(**insert_data)
            db.add(new_record)
            logger.debug(
                f"插入{report_type}分表: {key_desc}, date={date_val}"
            )

        db.commit()

    except Exception as e:
        logger.error(f"写入{report_type}分表失败: {e}")
        db.rollback()
        raise