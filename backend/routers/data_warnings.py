from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from database.database import get_db
from models.data_warning import DataWarning

router = APIRouter(prefix="/data-warnings", tags=["data-warnings"])


@router.get("/stores", response_model=List[str])
async def get_stores(db: Session = Depends(get_db)):
    """获取所有店铺名称"""
    try:
        stores = db.query(DataWarning.store).distinct().all()
        return [s[0] for s in stores]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取店铺列表失败: {str(e)}")


@router.get("/")
async def get_data_warnings(
    stores: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """获取预警数据"""
    try:
        # 处理店铺参数：支持逗号分隔和数组格式
        store_list: List[str] = []
        if stores:
            if isinstance(stores, list):
                store_list = stores
            else:
                store_list = [s.strip() for s in stores.split(',')]
        
        print(f"Received params: stores={store_list}, start_date={start_date}, end_date={end_date}")
        query = db.query(DataWarning)
        
        # 按店铺筛选
        if store_list and len(store_list) > 0:
            query = query.filter(DataWarning.store.in_(store_list))
        
        # 按日期范围筛选
        if start_date:
            query = query.filter(DataWarning.date >= start_date)
        if end_date:
            query = query.filter(DataWarning.date <= end_date)
        
        # 默认获取最近30天的数据
        if not start_date:
            default_start = date.today() - timedelta(days=30)
            query = query.filter(DataWarning.date >= default_start)
        
        # 按店铺和日期排序
        query = query.order_by(DataWarning.store, DataWarning.date)
        
        results = query.all()
        
        # 转换为字典格式
        data = []
        for row in results:
            data.append({
                "id": row.id,
                "tenant_id": row.tenant_id,
                "date": row.date.isoformat(),
                "store": row.store,
                "order_count": row.order_count,
                "ad_ratio": row.ad_ratio,
                "acos": row.acos,
                "cargo_value": row.cargo_value,
                "gmv": row.gmv,
                "fba_total_stock": row.fba_total_stock or 0,
                "storage_ratio": row.storage_ratio or 0,
                "gross_profit": row.gross_profit or 0
            })
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取预警数据失败: {str(e)}")


@router.get("/daily-summary")
async def get_daily_summary(
    stores: Optional[List[str]] = Query(None),
    date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """获取指定日期的每日汇总数据"""
    try:
        # 默认获取昨天的数据
        target_date = date if date else date.today() - timedelta(days=1)
        
        query = db.query(DataWarning).filter(DataWarning.date == target_date)
        
        # 按店铺筛选
        if stores and len(stores) > 0:
            query = query.filter(DataWarning.store.in_(stores))
        
        results = query.all()
        
        data = []
        for row in results:
            data.append({
                "date": row.date.isoformat(),
                "store": row.store,
                "order_count": row.order_count,
                "ad_ratio": row.ad_ratio,
                "acos": row.acos,
                "cargo_value": row.cargo_value,
                "gmv": row.gmv,
                "fba_total_stock": row.fba_total_stock or 0,
                "storage_ratio": row.storage_ratio or 0,
                "gross_profit": row.gross_profit or 0
            })
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取每日汇总数据失败: {str(e)}")
