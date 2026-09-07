from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote
import json
from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.excel_helper import create_product_excel_template, parse_product_excel, get_custom_platforms
from services import excel_helper
from services.operation_log import (
    log_product_create, log_product_update, log_product_delete,
    log_platform_product_create, log_platform_product_update, log_platform_product_delete
)

router = APIRouter(prefix="/api/products", tags=["products"])


def _parse_json_images(value):
    """解析数据库 JSON 图片数组字段，兼容字符串或已解析列表。"""
    if not value:
        return []
    try:
        if isinstance(value, str):
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        if isinstance(value, (list, tuple)):
            return list(value)
    except Exception:
        pass
    return []


def _serialize_images(images: Optional[List[str]]) -> Optional[str]:
    """将图片数组序列化为 JSON 字符串存储，None/空列表统一存为 NULL。"""
    if not images:
        return None
    return json.dumps(images)


class ProductCreate(BaseModel):
    product_code: Optional[str] = None
    name: str
    name_en: Optional[str] = None
    product_type: Optional[List[str]] = None
    product_attribute: Optional[str] = "general"
    category: Optional[str] = None
    brand: Optional[str] = None
    supplier: Optional[str] = None
    purchase_price: Optional[float] = None
    sale_price: Optional[float] = None
    main_image: Optional[str] = None
    images: Optional[List[str]] = None
    video_url: Optional[str] = None
    weight: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    status: str = "active"
    is_robot_monitored: bool = True
    no_accessory: bool = False
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
    supplier: Optional[str] = None
    purchase_price: Optional[float] = None
    sale_price: Optional[float] = None
    main_image: Optional[str] = None
    images: Optional[List[str]] = None
    video_url: Optional[str] = None
    weight: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    status: Optional[str] = None
    is_robot_monitored: Optional[bool] = None
    no_accessory: Optional[bool] = None
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
    images: Optional[List[str]] = None
    description: Optional[str] = None
    bullet_points: Optional[str] = None
    keywords: Optional[str] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    status: str = "on_sale"


def _normalize_platform_status(status: Optional[str]) -> str:
    """统一平台商品状态值为在售/停售"""
    if not status:
        return "on_sale"
    s = str(status).strip().lower()
    if s in ("on_sale", "active", "在售", "启用"):
        return "on_sale"
    return "off_sale"


def _ensure_supplier(db: Session, tenant_id: int, supplier_name: Optional[str]) -> None:
    """如果供应商不存在则自动创建"""
    if not supplier_name or not supplier_name.strip():
        return
    name = supplier_name.strip()
    existing = db.execute(text("""
        SELECT id FROM suppliers WHERE tenant_id = :tid AND name = :name AND deleted_at IS NULL
    """), {"tid": tenant_id, "name": name}).fetchone()
    if not existing:
        db.execute(text("""
            INSERT INTO suppliers (tenant_id, name, created_at, updated_at)
            VALUES (:tid, :name, NOW(), NOW())
        """), {"tid": tenant_id, "name": name})


class PlatformProductUpdate(BaseModel):
    platform_product_id: Optional[str] = None
    asin: Optional[str] = None
    spu: Optional[str] = None
    sku: Optional[str] = None
    title: Optional[str] = None
    title_en: Optional[str] = None
    image_url: Optional[str] = None
    images: Optional[List[str]] = None
    description: Optional[str] = None
    bullet_points: Optional[str] = None
    keywords: Optional[str] = None
    currency: Optional[str] = None
    price: Optional[float] = None
    cost_price: Optional[float] = None
    status: Optional[str] = None
    store_ids: Optional[list[int]] = None
    extra_data: Optional[dict] = None


@router.get("/next-code")
async def get_next_product_code(
    product_type: str = Query(..., description="产品类型 finished/accessory"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """根据产品类型生成下一个产品编码（成品 BXHS-CP-##### / 配件 BXHS-PJ-#####）。"""
    prefix = "BXHS-CP-" if product_type == "finished" else "BXHS-PJ-"
    row = db.execute(
        text("""
            SELECT product_code FROM products
            WHERE tenant_id = :tid AND product_code LIKE :pat
            ORDER BY CAST(SUBSTRING(product_code, :pl) AS UNSIGNED) DESC
            LIMIT 1
        """),
        {"tid": current_user.tenant_id, "pat": f"{prefix}%", "pl": len(prefix) + 1},
    ).fetchone()
    next_num = 1
    if row and row[0]:
        suffix = str(row[0])[len(prefix):]
        digits = "".join(ch for ch in suffix if ch.isdigit())
        if digits:
            next_num = int(digits) + 1
    return {"code": f"{prefix}{next_num:05d}"}


@router.get("/incomplete-list")
async def get_incomplete_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    issue: str = Query("all", description="问题类型: all/missing_accessory/missing_price/missing_size"),
    keyword: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:read"))
):
    """数据补齐列表：缺采购价/尺寸或未绑配件的成品（服务端分页，只查必要字段）"""
    base_where = ["p.deleted_at IS NULL", "p.tenant_id = :tid"]
    params: dict = {"tid": current_user.tenant_id}
    if keyword:
        base_where.append("(p.product_code LIKE :kw OR p.name LIKE :kw)")
        params["kw"] = f"%{keyword}%"

    cond_price = "p.purchase_price IS NULL"
    cond_size = "(p.weight IS NULL OR p.length IS NULL OR p.width IS NULL OR p.height IS NULL)"
    cond_acc = """(
        p.product_type LIKE '%finished%'
        AND (p.no_accessory IS NULL OR p.no_accessory = 0)
        AND NOT EXISTS (
            SELECT 1 FROM product_bindings pb
            JOIN products acc ON acc.id = pb.accessory_product_id
            WHERE pb.finished_product_id = p.id AND pb.deleted_at IS NULL AND acc.deleted_at IS NULL
        )
    )"""
    issue_map = {
        "missing_price": cond_price,
        "missing_size": cond_size,
        "missing_accessory": cond_acc,
        "all": f"({cond_price} OR {cond_size} OR {cond_acc})",
    }
    where_sql = " AND ".join(base_where) + f" AND {issue_map.get(issue, issue_map['all'])}"

    try:
        total = db.execute(
            text(f"SELECT COUNT(*) FROM products p WHERE {where_sql}"), params
        ).scalar() or 0

        rows = db.execute(text(f"""
            SELECT p.id, p.product_code, p.name, p.product_type,
                   p.purchase_price, p.weight, p.length, p.width, p.height,
                   EXISTS (
                       SELECT 1 FROM product_bindings pb
                       JOIN products acc ON acc.id = pb.accessory_product_id
                       WHERE pb.finished_product_id = p.id AND pb.deleted_at IS NULL AND acc.deleted_at IS NULL
                   ) AS has_accessory
            FROM products p
            WHERE {where_sql}
            ORDER BY p.id DESC
            LIMIT :limit OFFSET :offset
        """), {**params, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()

        items = [
            {
                "id": r.id,
                "product_code": r.product_code,
                "name": r.name,
                "product_type": r.product_type,
                "purchase_price": r.purchase_price,
                "weight": r.weight,
                "length": r.length,
                "width": r.width,
                "height": r.height,
                "has_accessory": bool(r.has_accessory),
            }
            for r in rows
        ]
        return {"success": True, "data": {"items": items, "total": total, "page": page, "page_size": page_size}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取数据补齐列表失败: {str(e)}")


@router.get("/")
async def get_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=10000),
    search: Optional[str] = None,
    product_type: Optional[List[str]] = Query(None),
    product_attribute: Optional[str] = None,
    status: Optional[str] = None,
    hide_zero_stock: Optional[bool] = Query(False, description="隐藏库存为0的产品"),
    advanced_filters: Optional[str] = Query(None, description="高级筛选条件JSON"),
    sort_by: Optional[str] = Query(None, description="排序字段，如id, created_at, name"),
    sort_order: Optional[str] = Query(None, description="排序方向，asc或desc"),
    exclude_finished_with_accessories: Optional[bool] = Query(False, description="过滤掉绑定了配件的成品(用于入库单产品选择)"),
    around_product_id: Optional[int] = Query(None, description="以指定产品ID为中心加载前后产品"),
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

        if hide_zero_stock:
            where_conditions.append("""
                COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib
                  WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id
                  AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) > 0
            """)
        
        # 过滤绑定了配件的成品(用于入库单产品选择)
        # 注意：需要同时检查绑定记录和配件产品的删除状态
        if exclude_finished_with_accessories:
            where_conditions.append("""
                p.id NOT IN (
                    SELECT DISTINCT pb.finished_product_id 
                    FROM product_bindings pb
                    JOIN products acc ON acc.id = pb.accessory_product_id
                    WHERE pb.deleted_at IS NULL AND acc.deleted_at IS NULL
                )
            """)

        # 高级筛选条件
        selected_store_group_id = None
        if advanced_filters:
            import json
            try:
                adv = json.loads(advanced_filters)
                conditions_list = adv.get("conditions", [])
                match_mode = adv.get("match_mode", "all")
                if conditions_list:
                    adv_parts = []
                    for i, cond in enumerate(conditions_list):
                        field = cond.get("field", "")
                        operator = cond.get("operator", "eq")
                        value = cond.get("value", "")
                        extra_value = cond.get("extra_value", "")  # 用于 store_group_stock 的店铺分组ID
                        if field == "store_group_stock" and extra_value:
                            try:
                                selected_store_group_id = int(extra_value)
                            except ValueError:
                                pass
                        if not field or value == "":
                            continue

                        # 字段映射到SQL列/表达式
                        field_sql_map = {
                            "local_quantity": "COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0)",
                            "store_group_stock": "COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.store_group_id = :store_group_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0)",
                            "product_code": "p.product_code",
                            "name": "p.name",
                            "product_type": "p.product_type",
                            "category": "p.category",
                            "brand": "p.brand",
                            "local_value": "(p.purchase_price * COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0))",
                            "replenishment_quantity": "COALESCE((SELECT SUM(ri.quantity) FROM replenishment_items ri JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id WHERE ri.product_id = p.id AND ro.tenant_id = p.tenant_id AND ri.deleted_at IS NULL AND ro.deleted_at IS NULL AND ro.status IN ('pending','purchased')), 0)",
                            "purchased_quantity": "COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.product_id = p.id AND po.tenant_id = p.tenant_id AND poi.deleted_at IS NULL AND po.deleted_at IS NULL AND po.status != 'completed'), 0)",
                            "platform_count": "(SELECT COUNT(*) FROM platform_products pp WHERE pp.product_id = p.id AND pp.deleted_at IS NULL)",
                            "status": "p.status",
                        }

                        col_expr = field_sql_map.get(field, f"p.{field}")
                        param_name = f"adv_{field}_{i}"

                        # 特殊处理：store_group_stock 字段需要额外的 store_group_id 参数
                        # 由于 SQL 中使用了固定的 :store_group_id 参数名，需要动态替换
                        if field == "store_group_stock":
                            if not extra_value:
                                continue  # 如果没有选择店铺分组，跳过该条件
                            group_param_name = f"store_group_id_{i}"
                            # 替换 SQL 表达式中的参数名
                            col_expr = col_expr.replace(":store_group_id", f":{group_param_name}")
                            try:
                                params[group_param_name] = int(extra_value)
                            except ValueError:
                                continue  # 如果不是有效的分组ID，跳过该条件

                        # 操作符映射
                        if operator == "eq":
                            adv_parts.append(f"{col_expr} = :{param_name}")
                            params[param_name] = value
                        elif operator == "neq":
                            adv_parts.append(f"{col_expr} <> :{param_name}")
                            params[param_name] = value
                        elif operator == "gt":
                            try:
                                params[param_name] = float(value)
                                adv_parts.append(f"{col_expr} > :{param_name}")
                            except ValueError:
                                continue
                        elif operator == "gte":
                            try:
                                params[param_name] = float(value)
                                adv_parts.append(f"{col_expr} >= :{param_name}")
                            except ValueError:
                                continue
                        elif operator == "lt":
                            try:
                                params[param_name] = float(value)
                                adv_parts.append(f"{col_expr} < :{param_name}")
                            except ValueError:
                                continue
                        elif operator == "lte":
                            try:
                                params[param_name] = float(value)
                                adv_parts.append(f"{col_expr} <= :{param_name}")
                            except ValueError:
                                continue
                        elif operator == "contains":
                            adv_parts.append(f"{col_expr} LIKE :{param_name}")
                            params[param_name] = f"%{value}%"
                        elif operator == "not_contains":
                            adv_parts.append(f"{col_expr} NOT LIKE :{param_name}")
                            params[param_name] = f"%{value}%"

                    if adv_parts:
                        join_op = " AND " if match_mode == "all" else " OR "
                        where_conditions.append(f"({join_op.join(adv_parts)})")
            except json.JSONDecodeError as e:
                print(f"解析高级筛选JSON失败: {e}")
            except Exception as e:
                print(f"处理高级筛选条件失败: {e}")
                import traceback
                traceback.print_exc()

        where_clause = " AND ".join(where_conditions)

        count_query = text(f"""
            SELECT COUNT(p.id)
            FROM products p
            WHERE {where_clause}
        """)
        total = db.execute(count_query, params).scalar() or 0

        # 处理 around_product_id 参数：以指定产品为中心加载前后产品
        if around_product_id:
            # 先查询该产品的 product_code，用于按编码排序
            around_product = db.execute(
                text("SELECT product_code FROM products WHERE id = :id AND tenant_id = :tid"),
                {"id": around_product_id, "tid": current_user.tenant_id}
            ).fetchone()
            
            around_code = around_product[0] if around_product and around_product[0] else ""
            
            half_size = page_size // 2
            params["around_code"] = around_code
            params["upper_limit"] = half_size + 1
            params["lower_limit"] = half_size
            params["limit"] = page_size

            sg_quantity_expr = "NULL as store_group_quantity"
            if selected_store_group_id is not None:
                params["filtered_sg_id"] = selected_store_group_id
                sg_quantity_expr = "COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.store_group_id = :filtered_sg_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as store_group_quantity"

            # 用 UNION 合并产品编码比该产品大和小的各 half_size 个产品
            query = text(f"""
                SELECT * FROM (
                    (SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                            p.category, p.brand, p.supplier, p.purchase_price, p.sale_price,
                            p.main_image, p.images, p.video_url, p.weight, p.length, p.width, p.height,
                            p.status, p.is_robot_monitored, p.created_at,
                            (SELECT COUNT(*) FROM platform_products pp WHERE pp.product_id = p.id AND pp.deleted_at IS NULL) as platform_count,
                            COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as local_quantity,
                            {sg_quantity_expr},
                            p.local_warehouse, p.local_inbound_date, p.local_stock_age,
                            COALESCE((SELECT SUM(ri.quantity) FROM replenishment_items ri JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id WHERE ri.product_id = p.id AND ro.tenant_id = p.tenant_id AND ri.deleted_at IS NULL AND ro.deleted_at IS NULL AND ro.status IN ('pending','purchased')), 0) as replenishment_quantity,
                            COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.product_id = p.id AND po.tenant_id = p.tenant_id AND poi.deleted_at IS NULL AND po.deleted_at IS NULL AND po.status != 'completed'), 0) as purchased_quantity,
                            p.no_accessory
                     FROM products p
                     WHERE {where_clause} AND p.product_code >= :around_code
                     ORDER BY p.product_code ASC
                     LIMIT :upper_limit)
                    UNION
                    (SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                            p.category, p.brand, p.supplier, p.purchase_price, p.sale_price,
                            p.main_image, p.images, p.video_url, p.weight, p.length, p.width, p.height,
                            p.status, p.is_robot_monitored, p.created_at,
                            (SELECT COUNT(*) FROM platform_products pp WHERE pp.product_id = p.id AND pp.deleted_at IS NULL) as platform_count,
                            COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as local_quantity,
                            {sg_quantity_expr},
                            p.local_warehouse, p.local_inbound_date, p.local_stock_age,
                            COALESCE((SELECT SUM(ri.quantity) FROM replenishment_items ri JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id WHERE ri.product_id = p.id AND ro.tenant_id = p.tenant_id AND ri.deleted_at IS NULL AND ro.deleted_at IS NULL AND ro.status IN ('pending','purchased')), 0) as replenishment_quantity,
                            COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.product_id = p.id AND po.tenant_id = p.tenant_id AND poi.deleted_at IS NULL AND po.deleted_at IS NULL AND po.status != 'completed'), 0) as purchased_quantity,
                            p.no_accessory
                     FROM products p
                     WHERE {where_clause} AND p.product_code < :around_code
                     ORDER BY p.product_code DESC
                     LIMIT :lower_limit)
                ) AS combined
                ORDER BY product_code ASC
                LIMIT :limit
            """)
        else:
            offset = (page - 1) * page_size
            params["offset"] = offset
            params["limit"] = page_size

            # 构建排序条件：默认按成品优先、产品编码正序排序
            order_by_clause = "ORDER BY CASE WHEN p.product_type LIKE '%finished%' THEN 0 ELSE 1 END, p.product_code ASC"
            if sort_by:
                # 允许的排序字段（防止SQL注入）
                allowed_sort_fields = ['id', 'created_at', 'name', 'product_code', 'purchase_price', 'sale_price']
                if sort_by in allowed_sort_fields:
                    order_direction = "ASC" if sort_order == "asc" else "DESC"
                    if sort_by == 'id':
                        order_by_clause = f"ORDER BY p.id {order_direction}"
                    elif sort_by == 'created_at':
                        order_by_clause = f"ORDER BY p.created_at {order_direction}"
                    elif sort_by == 'name':
                        order_by_clause = f"ORDER BY p.name {order_direction}"
                    elif sort_by == 'product_code':
                        order_by_clause = f"ORDER BY p.product_code {order_direction}"
                    elif sort_by == 'purchase_price':
                        order_by_clause = f"ORDER BY p.purchase_price {order_direction} NULLS LAST"
                    elif sort_by == 'sale_price':
                        order_by_clause = f"ORDER BY p.sale_price {order_direction} NULLS LAST"

            sg_quantity_expr = "NULL as store_group_quantity"
            if selected_store_group_id is not None:
                params["filtered_sg_id"] = selected_store_group_id
                sg_quantity_expr = "COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.store_group_id = :filtered_sg_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as store_group_quantity"

            query = text(f"""
                SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                       p.category, p.brand, p.supplier, p.purchase_price, p.sale_price,
                       p.main_image, p.images, p.video_url, p.weight, p.length, p.width, p.height,
                       p.status, p.is_robot_monitored, p.created_at,
                       (SELECT COUNT(*) FROM platform_products pp WHERE pp.product_id = p.id AND pp.deleted_at IS NULL) as platform_count,
                       COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as local_quantity,
                       {sg_quantity_expr},
                       p.local_warehouse, p.local_inbound_date, p.local_stock_age,
                       COALESCE((SELECT SUM(ri.quantity) FROM replenishment_items ri JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id WHERE ri.product_id = p.id AND ro.tenant_id = p.tenant_id AND ri.deleted_at IS NULL AND ro.deleted_at IS NULL AND ro.status IN ('pending','purchased')), 0) as replenishment_quantity,
                       COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id WHERE poi.product_id = p.id AND po.tenant_id = p.tenant_id AND poi.deleted_at IS NULL AND po.deleted_at IS NULL AND po.status != 'completed'), 0) as purchased_quantity,
                       p.no_accessory
                FROM products p
                WHERE {where_clause}
                {order_by_clause}
                LIMIT :limit OFFSET :offset
            """)
        result = db.execute(query, params)
        products = []
        for row in result:
            purchase_price = float(row[9]) if row[9] else None
            local_quantity = int(row[22]) if row[22] else 0
            store_group_quantity = int(row[23]) if row[23] is not None else None
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
                "supplier": row[8] or "",
                "purchase_price": float(row[9]) if row[9] else None,
                "sale_price": float(row[10]) if row[10] else None,
                "main_image": row[11] or "",
                "images": _parse_json_images(row[12]),
                "video_url": row[13] or "",
                "weight": float(row[14]) if row[14] else None,
                "length": float(row[15]) if row[15] else None,
                "width": float(row[16]) if row[16] else None,
                "height": float(row[17]) if row[17] else None,
                "status": row[18],
                "is_robot_monitored": bool(row[19]),
                "created_at": row[20].strftime("%Y-%m-%d %H:%M:%S") if row[20] else "",
                "platform_count": int(row[21]) if row[21] else 0,
                "local_quantity": local_quantity,
                "store_group_quantity": store_group_quantity,
                "local_warehouse": row[24] or "",
                "local_inbound_date": row[25].strftime("%Y-%m-%d") if row[25] else "",
                "local_stock_age": int(row[26]) if row[26] else None,
                "local_value": float(local_value) if local_value is not None else None,
                "replenishment_quantity": int(row[27]) if row[27] else 0,
                "purchased_quantity": int(row[28]) if row[28] else 0,
                "no_accessory": bool(row[29]) if row[29] is not None else False,
            })
        
        # 计算筛选后所有数据的货值总合计
        total_value_query = text(f"""
            SELECT COALESCE(SUM(p.purchase_price * ib.total_quantity), 0) as total_value
            FROM products p
            LEFT JOIN (
                SELECT product_id, SUM(current_quantity) as total_quantity
                FROM inventory_batches
                WHERE tenant_id = :tenant_id AND status = 'active' AND current_quantity > 0 AND deleted_at IS NULL
                GROUP BY product_id
            ) ib ON ib.product_id = p.id
            WHERE {where_clause}
        """)
        total_value_result = db.execute(total_value_query, params).fetchone()
        total_value = float(total_value_result[0]) if total_value_result and total_value_result[0] else 0.0
        
        return {
            "success": True,
            "data": products,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
            "total_value": total_value
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取商品列表失败: {str(e)}")


@router.get("/export")
async def export_products(
    search: Optional[str] = None,
    product_type: Optional[List[str]] = Query(None),
    product_attribute: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导出产品列表为Excel"""
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
                ))
            """)
            params["search"] = f"%{search}%"

        if product_type and len(product_type) > 0:
            type_conditions = []
            for idx, pt in enumerate(product_type):
                param_name = f"ptype_{idx}"
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

        query = text(f"""
            SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                   p.category, p.brand, p.supplier, p.purchase_price, p.sale_price,
                   p.weight, p.length, p.width, p.height,
                   p.status, p.created_at,
                   (SELECT COUNT(*) FROM platform_products pp WHERE pp.product_id = p.id AND pp.deleted_at IS NULL) as platform_count,
                   COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as local_quantity,
                   p.local_warehouse
            FROM products p
            WHERE {where_clause}
            ORDER BY p.created_at DESC
        """)
        result = db.execute(query, params)
        rows = result.fetchall()

        # 组装数据
        product_type_map = {"finished": "成品", "accessory": "配件"}
        attribute_map = {"general": "通货", "custom": "定制品"}
        status_map = {"active": "启用", "inactive": "停用", "archived": "归档"}

        excel_data = []
        for row in rows:
            type_str = row[4] or ""
            type_display = ""
            if type_str:
                type_items = [product_type_map.get(t.strip(), t.strip()) for t in type_str.split(",") if t.strip()]
                type_display = ", ".join(type_items)

            product_code = row[1] or ""
            name = row[2] or ""
            name_en = row[3] or ""
            category = row[6] or ""
            brand = row[7] or ""
            supplier = row[8] or ""
            purchase_price = float(row[9]) if row[9] else 0
            sale_price = float(row[10]) if row[10] else 0
            local_qty = int(row[18]) if row[18] else 0
            local_value = purchase_price * local_qty
            platform_count = int(row[17]) if row[17] else 0

            excel_data.append({
                "产品编码": product_code,
                "产品名称": name,
                "英文名称": name_en,
                "产品类型": type_display,
                "产品属性": attribute_map.get(row[5], row[5] or ""),
                "分类": category,
                "品牌": brand,
                "供应商": supplier,
                "采购价": purchase_price,
                "建议售价": sale_price,
                "当前库存": local_qty,
                "货值": round(local_value, 2),
                "存放仓库": row[19] or "",
                "平台商品数": platform_count,
                "状态": status_map.get(row[15], row[15] or ""),
                "创建时间": row[16].strftime("%Y-%m-%d %H:%M:%S") if row[16] else "",
            })

        # 生成Excel
        import pandas as pd
        import io

        df = pd.DataFrame(excel_data)

        # 查询平台商品（第二页签）
        pp_excel_data = []
        if rows:
            product_ids = [r[0] for r in rows]
            placeholders = ",".join([f":pid{i}" for i in range(len(product_ids))])
            pp_params = {}
            for i, pid in enumerate(product_ids):
                pp_params[f"pid{i}"] = pid
            pp_params["tid"] = current_user.tenant_id

            pp_query = text(f"""
                SELECT p.product_code, p.name,
                       pp.platform, pp.platform_product_id, pp.asin, pp.spu, pp.sku,
                       pp.title, pp.title_en, pp.currency, pp.price, pp.cost_price,
                       pp.store_id, pp.status, pp.sync_status, pp.created_at
                FROM platform_products pp
                JOIN products p ON p.id = pp.product_id
                WHERE pp.product_id IN ({placeholders})
                  AND pp.tenant_id = :tid
                  AND pp.deleted_at IS NULL
                ORDER BY pp.product_id, pp.created_at DESC
            """)
            pp_result = db.execute(pp_query, pp_params)
            pp_rows = pp_result.fetchall()

            # 收集所有店铺ID，批量查询店铺名
            import json as json_lib
            all_store_ids = set()
            for pp in pp_rows:
                store_id_raw = pp[12]
                if store_id_raw:
                    try:
                        if isinstance(store_id_raw, (int, float)):
                            all_store_ids.add(int(store_id_raw))
                        elif isinstance(store_id_raw, str):
                            try:
                                parsed = json_lib.loads(store_id_raw)
                                if isinstance(parsed, list):
                                    for sid in parsed:
                                        all_store_ids.add(int(sid))
                                else:
                                    all_store_ids.add(int(parsed))
                            except:
                                all_store_ids.add(int(store_id_raw))
                        elif isinstance(store_id_raw, (list, tuple)):
                            for sid in store_id_raw:
                                all_store_ids.add(int(sid))
                    except:
                        pass

            # 批量查询店铺名
            store_name_map = {}
            if all_store_ids:
                store_placeholders = ",".join([f":sid{i}" for i in range(len(all_store_ids))])
                store_params = {}
                for i, sid in enumerate(all_store_ids):
                    store_params[f"sid{i}"] = sid
                store_params["tid2"] = current_user.tenant_id
                store_query = text(f"""
                    SELECT id, inventory_name, site FROM stores
                    WHERE id IN ({store_placeholders}) AND tenant_id = :tid2 AND deleted_at IS NULL
                """)
                store_result = db.execute(store_query, store_params)
                for sr in store_result:
                    store_name_map[sr[0]] = sr[1] or "店铺ID:" + str(sr[0])

            pp_status_map = {"on_sale": "在售", "off_sale": "停售", "active": "在售", "inactive": "停售", "archived": "停售"}
            sync_status_map = {"synced": "已同步", "pending": "待同步", "error": "同步失败"}
            for pp in pp_rows:
                # 解析店铺名
                store_names = []
                store_id_raw = pp[12]
                if store_id_raw:
                    try:
                        if isinstance(store_id_raw, (int, float)):
                            sids = [int(store_id_raw)]
                        elif isinstance(store_id_raw, str):
                            try:
                                parsed = json_lib.loads(store_id_raw)
                                sids = parsed if isinstance(parsed, list) else [int(parsed)]
                            except:
                                sids = [int(store_id_raw)]
                        elif isinstance(store_id_raw, (list, tuple)):
                            sids = list(store_id_raw)
                        else:
                            sids = []
                        for sid in sids:
                            sid_int = int(sid)
                            if sid_int in store_name_map:
                                store_names.append(store_name_map[sid_int])
                            else:
                                store_names.append(f"店铺ID:{sid_int}")
                    except:
                        pass
                store_names_str = ", ".join(store_names) if store_names else ""

                pp_excel_data.append({
                    "产品编码": pp[0] or "",
                    "产品名称": pp[1] or "",
                    "平台": pp[2] or "",
                    "店铺": store_names_str,
                    "平台商品ID": pp[3] or "",
                    "ASIN": pp[4] or "",
                    "SPU": pp[5] or "",
                    "SKU": pp[6] or "",
                    "标题": pp[7] or "",
                    "英文标题": pp[8] or "",
                    "币种": pp[9] or "",
                    "售价": float(pp[10]) if pp[10] else 0,
                    "成本价": float(pp[11]) if pp[11] else 0,
                    "状态": pp_status_map.get(pp[13], pp[13] or ""),
                    "同步状态": sync_status_map.get(pp[14], pp[14] or ""),
                    "创建时间": pp[15].strftime("%Y-%m-%d %H:%M:%S") if pp[15] else "",
                })

        # 生成BytesIO
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='产品列表')

            # 自动调整列宽 - 产品列表
            worksheet = writer.sheets['产品列表']
            for column_cells in worksheet.columns:
                column_letter = column_cells[0].column_letter
                max_length = max(
                    len(str(cell.value)) if cell.value is not None else 0
                    for cell in column_cells
                )
                adjusted_width = min(max(max_length + 2, 10), 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width

            # 平台商品页签
            df_pp = pd.DataFrame(pp_excel_data)
            df_pp.to_excel(writer, index=False, sheet_name='平台商品')

            # 自动调整列宽 - 平台商品
            worksheet_pp = writer.sheets['平台商品']
            for column_cells in worksheet_pp.columns:
                column_letter = column_cells[0].column_letter
                max_length = max(
                    len(str(cell.value)) if cell.value is not None else 0
                    for cell in column_cells
                )
                adjusted_width = min(max(max_length + 2, 10), 50)
                worksheet_pp.column_dimensions[column_letter].width = adjusted_width

        output.seek(0)
        filename = f"产品列表_{datetime.now().strftime('%Y%m%d')}.xlsx"
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
        )
    except Exception as e:
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"导出产品失败: {e}")
        raise HTTPException(status_code=500, detail=f"导出产品失败: {str(e)}")


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
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:create"))
):
    try:
        # 先读取文件内容，后台任务执行时 request body 已关闭
        file_bytes = await file.read()
        file_name = file.filename or f"产品导入_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        file_size = len(file_bytes)

        # 1. 创建导入记录，状态为 previewing
        result = db.execute(
            text("""
                INSERT INTO import_records (tenant_id, module, file_name, file_size, status,
                    preview_status, total_count, success_count, fail_count,
                    created_by, created_by_name, created_at)
                VALUES (:tid, :module, :fname, :fsize, 'pending', 'previewing',
                    0, 0, 0, :user_id, :user_name, NOW())
            """),
            {
                "tid": current_user.tenant_id,
                "module": "product",
                "fname": file_name,
                "fsize": file_size,
                "user_id": current_user.id,
                "user_name": current_user.nickname or current_user.username,
            }
        )
        record_id = result.lastrowid
        db.commit()

        # 2. 将解析任务放到后台处理，不阻塞请求
        if background_tasks is not None:
            background_tasks.add_task(
                _process_preview_task,
                record_id,
                file_bytes,
                file_name,
                current_user.tenant_id,
            )

        return {
            "success": True,
            "message": "文件已上传，正在后台解析，稍后可在导入记录中查看预览",
            "data": {"record_id": record_id, "file_name": file_name}
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")


def _process_preview_task(record_id, file_bytes, file_name, tenant_id):
    """后台解析 Excel 预览，结果保存到 import_records.preview_data
    存储全部数据用于最终导入，但前端预览只取前 50 条显示
    """
    from database.database import SessionLocal
    import json

    db = SessionLocal()
    try:
        # 解析 Excel（复用现有解析函数）
        result = parse_product_excel(file_bytes, db, tenant_id)
        products = result.get("products", [])
        platform_products = result.get("platform_products", [])
        total_count = len(products) + len(platform_products)

        # 存储全部数据，用于最终确认导入时完整读取
        preview_payload = {
            "products": products,
            "platform_products": platform_products,
            "file_name": file_name,
            "total_count": total_count,
        }
        preview_json = json.dumps(preview_payload, ensure_ascii=False)

        # 同时存储预览摘要（全量数据，供前端分页预览；preview_data 也保留一份用于最终导入）
        preview_summary = json.dumps({
            "products": products,
            "platform_products": platform_products,
            "file_name": file_name,
            "total_count": total_count,
        }, ensure_ascii=False)

        # 更新记录：preview_status = success，预览数据 + 摘要 + 条数
        db.execute(
            text("""
                UPDATE import_records SET
                    preview_status = 'success',
                    preview_data = :pdata,
                    preview_summary = :psummary,
                    preview_file_name = :pname,
                    total_count = :tcnt
                WHERE id = :rid AND tenant_id = :tid
            """),
            {
                "pdata": preview_json,
                "psummary": preview_summary,
                "pname": file_name,
                "tcnt": total_count,
                "rid": record_id,
                "tid": tenant_id,
            }
        )
        db.commit()
    except Exception as e:
        # 解析失败，标记为 failed 并保存错误信息
        try:
            err_json = json.dumps([f"解析失败: {str(e)}"], ensure_ascii=False)
            db.execute(
                text("""
                    UPDATE import_records SET
                        status = 'failed',
                        preview_status = 'failed',
                        error_details = :err
                    WHERE id = :rid AND tenant_id = :tid
                """),
                {"err": err_json, "rid": record_id, "tid": tenant_id}
            )
            db.commit()
        except:
            db.rollback()
    finally:
        db.close()


class BatchProductImport(BaseModel):
    products: List[dict] = []
    platform_products: List[dict] = []
    file_name: Optional[str] = None
    record_id: Optional[int] = None


@router.post("/batch-import")
async def batch_import_products(
    data: BatchProductImport,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:create"))
):
    try:
        import json as _json_batch

        # 如果只传了 record_id（前端只有预览摘要），从DB读取完整数据
        if data.record_id and (not data.products) and (not data.platform_products):
            full_row = db.execute(
                text("SELECT preview_data FROM import_records WHERE id = :rid AND tenant_id = :tid AND preview_status = 'success'"),
                {"rid": data.record_id, "tid": current_user.tenant_id}
            ).fetchone()
            if not full_row or not full_row[0]:
                raise HTTPException(status_code=400, detail="预览数据已过期或不存在，请重新上传")
            full = _json_batch.loads(full_row[0]) if isinstance(full_row[0], str) else full_row[0]
            data.products = full.get("products", [])
            data.platform_products = full.get("platform_products", [])
            data.file_name = data.file_name or full.get("file_name")

        if not data.products and not data.platform_products:
            raise HTTPException(status_code=400, detail="没有可导入的数据")

        total_count = len(data.products) + len(data.platform_products)
        file_name = data.file_name or f"产品导入_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

        # 1. 如果前端传入了 record_id，则复用同一条记录（之前由 upload/preview 创建）
        record_id = data.record_id
        existing_row = None
        if record_id is not None:
            existing_row = db.execute(
                text("""
                    SELECT id, status FROM import_records
                    WHERE id = :rid AND tenant_id = :tid AND module = :module
                """),
                {"rid": record_id, "tid": current_user.tenant_id, "module": "product"}
            ).fetchone()

        if existing_row:
            # 复用现有记录，状态变为 processing
            db.execute(
                text("""
                    UPDATE import_records SET
                        status = 'processing',
                        total_count = :tcnt,
                        success_count = 0,
                        fail_count = 0,
                        error_details = NULL,
                        file_name = :fname
                    WHERE id = :rid
                """),
                {"tcnt": total_count, "fname": file_name, "rid": record_id}
            )
            db.commit()
        else:
            # 1. 创建一条新的状态为 processing 的导入记录
            result = db.execute(
                text("""
                    INSERT INTO import_records (tenant_id, module, file_name, file_size, status,
                        total_count, success_count, fail_count, error_details,
                        created_by, created_by_name, created_at)
                    VALUES (:tid, :module, :fname, 0, 'processing',
                        :total, 0, 0, NULL, :user_id, :user_name, NOW())
                """),
                {
                    "tid": current_user.tenant_id,
                    "module": "product",
                    "fname": file_name,
                    "total": total_count,
                    "user_id": current_user.id,
                    "user_name": current_user.nickname or current_user.username,
                }
            )
            record_id = result.lastrowid
            db.commit()

        # 2. 立即返回任务ID给前端，后台异步处理
        background_tasks.add_task(
            _process_import_task,
            record_id,
            data.products,
            data.platform_products,
            current_user.tenant_id,
            current_user.id,
            current_user.nickname or current_user.username,
        )

        return {
            "success": True,
            "message": "导入任务已提交，正在后台处理",
            "data": {"record_id": record_id, "total_count": total_count}
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"提交导入任务失败: {str(e)}")


# ============ 后台处理函数 ============
def _process_import_task(record_id, products, platform_products, tenant_id, user_id, user_name):
    """在后台处理导入，优化：批量预取、批量写入，大幅减少数据库往返"""
    from database.database import SessionLocal
    import json

    db = SessionLocal()
    try:
        created = 0
        updated = 0
        platform_created = 0
        platform_updated = 0
        errors = []
        product_code_to_id = {}

        # ========== 1. 产品导入（优化：批量预取 + 批量写入） ==========
        if products:
            # 1a. 批量预取已存在的 product_code -> id 映射
            codes = [item.get("product_code", "").strip() for item in products if item.get("product_code", "").strip()]
            if codes:
                existing_map = db.execute(
                    text("SELECT product_code, id FROM products WHERE product_code IN :codes AND tenant_id = :tid AND deleted_at IS NULL"),
                    {"codes": tuple(codes), "tid": tenant_id}
                ).fetchall()
                for row in existing_map:
                    product_code_to_id[row[0]] = row[1]

            # 1b. 批量构建 INSERT 参数
            insert_rows = []
            update_codes = set()
            for idx, item in enumerate(products):
                product_code = item.get("product_code", "").strip()
                name = item.get("name", "").strip()
                if not product_code or not name:
                    errors.append(f"产品第 {idx + 1} 行: 产品编码或名称为空")
                    continue

                product_type_list = item.get("product_type")
                product_type_str = ",".join(product_type_list) if product_type_list and isinstance(product_type_list, list) else None

                params = {
                    "tenant_id": tenant_id,
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
                }
                insert_rows.append(params)
                if product_code in existing_map:
                    update_codes.add(product_code)
                else:
                    created += 1
                    # 新插入的也先占位，后续 SELECT 会拿到真实 ID
                    product_code_to_id[product_code] = None  # 占位

            # 1c. 分批批量执行 ON DUPLICATE KEY UPDATE（每 500 条一批）
            upsert_sql = text("""
                INSERT INTO products (tenant_id, product_code, name, name_en, product_type, product_attribute,
                                      category, brand, purchase_price, sale_price, main_image,
                                      weight, length, width, height, status, created_at, updated_at)
                VALUES (:tenant_id, :product_code, :name, :name_en, :product_type, :product_attribute,
                        :category, :brand, :purchase_price, :sale_price, :main_image,
                        :weight, :length, :width, :height, :status, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    name_en = VALUES(name_en),
                    product_type = VALUES(product_type),
                    product_attribute = VALUES(product_attribute),
                    category = VALUES(category),
                    brand = VALUES(brand),
                    purchase_price = VALUES(purchase_price),
                    sale_price = VALUES(sale_price),
                    main_image = VALUES(main_image),
                    weight = VALUES(weight),
                    length = VALUES(length),
                    width = VALUES(width),
                    height = VALUES(height),
                    status = VALUES(status),
                    deleted_at = NULL,
                    updated_at = NOW()
            """)
            PROD_BATCH_SIZE = 500
            total_prod = len(insert_rows)
            for batch_start in range(0, total_prod, PROD_BATCH_SIZE):
                batch = insert_rows[batch_start:batch_start + PROD_BATCH_SIZE]
                db.execute(upsert_sql, batch)
                db.commit()  # 每批提交一次

            # 1d. 一次性获取所有刚插入/更新的产品 ID（只查本次涉及的 code）
            fresh_codes = [p["product_code"] for p in insert_rows]
            if fresh_codes:
                # 如果条数太多，分批查
                final_ids_map = {}
                for cstart in range(0, len(fresh_codes), PROD_BATCH_SIZE):
                    cbatch = tuple(fresh_codes[cstart:cstart + PROD_BATCH_SIZE])
                    if not cbatch:
                        continue
                    crows = db.execute(
                        text("SELECT product_code, id FROM products WHERE product_code IN :codes AND tenant_id = :tid AND deleted_at IS NULL"),
                        {"codes": cbatch, "tid": tenant_id}
                    ).fetchall()
                    for code, pid in crows:
                        final_ids_map[code] = pid
                for code, pid in final_ids_map.items():
                    product_code_to_id[code] = pid

            updated = len(update_codes)

        # ========== 2. 平台商品导入（优化：批量预取 + 分批 upsert） ==========
        if platform_products:
            import json as _json

            # 2a. 收集所有需要的店铺名
            all_store_names = set()
            all_group_names = set()
            all_product_codes = set()

            for item in platform_products:
                store_name = item.get("store_name", "")
                store_names_raw = item.get("store_names", [])
                if not store_names_raw and store_name:
                    store_names_raw = [s.strip() for s in str(store_name).split("|") if s.strip()]
                for sn in store_names_raw:
                    sn = sn.strip() if sn else ""
                    if sn:
                        all_store_names.add(sn)
                        all_group_names.add(sn)
                pc = (item.get("product_code") or "").strip()
                if pc:
                    all_product_codes.add(pc)

            # 2b. 预取该租户下所有店铺 ID 映射（支持 inventory_name、name、shop_abbr，不区分大小写）
            # 直接查全量店铺，避免 IN 精确匹配因不可见字符/编码差异导致漏匹配
            store_cache = {}  # lower(name) -> id
            all_store_rows = db.execute(
                text("SELECT inventory_name, name, shop_abbr, id FROM stores WHERE tenant_id = :tid AND deleted_at IS NULL"),
                {"tid": tenant_id}
            ).fetchall()
            for inv_name, n, a, sid in all_store_rows:
                if inv_name:
                    store_cache[inv_name.strip().lower()] = sid
                if n and n.strip().lower() not in store_cache:
                    store_cache[n.strip().lower()] = sid
                if a and a.strip().lower() not in store_cache:
                    store_cache[a.strip().lower()] = sid

            # 2c. 预取该租户下所有 store_group 映射（通过 stores.group_id 直接关联，不区分大小写）
            group_cache = {}  # lower(group_name) -> list of store_ids
            group_rows = db.execute(
                text("""
                    SELECT sg.name, s.id
                    FROM store_groups sg
                    JOIN stores s ON sg.id = s.group_id
                    WHERE sg.tenant_id = :tid AND sg.deleted_at IS NULL
                      AND s.deleted_at IS NULL AND s.tenant_id = :tid
                """),
                {"tid": tenant_id}
            ).fetchall()
            for gname, sid in group_rows:
                    group_cache.setdefault(gname.strip().lower(), []).append(sid)

            # 2d. 批量预取所有 product_code -> product_id
            pp_code_to_id = dict(product_code_to_id)  # 继承已有的
            missing_codes = [c for c in all_product_codes if c not in pp_code_to_id]
            if missing_codes:
                code_rows = db.execute(
                    text("SELECT product_code, id FROM products WHERE product_code IN :codes AND tenant_id = :tid AND deleted_at IS NULL"),
                    {"codes": tuple(missing_codes), "tid": tenant_id}
                ).fetchall()
                for code, pid in code_rows:
                    pp_code_to_id[code] = pid

            # 2e. 逐行处理（纯内存，不再查DB）
            pp_insert_rows = []
            for idx, item in enumerate(platform_products):
                product_code = (item.get("product_code") or "").strip()
                platform = (item.get("platform") or "").strip()
                store_name_raw = item.get("store_name") or ""
                store_names_raw = item.get("store_names") or []
                if not store_names_raw and store_name_raw:
                    store_names_raw = [s.strip() for s in str(store_name_raw).split("|") if s.strip()]

                if not product_code or not platform or not store_names_raw:
                    errors.append(f"平台商品第 {idx + 2} 行: 产品编码、平台或店铺名称为空")
                    continue

                product_id = pp_code_to_id.get(product_code)
                if not product_id:
                    errors.append(f"平台商品第 {idx + 2} 行: 产品编码 '{product_code}' 不存在")
                    continue

                # 从缓存查找所有店铺ID（同一行内去重，避免相同店铺名重复报错）
                seen_names = set()
                unique_store_names = []
                for sn in store_names_raw:
                    s = sn.strip() if sn else ""
                    if s and s not in seen_names:
                        seen_names.add(s)
                        unique_store_names.append(s)

                store_ids = []
                missing_stores = []
                for sn in unique_store_names:
                    if sn.lower() in group_cache:
                        store_ids.extend(group_cache[sn.lower()])
                    elif sn.lower() in store_cache:
                        store_ids.append(store_cache[sn.lower()])
                    else:
                        missing_stores.append(sn)

                if missing_stores:
                    errors.append(f"平台商品第 {idx + 2} 行: 以下店铺不存在 - {', '.join(missing_stores)}")
                    continue

                store_ids = list(set(store_ids))
                if not store_ids:
                    continue

                store_id_json = _json.dumps(store_ids)
                pp_params = {
                    "tenant_id": tenant_id,
                    "product_id": product_id,
                    "platform": platform,
                    "store_id": store_id_json,
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
                    "status": _normalize_platform_status(item.get("status", "on_sale")),
                }
                pp_insert_rows.append(pp_params)

            # 2f. 分批写入（精确匹配：同 tenant+platform+sku+store_id 则更新，否则新增）
            # 不再依赖唯一索引，允许同一平台SKU对应多条记录（不同店铺/标题等）
            BATCH_SIZE = 500
            total_pp = len(pp_insert_rows)
            platform_created = 0
            platform_updated = 0

            for batch_start in range(0, total_pp, BATCH_SIZE):
                batch = pp_insert_rows[batch_start:batch_start + BATCH_SIZE]

                # 用 (platform, sku, store_id) 查找已存在的记录
                match_keys = []
                for row in batch:
                    sid_json = row.get("store_id") or "[]"
                    match_keys.append((row["platform"], row["sku"], sid_json))

                if match_keys:
                    placeholders = []
                    params_map = {"tid": tenant_id}
                    for i, (plat, sk, sid) in enumerate(match_keys):
                        placeholders.append(f"(:plat_{i}, :sku_{i}, :sid_{i})")
                        params_map[f"plat_{i}"] = plat
                        params_map[f"sku_{i}"] = sk
                        params_map[f"sid_{i}"] = sid

                    existing_rows = db.execute(text(f"""
                        SELECT id, platform, sku, store_id
                        FROM platform_products
                        WHERE tenant_id = :tid AND deleted_at IS NULL
                          AND (platform, sku, store_id) IN ({', '.join(placeholders)})
                    """), params_map).fetchall()

                    # 建立 (platform, sku, store_id) -> id 的映射
                    existing_map = {}
                    for eid, eplat, esk, esid in existing_rows:
                        existing_map[(eplat, esk, esid)] = eid
                else:
                    existing_map = {}

                update_list = []
                insert_list = []
                for row in batch:
                    key = (row["platform"], row["sku"], row.get("store_id") or "[]")
                    if key in existing_map:
                        row["_existing_id"] = existing_map[key]
                        update_list.append(row)
                    else:
                        insert_list.append(row)

                # 批量更新
                if update_list:
                    for urow in update_list:
                        db.execute(text("""
                            UPDATE platform_products SET
                                store_id = :store_id,
                                platform_product_id = :platform_product_id,
                                asin = :asin,
                                spu = :spu,
                                sku = :sku,
                                title = :title,
                                title_en = :title_en,
                                image_url = :image_url,
                                currency = :currency,
                                price = :price,
                                cost_price = :cost_price,
                                status = :status,
                                deleted_at = NULL,
                                updated_at = NOW()
                            WHERE id = :_existing_id
                        """), urow)
                    platform_updated += len(update_list)

                # 批量插入
                if insert_list:
                    pp_insert_sql = text("""
                        INSERT INTO platform_products (tenant_id, product_id, platform, store_id,
                                                        platform_product_id, asin, spu, sku, title,
                                                        title_en, image_url, currency, price, cost_price,
                                                        status, created_at, updated_at)
                        VALUES (:tenant_id, :product_id, :platform, :store_id,
                                :platform_product_id, :asin, :spu, :sku, :title,
                                :title_en, :image_url, :currency, :price, :cost_price,
                                :status, NOW(), NOW())
                    """)
                    db.execute(pp_insert_sql, insert_list)
                    platform_created += len(insert_list)

                db.commit()

        # ========== 3. 成品配件绑定关系（配件行填写绑定成品） - 优化：批量处理 ==========
        binding_created = 0
        bind_errors = []

        if products:
            # 3a. 收集所有需要绑定的成品编码（配件行中填写的成品编码）
            all_finished_codes = set()
            for item in products:
                bind_info = item.get("bind_accessories")
                if bind_info and isinstance(bind_info, list) and len(bind_info) > 0:
                    for bind_item in bind_info:
                        fin_code = bind_item.get("finished_code", "").strip()
                        if fin_code:
                            all_finished_codes.add(fin_code)

            # 3b. 批量查询所有成品产品ID（包含本次导入和数据库中已存在的）
            finished_code_to_id = {}
            if all_finished_codes:
                # 先从本次导入的product_code_to_id中查找
                for fin_code in all_finished_codes:
                    if fin_code in product_code_to_id:
                        finished_code_to_id[fin_code] = product_code_to_id[fin_code]

                # 再批量查询数据库中缺失的成品编码
                missing_codes = [c for c in all_finished_codes if c not in finished_code_to_id]
                if missing_codes:
                    # 分批查询，避免一次性查询太多
                    BATCH_SIZE = 500
                    for start in range(0, len(missing_codes), BATCH_SIZE):
                        batch_codes = tuple(missing_codes[start:start + BATCH_SIZE])
                        if not batch_codes:
                            continue
                        rows = db.execute(
                            text("SELECT product_code, id FROM products WHERE product_code IN :codes AND tenant_id = :tid AND deleted_at IS NULL"),
                            {"codes": batch_codes, "tid": tenant_id}
                        ).fetchall()
                        for code, pid in rows:
                            finished_code_to_id[code] = pid

            # 3c. 批量查询现有的配件绑定关系
            existing_bindings_map = {}  # (finished_id, accessory_id) -> binding_id
            # 获取所有配件ID
            all_accessory_ids = [product_code_to_id.get(item.get("product_code", "").strip()) for item in products if item.get("bind_accessories")]
            all_accessory_ids = [aid for aid in all_accessory_ids if aid]  # 过滤掉None

            if all_accessory_ids and finished_code_to_id:
                # 分批查询现有绑定关系
                BATCH_SIZE = 500
                for start in range(0, len(all_accessory_ids), BATCH_SIZE):
                    batch_ids = tuple(all_accessory_ids[start:start + BATCH_SIZE])
                    if not batch_ids:
                        continue
                    rows = db.execute(
                        text("SELECT finished_product_id, accessory_product_id, id FROM product_bindings WHERE accessory_product_id IN :ids AND deleted_at IS NULL"),
                        {"ids": batch_ids}
                    ).fetchall()
                    for fid, aid, bid in rows:
                        existing_bindings_map[(fid, aid)] = bid

            # 3d. 批量构建绑定数据（避免逐条查询）
            bindings_to_insert = []
            bindings_to_update = []

            for item in products:
                bind_info = item.get("bind_accessories")
                if not bind_info or not isinstance(bind_info, list) or len(bind_info) == 0:
                    continue

                accessory_code = item.get("product_code", "").strip()
                accessory_id = product_code_to_id.get(accessory_code)
                if not accessory_id:
                    continue

                for bind_item in bind_info:
                    fin_code = bind_item.get("finished_code", "").strip()
                    acc_qty = bind_item.get("quantity", 1)
                    if not fin_code:
                        continue

                    finished_id = finished_code_to_id.get(fin_code)
                    if not finished_id:
                        bind_errors.append(f"配件 '{accessory_code}' 绑定的成品 '{fin_code}' 不存在")
                        continue

                    if finished_id == accessory_id:
                        bind_errors.append(f"产品 '{accessory_code}' 不能绑定自己")
                        continue

                    key = (finished_id, accessory_id)
                    existing_id = existing_bindings_map.get(key)

                    if existing_id:
                        bindings_to_update.append({
                            "id": existing_id,
                            "quantity": acc_qty,
                            "now": datetime.now()
                        })
                    else:
                        bindings_to_insert.append({
                            "finished_id": finished_id,
                            "accessory_id": accessory_id,
                            "quantity": acc_qty,
                            "now": datetime.now()
                        })

            # 3e. 批量插入新绑定关系（每1000条一批）
            if bindings_to_insert:
                BATCH_SIZE = 1000
                insert_sql = text("""
                    INSERT INTO product_bindings (finished_product_id, accessory_product_id, quantity, created_at, updated_at)
                    VALUES (:finished_id, :accessory_id, :quantity, :now, :now)
                """)
                for start in range(0, len(bindings_to_insert), BATCH_SIZE):
                    batch = bindings_to_insert[start:start + BATCH_SIZE]
                    db.execute(insert_sql, batch)
                    db.commit()
                binding_created += len(bindings_to_insert)

            # 3f. 批量更新现有绑定关系（每1000条一批）
            if bindings_to_update:
                BATCH_SIZE = 1000
                update_sql = text("UPDATE product_bindings SET quantity = :quantity, updated_at = :now WHERE id = :id")
                for start in range(0, len(bindings_to_update), BATCH_SIZE):
                    batch = bindings_to_update[start:start + BATCH_SIZE]
                    db.execute(update_sql, batch)
                    db.commit()
                binding_created += len(bindings_to_update)

        # 记录批量导入操作日志
        try:
            from services.operation_log import write_log
            import_summary = f"产品新增{created}个，更新{updated}个；平台商品新增约{platform_created}个，更新约{platform_updated}个"
            if binding_created > 0:
                import_summary += f"；配件绑定{binding_created}条"
            if errors:
                import_summary += f"；{len(errors)}条错误"
            write_log(
                db, tenant_id, user_id, user_name,
                "product", "batch_import", "batch_import",
                len(products) + len(platform_products),
                f"共{len(products) + len(platform_products)}条",
                after_data={"products_count": len(products), "platform_products_count": len(platform_products)},
                summary=f"{user_name}批量导入了产品数据，{import_summary}",
                commit=True
            )
        except Exception as log_err:
            pass  # 日志记录失败不影响主流程

        # 更新 import_records 表（含产品/平台商品分类统计）
        try:
            total_count = len(products) + len(platform_products)
            product_total = len(products)
            platform_total = len(platform_products)
            product_success = created + updated
            platform_success = platform_created + platform_updated
            success_count = product_success + platform_success

            # 分离错误：产品错误 vs 平台商品/绑定错误
            product_errors = [e for e in errors if not e.startswith("平台商品")]
            platform_errors = [e for e in errors if e.startswith("平台商品")] + bind_errors

            # actual_fail 必须包含所有错误（含绑定错误）
            all_errors = errors + bind_errors
            actual_fail = len(all_errors) if all_errors else (total_count - success_count if total_count > success_count else 0)

            final_status = "success"
            if actual_fail > 0 and actual_fail >= total_count:
                final_status = "failed"
            elif actual_fail > 0:
                final_status = "partial_success"

            error_details_json = json.dumps({
                "product_errors": product_errors,
                "platform_errors": platform_errors,
            }, ensure_ascii=False) if (errors or bind_errors) else None

            db.execute(
                text("""
                    UPDATE import_records SET
                        status = :status,
                        success_count = :success,
                        fail_count = :fail,
                        product_total = :product_total,
                        product_success = :product_success,
                        platform_total = :platform_total,
                        platform_success = :platform_success,
                        error_details = :err_details
                    WHERE id = :rid AND tenant_id = :tid
                """),
                {
                    "status": final_status,
                    "success": success_count,
                    "fail": actual_fail,
                    "product_total": product_total,
                    "product_success": product_success,
                    "platform_total": platform_total,
                    "platform_success": platform_success,
                    "err_details": error_details_json,
                    "rid": record_id,
                    "tid": tenant_id,
                }
            )
            db.commit()
        except Exception as import_err:
            db.rollback()
            # 强制更新状态为failed，确保前端能看到最终状态
            max_retry = 3
            for attempt in range(max_retry):
                try:
                    db.execute(
                        text("UPDATE import_records SET status = 'failed', error_details = :err WHERE id = :rid AND tenant_id = :tid"),
                        {"err": f"记录保存失败: {str(import_err)}", "rid": record_id, "tid": tenant_id}
                    )
                    db.commit()
                    break  # 成功则跳出循环
                except Exception as retry_err:
                    if attempt == max_retry - 1:
                        # 最后一次尝试也失败，记录日志但不阻塞
                        import logging
                        logging.error(f"Failed to update import record status after {max_retry} attempts: {retry_err}")
                    else:
                        # 重新获取数据库连接
                        db.rollback()
                        continue
    except Exception as e:
        db.rollback()
        # 强制更新状态为failed，确保前端能看到最终状态
        max_retry = 3
        for attempt in range(max_retry):
            try:
                db.execute(
                    text("UPDATE import_records SET status = 'failed', error_details = :err WHERE id = :rid AND tenant_id = :tid"),
                    {"err": f"处理失败: {str(e)}", "rid": record_id, "tid": tenant_id}
                )
                db.commit()
                break  # 成功则跳出循环
            except Exception as retry_err:
                if attempt == max_retry - 1:
                    # 最后一次尝试也失败，记录日志但不阻塞
                    import logging
                    logging.error(f"Failed to update import record status after {max_retry} attempts: {retry_err}")
                else:
                    # 重新获取数据库连接
                    db.rollback()
                    continue
    finally:
        db.close()


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


@router.post("/batch-delete")
async def batch_delete_products(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:delete"))
):
    try:
        ids = data.get("ids", [])
        if not ids or not isinstance(ids, list):
            raise HTTPException(status_code=400, detail="请选择要删除的产品")
        
        placeholders = ",".join([f":id_{i}" for i in range(len(ids))])
        params = {f"id_{i}": pid for i, pid in enumerate(ids)}
        params["tid"] = current_user.tenant_id
        
        rows = db.execute(
            text(f"""
                SELECT id, product_code, name, product_type FROM products 
                WHERE id IN ({placeholders}) AND tenant_id = :tid AND deleted_at IS NULL
            """),
            params
        ).fetchall()
        
        if not rows:
            return {"success": True, "message": "没有可删除的产品", "data": {"deleted": 0}}
        
        deleted_count = len(rows)
        from services.operation_log import log_product_delete
        
        for row in rows:
            db.execute(
                text("UPDATE products SET deleted_at = NOW() WHERE id = :id AND tenant_id = :tid"),
                {"id": row[0], "tid": current_user.tenant_id}
            )
            # 清理该产品的配件绑定关系（作为成品或作为配件）
            db.execute(
                text("""
                    UPDATE product_bindings SET deleted_at = NOW()
                    WHERE (finished_product_id = :pid OR accessory_product_id = :pid)
                    AND deleted_at IS NULL
                """),
                {"pid": row[0]}
            )
            log_product_delete(
                db, current_user.tenant_id, current_user.id,
                current_user.nickname or current_user.username,
                row[0], row[1] or "", row[2] or "",
                {"product_code": row[1], "name": row[2], "product_type": row[3]}
            )
        
        db.commit()
        return {"success": True, "message": f"成功删除 {deleted_count} 个产品", "data": {"deleted": deleted_count}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量删除失败: {str(e)}")


@router.post("/batch-bind-accessory")
async def batch_bind_accessories(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:edit"))
):
    try:
        finished_product_ids = data.get("finished_product_ids", [])
        accessory_ids = data.get("accessory_ids", [])
        quantity = data.get("quantity", 1)
        
        if not finished_product_ids or not isinstance(finished_product_ids, list):
            raise HTTPException(status_code=400, detail="请选择成品")
        if not accessory_ids or not isinstance(accessory_ids, list):
            raise HTTPException(status_code=400, detail="请选择要绑定的配件")
        
        # 查找所有成品
        fp_placeholders = ",".join([f":fid_{i}" for i in range(len(finished_product_ids))])
        fp_params = {f"fid_{i}": pid for i, pid in enumerate(finished_product_ids)}
        fp_params["tid"] = current_user.tenant_id
        
        finished_rows = db.execute(
            text(f"""
                SELECT id, product_code, name FROM products 
                WHERE id IN ({fp_placeholders}) AND tenant_id = :tid AND deleted_at IS NULL
            """),
            fp_params
        ).fetchall()
        
        if not finished_rows:
            return {"success": True, "message": "没有可绑定的成品", "data": {"bound": 0}}
        
        # 查找所有配件
        acc_placeholders = ",".join([f":aid_{i}" for i in range(len(accessory_ids))])
        acc_params = {f"aid_{i}": pid for i, pid in enumerate(accessory_ids)}
        acc_params["tid"] = current_user.tenant_id
        
        accessory_rows = db.execute(
            text(f"""
                SELECT id, product_code, name FROM products 
                WHERE id IN ({acc_placeholders}) AND tenant_id = :tid AND deleted_at IS NULL
            """),
            acc_params
        ).fetchall()
        
        if not accessory_rows:
            return {"success": True, "message": "没有可绑定的配件", "data": {"bound": 0}}
        
        bound_count = 0
        skip_count = 0
        from datetime import datetime
        
        # 对每个成品，绑定所有配件
        for fp in finished_rows:
            for acc in accessory_rows:
                if fp[0] == acc[0]:
                    skip_count += 1
                    continue
                
                existing = db.execute(
                    text("SELECT id FROM product_bindings WHERE finished_product_id = :fid AND accessory_product_id = :aid AND deleted_at IS NULL"),
                    {"fid": fp[0], "aid": acc[0]}
                ).fetchone()
                
                if existing:
                    db.execute(
                        text("UPDATE product_bindings SET quantity = :qty, updated_at = :now WHERE id = :id"),
                        {"qty": quantity, "now": datetime.now(), "id": existing[0]}
                    )
                else:
                    db.execute(
                        text("""
                            INSERT INTO product_bindings (finished_product_id, accessory_product_id, quantity, created_at, updated_at)
                            VALUES (:fid, :aid, :qty, :now, :now)
                        """),
                        {"fid": fp[0], "aid": acc[0], "qty": quantity, "now": datetime.now()}
                    )
                bound_count += 1
        
        db.commit()
        
        msg = f"成功给 {len(finished_rows)} 个成品绑定 {len(accessory_rows)} 个配件，共 {bound_count} 条绑定关系"
        if skip_count > 0:
            msg += f"，跳过 {skip_count} 条（自身或重复）"
        return {"success": True, "message": msg, "data": {"bound": bound_count, "skipped": skip_count}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量绑定失败: {str(e)}")


@router.get("/import-records/{record_id}/status")
async def get_import_record_status(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:read"))
):
    """查询单个导入任务的处理状态（轻量，不读预览数据，用于轮询）"""
    try:
        row = db.execute(
            text("""
                SELECT id, status, total_count, success_count, fail_count, error_details,
                       created_at, preview_status, preview_file_name,
                       product_total, product_success, platform_total, platform_success
                FROM import_records
                WHERE id = :rid AND tenant_id = :tid
            """),
            {"rid": record_id, "tid": current_user.tenant_id}
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="记录不存在")

        error_details = row[5]
        errors_list = []
        if error_details:
            try:
                import json as _j
                parsed = _j.loads(error_details) if isinstance(error_details, str) else error_details
                if isinstance(parsed, dict):
                    # 新格式：{product_errors: [...], platform_errors: [...]}
                    errors_list = parsed.get("product_errors", []) + parsed.get("platform_errors", [])
                elif isinstance(parsed, list):
                    errors_list = parsed[:50]
                else:
                    errors_list = [str(error_details)][:50]
            except:
                errors_list = [str(error_details)][:50]

        return {
            "success": True,
            "data": {
                "id": row[0],
                "status": row[1],
                "total_count": row[2] or 0,
                "success_count": row[3] or 0,
                "fail_count": row[4] or 0,
                "errors": errors_list,
                "created_at": str(row[6]) if row[6] else None,
                "preview_status": row[7],
                "preview_file_name": row[8],
                # 分类统计
                "product_total": row[9] or 0,
                "product_success": row[10] or 0,
                "platform_total": row[11] or 0,
                "platform_success": row[12] or 0,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询状态失败: {str(e)}")


@router.get("/import-records/{record_id}/preview-data")
async def get_import_record_preview_data(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:read"))
):
    """获取导入记录的完整预览数据（用于"查看预览"弹窗，会读大字段，可能耗时几秒）"""
    try:
        row = db.execute(
            text("""
                SELECT id, preview_status, preview_summary, preview_file_name
                FROM import_records
                WHERE id = :rid AND tenant_id = :tid
            """),
            {"rid": record_id, "tid": current_user.tenant_id}
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="记录不存在")

        preview_status = row[1]
        products = []
        platform_products = []
        preview_file_name = row[3]

        if preview_status == 'success' and row[2]:
            try:
                import json as _j2
                raw = _j2.loads(row[2]) if isinstance(row[2], str) else row[2]
                if raw:
                    products = raw.get("products", [])
                    platform_products = raw.get("platform_products", [])
                    preview_file_name = raw.get("file_name") or preview_file_name
                    # 添加total_count字段，如果没有则计算
                    total_count = raw.get("total_count") or (len(products) + len(platform_products))
            except:
                pass

        # 如果没有从preview_summary获取到total_count，则计算
        if 'total_count' not in dir():
            total_count = len(products) + len(platform_products)

        return {
            "success": True,
            "data": {
                "id": row[0],
                "preview_status": preview_status,
                "products": products,
                "platform_products": platform_products,
                "preview_file_name": preview_file_name,
                "total_count": total_count,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取预览数据失败: {str(e)}")


@router.get("/import-records")
async def get_import_records(
    status: Optional[str] = None,
    created_by: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:view")),
):
    try:
        conditions = ["tenant_id = :tid", "module = :module"]
        params = {"tid": current_user.tenant_id, "module": "product"}
        
        if status:
            conditions.append("status = :status")
            params["status"] = status
        
        if created_by:
            conditions.append("created_by_name LIKE :created_by")
            params["created_by"] = f"%{created_by}%"
        
        if start_date:
            conditions.append("DATE(created_at) >= :start_date")
            params["start_date"] = start_date
        
        if end_date:
            conditions.append("DATE(created_at) <= :end_date")
            params["end_date"] = end_date
        
        where_sql = " AND ".join(conditions)
        
        count_sql = text(f"SELECT COUNT(*) FROM import_records WHERE {where_sql}")
        total = db.execute(count_sql, params).fetchone()[0]
        
        list_sql = text(f"""
            SELECT id, file_name, file_size, status, total_count, success_count,
                   fail_count, created_by_name, created_at, preview_status,
                   product_total, product_success, platform_total, platform_success
            FROM import_records
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT :offset, :page_size
        """)
        params["offset"] = (page - 1) * page_size
        params["page_size"] = page_size

        rows = db.execute(list_sql, params).fetchall()

        records = []
        for row in rows:
            records.append({
                "id": row[0],
                "file_name": row[1],
                "file_size": row[2],
                "status": row[3],
                "total_count": row[4],
                "success_count": row[5],
                "fail_count": row[6],
                "created_by": row[7],
                "created_at": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else None,
                "preview_status": row[9],
                "product_total": row[10] or 0,
                "product_success": row[11] or 0,
                "platform_total": row[12] or 0,
                "platform_success": row[13] or 0,
            })
        
        return {
            "success": True,
            "message": "查询成功",
            "data": {
                "total": total,
                "page": page,
                "page_size": page_size,
                "list": records,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询导入记录失败: {str(e)}")


@router.get("/import-records/{record_id}")
async def get_import_record_detail(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("product:view")),
):
    try:
        row = db.execute(
            text("""
                SELECT id, file_name, file_size, status, total_count, success_count,
                       fail_count, error_details, created_by_name, created_at,
                       preview_status, preview_file_name,
                       product_total, product_success, platform_total, platform_success
                FROM import_records
                WHERE id = :id AND tenant_id = :tid AND module = :module
            """),
            {"id": record_id, "tid": current_user.tenant_id, "module": "product"}
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="记录不存在")

        import json
        raw_error_details = row[7]
        error_details = None
        product_errors = []
        platform_errors = []
        if raw_error_details:
            try:
                parsed = json.loads(raw_error_details)
                if isinstance(parsed, dict):
                    product_errors = parsed.get("product_errors", [])
                    platform_errors = parsed.get("platform_errors", [])
                    error_details = parsed
                elif isinstance(parsed, list):
                    error_details = parsed
                else:
                    error_details = [raw_error_details]
            except Exception:
                error_details = [raw_error_details]

        return {
            "success": True,
            "message": "查询成功",
            "data": {
                "id": row[0],
                "file_name": row[1],
                "file_size": row[2],
                "status": row[3],
                "total_count": row[4],
                "success_count": row[5],
                "fail_count": row[6],
                "error_details": error_details,
                "product_errors": product_errors,
                "platform_errors": platform_errors,
                "created_by": row[8],
                "created_at": row[9].strftime("%Y-%m-%d %H:%M:%S") if row[9] else None,
                "preview_status": row[10],
                "preview_file_name": row[11],
                # 分类统计
                "product_total": row[12] or 0,
                "product_success": row[13] or 0,
                "platform_total": row[14] or 0,
                "platform_success": row[15] or 0,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询记录详情失败: {str(e)}")


@router.get("/{product_id}")
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        query = text("""
            SELECT p.id, p.product_code, p.name, p.name_en, p.product_type, p.product_attribute,
                   p.category, p.brand, p.supplier, p.purchase_price, p.sale_price,
                   p.main_image, p.images, p.video_url, p.weight, p.length, p.width, p.height,
                   p.status, p.is_robot_monitored, p.created_at, p.config,
                   COALESCE((SELECT SUM(ib.current_quantity) FROM inventory_batches ib WHERE ib.product_id = p.id AND ib.tenant_id = p.tenant_id AND ib.status = 'active' AND ib.current_quantity > 0 AND ib.deleted_at IS NULL), 0) as local_quantity,
                   p.local_warehouse, p.local_inbound_date, p.local_stock_age, p.no_accessory
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
                   pp.title, pp.title_en, pp.image_url, pp.images, pp.description, pp.bullet_points, pp.keywords,
                   pp.currency, pp.price, pp.cost_price, pp.status, pp.sync_status, pp.created_at
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
                    text(f"SELECT id, inventory_name, site FROM stores WHERE id IN ({placeholders})"),
                    sid_params
                ).fetchall()
                name_map = {r[0]: (r[1], r[2]) for r in store_rows}
                for sid in store_ids:
                    name, site = name_map.get(sid, ("", ""))
                    if name:
                        store_names.append(name)
                    else:
                        store_names.append(f"店铺ID:{sid}")

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
                "images": _parse_json_images(pp[10]),
                "description": pp[11] or "",
                "bullet_points": pp[12] or "",
                "keywords": pp[13] or "",
                "currency": pp[14] or "",
                "price": float(pp[15]) if pp[15] else None,
                "cost_price": float(pp[16]) if pp[16] else None,
                "status": pp[17],
                "sync_status": pp[18] or "",
                "created_at": pp[19].strftime("%Y-%m-%d %H:%M:%S") if pp[19] else "",
            })

        purchase_price = float(row[9]) if row[9] else None
        local_quantity = int(row[22]) if row[22] else 0
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
            "supplier": row[8] or "",
            "purchase_price": purchase_price,
            "sale_price": float(row[10]) if row[10] else None,
            "main_image": row[11] or "",
            "images": _parse_json_images(row[12]),
            "video_url": row[13] or "",
            "weight": float(row[14]) if row[14] else None,
            "length": float(row[15]) if row[15] else None,
            "width": float(row[16]) if row[16] else None,
            "height": float(row[17]) if row[17] else None,
            "status": row[18],
            "is_robot_monitored": bool(row[19]),
            "created_at": row[20].strftime("%Y-%m-%d %H:%M:%S") if row[20] else "",
            "config": row[21],
            "local_quantity": local_quantity,
            "local_warehouse": row[23] or "",
            "local_inbound_date": row[24].strftime("%Y-%m-%d") if row[24] else "",
            "local_stock_age": int(row[25]) if row[25] else None,
            "local_value": float(local_value) if local_value is not None else None,
            "no_accessory": bool(row[26]) if row[26] is not None else False,
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
        if product_data.images and len(product_data.images) > 9:
            raise HTTPException(status_code=400, detail="产品图片最多上传 9 张")

        if product_data.product_code:
            exists = db.execute(
                # 包含已软删除的记录，其编码仍占用唯一索引 uk_product_code
                text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid"),
                {"code": product_data.product_code, "tid": current_user.tenant_id}
            ).fetchone()
            if exists:
                raise HTTPException(status_code=400, detail="商品编码已存在")

        # 将产品类型列表转换为逗号分隔的字符串
        product_type_str = ",".join(product_data.product_type) if product_data.product_type else None

        # 自动创建不存在的供应商
        _ensure_supplier(db, current_user.tenant_id, product_data.supplier)

        insert_sql = text("""
            INSERT INTO products (tenant_id, product_code, name, name_en, product_type, product_attribute, category, brand, supplier,
                                  purchase_price, sale_price, main_image, images, video_url, weight, length, width, height,
                                  status, is_robot_monitored, no_accessory, local_quantity, local_warehouse, local_inbound_date, local_stock_age)
            VALUES (:tenant_id, :product_code, :name, :name_en, :product_type, :product_attribute, :category, :brand, :supplier,
                    :purchase_price, :sale_price, :main_image, :images, :video_url, :weight, :length, :width, :height,
                    :status, :is_robot_monitored, :no_accessory, :local_quantity, :local_warehouse, :local_inbound_date, :local_stock_age)
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
            "supplier": product_data.supplier,
            "purchase_price": product_data.purchase_price,
            "sale_price": product_data.sale_price,
            "main_image": product_data.main_image,
            "images": _serialize_images(product_data.images),
            "video_url": product_data.video_url,
            "weight": product_data.weight,
            "length": product_data.length,
            "width": product_data.width,
            "height": product_data.height,
            "status": product_data.status,
            "is_robot_monitored": product_data.is_robot_monitored,
            "no_accessory": product_data.no_accessory,
            "local_quantity": product_data.local_quantity,
            "local_warehouse": product_data.local_warehouse,
            "local_inbound_date": product_data.local_inbound_date,
            "local_stock_age": product_data.local_stock_age,
        })
        product_id = result.lastrowid
        
        # 准备日志数据
        after_data = {
            "product_code": product_data.product_code,
            "name": product_data.name,
            "name_en": product_data.name_en,
            "product_type": product_type_str,
            "product_attribute": product_data.product_attribute,
            "category": product_data.category,
            "brand": product_data.brand,
            "purchase_price": product_data.purchase_price,
            "sale_price": product_data.sale_price,
            "status": product_data.status,
        }
        
        # 记录日志（不提交，由业务逻辑提交）
        log_product_create(
            db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
            product_id, product_data.product_code or "", product_data.name, after_data
        )
        
        db.commit()
        return {
            "success": True,
            "message": "商品创建成功",
            # "data": {"id": result.lastrowid}
            "data": {"id": product_id}
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
        if product_data.images is not None and len(product_data.images) > 9:
            raise HTTPException(status_code=400, detail="产品图片最多上传 9 张")

        # 先获取产品完整信息用于日志（包含所有可更新字段）
        product_row = db.execute(
            text("""
                SELECT id, product_code, name, name_en, product_type, product_attribute,
                       category, brand, supplier, purchase_price, sale_price, main_image,
                       images, video_url, weight, length, width, height, status, is_robot_monitored,
                       no_accessory, local_quantity, local_warehouse, local_inbound_date, local_stock_age
                FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product_row:
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

        # 自动创建不存在的供应商
        _ensure_supplier(db, current_user.tenant_id, product_data.supplier)

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
            "supplier": product_data.supplier,
            "purchase_price": product_data.purchase_price,
            "sale_price": product_data.sale_price,
            "main_image": product_data.main_image,
            "video_url": product_data.video_url,
            "weight": product_data.weight,
            "length": product_data.length,
            "width": product_data.width,
            "height": product_data.height,
            "status": product_data.status,
            "is_robot_monitored": product_data.is_robot_monitored,
            "no_accessory": product_data.no_accessory,
            "local_quantity": product_data.local_quantity,
            "local_warehouse": product_data.local_warehouse,
            "local_inbound_date": product_data.local_inbound_date,
            "local_stock_age": product_data.local_stock_age,
        }
        for field, value in field_map.items():
            if value is not None:
                updates.append(f"{field} = :{field}")
                params[field] = value

        # images 单独处理：空数组也需要支持清空
        if product_data.images is not None:
            updates.append("images = :images")
            params["images"] = _serialize_images(product_data.images)

        if updates:
            # 准备日志的 before_data（包含所有可更新字段）
            before_data = {
                "product_code": product_row[1],
                "name": product_row[2],
                "name_en": product_row[3],
                "product_type": product_row[4],
                "product_attribute": product_row[5],
                "category": product_row[6],
                "brand": product_row[7],
                "supplier": product_row[8],
                "purchase_price": float(product_row[9]) if product_row[9] is not None else None,
                "sale_price": float(product_row[10]) if product_row[10] is not None else None,
                "main_image": product_row[11],
                "images": _parse_json_images(product_row[12]),
                "video_url": product_row[13],
                "weight": float(product_row[14]) if product_row[14] is not None else None,
                "length": float(product_row[15]) if product_row[15] is not None else None,
                "width": float(product_row[16]) if product_row[16] is not None else None,
                "height": float(product_row[17]) if product_row[17] is not None else None,
                "status": product_row[18],
                "is_robot_monitored": product_row[19],
                "no_accessory": product_row[20],
                "local_quantity": product_row[21],
                "local_warehouse": product_row[22],
                "local_inbound_date": product_row[23],
                "local_stock_age": product_row[24],
            }

            # 准备日志的 after_data（合并新值）
            after_data = before_data.copy()
            for field, value in field_map.items():
                if value is not None and field in after_data:
                    after_data[field] = value
            if product_data.images is not None:
                after_data["images"] = product_data.images

            db.execute(
                text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                params
            )

            # 记录日志（不提交，由业务逻辑提交）
            log_product_update(
                db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                product_id, product_row[1] or "", product_row[2] or "", before_data, after_data
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
        # 先获取产品信息用于日志
        product_row = db.execute(
            text("""
                SELECT id, product_code, name, name_en, product_type, product_attribute, 
                       category, brand, purchase_price, sale_price, status
                FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
            """),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product_row:
            raise HTTPException(status_code=404, detail="商品不存在")

        # 准备日志的 before_data
        before_data = {
            "product_code": product_row[1],
            "name": product_row[2],
            "name_en": product_row[3],
            "product_type": product_row[4],
            "product_attribute": product_row[5],
            "category": product_row[6],
            "brand": product_row[7],
            "purchase_price": product_row[8],
            "sale_price": product_row[9],
            "status": product_row[10],
        }
        
        db.execute(
            text("UPDATE products SET deleted_at = NOW() WHERE id = :id AND tenant_id = :tid"),
            {"id": product_id, "tid": current_user.tenant_id}
        )
        # 清理该产品的配件绑定关系（作为成品或作为配件）
        db.execute(
            text("""
                UPDATE product_bindings SET deleted_at = NOW()
                WHERE (finished_product_id = :pid OR accessory_product_id = :pid)
                AND deleted_at IS NULL
            """),
            {"pid": product_id}
        )
        
        # 记录日志（不提交，由业务逻辑提交）
        log_product_delete(
            db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
            product_id, product_row[1] or "", product_row[2] or "", before_data
        )
        
        db.commit()
        return {"success": True, "message": "商品删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除商品失败: {str(e)}")


@router.get("/{product_id}/profit-margins")
async def get_product_profit_margins(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取产品在各店铺的利润率（通过 platform_products SKU 关联 inventory_snapshots）"""
    try:
        product = db.execute(
            text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product:
            raise HTTPException(status_code=404, detail="商品不存在")

        margins = _fetch_profit_margins(db, [product_id], current_user.tenant_id)
        return {"success": True, "data": margins.get(product_id, [])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取利润率失败: {str(e)}")


@router.post("/profit-margins/batch")
async def batch_get_product_profit_margins(
    request: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量获取多个产品的利润率"""
    try:
        product_ids = request.get("product_ids", [])
        if not product_ids:
            return {"success": True, "data": {}}

        is_admin = current_user.role == 'admin' if hasattr(current_user, 'role') else False
        margins = _fetch_profit_margins(db, product_ids, current_user.tenant_id, current_user.id, is_admin)
        return {"success": True, "data": margins}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量获取利润率失败: {str(e)}")


def _fetch_profit_margins(db: Session, product_ids: list, tenant_id: int, user_id: int = None, is_admin: bool = False) -> dict:
    """内部函数：批量查询产品利润率，返回 {product_id: [margins]}"""
    if not product_ids:
        return {}

    # 手动构建 IN 占位符，避免 SQLAlchemy text() 不支持 tuple 绑定
    pid_placeholders = ', '.join(f':pid{i}' for i in range(len(product_ids)))
    pid_params = {f'pid{i}': product_ids[i] for i in range(len(product_ids))}
    pid_params["tid"] = tenant_id

    # 1. 通过 platform_products.sku = inventory_snapshots.sku 关联
    query_sku = text(f"""
        SELECT pp.product_id, s.account, s.country, s.gross_margin, s.sku
        FROM inventory_snapshots s
        INNER JOIN platform_products pp ON pp.sku = s.sku
        WHERE pp.product_id IN ({pid_placeholders})
          AND pp.tenant_id = :tid
          AND pp.deleted_at IS NULL
          AND s.tenant_id = :tid
          AND s.deleted_at IS NULL
          AND s.snapshot_date = (
              SELECT MAX(s2.snapshot_date) FROM inventory_snapshots s2
              WHERE s2.tenant_id = :tid AND s2.deleted_at IS NULL
          )
          AND s.gross_margin IS NOT NULL
          AND s.account IS NOT NULL
          AND (s.summary_flag IS NULL OR s.summary_flag != '共享库存')
    """)

    # 2. 通过 platform_products.asin = inventory_snapshots.asin 关联（补充 SKU 匹配不到的）
    query_asin = text(f"""
        SELECT pp.product_id, s.account, s.country, s.gross_margin, s.sku
        FROM inventory_snapshots s
        INNER JOIN platform_products pp ON pp.asin = s.asin
        WHERE pp.product_id IN ({pid_placeholders})
          AND pp.tenant_id = :tid
          AND pp.deleted_at IS NULL
          AND s.tenant_id = :tid
          AND s.deleted_at IS NULL
          AND s.snapshot_date = (
              SELECT MAX(s2.snapshot_date) FROM inventory_snapshots s2
              WHERE s2.tenant_id = :tid AND s2.deleted_at IS NULL
          )
          AND s.gross_margin IS NOT NULL
          AND s.account IS NOT NULL
          AND (s.summary_flag IS NULL OR s.summary_flag != '共享库存')
    """)

    rows_sku = db.execute(query_sku, pid_params).fetchall()
    rows_asin = db.execute(query_asin, pid_params).fetchall()

    # 合并去重：以 (product_id, account, country, sku) 为唯一键
    result = {}
    seen = set()
    for row in rows_sku + rows_asin:
        pid = row[0]
        dedup_key = (pid, row[1], row[2], row[4])  # product_id, account, country, sku
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        if pid not in result:
            result[pid] = []
        result[pid].append({
            "account": row[1],
            "country": row[2],
            "gross_margin": float(row[3]) if row[3] is not None else None,
            "sku": row[4],
        })

    # 非管理员：只保留用户已绑定店铺分组下的店铺数据
    if not is_admin and user_id:
        allowed_names = _get_user_store_inventory_names(db, user_id, tenant_id)
        if allowed_names:
            for pid in result:
                result[pid] = [
                    m for m in result[pid]
                    if any(name in (m.get("account") or "") for name in allowed_names)
                ]

    return result


def _get_user_store_inventory_names(db: Session, user_id: int, tenant_id: int) -> list:
    """获取用户绑定店铺分组下所有店铺的 inventory_name 列表"""
    rows = db.execute(text("""
        SELECT DISTINCT s.inventory_name
        FROM stores s
        INNER JOIN user_stores us ON us.store_id = s.id
        WHERE us.user_id = :user_id AND s.tenant_id = :tenant_id
          AND s.deleted_at IS NULL AND s.status = 'active'
          AND s.inventory_name IS NOT NULL AND s.inventory_name != ''
    """), {"user_id": user_id, "tenant_id": tenant_id}).fetchall()
    return [r[0] for r in rows]


def _get_user_store_groups(db: Session, user_id: int, tenant_id: int) -> dict:
    """获取用户所属的店铺分组 {group_id: name}"""
    rows = db.execute(text("""
        SELECT DISTINCT sg.id, sg.name
        FROM store_groups sg
        INNER JOIN stores s ON s.group_id = sg.id
        INNER JOIN user_stores us ON us.store_id = s.id
        WHERE us.user_id = :user_id AND sg.tenant_id = :tenant_id
          AND sg.deleted_at IS NULL AND s.deleted_at IS NULL
    """), {"user_id": user_id, "tenant_id": tenant_id}).fetchall()
    return {row[0]: row[1] for row in rows}


def _parse_store_ids(store_id_raw: any) -> list:
    """解析 platform_products.store_id（支持 int、float、str(JSON)、list/tuple）"""
    import json as json_lib
    if not store_id_raw:
        return []
    try:
        if isinstance(store_id_raw, (int, float)):
            return [int(store_id_raw)]
        elif isinstance(store_id_raw, str):
            try:
                parsed = json_lib.loads(store_id_raw)
                return parsed if isinstance(parsed, list) else [int(parsed)]
            except Exception:
                return [int(store_id_raw)]
        elif isinstance(store_id_raw, (list, tuple)):
            return [int(sid) for sid in store_id_raw]
    except Exception:
        pass
    return []


@router.get("/{product_id}/store-group-sku")
async def get_product_store_group_sku(
    product_id: int,
    store_group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取产品在当前账号店铺分组下的 SKU"""
    try:
        product = db.execute(
            text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product:
            raise HTTPException(status_code=404, detail="商品不存在")

        user_groups = _get_user_store_groups(db, current_user.id, current_user.tenant_id)

        # 确定目标店铺分组：显式传入的分组优先（需属于当前租户），否则取用户第一个分组
        target_group_id = None
        target_group_name = ""
        if store_group_id:
            group_row = db.execute(
                text("SELECT id, name FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
                {"id": store_group_id, "tid": current_user.tenant_id}
            ).fetchone()
            if group_row:
                target_group_id = group_row[0]
                target_group_name = group_row[1]
        if not target_group_id and user_groups:
            target_group_id = next(iter(user_groups.keys()))
            target_group_name = user_groups[target_group_id]

        if not target_group_id:
            return {"success": True, "data": {"sku": "", "asin": "", "store_group_id": None, "store_group_name": ""}}

        store_rows = db.execute(text("""
            SELECT id FROM stores
            WHERE group_id = :group_id AND tenant_id = :tenant_id AND deleted_at IS NULL
        """), {"group_id": target_group_id, "tenant_id": current_user.tenant_id}).fetchall()
        group_store_ids = {row[0] for row in store_rows}

        if not group_store_ids:
            return {"success": True, "data": {"sku": "", "asin": "", "store_group_id": target_group_id, "store_group_name": target_group_name}}

        pp_rows = db.execute(text("""
            SELECT sku, asin, store_id FROM platform_products
            WHERE product_id = :product_id AND tenant_id = :tenant_id AND deleted_at IS NULL
        """), {"product_id": product_id, "tenant_id": current_user.tenant_id}).fetchall()

        matched = []
        for pp in pp_rows:
            sku = pp[0] or ""
            asin = pp[1] or ""
            sids = _parse_store_ids(pp[2])
            if any(sid in group_store_ids for sid in sids):
                matched.append({"sku": sku, "asin": asin})

        return {
            "success": True,
            "data": {
                "sku": matched[0]["sku"] if matched else "",
                "asin": matched[0]["asin"] if matched else "",
                "store_group_id": target_group_id,
                "store_group_name": target_group_name,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取店铺分组SKU失败: {str(e)}")


@router.post("/store-group-skus/batch")
async def batch_get_product_store_group_skus(
    request: dict,
    store_group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量获取多个产品在当前账号店铺分组下的 SKU"""
    try:
        product_ids = request.get("product_ids", [])
        if not product_ids:
            return {"success": True, "data": {}}

        user_groups = _get_user_store_groups(db, current_user.id, current_user.tenant_id)

        # 确定目标店铺分组：显式传入的分组优先（需属于当前租户），否则取用户第一个分组
        target_group_id = None
        target_group_name = ""
        if store_group_id:
            group_row = db.execute(
                text("SELECT id, name FROM store_groups WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
                {"id": store_group_id, "tid": current_user.tenant_id}
            ).fetchone()
            if group_row:
                target_group_id = group_row[0]
                target_group_name = group_row[1]
        if not target_group_id and user_groups:
            target_group_id = next(iter(user_groups.keys()))
            target_group_name = user_groups[target_group_id]

        result = {pid: {"sku": "", "asin": "", "store_group_id": target_group_id, "store_group_name": target_group_name} for pid in product_ids}

        if not target_group_id:
            return {"success": True, "data": result}

        store_rows = db.execute(text("""
            SELECT id FROM stores
            WHERE group_id = :group_id AND tenant_id = :tenant_id AND deleted_at IS NULL
        """), {"group_id": target_group_id, "tenant_id": current_user.tenant_id}).fetchall()
        group_store_ids = {row[0] for row in store_rows}

        if not group_store_ids:
            return {"success": True, "data": result}

        placeholders = ",".join([f":pid{i}" for i in range(len(product_ids))])
        params = {f"pid{i}": product_ids[i] for i in range(len(product_ids))}
        params["tenant_id"] = current_user.tenant_id

        pp_rows = db.execute(text(f"""
            SELECT product_id, sku, asin, store_id FROM platform_products
            WHERE product_id IN ({placeholders}) AND tenant_id = :tenant_id AND deleted_at IS NULL
        """), params).fetchall()

        for pp in pp_rows:
            pid = pp[0]
            sku = pp[1] or ""
            asin = pp[2] or ""
            sids = _parse_store_ids(pp[3])
            if any(sid in group_store_ids for sid in sids) and not result[pid]["sku"]:
                result[pid] = {"sku": sku, "asin": asin, "store_group_id": target_group_id, "store_group_name": target_group_name}

        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量获取店铺分组SKU失败: {str(e)}")


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
                   pp.title, pp.title_en, pp.image_url, pp.images, pp.description, pp.bullet_points, pp.keywords,
                   pp.currency, pp.price, pp.cost_price, pp.status, pp.sync_status, pp.created_at
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
                    text(f"SELECT id, inventory_name, site FROM stores WHERE id IN ({placeholders})"),
                    sid_params
                ).fetchall()
                name_map = {r[0]: (r[1], r[2]) for r in store_rows}
                for sid in store_ids:
                    name, site = name_map.get(sid, ("", ""))
                    if name:
                        store_names.append(name)
                    else:
                        store_names.append(f"店铺ID:{sid}")

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
                "images": _parse_json_images(pp[10]),
                "description": pp[11] or "",
                "bullet_points": pp[12] or "",
                "keywords": pp[13] or "",
                "currency": pp[14] or "",
                "price": float(pp[15]) if pp[15] else None,
                "cost_price": float(pp[16]) if pp[16] else None,
                "status": pp[17],
                "sync_status": pp[18] or "",
                "created_at": pp[19].strftime("%Y-%m-%d %H:%M:%S") if pp[19] else "",
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
        if data.images and len(data.images) > 9:
            raise HTTPException(status_code=400, detail="商品图片最多上传 9 张")

        # 先获取产品名称用于日志
        product = db.execute(
            text("SELECT id, name FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not product:
            raise HTTPException(status_code=404, detail="商品不存在")

        if not data.store_ids:
            raise HTTPException(status_code=400, detail="至少需要一个店铺")

        # 验证并标准化平台（标准平台 + 本租户自定义平台）
        valid_platforms = excel_helper.STANDARD_PLATFORMS | get_custom_platforms(db, current_user.tenant_id)
        platform_aliases = {
            "tiktok shop": "tiktok",
            "temu": "temu",
            # 新平台类型中文别名
            "temu半托": "temu_half",
            "temu全托": "temu_full",
            "shein半托": "shein_half",
            "shein全托": "shein_full",
            "速卖通半托": "aliexpress_half",
            "速卖通全托": "aliexpress_full",
        }
        platform = data.platform.strip().lower()
        normalized_platform = platform_aliases.get(platform, platform)
        if normalized_platform not in valid_platforms:
            raise HTTPException(status_code=400, detail=f"平台 '{data.platform}' 无效，有效平台: {', '.join(valid_platforms)}")

        import json
        insert_sql = text("""
            INSERT INTO platform_products (tenant_id, product_id, platform, store_id, platform_product_id,
                                           asin, spu, sku, title, title_en, image_url, images,
                                           description, bullet_points, keywords, currency,
                                           price, cost_price, status)
            VALUES (:tenant_id, :product_id, :platform, :store_id, :platform_product_id,
                    :asin, :spu, :sku, :title, :title_en, :image_url, :images,
                    :description, :bullet_points, :keywords, :currency,
                    :price, :cost_price, :status)
        """)
        result = db.execute(insert_sql, {
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
            "images": _serialize_images(data.images),
            "description": data.description,
            "bullet_points": data.bullet_points,
            "keywords": data.keywords,
            "currency": data.currency,
            "price": data.price,
            "cost_price": data.cost_price,
            "status": data.status,
        })
        
        # 准备日志数据
        after_data = {
            "platform": normalized_platform,
            "sku": data.sku,
            "asin": data.asin,
            "spu": data.spu,
            "title": data.title,
            "currency": data.currency,
            "price": data.price,
            "cost_price": data.cost_price,
            "status": data.status,
        }
        
        # 记录日志（不提交，由业务逻辑提交）
        log_platform_product_create(
            db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
            product_id, product[1] or "", normalized_platform, data.sku or "", after_data
        )
        
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
        if data.images is not None and len(data.images) > 9:
            raise HTTPException(status_code=400, detail="商品图片最多上传 9 张")

        # 先获取平台商品和产品信息用于日志
        pp_row = db.execute(
            text("""
                SELECT id, platform, sku, asin, spu, title, currency, price, cost_price, status
                FROM platform_products 
                WHERE id = :id AND product_id = :pid AND tenant_id = :tid AND deleted_at IS NULL
            """),
            {"id": pp_id, "pid": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not pp_row:
            raise HTTPException(status_code=404, detail="平台商品不存在")
        
        # 获取产品名称
        product = db.execute(
            text("SELECT id, name FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()

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
            "description": data.description,
            "bullet_points": data.bullet_points,
            "keywords": data.keywords,
            "currency": data.currency,
            "price": data.price,
            "cost_price": data.cost_price,
            "status": data.status,
        }
        for field, value in field_map.items():
            if value is not None:
                updates.append(f"{field} = :{field}")
                params[field] = value

        # images 单独处理：空数组也需要支持清空
        if data.images is not None:
            updates.append("images = :images")
            params["images"] = _serialize_images(data.images)

        if data.store_ids is not None:
            import json
            updates.append("store_id = :store_id")
            params["store_id"] = json.dumps(data.store_ids)

        if data.extra_data is not None:
            import json
            updates.append("extra_data = :extra_data")
            params["extra_data"] = json.dumps(data.extra_data)

        if updates:
            # 准备日志的 before_data
            before_data = {
                "platform": pp_row[1],
                "sku": pp_row[2],
                "asin": pp_row[3],
                "spu": pp_row[4],
                "title": pp_row[5],
                "currency": pp_row[6],
                "price": pp_row[7],
                "cost_price": pp_row[8],
                "status": pp_row[9],
            }
            
            # 准备日志的 after_data（合并新值）
            after_data = before_data.copy()
            for field, value in field_map.items():
                if value is not None and field in after_data:
                    after_data[field] = value
            if data.images is not None:
                after_data["images"] = data.images
            
            db.execute(
                text(f"UPDATE platform_products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
                params
            )
            
            # 记录日志（不提交，由业务逻辑提交）
            log_platform_product_update(
                db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                product_id, product[1] or "" if product else "", pp_row[1] or "", pp_row[2] or "", before_data, after_data
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
        # 先获取平台商品和产品信息用于日志
        pp_row = db.execute(
            text("""
                SELECT id, platform, sku, asin, spu, title, currency, price, cost_price, status
                FROM platform_products 
                WHERE id = :id AND product_id = :pid AND tenant_id = :tid AND deleted_at IS NULL
            """),
            {"id": pp_id, "pid": product_id, "tid": current_user.tenant_id}
        ).fetchone()
        if not pp_row:
            raise HTTPException(status_code=404, detail="平台商品不存在")
        
        # 获取产品名称
        product = db.execute(
            text("SELECT id, name FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
            {"id": product_id, "tid": current_user.tenant_id}
        ).fetchone()

        # 准备日志的 before_data
        before_data = {
            "platform": pp_row[1],
            "sku": pp_row[2],
            "asin": pp_row[3],
            "spu": pp_row[4],
            "title": pp_row[5],
            "currency": pp_row[6],
            "price": pp_row[7],
            "cost_price": pp_row[8],
            "status": pp_row[9],
        }

        db.execute(
            text("UPDATE platform_products SET deleted_at = NOW() WHERE id = :id"),
            {"id": pp_id}
        )
        
        # 记录日志（不提交，由业务逻辑提交）
        log_platform_product_delete(
            db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
            product_id, product[1] or "" if product else "", pp_row[1] or "", pp_row[2] or "", before_data
        )
        
        db.commit()
        return {"success": True, "message": "平台商品删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除平台商品失败: {str(e)}")


# @router.get("/template/download")
# async def download_product_template(
#     current_user: User = Depends(get_current_user)
# ):
#     try:
#         file_stream = create_product_excel_template()
#         filename = f"产品导入模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
#         return StreamingResponse(
#             file_stream,
#             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
#             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
#         )
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


# @router.post("/upload/preview")
# async def upload_product_preview(
#     file: UploadFile = File(...),
#     db: Session = Depends(get_db),
#     current_user: User = Depends(PermissionChecker("product:create"))
# ):
#     try:
#         file_bytes = await file.read()
#         result = parse_product_excel(file_bytes, db, current_user.tenant_id)
#         products = result.get("products", [])
#         platform_products = result.get("platform_products", [])
        
#         message = f"成功解析 {len(products)} 个产品"
#         if platform_products:
#             message += f"，{len(platform_products)} 个平台商品"
        
#         return {"success": True, "data": {"products": products, "platform_products": platform_products}, "message": message}
#     except ValueError as e:
#         raise HTTPException(status_code=400, detail=str(e))
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"解析文件失败: {str(e)}")


# class BatchProductImport(BaseModel):
#     products: List[dict] = []
#     platform_products: List[dict] = []


# @router.post("/batch-import")
# async def batch_import_products(
#     data: BatchProductImport,
#     db: Session = Depends(get_db),
#     current_user: User = Depends(PermissionChecker("product:create"))
# ):
#     try:
#         if not data.products and not data.platform_products:
#             raise HTTPException(status_code=400, detail="没有可导入的数据")
        
#         created = 0
#         updated = 0
#         platform_created = 0
#         platform_updated = 0
#         errors = []
        
#         # 先处理产品导入
#         product_code_to_id = {}
        
#         for idx, item in enumerate(data.products):
#             product_code = item.get("product_code", "").strip()
#             name = item.get("name", "").strip()
            
#             if not product_code or not name:
#                 errors.append(f"产品第 {idx + 1} 行: 产品编码或名称为空")
#                 continue
            
#             existing = db.execute(
#                 text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"),
#                 {"code": product_code, "tid": current_user.tenant_id}
#             ).fetchone()
            
#             product_type_list = item.get("product_type")
#             product_type_str = ",".join(product_type_list) if product_type_list and isinstance(product_type_list, list) else None
            
#             if existing:
#                 updates = []
#                 params = {"id": existing[0]}
#                 field_map = {
#                     "name": item.get("name"),
#                     "name_en": item.get("name_en"),
#                     "product_type": product_type_str,
#                     "product_attribute": item.get("product_attribute"),
#                     "category": item.get("category"),
#                     "brand": item.get("brand"),
#                     "purchase_price": item.get("purchase_price"),
#                     "sale_price": item.get("sale_price"),
#                     "main_image": item.get("main_image"),
#                     "weight": item.get("weight"),
#                     "length": item.get("length"),
#                     "width": item.get("width"),
#                     "height": item.get("height"),
#                     "status": item.get("status"),
#                 }
#                 for field, value in field_map.items():
#                     if value is not None:
#                         updates.append(f"{field} = :{field}")
#                         params[field] = value
                
#                 if updates:
#                     db.execute(
#                         text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
#                         params
#                     )
#                 updated += 1
#                 product_code_to_id[product_code] = existing[0]
#             else:
#                 insert_sql = text("""
#                     INSERT INTO products (tenant_id, product_code, name, name_en, product_type, product_attribute,
#                                           category, brand, purchase_price, sale_price, main_image,
#                                           weight, length, width, height, status)
#                     VALUES (:tenant_id, :product_code, :name, :name_en, :product_type, :product_attribute,
#                             :category, :brand, :purchase_price, :sale_price, :main_image,
#                             :weight, :length, :width, :height, :status)
#                 """)
#                 result = db.execute(insert_sql, {
#                     "tenant_id": current_user.tenant_id,
#                     "product_code": product_code,
#                     "name": name,
#                     "name_en": item.get("name_en"),
#                     "product_type": product_type_str,
#                     "product_attribute": item.get("product_attribute"),
#                     "category": item.get("category"),
#                     "brand": item.get("brand"),
#                     "purchase_price": item.get("purchase_price"),
#                     "sale_price": item.get("sale_price"),
#                     "main_image": item.get("main_image"),
#                     "weight": item.get("weight"),
#                     "length": item.get("length"),
#                     "width": item.get("width"),
#                     "height": item.get("height"),
#                     "status": item.get("status", "active"),
#                 })
#                 created += 1
#                 product_code_to_id[product_code] = result.lastrowid
        
#         # 处理平台商品导入
#         import json
#         for idx, item in enumerate(data.platform_products):
#             product_code = item.get("product_code", "").strip()
#             platform = item.get("platform", "").strip()
#             store_name = item.get("store_name", "").strip()
#             store_site = item.get("store_site", "").strip() if item.get("store_site") else None
            
#             store_names = item.get("store_names", [store_name] if store_name else [])
#             store_sites = item.get("store_sites", [store_site] if store_site else [])
#             if not store_names and store_name:
#                 store_names = [s.strip() for s in store_name.split("|") if s.strip()]
#             if not store_sites and store_site:
#                 store_sites = [s.strip() for s in store_site.split("|") if s.strip()]
#             if not store_sites:
#                 store_sites = [None] * len(store_names)
            
#             if not product_code or not platform or not store_names:
#                 errors.append(f"平台商品第 {idx + 1} 行: 产品编码、平台或店铺名称为空")
#                 continue
            
#             # 获取产品ID
#             product_id = product_code_to_id.get(product_code)
#             if not product_id:
#                 existing = db.execute(
#                     text("SELECT id FROM products WHERE product_code = :code AND tenant_id = :tid AND deleted_at IS NULL"),
#                     {"code": product_code, "tid": current_user.tenant_id}
#                 ).fetchone()
#                 if not existing:
#                     errors.append(f"平台商品第 {idx + 1} 行: 产品编码 '{product_code}' 不存在")
#                     continue
#                 product_id = existing[0]
#                 product_code_to_id[product_code] = product_id
            
#             # 查找所有店铺ID
#             store_ids = []
#             for si in range(len(store_names)):
#                 sn = store_names[si].strip()
#                 ss = store_sites[si] if si < len(store_sites) and store_sites[si] else None
#                 if not sn:
#                     continue
                
#                 store = None
#                 if ss:
#                     store = db.execute(
#                         text("SELECT id FROM stores WHERE name = :name AND site = :site AND tenant_id = :tid AND deleted_at IS NULL LIMIT 1"),
#                         {"name": sn, "site": ss.strip() if ss else None, "tid": current_user.tenant_id}
#                     ).fetchone()
                
#                 if not store:
#                     store = db.execute(
#                         text("SELECT id FROM stores WHERE name = :name AND tenant_id = :tid AND deleted_at IS NULL LIMIT 1"),
#                         {"name": sn, "tid": current_user.tenant_id}
#                     ).fetchone()
                
#                 if not store:
#                     if ss:
#                         errors.append(f"平台商品第 {idx + 1} 行: 店铺 '{sn}' - '{ss}' 不存在")
#                     else:
#                         errors.append(f"平台商品第 {idx + 1} 行: 店铺 '{sn}' 不存在")
#                     continue
#                 store_ids.append(store[0])
            
#             if not store_ids:
#                 errors.append(f"平台商品第 {idx + 1} 行: 未找到有效店铺")
#                 continue
            
#             # 检查是否已存在相同的平台商品（产品+平台+完全相同的店铺集合）
#             existing_platform = db.execute(
#                 text("""
#                     SELECT id FROM platform_products 
#                     WHERE product_id = :pid AND platform = :platform AND store_id = :store_id::jsonb 
#                     AND tenant_id = :tid AND deleted_at IS NULL
#                 """),
#                 {"pid": product_id, "platform": platform, "store_id": json.dumps(store_ids), "tid": current_user.tenant_id}
#             ).fetchone()
            
#             if existing_platform:
#                 # 更新
#                 updates = []
#                 params = {"id": existing_platform[0]}
#                 field_map = {
#                     "platform_product_id": item.get("platform_product_id"),
#                     "asin": item.get("asin"),
#                     "spu": item.get("spu"),
#                     "sku": item.get("sku"),
#                     "title": item.get("title"),
#                     "title_en": item.get("title_en"),
#                     "image_url": item.get("image_url"),
#                     "currency": item.get("currency"),
#                     "price": item.get("price"),
#                     "cost_price": item.get("cost_price"),
#                     "status": item.get("status"),
#                 }
#                 for field, value in field_map.items():
#                     if value is not None:
#                         updates.append(f"{field} = :{field}")
#                         params[field] = value
                
#                 if updates:
#                     db.execute(
#                         text(f"UPDATE platform_products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
#                         params
#                     )
#                 platform_updated += 1
#             else:
#                 # 新建
#                 insert_sql = text("""
#                     INSERT INTO platform_products (tenant_id, product_id, platform, store_id, platform_product_id,
#                                                   asin, spu, sku, title, title_en, image_url, currency,
#                                                   price, cost_price, status)
#                     VALUES (:tenant_id, :product_id, :platform, :store_id, :platform_product_id,
#                             :asin, :spu, :sku, :title, :title_en, :image_url, :currency,
#                             :price, :cost_price, :status)
#                 """)
#                 db.execute(insert_sql, {
#                     "tenant_id": current_user.tenant_id,
#                     "product_id": product_id,
#                     "platform": platform,
#                     "store_id": json.dumps(store_ids),
#                     "platform_product_id": item.get("platform_product_id"),
#                     "asin": item.get("asin"),
#                     "spu": item.get("spu"),
#                     "sku": item.get("sku"),
#                     "title": item.get("title"),
#                     "title_en": item.get("title_en"),
#                     "image_url": item.get("image_url"),
#                     "currency": item.get("currency"),
#                     "price": item.get("price"),
#                     "cost_price": item.get("cost_price"),
#                     "status": item.get("status", "active"),
#                 })
#                 platform_created += 1
        
#         db.commit()
        
#         result_msg = f"导入完成！产品新增 {created} 个，更新 {updated} 个"
#         if data.platform_products:
#             result_msg += f"；平台商品新增 {platform_created} 个，更新 {platform_updated} 个"
#         if errors:
#             result_msg += f"，{len(errors)} 条错误"
        
#         return {
#             "success": True,
#             "message": result_msg,
#             "data": {
#                 "products_created": created,
#                 "products_updated": updated,
#                 "platform_created": platform_created,
#                 "platform_updated": platform_updated,
#                 "errors": errors
#             }
#         }
#     except HTTPException:
#         raise
#     except Exception as e:
#         db.rollback()
#         raise HTTPException(status_code=500, detail=f"批量导入失败: {str(e)}")


# @router.post("/batch-update-missing")
# async def batch_update_product_missing_data(
#     data: BatchProductImport,
#     db: Session = Depends(get_db),
#     current_user: User = Depends(PermissionChecker("product:edit"))
# ):
#     try:
#         if not data.items:
#             raise HTTPException(status_code=400, detail="没有可更新的数据")
        
#         updated_count = 0
#         for item in data.items:
#             product_id = item.get("id")
#             if not product_id:
#                 continue
            
#             product = db.execute(
#                 text("SELECT id FROM products WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL"),
#                 {"id": product_id, "tid": current_user.tenant_id}
#             ).fetchone()
#             if not product:
#                 continue
            
#             updates = []
#             params = {"id": product_id}
            
#             for field in ["purchase_price", "sale_price", "weight", "length", "width", "height", "category", "brand"]:
#                 val = item.get(field)
#                 if val is not None:
#                     updates.append(f"{field} = :{field}")
#                     params[field] = val
            
#             if updates:
#                 db.execute(
#                     text(f"UPDATE products SET {', '.join(updates)}, updated_at = NOW() WHERE id = :id"),
#                     params
#                 )
#                 updated_count += 1
        
#         db.commit()
#         return {"success": True, "message": f"成功更新 {updated_count} 个产品数据", "data": {"updated": updated_count}}
#     except Exception as e:
#         db.rollback()
#         raise HTTPException(status_code=500, detail=f"批量更新失败: {str(e)}")
