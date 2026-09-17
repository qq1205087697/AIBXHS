from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from sqlalchemy.orm import Session
from database.database import get_db
from models.threshold_setting import ThresholdSetting

router = APIRouter(prefix="/threshold-settings", tags=["threshold-settings"])


@router.get("/")
async def get_threshold_settings(
    store: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    try:
        query = db.query(ThresholdSetting).filter(ThresholdSetting.tenant_id == 1)
        
        if store:
            query = query.filter(ThresholdSetting.store == store)
        
        results = query.all()
        
        data = []
        for row in results:
            data.append({
                "id": row.id,
                "store": row.store,
                "ad_ratio_threshold": row.ad_ratio_threshold,
                "storage_ratio_threshold": row.storage_ratio_threshold,
                "acos_threshold": row.acos_threshold,
                "overall_trend_threshold": row.overall_trend_threshold,
                "latest_trend_threshold": row.latest_trend_threshold
            })
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        import traceback
        print(f"Error in get_threshold_settings: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"获取阈值设置失败: {str(e)}")


@router.get("/stores")
async def get_stores_with_thresholds(db: Session = Depends(get_db)):
    try:
        results = db.query(ThresholdSetting).filter(ThresholdSetting.tenant_id == 1).all()
        
        data = {}
        for row in results:
            data[row.store] = {
                "ad_ratio_threshold": row.ad_ratio_threshold,
                "storage_ratio_threshold": row.storage_ratio_threshold,
                "acos_threshold": row.acos_threshold,
                "overall_trend_threshold": row.overall_trend_threshold,
                "latest_trend_threshold": row.latest_trend_threshold
            }
        
        return {
            "success": True,
            "data": data
        }
    
    except Exception as e:
        import traceback
        print(f"Error in get_stores_with_thresholds: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"获取店铺阈值失败: {str(e)}")


@router.get("/sku-anomaly")
async def get_sku_anomaly_thresholds(db: Session = Depends(get_db)):
    try:
        SKU_GLOBAL_STORE = "__sku_global__"
        setting = db.query(ThresholdSetting).filter(
            ThresholdSetting.tenant_id == 1,
            ThresholdSetting.store == SKU_GLOBAL_STORE
        ).first()
        
        if not setting:
            setting = ThresholdSetting(
                tenant_id=1,
                store=SKU_GLOBAL_STORE,
                ad_ratio_threshold=25.0,
                storage_ratio_threshold=10.0,
                acos_threshold=30.0,
                overall_trend_threshold=15.0,
                latest_trend_threshold=20.0,
            )
            db.add(setting)
            db.commit()
            db.refresh(setting)
        
        return {
            "success": True,
            "data": {
                "overall_trend_threshold": setting.overall_trend_threshold,
                "latest_trend_threshold": setting.latest_trend_threshold,
            }
        }
    
    except Exception as e:
        import traceback
        print(f"Error in get_sku_anomaly_thresholds: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"获取SKU异动阈值失败: {str(e)}")


@router.post("/sku-anomaly")
async def update_sku_anomaly_thresholds(
    overall_trend_threshold: Optional[float] = None,
    latest_trend_threshold: Optional[float] = None,
    db: Session = Depends(get_db)
):
    try:
        SKU_GLOBAL_STORE = "__sku_global__"
        setting = db.query(ThresholdSetting).filter(
            ThresholdSetting.tenant_id == 1,
            ThresholdSetting.store == SKU_GLOBAL_STORE
        ).first()
        
        if not setting:
            setting = ThresholdSetting(
                tenant_id=1,
                store=SKU_GLOBAL_STORE,
                ad_ratio_threshold=25.0,
                storage_ratio_threshold=10.0,
                acos_threshold=30.0,
                overall_trend_threshold=overall_trend_threshold if overall_trend_threshold is not None else 15.0,
                latest_trend_threshold=latest_trend_threshold if latest_trend_threshold is not None else 20.0,
            )
            db.add(setting)
        else:
            if overall_trend_threshold is not None:
                setting.overall_trend_threshold = overall_trend_threshold
            if latest_trend_threshold is not None:
                setting.latest_trend_threshold = latest_trend_threshold
        
        db.commit()
        db.refresh(setting)
        
        return {
            "success": True,
            "data": {
                "overall_trend_threshold": setting.overall_trend_threshold,
                "latest_trend_threshold": setting.latest_trend_threshold,
            }
        }
    
    except Exception as e:
        import traceback
        print(f"Error in update_sku_anomaly_thresholds: {str(e)}")
        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新SKU异动阈值失败: {str(e)}")


@router.post("/")
async def update_threshold_setting(
    store: str,
    ad_ratio_threshold: Optional[float] = None,
    storage_ratio_threshold: Optional[float] = None,
    acos_threshold: Optional[float] = None,
    overall_trend_threshold: Optional[float] = None,
    latest_trend_threshold: Optional[float] = None,
    db: Session = Depends(get_db)
):
    try:
        setting = db.query(ThresholdSetting).filter(
            ThresholdSetting.tenant_id == 1,
            ThresholdSetting.store == store
        ).first()
        
        if not setting:
            setting = ThresholdSetting(
                tenant_id=1,
                store=store,
                ad_ratio_threshold=ad_ratio_threshold or 25.0,
                storage_ratio_threshold=storage_ratio_threshold or 10.0,
                acos_threshold=acos_threshold or 30.0,
                overall_trend_threshold=overall_trend_threshold or 15.0,
                latest_trend_threshold=latest_trend_threshold or 20.0,
            )
            db.add(setting)
        else:
            if ad_ratio_threshold is not None:
                setting.ad_ratio_threshold = ad_ratio_threshold
            if storage_ratio_threshold is not None:
                setting.storage_ratio_threshold = storage_ratio_threshold
            if acos_threshold is not None:
                setting.acos_threshold = acos_threshold
            if overall_trend_threshold is not None:
                setting.overall_trend_threshold = overall_trend_threshold
            if latest_trend_threshold is not None:
                setting.latest_trend_threshold = latest_trend_threshold
        
        db.commit()
        db.refresh(setting)
        
        return {
            "success": True,
            "data": {
                "store": setting.store,
                "ad_ratio_threshold": setting.ad_ratio_threshold,
                "storage_ratio_threshold": setting.storage_ratio_threshold,
                "acos_threshold": setting.acos_threshold,
                "overall_trend_threshold": setting.overall_trend_threshold,
                "latest_trend_threshold": setting.latest_trend_threshold,
            }
        }
    
    except Exception as e:
        import traceback
        print(f"Error in update_threshold_setting: {str(e)}")
        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新阈值设置失败: {str(e)}")


@router.post("/batch")
async def batch_update_threshold_settings(
    settings: List[dict],
    db: Session = Depends(get_db)
):
    try:
        for item in settings:
            store = item.get("store")
            if not store:
                continue
            
            setting = db.query(ThresholdSetting).filter(
                ThresholdSetting.tenant_id == 1,
                ThresholdSetting.store == store
            ).first()
            
            if not setting:
                setting = ThresholdSetting(
                    tenant_id=1,
                    store=store,
                    ad_ratio_threshold=item.get("ad_ratio_threshold", 25.0),
                    storage_ratio_threshold=item.get("storage_ratio_threshold", 10.0),
                    acos_threshold=item.get("acos_threshold", 30.0),
                    overall_trend_threshold=item.get("overall_trend_threshold", 15.0),
                    latest_trend_threshold=item.get("latest_trend_threshold", 20.0),
                )
                db.add(setting)
            else:
                if "ad_ratio_threshold" in item:
                    setting.ad_ratio_threshold = item["ad_ratio_threshold"]
                if "storage_ratio_threshold" in item:
                    setting.storage_ratio_threshold = item["storage_ratio_threshold"]
                if "acos_threshold" in item:
                    setting.acos_threshold = item["acos_threshold"]
                if "overall_trend_threshold" in item:
                    setting.overall_trend_threshold = item["overall_trend_threshold"]
                if "latest_trend_threshold" in item:
                    setting.latest_trend_threshold = item["latest_trend_threshold"]
        
        db.commit()
        
        return {
            "success": True,
            "message": "批量更新成功"
        }
    
    except Exception as e:
        import traceback
        print(f"Error in batch_update_threshold_settings: {str(e)}")
        traceback.print_exc()
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量更新阈值设置失败: {str(e)}")
