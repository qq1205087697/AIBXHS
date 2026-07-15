"""
广告报表异步导入服务
参考 inventory_import_service.py 的异步导入模式
"""
import logging
import pandas as pd
import io
import threading
from datetime import datetime
from decimal import Decimal
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

# 全局导入状态
_import_status = {
    "running": False,
    "task_id": None,
    "progress": 0,
    "total": 0,
    "message": "",
    "error": None,
}


def start_ad_import_async(file_content: bytes, filename: str, tenant_id: int) -> dict:
    """启动异步广告导入任务"""
    global _import_status
    if _import_status["running"]:
        return {"task_id": _import_status["task_id"], "message": "已有导入任务在运行中"}

    task_id = f"ad_import_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    _import_status = {
        "running": True,
        "task_id": task_id,
        "progress": 0,
        "total": 0,
        "message": "正在解析Excel文件...",
        "error": None,
    }

    thread = threading.Thread(
        target=_import_ad_excel,
        args=(file_content, filename, tenant_id, task_id),
        daemon=True,
    )
    thread.start()
    return {"task_id": task_id, "message": "导入任务已启动"}


def get_ad_import_status() -> dict:
    """获取导入状态"""
    return dict(_import_status)


def _import_ad_excel(file_content: bytes, filename: str, tenant_id: int, task_id: str):
    """后台线程：执行Excel导入"""
    global _import_status
    db = SessionLocal()
    batch_id = task_id

    try:
        # 读取Excel
        df = safe_read_excel(file_content)
        _import_status["total"] = len(df)
        _import_status["message"] = f"正在导入 {len(df)} 行数据..."

        # 检测报告类型
        report_type = _detect_report_type(df)

        records = []
        daily_records = []  # 日度分表数据
        for idx, row in df.iterrows():
            try:
                record = _parse_ad_row(row, tenant_id, batch_id, report_type)
                if record:
                    records.append(record)
                    # 构建日度分表数据（与主表同步，独立异常处理不影响主表写入）
                    try:
                        daily_row_data = _build_daily_row_data(row, report_type)
                        if daily_row_data:
                            daily_records.append(daily_row_data)
                    except Exception as daily_err:
                        logger.warning(f"第{idx+2}行日度分表数据构建失败: {daily_err}")
            except Exception as row_err:
                logger.warning(f"跳过第{idx+2}行: {row_err}")

            _import_status["progress"] = idx + 1
            if (idx + 1) % 500 == 0:
                _import_status["message"] = f"已处理 {idx+1}/{len(df)} 行..."

        # 批量写入数据库 - AdReportSnapshot（原有逻辑，向后兼容）
        _import_status["message"] = f"正在写入数据库 ({len(records)} 条记录)..."
        if records:
            # 分批插入，每批500条
            batch_size = 500
            for i in range(0, len(records), batch_size):
                batch = records[i:i + batch_size]
                db.bulk_save_objects(batch)
                db.commit()
                _import_status["message"] = f"已写入 {min(i+batch_size, len(records))}/{len(records)} 条..."

        # 写入日度分表（新增逻辑：upsert 到对应分表）
        if daily_records:
            _import_status["message"] = f"正在写入日度分表 ({len(daily_records)} 条记录)..."
            daily_success = 0
            daily_failed = 0
            for idx, row_data in enumerate(daily_records):
                try:
                    _write_to_daily_table(db, report_type, row_data, tenant_id, batch_id)
                    daily_success += 1
                    if (idx + 1) % 500 == 0:
                        _import_status["message"] = f"日度分表已写入 {idx+1}/{len(daily_records)} 条..."
                except Exception as daily_err:
                    daily_failed += 1
                    logger.warning(f"日度分表写入失败 (第{idx+1}条): {daily_err}")
            logger.info(f"日度分表写入完成: 成功 {daily_success}, 失败 {daily_failed}")

        _import_status["message"] = f"导入完成！共 {len(records)} 条记录"
        _import_status["running"] = False

    except Exception as e:
        logger.error(f"广告导入失败: {e}")
        db.rollback()
        _import_status["error"] = str(e)
        _import_status["message"] = f"导入失败: {str(e)}"
        _import_status["running"] = False
    finally:
        db.close()


def _detect_report_type(df: pd.DataFrame) -> str:
    """根据列名检测报告类型"""
    columns_lower = [c.lower().replace(' ', '_') for c in df.columns]

    if any('search_term' in c or '客户搜索词' in c for c in columns_lower):
        return 'search_term'
    elif any('keyword' in c or '关键词' in c for c in columns_lower):
        return 'keyword'
    elif any('advertised_asin' in c or '推广asin' in c or '推广的asin' in c for c in columns_lower):
        return 'product'
    else:
        return 'campaign'


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


def _parse_ad_row(row, tenant_id: int, batch_id: str, report_type: str):
    """解析Excel行数据为AdReportSnapshot对象"""
    # 基础指标
    impressions = _safe_int(row, 'impressions', 'Impressions', '展示量', '展示')
    clicks = _safe_int(row, 'clicks', 'Clicks', '点击量', '点击')
    spend = _safe_decimal(row, 'spend', 'Spend', '花费', '成本')
    orders = _safe_int(row, 'orders', 'Orders', '订单量', '订单')
    sales = _safe_decimal(row, 'sales', 'Sales', '销售额', '销售')

    # 派生指标计算
    ctr = Decimal(str(round(clicks / impressions, 4))) if impressions > 0 else Decimal('0')
    cpc = Decimal(str(round(float(spend) / clicks, 4))) if clicks > 0 else Decimal('0')
    acos = Decimal(str(round(float(spend) / float(sales), 4))) if float(sales) > 0 else Decimal('0')
    roas = Decimal(str(round(float(sales) / float(spend), 4))) if float(spend) > 0 else Decimal('0')
    cvr = Decimal(str(round(orders / clicks, 4))) if clicks > 0 else Decimal('0')
    cpa = Decimal(str(round(float(spend) / orders, 4))) if orders > 0 else Decimal('0')

    # 日期
    date_val = _safe_get(row, 'date', 'Date', '日期', '日期时间')
    if date_val and not isinstance(date_val, datetime):
        try:
            date_val = pd.to_datetime(date_val).date()
        except Exception:
            date_val = None

    return AdReportSnapshot(
        tenant_id=tenant_id,
        account=_safe_get(row, 'account', 'Account', '店铺', '店铺名', '账号'),
        country=_safe_get(row, 'country', 'Country', '国家', '站点'),
        date=date_val,
        campaign_name=_safe_get(row, 'campaign_name', 'Campaign Name', '广告活动名称', '活动名称'),
        ad_group_name=_safe_get(row, 'ad_group_name', 'Ad Group Name', '广告组名称', '广告组'),
        report_type=report_type,
        keyword=_safe_get(row, 'keyword', 'Keyword', '关键词', '投放关键词'),
        match_type=_safe_get(row, 'match_type', 'Match Type', '匹配类型'),
        search_term=_safe_get(row, 'search_term', 'Search Term', 'Customer Search Term', '客户搜索词', '搜索词'),
        ad_type=_safe_get(row, 'ad_type', 'Ad Type', '广告类型', '类型'),
        advertised_asin=_safe_get(row, 'advertised_asin', 'Advertised ASIN', '推广ASIN', '推广的ASIN', 'ASIN'),
        advertised_sku=_safe_get(row, 'advertised_sku', 'Advertised SKU', '推广SKU', 'SKU'),
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


def _build_daily_row_data(row, report_type):
    """从Excel行构建日度分表数据字典

    根据 report_type 提取对应分表所需的字段。
    返回 dict，键为模型字段名，值为解析后的数据。
    """
    # 公共字段
    data = {
        'account': _safe_get(row, 'account', 'Account', '店铺', '店铺名', '账号'),
        'country': _safe_get(row, 'country', 'Country', '国家', '站点'),
        'date': _parse_date(row),
        'campaign_name': _safe_get(row, 'campaign_name', 'Campaign Name', '广告活动名称', '活动名称'),
        'ad_group_name': _safe_get(row, 'ad_group_name', 'Ad Group Name', '广告组名称', '广告组'),
        'impressions': _safe_int(row, 'impressions', 'Impressions', '展示量', '展示'),
        'clicks': _safe_int(row, 'clicks', 'Clicks', '点击量', '点击'),
        'spend': _safe_decimal(row, 'spend', 'Spend', '花费', '成本'),
        'orders': _safe_int(row, 'orders', 'Orders', '订单量', '订单'),
        'sales': _safe_decimal(row, 'sales', 'Sales', '销售额', '销售'),
    }

    # 派生指标计算
    impressions = data['impressions']
    clicks = data['clicks']
    spend_f = float(data['spend'])
    sales_f = float(data['sales'])
    orders = data['orders']

    data['ctr'] = Decimal(str(round(clicks / impressions, 4))) if impressions > 0 else Decimal('0')
    data['cpc'] = Decimal(str(round(spend_f / clicks, 4))) if clicks > 0 else Decimal('0')
    data['acos'] = Decimal(str(round(spend_f / sales_f, 4))) if sales_f > 0 else Decimal('0')
    data['roas'] = Decimal(str(round(sales_f / spend_f, 4))) if spend_f > 0 else Decimal('0')
    data['cvr'] = Decimal(str(round(orders / clicks, 4))) if clicks > 0 else Decimal('0')

    # 按报告类型添加特有字段
    if report_type == 'campaign':
        data['campaign_id'] = _safe_str(_safe_get(row, 'campaign_id', 'Campaign ID', '广告活动ID'))
        data['campaign_type'] = _safe_get(row, 'campaign_type', 'Campaign Type', '广告类型', '类型')
        data['targeting_type'] = _safe_get(row, 'targeting_type', 'Targeting Type', '投放类型')
        data['bidding_strategy'] = _safe_get(row, 'bidding_strategy', 'Bidding Strategy', '竞价策略')
        data['budget'] = _safe_decimal(row, 'budget', 'Budget', '预算', '日预算')
        data['status'] = _safe_get(row, 'status', 'Status', '状态')
        data['portfolio_name'] = _safe_get(row, 'portfolio_name', 'Portfolio Name', '组合名称')
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
        data['advertised_asin'] = _safe_get(row, 'advertised_asin', 'Advertised ASIN', '推广ASIN', '推广的ASIN', 'ASIN')
        data['advertised_sku'] = _safe_get(row, 'advertised_sku', 'Advertised SKU', '推广SKU', 'SKU')

    return data


def _write_to_daily_table(db, report_type, row_data, tenant_id, batch_id):
    """将数据写入对应的日度分表（upsert 逻辑）

    根据 report_type 选择对应日表模型：
      - campaign  → AdCampaignDaily  (业务ID: campaign_id)
      - keyword   → AdKeywordDaily   (业务ID: keyword_id)
      - search_term → AdSearchTermDaily (业务ID: search_term)
      - product   → AdProductDaily   (业务ID: ad_id)

    Upsert 规则：同一 tenant_id + date + 业务ID 则更新，否则插入。
    """
    # report_type → 模型映射
    model_map = {
        'campaign': AdCampaignDaily,
        'keyword': AdKeywordDaily,
        'search_term': AdSearchTermDaily,
        'product': AdProductDaily,
    }

    # report_type → 业务ID字段映射
    business_id_map = {
        'campaign': 'campaign_id',
        'keyword': 'keyword_id',
        'search_term': 'search_term',
        'product': 'ad_id',
    }

    model = model_map.get(report_type)
    if not model:
        logger.warning(f"未知的报告类型: {report_type}，跳过分表写入")
        return

    business_id_field = business_id_map[report_type]
    business_id_value = row_data.get(business_id_field)
    date_val = row_data.get('date')

    if not business_id_value or not date_val:
        logger.warning(
            f"缺少业务ID({business_id_field})或日期，跳过分表写入: "
            f"{business_id_field}={business_id_value}, date={date_val}"
        )
        return

    try:
        # 查询已有记录（tenant_id + date + 业务ID）
        existing = db.query(model).filter(
            model.tenant_id == tenant_id,
            model.date == date_val,
            getattr(model, business_id_field) == business_id_value,
        ).first()

        if existing:
            # 更新已有记录（跳过唯一键字段）
            for key, value in row_data.items():
                if key in ('tenant_id', 'date', business_id_field):
                    continue
                if hasattr(existing, key) and value is not None:
                    setattr(existing, key, value)
            existing.batch_id = batch_id
            logger.debug(
                f"更新{report_type}分表: {business_id_field}={business_id_value}, date={date_val}"
            )
        else:
            # 插入新记录
            insert_data = dict(row_data)  # 复制一份，避免修改原始数据
            insert_data['tenant_id'] = tenant_id
            insert_data['batch_id'] = batch_id
            new_record = model(**insert_data)
            db.add(new_record)
            logger.debug(
                f"插入{report_type}分表: {business_id_field}={business_id_value}, date={date_val}"
            )

        db.commit()

    except Exception as e:
        logger.error(f"写入{report_type}分表失败: {e}")
        db.rollback()
        raise