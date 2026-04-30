from fastapi import APIRouter, HTTPException, Depends
from typing import List, Dict, Any
from datetime import datetime, date
from sqlalchemy.orm import Session
from database.database import get_db
from models.inventory import InventoryAlert, InventoryAction, AlertStatus
from models.product import Product
from config import get_settings

router = APIRouter(prefix="/inventory", tags=["inventory"])
settings = get_settings()


@router.get("/alerts")
async def get_inventory_alerts(db: Session = Depends(get_db)):
    """获取库存预警列表"""
    try:
        # 从数据库获取库存预警，只获取未处理的预警
        alerts = db.query(InventoryAlert).filter(
            InventoryAlert.status.in_([AlertStatus.NEW, AlertStatus.ACKNOWLEDGED, AlertStatus.PROCESSING])
        ).order_by(InventoryAlert.priority.desc(), InventoryAlert.created_at.desc()).all()
        
        # 转换为前端需要的格式
        alert_data = []
        for alert in alerts:
            product = db.query(Product).filter(Product.id == alert.product_id).first()
            
            alert_data.append({
                "id": str(alert.id),
                "asin": product.asin if product else "",
                "name": product.name if product else "",
                "currentStock": alert.current_stock or 0,
                "safetyStock": alert.safe_stock or 0,
                "daysRemaining": alert.suggestions.get("daysRemaining") if alert.suggestions else 0,
                "status": alert.severity.value,
                "category": alert.alert_type.value,
                "suggestion": alert.suggestions.get("suggestion") if alert.suggestions else ""
            })
        
        # 如果数据库没有数据，返回空列表
        return {"success": True, "data": alert_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取库存预警失败: {str(e)}")


@router.post("/execute")
async def execute_inventory_action(action_data: Dict[str, Any], db: Session = Depends(get_db)):
    """执行库存操作"""
    try:
        asin = action_data.get("asin")
        action = action_data.get("action")
        
        print(f"执行库存操作: ASIN={asin}, Action={action}")
        
        # 查找对应的商品
        product = db.query(Product).filter(Product.asin == asin).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"商品 {asin} 不存在")
        
        # 创建操作记录
        inventory_action = InventoryAction(
            tenant_id=1,  # 暂时使用固定租户ID
            product_id=product.id,
            store_id=1,  # 暂时使用固定店铺ID
            action_type=action,
            action_title=f"执行{action}操作",
            action_details=action_data,
            status="success",
            triggered_by="manual",
            result=f"操作执行成功",
            executed_at=datetime.now()
        )
        
        db.add(inventory_action)
        db.commit()
        db.refresh(inventory_action)
        
        return {
            "success": True,
            "message": "操作执行成功",
            "data": {
                "asin": asin,
                "action": action,
                "timestamp": datetime.now().isoformat()
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行操作失败: {str(e)}")
