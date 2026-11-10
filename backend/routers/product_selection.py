import json
import logging
import asyncio
import uuid
import requests
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timedelta
from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create, log_product_create
from utils.order_number import generate_replenishment_order_number

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/product-selection", tags=["product-selection"])

# 批量AI分析后台任务进度表 {batch_id: {status, total, completed, success, failed, results}}
_batch_analyze_tasks: Dict[str, Dict[str, Any]] = {}
# 批量分析并发数上限
BATCH_ANALYZE_CONCURRENCY = 3

# 汇率API（按1人民币兑外币获取，代码中取倒数换算为 1外币兑人民币）
EXCHANGE_RATE_API = "https://api.frankfurter.dev/v2/rates?base=CNY"


def _get_cny_rates() -> dict:
    """获取实时汇率：1外币兑人民币，如 {"USD": 7.1994, "EUR": 7.874, "GBP": 9.174}"""
    try:
        resp = requests.get(EXCHANGE_RATE_API, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        # 返回格式: [{"date": "...", "base": "CNY", "quote": "USD", "rate": 0.1389}, ...]
        # API返回1人民币兑外币，取倒数得到 1外币兑人民币
        result = {}
        for item in data if isinstance(data, list) else []:
            quote = item.get("quote")
            rate = item.get("rate")
            if quote in ("USD", "EUR", "GBP") and rate:
                result[quote] = round(1.0 / float(rate), 6)
        return result
    except Exception as e:
        logger.error(f"获取实时汇率失败: {e}")
        return {}


def _site_currency(site: str | None) -> str:
    """根据站点名称推断币种"""
    s = (site or "").lower()
    if "德" in s or "de" in s:
        return "EUR"
    if "英" in s or "uk" in s or "gb" in s:
        return "GBP"
    return "USD"


def _freight_fee_per_kg(site: str | None) -> float:
    """货代费用（元/kg）：美国站30，德国和英国25"""
    s = (site or "")
    if ("德" in s or "de" in s.lower()) or ("英" in s or "uk" in s.lower() or "gb" in s.lower()):
        return 25.0
    return 30.0


def _site_deduction_rate(site: str | None) -> float:
    """售价扣减比例（广告15% + 毛利15% + 仓储 + 税金 + 退货），按站点默认利润设置"""
    d = PROFIT_DEFAULTS[_normalize_site_key(site)]
    return 0.15 + 0.15 + d["storage_fee_rate"] + d["tax_rate"] + d["return_rate"]


def _calc_cost_cap(price, rate, commission, first_leg, last_mile, site_key: str,
                   profit_setting: dict | None = None) -> float | None:
    """按15%假设毛利反推进货价上限（人民币）："进货价（需低于）"字段
    进货上限 = 汇率 × [售价 × (1 − 广告15% − 毛利15% − 仓储 − 税金 − 退货) − 佣金 − 尾程 − 头程]
    即采购成本（外币）满足：售价 − 成本 − 固定费用 − 售价×扣减率 = 售价×15%
    profit_setting 传租户利润设置（可选），默认用站点标准扣减"""
    if not price or not rate or rate <= 1:
        return None
    d = profit_setting or PROFIT_DEFAULTS.get(site_key) or PROFIT_DEFAULTS["us"]
    ded = 0.15 + 0.15 + d["storage_fee_rate"] + d["tax_rate"] + d["return_rate"]
    fixed = (commission or 0) + (first_leg or 0) + (last_mile or 0)
    base = price * (1 - ded) - fixed
    if base <= 0:
        return None
    return round(base * rate, 2)


class ProductSelectionCreate(BaseModel):
    product_title: str
    url: Optional[str] = None
    asin: Optional[str] = None
    image_url: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    keywords: Optional[str] = None
    price: Optional[float] = None
    commission: Optional[float] = None
    first_leg_cost: Optional[float] = None
    last_mile_cost: Optional[float] = None
    weight_kg: Optional[float] = None
    cost_at_15_profit: Optional[float] = None
    product_type: Optional[str] = None
    site: Optional[str] = None
    monthly_sales: Optional[int] = None
    traffic_trend: Optional[str] = None
    category: Optional[List[str]] = None

class ProductSelectionUpdate(BaseModel):
    product_title: Optional[str] = None
    url: Optional[str] = None
    asin: Optional[str] = None
    image_url: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    keywords: Optional[str] = None
    price: Optional[float] = None
    commission: Optional[float] = None
    first_leg_cost: Optional[float] = None
    last_mile_cost: Optional[float] = None
    weight_kg: Optional[float] = None
    cost_at_15_profit: Optional[float] = None
    product_type: Optional[str] = None
    site: Optional[str] = None
    monthly_sales: Optional[int] = None
    traffic_trend: Optional[str] = None
    category: Optional[List[str]] = None


def _parse_category(v) -> list | None:
    """解析类目JSON字符串为列表"""
    if not v:
        return None
    try:
        parsed = json.loads(v)
        return parsed if isinstance(parsed, list) else None
    except Exception:
        return None


def _parse_json_str_list(val) -> list:
    """解析 JSON 字符串数组列（如 ali_1688_urls/apply_images），失败返回空列表"""
    if not val:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v]
    try:
        parsed = json.loads(val)
        return [str(v) for v in parsed] if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def _parse_group_members(raw) -> list:
    """拼团成员 JSON -> list[dict]（{user_id,username,quantity,joined_at}），异常返回空列表"""
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _parse_json_int_list(val) -> list:
    """解析 JSON int 数组列（如 store_group_ids），失败返回空列表"""
    if not val:
        return []
    if isinstance(val, list):
        return [int(v) for v in val if v]
    try:
        parsed = json.loads(val)
        return [int(v) for v in parsed] if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def _get_user_store_group(db: Session, tenant_id: int, user_id: int) -> tuple | None:
    """用户所属店铺分组（user_stores -> stores -> store_groups，与 /store-groups/my-group 同口径），
    返回 (id, name) | None。拼团成员记录自动带上该分组"""
    row = db.execute(text("""
        SELECT DISTINCT sg.id, sg.name
        FROM store_groups sg
        INNER JOIN stores s ON s.group_id = sg.id
        INNER JOIN user_stores us ON us.store_id = s.id
        WHERE us.user_id = :uid AND sg.tenant_id = :tid
          AND sg.deleted_at IS NULL AND s.deleted_at IS NULL
        LIMIT 1
    """), {"uid": user_id, "tid": tenant_id}).fetchone()
    return (row[0], row[1]) if row else None


def _resolve_group_quantities(members_raw, sg_ids_raw, fallback_qty) -> list:
    """按拼团成员分组汇总采购数量，返回 [(gid, qty, creator_id), ...]：
    - 成员带分组 -> 归入该分组，creator_id = 该分组第一个成员（数量归属人）
    - 成员无分组 -> 归入申请分组第一个（sg_ids[0]）
    - 无成员记录（直接达标提交，无拼团）-> 每个申请分组各 fallback_qty，creator_id=None
    gid=0 表示成员完全无分组归属，由调用方决定跳过或兜底"""
    members = _parse_group_members(members_raw)
    sg_ids = _parse_json_int_list(sg_ids_raw)
    if not members:
        return [(g, int(fallback_qty or 0), None) for g in sg_ids]
    agg: dict = {}  # gid -> [qty合计, creator_id]
    default_gid = sg_ids[0] if sg_ids else 0
    for m in members:
        gid = m.get("store_group_id") or default_gid
        try:
            gid = int(gid)
        except (TypeError, ValueError):
            gid = 0
        if gid not in agg:
            uid = m.get("user_id")
            agg[gid] = [0, int(uid) if uid else None]
        agg[gid][0] += int(m.get("quantity") or 0)
    return [(g, v[0], v[1]) for g, v in agg.items()]


def _row_to_dict(row) -> dict:
    return {
        "id": row[0],
        "tenant_id": row[1],
        "product_title": row[2],
        "url": row[3] or "",
        "asin": row[4] or "",
        "image_url": row[5] or "",
        "rating": float(row[6]) if row[6] is not None else None,
        "review_count": row[7],
        "keywords": row[8] or "",
        "price": float(row[9]) if row[9] is not None else None,
        "commission": float(row[10]) if row[10] is not None else None,
        "first_leg_cost": float(row[11]) if row[11] is not None else None,
        "last_mile_cost": float(row[12]) if row[12] is not None else None,
        "weight_kg": float(row[13]) if row[13] is not None else None,
        "cost_at_15_profit": float(row[14]) if row[14] is not None else None,
        "product_type": row[15] or "",
        "site": row[16] or "",
        "monthly_sales": row[17],
        "traffic_trend": row[18] or "",
        "seasonality": row[19] or "",
        "infringement_analysis": row[20] or "",
        "infringement_conclusion": row[21] or "",
        "traffic_score_result": row[22] or "",
        "traffic_score": float(row[23]) if row[23] is not None else None,
        "sales_score": float(row[24]) if row[24] is not None else None,
        "rating_score": float(row[25]) if row[25] is not None else None,
        "penalty_factor": float(row[26]) if row[26] is not None else None,
        "composite_score": float(row[27]) if row[27] is not None else None,
        "status": row[28] or "",
        "reject_reason": row[29],
        "created_at": row[30].strftime("%Y-%m-%d %H:%M:%S") if row[30] else "",
        "updated_at": row[31].strftime("%Y-%m-%d %H:%M:%S") if row[31] else "",
        # 申请选品信息（LEFT JOIN users / store_groups）
        "scrape_rate": float(row[32]) if row[32] is not None else None,
        "realtime_rate": float(row[33]) if row[33] is not None else None,
        "category": _parse_category(row[34]),
        "ali_1688_url": (row[35] or "") if len(row) > 35 else "",
        "purchase_price": float(row[36]) if len(row) > 36 and row[36] is not None else None,
        "purchase_quantity": row[37] if len(row) > 37 else None,
        "applicant_id": row[38] if len(row) > 38 else None,
        "store_group_id": row[39] if len(row) > 39 else None,
        # 申请扩展信息：多链接/备注/图片/起订量
        "ali_1688_urls": _parse_json_str_list(row[40]) if len(row) > 40 else [],
        "apply_remark": (row[41] or "") if len(row) > 41 else "",
        "apply_images": _parse_json_str_list(row[42]) if len(row) > 42 else [],
        "moq": row[43] if len(row) > 43 and row[43] is not None else None,
        "group_members": _parse_group_members(row[44]) if len(row) > 44 else [],
        "group_deadline": row[45].strftime("%Y-%m-%d %H:%M:%S") if len(row) > 45 and row[45] else None,
        "applicant_name": (row[46] or "") if len(row) > 46 else "",
        "store_group_name": (row[47] or "") if len(row) > 47 else "",
        "store_group_ids": _parse_json_int_list(row[48]) if len(row) > 48 else [],
    }


# ===== 利润计算逻辑设置 =====
# 站点归一化：site 字符串 -> us/de/uk
PROFIT_SETTING_SITES = {"us": "美国", "de": "德国", "uk": "英国"}
PROFIT_DEFAULTS = {
    "us": {"ad_fee_rate": 0.15, "storage_fee_rate": 0.02, "tax_rate": 0.0, "return_rate": 0.06},
    "de": {"ad_fee_rate": 0.15, "storage_fee_rate": 0.02, "tax_rate": 0.20, "return_rate": 0.06},
    "uk": {"ad_fee_rate": 0.15, "storage_fee_rate": 0.02, "tax_rate": 0.20, "return_rate": 0.06},
}


def _normalize_site_key(site: str | None) -> str:
    """站点字符串归一化为 us/de/uk"""
    s = (site or "").lower()
    if "德" in (site or "") or "de" in s:
        return "de"
    if "英" in (site or "") or "uk" in s or "gb" in s:
        return "uk"
    return "us"


def _ensure_profit_settings_table(db: Session):
    """确保利润设置表存在"""
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS selection_profit_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL COMMENT '租户ID',
            site VARCHAR(20) NOT NULL COMMENT '站点: us/de/uk',
            ad_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.1500 COMMENT '广告费率',
            storage_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0200 COMMENT '仓储费率',
            tax_rate DECIMAL(6,4) NOT NULL DEFAULT 0.2000 COMMENT '税率',
            return_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0000 COMMENT '退货率',
            updated_by INT NULL COMMENT '更新人',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_tenant_site (tenant_id, site)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='选品利润计算设置'
    """))
    db.commit()


def _get_profit_settings(db: Session, tenant_id: int) -> dict:
    """获取租户利润设置（含默认值填充），返回 {us: {...}, de: {...}, uk: {...}}"""
    _ensure_profit_settings_table(db)
    rows = db.execute(text(
        "SELECT site, ad_fee_rate, storage_fee_rate, tax_rate, return_rate "
        "FROM selection_profit_settings WHERE tenant_id = :tid"
    ), {"tid": tenant_id}).fetchall()
    saved = {r[0]: {
        "ad_fee_rate": float(r[1]), "storage_fee_rate": float(r[2]),
        "tax_rate": float(r[3]), "return_rate": float(r[4]),
    } for r in rows}
    result = {}
    for key, default in PROFIT_DEFAULTS.items():
        result[key] = saved.get(key, dict(default))
        result[key]["site_name"] = PROFIT_SETTING_SITES[key]
        result[key]["currency"] = {"us": "USD", "de": "EUR", "uk": "GBP"}[key]
    return result


class ProfitSettingUpdate(BaseModel):
    site: str  # us / de / uk
    ad_fee_rate: float = Field(ge=0, le=1)
    storage_fee_rate: float = Field(ge=0, le=1)
    tax_rate: float = Field(ge=0, le=1)
    return_rate: float = Field(ge=0, le=1)


@router.get("/profit-settings")
async def get_profit_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取各站点利润计算设置（无记录时返回默认值）"""
    try:
        return {"success": True, "data": _get_profit_settings(db, current_user.tenant_id)}
    except Exception as e:
        logger.error(f"获取利润设置失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取利润设置失败: {str(e)}")


@router.put("/profit-settings")
async def save_profit_settings(
    data: ProfitSettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:settings"))
):
    """保存指定站点的利润计算设置"""
    try:
        if data.site not in PROFIT_SETTING_SITES:
            raise HTTPException(status_code=400, detail="站点无效，仅支持 us/de/uk")
        _ensure_profit_settings_table(db)
        db.execute(text("""
            INSERT INTO selection_profit_settings
                (tenant_id, site, ad_fee_rate, storage_fee_rate, tax_rate, return_rate, updated_by, created_at, updated_at)
            VALUES (:tid, :site, :ad, :storage, :tax, :ret, :uid, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                ad_fee_rate = :ad, storage_fee_rate = :storage, tax_rate = :tax,
                return_rate = :ret, updated_by = :uid, updated_at = NOW()
        """), {
            "tid": current_user.tenant_id, "site": data.site,
            "ad": data.ad_fee_rate, "storage": data.storage_fee_rate,
            "tax": data.tax_rate, "ret": data.return_rate, "uid": current_user.id,
        })
        db.commit()
        return {"success": True, "message": "保存成功", "data": _get_profit_settings(db, current_user.tenant_id)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"保存利润设置失败: {e}")
        raise HTTPException(status_code=500, detail=f"保存利润设置失败: {str(e)}")


@router.post("/profit-settings/reset")
async def reset_profit_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:settings"))
):
    """恢复所有站点利润设置为默认值"""
    try:
        _ensure_profit_settings_table(db)
        db.execute(text(
            "DELETE FROM selection_profit_settings WHERE tenant_id = :tid"
        ), {"tid": current_user.tenant_id})
        db.commit()
        return {"success": True, "message": "已恢复默认逻辑", "data": _get_profit_settings(db, current_user.tenant_id)}
    except Exception as e:
        db.rollback()
        logger.error(f"恢复默认利润设置失败: {e}")
        raise HTTPException(status_code=500, detail=f"恢复默认利润设置失败: {str(e)}")


@router.get("/types")
async def get_product_types(
    site: str = Query(None, description="可选，按站点过滤类型"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户已有的产品类型列表（可按站点过滤）"""
    try:
        sql = """
            SELECT DISTINCT product_type
            FROM product_selections
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL AND product_type IS NOT NULL AND product_type != ''
        """
        params = {"tenant_id": current_user.tenant_id}
        if site:
            sql += " AND site = :site"
            params["site"] = site
        sql += " ORDER BY product_type"
        result = db.execute(text(sql), params)
        types = [row[0] for row in result]
        return {"success": True, "data": types}
    except Exception as e:
        logger.error(f"获取产品类型列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取产品类型列表失败: {str(e)}")


@router.get("/dates")
async def get_product_dates(
    site: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户已有的选品日期列表（去重，倒序；可按站点过滤，只返回该站点有数据的日期）"""
    try:
        params = {"tenant_id": current_user.tenant_id}
        site_cond = ""
        if site:
            site_cond = " AND site = :site"
            params["site"] = site
        query = text(f"""
            SELECT DISTINCT DATE(created_at) AS dt
            FROM product_selections
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL{site_cond}
            ORDER BY dt DESC
        """)
        result = db.execute(query, params)
        dates = [row[0].strftime("%Y-%m-%d") if hasattr(row[0], 'strftime') else str(row[0]) for row in result]
        return {"success": True, "data": dates}
    except Exception as e:
        logger.error(f"获取选品日期列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取选品日期列表失败: {str(e)}")


@router.get("/sites")
async def get_product_sites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前租户已有的站点列表"""
    try:
        query = text("""
            SELECT DISTINCT site
            FROM product_selections
            WHERE tenant_id = :tenant_id AND deleted_at IS NULL AND site IS NOT NULL AND site != ''
            ORDER BY site
        """)
        result = db.execute(query, {"tenant_id": current_user.tenant_id})
        sites = [row[0] for row in result]
        return {"success": True, "data": sites}
    except Exception as e:
        logger.error(f"获取站点列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取站点列表失败: {str(e)}")


@router.get("/")
async def get_product_selections(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    product_type: Optional[str] = None,
    site: Optional[str] = None,
    date_filter: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = "desc",
    rate_mode: Optional[str] = "realtime",
    status: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        _ensure_reject_reason_column(db)
        where_conditions = ["ps.tenant_id = :tenant_id", "ps.deleted_at IS NULL"]
        # 费用字段不完整（佣金/头程/尾程/重量任一为空或0）的记录不显示，
        # 由FBA利润重抓任务补齐数据后恢复（deleted_at 软删除/恢复）
        where_conditions.append(
            "ps.commission IS NOT NULL AND ps.commission > 0 "
            "AND ps.first_leg_cost IS NOT NULL AND ps.first_leg_cost > 0 "
            "AND ps.last_mile_cost IS NOT NULL AND ps.last_mile_cost > 0 "
            "AND ps.weight_kg IS NOT NULL AND ps.weight_kg > 0"
        )
        params = {"tenant_id": current_user.tenant_id}

        if search:
            where_conditions.append(
                "(ps.asin LIKE :search OR ps.product_title LIKE :search OR ps.keywords LIKE :search)"
            )
            params["search"] = f"%{search}%"

        if product_type:
            where_conditions.append("ps.product_type = :product_type")
            params["product_type"] = product_type

        if site:
            where_conditions.append("ps.site = :site")
            params["site"] = site

        if date_filter:
            where_conditions.append("DATE(ps.created_at) = :date_filter")
            params["date_filter"] = date_filter

        if status:
            status_filters = []
            for idx, s in enumerate(status):
                if s == "empty":
                    status_filters.append("(ps.status IS NULL OR ps.status = '')")
                elif s in ("pending", "approved", "rejected", "grouping"):
                    param_name = f"status_{idx}"
                    status_filters.append(f"ps.status = :{param_name}")
                    params[param_name] = s
            if status_filters:
                where_conditions.append(f"({' OR '.join(status_filters)})")

        where_clause = " AND ".join(where_conditions)

        count_query = text(f"SELECT COUNT(*) FROM product_selections ps WHERE {where_clause}")
        total = db.execute(count_query, params).scalar() or 0

        order_column = "ps.created_at"
        order_nulls_clause = ""
        profit_join = ""
        if sort_by and sort_by in [
            "composite_score", "rating", "price", "monthly_sales", "created_at",
            "commission", "first_leg_cost", "last_mile_cost", "weight_kg",
            "cost_at_15_profit", "review_count", "purchase_price", "purchase_quantity"
        ]:
            order_column = f"ps.{sort_by}"
        elif sort_by in ("actual_profit", "actual_profit_margin", "profit_15"):
            # 实际毛利/毛利率/15%毛利为动态计算列，按与前端一致的公式在 SQL 中计算后排序
            rate_col = "ps.scrape_rate" if (rate_mode or "") == "scrape" else "ps.realtime_rate"
            # 站点归一化：与美国/us→us，德国/de→de，英国/uk|gb→uk，默认us
            site_key_sql = ("CASE "
                            "WHEN ps.site LIKE '%德%' OR LOWER(ps.site) LIKE '%de%' THEN 'de' "
                            "WHEN ps.site LIKE '%英%' OR LOWER(ps.site) LIKE '%uk%' OR LOWER(ps.site) LIKE '%gb%' THEN 'uk' "
                            "ELSE 'us' END")
            profit_join = (
                " LEFT JOIN selection_profit_settings sps "
                f"ON sps.tenant_id = ps.tenant_id AND sps.site = {site_key_sql}"
            )
            # 退货率默认：所有站点均为0.06（与后端默认一致）
            return_rate_sql = f"COALESCE(sps.return_rate, 0.06)"
            # 税率默认：美国0，德国/英国0.20
            tax_rate_sql = (
                f"COALESCE(sps.tax_rate, CASE {site_key_sql} WHEN 'us' THEN 0 ELSE 0.20 END)"
            )
            if sort_by == "profit_15":
                # 15%毛利（CNY）= 价格（外币）× 15% × 汇率（1外币兑人民币）
                order_column = f"(ps.price * 0.15 * NULLIF({rate_col}, 0))"
            else:
                profit_expr = (
                    "(ps.price - ps.purchase_price / NULLIF(" + rate_col + ", 0) "
                    "- COALESCE(ps.first_leg_cost, 0) "
                    "- COALESCE(ps.last_mile_cost, 0) "
                    "- COALESCE(ps.commission, 0) "
                    "- ps.price * COALESCE(sps.ad_fee_rate, 0.15) "
                    "- ps.price * COALESCE(sps.storage_fee_rate, 0.02) "
                    "- ps.price * " + tax_rate_sql + " "
                    "- ps.price * " + return_rate_sql + ")"
                )
                if sort_by == "actual_profit":
                    order_column = profit_expr
                else:
                    order_column = f"{profit_expr} / NULLIF(ps.price, 0)"
            # 计算值为空的记录排最后
            order_nulls_clause = f"({order_column} IS NULL) ASC, "
        order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"

        offset = (page - 1) * page_size
        params["offset"] = offset
        params["limit"] = page_size

        query = text(f"""
            SELECT ps.id, ps.tenant_id, ps.product_title, ps.url, ps.asin, ps.image_url,
                   ps.rating, ps.review_count, ps.keywords, ps.price, ps.commission,
                   ps.first_leg_cost, ps.last_mile_cost, ps.weight_kg, ps.cost_at_15_profit,
                   ps.product_type, ps.site, ps.monthly_sales, ps.traffic_trend,
                   ps.seasonality, ps.infringement_analysis, ps.infringement_conclusion, ps.traffic_score_result,
                   ps.traffic_score, ps.sales_score, ps.rating_score, ps.penalty_factor, ps.composite_score,
                   ps.status, ps.reject_reason, ps.created_at, ps.updated_at,
                   ps.scrape_rate, ps.realtime_rate, ps.category,
                   ps.ali_1688_url, ps.purchase_price, ps.purchase_quantity,
                   ps.applicant_id, ps.store_group_id,
                   ps.ali_1688_urls, ps.apply_remark, ps.apply_images, ps.moq,
                   ps.group_members, ps.group_deadline,
                   COALESCE(NULLIF(u.nickname, ''), u.username) AS applicant_name,
                   sg.name AS store_group_name,
                   ps.store_group_ids
            FROM product_selections ps{profit_join}
            LEFT JOIN users u ON u.id = ps.applicant_id
            LEFT JOIN store_groups sg ON sg.id = ps.store_group_id AND sg.deleted_at IS NULL
            WHERE {where_clause}
            ORDER BY {order_nulls_clause}{order_column} {order_dir}
            LIMIT :limit OFFSET :offset
        """)
        result = db.execute(query, params)
        items = [_row_to_dict(row) for row in result]

        # 多分组申请显示：本租户全部分组名 map -> store_group_names
        sg_name_rows = db.execute(text(
            "SELECT id, name FROM store_groups WHERE tenant_id = :tid AND deleted_at IS NULL"
        ), {"tid": current_user.tenant_id}).fetchall()
        sg_name_map = {r[0]: r[1] for r in sg_name_rows}
        for it in items:
            # 申请分组 + 拼团成员各自分组（去重，保持顺序）
            ids = list(it.get("store_group_ids") or [])
            if not ids and it.get("store_group_id"):
                ids = [it["store_group_id"]]
            for m in it.get("group_members") or []:
                mg = m.get("store_group_id")
                if mg and int(mg) not in ids:
                    ids.append(int(mg))
            it["store_group_names"] = [sg_name_map[g] for g in ids if g in sg_name_map]

        return {
            "success": True,
            "data": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
        }
    except Exception as e:
        logger.error(f"获取选品列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取选品列表失败: {str(e)}")


@router.get("/{selection_id}")
async def get_product_selection(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        _ensure_reject_reason_column(db)
        query = text("""
            SELECT ps.id, ps.tenant_id, ps.product_title, ps.url, ps.asin, ps.image_url,
                   ps.rating, ps.review_count, ps.keywords, ps.price, ps.commission,
                   ps.first_leg_cost, ps.last_mile_cost, ps.weight_kg, ps.cost_at_15_profit,
                   ps.product_type, ps.site, ps.monthly_sales, ps.traffic_trend,
                   ps.seasonality, ps.infringement_analysis, ps.infringement_conclusion, ps.traffic_score_result,
                   ps.traffic_score, ps.sales_score, ps.rating_score, ps.penalty_factor, ps.composite_score,
                   ps.status, ps.reject_reason, ps.created_at, ps.updated_at,
                   ps.scrape_rate, ps.realtime_rate, ps.category,
                   ps.ali_1688_url, ps.purchase_price, ps.purchase_quantity,
                   ps.applicant_id, ps.store_group_id,
                   ps.ali_1688_urls, ps.apply_remark, ps.apply_images, ps.moq,
                   ps.group_members, ps.group_deadline,
                   COALESCE(NULLIF(u.nickname, ''), u.username) AS applicant_name,
                   sg.name AS store_group_name,
                   ps.store_group_ids
            FROM product_selections ps
            LEFT JOIN users u ON u.id = ps.applicant_id
            LEFT JOIN store_groups sg ON sg.id = ps.store_group_id AND sg.deleted_at IS NULL
            WHERE ps.id = :id AND ps.tenant_id = :tid AND ps.deleted_at IS NULL
        """)
        row = db.execute(query, {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        item = _row_to_dict(row)
        # 申请分组 + 拼团成员各自分组（去重，保持顺序）
        ids = list(item.get("store_group_ids") or [])
        if not ids and item.get("store_group_id"):
            ids = [item["store_group_id"]]
        for m in item.get("group_members") or []:
            mg = m.get("store_group_id")
            if mg and int(mg) not in ids:
                ids.append(int(mg))
        sg_name_rows = db.execute(text(
            "SELECT id, name FROM store_groups WHERE tenant_id = :tid AND deleted_at IS NULL"
        ), {"tid": current_user.tenant_id}).fetchall()
        sg_name_map = {r[0]: r[1] for r in sg_name_rows}
        item["store_group_names"] = [sg_name_map[g] for g in ids if g in sg_name_map]
        return {"success": True, "data": item}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取选品详情失败: {str(e)}")


@router.post("/")
async def create_product_selection(
    data: ProductSelectionCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        # 抓取时汇率：按站点币种获取当前汇率并固定保存
        scrape_rate = None
        try:
            rates = _get_cny_rates()
            scrape_rate = rates.get(_site_currency(data.site))
        except Exception as e:
            logger.warning(f"创建选品时获取汇率失败: {e}")

        insert_sql = text("""
            INSERT INTO product_selections (
                tenant_id, product_title, url, asin, image_url, rating, review_count,
                keywords, price, commission, first_leg_cost, last_mile_cost, weight_kg,
                cost_at_15_profit, product_type, site, monthly_sales, traffic_trend, scrape_rate, category
            ) VALUES (
                :tenant_id, :product_title, :url, :asin, :image_url, :rating, :review_count,
                :keywords, :price, :commission, :first_leg_cost, :last_mile_cost, :weight_kg,
                :cost_at_15_profit, :product_type, :site, :monthly_sales, :traffic_trend, :scrape_rate, :category
            )
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "product_title": data.product_title,
            "url": data.url,
            "asin": data.asin,
            "image_url": data.image_url,
            "rating": data.rating,
            "review_count": data.review_count,
            "keywords": data.keywords,
            "price": data.price,
            "commission": data.commission,
            "first_leg_cost": data.first_leg_cost,
            "last_mile_cost": data.last_mile_cost,
            "weight_kg": data.weight_kg,
            "cost_at_15_profit": data.cost_at_15_profit,
            "product_type": data.product_type,
            "site": data.site,
            "monthly_sales": data.monthly_sales,
            "traffic_trend": data.traffic_trend,
            "scrape_rate": scrape_rate,
            "category": json.dumps(data.category, ensure_ascii=False) if data.category else None,
        })
        db.commit()
        selection_id = result.lastrowid

        # 入库即自动计算评分（不用等每日定时任务）
        rating_score = _calc_rating_score(data.rating, data.review_count)
        sales_score = _calc_sales_score(data.monthly_sales)
        penalty_factor = _calc_penalty_factor(rating_score)
        traffic_score, traffic_score_result = _calc_traffic_score(data.traffic_trend)
        composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

        db.execute(text("""
            UPDATE product_selections SET
                traffic_score = :ts, traffic_score_result = :tsr,
                sales_score = :ss, rating_score = :rs,
                penalty_factor = :pf, composite_score = :cs,
                updated_at = NOW()
            WHERE id = :id
        """), {
            "id": selection_id, "ts": traffic_score, "tsr": traffic_score_result,
            "ss": sales_score, "rs": rating_score, "pf": penalty_factor, "cs": composite_score,
        })
        db.commit()

        # 综合评分 >= 65 且未做过AI分析：后台自动触发AI分析（侵权+季节性）
        auto_analysis_triggered = False
        if composite_score is not None and composite_score >= 65:
            auto_analysis_triggered = True
            background_tasks.add_task(_analyze_one_product, selection_id, current_user.tenant_id)

        return {
            "success": True,
            "message": "选品记录创建成功",
            "data": {
                "id": selection_id,
                "rating_score": rating_score, "sales_score": sales_score,
                "penalty_factor": penalty_factor, "traffic_score": traffic_score,
                "composite_score": composite_score,
                "auto_analysis_triggered": auto_analysis_triggered,
            },
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建选品记录失败: {str(e)}")


# 站点 -> 亚马逊商品页域名
AMAZON_SITE_DOMAINS = {
    "us": "www.amazon.com",
    "de": "www.amazon.de",
    "uk": "www.amazon.co.uk",
}

# 站点key -> 入库中文（与存量选品记录 site 值格式一致：美国/德国/英国）
AMAZON_SITE_ZH = {"us": "美国", "de": "德国", "uk": "英国"}


def _parse_amazon_product_page(html: str) -> dict:
    """解析亚马逊商品页 HTML：标题/售价/评分/评论数/主图/产品类型（抓不到的字段为 None）"""
    import re
    out = {"product_title": None, "price": None, "rating": None,
           "review_count": None, "image_url": None, "product_type": None}
    # 标题
    m = re.search(r'<span[^>]+id="productTitle"[^>]*>([^<]+)</span>', html)
    if m:
        out["product_title"] = m.group(1).strip()
    # 售价：优先购买框区域内的 a-offscreen，回退页面第一处
    m = re.search(r'id="corePriceDisplay_desktop_feature_div".*?class="a-offscreen">\s*([€$£]?[\d.,]+)', html, re.S) \
        or re.search(r'class="a-offscreen">\s*([€$£]?[\d.,]+)', html)
    if m:
        num = re.sub(r"[^\d.,]", "", m.group(1))
        if num:
            if "," in num and "." in num:
                if num.rfind(",") > num.rfind("."):  # 欧式 1.234,56
                    num = num.replace(".", "").replace(",", ".")
                else:  # 美式 1,234.56
                    num = num.replace(",", "")
            elif "," in num:  # 12,99（欧式小数）或 1,234（美式千分位）
                parts = num.split(",")
                num = num.replace(",", ".") if len(parts) == 2 and len(parts[1]) in (1, 2) else num.replace(",", "")
            elif "." in num and len(num.split(".")) > 2:  # 1.234.567（欧式千分位）
                num = num.replace(".", "")
            try:
                out["price"] = float(num)
            except ValueError:
                pass
    # 评分（英语/德语页面）
    m = re.search(r'([\d.,]+)\s*(?:out of 5 stars|von 5 Sternen)', html)
    if m:
        try:
            out["rating"] = float(m.group(1).replace(",", "."))
        except ValueError:
            pass
    # 评论数：新版页面 aria-label="3 Reviews"（文本为 "(3)"），旧版为 "1,234 ratings"
    m = re.search(r'id="acrCustomerReviewText"[^>]*aria-label="([\d.,]+)', html) \
        or re.search(r'id="acrCustomerReviewText"[^>]*>\s*(?:\()?([\d.,]+)', html)
    if m:
        num = re.sub(r"[^\d]", "", m.group(1))
        if num:
            try:
                out["review_count"] = int(num)
            except ValueError:
                pass
    # 主图：定位 landingImage 所在 img 标签（属性顺序无关），
    # 优先 data-old-hires 高清图，回退 data-a-dynamic-image 最大尺寸，再回退 src，最后 og:image 兜底
    out["image_url"] = None
    m = re.search(r'<img[^>]*\bid=["\']landingImage["\'][^>]*>', html)
    if m:
        tag = m.group(0)
        m2 = re.search(r'data-old-hires="([^"]+)"', tag)
        if not m2:
            m3 = re.search(r'data-a-dynamic-image="([^"]+)"', tag)
            if m3:
                try:
                    dyn = json.loads(m3.group(1).replace("&quot;", '"').replace("&#39;", "'"))
                    urls = list(dyn.keys()) if isinstance(dyn, dict) else []
                    if urls:
                        out["image_url"] = max(urls, key=lambda u: (
                            dyn[u][0] if isinstance(dyn.get(u), list) and dyn[u] else 0))
                except Exception:
                    pass
        if not out["image_url"]:
            m2 = re.search(r'\bsrc="([^"]+)"', tag)
            if m2:
                out["image_url"] = m2.group(1)
    if not out["image_url"]:
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html) \
            or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html)
        if m:
            out["image_url"] = m.group(1)
    # 产品类型：面包屑类目最后一个
    cats = re.findall(r'class="a-link-normal a-color-tertiary"[^>]*>([^<]+)</a>', html)
    if cats:
        out["product_type"] = cats[-1].strip()
    return out


def _fetch_amazon_fba_fees(site_key: str, asin: str) -> dict:
    """调卖家精灵利润计算接口抓 FBA 费用（同重抓任务逻辑：0值重试最多3次字段级取最大）
    返回 {commission, last_mile_cost, weight_kg}，均可能为 0"""
    import time as _time
    import requests as _requests
    from services.scheduler import (
        TOOL4SELLER_FBA_CALC_URL, SEL_FEE_MARKETPLACE_MAP, WEIGHT_UNIT_TO_KG, _sel_site_key,
    )
    marketplace_id, _currency = SEL_FEE_MARKETPLACE_MAP[_sel_site_key(site_key)]
    best = {"commission": 0.0, "last_mile_cost": 0.0, "weight_kg": 0.0, "amount": 0.0}
    for _ in range(3):
        try:
            resp = _requests.get(
                TOOL4SELLER_FBA_CALC_URL,
                params={"marketplaceId": marketplace_id, "asin": asin, "amount": "0.00"},
                timeout=20,
                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            )
            resp.raise_for_status()
            payload = resp.json() or {}
            if payload.get("status") != 1:
                raise ValueError(f"接口状态异常: {payload.get('msg') or payload}")
            content = payload.get("content") or {}
        except Exception:
            _time.sleep(1)
            continue
        best["commission"] = max(best["commission"], float(content.get("referralFee") or 0))
        best["last_mile_cost"] = max(best["last_mile_cost"], float(content.get("fbaFee") or 0))
        unit = (content.get("weightUnits") or "").lower()
        best["weight_kg"] = max(best["weight_kg"], round(
            float(content.get("weight") or 0) * WEIGHT_UNIT_TO_KG.get(unit, 1.0), 3))
        best["amount"] = max(best["amount"], float(content.get("amount") or 0))
        if best["commission"] > 0 and best["last_mile_cost"] > 0 and best["weight_kg"] > 0 and best["amount"] > 0:
            break
        _time.sleep(1)
    return best


class AmazonImportData(BaseModel):
    """ASIN 导入选品数据"""
    site: str
    asins: List[str]


@router.post("/import-from-amazon")
async def import_from_amazon(
    data: AmazonImportData,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """拼接亚马逊商品链接自动创建选品：
    标题/售价/评分/评论数/主图/类型从 amazon.com/de/co.uk 商品页解析；
    FBA费用（佣金/尾程/重量）调卖家精灵接口，头程按重量×货代费÷汇率自动计算；
    汇率按站点币种抓取时固定保存。逐条容错，返回每条结果"""
    import httpx
    site_key = _normalize_site_key(data.site)
    domain = AMAZON_SITE_DOMAINS.get(site_key)
    if not domain:
        raise HTTPException(status_code=400, detail="不支持的站点，仅支持美国/德国/英国")
    asins = [a.strip().upper() for a in (data.asins or []) if a and a.strip()]
    asins = list(dict.fromkeys(asins))[:20]  # 去重，单次上限20条
    if not asins:
        raise HTTPException(status_code=400, detail="请输入ASIN")

    # 汇率与头程参数
    rates = {}
    try:
        rates = _get_cny_rates() or {}
    except Exception as e:
        logger.warning(f"ASIN导入获取汇率失败: {e}")
    currency = _site_currency(data.site)
    scrape_rate = rates.get(currency)
    fee_per_kg = _freight_fee_per_kg(data.site)
    # 租户利润设置（15%假设毛利反推进货价上限用）
    profit_cfg = {}
    try:
        profit_cfg = _get_profit_settings(db, current_user.tenant_id) or {}
    except Exception as e:
        logger.warning(f"ASIN导入获取利润设置失败，使用站点默认扣减: {e}")
    lang = {"us": "en-US,en;q=0.9", "de": "de-DE,de;q=0.9", "uk": "en-GB,en;q=0.9"}[site_key]
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": lang,
    }

    results = []
    for asin in asins:
        url = f"https://{domain}/dp/{asin}"
        try:
            resp = httpx.get(url, headers=headers, timeout=30, follow_redirects=True)
            if resp.status_code != 200:
                results.append({"asin": asin, "ok": False,
                                "error": f"亚马逊返回 {resp.status_code}（可能被拦截，请稍后重试）"})
                continue
            parsed = _parse_amazon_product_page(resp.text)
        except Exception as e:
            results.append({"asin": asin, "ok": False, "error": f"抓取失败: {e}"})
            continue
        if not parsed.get("product_title"):
            results.append({"asin": asin, "ok": False,
                            "error": "未解析到商品信息（页面可能被验证码拦截）"})
            continue

        # 同租户已存在该 ASIN 则跳过
        exists = db.execute(text(
            "SELECT id FROM product_selections WHERE tenant_id = :tid AND asin = :asin AND deleted_at IS NULL"
        ), {"tid": current_user.tenant_id, "asin": asin}).fetchone()
        if exists:
            results.append({"asin": asin, "ok": False, "error": "该ASIN已存在选品记录"})
            continue

        # FBA 费用（卖家精灵）与头程计算
        fees = _fetch_amazon_fba_fees(site_key, asin)
        commission = round(fees["commission"], 2) if fees["commission"] > 0 else None
        last_mile = round(fees["last_mile_cost"], 2) if fees["last_mile_cost"] > 0 else None
        weight = fees["weight_kg"] if fees["weight_kg"] > 0 else None
        first_leg = None
        eff_rate = scrape_rate if (scrape_rate and scrape_rate > 1) else None
        if weight and eff_rate:
            first_leg = round(weight * fee_per_kg / eff_rate, 3)
        # 售价：卖家精灵接口 amount 优先（亚马逊页面价格受访问IP影响可能显示为CNY等错误币种），页面解析兜底
        page_price = parsed.get("price")
        api_price = round(fees["amount"], 2) if fees["amount"] > 0 else None
        final_price = api_price if api_price is not None else page_price
        # "进货价（需低于）"：15%假设毛利反推上限
        cost_cap = _calc_cost_cap(final_price, scrape_rate, commission, first_leg, last_mile,
                                  site_key, profit_cfg.get(site_key))

        try:
            result = db.execute(text("""
                INSERT INTO product_selections (
                    tenant_id, product_title, url, asin, image_url, rating, review_count,
                    price, commission, first_leg_cost, last_mile_cost, weight_kg,
                    cost_at_15_profit, product_type, site, scrape_rate
                ) VALUES (
                    :tenant_id, :product_title, :url, :asin, :image_url, :rating, :review_count,
                    :price, :commission, :first_leg_cost, :last_mile_cost, :weight_kg,
                    :cost_at_15_profit, :product_type, :site, :scrape_rate
                )
            """), {
                "tenant_id": current_user.tenant_id,
                "product_title": parsed.get("product_title"),
                "url": url,
                "asin": asin,
                "image_url": parsed.get("image_url"),
                "rating": parsed.get("rating"),
                "review_count": parsed.get("review_count"),
                "price": final_price,
                "commission": commission,
                "first_leg_cost": first_leg,
                "last_mile_cost": last_mile,
                "weight_kg": weight,
                "cost_at_15_profit": cost_cap,
                "product_type": parsed.get("product_type"),
                "site": AMAZON_SITE_ZH.get(site_key, data.site),
                "scrape_rate": scrape_rate,
            })
            new_id = result.lastrowid
            # 入库即自动计算评分（与手动创建口径一致）
            rating = parsed.get("rating")
            review_count = parsed.get("review_count")
            rating_score = _calc_rating_score(rating, review_count)
            penalty_factor = _calc_penalty_factor(rating_score)
            # 无销量/流量趋势数据，按 0 分口径（与 _calc_traffic_score(None)/_calc_sales_score(None) 一致）
            composite_score = _calc_composite_score(penalty_factor, 0.0, 0.0)
            db.execute(text("""
                UPDATE product_selections SET
                    rating_score = :rs, penalty_factor = :pf, composite_score = :cs,
                    updated_at = NOW()
                WHERE id = :id
            """), {"id": new_id, "rs": rating_score, "pf": penalty_factor, "cs": composite_score})
            results.append({"asin": asin, "ok": True, "id": new_id,
                            "title": parsed.get("product_title"),
                            "price": parsed.get("price"), "rating": rating,
                            "review_count": review_count})
        except Exception as e:
            results.append({"asin": asin, "ok": False, "error": f"入库失败: {e}"})
    db.commit()

    ok_count = sum(1 for r in results if r["ok"])
    return {
        "success": True,
        "message": f"成功导入 {ok_count}/{len(results)} 条",
        "data": {"created": ok_count, "results": results},
    }


@router.put("/{selection_id}")
async def update_product_selection(
    selection_id: int,
    data: ProductSelectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        check = text("SELECT id FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        if not db.execute(check, {"id": selection_id, "tid": current_user.tenant_id}).fetchone():
            raise HTTPException(status_code=404, detail="选品记录不存在")

        updates = []
        params = {"id": selection_id}
        field_mapping = {
            "product_title": "product_title", "url": "url", "asin": "asin",
            "image_url": "image_url", "rating": "rating", "review_count": "review_count",
            "keywords": "keywords", "price": "price", "commission": "commission",
            "first_leg_cost": "first_leg_cost", "last_mile_cost": "last_mile_cost",
            "weight_kg": "weight_kg", "cost_at_15_profit": "cost_at_15_profit",
            "product_type": "product_type", "site": "site",
            "monthly_sales": "monthly_sales", "traffic_trend": "traffic_trend",
            "category": "category"
        }

        for field, col in field_mapping.items():
            value = getattr(data, field, None)
            if value is not None:
                updates.append(f"{col} = :{field}")
                params[field] = value

        # 类目为列表，需序列化为JSON存储
        if "category" in params and isinstance(params["category"], list):
            params["category"] = json.dumps(params["category"], ensure_ascii=False)

        if updates:
            update_sql = text(f"UPDATE product_selections SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id")
            db.execute(update_sql, params)
            db.commit()

        return {"success": True, "message": "选品记录更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新选品记录失败: {str(e)}")


@router.delete("/{selection_id}")
async def delete_product_selection(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        check = text("SELECT id FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL")
        if not db.execute(check, {"id": selection_id, "tid": current_user.tenant_id}).fetchone():
            raise HTTPException(status_code=404, detail="选品记录不存在")

        db.execute(text("UPDATE product_selections SET deleted_at = NOW() WHERE id = :id"), {"id": selection_id})
        db.commit()
        return {"success": True, "message": "选品记录删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除选品记录失败: {str(e)}")


def _calc_rating_score(rating: float | None, review_count: int | None) -> float:
    """根据产品评分和评论数计算星级评分"""
    if rating is None:
        return 20.0

    r = round(rating, 1)

    # 只按星级评分（抓取数据评论数普遍<10条，不再按评论数分档）
    if r >= 4.8: base = 18.0
    elif r >= 4.5: base = 16.0
    elif r >= 4.2: base = 13.0
    elif r >= 4.0: base = 10.0
    else: base = 5.0

    # 评论极少(≤3条)时参考价值低，打9折
    if (review_count or 0) <= 3:
        base = round(base * 0.9, 1)
    return base


def _calc_sales_score(monthly_sales: int | None) -> float:
    """根据近一个月销量计算销量评分"""
    s = monthly_sales or 0
    if s == 0: return 0.0
    if 1 <= s <= 5: return 3.0
    if 6 <= s <= 10: return 6.0
    if 11 <= s <= 15: return 9.0
    if 16 <= s <= 20: return 12.0
    if 21 <= s <= 25: return 15.0
    if 26 <= s <= 30: return 18.0
    return 20.0


def _calc_penalty_factor(rating_score: float) -> float:
    """根据星级评分计算惩罚因子（阈值与新星级阶梯对齐）"""
    if rating_score >= 16: return 1.00
    elif rating_score >= 13: return 0.95
    elif rating_score >= 10: return 0.85
    elif rating_score >= 5: return 0.70
    else: return 0.50


def _calc_composite_score(penalty_factor: float, traffic_score: float, sales_score: float) -> float:
    """根据公式计算综合评分：(惩罚因子 * 流量评分 * 0.6 + 销量评分 * 5 * 0.4).ROUND(2)"""
    return round(penalty_factor * traffic_score * 0.6 + sales_score * 5 * 0.4, 2)


def _calc_traffic_score(traffic_trend_str: str | None) -> tuple[float, str]:
    """根据流量趋势数据公式化计算流量评分（满分100），返回(评分, 详细结果JSON)"""
    import math
    import statistics
    import ast

    def r2(x):
        return round(float(x), 2)

    if not traffic_trend_str:
        return 0.0, ""

    try:
        month_volume = ast.literal_eval(traffic_trend_str)
    except Exception:
        return 0.0, ""

    if not isinstance(month_volume, dict) or not month_volume:
        return 0.0, ""

    # 多关键词嵌套格式 {关键词: {月份: 流量}}：每个关键词单独评分，取最优分作为商品流量分
    if any(isinstance(v, dict) for v in month_volume.values()):
        best_score, best_result, best_kw = 0.0, "", ""
        for kw, sub_series in month_volume.items():
            if not isinstance(sub_series, dict) or not sub_series:
                continue
            s, sr = _calc_traffic_score(str(sub_series))
            if s > best_score:
                best_score, best_result, best_kw = s, sr, kw
        if not best_kw:
            return 0.0, ""
        return best_score, f"最优关键词[{best_kw}] {best_result}"

    values = [v for v in month_volume.values() if isinstance(v, (int, float))]
    n = len(values)

    if n == 0:
        return 0.0, ""

    result = {
        "趋势方向强度分": 0.0,
        "趋势一致性分": 0.0,
        "相对增长倍数分": 0.0,
        "月均增长率分": 0.0,
        "趋势连续性分": 0.0,
        "波动惩罚分": 0.0,
        "趋势总分": 0.0,
        "最近3个月均值": 0.0,
        "之前3个月均值": 0.0,
        "趋势比值": 0.0,
        "历史最低值": r2(min(values)),
        "最新月份值": r2(values[-1]),
        "增长倍数": 0.0,
        "月均增长率": 0.0,
        "波动系数CV": 0.0,
    }

    # 一、趋势方向强度
    if n >= 6:
        last_avg = sum(values[-3:]) / 3
        prev_avg = sum(values[-6:-3]) / 3
        R = last_avg / prev_avg if prev_avg > 0 else 0
        score = max(0, min(25, (R - 1) * 18))
        result["最近3个月均值"] = r2(last_avg)
        result["之前3个月均值"] = r2(prev_avg)
        result["趋势比值"] = r2(R)
        result["趋势方向强度分"] = r2(score)

    # 二、趋势一致性
    if n >= 6:
        up = sum(1 for i in range(1, 6) if values[-6 + i] > values[-7 + i])
        result["趋势一致性分"] = r2((up / 5) * 10)

    # 三、相对增长倍数
    if n >= 2 and min(values) > 0:
        G = values[-1] / min(values)
        score = max(0, min(20, math.log2(G) * 6))
        result["增长倍数"] = r2(G)
        result["相对增长倍数分"] = r2(score)

    # 四、月均增长率
    if n >= 4 and values[-4] > 0:
        M = (values[-1] / values[-4]) ** (1 / 4) - 1
        score = max(0, min(10, M * 120))
        result["月均增长率"] = r2(M)
        result["月均增长率分"] = r2(score)

    # 五、趋势连续性
    if n >= 2:
        cur = max_streak = 0
        for i in range(1, n):
            if values[i] > values[i - 1]:
                cur += 1
                max_streak = max(max_streak, cur)
            else:
                cur = 0
        mapping = {2: 3, 3: 6, 4: 9, 5: 12}
        result["趋势连续性分"] = 15 if max_streak >= 6 else mapping.get(max_streak, 0)

    # 六、波动惩罚
    if n >= 6:
        last_6 = values[-6:]
        mean = statistics.mean(last_6)
        std = statistics.pstdev(last_6)
        CV = std / mean if mean > 0 else 0
        result["波动系数CV"] = r2(CV)
        if CV <= 0.25:
            result["波动惩罚分"] = 10
        elif CV <= 0.35:
            result["波动惩罚分"] = 7
        elif CV <= 0.50:
            result["波动惩罚分"] = 4

    total = (
        result["趋势方向强度分"]
        + result["趋势一致性分"]
        + result["相对增长倍数分"]
        + result["月均增长率分"]
        + result["趋势连续性分"]
        + result["波动惩罚分"]
    )

    result["趋势总分"] = r2(max(0, total))

    # 映射到满分100：原始总分约90分上限，线性放大到100
    raw_score = max(0, total)
    final_score = round(min(100, raw_score * (100 / 90)), 2)

    return final_score, json.dumps(result, ensure_ascii=False)


@router.post("/{selection_id}/analyze")
async def analyze_product_selection(
    selection_id: int,
    current_user: User = Depends(get_current_user)
):
    # 1. 查询产品数据后立即释放数据库连接，避免AI分析期间占用连接池
    from database.database import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))
        query = text("""
            SELECT id, product_title, url, asin, image_url, rating, review_count, keywords,
                   price, commission, first_leg_cost, last_mile_cost, weight_kg,
                   cost_at_15_profit, product_type, monthly_sales, traffic_trend
            FROM product_selections
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """)
        row = db.execute(query, {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        product_data = {
            "product_title": row[1],
            "url": row[2] or "",
            "asin": row[3] or "",
            "image_url": row[4] or "",
            "rating": row[5],
            "review_count": row[6],
            "keywords": row[7] or "",
            "price": float(row[8]) if row[8] is not None else None,
            "commission": float(row[9]) if row[9] is not None else None,
            "first_leg_cost": float(row[10]) if row[10] is not None else None,
            "last_mile_cost": float(row[11]) if row[11] is not None else None,
            "weight_kg": float(row[12]) if row[12] is not None else None,
            "cost_at_15_profit": float(row[13]) if row[13] is not None else None,
            "product_type": row[14] or "",
            "monthly_sales": row[15],
            "traffic_trend": row[16] or "",
        }
        product_rating = float(row[5]) if row[5] is not None else None
        product_review_count = row[6]
        product_monthly_sales = row[15]
    finally:
        db.close()

    # 2. AI分析（在线程池中运行，不阻塞事件循环，不占用数据库连接）
    from services.ai_analysis_service import analyze_product_selection as do_analyze
    ai_result = await do_analyze(product_data)

    if not ai_result:
        raise HTTPException(status_code=500, detail="AI分析失败，请稍后重试")

    # 3. 计算评分并写入数据库（新连接）
    rating_score = _calc_rating_score(product_rating, product_review_count)
    sales_score = _calc_sales_score(product_monthly_sales)
    penalty_factor = _calc_penalty_factor(rating_score)
    traffic_score, traffic_score_result = _calc_traffic_score(product_data.get("traffic_trend"))
    composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

    db = SessionLocal()
    try:
        db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))
        update_sql = text("""
            UPDATE product_selections SET
                seasonality = :seasonality,
                infringement_analysis = :infringement_analysis,
                infringement_conclusion = :infringement_conclusion,
                traffic_score_result = :traffic_score_result,
                traffic_score = :traffic_score,
                sales_score = :sales_score,
                rating_score = :rating_score,
                penalty_factor = :penalty_factor,
                composite_score = :composite_score,
                ai_raw_response = :ai_raw_response,
                updated_at = NOW()
            WHERE id = :id
        """)
        db.execute(update_sql, {
            "seasonality": ai_result.get("seasonality", ""),
            "infringement_analysis": ai_result.get("infringement_analysis", ""),
            "infringement_conclusion": ai_result.get("infringement_conclusion", ""),
            "traffic_score_result": traffic_score_result,
            "traffic_score": traffic_score,
            "sales_score": sales_score,
            "rating_score": rating_score,
            "penalty_factor": penalty_factor,
            "composite_score": composite_score,
            "ai_raw_response": json.dumps(ai_result, ensure_ascii=False),
            "id": selection_id,
        })
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"AI分析结果写入数据库失败: {e}")
        raise HTTPException(status_code=500, detail=f"AI分析结果保存失败: {str(e)}")
    finally:
        db.close()

    return {"success": True, "message": "AI分析完成", "data": {
        **ai_result, "rating_score": rating_score, "sales_score": sales_score,
        "penalty_factor": penalty_factor, "composite_score": composite_score
    }}


async def _analyze_one_product(selection_id: int, tenant_id: int) -> Dict[str, Any]:
    """分析单条选品：查数据(短连接) → AI分析 → 算分 → 写入(短连接)"""
    from database.database import SessionLocal
    from services.ai_analysis_service import analyze_product_selection as do_analyze
    try:
        db = SessionLocal()
        try:
            db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))
            query = text("""
                SELECT id, product_title, url, asin, image_url, rating, review_count, keywords,
                       price, commission, first_leg_cost, last_mile_cost, weight_kg,
                       cost_at_15_profit, product_type, monthly_sales, traffic_trend
                FROM product_selections
                WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """)
            row = db.execute(query, {"id": selection_id, "tid": tenant_id}).fetchone()
            if not row:
                return {"id": selection_id, "success": False, "message": "记录不存在"}

            product_data = {
                "product_title": row[1], "url": row[2] or "", "asin": row[3] or "",
                "image_url": row[4] or "", "rating": row[5], "review_count": row[6],
                "keywords": row[7] or "", "price": float(row[8]) if row[8] is not None else None,
                "commission": float(row[9]) if row[9] is not None else None,
                "first_leg_cost": float(row[10]) if row[10] is not None else None,
                "last_mile_cost": float(row[11]) if row[11] is not None else None,
                "weight_kg": float(row[12]) if row[12] is not None else None,
                "cost_at_15_profit": float(row[13]) if row[13] is not None else None,
                "product_type": row[14] or "", "monthly_sales": row[15],
                "traffic_trend": row[16] or "",
            }
            product_rating = float(row[5]) if row[5] is not None else None
            product_review_count = row[6]
            product_monthly_sales = row[15]
        finally:
            db.close()

        # AI分析（不占用数据库连接）
        ai_result = await do_analyze(product_data)
        if not ai_result:
            return {"id": selection_id, "success": False, "message": "AI分析失败"}

        rating_score = _calc_rating_score(product_rating, product_review_count)
        sales_score = _calc_sales_score(product_monthly_sales)
        penalty_factor = _calc_penalty_factor(rating_score)
        traffic_score, traffic_score_result = _calc_traffic_score(product_data.get("traffic_trend"))
        composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

        db = SessionLocal()
        try:
            db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))
            update_sql = text("""
                UPDATE product_selections SET
                    seasonality = :seasonality,
                    infringement_analysis = :infringement_analysis,
                    infringement_conclusion = :infringement_conclusion,
                    traffic_score_result = :traffic_score_result,
                    traffic_score = :traffic_score,
                    sales_score = :sales_score,
                    rating_score = :rating_score,
                    penalty_factor = :penalty_factor,
                    composite_score = :composite_score,
                    ai_raw_response = :ai_raw_response,
                    updated_at = NOW()
                WHERE id = :id
            """)
            db.execute(update_sql, {
                "seasonality": ai_result.get("seasonality", ""),
                "infringement_analysis": ai_result.get("infringement_analysis", ""),
                "infringement_conclusion": ai_result.get("infringement_conclusion", ""),
                "traffic_score_result": traffic_score_result,
                "traffic_score": traffic_score,
                "sales_score": sales_score,
                "rating_score": rating_score,
                "penalty_factor": penalty_factor,
                "composite_score": composite_score,
                "ai_raw_response": json.dumps(ai_result, ensure_ascii=False),
                "id": selection_id,
            })
            db.commit()
        finally:
            db.close()

        return {"id": selection_id, "success": True, "data": {
            **ai_result, "rating_score": rating_score, "sales_score": sales_score,
            "penalty_factor": penalty_factor, "composite_score": composite_score
        }}
    except Exception as e:
        logger.error(f"分析ID={selection_id}失败: {e}")
        return {"id": selection_id, "success": False, "message": str(e)}


async def _run_batch_analyze(batch_id: str, ids: List[int], tenant_id: int):
    """后台并发执行批量分析，实时更新进度"""
    progress = _batch_analyze_tasks[batch_id]
    semaphore = asyncio.Semaphore(BATCH_ANALYZE_CONCURRENCY)

    async def worker(sid: int):
        async with semaphore:
            result = await _analyze_one_product(sid, tenant_id)
        progress["completed"] += 1
        if result.get("success"):
            progress["success"] += 1
        else:
            progress["failed"] += 1
        progress["results"].append(result)

    try:
        await asyncio.gather(*(worker(sid) for sid in ids))
    except Exception as e:
        logger.error(f"批量分析任务{batch_id}异常: {e}")
    progress["status"] = "done"


def _cleanup_old_batch_tasks():
    """清理超过2小时的已完成任务"""
    now = datetime.now()
    expired = []
    for bid, task in _batch_analyze_tasks.items():
        if task.get("status") == "done" and (now - task.get("created_at", now)).total_seconds() > 7200:
            expired.append(bid)
    for bid in expired:
        _batch_analyze_tasks.pop(bid, None)


@router.post("/batch-analyze")
async def batch_analyze_product_selections(
    ids: List[int],
    current_user: User = Depends(get_current_user)
):
    """批量AI分析：立即返回任务ID，后台异步并发处理，通过进度接口查询结果"""
    if not ids:
        raise HTTPException(status_code=400, detail="请提供要分析的选品ID列表")

    _cleanup_old_batch_tasks()

    batch_id = uuid.uuid4().hex
    _batch_analyze_tasks[batch_id] = {
        "status": "running",
        "total": len(ids),
        "completed": 0,
        "success": 0,
        "failed": 0,
        "results": [],
        "created_at": datetime.now(),
    }
    task = asyncio.create_task(_run_batch_analyze(batch_id, ids, current_user.tenant_id))
    _batch_analyze_tasks[batch_id]["_task"] = task  # 持有引用防止被GC

    return {"success": True, "data": {"batch_id": batch_id, "total": len(ids)}}


@router.get("/batch-analyze/progress/{batch_id}")
async def get_batch_analyze_progress(
    batch_id: str,
    current_user: User = Depends(get_current_user)
):
    """查询批量分析任务进度"""
    task = _batch_analyze_tasks.get(batch_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return {
        "success": True,
        "data": {
            "status": task["status"],
            "total": task["total"],
            "completed": task["completed"],
            "success": task["success"],
            "failed": task["failed"],
            "results": task["results"],
        }
    }


@router.post("/switch-rate")
async def switch_exchange_rate(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """切换实时汇率/抓取时汇率，并按公式重新计算头程、进货价
    汇率方向：1外币 = X人民币
    - use_realtime=true：抓取实时汇率(1外币兑人民币)存入realtime_rate并按其重算
    - use_realtime=false：按抓取时汇率(scrape_rate)重算
    """
    use_realtime = bool(payload.get("use_realtime", True))
    try:
        realtime_rates = {}
        if use_realtime:
            realtime_rates = _get_cny_rates()
            if not realtime_rates:
                raise HTTPException(status_code=502, detail="获取实时汇率失败，请稍后重试")

        # 单条批量 UPDATE 重算全部记录（逐行循环在数千条记录时耗时超过前端超时）
        # 站点判断片段：货币 / us|de|uk
        site_cur_sql = ("CASE WHEN site LIKE '%德%' OR LOWER(site) LIKE '%de%' THEN 'EUR' "
                        "WHEN site LIKE '%英%' OR LOWER(site) LIKE '%uk%' OR LOWER(site) LIKE '%gb%' THEN 'GBP' "
                        "ELSE 'USD' END")
        site_key_sql = ("CASE WHEN site LIKE '%德%' OR LOWER(site) LIKE '%de%' THEN 'de' "
                        "WHEN site LIKE '%英%' OR LOWER(site) LIKE '%uk%' OR LOWER(site) LIKE '%gb%' THEN 'uk' "
                        "ELSE 'us' END")
        # 汇率表达式：实时模式用本次抓取的汇率（按站点货币），抓取时模式用 scrape_rate
        if use_realtime:
            rate_expr = (f"CASE WHEN {site_cur_sql} = 'EUR' THEN :r_eur "
                         f"WHEN {site_cur_sql} = 'GBP' THEN :r_gbp ELSE :r_usd END")
        else:
            rate_expr = "scrape_rate"
        # 货代费用（元/kg）与售价扣减比例（广告15%+毛利15%+仓储+税金+退货），按站点默认设置
        fee_expr = (f"CASE WHEN {site_key_sql} = 'us' THEN {_freight_fee_per_kg('us')} "
                    f"ELSE {_freight_fee_per_kg('de')} END")
        ded_expr = (f"CASE WHEN {site_key_sql} = 'us' THEN {_site_deduction_rate('us')} "
                    f"ELSE {_site_deduction_rate('de')} END")
        # 头程（外币）= 重量 * 货代费用 / 汇率；重量为空或0时保持原值
        first_leg_expr = f"ROUND(NULLIF(weight_kg, 0) * {fee_expr} / NULLIF({rate_expr}, 0), 3)"

        set_parts = []
        if use_realtime:
            set_parts.append(f"realtime_rate = COALESCE({rate_expr}, realtime_rate)")
        set_parts.append(f"first_leg_cost = COALESCE({first_leg_expr}, first_leg_cost)")
        # 进货价（人民币）= (售价*(1-扣减) - 头程 - 尾程 - 佣金) * 汇率；价格或汇率无效时保持原值
        set_parts.append(f"""cost_at_15_profit = COALESCE(
            ROUND((NULLIF(price, 0) * (1 - {ded_expr})
                   - COALESCE({first_leg_expr}, 0)
                   - COALESCE(last_mile_cost, 0)
                   - COALESCE(commission, 0)) * NULLIF({rate_expr}, 0), 2),
            cost_at_15_profit)""")
        set_parts.append("updated_at = NOW()")

        params = {"tid": current_user.tenant_id}
        if use_realtime:
            params.update({
                "r_eur": realtime_rates.get("EUR"),
                "r_gbp": realtime_rates.get("GBP"),
                "r_usd": realtime_rates.get("USD"),
            })
        result = db.execute(text(f"""
            UPDATE product_selections
            SET {', '.join(set_parts)}
            WHERE tenant_id = :tid AND deleted_at IS NULL
        """), params)
        updated = result.rowcount or 0

        db.commit()
        return {"success": True, "data": updated, "rates": realtime_rates}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"切换汇率失败: {e}")
        raise HTTPException(status_code=500, detail=f"切换汇率失败: {str(e)}")


@router.post("/recalc-scores")
async def recalc_all_scores(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """重新计算所有选品记录的评分"""
    try:
        rows = db.execute(text("""
            SELECT id, rating, review_count, monthly_sales, traffic_trend
            FROM product_selections
            WHERE tenant_id = :tid AND deleted_at IS NULL
        """), {"tid": current_user.tenant_id}).fetchall()

        updated = 0
        for row in rows:
            rid = row[0]
            rating_score = _calc_rating_score(row[1], row[2])
            sales_score = _calc_sales_score(row[3])
            penalty_factor = _calc_penalty_factor(rating_score)
            traffic_score, traffic_result_json = _calc_traffic_score(row[4])
            composite_score = _calc_composite_score(penalty_factor, traffic_score, sales_score)

            db.execute(text("""
                UPDATE product_selections SET
                    traffic_score = :ts,
                    traffic_score_result = :tsr,
                    sales_score = :ss,
                    rating_score = :rs,
                    penalty_factor = :pf,
                    composite_score = :cs,
                    updated_at = NOW()
                WHERE id = :id
            """), {
                "id": rid,
                "ts": traffic_score,
                "tsr": traffic_result_json,
                "ss": sales_score,
                "rs": rating_score,
                "pf": penalty_factor,
                "cs": composite_score,
            })
            updated += 1

        db.commit()
        return {"success": True, "data": updated}
    except Exception as e:
        db.rollback()
        logger.error(f"重新计算评分失败: {e}")
        raise HTTPException(status_code=500, detail=f"重新计算评分失败: {str(e)}")


class RescrapeFbaData(BaseModel):
    """FBA利润重抓数据（ids 为空时全量重算）"""
    ids: Optional[List[int]] = None


@router.post("/rescrape-fba-fees")
async def rescrape_fba_fees(data: Optional[RescrapeFbaData] = None, current_user: User = Depends(get_current_user)):
    """手动触发FBA利润重抓（后台执行）：
    - 传 ids：仅重算勾选的记录（强制，含数据完整的）
    - 不传 ids：全量重算
    调用卖家精灵接口刷新费用数据（佣金/头程/尾程/重量），
    3次重试均为0.0且费用不完整的记录软删除隐藏，补齐数据的记录恢复显示"""
    import threading
    from services.scheduler import product_selection_fees_rescrape_job

    ids = (data.ids if data else None) or []
    threading.Thread(
        target=product_selection_fees_rescrape_job,
        kwargs={"ids": ids} if ids else {"full": True},
        daemon=True
    ).start()
    msg = f"已对勾选的 {len(ids)} 条选品启动FBA利润重抓，完成后数据自动更新" if ids \
        else "FBA利润全量重抓已在后台启动，完成后数据自动更新"
    return {"success": True, "message": msg}


class SubmitForApprovalData(BaseModel):
    """申请选品弹窗数据"""
    ali_1688_url: Optional[str] = None
    ali_1688_urls: Optional[List[str]] = None
    purchase_price: Optional[float] = None
    purchase_quantity: Optional[int] = None
    store_group_id: Optional[int] = None
    store_group_ids: Optional[List[int]] = None  # 多选店铺：每店一条独立申请（第一个留本记录，其余复制）
    apply_remark: Optional[str] = None
    apply_images: Optional[List[str]] = None
    moq: Optional[int] = None


@router.post("/{selection_id}/submit-for-approval")
async def submit_for_approval(
    selection_id: int,
    data: Optional[SubmitForApprovalData] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:submit"))
):
    """提交选品审批（数量达起订量 -> pending；不足 -> grouping 待拼团，期限7天），同时记录1688链接/采购价/数量/申请人/店铺分组"""
    try:
        row = db.execute(text(
            "SELECT id, status, product_title, moq, purchase_quantity, group_members FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        current_status = row[1] or ""
        if current_status == "pending":
            raise HTTPException(status_code=400, detail="该选品已处于待审批状态")
        if current_status == "approved":
            raise HTTPException(status_code=400, detail="该选品已审批通过")

        # 店铺分组（支持多选）：确定最终店铺 id 列表
        store_ids: list = []
        if data:
            if data.store_group_ids:
                store_ids = [g for g in data.store_group_ids if g]
            elif data.store_group_id:
                store_ids = [data.store_group_id]
        if store_ids:
            ph = ", ".join(f":sg{i}" for i in range(len(store_ids)))
            sg_params = {f"sg{i}": g for i, g in enumerate(store_ids)}
            sg_params["tid"] = current_user.tenant_id
            valid_rows = db.execute(text(
                f"SELECT id FROM store_groups WHERE id IN ({ph}) AND tenant_id = :tid AND deleted_at IS NULL"
            ), sg_params).fetchall()
            valid_ids = {r[0] for r in valid_rows}
            invalid = [g for g in store_ids if g not in valid_ids]
            if invalid:
                raise HTTPException(status_code=400, detail=f"店铺分组不存在: {invalid}")
            # 主记录写入第一个分组（兼容现有列表 JOIN 显示），全部分组存 store_group_ids（JSON）合并为一条申请
            data.store_group_id = store_ids[0]

        # 起订量判断：申请数量 < 起订量 -> 待拼团（grouping，期限7天），否则 -> 待审批
        eff_moq = data.moq if (data and data.moq is not None) else row[3]
        eff_qty = data.purchase_quantity if (data and data.purchase_quantity is not None) else row[4]
        to_grouping = bool(eff_moq and eff_moq > 0 and eff_qty is not None and eff_qty < eff_moq)

        set_clause = "status = :st, group_deadline = :gdl, updated_at = NOW()"
        params = {
            "id": selection_id, "uid": current_user.id,
            "st": "grouping" if to_grouping else "pending",
            "gdl": (datetime.now() + timedelta(days=7)) if to_grouping else None,
        }
        if to_grouping:
            # 发起人作为第一个拼团成员（重提时更新自己的数量），自动带上本人店铺分组
            members = _parse_group_members(row[5])
            display_name = getattr(current_user, "nickname", None) or current_user.username
            entry = {"user_id": current_user.id, "username": display_name,
                     "quantity": eff_qty, "joined_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            # 发起人分组优先取申请时填写的店铺分组，未填时回退按用户-店铺关联自动推断
            ug = None
            if store_ids:
                gname = db.execute(text(
                    "SELECT name FROM store_groups WHERE id = :gid AND tenant_id = :tid AND deleted_at IS NULL"
                ), {"gid": store_ids[0], "tid": current_user.tenant_id}).fetchone()
                if gname:
                    ug = (store_ids[0], gname[0])
            if ug is None:
                ug = _get_user_store_group(db, current_user.tenant_id, current_user.id)
            if ug:
                entry["store_group_id"], entry["store_group_name"] = ug
            members = [m for m in members if m.get("user_id") != current_user.id]
            members.insert(0, entry)
            set_clause += ", group_members = :gmem"
            params["gmem"] = json.dumps(members, ensure_ascii=False)
        if data:
            if data.ali_1688_url is not None:
                set_clause += ", ali_1688_url = :aurl"
                params["aurl"] = data.ali_1688_url.strip()
            if data.purchase_price is not None:
                set_clause += ", purchase_price = :pprice"
                params["pprice"] = data.purchase_price
            if data.purchase_quantity is not None:
                set_clause += ", purchase_quantity = :pqty"
                params["pqty"] = data.purchase_quantity
            if data.store_group_id is not None:
                set_clause += ", store_group_id = :sgid"
                params["sgid"] = data.store_group_id
                # 多选店铺合并为一条申请：全部分组存 JSON（单选时也统一记录）
                set_clause += ", store_group_ids = :sgids"
                params["sgids"] = json.dumps(store_ids)
            # 申请扩展信息：多个1688链接/备注/图片/起订量
            if data.ali_1688_urls is not None:
                urls = [u.strip() for u in data.ali_1688_urls if u and u.strip()]
                if urls:
                    set_clause += ", ali_1688_urls = :aurls"
                    params["aurls"] = json.dumps(urls, ensure_ascii=False)
                    if data.ali_1688_url is None:
                        set_clause += ", ali_1688_url = :aurl0"
                        params["aurl0"] = urls[0]
            if data.apply_remark is not None:
                set_clause += ", apply_remark = :aremark"
                params["aremark"] = data.apply_remark.strip()[:1000]
            if data.apply_images is not None:
                imgs = [u.strip() for u in data.apply_images if u and u.strip()]
                set_clause += ", apply_images = :aimgs"
                params["aimgs"] = json.dumps(imgs, ensure_ascii=False)
            if data.moq is not None:
                set_clause += ", moq = :moq"
                params["moq"] = data.moq
        # 申请人始终记录为当前操作用户
        set_clause += ", applicant_id = :uid"

        db.execute(text(f"UPDATE product_selections SET {set_clause} WHERE id = :id"), params)

        db.commit()
        if to_grouping:
            return {"success": True, "message": f"数量未达起订量，已进入待拼团（期限7天）", "data": {"status": "grouping"}}
        return {"success": True, "message": "已提交审批", "data": {"status": "pending"}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"提交选品审批失败: {e}")
        raise HTTPException(status_code=500, detail=f"提交审批失败: {str(e)}")


class GroupBuyData(BaseModel):
    """拼团参与数据"""
    quantity: int


@router.post("/{selection_id}/group-buy")
async def group_buy(
    selection_id: int,
    data: GroupBuyData,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:submit"))
):
    """参与拼团：向待拼团记录追加本人数量；累计达到起订量后自动转待审批"""
    try:
        if data.quantity is None or data.quantity <= 0:
            raise HTTPException(status_code=400, detail="拼团数量必须大于0")

        row = db.execute(text(
            "SELECT status, moq, purchase_quantity, group_members, group_deadline, applicant_id FROM product_selections "
            "WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")
        if (row[0] or "") != "grouping":
            raise HTTPException(status_code=400, detail="该选品不在待拼团状态")
        if row[4] and row[4] < datetime.now():
            raise HTTPException(status_code=400, detail="拼团已超期")

        is_initiator = row[5] == current_user.id
        members = _parse_group_members(row[3])
        display_name = getattr(current_user, "nickname", None) or current_user.username
        ug = _get_user_store_group(db, current_user.tenant_id, current_user.id)
        if is_initiator:
            # 发起人参与：数量在原拼团数基础上累加
            base = 0
            found = False
            for i, m in enumerate(members):
                if m.get("user_id") == current_user.id:
                    base = m.get("quantity", 0) or 0
                    found = True
                    break
            if not found:
                base = row[2] or 0  # 无成员记录时以申请数量为基数
            entry = {"user_id": current_user.id, "username": display_name,
                     "quantity": base + data.quantity, "joined_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            if ug:
                entry["store_group_id"], entry["store_group_name"] = ug
            if found:
                members[i] = entry
            else:
                members.append(entry)
        else:
            entry = {"user_id": current_user.id, "username": display_name,
                     "quantity": data.quantity, "joined_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            if ug:
                entry["store_group_id"], entry["store_group_name"] = ug
            replaced = False
            for i, m in enumerate(members):
                if m.get("user_id") == current_user.id:
                    members[i] = entry  # 已参与过：更新数量
                    replaced = True
                    break
            if not replaced:
                members.append(entry)

        # 已拼总数 = 所有成员数量之和（发起人成员记录始终与其申请数量保持同基数）
        total = sum(m.get("quantity", 0) or 0 for m in members)

        reached = bool(row[1] and row[1] > 0 and total >= row[1])
        db.execute(text(
            "UPDATE product_selections SET group_members = :gmem, group_deadline = :gdl, status = :st, updated_at = NOW() WHERE id = :id"
        ), {
            "gmem": json.dumps(members, ensure_ascii=False),
            "gdl": None if reached else row[4],
            "st": "pending" if reached else "grouping",
            "id": selection_id,
        })
        db.commit()
        msg = "拼团成功，已达到起订量，进入待审批" if reached else "拼团成功"
        return {"success": True, "message": msg, "data": {"status": "pending" if reached else "grouping", "total": total, "moq": row[1]}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"拼团失败: {e}")
        raise HTTPException(status_code=500, detail=f"拼团失败: {str(e)}")


class ApproveData(BaseModel):
    """审批通过弹窗数据"""
    product_name: Optional[str] = None


@router.post("/{selection_id}/approve")
async def approve_selection(
    selection_id: int,
    data: Optional[ApproveData] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:approve"))
):
    """审批选品（状态 pending -> approved），同时生成新成品和补货单。

    成品：品名取弹窗填写值（未填时回退产品标题），编码自动生成（BXHS-CP-#####）。
    补货单：数量/店铺分组取申请选品时填写值，申请人(created_by)为选品申请人。
    """
    try:
        row = db.execute(text(
            "SELECT id, status, product_title, image_url, asin, purchase_price, purchase_quantity, "
            "applicant_id, store_group_id, store_group_ids, group_members FROM product_selections "
            "WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        current_status = row[1] or ""
        if current_status != "pending":
            raise HTTPException(status_code=400, detail="只能审批待审批状态的选品")

        (_, _, product_title, image_url, asin,
         purchase_price, purchase_quantity, applicant_id, store_group_id, sg_ids_raw, members_raw) = row

        product_name = (data.product_name or "").strip() if data else ""
        if not product_name:
            product_name = (product_title or "").strip()
        if not product_name:
            raise HTTPException(status_code=400, detail="请填写品名")

        now = datetime.now()

        # 1. 生成产品编码（成品 BXHS-CP-#####，与 /next-code 逻辑一致）
        prefix = "BXHS-CP-"
        code_row = db.execute(text("""
            SELECT product_code FROM products
            WHERE tenant_id = :tid AND product_code LIKE :pat
            ORDER BY CAST(SUBSTRING(product_code, :pl) AS UNSIGNED) DESC
            LIMIT 1
        """), {"tid": current_user.tenant_id, "pat": f"{prefix}%", "pl": len(prefix) + 1}).fetchone()
        next_num = 1
        if code_row and code_row[0]:
            digits = "".join(ch for ch in str(code_row[0])[len(prefix):] if ch.isdigit())
            if digits:
                next_num = int(digits) + 1
        product_code = f"{prefix}{next_num:05d}"

        # 2. 创建新成品
        result = db.execute(text("""
            INSERT INTO products (tenant_id, product_code, name, product_type, product_attribute,
                purchase_price, main_image, asin, status, is_robot_monitored, no_accessory, local_quantity,
                created_at, updated_at)
            VALUES (:tenant_id, :product_code, :name, 'finished', 'general',
                :purchase_price, :main_image, :asin, 'active', 1, 0, 0,
                :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "product_code": product_code,
            "name": product_name,
            "purchase_price": purchase_price,
            "main_image": image_url,
            "asin": asin,
            "created_at": now,
            "updated_at": now,
        })
        product_id = result.lastrowid
        log_product_create(
            db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
            product_id, product_code, product_name,
            {"product_code": product_code, "name": product_name, "product_type": "finished",
             "purchase_price": float(purchase_price) if purchase_price is not None else None,
             "来源": "选品审批"}
        )

        # 3. 创建补货单（申请人为选品申请人）
        # 数量按拼团成员分组汇总：成员带分组归该组，无分组归申请分组第一个；
        # 无成员记录（直接达标）时每个申请分组各一份申请数量
        # gid=0（成员完全无分组）的记录跳过，不生成补货单
        group_qty_list = _resolve_group_quantities(members_raw, sg_ids_raw, purchase_quantity)
        order_id = None
        order_number = None
        order_count = 0

        for gid, qty, creator_id in group_qty_list:
            if not gid:
                logger.warning(f"选品 {selection_id} 存在无分组归属的拼团数量 {qty}，未生成补货单")
                continue
            sg = db.execute(text(
                "SELECT name FROM store_groups WHERE id = :gid AND tenant_id = :tid AND deleted_at IS NULL"
            ), {"gid": gid, "tid": current_user.tenant_id}).fetchone()
            if not sg:
                raise HTTPException(status_code=400, detail="申请选品时填写的店铺分组不存在")
            store_group_name = sg[0]

            order_number = generate_replenishment_order_number()
            db.execute(text("""
                INSERT INTO replenishment_orders (tenant_id, order_number, store_group_id, status, notes,
                    created_by, created_at, updated_at)
                VALUES (:tenant_id, :order_number, :store_group_id, 'pending', :notes,
                    :created_by, :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "order_number": order_number,
                "store_group_id": gid,
                "notes": f"由选品审批生成（{product_name}）",
                "created_by": creator_id or applicant_id or current_user.id,
                "created_at": now,
                "updated_at": now,
            })
            order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

            db.execute(text("""
                INSERT INTO replenishment_items (tenant_id, replenishment_order_id, product_id, quantity, notes,
                    created_at, updated_at)
                VALUES (:tenant_id, :replenishment_order_id, :product_id, :quantity, :notes,
                    :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "replenishment_order_id": order_id,
                "product_id": product_id,
                "quantity": qty,
                "notes": f"来源选品：{product_title or ''}",
                "created_at": now,
                "updated_at": now,
            })
            log_order_create(
                db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                "replenishment", order_id, order_number,
                {"单号": order_number, "店铺分组": store_group_name,
                 "数量": qty, "来源": "选品审批"}
            )
            order_count += 1

        # 4. 更新选品状态
        db.execute(text(
            "UPDATE product_selections SET status = 'approved', updated_at = NOW() WHERE id = :id"
        ), {"id": selection_id})

        db.commit()
        if order_count > 0:
            message = "审批通过，已生成成品和补货单"
        else:
            message = "审批通过，已生成成品；拼团成员均无店铺分组归属，未生成补货单"
        data = {
            "product_id": product_id,
            "product_code": product_code,
            "product_name": product_name,
            "order_count": order_count,
        }
        if order_id:
            data["replenishment_order_id"] = order_id
            data["replenishment_order_number"] = order_number
        return {"success": True, "message": message, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"审批选品失败: {e}")
        raise HTTPException(status_code=500, detail=f"审批失败: {str(e)}")


class BatchApproveItem(BaseModel):
    """批量审批单条数据"""
    selection_id: int
    product_name: Optional[str] = None


class BatchApproveSelectionsRequest(BaseModel):
    """批量审批请求：品名逐条填写"""
    items: List[BatchApproveItem]


@router.post("/batch-approve")
async def batch_approve_selections(
    data: BatchApproveSelectionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:approve"))
):
    """批量审批选品：每条选品生成一个成品（品名逐条填写）。

    补货单按 申请人+店铺分组 合并：相同的生成同一张补货单，不同的分开多张。
    每张补货单的数量取各选品申请时填写值，申请人(created_by)为该组选品的申请人。
    """
    if not data.items:
        raise HTTPException(status_code=400, detail="请选择要审批的选品")

    try:
        ids = [i.selection_id for i in data.items]
        placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
        params = {f"id{i}": ids[i] for i in range(len(ids))}
        params["tid"] = current_user.tenant_id
        rows = db.execute(text(
            f"SELECT id, status, product_title, image_url, asin, purchase_price, purchase_quantity, "
            f"applicant_id, store_group_id, store_group_ids, group_members FROM product_selections "
            f"WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL"
        ), params).fetchall()
        row_map = {r[0]: r for r in rows}

        valid = []
        for item in data.items:
            row = row_map.get(item.selection_id)
            if not row:
                raise HTTPException(status_code=404, detail=f"选品记录 {item.selection_id} 不存在")
            if (row[1] or "") != "pending":
                raise HTTPException(status_code=400, detail="只能审批待审批状态的选品")
            valid.append((item, row))

        def _next_product_code() -> str:
            prefix = "BXHS-CP-"
            code_row = db.execute(text("""
                SELECT product_code FROM products
                WHERE tenant_id = :tid AND product_code LIKE :pat
                ORDER BY CAST(SUBSTRING(product_code, :pl) AS UNSIGNED) DESC
                LIMIT 1
            """), {"tid": current_user.tenant_id, "pat": f"{prefix}%", "pl": len(prefix) + 1}).fetchone()
            next_num = 1
            if code_row and code_row[0]:
                digits = "".join(ch for ch in str(code_row[0])[len(prefix):] if ch.isdigit())
                if digits:
                    next_num = int(digits) + 1
            return f"{prefix}{next_num:05d}"

        # 缓存店铺分组名称
        sg_cache: Dict[tuple, str] = {}

        def _resolve_store_group_name(sgid: Optional[int]) -> str:
            if not sgid:
                return ""
            key = ("sg", sgid)
            if key in sg_cache:
                return sg_cache[key]
            sg = db.execute(text(
                "SELECT name FROM store_groups WHERE id = :gid AND tenant_id = :tid AND deleted_at IS NULL"
            ), {"gid": sgid, "tid": current_user.tenant_id}).fetchone()
            if not sg:
                raise HTTPException(status_code=400, detail="申请选品时填写的店铺分组不存在")
            sg_cache[key] = sg[0]
            return sg[0]

        now = datetime.now()

        # 按 (创建人, 店铺分组) 分组，保持输入顺序
        # 数量按拼团成员分组汇总：成员带分组归该组且创建人=该组成员，无分组归申请分组第一个；
        # 无成员记录（直接达标）时创建人=申请人、每个申请分组各一份申请数量
        groups: Dict[tuple, list] = {}  # (creator_id, gid) -> [(item, row, qty), ...]
        for item, row in valid:
            applicant_id = row[7] or current_user.id
            for gid, qty, creator_id in _resolve_group_quantities(row[10], row[9], row[6]):
                if not gid:
                    logger.warning(f"选品 {row[0]} 存在无分组归属的拼团数量 {qty}，跳过补货明细")
                    continue
                gk = (creator_id or applicant_id, gid)
                if gk not in groups:
                    groups[gk] = []
                groups[gk].append((item, row, qty))

        # 预创建所有成品（同组内顺序取号，编码连续不重复）
        products: list = []  # 每个选品一条成品（跨分组共用）
        product_map: Dict[int, dict] = {}  # selection_id -> 成品记录
        for item, row in valid:
            if item.selection_id in product_map:
                continue
            (_, _, product_title, image_url, asin,
             purchase_price, purchase_quantity, applicant_id, _, _) = row

            product_name = (item.product_name or "").strip()
            if not product_name:
                product_name = (product_title or "").strip()
            if not product_name:
                raise HTTPException(status_code=400, detail="请填写品名")

            product_code = _next_product_code()
            result = db.execute(text("""
                INSERT INTO products (tenant_id, product_code, name, product_type, product_attribute,
                    purchase_price, main_image, asin, status, is_robot_monitored, no_accessory, local_quantity,
                    created_at, updated_at)
                VALUES (:tenant_id, :product_code, :name, 'finished', 'general',
                    :purchase_price, :main_image, :asin, 'active', 1, 0, 0,
                    :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "product_code": product_code,
                "name": product_name,
                "purchase_price": purchase_price,
                "main_image": image_url,
                "asin": asin,
                "created_at": now,
                "updated_at": now,
            })
            product_id = result.lastrowid
            log_product_create(
                db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                product_id, product_code, product_name,
                {"product_code": product_code, "name": product_name, "product_type": "finished",
                 "purchase_price": float(purchase_price) if purchase_price is not None else None,
                 "来源": "选品批量审批"}
            )
            rec = {
                "product_id": product_id,
                "product_code": product_code,
                "product_name": product_name,
                "purchase_quantity": purchase_quantity,
                "product_title": product_title,
            }
            products.append(rec)
            product_map[item.selection_id] = rec

        # 每个 (申请人, 店铺分组) 组生成一张补货单（多分组申请的选品在每组各计入一条明细）
        created_orders = []
        approved_ids = []
        for gk, group_items in groups.items():
            applicant_id, store_group_id_raw = gk
            store_group_id = store_group_id_raw or None
            store_group_name = _resolve_store_group_name(store_group_id)

            order_number = generate_replenishment_order_number()
            db.execute(text("""
                INSERT INTO replenishment_orders (tenant_id, order_number, store_group_id, status, notes,
                    created_by, created_at, updated_at)
                VALUES (:tenant_id, :order_number, :store_group_id, 'pending', :notes,
                    :created_by, :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "order_number": order_number,
                "store_group_id": store_group_id,
                "notes": f"由选品批量审批生成（{len(group_items)} 条）",
                "created_by": applicant_id,
                "created_at": now,
                "updated_at": now,
            })
            order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

            for item, _, qty in group_items:
                p = product_map[item.selection_id]
                db.execute(text("""
                    INSERT INTO replenishment_items (tenant_id, replenishment_order_id, product_id, quantity, notes,
                        created_at, updated_at)
                    VALUES (:tenant_id, :replenishment_order_id, :product_id, :quantity, :notes,
                        :created_at, :updated_at)
                """), {
                    "tenant_id": current_user.tenant_id,
                    "replenishment_order_id": order_id,
                    "product_id": p["product_id"],
                    "quantity": qty,
                    "notes": f"来源选品：{p['product_title'] or ''}",
                    "created_at": now,
                    "updated_at": now,
                })

            log_order_create(
                db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                "replenishment", order_id, order_number,
                {"单号": order_number, "店铺分组": store_group_name,
                 "明细数量": len(group_items), "来源": "选品批量审批"}
            )
            created_orders.append({
                "order_id": order_id,
                "order_number": order_number,
                "store_group_name": store_group_name,
                "item_count": len(group_items),
            })
            # 收集该组对应的 selection_id
            for item, _, _ in group_items:
                if item.selection_id not in approved_ids:
                    approved_ids.append(item.selection_id)

        upd_placeholders = ", ".join(f":sid{i}" for i in range(len(approved_ids)))
        upd_params = {f"sid{i}": approved_ids[i] for i in range(len(approved_ids))}
        db.execute(text(
            f"UPDATE product_selections SET status = 'approved', updated_at = NOW() WHERE id IN ({upd_placeholders})"
        ), upd_params)

        db.commit()
        return {
            "success": True,
            "message": f"批量审批通过，已生成 {len(valid)} 个成品、{len(created_orders)} 张补货单",
            "data": {
                "approved_count": len(approved_ids),
                "orders": created_orders,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"批量审批选品失败: {e}")
        raise HTTPException(status_code=500, detail=f"批量审批失败: {str(e)}")


class RejectData(BaseModel):
    """拒绝审批数据"""
    ids: List[int]
    reason: Optional[str] = None


def _ensure_reject_reason_column(db: Session):
    """确保选品表有拒绝原因字段。"""
    try:
        db.execute(text(
            "ALTER TABLE product_selections ADD COLUMN reject_reason VARCHAR(500) NULL COMMENT '拒绝原因' AFTER status"
        ))
    except Exception:
        db.rollback()


@router.post("/reject")
async def reject_selection(
    data: RejectData,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:approve"))
):
    """拒绝选品审批（状态 pending -> rejected），拒绝原因选填；支持批量。

    data.ids 传 1 条即单个拒绝，多条即批量拒绝。
    """
    if not data.ids:
        raise HTTPException(status_code=400, detail="请选择要拒绝的选品")
    try:
        _ensure_reject_reason_column(db)
        placeholders = ", ".join(f":id{i}" for i in range(len(data.ids)))
        params = {f"id{i}": data.ids[i] for i in range(len(data.ids))}
        params["tid"] = current_user.tenant_id
        rows = db.execute(text(
            f"SELECT id, status FROM product_selections "
            f"WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL"
        ), params).fetchall()

        pending_ids = [r[0] for r in rows if (r[1] or "") == "pending"]
        if not pending_ids:
            raise HTTPException(status_code=400, detail="所选选品中没有待审批状态的记录")

        upd_placeholders = ", ".join(f":pid{i}" for i in range(len(pending_ids)))
        upd_params = {f"pid{i}": pending_ids[i] for i in range(len(pending_ids))}
        upd_params["reason"] = (data.reason or "").strip() or None
        db.execute(text(
            f"UPDATE product_selections SET status = 'rejected', reject_reason = :reason, updated_at = NOW() "
            f"WHERE id IN ({upd_placeholders})"
        ), upd_params)
        db.commit()
        skipped = len(data.ids) - len(pending_ids)
        msg = f"已拒绝 {len(pending_ids)} 条选品"
        if skipped > 0:
            msg += f"，跳过 {skipped} 条非待审批状态的记录"
        return {"success": True, "message": msg, "data": {"rejected_count": len(pending_ids), "skipped_count": skipped}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"拒绝选品审批失败: {e}")
        raise HTTPException(status_code=500, detail=f"拒绝审批失败: {str(e)}")


@router.post("/{selection_id}/revoke-approval")
async def revoke_approval(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:approve"))
):
    """撤回选品审批（状态 approved -> pending），仅回退状态，已生成的成品和补货单不受影响"""
    try:
        row = db.execute(text(
            "SELECT id, status FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        if (row[1] or "") != "approved":
            raise HTTPException(status_code=400, detail="只能撤回已审批状态的选品")

        db.execute(text(
            "UPDATE product_selections SET status = 'pending', updated_at = NOW() WHERE id = :id"
        ), {"id": selection_id})
        db.commit()
        return {"success": True, "message": "已撤回审批"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"撤回选品审批失败: {e}")
        raise HTTPException(status_code=500, detail=f"撤回审批失败: {str(e)}")


@router.post("/batch-revoke-approval")
async def batch_revoke_approval(
    ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product_selection:approve"))
):
    """批量撤回选品审批（状态 approved -> pending），仅回退状态，已生成的成品和补货单不受影响"""
    if not ids:
        raise HTTPException(status_code=400, detail="请选择要撤回审批的选品")
    try:
        placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
        params = {f"id{i}": ids[i] for i in range(len(ids))}
        params["tid"] = current_user.tenant_id
        rows = db.execute(text(
            f"SELECT id, status FROM product_selections "
            f"WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL"
        ), params).fetchall()

        approved_ids = [r[0] for r in rows if (r[1] or "") == "approved"]
        if not approved_ids:
            raise HTTPException(status_code=400, detail="所选选品中没有已审批状态的记录")

        upd_placeholders = ", ".join(f":pid{i}" for i in range(len(approved_ids)))
        upd_params = {f"pid{i}": approved_ids[i] for i in range(len(approved_ids))}
        db.execute(text(
            f"UPDATE product_selections SET status = 'pending', updated_at = NOW() WHERE id IN ({upd_placeholders})"
        ), upd_params)
        db.commit()
        skipped = len(ids) - len(approved_ids)
        msg = f"成功撤回 {len(approved_ids)} 条选品审批"
        if skipped > 0:
            msg += f"，跳过 {skipped} 条非已审批状态的记录"
        return {"success": True, "message": msg, "data": {"revoked_count": len(approved_ids), "skipped_count": skipped}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"批量撤回选品审批失败: {e}")
        raise HTTPException(status_code=500, detail=f"批量撤回审批失败: {str(e)}")


@router.post("/{selection_id}/cancel-approval-application")
async def cancel_approval_application(
    selection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """取消申请选品（待审批/待拼团 -> 未申请），并清空申请人与申请信息，避免重申时残留"""
    try:
        row = db.execute(text(
            "SELECT id, status, product_title FROM product_selections WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"
        ), {"id": selection_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="选品记录不存在")

        current_status = row[1] or ""
        if current_status not in ("pending", "grouping"):
            raise HTTPException(status_code=400, detail="只能取消待审批或待拼团状态的选品")

        db.execute(text("""
            UPDATE product_selections SET
                status = NULL,
                applicant_id = NULL,
                store_group_id = NULL,
                store_group_ids = NULL,
                ali_1688_url = NULL,
                ali_1688_urls = NULL,
                purchase_price = NULL,
                purchase_quantity = NULL,
                moq = NULL,
                apply_remark = NULL,
                apply_images = NULL,
                group_members = NULL,
                group_deadline = NULL,
                updated_at = NOW()
            WHERE id = :id
        """), {"id": selection_id})
        db.commit()
        return {"success": True, "message": "已取消申请"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"取消申请选品失败: {e}")
        raise HTTPException(status_code=500, detail=f"取消申请失败: {str(e)}")


@router.post("/batch-cancel-approval")
async def batch_cancel_approval_application(
    ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量取消申请选品（待审批/待拼团 -> 未申请，一次事务完成，并清空申请人与申请信息）"""
    if not ids:
        raise HTTPException(status_code=400, detail="请选择要取消申请的选品")
    try:
        placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
        params = {f"id{i}": ids[i] for i in range(len(ids))}
        params["tid"] = current_user.tenant_id
        rows = db.execute(text(
            f"SELECT id, status FROM product_selections "
            f"WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL"
        ), params).fetchall()

        cancel_ids = [r[0] for r in rows if (r[1] or "") in ("pending", "grouping")]
        if not cancel_ids:
            raise HTTPException(status_code=400, detail="所选选品中没有待审批或待拼团状态的记录")

        upd_placeholders = ", ".join(f":pid{i}" for i in range(len(cancel_ids)))
        upd_params = {f"pid{i}": cancel_ids[i] for i in range(len(cancel_ids))}
        db.execute(text(f"""
            UPDATE product_selections SET
                status = NULL,
                applicant_id = NULL,
                store_group_id = NULL,
                store_group_ids = NULL,
                ali_1688_url = NULL,
                ali_1688_urls = NULL,
                purchase_price = NULL,
                purchase_quantity = NULL,
                moq = NULL,
                apply_remark = NULL,
                apply_images = NULL,
                group_members = NULL,
                group_deadline = NULL,
                updated_at = NOW()
            WHERE id IN ({upd_placeholders})
        """), upd_params)
        db.commit()
        skipped = len(ids) - len(cancel_ids)
        msg = f"成功取消 {len(cancel_ids)} 条选品申请"
        if skipped > 0:
            msg += f"，跳过 {skipped} 条非待审批状态的记录"
        return {"success": True, "message": msg, "data": {"cancelled_count": len(cancel_ids), "skipped_count": skipped}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"批量取消申请选品失败: {e}")
        raise HTTPException(status_code=500, detail=f"批量取消申请失败: {str(e)}")

