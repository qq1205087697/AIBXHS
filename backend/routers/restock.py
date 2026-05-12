"""
库存补货API路由 - 供影刀RPA及前端调用
"""
import os
import logging
from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Request
from typing import Optional, List
from sqlalchemy.orm import Session
from database.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/restock", tags=["restock"])


# ==================== 1. 导入补货建议Excel ====================

@router.post("/import")
async def import_inventory(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Query(None, description="Excel文件路径（与file二选一）"),
    db: Session = Depends(get_db)
):
    """
    导入补货建议Excel文件（供影刀调用）
    支持文件上传或指定文件路径两种方式
    """
    try:
        from services.inventory_service import import_inventory_data

        # 优先使用上传的文件，其次使用文件路径
        if file:
            content = await file.read()
            result = import_inventory_data(db, file_content=content, filename=file.filename)
        elif file_path:
            if not os.path.exists(file_path):
                raise HTTPException(status_code=400, detail=f"文件不存在: {file_path}")
            result = import_inventory_data(db, file_path=file_path)
        else:
            raise HTTPException(status_code=400, detail="请提供 file 或 file_path 参数")

        return {"success": True, "data": result}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导入补货数据失败: {e}")
        raise HTTPException(status_code=500, detail=f"导入补货数据失败: {str(e)}")


# ==================== 2. 触发补货决策计算 ====================

@router.post("/calculate")
async def calculate_replenishment(
    snapshot_date: Optional[str] = Query(None, description="快照日期，格式YYYY-MM-DD，默认最新"),
    db: Session = Depends(get_db)
):
    """
    触发补货决策计算
    根据库存数据计算每个SKU的补货建议和风险等级
    """
    try:
        from services.inventory_service import calculate_replenishment

        result = calculate_replenishment(db, snapshot_date=snapshot_date)
        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"补货计算失败: {e}")
        raise HTTPException(status_code=500, detail=f"补货计算失败: {str(e)}")


# ==================== 3. 获取库存概览统计 ====================

@router.get("/overview")
async def get_inventory_overview(db: Session = Depends(get_db)):
    """
    获取库存概览统计
    包含各风险等级数量、快照日期、断货TOP10、冗余库存TOP10
    """
    try:
        from services.inventory_service import get_inventory_overview

        result = get_inventory_overview(db)
        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"获取库存概览失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取库存概览失败: {str(e)}")


# ==================== 4. 搜索库存数据 ====================

@router.get("/search")
async def search_inventory(
    request: Request,
    keyword: Optional[str] = Query(None, description="搜索关键词（ASIN/商品名）"),
    risk_level: Optional[List[str]] = Query(None, description="风险等级: red/yellow/green"),
    replenishment_status: Optional[str] = Query(None, description="补货状态"),
    account: Optional[str] = Query(None, description="店铺账号"),
    country: Optional[str] = Query(None, description="国家/站点"),
    sort_field: Optional[str] = Query(None, description="排序字段"),
    sort_order: Optional[str] = Query(None, description="排序方式: asc/desc"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    db: Session = Depends(get_db)
):
    """
    搜索库存数据
    支持按关键词、风险等级、补货状态、账号、国家筛选，分页返回，支持排序
    """
    try:
        from services.inventory_service import search_inventory

        # 处理风险等级参数，兼容两种格式：risk_level 和 risk_level[]
        final_risk_level = risk_level
        if not final_risk_level:
            # 检查是否有 risk_level[] 参数
            query_params = request.query_params
            risk_level_params = query_params.getlist("risk_level") or query_params.getlist("risk_level[]")
            if risk_level_params and len(risk_level_params) > 0:
                final_risk_level = risk_level_params

        result = search_inventory(
            db,
            keyword=keyword,
            risk_level=final_risk_level,
            replenishment_status=replenishment_status,
            account=account,
            country=country,
            sort_field=sort_field,
            sort_order=sort_order,
            page=page,
            page_size=page_size
        )
        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"搜索库存数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"搜索库存数据失败: {str(e)}")


# ==================== 5. 断货风险TOP10 ====================

@router.get("/stockout-top10")
async def get_stockout_top10(db: Session = Depends(get_db)):
    """
    获取断货风险最高的10个SKU
    按预计断货天数升序排列
    """
    try:
        from services.inventory_service import get_stockout_top10

        result = get_stockout_top10(db)
        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"获取断货TOP10失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取断货TOP10失败: {str(e)}")


# ==================== 6. 冗余库存TOP10 ====================

@router.get("/overstock-top10")
async def get_overstock_top10(db: Session = Depends(get_db)):
    """
    获取冗余库存最高的10个SKU
    按冗余天数降序排列
    """
    try:
        from services.inventory_service import get_overstock_top10

        result = get_overstock_top10(db)
        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"获取冗余库存TOP10失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取冗余库存TOP10失败: {str(e)}")


# ==================== 7. 在途货件详情 ====================

@router.get("/inbound-details")
async def get_inbound_details(
    asin: str = Query(..., description="ASIN（必填）"),
    account: Optional[str] = Query(None, description="店铺账号"),
    db: Session = Depends(get_db)
):
    """
    查询指定ASIN的在途货件详情
    返回所有相关的在途 shipment 信息
    """
    try:
        from services.inventory_service import get_inbound_details

        result = get_inbound_details(db, asin=asin, account=account)
        return {"success": True, "data": result}

    except Exception as e:
        logger.error(f"获取在途货件详情失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取在途货件详情失败: {str(e)}")


# ==================== 8. 获取最新快照日期 ====================

@router.get("/latest-date")
async def get_latest_snapshot_date(db: Session = Depends(get_db)):
    """
    获取最新的库存快照日期
    用于前端展示当前数据的时间范围
    """
    try:
        from services.inventory_service import get_latest_snapshot_date

        snapshot_date = get_latest_snapshot_date(db)
        return {"success": True, "data": {"snapshot_date": snapshot_date}}

    except Exception as e:
        logger.error(f"获取最新快照日期失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取最新快照日期失败: {str(e)}")

