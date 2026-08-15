from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from database.database import get_db
from models.product_sales import ProductSales

router = APIRouter(prefix="/product-sales", tags=["product-sales"])


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
        
        data = []
        for row in results:
            data.append({
                "id": row.id,
                "tenant_id": row.tenant_id,
                "date": row.date.isoformat(),
                "store": row.store,
                "sku": row.sku,
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
        
        data = []
        for row in results:
            data.append({
                "store": row.store,
                "sku": row.sku,
                "total_sales": row.total_sales
            })
        
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



