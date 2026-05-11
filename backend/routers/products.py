from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.database import get_db
from dependencies import get_current_user, get_current_admin_user
from models.user import User

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductCreate(BaseModel):
    store_id: int
    asin: str
    name: str
    sku: Optional[str] = None
    name_en: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    status: str = "active"
    is_robot_monitored: bool = True


class ProductUpdate(BaseModel):
    store_id: Optional[int] = None
    asin: Optional[str] = None
    name: Optional[str] = None
    sku: Optional[str] = None
    name_en: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    status: Optional[str] = None
    is_robot_monitored: Optional[bool] = None


@router.get("/")
async def get_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    store_id: Optional[int] = None,
    asin_search: Optional[str] = None,
    name_search: Optional[str] = None,
    sku_search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        where_conditions = ["p.tenant_id = :tenant_id"]
        params = {"tenant_id": current_user.tenant_id}

        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                dept_placeholders = ",".join([f":dept_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    params[f"dept_{i}"] = did
                where_conditions.append(f"s.department_id IN ({dept_placeholders})")
            else:
                where_conditions.append("1=0")

        if store_id is not None:
            where_conditions.append("p.store_id = :store_id")
            params["store_id"] = store_id

        if asin_search:
            where_conditions.append("p.asin LIKE :asin_search")
            params["asin_search"] = f"%{asin_search}%"

        if sku_search:
            where_conditions.append("p.sku LIKE :sku_search")
            params["sku_search"] = f"%{sku_search}%"

        if name_search:
            where_conditions.append("(p.name LIKE :name_search OR p.name_en LIKE :name_search)")
            params["name_search"] = f"%{name_search}%"

        where_clause = " AND ".join(where_conditions)

        count_query = text(f"""
            SELECT COUNT(DISTINCT p.id)
            FROM products p
            LEFT JOIN stores s ON p.store_id = s.id
            WHERE {where_clause}
        """)
        count_result = db.execute(count_query, params)
        total = count_result.scalar() or 0

        offset = (page - 1) * page_size
        params["offset"] = offset
        params["limit"] = page_size

        query = text(f"""
            SELECT p.id, p.store_id, s.name as store_name, p.asin, p.sku, p.name, p.name_en, 
                   p.image_url, p.category, p.brand, p.price, p.cost_price, p.status, 
                   p.is_robot_monitored, p.created_at, s.department_id, d.name as department_name
            FROM products p
            LEFT JOIN stores s ON p.store_id = s.id
            LEFT JOIN departments d ON s.department_id = d.id
            WHERE {where_clause}
            ORDER BY p.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        result = db.execute(query, params)
        products = []
        for row in result:
            products.append({
                "id": row[0],
                "store_id": row[1],
                "store_name": row[2],
                "asin": row[3],
                "sku": row[4] or "",
                "name": row[5],
                "name_en": row[6] or "",
                "image_url": row[7] or "",
                "category": row[8] or "",
                "brand": row[9] or "",
                "price": float(row[10]) if row[10] else 0,
                "cost_price": float(row[11]) if row[11] else 0,
                "status": row[12],
                "is_robot_monitored": bool(row[13]),
                "created_at": row[14].strftime("%Y-%m-%d %H:%M:%S") if row[14] else "",
                "department_id": row[15],
                "department_name": row[16] or "未分配",
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
        where_conditions = ["p.id = :product_id", "p.tenant_id = :tenant_id"]
        params = {"product_id": product_id, "tenant_id": current_user.tenant_id}

        if current_user.role != "admin":
            dept_ids = db.execute(
                text("SELECT department_id FROM user_departments WHERE user_id = :uid"),
                {"uid": current_user.id}
            ).fetchall()
            dept_id_list = [d[0] for d in dept_ids]
            if dept_id_list:
                dept_placeholders = ",".join([f":dept_{i}" for i in range(len(dept_id_list))])
                for i, did in enumerate(dept_id_list):
                    params[f"dept_{i}"] = did
                where_conditions.append(f"s.department_id IN ({dept_placeholders})")
            else:
                raise HTTPException(status_code=404, detail="商品不存在")

        where_clause = " AND ".join(where_conditions)
        query = text(f"""
            SELECT p.id, p.store_id, s.name as store_name, p.asin, p.sku, p.name, p.name_en, 
                   p.image_url, p.category, p.brand, p.price, p.cost_price, p.status, 
                   p.is_robot_monitored, p.created_at
            FROM products p
            LEFT JOIN stores s ON p.store_id = s.id
            WHERE {where_clause}
        """)
        result = db.execute(query, params)
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="商品不存在")

        product = {
            "id": row[0],
            "store_id": row[1],
            "store_name": row[2],
            "asin": row[3],
            "sku": row[4] or "",
            "name": row[5],
            "name_en": row[6] or "",
            "image_url": row[7] or "",
            "category": row[8] or "",
            "brand": row[9] or "",
            "price": float(row[10]) if row[10] else 0,
            "cost_price": float(row[11]) if row[11] else 0,
            "status": row[12],
            "is_robot_monitored": bool(row[13]),
            "created_at": row[14].strftime("%Y-%m-%d %H:%M:%S") if row[14] else "",
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
    current_user: User = Depends(get_current_admin_user)
):
    try:
        check = text("SELECT id FROM stores WHERE id = :store_id AND tenant_id = :tid")
        if not db.execute(check, {"store_id": product_data.store_id, "tid": current_user.tenant_id}).fetchone():
            raise HTTPException(status_code=404, detail="店铺不存在")

        insert_sql = text("""
            INSERT INTO products (tenant_id, store_id, asin, name, sku, name_en, image_url, category, brand, 
                                  price, cost_price, status, is_robot_monitored)
            VALUES (:tenant_id, :store_id, :asin, :name, :sku, :name_en, :image_url, :category, :brand,
                    :price, :cost_price, :status, :is_robot_monitored)
        """)
        result = db.execute(insert_sql, {
            "tenant_id": current_user.tenant_id,
            "store_id": product_data.store_id,
            "asin": product_data.asin,
            "name": product_data.name,
            "sku": product_data.sku,
            "name_en": product_data.name_en,
            "image_url": product_data.image_url,
            "category": product_data.category,
            "brand": product_data.brand,
            "price": product_data.price,
            "cost_price": product_data.cost_price,
            "status": product_data.status,
            "is_robot_monitored": product_data.is_robot_monitored
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
    current_user: User = Depends(get_current_admin_user)
):
    try:
        check = text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid")
        row = db.execute(check, {"id": product_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="商品不存在")

        if product_data.store_id is not None:
            store_check = text("SELECT id FROM stores WHERE id = :store_id AND tenant_id = :tid")
            if not db.execute(store_check, {"store_id": product_data.store_id, "tid": current_user.tenant_id}).fetchone():
                raise HTTPException(status_code=404, detail="店铺不存在")

        updates = []
        params = {"id": product_id}
        if product_data.store_id is not None:
            updates.append("store_id = :store_id")
            params["store_id"] = product_data.store_id
        if product_data.asin is not None:
            updates.append("asin = :asin")
            params["asin"] = product_data.asin
        if product_data.name is not None:
            updates.append("name = :name")
            params["name"] = product_data.name
        if product_data.sku is not None:
            updates.append("sku = :sku")
            params["sku"] = product_data.sku
        if product_data.name_en is not None:
            updates.append("name_en = :name_en")
            params["name_en"] = product_data.name_en
        if product_data.image_url is not None:
            updates.append("image_url = :image_url")
            params["image_url"] = product_data.image_url
        if product_data.category is not None:
            updates.append("category = :category")
            params["category"] = product_data.category
        if product_data.brand is not None:
            updates.append("brand = :brand")
            params["brand"] = product_data.brand
        if product_data.price is not None:
            updates.append("price = :price")
            params["price"] = product_data.price
        if product_data.cost_price is not None:
            updates.append("cost_price = :cost_price")
            params["cost_price"] = product_data.cost_price
        if product_data.status is not None:
            updates.append("status = :status")
            params["status"] = product_data.status
        if product_data.is_robot_monitored is not None:
            updates.append("is_robot_monitored = :is_robot_monitored")
            params["is_robot_monitored"] = product_data.is_robot_monitored

        if updates:
            update_sql = text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id")
            db.execute(update_sql, params)
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
    current_user: User = Depends(get_current_admin_user)
):
    try:
        db.execute(text("DELETE FROM products WHERE id = :id AND tenant_id = :tid"), {
            "id": product_id,
            "tid": current_user.tenant_id
        })
        db.commit()
        return {"success": True, "message": "商品删除成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除商品失败: {str(e)}")
