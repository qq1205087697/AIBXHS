from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from database.database import get_db
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/api/base-table", tags=["base_table"])

# 有效补货状态（下了单但还没采购）：待审批 / 已审批未转采购
REPLENISH_PENDING_STATUS = "('pending', 'approved')"
# 有效采购状态（已确认采购但未完全入库）
PURCHASE_PENDING_STATUS = "('approved', 'purchased', 'partial_received', 'pending_reshipment')"


def _build_summary_query(issue: str, keyword: str, product_type: str):
    """构建底表汇总查询（产品维度：在库 / 补货未采购 / 采购未入库）"""
    in_stock_agg = """
        SELECT ib.product_id, SUM(ib.current_quantity) AS qty
        FROM inventory_batches ib
        WHERE ib.tenant_id = :tid AND ib.status = 'active'
          AND ib.current_quantity > 0 AND ib.deleted_at IS NULL
        GROUP BY ib.product_id
    """
    to_purchase_agg = """
        SELECT ri.product_id, SUM(ri.quantity) AS qty
        FROM replenishment_items ri
        JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id
             AND ro.deleted_at IS NULL AND ro.tenant_id = :tid
        WHERE ro.status IN {rs} AND ro.purchase_order_id IS NULL
          AND ri.deleted_at IS NULL
        GROUP BY ri.product_id
    """.format(rs=REPLENISH_PENDING_STATUS)
    to_inbound_agg = """
        SELECT poi.product_id, SUM(GREATEST(poi.quantity - poi.received_quantity, 0)) AS qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
             AND po.deleted_at IS NULL AND po.tenant_id = :tid
        WHERE po.status IN {ps} AND poi.deleted_at IS NULL
        GROUP BY poi.product_id
    """.format(ps=PURCHASE_PENDING_STATUS)

    base_where = ["p.deleted_at IS NULL", "p.tenant_id = :tid"]
    params: dict = {}
    if keyword:
        base_where.append("(p.product_code LIKE :kw OR p.name LIKE :kw)")
        params["kw"] = f"%{keyword}%"
    if product_type in ("finished", "accessory"):
        base_where.append("p.product_type LIKE :ptype")
        params["ptype"] = f"%{product_type}%"

    issue_cond = {
        "in_stock": "COALESCE(s.qty, 0) > 0",
        "to_purchase": "COALESCE(r.qty, 0) > 0",
        "to_inbound": "COALESCE(b.qty, 0) > 0",
        "any_pending": "(COALESCE(r.qty, 0) > 0 OR COALESCE(b.qty, 0) > 0)",
    }.get(issue)
    if issue_cond:
        base_where.append(issue_cond)

    where_sql = " AND ".join(base_where)
    body = f"""
        FROM products p
        LEFT JOIN ({in_stock_agg}) s ON s.product_id = p.id
        LEFT JOIN ({to_purchase_agg}) r ON r.product_id = p.id
        LEFT JOIN ({to_inbound_agg}) b ON b.product_id = p.id
        WHERE {where_sql}
    """
    return body, params


@router.get("/summary")
async def get_base_table_summary(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    issue: str = Query("all", description="all/in_stock/to_purchase/to_inbound/any_pending"),
    keyword: str = Query("", max_length=100),
    product_type: str = Query("", description="finished/accessory"),
    sort_by: str = Query("", description="in_stock_qty/to_purchase_qty/to_inbound_qty/product_code"),
    sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """底表管理：每产品在库数量、补货未采购、采购未入库（服务端分页）"""
    try:
        params: dict = {"tid": current_user.tenant_id}
        body, extra = _build_summary_query(issue, keyword.strip(), product_type)
        params.update(extra)

        allowed_sort = {
            "in_stock_qty": "in_stock_qty",
            "to_purchase_qty": "to_purchase_qty",
            "to_inbound_qty": "to_inbound_qty",
            "product_code": "product_code",
            "name": "name",
        }
        sort_field = allowed_sort.get(sort_by, "")
        if sort_field:
            direction = "ASC" if sort_order == "asc" else "DESC"
            order_sql = f"ORDER BY {sort_field} {direction}, p.id ASC"
        else:
            # 默认：有在途数据的在前，再按编码
            order_sql = "ORDER BY (COALESCE(r.qty,0) + COALESCE(b.qty,0)) DESC, p.product_code ASC"

        total = db.execute(
            text(f"SELECT COUNT(*) {body}"), params
        ).scalar() or 0

        stats = db.execute(text(f"""
            SELECT COALESCE(SUM(s.qty),0) AS in_stock_total,
                   COALESCE(SUM(r.qty),0) AS to_purchase_total,
                   COALESCE(SUM(b.qty),0) AS to_inbound_total {body}
        """), params).fetchone()

        rows = db.execute(text(f"""
            SELECT p.id, p.product_code, p.name, p.product_type,
                   COALESCE(s.qty, 0) AS in_stock_qty,
                   COALESCE(r.qty, 0) AS to_purchase_qty,
                   COALESCE(b.qty, 0) AS to_inbound_qty
            {body}
            {order_sql}
            LIMIT :limit OFFSET :offset
        """), {**params, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()

        items = [
            {
                "product_id": r.id,
                "product_code": r.product_code,
                "name": r.name,
                "product_type": r.product_type,
                "in_stock_qty": int(r.in_stock_qty or 0),
                "to_purchase_qty": int(r.to_purchase_qty or 0),
                "to_inbound_qty": int(r.to_inbound_qty or 0),
            }
            for r in rows
        ]
        return {
            "success": True,
            "data": {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "stats": {
                    "in_stock_total": int(stats[0] or 0),
                    "to_purchase_total": int(stats[1] or 0),
                    "to_inbound_total": int(stats[2] or 0),
                },
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取底表数据失败: {str(e)}")


@router.get("/{product_id}/warehouses")
async def get_product_warehouse_stock(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """某产品在各仓库的在库分布（展开行用）"""
    try:
        rows = db.execute(text("""
            SELECT COALESCE(ib.warehouse, '未指定仓库') AS warehouse,
                   SUM(ib.current_quantity) AS qty
            FROM inventory_batches ib
            WHERE ib.product_id = :pid AND ib.tenant_id = :tid
              AND ib.status = 'active' AND ib.current_quantity > 0
              AND ib.deleted_at IS NULL
            GROUP BY COALESCE(ib.warehouse, '未指定仓库')
            ORDER BY qty DESC
        """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()
        return {
            "success": True,
            "data": [{"warehouse": r.warehouse, "qty": int(r.qty or 0)} for r in rows],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取仓库分布失败: {str(e)}")


@router.get("/{product_id}/purchase-orders")
async def get_product_pending_purchase_orders(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """某产品采购未入库的采购单明细（展开行用）"""
    try:
        rows = db.execute(text(f"""
            SELECT po.id, po.order_number, po.warehouse, po.status,
                   GROUP_CONCAT(DISTINCT NULLIF(poi.supplier, '') SEPARATOR ' / ') AS supplier,
                   SUM(GREATEST(poi.quantity - poi.received_quantity, 0)) AS pending_qty
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.purchase_order_id
                 AND po.deleted_at IS NULL AND po.tenant_id = :tid
            WHERE poi.product_id = :pid AND po.status IN {PURCHASE_PENDING_STATUS}
              AND poi.deleted_at IS NULL
            GROUP BY po.id, po.order_number, po.warehouse, po.status
            HAVING pending_qty > 0
            ORDER BY pending_qty DESC
        """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()
        return {
            "success": True,
            "data": [
                {
                    "order_id": r.id,
                    "order_number": r.order_number,
                    "supplier": r.supplier or "",
                    "warehouse": r.warehouse or "",
                    "status": r.status,
                    "pending_qty": int(r.pending_qty or 0),
                }
                for r in rows
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取采购未入库明细失败: {str(e)}")


@router.get("/{product_id}/replenishment-orders")
async def get_product_pending_replenishment_orders(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """某产品补货未采购的补货单明细（展开行用）"""
    try:
        rows = db.execute(text(f"""
            SELECT ro.id, ro.order_number, ro.status,
                   SUM(ri.quantity) AS pending_qty
            FROM replenishment_items ri
            JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id
                 AND ro.deleted_at IS NULL AND ro.tenant_id = :tid
            WHERE ri.product_id = :pid AND ro.status IN {REPLENISH_PENDING_STATUS}
              AND ro.purchase_order_id IS NULL AND ri.deleted_at IS NULL
            GROUP BY ro.id, ro.order_number, ro.status
            HAVING pending_qty > 0
            ORDER BY pending_qty DESC
        """), {"pid": product_id, "tid": current_user.tenant_id}).fetchall()
        return {
            "success": True,
            "data": [
                {
                    "order_id": r.id,
                    "order_number": r.order_number,
                    "status": r.status,
                    "pending_qty": int(r.pending_qty or 0),
                }
                for r in rows
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取补货未采购明细失败: {str(e)}")
