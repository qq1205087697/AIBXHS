from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote
from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.excel_helper import create_product_excel_template, parse_product_excel

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductCreate(BaseModel):
    product_code: Optional[str] = None
    name: str
    name_en: Optional[str] = None
    product_type: Optional[List[str]] = None
    product_attribute: Optional[str] = "general"
    category: Optional[str] = None
    brand: Optional[str] = None
    purchase_price: Optional[float] = None
    sale_price: Optional[float] = None
    main_image: Optional[str] = None
    weight: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    status: str = "active"
    is_robot_monitored: bool = True
    local_quantity: Optional[int] = 0
    local_warehouse: Optional[str] = None
    local_inbound_date: Optional[str] = None
    local_stock_age: Optional[int] = None


class ProductUpdate(BaseModel):
    product_code: Optional[str] = None
    name: Optional[str] = None
    name_en: Optional[str] = None
    product_type: Optional[List[str]] = None
    product_attribute: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    purchase_price: Optional[float] = None
    sale_price: Optional[float] = None
    main_image: Optional[str] = None
    weight: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    status: Optional[str] = None
    is_robot_monitored: Optional[bool] = None
    local_quantity: Optional[int] = None
    local_warehouse: Optional[str] = None
    local_inbound_date: Optional[str] = None
    local_stock_age: Optional[int] = None


class PlatformProductBatchCreate(BaseModel):
    platform: str
    store_ids: list[int]
    platform_product_id: Optional[str] = None
    asin: Optional[str] = None
    spu: Optional[str] = None
    sku: Optional[str] = None
    title: Optional[str] = None
    title_en: Optional[str] = None
    image_url: Optional[str] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    status: str = "active"


class PlatformProductUpdate(BaseModel):
    platform_product_id: Optional[str] = None
    asin: Optional[str] = None
    spu: Optional[str] = None
    sku: Optional[str] = None
    title: Optional[str] = None
    title_en: Optional[str] = None
    image_url: Optional[str] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    status: Optional[str] = None
    store_ids: Optional[list[int]] = None
    extra_data: Optional[dict] = None


@router.get("/")
async def get_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=10000),
    search: Optional[str] = None,
    product_type: Optional[List[str]] = Query(None),
    product_attribute: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["p.tenant_id = :tenant_id", "p.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if search:
            where_conditions.append("""
                (p.product_code LIKE :search 
                OR p.name LIKE :search 
                OR p.name_en LIKE :search
                OR p.category LIKE :search
                OR p.brand LIKE :search
                OR EXISTS (
                    SELECT 1 FROM platform_products pp 
                    WHERE pp.product_id = p.id 
                    AND pp.deleted_at IS NULL 
                    AND (pp.sku LIKE :search 
                         OR pp.asin LIKE :search 
                         OR pp.platform_product_id LIKE :search 
                         OR pp.title LIKE :search 
                         OR pp.title_en LIKE :search)
                )
                )
            """)
            params["search"] = f"%{search}%"

        if product_type and len(product_type) > 0:
            # 支持产品类型多选，使用 LIKE 匹配逗号分隔的字符串
            type_conditions = []
            for i, pt in enumerate(product_type):
                param_name = f"product_type_{i}"
                type_conditions.append(f"p.product_type LIKE :{param_name}")
                params[param_name] = f"%{pt}%"
            if type_conditions:
                where_conditions.append(f"({ ' OR '.join(type_conditions) })")

        if product_attribute:
            where_conditions.append("p.product_attribute = :product_attribute")
            params["product_attribute"] = product_attribute

        if status:
            where_conditions.append("p.status = :status")
            params["status"] = status

        where_clause = " AND ".join(where_conditions)

        count_query = text(f"""
            SELECT COUNT(p.id)
            FROM products p
            WHERE {where_clause}
        """)
        total = db.execute(count_query, params).scalar() or 0

        offset = (page - 1) * page_size
        params["offset"] = offset
        params["limit"] = page_size

        query = text(f"""
            SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                   p.category, p.brand, p.purchase_price, p.sale_price,
                   p.main_image, p.weight, p.length, p.width, p.height,
                   p.status, p.is_robot_monitored, p.created_at,
                   (SELECT COUNT(*) FROM platform_products pp WHERE pp.product_id = p.id AND pp.deleted_at IS NULL) as platform_count,
                   p.local_quantity, p.local_warehouse, p.local_inbound_date, p.local_stock_age
            FROM products p
            WHERE {where_clause}
            ORDER BY p.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        result = db.execute(query, params)
        products = []
        for row in result:
            purchase_price = float(row[8]) if row[8] else None
            local_quantity = int(row[19]) if row[19] else 0
            # 计算货值 = 本地库存数量 × 采购价
            local_value = None
            if purchase_price and local_quantity is not None:
                local_value = purchase_price * local_quantity
            
            # 将逗号分隔的产品类型字符串转换为数组
            product_type_str = row[4] or ""
            product_type = product_type_str.split(",") if product_type_str else []
            
            products.append({
                "id": row[0],
                "product_code": row[1] or "",
                "name": row[2],
                "name_en": row[3] or "",
                "product_type": product_type,
                "product_attribute": row[5] or "general",
                "category": row[6] or "",
                "brand": row[7] or "",
                "purchase_price": float(row[8]) if row[8] else None,
                "sale_price": float(row[9]) if row[9] else None,
                "main_image": row[10] or "",
                "weight": float(row[11]) if row[11] else None,
                "length": float(row[12]) if row[12] else None,
                "width": float(row[13]) if row[13] else None,
                "height": float(row[14]) if row[14] else None,
                "status": row[15],
                "is_robot_monitored": bool(row[16]),
                "created_at": row[17].strftime("%Y-%m-%d %H:%M:%S") if row[17] else "",
                "platform_count": int(row[18]) if row[18] else 0,
                "local_quantity": local_quantity,
                "local_warehouse": row[20] or "",
                "local_inbound_date": row[21].strftime("%Y-%m-%d") if row[21] else "",
                "local_stock_age": int(row[22]) if row[22] else None,
                "local_value": float(local_value) if local_value is not None else None,
            })
        return {
            "success": True,
            "data": products,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取商品列表失败: {str(e)}")


@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        query = text("""
            SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                   p.category, p.brand, p.purchase_price, p.sale_price,
                   p.main_image, p.weight, p.length, p.width, p.height,
                   p.status, p.is_robot_monitored, p.created_at, p.config,
                   p.local_quantity, p.local_warehouse, p.local_inbound_date, p.local_stock_age
            FROM products p
            WHERE p.id = :product_id AND p.tenant_id = :tenant_id AND p.deleted_at IS NULL
        """)
        row = db.execute(query, {"product_id": product_id, "tenant_id": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="商品不存在")

        import json

        platform_query = text("""
            SELECT pp.id, pp.platform, pp.store_id,
                   pp.platform_product_id, pp.asin, pp.spu, pp.sku,
                   pp.title, pp.title_en, pp.image_url, pp.currency,
                   pp.price, pp.cost_price, pp.status, pp.sync_status, pp.created_at
            FROM platform_products pp
            WHERE pp.product_id = :product_id AND pp.deleted_at IS NULL
            ORDER BY pp.created_at DESC
        """)
        pp_result = db.execute(platform_query, {"product_id": product_id})
        platform_products = []
        for pp in pp_result:
            store_ids_raw = pp[2]
            store_ids = []
            if store_ids_raw:
                try:
                    if isinstance(store_ids_raw, (int, float)):
                        # 旧数据是单个 ID
                        store_ids = [int(store_ids_raw)]
                    elif isinstance(store_ids_raw, str):
                        try:
                            store_ids = json.loads(store_ids_raw)
                            # 兼容单个 JSON 数字的情况
                            if isinstance(store_ids, (int, float)):
                                store_ids = [int(store_ids)]
                        except:
                            # 如果不是合法 JSON，当成单个 ID
                            store_ids = [int(store_ids_raw)]
                    elif isinstance(store_ids_raw, (list, tuple)):
                        store_ids = list(store_ids_raw)
                    else:
                        # 兜底
                        store_ids = []
                except:
                    store_ids = []

            # 确保所有元素都是整数
            store_ids = [int(sid) for sid in store_ids if sid is not None]

            store_names = []
            if store_ids:
                placeholders = ",".join([f":sid_{i}" for i in range(len(store_ids))])
                sid_params = {f"sid_{i}": sid for i, sid in enumerate(store_ids)}
                store_rows = db.execute(
                    text(f"SELECT id, name, site FROM stores WHERE id IN ({placeholders})"),
                    sid_params
                ).fetchall()
                name_map = {r[0]: (r[1], r[2]) for r in store_rows}
                for sid in store_ids:
                    name, site = name_map.get(sid, ("", ""))
                    if site:
                        store_names.append(f"{name} - {site}")
                    else:
                        store_names.append(name)

            platform_products.append({
                "id": pp[0],
                "platform": pp[1],
                "store_ids": store_ids,
                "store_names": store_names,
                "platform_product_id": pp[3] or "",
                "asin": pp[4] or "",
                "spu": pp[5] or "",
                "sku": pp[6] or "",
                "title": pp[7] or "",
                "title_en": pp[8] or "",
                "image_url": pp[9] or "",
                "currency": pp[10] or "",
                "price": float(pp[11]) if pp[11] else None,
                "cost_price": float(pp[12]) if pp[12] else None,
                "status": pp[13],
                "sync_status": pp[14] or "",
                "created_at": pp[15].strftime("%Y-%m-%d %H:%M:%S") if pp[15] else "",
            })

        purchase_price = float(row[8]) if row[8] else None
        local_quantity = int(row[19]) if row[19] else 0
        # 计算货值 = 本地库存数量 × 采购价
        local_value = None
        if purchase_price and local_quantity is not None:
            local_value = purchase_price * local_quantity
        
        # 将逗号分隔的产品类型字符串转换为数组
        product_type_str = row[4] or ""
        product_type = product_type_str.split(",") if product_type_str else []
        
        product = {
            "id": row[0],
            "product_code": row[1] or "",
            "name": row[2],
            "name_en": row[3] or "",
            "product_type": product_type,
            "product_attribute": row[5] or "general",
            "category": row[6] or "",
            "brand": row[7] or "",
            "purchase_price": purchase_price,
            "sale_price": float(row[9]) if row[9] else None,
            "main_image": row[10] or "",
            "weight": float(row[11]) if row[11] else None,
            "length": float(row[12]) if row[12] else None,
            "width": float(row[13]) if row[13] else None,
            "height": float(row[14]) if row[14] else None,
            "status": row[15],
            "is_robot_monitored": bool(row[16]),
            "created_at": row[17].strftime("%Y-%m-%d %H:%M:%S") if row[17] else "",
            "config": row[18],
            "local_quantity": local_quantity,
            "local_warehouse": row[20] or "",
            "local_inbound_date": row[21].strftime("%Y-%m-%d") if row[21] else "",
            "local_stock_age": int(row[22]) if row[22] else None,
            "local_value": float(local_value) if local_value is not None else None,
            "platform_products": platform_products,
        }
        return {"success": True, "data": product}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取商品详情失败: {str(e)}")


@router.post("/")
async def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:create"))
):
    try:
        if product_data.product_code:
            exists = db.execute(
                text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"),
                {"code": product_data.product_code, "tid": current_user.tenant_id}
            ).fetchone()
            if exists:
                raise HTTPException(status_code=400, detail="商品编码已存在")

        # 将产品类型列表转换为逗号分隔的字符串
        product_type_str = ",".join(product_data.product_type) if product_data.product_type else None

        insert_sql = text("""
            INSERT INTO products (tenant_id, product_code, name, name_en, product_type, product_attribute, category, brand,
                                  purchase_price, sale_price, main_image, weight, length, width, height,
                                  status, is_robot_monitored, local_quantity, local_warehouse, local_inbound_date, local_stock_age)
            VALUES (:tenant_id, :product_code, :name, :name_en, :product_type, :product_attribute, :category, :brand,
                    :purchase_price, :sale_price, :main_image, :weight, :length, :width, :height,
                    :status, :is_robot_monitored, :local_quantity, :local_warehouse, :local_inbound_date, :local_stock_age)
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "product_code": product_data.product_code,
            "name": product_data.name,
            "name_en": product_data.name_en,
            "product_type": product_type_str,
            "product_attribute": product_data.product_attribute,
            "category": product_data.category,
            "brand": product_data.brand,
            "purchase_price": product_data.purchase_price,
            "sale_price": product_data.sale_price,
            "main_image": product_data.main_image,
            "weight": product_data.weight,
            "length": product_data.length,
            "width": product_data.width,
            "height": product_data.height,
            "status": product_data.status,
            "is_robot_monitored": product_data.is_robot_monitored,
            "local_quantity": product_data.local_quantity,
            "local_warehouse": product_data.local_warehouse,
            "local_inbound_date": product_data.local_inbound_date,
            "local_stock_age": product_data.local_stock_age,
        })
        db.commit()
        return {
            "success": True,
            "message": "商品创建成功",
            "data": {"id": result.lastrowid}
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建商品失败: {str(e)}")


@router.put("/{product_id}")
async def update_product(
    product_id: int,
    product_data: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:edit"))
):
    try:
        row = db.execute(
            text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="商品不存在")

        if product_data.product_code is not None:
            exists = db.execute(
                text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND id != :id AND deleted_at IS NULL"),
                {"code": product_data.product_code, "tid": current_user.tenant_id, "id": product_id}
            ).fetchone()
            if exists:
                raise HTTPException(status_code=400, detail="商品编码已存在")

        # 将产品类型列表转换为逗号分隔的字符串
        product_type_str = ",".join(product_data.product_type) if product_data.product_type else None

        updates = []
        params = {"id": product_id}
        field_map = {
            "product_code": product_data.product_code,
            "name": product_data.name,
            "name_en": product_data.name_en,
            "product_type": product_type_str,
            "product_attribute": product_data.product_attribute,
            "category": product_data.category,
            "brand": product_data.brand,
            "purchase_price": product_data.purchase_price,
            "sale_price": product_data.sale_price,
            "main_image": product_data.main_image,
            "weight": product_data.weight,
            "length": product_data.length,
            "width": product_data.width,
            "height": product_data.height,
            "status": product_data.status,
            "is_robot_monitored": product_data.is_robot_monitored,
            "local_quantity": product_data.local_quantity,
            "local_warehouse": product_data.local_warehouse,
            "local_inbound_date": product_data.local_inbound_date,
            "local_stock_age": product_data.local_stock_age,
        }
        for field, value in field_map.items():
            if value is not None:
                updates.append(f"{field} = :{field}")
                params[field] = value

        if updates:
            db.execute(
                text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                params
            )
            db.commit()

        return {"success": True, "message": "商品更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新商品失败: {str(e)}")


@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:delete"))
):
    try:
        row = db.execute(
            text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="商品不存在")

        db.execute(
            text("UPDATE products SET deleted_at = NOW() WHERE id = :id AND tenant_id = :tid"),
            {"id": product_id, "tid": current_user.tenant_id}
        )
        db.commit()
        return {"success": True, "message": "商品删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除商品失败: {str(e)}")


@router.get("/{product_id}/platform-products")
async def get_platform_products(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        product = db.execute(
            text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product:
            raise HTTPException(status_code=404, detail="商品不存在")

        import json

        query = text("""
            SELECT pp.id, pp.platform, pp.store_id,
                   pp.platform_product_id, pp.asin, pp.spu, pp.sku,
                   pp.title, pp.title_en, pp.image_url, pp.currency,
                   pp.price, pp.cost_price, pp.status, pp.sync_status, pp.created_at
            FROM platform_products pp
            WHERE pp.product_id = :product_id AND pp.deleted_at IS NULL
            ORDER BY pp.created_at DESC
        """)
        result = db.execute(query, {"product_id": product_id})
        items = []
        for pp in result:
            store_ids_raw = pp[2]
            store_ids = []
            if store_ids_raw:
                try:
                    if isinstance(store_ids_raw, (int, float)):
                        # 旧数据是单个 ID
                        store_ids = [int(store_ids_raw)]
                    elif isinstance(store_ids_raw, str):
                        try:
                            store_ids = json.loads(store_ids_raw)
                            # 兼容单个 JSON 数字的情况
                            if isinstance(store_ids, (int, float)):
                                store_ids = [int(store_ids)]
                        except:
                            # 如果不是合法 JSON，当成单个 ID
                            try:
                                store_ids = [int(store_ids_raw)]
                            except:
                                store_ids = []
                    elif isinstance(store_ids_raw, (list, tuple)):
                        store_ids = list(store_ids_raw)
                    else:
                        # 兜底
                        store_ids = []
                except:
                    store_ids = []

            # 确保所有元素都是整数
            store_ids = [int(sid) for sid in store_ids if sid is not None]

            store_names = []
            if store_ids:
                placeholders = ",".join([f":sid_{i}" for i in range(len(store_ids))])
                sid_params = {f"sid_{i}": sid for i, sid in enumerate(store_ids)}
                store_rows = db.execute(
                    text(f"SELECT id, name, site FROM stores WHERE id IN ({placeholders})"),
                    sid_params
                ).fetchall()
                name_map = {r[0]: (r[1], r[2]) for r in store_rows}
                for sid in store_ids:
                    name, site = name_map.get(sid, ("", ""))
                    if site:
                        store_names.append(f"{name} - {site}")
                    else:
                        store_names.append(name)

            items.append({
                "id": pp[0],
                "platform": pp[1],
                "store_ids": store_ids,
                "store_names": store_names,
                "platform_product_id": pp[3] or "",
                "asin": pp[4] or "",
                "spu": pp[5] or "",
                "sku": pp[6] or "",
                "title": pp[7] or "",
                "title_en": pp[8] or "",
                "image_url": pp[9] or "",
                "currency": pp[10] or "",
                "price": float(pp[11]) if pp[11] else None,
                "cost_price": float(pp[12]) if pp[12] else None,
                "status": pp[13],
                "sync_status": pp[14] or "",
                "created_at": pp[15].strftime("%Y-%m-%d %H:%M:%S") if pp[15] else "",
            })
        return {"success": True, "data": items}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取平台商品失败: {str(e)}")


@router.post("/{product_id}/platform-products")
async def create_platform_product(
    product_id: int,
    data: PlatformProductBatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("platform:create"))
):
    try:
        product = db.execute(
            text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product:
            raise HTTPException(status_code=404, detail="商品不存在")

        if not data.store_ids:
            raise HTTPException(status_code=400, detail="至少需要一个店铺")

        # 验证并标准化平台
        valid_platforms = {"amazon", "ebay", "walmart", "shopify", "shopee", "lazada", "tiktok", "other"}
        platform_aliases = {
            "tiktok shop": "tiktok",
        }
        platform = data.platform.strip().lower()
        normalized_platform = platform_aliases.get(platform, platform)
        if normalized_platform not in valid_platforms:
            raise HTTPException(status_code=400, detail=f"平台 '{data.platform}' 无效，有效平台: {', '.join(valid_platforms)}")

        import json
        insert_sql = text("""
            INSERT INTO platform_products (tenant_id, product_id, platform, store_id, platform_product_id,
                                           asin, spu, sku, title, title_en, image_url, currency,
                                           price, cost_price, status)
            VALUES (:tenant_id, :product_id, :platform, :store_id, :platform_product_id,
                    :asin, :spu, :sku, :title, :title_en, :image_url, :currency,
                    :price, :cost_price, :status)
        """)
        db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "product_id": product_id,
            "platform": normalized_platform,
            "store_id": json.dumps(data.store_ids),
            "platform_product_id": data.platform_product_id,
            "asin": data.asin,
            "spu": data.spu,
            "sku": data.sku,
            "title": data.title,
            "title_en": data.title_en,
            "image_url": data.image_url,
            "currency": data.currency,
            "price": data.price,
            "cost_price": data.cost_price,
            "status": data.status,
        })
        db.commit()
        return {"success": True, "message": "平台商品创建成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建平台商品失败: {str(e)}")


@router.put("/{product_id}/platform-products/{pp_id}")
async def update_platform_product(
    product_id: int,
    pp_id: int,
    data: PlatformProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("platform:edit"))
):
    try:
        row = db.execute(
            text("SELECT id FROM platform_products WHERE id = :id AND product_id = :pid AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": pp_id, "pid": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="平台商品不存在")

        updates = []
        params = {"id": pp_id}
        field_map = {
            "platform_product_id": data.platform_product_id,
            "asin": data.asin,
            "spu": data.spu,
            "sku": data.sku,
            "title": data.title,
            "title_en": data.title_en,
            "image_url": data.image_url,
            "currency": data.currency,
            "price": data.price,
            "cost_price": data.cost_price,
            "status": data.status,
        }
        for field, value in field_map.items():
            if value is not None:
                updates.append(f"{field} = :{field}")
                params[field] = value

        if data.store_ids is not None:
            import json
            updates.append("store_id = :store_id")
            params["store_id"] = json.dumps(data.store_ids)

        if data.extra_data is not None:
            import json
            updates.append("extra_data = :extra_data")
            params["extra_data"] = json.dumps(data.extra_data)

        if updates:
            db.execute(
                text(f"UPDATE platform_products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                params
            )
            db.commit()

        return {"success": True, "message": "平台商品更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新平台商品失败: {str(e)}")


@router.delete("/{product_id}/platform-products/{pp_id}")
async def delete_platform_product(
    product_id: int,
    pp_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("platform:delete"))
):
    try:
        row = db.execute(
            text("SELECT id FROM platform_products WHERE id = :id AND product_id = :pid AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": pp_id, "pid": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="平台商品不存在")

        db.execute(
            text("UPDATE platform_products SET deleted_at = NOW() WHERE id = :id"),
            {"id": pp_id}
        )
        db.commit()
        return {"success": True, "message": "平台商品删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除平台商品失败: {str(e)}")


@router.get("/template/download")
async def download_product_template(
    current_user: User = Depends(get_current_user)
):
    try:
        file_stream = create_product_excel_template()
        filename = f"产品导入模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
        return StreamingResponse(
            file_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


@router.post("/upload/preview")
async def upload_product_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:create"))
):
    try:
        file_bytes = await file.read()
        result = parse_product_excel(file_bytes, db, current_user.tenant_id)
        products = result.get("products", [])
        platform_products = result.get("platform_products", [])
        
        message = f"成功解析 {len(products)} 个产品"
        if platform_products:
            message += f"，{len(platform_products)} 个平台商品"
        
        return {"success": True, "data": {"products": products, "platform_products": platform_products}, "message": message}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析文件失败: {str(e)}")


class BatchProductImport(BaseModel):
    products: List[dict] = []
    platform_products: List[dict] = []


@router.post("/batch-import")
async def batch_import_products(
    data: BatchProductImport,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:create"))
):
    try:
        if not data.products and not data.platform_products:
            raise HTTPException(status_code=400, detail="没有可导入的数据")
        
        created = 0
        updated = 0
        platform_created = 0
        platform_updated = 0
        errors = []
        
        # 先处理产品导入
        product_code_to_id = {}
        
        for idx, item in enumerate(data.products):
            product_code = item.get("product_code", "").strip()
            name = item.get("name", "").strip()
            
            if not product_code or not name:
                errors.append(f"产品第 {idx + 1} 行: 产品编码或名称为空")
                continue
            
            existing = db.execute(
                text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"),
                {"code": product_code, "tid": current_user.tenant_id}
            ).fetchone()
            
            product_type_list = item.get("product_type")
            product_type_str = ",".join(product_type_list) if product_type_list and isinstance(product_type_list, list) else None
            
            if existing:
                updates = []
                params = {"id": existing[0]}
                field_map = {
                    "name": item.get("name"),
                    "name_en": item.get("name_en"),
                    "product_type": product_type_str,
                    "product_attribute": item.get("product_attribute"),
                    "category": item.get("category"),
                    "brand": item.get("brand"),
                    "purchase_price": item.get("purchase_price"),
                    "sale_price": item.get("sale_price"),
                    "main_image": item.get("main_image"),
                    "weight": item.get("weight"),
                    "length": item.get("length"),
                    "width": item.get("width"),
                    "height": item.get("height"),
                    "status": item.get("status"),
                }
                for field, value in field_map.items():
                    if value is not None:
                        updates.append(f"{field} = :{field}")
                        params[field] = value
                
                if updates:
                    db.execute(
                        text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                        params
                    )
                updated += 1
                product_code_to_id[product_code] = existing[0]
            else:
                insert_sql = text("""
                    INSERT INTO products (tenant_id, product_code, name, name_en, product_type, product_attribute,
                                          category, brand, purchase_price, sale_price, main_image,
                                          weight, length, width, height, status)
                    VALUES (:tenant_id, :product_code, :name, :name_en, :product_type, :product_attribute,
                            :category, :brand, :purchase_price, :sale_price, :main_image,
                            :weight, :length, :width, :height, :status)
                """)
                result = db.execute(insert_sql, {
                    "tenant_id": current_user.tenant_id,
                    "product_code": product_code,
                    "name": name,
                    "name_en": item.get("name_en"),
                    "product_type": product_type_str,
                    "product_attribute": item.get("product_attribute"),
                    "category": item.get("category"),
                    "brand": item.get("brand"),
                    "purchase_price": item.get("purchase_price"),
                    "sale_price": item.get("sale_price"),
                    "main_image": item.get("main_image"),
                    "weight": item.get("weight"),
                    "length": item.get("length"),
                    "width": item.get("width"),
                    "height": item.get("height"),
                    "status": item.get("status", "active"),
                })
                created += 1
                product_code_to_id[product_code] = result.lastrowid
        
        # 处理平台商品导入
        import json
        for idx, item in enumerate(data.platform_products):
            product_code = item.get("product_code", "").strip()
            platform = item.get("platform", "").strip()
            store_name = item.get("store_name", "").strip()
            store_site = item.get("store_site", "").strip() if item.get("store_site") else None
            
            store_names = item.get("store_names", [store_name] if store_name else [])
            store_sites = item.get("store_sites", [store_site] if store_site else [])
            if not store_names and store_name:
                store_names = [s.strip() for s in store_name.split("|") if s.strip()]
            if not store_sites and store_site:
                store_sites = [s.strip() for s in store_site.split("|") if s.strip()]
            if not store_sites:
                store_sites = [None] * len(store_names)
            
            if not product_code or not platform or not store_names:
                errors.append(f"平台商品第 {idx + 1} 行: 产品编码、平台或店铺名称为空")
                continue
            
            # 获取产品ID
            product_id = product_code_to_id.get(product_code)
            if not product_id:
                existing = db.execute(
                    text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"),
                    {"code": product_code, "tid": current_user.tenant_id}
                ).fetchone()
                if not existing:
                    errors.append(f"平台商品第 {idx + 1} 行: 产品编码 '{product_code}' 不存在")
                    continue
                product_id = existing[0]
                product_code_to_id[product_code] = product_id
            
            # 查找所有店铺ID
            store_ids = []
            for si in range(len(store_names)):
                sn = store_names[si].strip()
                ss = store_sites[si] if si < len(store_sites) and store_sites[si] else None
                if not sn:
                    continue
                
                store = None
                if ss:
                    store = db.execute(
                        text("SELECT id FROM stores WHERE name = :name AND site = :site AND tenant_id = :tid AND deleted_at IS NULL LIMIT 1"),
                        {"name": sn, "site": ss.strip() if ss else None, "tid": current_user.tenant_id}
                    ).fetchone()
                
                if not store:
                    store = db.execute(
                        text("SELECT id FROM stores WHERE name = :name AND tenant_id = :tid AND deleted_at IS NULL LIMIT 1"),
                        {"name": sn, "tid": current_user.tenant_id}
                    ).fetchone()
                
                if not store:
                    if ss:
                        errors.append(f"平台商品第 {idx + 1} 行: 店铺 '{sn}' - '{ss}' 不存在")
                    else:
                        errors.append(f"平台商品第 {idx + 1} 行: 店铺 '{sn}' 不存在")
                    continue
                store_ids.append(store[0])
            
            if not store_ids:
                errors.append(f"平台商品第 {idx + 1} 行: 未找到有效店铺")
                continue
            
            # 检查是否已存在相同的平台商品（产品+平台+完全相同的店铺集合）
            existing_platform = db.execute(
                text("""
                    SELECT id FROM platform_products 
                    WHERE product_id = :pid AND platform = :platform AND store_id = :store_id::jsonb 
                    AND tenant_id = :tid AND deleted_at IS NULL
                """),
                {"pid": product_id, "platform": platform, "store_id": json.dumps(store_ids), "tid": current_user.tenant_id}
            ).fetchone()
            
            if existing_platform:
                # 更新
                updates = []
                params = {"id": existing_platform[0]}
                field_map = {
                    "platform_product_id": item.get("platform_product_id"),
                    "asin": item.get("asin"),
                    "spu": item.get("spu"),
                    "sku": item.get("sku"),
                    "title": item.get("title"),
                    "title_en": item.get("title_en"),
                    "image_url": item.get("image_url"),
                    "currency": item.get("currency"),
                    "price": item.get("price"),
                    "cost_price": item.get("cost_price"),
                    "status": item.get("status"),
                }
                for field, value in field_map.items():
                    if value is not None:
                        updates.append(f"{field} = :{field}")
                        params[field] = value
                
                if updates:
                    db.execute(
                        text(f"UPDATE platform_products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                        params
                    )
                platform_updated += 1
            else:
                # 新建
                insert_sql = text("""
                    INSERT INTO platform_products (tenant_id, product_id, platform, store_id, platform_product_id,
                                                  asin, spu, sku, title, title_en, image_url, currency,
                                                  price, cost_price, status)
                    VALUES (:tenant_id, :product_id, :platform, :store_id, :platform_product_id,
                            :asin, :spu, :sku, :title, :title_en, :image_url, :currency,
                            :price, :cost_price, :status)
                """)
                db.execute(insert_sql, {
                    "tenant_id": current_user.tenant_id,
                    "product_id": product_id,
                    "platform": platform,
                    "store_id": json.dumps(store_ids),
                    "platform_product_id": item.get("platform_product_id"),
                    "asin": item.get("asin"),
                    "spu": item.get("spu"),
                    "sku": item.get("sku"),
                    "title": item.get("title"),
                    "title_en": item.get("title_en"),
                    "image_url": item.get("image_url"),
                    "currency": item.get("currency"),
                    "price": item.get("price"),
                    "cost_price": item.get("cost_price"),
                    "status": item.get("status", "active"),
                })
                platform_created += 1
        
        db.commit()
        
        result_msg = f"导入完成！产品新增 {created} 个，更新 {updated} 个"
        if data.platform_products:
            result_msg += f"；平台商品新增 {platform_created} 个，更新 {platform_updated} 个"
        if errors:
            result_msg += f"，{len(errors)} 条错误"
        
        return {
            "success": True,
            "message": result_msg,
            "data": {
                "products_created": created,
                "products_updated": updated,
                "platform_created": platform_created,
                "platform_updated": platform_updated,
                "errors": errors
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量导入失败: {str(e)}")


@router.post("/batch-update-missing")
async def batch_update_product_missing_data(
    data: BatchProductImport,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:edit"))
):
    try:
        if not data.items:
            raise HTTPException(status_code=400, detail="没有可更新的数据")
        
        updated_count = 0
        for item in data.items:
            product_id = item.get("id")
            if not product_id:
                continue
            
            product = db.execute(
                text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
                {"id": product_id, "tid": current_user.tenant_id}
            ).fetchone()
            if not product:
                continue
            
            updates = []
            params = {"id": product_id}
            
            for field in ["purchase_price", "sale_price", "weight", "length", "width", "height", "category", "brand"]:
                val = item.get(field)
                if val is not None:
                    updates.append(f"{field} = :{field}")
                    params[field] = val
            
            if updates:
                db.execute(
                    text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                    params
                )
                updated_count += 1
        
        db.commit()
        return {"success": True, "message": f"成功更新 {updated_count} 个产品数据", "data": {"updated": updated_count}}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量更新失败: {str(e)}")
