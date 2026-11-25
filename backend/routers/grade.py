"""产品月销量等级池接口

权限：pool/summary 沿用库存页口径（登录 + 店铺隔离，visible_store_names）；
recompute 仅 admin。设计文档：docs/plans/2026-11-24_产品月销量等级体系_完整实现方案.md
"""
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies import get_current_admin_user, get_current_user
from models.user import User
from routers.restock import get_user_role_code
from services.grade_service import (
    GRADES,
    get_current_grade_period,
    grade_pool_summary,
    list_grade_pool,
    recompute_grades,
)

router = APIRouter(prefix="/grades", tags=["等级池"])


def _parse_grades(grade: Optional[str]) -> Optional[List[str]]:
    if not grade:
        return None
    picked = [g.strip().upper() for g in grade.split(",") if g.strip()]
    invalid = [g for g in picked if g not in GRADES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"非法等级: {invalid}，可用值 S/A/B/C/D/E")
    return picked or None


@router.get("/pool")
async def get_grade_pool(
    keyword: Optional[str] = Query(None, description="搜索关键词（ASIN/品名）"),
    grade: Optional[str] = Query(None, description="等级多选，逗号分隔：S,A,B,C,D,E"),
    account: Optional[List[str]] = Query(None, description="店铺账号（权限内）"),
    country: Optional[List[str]] = Query(None, description="国家/站点"),
    holiday_filter: Optional[str] = Query(None, description="节日筛选，语义与库存页一致"),
    sort_field: Optional[str] = Query(None, description="排序字段：grade/monthly_sales/快照列"),
    sort_order: Optional[str] = Query(None, description="asc/desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """等级池列表 + 六档计数（可见性 = 库存页同口径，operator 仅授权店铺）"""
    return list_grade_pool(
        db, current_user.tenant_id,
        user_id=current_user.id, user_role=get_user_role_code(current_user, db),
        keyword=keyword, grades=_parse_grades(grade),
        account=account, country=country, holiday_filter=holiday_filter,
        sort_field=sort_field, sort_order=sort_order,
        page=page, page_size=page_size,
    )


@router.get("/summary")
async def get_grade_summary(
    keyword: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    account: Optional[List[str]] = Query(None),
    country: Optional[List[str]] = Query(None),
    holiday_filter: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """等级池六档统计 + 数据完整性提示（同过滤口径）"""
    return grade_pool_summary(
        db, current_user.tenant_id,
        user_id=current_user.id, user_role=get_user_role_code(current_user, db),
        keyword=keyword, grades=_parse_grades(grade),
        account=account, country=country, holiday_filter=holiday_filter,
    )


@router.post("/recompute")
async def recompute_grade_pool(
    body: Optional[dict] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """手动重算等级池（同步执行；仅 admin，RBAC 角色校验）"""
    period = (body or {}).get("period")
    if period and (len(period) != 7 or not period[:4].isdigit() or period[4] != "-"
                   or not period[5:7].isdigit() or not (1 <= int(period[5:7]) <= 12)):
        raise HTTPException(status_code=400, detail="period 格式应为 YYYY-MM")
    started = time.time()
    result = recompute_grades(
        db, current_user.tenant_id, period=period,
        computed_by=f"manual:{current_user.username}",
    )
    result["elapsed_ms"] = int((time.time() - started) * 1000)
    return result


@router.get("/period")
async def get_grade_period(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """当前等级期与生成时间（页面期次条用）"""
    period, computed_at = get_current_grade_period(db, current_user.tenant_id)
    return {
        "period": period,
        "computed_at": computed_at.strftime("%Y-%m-%d %H:%M") if computed_at else None,
    }
