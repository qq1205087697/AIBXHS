"""
广告管理API路由
"""
import logging
import os
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Depends
from typing import Optional, List
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database.database import get_db
from dependencies import get_current_user, get_current_user_department_ids
from models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ads", tags=["ads"])


# ==================== 文件上传校验常量 ====================
# 广告报表通常较大（关键词/搜索词报告常超过 10MB），放宽到 50MB
ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def _validate_upload_file(filename: Optional[str], content: bytes) -> None:
    """校验上传的 Excel 文件：扩展名、大小、非空。

    Args:
        filename: 文件名（用于扩展名校验）
        content: 文件二进制内容

    Raises:
        HTTPException(400): 校验失败时抛出
    """
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 取最后一个扩展名（防止 report.xlsx.exe 这种双扩展名伪装）
    _, ext = os.path.splitext(filename)
    ext_lower = ext.lower()
    if ext_lower not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {ext_lower or '(无扩展名)'}，仅支持 .xlsx 和 .xls 文件",
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="文件内容为空")

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"文件过大: {len(content) / 1024 / 1024:.1f}MB，最大支持 10MB",
        )


# ==================== 数据保留策略请求模型 ====================

class RetentionConfigRequest(BaseModel):
    retention_days: int = Field(..., description="广告数据保留天数（7-365）")


# ==================== 1. 导入广告报表Excel ====================

@router.post("/import")
async def import_ad_report(
    file: UploadFile = File(...),
    date: Optional[str] = Query(None, description="报告日期，格式YYYY-MM-DD，默认从文件名提取或当天"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导入广告报表Excel文件（后台异步执行）"""
    try:
        from services.ad_import_service import start_ad_import_async
        content = await file.read()
        # 文件校验：扩展名、大小、非空（防止无效/恶意文件进入导入服务）
        _validate_upload_file(file.filename, content)
        result = start_ad_import_async(
            file_content=content,
            filename=file.filename,
            tenant_id=current_user.tenant_id,
            report_date=date
        )
        return {"success": True, "data": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"启动广告导入任务失败: {e}")
        raise HTTPException(status_code=500, detail=f"启动导入失败: {str(e)}")


@router.get("/import-status")
async def get_ad_import_status(
    current_user: User = Depends(get_current_user)
):
    """获取广告导入任务状态（按当前租户隔离）"""
    try:
        from services.ad_import_service import get_ad_import_status
        # 项目约束：tenant_id 必须从认证端点传入，service 不可硬编码
        return {"success": True, "data": get_ad_import_status(tenant_id=current_user.tenant_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取状态失败: {str(e)}")


# ==================== 2. 广告概览统计 ====================

@router.get("/overview")
async def get_ad_overview(
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    report_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """获取广告概览统计（8个核心指标）"""
    from services.ad_service import get_ad_overview as svc_get_overview
    return {
        "success": True,
        "data": svc_get_overview(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            account=account,
            country=country,
            date_from=date_from,
            date_to=date_to,
            report_type=report_type,
        )
    }


# ==================== 3. 多维度搜索 ====================

@router.get("/search")
async def search_ads(
    keyword: Optional[str] = Query(None),
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    report_type: Optional[str] = Query(None),
    ad_type: Optional[str] = Query(None),
    match_type: Optional[str] = Query(None),
    acos_min: Optional[float] = Query(None),
    acos_max: Optional[float] = Query(None),
    sort_by: Optional[str] = Query("spend"),
    sort_order: Optional[str] = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """多维度搜索广告数据"""
    from services.ad_service import search_ad_data
    return {
        "success": True,
        "data": search_ad_data(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            keyword=keyword,
            account=account,
            country=country,
            date_from=date_from,
            date_to=date_to,
            report_type=report_type,
            ad_type=ad_type,
            match_type=match_type,
            acos_min=acos_min,
            acos_max=acos_max,
            sort_by=sort_by,
            sort_order=sort_order,
            page=page,
            page_size=page_size,
        )
    }


# ==================== 4. 表现趋势 ====================

@router.get("/performance")
async def get_ad_performance(
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    report_type: Optional[str] = Query(None),
    granularity: str = Query("daily"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """获取广告表现趋势（按日期聚合）"""
    from services.ad_service import get_ad_performance_trend
    return {
        "success": True,
        "data": get_ad_performance_trend(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            account=account,
            country=country,
            date_from=date_from,
            date_to=date_to,
            report_type=report_type,
            granularity=granularity,
        )
    }


# ==================== 5. 关键词分析 ====================

@router.get("/keyword-analysis")
async def get_keyword_analysis(
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """关键词分级分析（高转化词/潜力词/烧钱词）"""
    from services.ad_service import get_keyword_analysis as svc_keyword
    return {
        "success": True,
        "data": svc_keyword(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            account=account,
            country=country,
            date_from=date_from,
            date_to=date_to,
        )
    }


# ==================== 6. 搜索词分析 ====================

@router.get("/search-term-analysis")
async def get_search_term_analysis(
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """搜索词分析（高转化搜索词挖掘、否定词推荐）"""
    from services.ad_service import get_search_term_analysis as svc_search_term
    return {
        "success": True,
        "data": svc_search_term(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            account=account,
            country=country,
            date_from=date_from,
            date_to=date_to,
        )
    }


# ==================== 7. 导出Excel ====================

@router.get("/export")
async def export_ad_excel(
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    report_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """导出广告数据为Excel"""
    from services.ad_service import export_ad_data
    from fastapi.responses import StreamingResponse
    import io as io_module

    output = export_ad_data(
        db=db,
        tenant_id=current_user.tenant_id,
        department_ids=department_ids,
        account=account,
        country=country,
        date_from=date_from,
        date_to=date_to,
        report_type=report_type,
        keyword=keyword,
    )
    return StreamingResponse(
        io_module.BytesIO(output),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=ad_report.xlsx"}
    )


# ==================== 8. 筛选选项 ====================

@router.get("/filter-options")
async def get_ad_filter_options(
    country: Optional[str] = Query(None, description="按国家筛选店铺"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """获取筛选选项（国家/店铺/报告类型），支持国家-店铺联动"""
    from services.ad_service import get_ad_filter_options
    return {
        "success": True,
        "data": get_ad_filter_options(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            country=country,
        )
    }


# ==================== 9. AI优化建议 ====================

@router.get("/ai-suggestions")
async def get_ad_ai_suggestions(
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    suggestion_type: str = Query("all", description="all/keyword_bid/negative_keyword/budget/new_keyword"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    department_ids: List[int] = Depends(get_current_user_department_ids)
):
    """获取AI优化建议"""
    from services.ad_ai_service import generate_ad_suggestions
    return {
        "success": True,
        "data": generate_ad_suggestions(
            db=db,
            tenant_id=current_user.tenant_id,
            department_ids=department_ids,
            account=account,
            country=country,
            date_from=date_from,
            date_to=date_to,
            suggestion_type=suggestion_type,
        )
    }


# ==================== 10. 广告健康分 ====================

@router.get("/health-score")
async def get_ad_health_score(
    campaign_id: Optional[str] = Query(None, description="广告活动ID，不传则计算整体账户健康分"),
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取广告健康分（100分制6维度）

    - 传入 campaign_id 时计算单个活动健康分
    - 不传 campaign_id 时计算整体账户健康分
    - date_to 作为评估日期，默认取当天；date_from 暂未参与计算（保留扩展）
    """
    try:
        from datetime import date as date_type
        from services.ad_health_score import AdHealthScoreService

        # 确定评估日期：优先 date_to，其次 date_from，最后当天
        if date_to:
            try:
                evaluation_date = date_type.fromisoformat(date_to)
            except ValueError:
                raise HTTPException(status_code=400, detail="date_to 日期格式无效，应为 YYYY-MM-DD")
        elif date_from:
            try:
                evaluation_date = date_type.fromisoformat(date_from)
            except ValueError:
                raise HTTPException(status_code=400, detail="date_from 日期格式无效，应为 YYYY-MM-DD")
        else:
            evaluation_date = date_type.today()

        service = AdHealthScoreService()

        if campaign_id:
            result = service.calculate_campaign(
                db=db,
                tenant_id=current_user.tenant_id,
                campaign_id=campaign_id,
                evaluation_date=evaluation_date,
            )
        else:
            result = service.calculate_overall(
                db=db,
                tenant_id=current_user.tenant_id,
                evaluation_date=evaluation_date,
            )

        return {
            "success": True,
            "data": {
                "score": result.get("score", 0),
                "level": result.get("level", ""),
                "dimensions": result.get("dimensions", {}),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取广告健康分失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取广告健康分失败: {str(e)}")


# ==================== 11. 影刀RPA数据同步 ====================

@router.post("/sync/rpa")
async def sync_rpa_data(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    影刀 RPA 数据同步接口

    请求体:
    {
        "report_type": "campaign"/"keyword"/"search_term"/"product",
        "date": "YYYY-MM-DD",
        "records": [...]
    }

    根据 report_type 调用对应的 batch_upsert 方法
    """
    try:
        from services.ad_ingestion_service import AdIngestionService

        report_type = body.get("report_type")
        date_str = body.get("date")
        records = body.get("records", [])

        if not report_type:
            raise HTTPException(status_code=400, detail="缺少 report_type 参数")
        if report_type not in ("campaign", "keyword", "search_term", "product"):
            raise HTTPException(
                status_code=400,
                detail="report_type 无效，可选值: campaign/keyword/search_term/product",
            )
        if not date_str:
            raise HTTPException(status_code=400, detail="缺少 date 参数")

        service = AdIngestionService()

        # 给每条记录补齐 date 字段（若未提供）
        for record in records:
            if "date" not in record or record.get("date") is None:
                record["date"] = date_str

        method_map = {
            "campaign": service.batch_upsert_campaigns,
            "keyword": service.batch_upsert_keywords,
            "search_term": service.batch_upsert_search_terms,
            "product": service.batch_upsert_products,
        }

        upsert_fn = method_map[report_type]
        result = upsert_fn(db, current_user.tenant_id, records)

        return {
            "success": True,
            "data": {
                "success": result.get("failed", 0) == 0,
                "total": result.get("total", 0),
                "inserted": result.get("inserted", 0),
                "updated": result.get("updated", 0),
                "failed": result.get("failed", 0),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"影刀RPA数据同步失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"影刀RPA数据同步失败: {str(e)}")


# ==================== 12. 广告数据保留策略管理 ====================

@router.get("/retention/status")
async def get_ad_retention_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取广告数据保留策略状态。

    返回：
    - retention_days: 当前保留天数
    - tables: 各表数据量与最早数据日期
    - total_count: 数据总量
    - next_cleanup_at: 预计下次清理时间（次日 03:00）
    """
    try:
        from services.ad_retention_service import get_retention_status
        data = get_retention_status(db, tenant_id=current_user.tenant_id)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"获取广告保留策略状态失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取保留策略状态失败: {str(e)}")


@router.put("/retention/config")
async def update_ad_retention_config(
    body: RetentionConfigRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    更新广告数据保留天数配置。

    请求体：
    - retention_days: 保留天数（7-365）

    越界返回 400，成功返回更新后的配置。
    """
    try:
        from services.ad_retention_service import set_retention_days
        result = set_retention_days(db, tenant_id=current_user.tenant_id, days=body.retention_days)
        return {"success": True, "data": result, "message": f"保留天数已更新为 {body.retention_days} 天"}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"更新广告保留策略配置失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新保留策略配置失败: {str(e)}")


@router.post("/retention/cleanup")
async def trigger_ad_retention_cleanup(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    手动触发广告数据清理。

    立即执行清理任务，返回各表删除数量统计。
    用于调试或紧急清理场景。
    """
    try:
        from services.ad_retention_service import cleanup_expired_data
        result = cleanup_expired_data(db, tenant_id=current_user.tenant_id)
        return {
            "success": True,
            "data": result,
            "message": (
                f"清理完成：共删除 {result.get('total_deleted', 0)} 条记录"
                f"（成功 {result.get('success_count', 0)} 表"
                f"，失败 {result.get('failed_count', 0)} 表）"
            ),
        }
    except Exception as e:
        logger.error(f"手动触发广告数据清理失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"手动清理失败: {str(e)}")