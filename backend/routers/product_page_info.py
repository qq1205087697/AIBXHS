from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from database.database import get_db
from models.product_page_info import ProductPageInfo
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/api/product-page-info", tags=["product-page-info"])


class ProductPageInfoResponse(BaseModel):
    id: int
    tenant_id: int
    asin: str
    sku: str
    store: str
    title: str
    keywords: str
    product_description: Optional[str] = None
    bullet_points: Optional[str] = None
    price: str
    image_count: int
    title_rating: Optional[str] = None
    description_rating: Optional[str] = None
    keywords_rating: Optional[str] = None
    image_rating: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/")
async def get_product_page_info_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    asin_search: Optional[str] = Query(None),
    sku_search: Optional[str] = Query(None),
    store_filter: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取产品页面信息列表"""
    query = db.query(ProductPageInfo).filter(
        ProductPageInfo.tenant_id == current_user.tenant_id
    )

    if asin_search:
        query = query.filter(ProductPageInfo.asin.ilike(f"%{asin_search}%"))
    if sku_search:
        query = query.filter(ProductPageInfo.sku.ilike(f"%{sku_search}%"))
    if store_filter:
        query = query.filter(ProductPageInfo.store.ilike(f"%{store_filter}%"))

    total = query.count()
    items = (
        query.order_by(ProductPageInfo.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    result = []
    for item in items:
        result.append({
            "id": item.id,
            "tenant_id": item.tenant_id,
            "asin": item.asin,
            "sku": item.sku,
            "store": item.store,
            "title": item.title,
            "keywords": item.keywords,
            "product_description": item.product_description,
            "bullet_points": item.bullet_points,
            "price": item.price,
            "image_count": item.image_count,
            "title_rating": item.title_rating,
            "description_rating": item.description_rating,
            "keywords_rating": item.keywords_rating,
            "image_rating": item.image_rating,
        })

    return {"success": True, "data": result, "total": total}


@router.get("/{item_id}")
async def get_product_page_info_detail(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取产品页面信息详情"""
    item = db.query(ProductPageInfo).filter(
        ProductPageInfo.id == item_id,
        ProductPageInfo.tenant_id == current_user.tenant_id,
    ).first()

    if not item:
        return {"success": False, "message": "记录不存在"}

    return {
        "success": True,
        "data": {
            "id": item.id,
            "tenant_id": item.tenant_id,
            "asin": item.asin,
            "sku": item.sku,
            "store": item.store,
            "title": item.title,
            "keywords": item.keywords,
            "product_description": item.product_description,
            "bullet_points": item.bullet_points,
            "price": item.price,
            "image_count": item.image_count,
            "title_rating": item.title_rating,
            "description_rating": item.description_rating,
            "keywords_rating": item.keywords_rating,
            "image_rating": item.image_rating,
        },
    }


@router.get("/stores/options")
async def get_store_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取店铺下拉选项（从 product_page_info 表中提取唯一店铺名）"""
    stores = db.query(ProductPageInfo.store).filter(
        ProductPageInfo.tenant_id == current_user.tenant_id
    ).distinct().all()
    options = [{"label": s[0], "value": s[0]} for s in stores if s[0]]
    return {"success": True, "data": options}