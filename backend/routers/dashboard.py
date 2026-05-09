from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from database.database import get_db
from models.inventory import InventoryAlert, AlertStatus
from models.review import Review, ReviewStatus
from models.product import Product
from models.store import Store
from config import get_settings
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
settings = get_settings()


@router.get("/stats")
async def get_dashboard_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取看板统计数据"""
    try:
        review_query = db.query(func.count(Review.id)).filter(
            Review.rating <= 3,
            Review.status.in_([ReviewStatus.NEW, ReviewStatus.READ, ReviewStatus.PROCESSING])
        )
        product_query = db.query(func.count(Product.id))
        store_query = db.query(func.count(Store.id))
        
        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                # 包含该部门和没有分配部门的数据
                review_query = review_query.join(Store, Review.store_id == Store.id).filter(
                    (Store.department_id.in_(dept_id_list)) | (Store.department_id == None)
                )
        
        negative_reviews = review_query.scalar() or 0
        product_count = product_query.scalar() or 0
        store_count = store_query.scalar() or 0
        
        # 统计库存预警
        inventory_alerts = db.query(
            InventoryAlert.alert_type,
            func.count(InventoryAlert.id)
        ).filter(
            InventoryAlert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED, AlertStatus.PROCESSING])
        ).group_by(InventoryAlert.alert_type).all()
        
        alert_data = {}
        for alert_type, count in inventory_alerts:
            alert_data[alert_type.value] = count
        
        sales_trend = []
        today = datetime.now()
        for i in range(7, 0, -1):
            date = today - timedelta(days=i)
            sales_trend.append({
                "date": date.strftime("%Y-%m-%d"),
                "sales": (7 - i) * 1000 + 500
            })
        
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
