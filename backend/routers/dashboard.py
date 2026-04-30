from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from database.database import get_db
from models.inventory import InventoryAlert, AlertStatus
from models.review import Review, ReviewStatus
from models.product import Product
from models.store import Store
from config import get_settings

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
settings = get_settings()


@router.get("/stats")
async def get_dashboard_stats(db: Session = Depends(get_db)):
    """获取看板统计数据"""
    try:
        # 统计库存预警
        inventory_alerts = db.query(
            InventoryAlert.alert_type,
            func.count(InventoryAlert.id)
        ).filter(
            InventoryAlert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED, AlertStatus.PROCESSING])
        ).group_by(InventoryAlert.alert_type).all()
        
        # 统计差评（通过 rating <= 3 判断）
        negative_reviews = db.query(
            func.count(Review.id)
        ).filter(
            Review.rating <= 3,
            Review.status.in_([ReviewStatus.NEW, ReviewStatus.READ, ReviewStatus.PROCESSING])
        ).scalar() or 0
        
        # 统计商品数量
        product_count = db.query(func.count(Product.id)).scalar() or 0
        
        # 统计店铺数量
        store_count = db.query(func.count(Store.id)).scalar() or 0
        
        # 构建预警数据
        alert_data = {}
        for alert_type, count in inventory_alerts:
            alert_data[alert_type.value] = count
        
        # 销售趋势数据（模拟）
        sales_trend = []
        today = datetime.now()
        for i in range(7, 0, -1):
            date = today - timedelta(days=i)
            sales_trend.append({
                "date": date.strftime("%Y-%m-%d"),
                "sales": (7 - i) * 1000 + 500  # 模拟数据
            })
        
        # 库存分布数据（模拟）
        inventory_distribution = [
            {"range": "0-50", "count": 5},
            {"range": "51-100", "count": 8},
            {"range": "101-200", "count": 12},
            {"range": "201-500", "count": 20},
            {"range": "500+", "count": 15}
        ]
        
        return {
            "success": True,
            "data": {
                "inventoryAlerts": alert_data,
                "negativeReviews": negative_reviews,
                "productCount": product_count,
                "storeCount": store_count,
                "salesTrend": sales_trend,
                "inventoryDistribution": inventory_distribution
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取看板数据失败: {str(e)}")
