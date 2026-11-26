from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional, Dict
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, text
import time, logging
from database.database import get_db
from models.product_sales import ProductSales

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/product-sales", tags=["product-sales"])


def build_sku_name_map(db: Session, sku_list: Optional[List[str]] = None) -> Dict[str, str]:
    """构建 SKU → 中文品名 映射（权威来源 products.name，经 platform_products 关联）
    用于 product_name 列为空的历史/新增数据动态兜底匹配
    """
    sql = """
        SELECT pp.sku, MIN(p.name) AS pname
        FROM platform_products pp
        INNER JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
        WHERE pp.deleted_at IS NULL AND p.name IS NOT NULL AND p.name != ''
    """
    params: dict = {}
    if sku_list:
        placeholders = ", ".join([f":sku{i}" for i in range(len(sku_list))])
        sql += f" AND pp.sku IN ({placeholders})"
        params.update({f"sku{i}": s for i, s in enumerate(sku_list)})
    sql += " GROUP BY pp.sku"
    rows = db.execute(text(sql), params).fetchall()
    return {row[0]: row[1] for row in rows}


def _normalize_image_url(raw) -> str:
    """规整图片URL：兼容 JSON 数组格式（取第一张）"""
    if not raw:
        return ""
    s = str(raw).strip()
    if s.startswith("["):
        try:
            import json as _json
            arr = _json.loads(s)
            if isinstance(arr, list) and arr:
                return str(arr[0]).strip()
        except Exception:
            return ""
    return s


def build_sku_image_map(db: Session, sku_list: Optional[List[str]] = None) -> Dict[str, str]:
    """构建 SKU → 图片URL 映射：platform_products.image_url 优先，为空回退 products.main_image"""
    sql = """
        SELECT pp.sku,
               COALESCE(MAX(NULLIF(pp.image_url, '')), MAX(p.main_image)) AS img
        FROM platform_products pp
        LEFT JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL
        WHERE pp.deleted_at IS NULL
    """
    params: dict = {}
    if sku_list:
        placeholders = ", ".join([f":sku{i}" for i in range(len(sku_list))])
        sql += f" AND pp.sku IN ({placeholders})"
        params.update({f"sku{i}": s for i, s in enumerate(sku_list)})
    sql += " GROUP BY pp.sku"
    rows = db.execute(text(sql), params).fetchall()
    return {row[0]: _normalize_image_url(row[1]) for row in rows}


@router.get("/stores", response_model=List[str])
async def get_stores(db: Session = Depends(get_db)):
    """获取所有有商品销量数据的店铺名称"""
    try:
        stores = db.query(ProductSales.store).distinct().all()
        return [s[0] for s in stores]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取店铺列表失败: {str(e)}")


@router.get("/skus")
async def get_skus(
    store: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """获取商品SKU列表"""
    try:
        query = db.query(ProductSales.sku).distinct()
        
        if store:
            query = query.filter(ProductSales.store == store)
        
        results = query.all()
        return {
            "success": True,
            "data": [s[0] for s in results]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取SKU列表失败: {str(e)}")


@router.get("/")
async def get_product_sales(
    stores: Optional[str] = Query(None),
    skus: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """获取商品销量数据"""
    try:
        store_list: List[str] = []
        if stores:
            store_list = [s.strip() for s in stores.split(',')]
        
        sku_list: List[str] = []
        if skus:
            sku_list = [s.strip() for s in skus.split(',')]
        
        query = db.query(ProductSales)
        
        if store_list and len(store_list) > 0:
            query = query.filter(ProductSales.store.in_(store_list))
        
        if sku_list and len(sku_list) > 0:
            query = query.filter(ProductSales.sku.in_(sku_list))
        
        if start_date:
            query = query.filter(ProductSales.date >= start_date)
        if end_date:
            query = query.filter(ProductSales.date <= end_date)
        
        if not start_date:
            default_start = date.today() - timedelta(days=30)
            query = query.filter(ProductSales.date >= default_start)
        
        query = query.order_by(ProductSales.store, ProductSales.date, ProductSales.sku)

        results = query.all()

        # 品名匹配：product_name 列有值优先用列值，为空时按 SKU 动态关联 products.name 兜底
        result_skus = list({row.sku for row in results})
        sku_name_map = build_sku_name_map(db, result_skus) if result_skus else {}
        sku_image_map = build_sku_image_map(db, result_skus) if result_skus else {}

        data = []
        for row in results:
            data.append({
                "id": row.id,
                "tenant_id": row.tenant_id,
                "date": row.date.isoformat(),
                "store": row.store,
                "sku": row.sku,
                "product_name": row.product_name or sku_name_map.get(row.sku, ""),
                "image_url": sku_image_map.get(row.sku, ""),
                "sales_count": row.sales_count
            })
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取商品销量数据失败: {str(e)}")


@router.get("/sku-daily-sales")
async def get_sku_daily_sales(
    stores: Optional[str] = Query(None),
    skus: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """获取SKU每日销量数据（用于趋势图表）"""
    try:
        store_list: List[str] = []
        if stores:
            store_list = [s.strip() for s in stores.split(',')]
        
        sku_list: List[str] = []
        if skus:
            sku_list = [s.strip() for s in skus.split(',')]
        
        query = db.query(
            ProductSales.date,
            ProductSales.sku,
            func.sum(ProductSales.sales_count).label("total_sales")
        )
        
        if store_list and len(store_list) > 0:
            query = query.filter(ProductSales.store.in_(store_list))
        
        if sku_list and len(sku_list) > 0:
            query = query.filter(ProductSales.sku.in_(sku_list))
        
        if start_date:
            query = query.filter(ProductSales.date >= start_date)
        if end_date:
            query = query.filter(ProductSales.date <= end_date)
        
        query = query.group_by(ProductSales.date, ProductSales.sku)
        query = query.order_by(ProductSales.date, ProductSales.sku)
        
        results = query.all()
        
        data = []
        for row in results:
            data.append({
                "date": row.date.isoformat(),
                "sku": row.sku,
                "total_sales": row.total_sales
            })
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取SKU每日销量数据失败: {str(e)}")


@router.get("/top-skus")
async def get_top_skus(
    stores: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(10),
    db: Session = Depends(get_db)
):
    """获取销量TOP SKU"""
    try:
        _t0 = time.time()
        store_list: List[str] = []
        if stores:
            store_list = [s.strip() for s in stores.split(',')]
        
        query = db.query(
            ProductSales.store,
            ProductSales.sku,
            func.sum(ProductSales.sales_count).label("total_sales")
        )
        
        if store_list and len(store_list) > 0:
            query = query.filter(ProductSales.store.in_(store_list))
        
        if start_date:
            query = query.filter(ProductSales.date >= start_date)
        if end_date:
            query = query.filter(ProductSales.date <= end_date)
        
        if not start_date:
            default_start = date.today() - timedelta(days=30)
            query = query.filter(ProductSales.date >= default_start)
        
        query = query.group_by(ProductSales.store, ProductSales.sku)
        query = query.order_by(desc("total_sales"))
        query = query.limit(limit)
        
        results = query.all()
        _t1 = time.time()
        print(f"[PERF] top-skus SQL: {(_t1-_t0)*1000:.0f}ms, rows={len(results)}, stores={len(store_list)}")

        # 匹配品名与图片（按 SKU 关联产品档案）
        top_skus = list({row.sku for row in results})
        name_map = build_sku_name_map(db, top_skus) if top_skus else {}
        image_map = build_sku_image_map(db, top_skus) if top_skus else {}

        data = []
        for row in results:
            data.append({
                "store": row.store,
                "sku": row.sku,
                "total_sales": row.total_sales,
                "product_name": name_map.get(row.sku, ""),
                "image_url": image_map.get(row.sku, "")
            })
        _t2 = time.time()
        print(f"[PERF] top-skus total: {(_t2-_t0)*1000:.0f}ms")
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取TOP SKU失败: {str(e)}")


@router.post("/")
async def create_product_sales(
    items: List[dict],
    db: Session = Depends(get_db)
):
    """批量创建商品销量数据"""
    try:
        for item in items:
            date_str = item.get("date")
            store = item.get("store")
            sku = item.get("sku")
            sales_count = item.get("sales_count", 0)
            
            if not date_str or not store or not sku:
                continue
            
            record_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            sales_count = int(sales_count) if sales_count not in (None, '') else 0
            
            existing = db.query(ProductSales).filter(
                ProductSales.date == record_date,
                ProductSales.store == store,
                ProductSales.sku == sku
            ).first()
            
            if existing:
                existing.sales_count = sales_count
            else:
                new_record = ProductSales(
                    tenant_id=1,
                    date=record_date,
                    store=store,
                    sku=sku,
                    sales_count=sales_count
                )
                db.add(new_record)
        
        db.commit()
        
        return {
            "success": True,
            "message": "商品销量数据同步成功"
        }
    
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建商品销量数据失败: {str(e)}")



