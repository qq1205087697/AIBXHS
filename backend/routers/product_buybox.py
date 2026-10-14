from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database.database import get_db
from models.product_buybox import ProductBuybox

router = APIRouter(prefix="/product-buybox", tags=["product-buybox"])


@router.get("/")
async def get_buybox_records(
    stores: Optional[str] = Query(None, description="逗号分隔的店铺名"),
    processed: Optional[bool] = Query(None, description="true=只查已处理，false/不传=只查未处理"),
    db: Session = Depends(get_db)
):
    """获取购物车预警数据（默认未处理；processed=true 时返回已处理记录）"""
    try:
        store_list: List[str] = []
        if stores:
            store_list = [s.strip() for s in stores.split(',') if s.strip()]

        query = db.query(ProductBuybox).filter(ProductBuybox.deleted_at.is_(None))

        # 按店铺筛选
        if store_list:
            query = query.filter(ProductBuybox.store.in_(store_list))

        # 状态过滤：不是「已处理」的都算未处理（兼容「待处理/未处理」）
        if processed:
            query = query.filter(ProductBuybox.status == '已处理')
        else:
            query = query.filter(ProductBuybox.status != '已处理')

        query = query.order_by(ProductBuybox.date.desc(), ProductBuybox.id.asc())
        results = query.all()

        data = []
        for row in results:
            data.append({
                "id": row.id,
                "date": row.date.isoformat() if row.date else None,
                "sku": row.sku,
                "product_name": row.product_name,
                "store": row.store,
                "status": row.status,
            })

        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取购物车预警数据失败: {str(e)}")


class ProcessBatchRequest(BaseModel):
    ids: List[int]


@router.post("/process-batch")
async def process_batch(req: ProcessBatchRequest, db: Session = Depends(get_db)):
    """批量标记记录为已处理（一键处理某店铺全部未处理记录）"""
    try:
        if not req.ids:
            return {"success": True, "updated": 0}
        updated = db.query(ProductBuybox).filter(
            ProductBuybox.id.in_(req.ids),
            ProductBuybox.deleted_at.is_(None),
        ).update(
            {ProductBuybox.status: '已处理', ProductBuybox.updated_at: datetime.now()},
            synchronize_session=False,
        )
        db.commit()
        return {"success": True, "updated": updated}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量标记已处理失败: {str(e)}")


@router.post("/{record_id}/process")
async def mark_processed(record_id: int, db: Session = Depends(get_db)):
    """标记单条记录为已处理"""
    try:
        record = db.query(ProductBuybox).filter(
            ProductBuybox.id == record_id,
            ProductBuybox.deleted_at.is_(None),
        ).first()
        if not record:
            raise HTTPException(status_code=404, detail=f"记录 {record_id} 不存在")

        record.status = '已处理'
        record.updated_at = datetime.now()
        db.commit()
        return {"success": True, "message": f"记录 {record_id} 已标记为已处理"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"标记已处理失败: {str(e)}")
