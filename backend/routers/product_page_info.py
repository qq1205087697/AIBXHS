from fastapi import APIRouter, Depends, Query, UploadFile, File, Request
from sqlalchemy.orm import Session
from sqlalchemy import text, insert
from typing import Optional, List
from pydantic import BaseModel
from database.database import get_db
from models.product_page_info import ProductPageInfo
from models.store import Store
from models.restock import InventorySnapshot
from dependencies import get_current_user
from models.user import User
from services.operation_log import write_log
from config import get_settings
from openai import OpenAI
import httpx
import asyncio
import openpyxl
import io
import logging
import os
import json
import re

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/product-page-info", tags=["product-page-info"])

# 初始化AI客户端（用于AI编写功能）
settings = get_settings()
try:
    ai_client = OpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_API_BASE
    ) if settings.OPENAI_API_KEY else None
except Exception:
    ai_client = None


def is_admin_user(user: User, db: Session) -> bool:
    """判断用户是否是管理员（通过 role_id）"""
    if not user.role_id:
        return False
    role = db.execute(text("""
        SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
    """), {"role_id": user.role_id}).fetchone()
    return role and role[0] == "admin"


def get_user_store_names(user: User, db: Session) -> list:
    """获取非管理员用户所属店铺分组下的所有店铺inventory_name列表（基于店铺分组做隔离）"""
    query = text("""
        SELECT s.inventory_name
        FROM stores s
        WHERE s.tenant_id = :tenant_id
          AND s.deleted_at IS NULL
          AND s.inventory_name IS NOT NULL
          AND s.group_id IN (
              SELECT DISTINCT s2.group_id
              FROM stores s2
              INNER JOIN user_stores us ON s2.id = us.store_id
              WHERE us.user_id = :user_id AND us.tenant_id = :tenant_id
                AND s2.group_id IS NOT NULL AND s2.deleted_at IS NULL
          )
    """)
    result = db.execute(query, {"user_id": user.id, "tenant_id": user.tenant_id})
    return [row[0] for row in result.fetchall() if row[0]]


def get_main_image_map(db: Session, tenant_id: int, asins: list) -> dict:
    """根据ASIN列表批量查询产品库主图（参考产品管理ASIN搜索逻辑：platform_products关联products）"""
    from sqlalchemy import bindparam
    valid_asins = list({a for a in asins if a})
    if not valid_asins:
        return {}
    query = text("""
        SELECT pp.asin, p.main_image
        FROM platform_products pp
        INNER JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
        WHERE pp.deleted_at IS NULL
          AND p.tenant_id = :tid
          AND pp.asin IN :asins
    """)
    query = query.bindparams(bindparam("asins", expanding=True))
    rows = db.execute(query, {"tid": tenant_id, "asins": valid_asins}).fetchall()
    image_map = {}
    for row in rows:
        asin, main_image = row[0], row[1]
        if asin and main_image and asin not in image_map:
            image_map[asin] = main_image
    return image_map


def parse_string_score(val: Optional[str]) -> Optional[float]:
    """将字符串评分（如"4.5"）转换为浮点数"""
    if not val:
        return None
    try:
        return float(val)
    except ValueError:
        return None

def calc_competitor_price_score(current_price_str: str, competitor_str: Optional[str]) -> tuple[int, int]:
    """竞品价格评分：
    competitor_price 格式：一行一个，每项形如 "ASIN:价格" 或 "ASIN：价格"
    将所有竞品价格与当前价格比较，按排名给分（满分10，排名*2递减）：
    - 第1便宜 → 10分
    - 第2便宜 → 8分
    - 第3便宜 → 6分
    - 第4便宜 → 4分
    - 第5名及以后 → 0分
    返回 (rank, score)
    """
    if not competitor_str or competitor_str.strip() == "":
        return (0, 0)

    try:
        current_price = float(current_price_str.replace('$', '').replace(',', '').strip())
    except ValueError:
        return (0, 0)

    prices = []
    for line in competitor_str.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # 支持 : 和 ：两种分隔符
        for sep in [':', '：']:
            if sep in line:
                _, price_part = line.split(sep, 1)
                try:
                    price = float(price_part.replace('$', '').replace(',', '').strip())
                    prices.append(price)
                except ValueError:
                    continue
                break

    if not prices:
        return (0, 0)

    all_prices = prices + [current_price]
    all_prices.sort()
    rank = all_prices.index(current_price) + 1

    if rank == 1:
        return (rank, 10)
    elif rank == 2:
        return (rank, 8)
    elif rank == 3:
        return (rank, 6)
    elif rank == 4:
        return (rank, 4)
    else:
        return (rank, 0)

def calc_total_score(
    title_rating: Optional[str],
    description_rating: Optional[str],
    keywords_rating: Optional[str],
    image_rating: Optional[str],
    star_rating: Optional[str],
    ad_rating: Optional[str],
    aplus_rating: Optional[str],
    video_rating: Optional[str],
    product_description_rating: Optional[str],
    competitor_price_score: int = 0,
) -> int:
    """计算总分（满分100，每项满分10分）

    各项评分直接读取数据库对应字段：
    - 标题评分: title_rating
    - 五点描述评分: description_rating
    - 关键词评分: keywords_rating
    - 图片评分: image_rating
    - 星级评分: star_rating
    - 广告评分: ad_rating
    - A+评分: aplus_rating
    - 视频评分: video_rating
    - 产品描述评分: product_description_rating
    - 竞品价格: competitor_price_score（按价格排名计分，排名*2递减：1=10, 2=8, 3=6, 4=4, 5+=0）
    """
    total = 0
    for val in (title_rating, description_rating, keywords_rating, image_rating,
                star_rating, ad_rating, aplus_rating, video_rating, product_description_rating):
        s = parse_string_score(val)
        if s is not None:
            total += min(s, 10)

    # 竞品价格（满分10）
    total += min(competitor_price_score, 10)

    return min(total, 100)


class ProductPageInfoResponse(BaseModel):
    id: int
    tenant_id: int
    asin: Optional[str] = None
    sku: Optional[str] = None
    store: Optional[str] = None
    store_original: Optional[str] = None
    title: Optional[str] = None
    keywords: Optional[str] = None
    product_description: Optional[str] = None
    bullet_points: Optional[str] = None
    price: Optional[str] = None
    image_count: Optional[int] = None
    title_rating: Optional[str] = None
    description_rating: Optional[str] = None
    keywords_rating: Optional[str] = None
    image_rating: Optional[str] = None
    product_description_rating: Optional[str] = None
    star: Optional[str] = None
    star_rating: Optional[str] = None
    ad_rating: Optional[str] = None
    aplus_rating: Optional[str] = None
    video_rating: Optional[str] = None
    competitor_price: Optional[str] = None
    competitor_price_rank: int = 0
    competitor_price_score: int = 0
    has_ad: Optional[bool] = False
    has_aplus: Optional[int] = 0
    has_video: Optional[bool] = False
    rating_status: int = 0
    total_score: int = 0
    traffic_keywords: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/")
async def get_product_page_info_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    asin_search: Optional[str] = Query(None),
    sku_search: Optional[str] = Query(None),
    store_filter: Optional[str] = Query(None),
    rating_status: Optional[int] = Query(None, description="评分状态筛选：0=未评分，1=已评分"),
    low_score: Optional[bool] = Query(None, description="低分筛选：已评分且总分<60"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取产品页面信息列表"""
    query = db.query(ProductPageInfo).filter(
        ProductPageInfo.tenant_id == current_user.tenant_id
    )

    # 非管理员用户按部门过滤数据
    if not is_admin_user(current_user, db):
        user_store_names = get_user_store_names(current_user, db)
        if user_store_names:
            query = query.filter(ProductPageInfo.store.in_(user_store_names))
        else:
            # 用户没有分配任何部门店铺，不显示任何数据
            query = query.filter(ProductPageInfo.id == -1)

    if rating_status is not None:
        query = query.filter(ProductPageInfo.rating_status == rating_status)

    if asin_search:
        query = query.filter(ProductPageInfo.asin.ilike(f"%{asin_search}%"))
    if sku_search:
        query = query.filter(ProductPageInfo.sku.ilike(f"%{sku_search}%"))
    if store_filter:
        # 先查找该 shop_abbr 对应的所有 inventory_name
        matching_stores = db.query(Store.inventory_name).filter(
            Store.tenant_id == current_user.tenant_id,
            Store.shop_abbr == store_filter
        ).all()
        matching_names = [s[0] for s in matching_stores if s[0]]
        if matching_names:
            query = query.filter(ProductPageInfo.store.in_(matching_names))
        else:
            # 没有匹配的店铺，回退到模糊搜索
            query = query.filter(ProductPageInfo.store.ilike(f"%{store_filter}%"))

    if low_score:
        # 低分筛选：先查所有已评分记录，计算总分后过滤
        all_rated = query.filter(ProductPageInfo.rating_status == 1).all()

        # 查询stores表映射
        store_rows = db.query(Store.inventory_name, Store.shop_abbr, Store.site).filter(
            Store.tenant_id == current_user.tenant_id,
            Store.inventory_name.isnot(None)
        ).all()
        store_abbr_map = {}
        for r in store_rows:
            if r.inventory_name:
                parts = [p for p in [r.shop_abbr, r.site] if p]
                store_abbr_map[r.inventory_name] = "-".join(parts) if parts else r.inventory_name

        filtered = []
        for item in all_rated:
            has_aplus_val = 0
            if isinstance(item.has_aplus, int):
                has_aplus_val = item.has_aplus
            elif isinstance(item.has_aplus, bool):
                has_aplus_val = 1 if item.has_aplus else 0
            has_ad_val = int(item.has_ad) if item.has_ad is not None else None
            has_video_val = bool(item.has_video) if item.has_video is not None else False
            _, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)
            total_score = calc_total_score(
                item.title_rating, item.description_rating, item.keywords_rating, item.image_rating,
                item.star_rating, item.ad_rating, item.aplus_rating, item.video_rating,
                item.product_description_rating, competitor_score,
            )
            if total_score < 60:
                display_store = store_abbr_map.get(item.store, item.store) if item.store else item.store
                filtered.append((item, total_score, display_store, has_ad_val, has_aplus_val, has_video_val))

        # 按updated_at降序排序
        filtered.sort(key=lambda x: x[0].updated_at if x[0].updated_at else None, reverse=True)

        total = len(filtered)
        paged = filtered[(page - 1) * page_size : page * page_size]

        # 批量查询产品库主图
        main_image_map = get_main_image_map(db, current_user.tenant_id, [t[0].asin for t in paged])

        result = []
        for item, total_score, display_store, has_ad_val, has_aplus_val, has_video_val in paged:
            competitor_rank, competitor_score2 = calc_competitor_price_score(item.price, item.competitor_price)
            result.append({
                "id": item.id,
                "tenant_id": item.tenant_id,
                "asin": item.asin,
                "sku": item.sku,
                "store": display_store,
                "store_original": item.store,
                "title": item.title,
                "keywords": item.keywords,
                "product_description": item.product_description,
                "bullet_points": item.bullet_points,
                "price": item.price,
                "image_count": item.image_count,
                "title_rating": item.title_rating,
                "description_rating": item.description_rating,
                "keywords_rating": item.keywords_rating,
                "image_rating": item.image_rating,
                "product_description_rating": item.product_description_rating,
                "star": item.star,
                "star_rating": item.star_rating,
                "ad_rating": item.ad_rating,
                "aplus_rating": item.aplus_rating,
                "video_rating": item.video_rating,
                "listing_suggestions": item.listing_suggestions,
                "competitor_price": item.competitor_price,
                "competitor_price_rank": competitor_rank,
                "competitor_price_score": competitor_score2,
                "has_ad": has_ad_val,
                "has_aplus": has_aplus_val,
                "has_video": has_video_val,
                "rating_status": item.rating_status or 0,
                "total_score": total_score,
                "main_image_url": main_image_map.get(item.asin, ""),
            })

        return {"success": True, "data": result, "total": total}

    total = query.count()
    # 使用原生SQL替代ORM查询，避免ORM懒加载导致性能问题
    # 构建权限过滤条件（与ORM query保持一致）
    from sqlalchemy import bindparam
    raw_where = ["tenant_id = :tid"]
    raw_params = {
        "tid": current_user.tenant_id,
        "limit": page_size,
        "offset": (page - 1) * page_size
    }
    expanding_params = []
    if not is_admin_user(current_user, db):
        user_store_names = get_user_store_names(current_user, db)
        if user_store_names:
            raw_where.append("store IN :store_names")
            raw_params["store_names"] = user_store_names
            expanding_params.append("store_names")
        else:
            raw_where.append("1 = 0")

    if rating_status is not None:
        raw_where.append("rating_status = :rating_status")
        raw_params["rating_status"] = rating_status

    if asin_search:
        raw_where.append("asin LIKE :asin_search")
        raw_params["asin_search"] = f"%{asin_search}%"

    if sku_search:
        raw_where.append("sku LIKE :sku_search")
        raw_params["sku_search"] = f"%{sku_search}%"

    if store_filter:
        matching_stores = db.query(Store.inventory_name).filter(
            Store.tenant_id == current_user.tenant_id,
            Store.shop_abbr == store_filter
        ).all()
        matching_names = [s[0] for s in matching_stores if s[0]]
        if matching_names:
            raw_where.append("store IN :matching_names")
            raw_params["matching_names"] = matching_names
            expanding_params.append("matching_names")
        else:
            raw_where.append("store LIKE :store_filter")
            raw_params["store_filter"] = f"%{store_filter}%"

    where_clause = " AND ".join(raw_where)
    raw_sql = text(f"""
        SELECT * FROM product_page_info WHERE {where_clause}
        ORDER BY updated_at DESC LIMIT :limit OFFSET :offset
    """)
    if expanding_params:
        raw_sql = raw_sql.bindparams(*[bindparam(p, expanding=True) for p in expanding_params])
    raw_rows = db.execute(raw_sql, raw_params).fetchall()
    # 转换为SimpleNamespace对象，保持属性访问方式兼容
    from types import SimpleNamespace
    items = [SimpleNamespace(**dict(row._mapping)) for row in raw_rows]

    # 批量查询产品库主图
    main_image_map = get_main_image_map(db, current_user.tenant_id, [item.asin for item in items])

    result = []
    # 查询stores表，建立 inventory_name -> "shop_abbr-site" 映射
    store_rows = db.query(Store.inventory_name, Store.shop_abbr, Store.site).filter(
        Store.tenant_id == current_user.tenant_id,
        Store.inventory_name.isnot(None)
    ).all()
    store_abbr_map = {}
    for r in store_rows:
        if r.inventory_name:
            parts = [p for p in [r.shop_abbr, r.site] if p]
            store_abbr_map[r.inventory_name] = "-".join(parts) if parts else r.inventory_name

    for item in items:
        # 处理 has_aplus：数据库中可能是 None/Boolean/Integer
        has_aplus_val = 0
        if isinstance(item.has_aplus, int):
            has_aplus_val = item.has_aplus
        elif isinstance(item.has_aplus, bool):
            has_aplus_val = 1 if item.has_aplus else 0

        # 处理 has_ad/has_video 为 None 的情况
        has_ad_val = int(item.has_ad) if item.has_ad is not None else None
        has_video_val = bool(item.has_video) if item.has_video is not None else False

        competitor_rank, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)
        total_score = calc_total_score(
            item.title_rating,
            item.description_rating,
            item.keywords_rating,
            item.image_rating,
            item.star_rating,
            item.ad_rating,
            item.aplus_rating,
            item.video_rating,
            item.product_description_rating,
            competitor_score,
        )

        # 店铺名映射：store显示为shop_abbr，保留原始store用于ASIN链接
        display_store = store_abbr_map.get(item.store, item.store) if item.store else item.store

        result.append({
            "id": item.id,
            "tenant_id": item.tenant_id,
            "asin": item.asin,
            "sku": item.sku,
            "store": display_store,
            "store_original": item.store,
            "title": item.title,
            "keywords": item.keywords,
            "product_description": item.product_description,
            "bullet_points": item.bullet_points,
            "price": item.price,
            "image_count": item.image_count,
            "title_rating": item.title_rating,
            "description_rating": item.description_rating,
            "keywords_rating": item.keywords_rating,
            "image_rating": item.image_rating,
            "product_description_rating": item.product_description_rating,
            "star": item.star,
            "star_rating": item.star_rating,
            "ad_rating": item.ad_rating,
            "aplus_rating": item.aplus_rating,
            "video_rating": item.video_rating,
            "listing_suggestions": item.listing_suggestions,
            "competitor_price": item.competitor_price,
            "competitor_price_rank": competitor_rank,
            "competitor_price_score": competitor_score,
            "has_ad": has_ad_val,
            "has_aplus": has_aplus_val,
            "has_video": has_video_val,
            "rating_status": item.rating_status or 0,
            "total_score": total_score,
            "main_image_url": main_image_map.get(item.asin, ""),
        })

    return {"success": True, "data": result, "total": total}


@router.get("/ranking")
async def get_ranking(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取评分排行榜（仅已评分记录）"""
    # 查询所有已评分记录
    rated_query = db.query(ProductPageInfo).filter(
        ProductPageInfo.tenant_id == current_user.tenant_id,
        ProductPageInfo.rating_status == 1
    )

    # 非管理员用户按部门过滤数据
    if not is_admin_user(current_user, db):
        user_store_names = get_user_store_names(current_user, db)
        if user_store_names:
            rated_query = rated_query.filter(ProductPageInfo.store.in_(user_store_names))
        else:
            rated_query = rated_query.filter(ProductPageInfo.id == -1)

    rated_items = rated_query.all()

    if not rated_items:
        return {"success": True, "data": {"top10": [], "bottom10": []}}

    # 店铺名映射
    stores = db.query(Store).filter(
        Store.tenant_id == current_user.tenant_id
    ).all()
    store_map = {}
    for s in stores:
        if s.inventory_name:
            parts = [p for p in [s.shop_abbr, s.site] if p]
            store_map[s.inventory_name] = "-".join(parts) if parts else s.inventory_name

    # 计算每个记录的总分
    scored_items = []
    for item in rated_items:
        competitor_rank, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)

        total_score = calc_total_score(
            item.title_rating,
            item.description_rating,
            item.keywords_rating,
            item.image_rating,
            item.star_rating,
            item.ad_rating,
            item.aplus_rating,
            item.video_rating,
            item.product_description_rating,
            competitor_score,
        )

        store_display = store_map.get(item.store, item.store)

        scored_items.append({
            "id": item.id,
            "sku": item.sku,
            "asin": item.asin,
            "store": store_display,
            "store_original": item.store,
            "total_score": total_score,
        })

    # 按总分降序排序
    scored_items.sort(key=lambda x: x["total_score"], reverse=True)

    # 取前十
    top10 = scored_items[:10]

    # 取倒数前十
    bottom10 = scored_items[-10:] if len(scored_items) >= 10 else scored_items
    bottom10 = list(reversed(bottom10))

    return {"success": True, "data": {"top10": top10, "bottom10": bottom10}}


@router.get("/{item_id}")
async def get_product_page_info_detail(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取产品页面信息详情"""
    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()

    if not item:
        return {"success": False, "message": "记录不存在"}

    has_aplus_val = 0
    if isinstance(item.has_aplus, int):
        has_aplus_val = item.has_aplus
    elif isinstance(item.has_aplus, bool):
        has_aplus_val = 1 if item.has_aplus else 0

    has_ad_val = int(item.has_ad) if item.has_ad is not None else None
    has_video_val = bool(item.has_video) if item.has_video is not None else False

    competitor_rank, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)
    total_score = calc_total_score(
        item.title_rating,
        item.description_rating,
        item.keywords_rating,
        item.image_rating,
        item.star_rating,
        item.ad_rating,
        item.aplus_rating,
        item.video_rating,
        item.product_description_rating,
        competitor_score,
    )

    # 店铺名映射
    store_rows = db.query(Store.inventory_name, Store.shop_abbr, Store.site).filter(
        Store.tenant_id == current_user.tenant_id,
        Store.inventory_name.isnot(None)
    ).all()
    store_abbr_map = {}
    store_country_map = {}
    for r in store_rows:
        if r.inventory_name:
            parts = [p for p in [r.shop_abbr, r.site] if p]
            store_abbr_map[r.inventory_name] = "-".join(parts) if parts else r.inventory_name
            if r.site:
                store_country_map[r.inventory_name] = r.site.strip().upper()
    display_store = store_abbr_map.get(item.store, item.store) if item.store else item.store

    # 查询库存快照表获取毛利率（带国家筛选）
    gross_margin = None
    if item.asin:
        store_country = store_country_map.get(item.store) if item.store else None
        query = db.query(InventorySnapshot.gross_margin).filter(
            InventorySnapshot.tenant_id == current_user.tenant_id,
            InventorySnapshot.asin == item.asin,
            InventorySnapshot.gross_margin.isnot(None),
        )
        if store_country:
            query = query.filter(InventorySnapshot.country == store_country)
        snapshot = query.order_by(InventorySnapshot.snapshot_date.desc()).first()
        if snapshot:
            # 数据库存储为小数（如0.1953表示19.53%），转为百分比数值返回
            gross_margin = float(snapshot[0]) * 100 if snapshot[0] is not None else None

    # 查询产品库主图
    main_image_url = ""
    if item.asin:
        main_image_map = get_main_image_map(db, current_user.tenant_id, [item.asin])
        main_image_url = main_image_map.get(item.asin, "")

    return {
        "success": True,
        "data": {
            "id": item.id,
            "tenant_id": item.tenant_id,
            "asin": item.asin,
            "sku": item.sku,
            "store": display_store,
            "store_original": item.store,
            "title": item.title,
            "keywords": item.keywords,
            "product_description": item.product_description,
            "bullet_points": item.bullet_points,
            "price": item.price,
            "image_count": item.image_count,
            "title_rating": item.title_rating,
            "description_rating": item.description_rating,
            "keywords_rating": item.keywords_rating,
            "image_rating": item.image_rating,
            "product_description_rating": item.product_description_rating,
            "star": item.star,
            "star_rating": item.star_rating,
            "ad_rating": item.ad_rating,
            "aplus_rating": item.aplus_rating,
            "video_rating": item.video_rating,
            "listing_suggestions": item.listing_suggestions,
            "competitor_price": item.competitor_price,
            "competitor_price_rank": competitor_rank,
            "competitor_price_score": competitor_score,
            "has_ad": has_ad_val,
            "has_aplus": has_aplus_val,
            "has_video": has_video_val,
            "total_score": total_score,
            "rating_status": item.rating_status or 0,
            "traffic_keywords": item.traffic_keywords,
            "updated_at": item.updated_at.strftime('%Y-%m-%d %H:%M:%S') if item.updated_at else None,
            "gross_margin": gross_margin,
            "main_image_url": main_image_url,
        },
    }


@router.get("/stores/options")
async def get_store_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取店铺下拉选项（从 product_page_info 表中提取唯一店铺名，映射为shop_abbr）"""
    stores_query = db.query(ProductPageInfo.store).filter(
        ProductPageInfo.tenant_id == current_user.tenant_id
    )

    # 非管理员用户按部门过滤店铺
    if not is_admin_user(current_user, db):
        user_store_names = get_user_store_names(current_user, db)
        if user_store_names:
            stores_query = stores_query.filter(ProductPageInfo.store.in_(user_store_names))
        else:
            stores_query = stores_query.filter(ProductPageInfo.id == -1)

    stores = stores_query.distinct().all()
    store_names = list(dict.fromkeys([s[0].strip() for s in stores if s[0]]))

    # 查询映射
    store_rows = db.query(Store.inventory_name, Store.shop_abbr, Store.site).filter(
        Store.tenant_id == current_user.tenant_id,
        Store.inventory_name.isnot(None)
    ).all()
    store_abbr_map = {}
    for r in store_rows:
        if r.inventory_name:
            parts = [p for p in [r.shop_abbr, r.site] if p]
            store_abbr_map[r.inventory_name.strip()] = "-".join(parts) if parts else r.inventory_name

    # 按 shop_abbr 去重，只保留在 product_page_info 中有记录的
    # 建立 shop_abbr -> inventory_names 映射
    abbr_to_names = {}
    for r in store_rows:
        if r.inventory_name and r.shop_abbr:
            abbr_to_names.setdefault(r.shop_abbr, []).append(r.inventory_name.strip())

    # 只保留在 store_names 中有匹配的 shop_abbr
    seen_abbrs = set()
    options = []
    for abbr, names in abbr_to_names.items():
        if abbr not in seen_abbrs and any(n in store_names for n in names):
            seen_abbrs.add(abbr)
            options.append({"label": abbr, "value": abbr})
    return {"success": True, "data": options}


class DeleteCompetitorRequest(BaseModel):
    competitor_line: str  # 要删除的竞品行，如 "B0D4TZSF7Y：15.19"


class AddCompetitorRequest(BaseModel):
    asin: str  # 竞品ASIN
    price: str  # 竞品价格


@router.post("/{item_id}/add-competitor")
async def add_competitor_price(
    item_id: int,
    request: AddCompetitorRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """新增竞品价格并重新计算排名和得分"""
    asin = (request.asin or "").strip()
    price = (request.price or "").strip()

    if not asin or not price:
        return {"success": False, "message": "ASIN和价格均为必填项"}

    # 校验价格格式
    try:
        float(price.replace('$', '').replace(',', ''))
    except ValueError:
        return {"success": False, "message": "价格格式不正确"}

    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id
    ).first()

    if not item:
        return {"success": False, "message": "产品不存在"}

    # 解析现有竞品价格
    competitor_lines = []
    if item.competitor_price:
        for line in item.competitor_price.strip().splitlines():
            line = line.strip()
            if line:
                competitor_lines.append(line)

    # 检查ASIN是否已存在（避免重复添加）
    for line in competitor_lines:
        sep_idx = max(line.find(':'), line.find('：'))
        existing_asin = line[:sep_idx].strip() if sep_idx > 0 else line
        if existing_asin.upper() == asin.upper():
            return {"success": False, "message": f"竞品 {asin} 已存在"}

    # 追加新竞品行
    competitor_lines.append(f"{asin}：{price}")
    item.competitor_price = "\n".join(competitor_lines)

    # 记录操作日志
    username = current_user.nickname or current_user.username
    write_log(
        db,
        current_user.tenant_id,
        current_user.id,
        username,
        "page_optimization",
        "update",
        "competitor_price",
        item.id,
        f"{item.sku or ''}",
        after_data={"竞品ASIN": asin, "竞品价格": price},
        summary=f"{username}添加了竞品价格，SKU：{item.sku or ''}，ASIN：{asin}，价格：{price}",
    )
    # 重新计算排名和得分
    competitor_rank, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)

    total_score = calc_total_score(
        item.title_rating,
        item.description_rating,
        item.keywords_rating,
        item.image_rating,
        item.star_rating,
        item.ad_rating,
        item.aplus_rating,
        item.video_rating,
        item.product_description_rating,
        competitor_score,
    )

    db.commit()

    return {
        "success": True,
        "data": {
            "competitor_price": item.competitor_price,
            "competitor_price_rank": competitor_rank,
            "competitor_price_score": competitor_score,
            "total_score": total_score,
        }
    }


@router.put("/{item_id}/delete-competitor")
async def delete_competitor_price(
    item_id: int,
    request: DeleteCompetitorRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除指定竞品价格并重新计算排名和得分"""
    print(f"[DEBUG] 收到删除请求: item_id={item_id}, competitor_line={request.competitor_line}")

    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id
    ).first()

    if not item:
        print(f"[DEBUG] 产品不存在: item_id={item_id}")
        return {"success": False, "message": "产品不存在"}

    print(f"[DEBUG] 当前竞品价格数据: {item.competitor_price}")

    # 解析现有竞品价格
    competitor_lines = []
    if item.competitor_price:
        for line in item.competitor_price.strip().splitlines():
            line = line.strip()
            if line:
                competitor_lines.append(line)

    print(f"[DEBUG] 解析后的竞品列表: {competitor_lines}")

    # 清理要删除的竞品行（去除可能的换行符）
    target_line = request.competitor_line.strip().replace('\r', '')
    print(f"[DEBUG] 目标删除行: {target_line}")

    # 删除指定的竞品行
    new_lines = [l for l in competitor_lines if l != target_line]
    print(f"[DEBUG] 删除后的竞品列表: {new_lines}")

    # 更新数据库
    item.competitor_price = "\n".join(new_lines) if new_lines else None

    # 记录操作日志
    username = current_user.nickname or current_user.username
    sep_idx = max(target_line.find(':'), target_line.find('：'))
    asin_part = target_line[:sep_idx].strip() if sep_idx > 0 else ''
    price_part = target_line[sep_idx + 1:].strip() if sep_idx > 0 else ''
    write_log(
        db,
        current_user.tenant_id,
        current_user.id,
        username,
        "page_optimization",
        "delete",
        "competitor_price",
        item.id,
        f"{item.sku or ''}",
        before_data={"被删除竞品": target_line},
        after_data={"竞品ASIN": asin_part, "竞品价格": price_part} if (asin_part or price_part) else None,
        summary=f"{username}删除了竞品价格，SKU：{item.sku or ''}，竞品：{target_line}",
    )
    # 重新计算排名和得分
    competitor_rank, competitor_score = calc_competitor_price_score(item.price, item.competitor_price)

    total_score = calc_total_score(
        item.title_rating,
        item.description_rating,
        item.keywords_rating,
        item.image_rating,
        item.star_rating,
        item.ad_rating,
        item.aplus_rating,
        item.video_rating,
        item.product_description_rating,
        competitor_score,
    )

    db.commit()
    print(f"[DEBUG] 删除成功，新排名: {competitor_rank}, 新得分: {competitor_score}")

    return {
        "success": True,
        "data": {
            "competitor_price": item.competitor_price,
            "competitor_price_rank": competitor_rank,
            "competitor_price_score": competitor_score,
            "total_score": total_score,
        }
    }


class SubmitRatingRequest(BaseModel):
    ids: List[int]  # 选中的产品ID列表


@router.post("/submit-rating")
async def submit_rating(
    request: SubmitRatingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """提交评分到飞书webhook"""
    if not request.ids:
        return {"success": False, "message": "未选择任何数据"}

    # 查询选中的产品数据
    items = db.query(ProductPageInfo).filter(
        ProductPageInfo.id.in_(request.ids),
        ProductPageInfo.tenant_id == current_user.tenant_id
    ).all()

    if not items:
        return {"success": False, "message": "未找到选中数据"}

    # 构造飞书请求格式
    feishu_data_list = []
    for item in items:
        feishu_data_list.append({
            "sku": item.sku or "",
            "asin": item.asin or "",
            "店铺": item.store or "",
            "标题": item.title or "",
            "五点描述": item.bullet_points or "",
            "关键词": item.keywords or "",
            "图片数": str(item.image_count) if item.image_count else "0",
            "产品描述": item.product_description or "",
            "价格": item.price or "",
            "数据库ID": str(item.id),
        })

    # 发送到飞书webhook
    feishu_webhook_url = "https://pcn4p6l5do51.feishu.cn/base/automation/webhook/event/KgcgaTUPhwqeE9hB09CciwyLnrb"

    try:
        async with httpx.AsyncClient() as client:
            # 每条数据单独发送
            for data in feishu_data_list:
                response = await client.post(
                    feishu_webhook_url,
                    json=data,
                    headers={"Content-Type": "application/json"},
                    timeout=10.0
                )
                print(f"[DEBUG] 飞书响应: {response.status_code}, 数据ID: {data['数据库ID']}")

        # 提交成功后，将选中记录的评分状态改为未评分(0)
        db.query(ProductPageInfo).filter(
            ProductPageInfo.id.in_(request.ids),
            ProductPageInfo.tenant_id == current_user.tenant_id
        ).update({"rating_status": 0}, synchronize_session="fetch")
        db.commit()

        return {
            "success": True,
            "message": f"成功提交 {len(feishu_data_list)} 条数据",
            "data": {"count": len(feishu_data_list)}
        }
    except Exception as e:
        print(f"[DEBUG] 飞书请求失败: {str(e)}")
        return {"success": False, "message": f"发送到飞书失败: {str(e)}"}


@router.post("/delete-records")
async def delete_records(
    request: SubmitRatingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除选中的记录"""
    if not request.ids:
        return {"success": False, "message": "未选择任何数据"}

    deleted = db.query(ProductPageInfo).filter(
        ProductPageInfo.id.in_(request.ids),
        ProductPageInfo.tenant_id == current_user.tenant_id
    ).delete(synchronize_session="fetch")
    db.commit()

    return {
        "success": True,
        "message": f"成功删除 {deleted} 条数据",
        "data": {"count": deleted}
    }


@router.post("/import-excel")
async def import_excel(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """导入Excel表格，读取SKU和店铺列新增到数据库"""
    if not file.filename.endswith(('.xlsx', '.xls')):
        return {"success": False, "message": "只支持Excel表格文件（.xlsx/.xls）"}

    try:
        contents = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True)
        ws = wb.active

        # 读取表头，找到SKU和店铺列的索引
        headers = [str(cell.value).strip() if cell.value else '' for cell in ws[1]]
        sku_col = None
        store_col = None

        for i, h in enumerate(headers):
            if h.upper() == 'SKU':
                sku_col = i
            elif h == '店铺':
                store_col = i

        if sku_col is None:
            return {"success": False, "message": "未找到SKU列，请确保表头包含'SKU'"}
        if store_col is None:
            return {"success": False, "message": "未找到店铺列，请确保表头包含'店铺'"}

        # 查询当前租户下已存在的记录（含id），用于去重和收集表格中不存在的待删除数据
        existing_rows = db.query(ProductPageInfo.id, ProductPageInfo.sku, ProductPageInfo.store).filter(
            ProductPageInfo.tenant_id == current_user.tenant_id
        ).all()
        existing_set = {(r.sku, r.store) for r in existing_rows}

        # 批量构建数据
        records = []
        skipped_count = 0
        duplicate_count = 0
        table_set = set()  # 表格中出现的所有有效(sku, store)组合
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or len(row) <= max(sku_col, store_col):
                skipped_count += 1
                continue

            sku_val = str(row[sku_col]).strip() if row[sku_col] else ''
            store_val = str(row[store_col]).strip() if row[store_col] else ''

            if not sku_val:
                skipped_count += 1
                continue

            # 记录表格中出现的组合（重复行也代表表格中存在，不作为待删除依据）
            table_set.add((sku_val, store_val))

            # 去重：sku和店铺都相同时跳过
            if (sku_val, store_val) in existing_set:
                duplicate_count += 1
                continue

            records.append({
                "tenant_id": current_user.tenant_id,
                "sku": sku_val,
                "store": store_val,
                "rating_status": 0,
            })

        wb.close()

        if not records:
            msg = "未读取到有效数据"
            if duplicate_count > 0:
                msg += f"，已跳过 {duplicate_count} 条重复数据"
            return {"success": False, "message": msg}

        # 遍历完整个表格后，统一删除数据库中不在表格里的记录（如 DJF-167 / D-USA-US 在库但不在表格中，则删除）
        # 仅在本次有新增导入时执行；表格无有效数据时不做删除，防止误清空
        deleted_count = 0
        stale_ids = [r.id for r in existing_rows if (r.sku, r.store) not in table_set]
        if stale_ids:
            deleted_count = db.query(ProductPageInfo).filter(
                ProductPageInfo.id.in_(stale_ids),
                ProductPageInfo.tenant_id == current_user.tenant_id,
            ).delete(synchronize_session=False)

        # 批量插入，全部插入后再统一提交，支持事务回滚（删除+插入同一事务）
        added_count = 0
        new_ids = []
        for record in records:
            item = ProductPageInfo(**record)
            db.add(item)
            db.flush()  # flush获取id但不提交
            new_ids.append(item.id)
            added_count += 1

        db.commit()

        msg = f"成功导入 {added_count} 条数据"
        if deleted_count > 0:
            msg += f"，删除 {deleted_count} 条表格中不存在的数据"
        if duplicate_count > 0:
            msg += f"，跳过 {duplicate_count} 条重复数据"
        if skipped_count > 0:
            msg += f"，无效行 {skipped_count} 条"

        return {
            "success": True,
            "message": msg,
            "data": {"added": added_count, "skipped": skipped_count, "duplicate": duplicate_count, "deleted": deleted_count, "import_ids": new_ids}
        }
    except Exception as e:
        db.rollback()
        print(f"[DEBUG] 导入Excel失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": f"导入失败: {str(e)}"}


@router.post("/refresh-inventory")
def refresh_inventory(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """刷新库存：以库存机器人最新快照数据（inventory_snapshots）为来源，
    与页面优化机器人数据比对：
    - SKU和店铺都相同的记录：补全ASIN和品名
    - 库存中存在但表中不存在的：新增SKU、ASIN、店铺、品名
    注意：使用def而非async def，快照数据量大（数万行），走线程池避免阻塞事件循环
    """
    try:
        tenant_id = current_user.tenant_id

        # 1. 取库存快照最新日期（与库存机器人显示逻辑一致）
        latest_snap = db.query(InventorySnapshot.snapshot_date).filter(
            InventorySnapshot.tenant_id == tenant_id,
            InventorySnapshot.deleted_at.is_(None),
        ).order_by(InventorySnapshot.snapshot_date.desc()).first()
        if not latest_snap or not latest_snap[0]:
            return {"success": False, "message": "库存快照暂无数据，无法刷新"}
        latest_date = latest_snap[0]

        # 2. 读取最新日期的全部快照行（含汇总行），按(SKU,店铺)去重
        snapshots = db.query(
            InventorySnapshot.sku,
            InventorySnapshot.asin,
            InventorySnapshot.account,
            InventorySnapshot.product_name,
        ).filter(
            InventorySnapshot.tenant_id == tenant_id,
            InventorySnapshot.snapshot_date == latest_date,
            InventorySnapshot.deleted_at.is_(None),
        ).all()

        inv_map = {}  # (sku, store) -> {"asin": str, "product_name": str}
        for s in snapshots:
            sku = (s.sku or '').strip()
            store = (s.account or '').strip()
            if not sku or not store:
                continue
            # 跳过超出表字段长度的行（如"店铺A、店铺B、店铺C"合并店铺名，其SKU已有单店铺行）
            # 跳过合并店铺的共享库存汇总行（store含顿号），只保留单店铺行，否则无法映射店铺别名
            if len(sku) > 50 or len(store) > 100 or '、' in store:
                continue
            key = (sku, store)
            if key not in inv_map:
                inv_map[key] = {
                    "asin": (s.asin or '').strip(),
                    "product_name": (s.product_name or '').strip(),
                }

        if not inv_map:
            return {"success": False, "message": f"库存快照（{latest_date}）无有效SKU数据"}

        # 3. 读取页面优化机器人现有记录，比对补全
        existing_items = db.query(ProductPageInfo).filter(
            ProductPageInfo.tenant_id == tenant_id
        ).all()
        existing_map = {(item.sku, item.store): item for item in existing_items}

        updated_count = 0
        for item in existing_items:
            inv = inv_map.get((item.sku, item.store))
            if not inv:
                continue
            changed = False
            if inv["asin"] and (item.asin or '') != inv["asin"]:
                item.asin = inv["asin"]
                changed = True
            if inv["product_name"] and (item.product_name or '') != inv["product_name"]:
                item.product_name = inv["product_name"]
                changed = True
            if changed:
                updated_count += 1

        # 4. 库存中存在但表中不存在的：新增SKU、ASIN、店铺、品名
        # 分批executemany批量插入（逐条ORM add数万行需半小时以上，会超前端超时时间）
        new_rows = []
        for (sku, store), inv in inv_map.items():
            if (sku, store) in existing_map:
                continue
            new_rows.append({
                "tenant_id": tenant_id,
                "sku": sku,
                "store": store,
                "asin": inv["asin"] or None,
                "product_name": inv["product_name"] or None,
                "image_count": 0,
                "has_ad": 0,
                "has_aplus": 0,
                "has_video": False,
                "rating_status": 0,
            })
        added_count = len(new_rows)
        if new_rows:
            # 用底层DBAPI executemany批量插入（一批一次网络往返；
            # SQLAlchemy insertmanyvalues在此环境逐行发送，数万行需几十分钟）
            raw_conn = db.connection().connection
            raw_cur = raw_conn.cursor()
            try:
                sql = (
                    "INSERT INTO product_page_info (tenant_id, sku, asin, product_name, store, "
                    "image_count, has_ad, has_aplus, has_video, rating_status) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                )
                batch_size = 2000
                for i in range(0, len(new_rows), batch_size):
                    batch = [
                        (r["tenant_id"], r["sku"], r["asin"], r["product_name"], r["store"],
                         r["image_count"], r["has_ad"], r["has_aplus"],
                         1 if r["has_video"] else 0, r["rating_status"])
                        for r in new_rows[i:i + batch_size]
                    ]
                    raw_cur.executemany(sql, batch)
            finally:
                raw_cur.close()

        db.commit()

        msg = f"刷新库存完成：新增 {added_count} 条，补全ASIN/品名 {updated_count} 条"
        return {
            "success": True,
            "message": msg,
            "data": {"added": added_count, "updated": updated_count, "snapshot_date": str(latest_date)}
        }
    except Exception as e:
        db.rollback()
        print(f"[DEBUG] 刷新库存失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": f"刷新库存失败: {str(e)}"}


@router.post("/upload-images")
async def upload_images(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """上传图片到 TOS 存储桶，返回公网访问 URL 列表。
    图片名必须以数字命名（数字代表替换第几张图片）。
    """
    from services.tos_service import upload_image

    if not files:
        return {"success": False, "message": "未上传任何文件"}

    # 校验并上传
    urls = []
    for f in files:
        name = f.filename or ""
        # 校验图片名：去除扩展名后必须为纯数字
        base = name.rsplit(".", 1)[0] if "." in name else name
        if not base.isdigit():
            return {"success": False, "message": f"图片命名不规范（{name}），请以数字命名后重新上传"}

        try:
            file_bytes = await f.read()
            url = upload_image(file_bytes, name)
            urls.append(url)
        except Exception as e:
            logger.error(f"图片上传失败: {name}, err={e}")
            return {"success": False, "message": f"图片上传失败: {name}, {str(e)}"}

    return {"success": True, "data": urls}


@router.post("/delete-image")
async def delete_image(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """删除 TOS 存储桶中的图片"""
    from services.tos_service import delete_file

    body = await request.json()
    file_url = body.get("url", "")
    if not file_url:
        return {"success": False, "message": "缺少 url 参数"}

    ok = delete_file(file_url)
    return {"success": ok}


@router.post("/submit-edit")
async def submit_edit(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """提交编辑基础信息 - 发送飞书webhook并可选更新评分状态"""
    body = await request.json()
    item_id = body.get("item_id")
    store = body.get("store", "")
    field_type = body.get("field_type", "")
    sku = body.get("sku", "")
    content = body.get("content", "")
    reset_rating = body.get("reset_rating", False)

    if not item_id:
        return {"success": False, "message": "缺少item_id参数"}

    # 验证记录存在且属于当前租户
    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()

    if not item:
        return {"success": False, "message": "记录不存在"}

    # 发送飞书webhook
    webhook_url = settings.FEISHU_EDIT_WEBHOOK_URL
    if not webhook_url:
        logger.warning("未配置 FEISHU_EDIT_WEBHOOK_URL，跳过飞书通知")
        return {"success": False, "message": "未配置编辑基础信息提交的飞书webhook地址"}
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                webhook_url,
                json={
                    "店铺": store,
                    "选择填写类型": field_type,
                    "SKU": sku,
                    "填写文本": content,
                },
                timeout=10,
            )
    except Exception as e:
        logger.error(f"飞书webhook发送失败: {e}")
        return {"success": False, "message": f"飞书通知发送失败: {str(e)}"}

    # 如果需要重新评分，更新评分状态
    if reset_rating:
        item.rating_status = 0
        db.commit()

    # 记录操作日志
    write_log(
        db,
        current_user.tenant_id,
        current_user.id,
        current_user.nickname or current_user.username,
        "page_optimization",
        "update",
        "basic_info",
        item.id,
        f"{item.sku or ''}",
        after_data={
            "店铺": store,
            "填写类型": field_type,
            "SKU": sku,
            "填写内容": content,
        },
        summary=f"{current_user.nickname or current_user.username}编辑了基础信息，店铺：{store}，类型：{field_type}，SKU：{sku}",
    )
    db.commit()

    return {"success": True, "message": "提交成功"}


def extract_text_content(raw: str) -> str:
    """提取AI返回的文本内容：模板要求输出JSON结构时解析并提取text字段，纯文本则原样返回"""
    text = (raw or "").strip()
    if not text:
        return ""
    # 剥离Markdown代码块包裹
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    parsed = None
    try:
        parsed = json.loads(text)
    except Exception:
        # 尝试截取文本中最外层的JSON片段
        m = re.search(r"(\[.*\]|\{.*\})", text, re.S)
        if m:
            try:
                parsed = json.loads(m.group(1))
            except Exception:
                parsed = None
    if parsed is None:
        return text
    items = parsed if isinstance(parsed, list) else [parsed]
    parts = []
    for obj in items:
        if isinstance(obj, dict):
            t = obj.get("text") or obj.get("content") or ""
            if t:
                parts.append(str(t))
        elif isinstance(obj, str) and obj.strip():
            parts.append(obj.strip())
    return "\n".join(parts) if parts else text


@router.post("/ai-write")
async def ai_write_content(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI编写 - 根据流量词和原始内容重新生成字段内容（埋词优化）

    支持通过根目录 optimizer_config.json 配置市场档案(north_america/uk/europe)和
    不同字段(title/bullets/description/search_terms)的指令模板。
    模板中可用双花括号占位符：
      {{site}}/{{market}}/{{language}} - 市场档案信息
      {{product_info}} - 产品信息(JSON)
      {{original_listing}} - 原Listing内容(JSON)
      {{original_title}}/{{original_bullets}}/{{original_description}}/{{original_search_terms}}/{{original_qa}} - 各位置原始内容
      {{traffic_keywords}} - 流量关键词(JSON数组)
      {{localization_requirements}} - 区域本地化要求
    """
    body = await request.json()
    item_id = body.get("item_id")
    field_type = body.get("field_type", "")
    content = body.get("content", "")
    # Listing建议（可选）：存在时随请求传入，要求AI按建议优化内容
    suggestion = (body.get("suggestion") or "").strip()

    if not item_id:
        return {"success": False, "message": "缺少item_id参数"}

    if not content or not content.strip():
        return {"success": False, "message": "字段内容为空，无法进行AI编写"}

    if not ai_client:
        return {"success": False, "message": "AI服务未配置，请检查.env中的OPENAI_API_KEY"}

    # 获取记录及其流量词
    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()

    if not item:
        return {"success": False, "message": "记录不存在"}

    traffic_keywords = (item.traffic_keywords or "").strip()
    if not traffic_keywords:
        return {"success": False, "message": "当前记录无参考流量词，无法进行AI编写"}

    field_label_map = {
        'title': '标题',
        'product_description': '产品描述',
        'keywords': '关键词',
        'bullet_points': '五点描述',
    }
    field_label = field_label_map.get(field_type, field_type)

    # ====== 读取 optimizer_config.json 埋词优化配置 ======
    # 通过 Store 表 site 字段(中文国家名)映射到市场档案 north_america/uk/europe
    site_market_map = {
        "英国": "uk", "美国": "north_america", "加拿大": "north_america",
        "德国": "europe", "法国": "europe", "意大利": "europe", "西班牙": "europe",
        "荷兰": "europe", "比利时": "europe", "爱尔兰": "europe", "波兰": "europe", "瑞典": "europe",
    }
    # 欧洲站店铺国家 → 配置countries子项代码
    site_country_map = {"德国": "DE", "法国": "FR", "意大利": "IT", "西班牙": "ES"}
    store_site_name = None
    if item.store:
        store_row = db.query(Store.site).filter(
            Store.inventory_name == item.store,
            Store.tenant_id == current_user.tenant_id,
        ).first()
        if store_row and store_row[0]:
            store_site_name = store_row[0].strip()
    market_key = site_market_map.get(store_site_name or "", "")

    # 加载配置文件（根目录 optimizer_config.json）
    config = {}
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "optimizer_config.json",
    )
    try:
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8-sig") as f:
                config = json.load(f)
    except Exception as e:
        logger.warning(f"加载埋词优化配置失败: {e}")

    market_profiles = config.get("market_profiles", {})
    prompt_templates = config.get("prompt_templates", {})
    analysis_config = config.get("analysis_config", {})
    constraints = analysis_config.get("constraints", {})

    # 店铺未匹配到市场时回退配置文件的默认 market_profile_key
    if not market_key:
        market_key = config.get("input", {}).get("market_profile_key", "north_america")
    profile = market_profiles.get(market_key, {})

    # 欧洲站按店铺国家取对应语言的本地化要求
    localization_requirements = profile.get("localization_prompt", "")
    language_str = profile.get("language", "")
    if market_key == "europe" and store_site_name:
        country_code = site_country_map.get(store_site_name)
        for c in profile.get("countries", []):
            if c.get("country") == country_code:
                localization_requirements = f"{store_site_name}站要求：{c.get('localization_prompt', '')}"
                language_str = c.get("language", language_str)
                break

    # 组装产品信息（记录中可用的基础字段）
    product_info_obj = {
        "product_name": (item.title or "")[:120],
        "sku": item.sku,
        "asin": item.asin,
        "price": item.price,
        "store": item.store,
    }
    # 流量词转为结构化数组（记录仅存关键词文本，无搜索量等指标）
    traffic_kw_list = [{"keyword": w} for w in traffic_keywords.split() if w.strip()]
    # 原Listing各位置内容：当前生成字段使用传入的content，其余从记录读取
    original_parts = {
        "title": content if field_type == "title" else (item.title or ""),
        "bullets": content if field_type == "bullet_points" else (item.bullet_points or ""),
        "description": content if field_type == "product_description" else (item.product_description or ""),
        "search_terms": content if field_type == "keywords" else (item.keywords or ""),
        "qa": "",
    }

    # 字段类型 → 模板名（search_terms对应产品信息的关键词部分，通过流量词组和原字段内容进行埋词优化）
    field_template_map = {
        "title": "title",
        "bullet_points": "bullets",
        "product_description": "description",
        "keywords": "search_terms",
    }
    template_name = field_template_map.get(field_type, "")
    custom_template = (prompt_templates.get(template_name) or "").strip() if template_name else ""

    # 通用规则（无论是否使用模板都追加，保证输出格式一致）
    # 五点描述(bullet_points)需要保留标点符号，且格式与原内容相同，其他字段去除标点
    is_bullet = field_type == "bullet_points"

    # 根据市场档案确定输出语言
    market_language_map = {
        "uk": "英语（英式拼写）",
        "north_america": "英语（美式拼写）",
        "europe": "对应欧洲站点语言（与原始内容语言保持一致）",
    }
    output_language = market_language_map.get(market_key, "与原始内容相同的语言")

    if is_bullet:
        punctuation_rule = (
            "2. 保持正常的标点符号使用（句号、逗号、冒号等可正常使用）\n"
            "3. 生成的五点描述格式必须与原始内容完全一致：使用相同的分隔符（如换行、分号等）、相同的层级结构和排列方式，仅替换/扩展文字内容\n"
            "4. 不要出现段落标号（如1. 2. 3.等数字编号），开头不要使用*号或其他符号标记\n"
            f"5. 生成内容必须使用{output_language}"
        )
        output_rule_index = "6"
    else:
        punctuation_rule = (
            "2. 不要加入任何标点符号（如句号、逗号、冒号、分号、感叹号、问号、引号等），保持原内容用空格隔开的格式\n"
            f"3. 生成内容必须使用{output_language}"
        )
        output_rule_index = "4"
    common_rules = (
        "\n\n通用输出规则（必须严格遵守，优先级高于上方指令中的输出格式要求）：\n"
        "1. 根据原始内容决定流量词的插入位置，使内容通顺自然，不能直接追加在末尾\n"
        f"{punctuation_rule}\n"
        f"{output_rule_index}. 本次仅生成单个字段内容：只输出该字段的最终文本内容本身，不要JSON结构、不要Markdown代码块、不要字段名说明或任何解释"
    )

    # Listing建议块：存在时插入指令与通用规则之间，要求AI按建议优化
    suggestion_block = ""
    if suggestion:
        suggestion_block = (
            "\n\n优化建议（生成内容时必须遵循以下建议要求）：\n"
            f"{suggestion}\n"
        )

    if custom_template:
        # 使用自定义模板，替换双花括号占位符
        replacements = {
            "{{site}}": profile.get("site", ""),
            "{{market}}": profile.get("market", ""),
            "{{language}}": language_str or "与原始内容相同的语言",
            "{{product_info}}": json.dumps(product_info_obj, ensure_ascii=False),
            "{{original_listing}}": json.dumps(original_parts, ensure_ascii=False),
            "{{original_title}}": original_parts["title"] or "（未提供）",
            "{{original_bullets}}": original_parts["bullets"] or "（未提供）",
            "{{original_description}}": original_parts["description"] or "（未提供）",
            "{{original_search_terms}}": original_parts["search_terms"] or "（未提供）",
            "{{original_qa}}": original_parts["qa"] or "（未提供）",
            "{{traffic_keywords}}": json.dumps(traffic_kw_list, ensure_ascii=False),
            "{{localization_requirements}}": localization_requirements,
        }
        system_prompt = custom_template
        for k, v in replacements.items():
            system_prompt = system_prompt.replace(k, str(v))
        # 标题字符数限制按 analysis_config.constraints 注入
        if field_type == "title":
            title_max_chars = constraints.get("title_max_chars", 200)
            system_prompt += f"\n注意：标题最终内容不能超过{title_max_chars}个字符（含空格）。"
        system_prompt += suggestion_block + common_rules
        user_prompt = "请根据上述指令生成内容。"
    else:
        # 配置缺失时回退到默认指令
        title_max_chars = constraints.get("title_max_chars", 75)
        length_constraint = ""
        if field_type == "title":
            length_constraint = f"\n最终生成的内容不能超过{title_max_chars}个字符（含空格），如超出请精简"
        if is_bullet:
            default_punctuation_rules = (
                "4. 保持正常的标点符号使用（句号、逗号、冒号等可正常使用）\n"
                "6. 生成的五点描述格式必须与原始内容完全一致：使用相同的分隔符（如换行、分号等）、相同的层级结构和排列方式，仅替换/扩展文字内容\n"
                "7. 不要出现段落标号（如1. 2. 3.等数字编号），开头不要使用*号或其他符号标记\n"
                f"8. 生成内容必须使用{output_language}"
            )
            output_rule = "5. 只输出最终生成的内容，不要添加任何说明、解释或多余字符"
        else:
            default_punctuation_rules = (
                "4. 不要加入任何标点符号，保持原内容用空格隔开的格式\n"
                f"5. 生成内容必须使用{output_language}"
            )
            output_rule = "6. 只输出最终生成的内容，不要添加任何说明、解释或多余字符"
        system_prompt = (
            "你是专业的跨境电商Listing埋词优化助手。请根据原始内容和参考流量词，将流量词自然地融入原始内容中。\n\n"
            "要求：\n"
            "1. 根据原始内容决定流量词的插入位置，使内容通顺自然，不能直接追加在末尾\n"
            "2. 保持原文的核心意思和结构\n"
            "3. 优先选择最相关的流量词进行融入，无需全部使用\n"
            f"{default_punctuation_rules}\n"
            f"{output_rule}"
            + length_constraint
        )
        user_prompt = f"字段类型：{field_label}\n参考流量词：{traffic_keywords}\n原始内容：\n{content}"
        if suggestion_block:
            system_prompt += suggestion_block

    logger.info(f"[AI编写] 用户={current_user.username} item_id={item_id} field={field_type} store={item.store} market={market_key} use_template={bool(custom_template)}")

    try:
        response = ai_client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=settings.OPENAI_TEMPERATURE,
            timeout=settings.OPENAI_TIMEOUT
        )
        generated = response.choices[0].message.content.strip() if response.choices else ""
        # AI按模板要求可能返回JSON结构，提取文本内容以兼容前端纯文本展示
        generated = extract_text_content(generated)
        if not generated:
            return {"success": False, "message": "AI生成内容为空"}
        return {"success": True, "data": {"content": generated}}
    except Exception as e:
        logger.error(f"AI编写失败: {e}")
        return {"success": False, "message": f"AI生成失败: {str(e)}"}


@router.post("/{item_id}/ai-suggest-log")
async def save_ai_suggest_log(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """记录AI建议生成日志（供查看AI建议时判断近期是否生成过、以及恢复旧建议）"""
    body = await request.json()
    suggestions = body.get("suggestions")

    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()
    if not item:
        return {"success": False, "message": "记录不存在"}

    write_log(
        db,
        current_user.tenant_id,
        current_user.id,
        current_user.username,
        module="page_optimization",
        action="create",
        target_type="ai_suggest",
        target_id=item.id,
        after_data=suggestions,
        summary=f"{current_user.nickname or current_user.username}生成了AI建议，SKU：{item.sku}",
    )
    db.commit()
    return {"success": True}


@router.put("/{item_id}/traffic-keywords")
async def update_traffic_keywords(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新参考关键词（空格分隔）"""
    body = await request.json()
    traffic_keywords = body.get("traffic_keywords")

    if traffic_keywords is None:
        return {"success": False, "message": "缺少traffic_keywords参数"}

    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()

    if not item:
        return {"success": False, "message": "记录不存在"}

    # 规范化：合并多余空白（换行/制表符/连续空格 → 单个空格分隔）
    normalized = " ".join(traffic_keywords.split()) if traffic_keywords.strip() else None
    before_keywords = item.traffic_keywords
    item.traffic_keywords = normalized
    db.commit()

    # 记录操作日志
    username = current_user.nickname or current_user.username
    write_log(
        db,
        current_user.tenant_id,
        current_user.id,
        username,
        "page_optimization",
        "update",
        "traffic_keywords",
        item.id,
        f"{item.sku or ''}",
        before_data={"参考关键词": before_keywords or ""},
        after_data={"参考关键词": normalized or ""},
        summary=f"{username}更新了参考关键词，SKU：{item.sku or ''}",
    )
    db.commit()

    return {"success": True, "message": "参考关键词已更新", "data": {"traffic_keywords": normalized}}


@router.put("/{item_id}/rating-status")
async def update_rating_status(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """更新评分状态"""
    body = await request.json()
    rating_status = body.get("rating_status")
    if rating_status is None:
        return {"success": False, "message": "缺少rating_status参数"}

    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()

    if not item:
        return {"success": False, "message": "记录不存在"}

    item.rating_status = rating_status
    db.commit()
    return {"success": True, "message": "评分状态已更新"}


# ==================== 开广告提交接口 ====================

# 开广告字段中文名映射（用于发送到飞书）
AD_FIELD_LABEL_MAP = {
    "ad_type": "广告选择",
    "keyword_asin_source": "广告关键词ASIN来源",
    "bid_strategy": "竞价策略",
    "sku": "SKU",
    "site": "站点",
    "manual_exact_bid": "精准竞价",
    "manual_broad_bid": "广泛竞价",
    "manual_phrase_bid": "词组竞价",
    "related_exact_bid": "关联精准竞价",
    "related_expanded_bid": "关联扩展竞价",
    "strongest_related_asin": "最强关联竞品ASIN",
    "key_keyword": "最关键的关键词",
    "limit_word": "限定词",
    "ad_asin": "广告ASIN",
    "ad_keyword": "广告关键词",
}

# 广告选择值映射为中文
AD_TYPE_VALUE_MAP = {
    "auto": "自动",
    "manual": "手动",
    "related": "关联",
}

# 关键词ASIN来源值映射为中文
KEYWORD_ASIN_SOURCE_MAP = {
    "operation": "运营填写",
    "h10": "H10查询",
}

# 竞价策略值映射为中文
BID_STRATEGY_MAP = {
    "dynamic_down": "动态竞价-仅降低",
    "dynamic_up_down": "动态竞价-提高和降低",
    "fixed": "固定竞价",
}


class AdSubmitRequest(BaseModel):
    """开广告提交请求体"""
    item_id: Optional[int] = None  # 关联的产品页面信息记录ID（用于操作日志）
    ad_type: List[str] = []
    keyword_asin_source: str = ""
    bid_strategy: str = ""
    sku: str = ""
    site: str = ""
    manual_exact_bid: str = ""
    manual_broad_bid: str = ""
    manual_phrase_bid: str = ""
    related_exact_bid: str = ""
    related_expanded_bid: str = ""
    strongest_related_asin: str = ""
    key_keyword: str = ""
    limit_word: str = ""
    ad_asin: str = ""
    ad_keyword: str = ""


@router.post("/ad-submit")
async def submit_ad(
    request: AdSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """开广告提交：将表单数据发送到飞书 webhook"""
    # 1. 构建字典（字段名:字段内容），多选/代码值转为中文
    data_dict = {
        "广告选择": "、".join([AD_TYPE_VALUE_MAP.get(t, t) for t in request.ad_type]) if request.ad_type else "",
        "广告关键词ASIN来源": KEYWORD_ASIN_SOURCE_MAP.get(request.keyword_asin_source, request.keyword_asin_source),
        "竞价策略": BID_STRATEGY_MAP.get(request.bid_strategy, request.bid_strategy),
        "SKU": request.sku,
        "站点": request.site,
        "精准竞价": request.manual_exact_bid,
        "广泛竞价": request.manual_broad_bid,
        "词组竞价": request.manual_phrase_bid,
        "关联精准竞价": request.related_exact_bid,
        "关联扩展竞价": request.related_expanded_bid,
        "最强关联竞品ASIN": request.strongest_related_asin,
        "最关键的关键词": request.key_keyword,
        "限定词": request.limit_word,
        "广告ASIN": request.ad_asin,
        "广告关键词": request.ad_keyword,
    }

    # 输出到后端终端
    print(f"\n[开广告提交] 用户: {current_user.username} (tenant_id={current_user.tenant_id})")
    print(f"[开广告提交] 数据字典: {data_dict}")

    # 2. 发送到飞书 webhook
    webhook_url = settings.FEISHU_AD_WEBHOOK_URL
    if not webhook_url:
        print("[开广告提交] 未配置 FEISHU_AD_WEBHOOK_URL，跳过发送")
        return {"success": False, "message": "未配置开广告 webhook 地址"}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                webhook_url,
                json=data_dict,
                headers={"Content-Type": "application/json"},
                timeout=10.0,
            )
            print(f"[开广告提交] 飞书响应: {response.status_code}, 内容: {response.text}")

        # 记录操作日志
        username = current_user.nickname or current_user.username
        write_log(
            db,
            current_user.tenant_id,
            current_user.id,
            username,
            "page_optimization",
            "create",
            "ad_submit",
            request.item_id,
            f"{request.sku or ''}",
            after_data=data_dict,
            summary=f"{username}提交了开广告，SKU：{request.sku or ''}，站点：{request.site or ''}",
        )
        db.commit()

        return {"success": True, "message": "广告配置已提交", "data": data_dict}
    except Exception as e:
        print(f"[开广告提交] 飞书请求失败: {str(e)}")
        return {"success": False, "message": f"发送到飞书失败: {str(e)}"}


class OptimizeSubmitRequest(BaseModel):
    item_id: int  # 产品页面信息记录ID
    sku: str = ""
    suggestions: List[str]  # 勾选的优化建议列表


@router.post("/optimize-submit")
async def optimize_submit(
    request: OptimizeSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """一键优化提交：记录操作日志（暂不做其他处理）"""
    if not request.suggestions:
        return {"success": False, "message": "优化建议列表为空"}

    # 验证记录存在且属于当前租户
    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == request.item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()
    if not item:
        return {"success": False, "message": "记录不存在"}

    # 记录操作日志
    username = current_user.nickname or current_user.username
    write_log(
        db,
        current_user.tenant_id,
        current_user.id,
        username,
        "page_optimization",
        "create",
        "optimize_submit",
        item.id,
        f"{request.sku or item.sku or ''}",
        after_data={"优化建议": request.suggestions},
        summary=f"{username}提交了{len(request.suggestions)}条优化，SKU：{request.sku or item.sku or ''}，内容：{'、'.join(request.suggestions)}",
    )
    db.commit()

    # 发送到飞书 webhook
    webhook_url = settings.FEISHU_OPTIMIZE_WEBHOOK_URL
    if webhook_url:
        feishu_data = {
            "SKU": request.sku or item.sku or "",
            "ASIN": item.asin or "",
            "店铺": item.store or "",
            "数据库ID": str(item.id),
            "优化信息": "、".join(request.suggestions),
        }
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    webhook_url,
                    json=feishu_data,
                    headers={"Content-Type": "application/json"},
                    timeout=10.0,
                )
            print(f"[一键优化提交] 飞书响应: {response.status_code}, 内容: {response.text}")
        except Exception as e:
            print(f"[一键优化提交] 飞书请求失败: {str(e)}")
    else:
        print("[一键优化提交] 未配置 FEISHU_OPTIMIZE_WEBHOOK_URL，跳过发送")

    return {"success": True, "message": f"已提交{len(request.suggestions)}条优化"}