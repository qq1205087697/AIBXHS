from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from datetime import datetime, timedelta, date
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
        # 租户隔离：所有查询都必须过滤 tenant_id
        review_query = db.query(func.count(Review.id)).filter(
            Review.rating <= 3,
            Review.status.in_([ReviewStatus.NEW, ReviewStatus.READ, ReviewStatus.PROCESSING]),
            Review.tenant_id == current_user.tenant_id
        )
        product_query = db.query(func.count(Product.id)).filter(
            Product.tenant_id == current_user.tenant_id
        )
        store_query = db.query(func.count(Store.id)).filter(
            Store.tenant_id == current_user.tenant_id
        )
        
        is_admin = False
        if current_user.role_id:
            role_row = db.execute(
                text("SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL"),
                {"role_id": current_user.role_id}
            ).fetchone()
            if role_row and role_row[0] == "admin":
                is_admin = True

        if not is_admin:
            user_stores = db.execute(
                text("SELECT store_id FROM user_stores WHERE user_id = :uid AND tenant_id = :tid"),
                {"uid": current_user.id, "tid": current_user.tenant_id}
            ).fetchall()
            store_id_list = [s[0] for s in user_stores]
            if store_id_list:
                review_query = review_query.filter(Review.store_id.in_(store_id_list))
        
        negative_reviews = review_query.scalar() or 0
        product_count = product_query.scalar() or 0
        store_count = store_query.scalar() or 0
        
        # 统计库存预警（租户隔离）
        inventory_alerts = db.query(
            InventoryAlert.alert_type,
            func.count(InventoryAlert.id)
        ).filter(
            InventoryAlert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED, AlertStatus.PROCESSING]),
            InventoryAlert.tenant_id == current_user.tenant_id
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

        # 统计超期未入库采购单（审批通过/已下单超过14天未完成）- 已有租户隔离
        overdue_purchase_orders = []
        overdue_count = 0
        try:
            today_dt = datetime.now()
            cutoff_dt = today_dt - timedelta(days=14)
            # 用 COALESCE 取 approved_at，为空则用 created_at 作为基准日期
            overdue_rows = db.execute(text("""
                SELECT po.id, po.order_number, po.status,
                       COALESCE(po.approved_at, po.created_at) as base_date,
                       po.total_amount
                FROM purchase_orders po
                WHERE po.deleted_at IS NULL
                  AND po.tenant_id = :tenant_id
                  AND COALESCE(po.approved_at, po.created_at) IS NOT NULL
                  AND DATE(COALESCE(po.approved_at, po.created_at)) <= :cutoff_str
                  AND po.status NOT IN ('completed', 'cancelled')
                ORDER BY COALESCE(po.approved_at, po.created_at) ASC
            """), {
                "tenant_id": current_user.tenant_id,
                "cutoff_str": cutoff_dt.strftime("%Y-%m-%d"),
            }).fetchall()

            for row in overdue_rows:
                base_date = row[3]
                days_passed = int((today_dt - base_date).total_seconds() // 86400)
                overdue_purchase_orders.append({
                    "id": row[0],
                    "order_number": row[1],
                    "status": row[2],
                    "approved_at": base_date.strftime("%Y-%m-%d") if base_date else "",
                    "days_overdue": days_passed,
                    "total_amount": float(row[4]) if row[4] else 0,
                    "created_by_name": "",
                    "approved_by_name": "",
                })
            overdue_count = len(overdue_purchase_orders)
        except Exception as e:
            import traceback
            print(f"查询超期采购单失败: {e}")
            traceback.print_exc()

        # 统计采购单各状态数量（待审批/待补发等）- 已有租户隔离
        po_status_counts = {}
        try:
            po_status_rows = db.execute(text("""
                SELECT status, COUNT(*) as cnt
                FROM purchase_orders
                WHERE deleted_at IS NULL
                  AND tenant_id = :tenant_id
                  AND status NOT IN ('draft', 'cancelled', 'completed')
                GROUP BY status
            """), {"tenant_id": current_user.tenant_id}).fetchall()
            for row in po_status_rows:
                po_status_counts[row[0]] = int(row[1])
        except Exception as e:
            print(f"查询采购单状态统计失败: {e}")

        return {
            "success": True,
            "data": {
                "inventoryAlerts": alert_data,
                "negativeReviews": negative_reviews,
                "productCount": product_count,
                "storeCount": store_count,
                "salesTrend": sales_trend,
                "inventoryDistribution": inventory_distribution,
                "overduePurchaseOrdersCount": overdue_count,
                "overduePurchaseOrders": overdue_purchase_orders,
                # 采购单各状态数量
                "purchaseOrderStatusCounts": po_status_counts,
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取看板数据失败: {str(e)}")
