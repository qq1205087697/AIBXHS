from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database.database import get_db
from dependencies import get_current_user
from models.product_shipment_notice import ProductShipmentNotice
from models.user import User

router = APIRouter(prefix="/product-shipment-notice", tags=["product-shipment-notice"])


@router.get("/")
async def get_shipment_records(
    stores: Optional[str] = Query(None, description="逗号分隔的店铺名"),
    processed: Optional[bool] = Query(None, description="true=只查已处理，false/不传=只查未处理"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取货件预警数据（默认未处理；processed=true 时返回已处理记录）"""
    try:
        store_list: List[str] = []
        if stores:
            store_list = [s.strip() for s in stores.split(',') if s.strip()]

        query = db.query(ProductShipmentNotice).filter(ProductShipmentNotice.deleted_at.is_(None))

        if store_list:
            query = query.filter(ProductShipmentNotice.store.in_(store_list))

        if processed:
            query = query.filter(ProductShipmentNotice.status == '已确认')
        else:
            query = query.filter(ProductShipmentNotice.status != '已确认')

        query = query.order_by(ProductShipmentNotice.date.desc(), ProductShipmentNotice.id.asc())
        results = query.all()

        data = []
        for row in results:
            data.append({
                "id": row.id,
                "date": row.date.isoformat() if row.date else None,
                "store": row.store,
                "shipment_code": row.shipment_code,
                "status": row.status,
            })

        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取货件预警数据失败: {str(e)}")


class ProcessBatchRequest(BaseModel):
    ids: List[int]


@router.post("/process-batch")
async def process_batch(req: ProcessBatchRequest, db: Session = Depends(get_db)):
    """批量确认记录（一键确认某店铺全部未处理记录，状态写为已确认）"""
    try:
        if not req.ids:
            return {"success": True, "updated": 0}
        updated = db.query(ProductShipmentNotice).filter(
            ProductShipmentNotice.id.in_(req.ids),
            ProductShipmentNotice.deleted_at.is_(None),
        ).update(
            {ProductShipmentNotice.status: '已确认', ProductShipmentNotice.updated_at: datetime.now()},
            synchronize_session=False,
        )
        db.commit()
        return {"success": True, "updated": updated}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量确认失败: {str(e)}")


@router.post("/{record_id}/unprocess")
async def mark_unprocessed(record_id: int, db: Session = Depends(get_db)):
    """将已确认记录移回待处理（状态写为待处理）"""
    try:
        record = db.query(ProductShipmentNotice).filter(
            ProductShipmentNotice.id == record_id,
            ProductShipmentNotice.deleted_at.is_(None),
        ).first()
        if not record:
            raise HTTPException(status_code=404, detail=f"记录 {record_id} 不存在")

        record.status = '待处理'
        record.updated_at = datetime.now()
        db.commit()
        return {"success": True, "message": f"记录 {record_id} 已移回待处理"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"移回待处理失败: {str(e)}")
