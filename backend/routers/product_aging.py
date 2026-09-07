from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from database.database import get_db
from models.product_aging_inventory import ProductAgingInventory

router = APIRouter(prefix="/product-aging", tags=["product-aging"])


@router.get("/")
async def get_product_aging_inventory(
    stores: Optional[str] = Query(None, description="店铺名，多个逗号分隔"),
    db: Session = Depends(get_db)
):
    try:
        store_list: List[str] = []
        if stores:
            store_list = [s.strip() for s in stores.split(',') if s.strip()]

        # 按筛选店铺找最新日期
        latest_q = db.query(func.max(ProductAgingInventory.date))
        if store_list:
            latest_q = latest_q.filter(ProductAgingInventory.store.in_(store_list))
        latest_date = latest_q.scalar()

        if not latest_date:
            return {"success": True, "latest_date": None, "data": []}

        query = db.query(ProductAgingInventory).filter(
            ProductAgingInventory.date == latest_date
        )
        if store_list:
            query = query.filter(ProductAgingInventory.store.in_(store_list))

        rows = query.all()

        data = []
        for r in rows:
            if r.aging_181_270 or r.aging_271_365 or r.aging_366_455 or r.aging_456_plus:
                data.append({
                    "store": r.store,
                    "sku": r.sku,
                    "aging_181_270": r.aging_181_270 or 0,
                    "aging_271_365": r.aging_271_365 or 0,
                    "aging_366_455": r.aging_366_455 or 0,
                    "aging_456_plus": r.aging_456_plus or 0,
                })

        return {
            "success": True,
            "latest_date": latest_date.strftime("%Y-%m-%d"),
            "total": len(data),
            "data": data,
        }
    except Exception as e:
        import traceback
        print(f"Error in get_product_aging_inventory: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"获取超库龄数据失败: {str(e)}")
