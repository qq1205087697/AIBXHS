from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from routers.products import _parse_store_ids

router = APIRouter(prefix="/api/base-table", tags=["base_table"])


def _get_visible_group_ids(db: Session, current_user: User):
    """数据可见范围：(is_admin, 分组ID列表)。管理员返回 (True, None) 表示不限；非管理员返回其所属分组列表"""
    is_admin = False
    if current_user.role_id:
        role_row = db.execute(
            text("SELECT code FROM roles WHERE id = :rid AND deleted_at IS NULL"),
            {"rid": current_user.role_id},
        ).fetchone()
        is_admin = bool(role_row and role_row[0] == "admin")
    if is_admin:
        return True, None
    rows = db.execute(text("""
        SELECT DISTINCT sg.id
        FROM store_groups sg
        INNER JOIN stores s ON s.group_id = sg.id
        INNER JOIN user_stores us ON us.store_id = s.id
        WHERE us.user_id = :uid AND sg.tenant_id = :tid
          AND sg.deleted_at IS NULL AND s.deleted_at IS NULL
    """), {"uid": current_user.id, "tid": current_user.tenant_id}).fetchall()
    return False, [r[0] for r in rows]


def _visible_group_cond(db: Session, current_user: User, col: str):
    """明细查询的分组过滤：(gcond, params, is_empty)。管理员不限；非管理员无分组时 is_empty=True"""
    is_admin, vis = _get_visible_group_ids(db, current_user)
    if is_admin:
        return "", {}, False
    if not vis:
        return "", {}, True
    ph = ",".join([f":vg{i}" for i in range(len(vis))])
    return f" AND {col} IN ({ph})", {f"vg{i}": gid for i, gid in enumerate(vis)}, False

# 有效补货状态（下了单但还没采购）：待审批 / 已审批未转采购
REPLENISH_PENDING_STATUS = "('pending', 'approved')"
# 有效采购状态（采购单已创建但未完全入库）：草稿 / 待审批 / 已审批 / 已采购 / 部分收货 / 待补发
# 含 draft/pending：补货单转采购单后 purchase_order_id 已设置，若不含草稿/待审批状态，
# 审批前数量会从"补货未采购"和"采购未入库"中同时消失
PURCHASE_PENDING_STATUS = "('draft', 'pending', 'approved', 'purchased', 'partial_received', 'pending_reshipment')"

# 缺平台SKU条件片段（成品且无任何非空平台SKU；配件不需要平台信息，不标识）
# {pcol}/{tcol} 分别为产品ID列与租户列
NO_SKU_COND = ("NOT EXISTS (SELECT 1 FROM platform_products pp "
               "WHERE pp.product_id = {pcol} AND pp.tenant_id = {tcol} "
               "AND pp.deleted_at IS NULL AND pp.sku IS NOT NULL AND pp.sku != '')")
NO_SKU_FULL = "(COALESCE({s}, 0) > 0 AND p.product_type LIKE '%finished%' AND " + NO_SKU_COND + ")"


@router.get("/my-groups")
async def get_my_base_table_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """分组筛选框数据源：非管理员=所属店铺分组；管理员=本租户全部分组"""
    try:
        tid = current_user.tenant_id
        is_admin, vis_group_ids = _get_visible_group_ids(db, current_user)
        if is_admin:
            rows = db.execute(text("""
                SELECT sg.id, sg.name
                FROM store_groups sg
                WHERE sg.tenant_id = :tid AND sg.deleted_at IS NULL
                ORDER BY sg.name ASC
            """), {"tid": tid}).fetchall()
        else:
            if not vis_group_ids:
                return {"success": True, "data": []}
            ph = ",".join([f":g{i}" for i in range(len(vis_group_ids))])
            params = {f"g{i}": gid for i, gid in enumerate(vis_group_ids)}
            params["tid"] = tid
            rows = db.execute(text(f"""
                SELECT sg.id, sg.name
                FROM store_groups sg
                WHERE sg.id IN ({ph}) AND sg.tenant_id = :tid AND sg.deleted_at IS NULL
                ORDER BY sg.name ASC
            """), params).fetchall()
        return {"success": True, "data": [{"group_id": r[0], "group_name": r[1]} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取用户分组列表失败: {str(e)}")


@router.get("/summary")
async def get_base_table_summary(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    issue: str = Query("all", description="all/in_stock/to_purchase/to_inbound/any_pending"),
    keyword: str = Query("", max_length=100),
    group_id: int = Query(0, description="店铺分组筛选（0=不筛选；非管理员仅限所属分组）"),
    sort_by: str = Query("", description="in_stock_qty/to_purchase_qty/to_inbound_qty/product_code"),
    sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("base_table:view"))
):
    """底表管理：每产品在库数量、补货未采购、采购未入库（服务端分页）

    性能：数据库为远程实例（RTT ~40ms，传输 2 万+ 行需 3 秒+），因此：
    - 所有聚合/筛选/排序/分页在数据库端完成，仅回传当前页 20 行；
    - 三个数据源先 UNION ALL 再按产品聚合为单一派生表（比 3 个独立派生表
      分别 JOIN 快 10 倍以上，避免 MySQL 5.7 多次 Block Nested Loop）。
    查询次数：1) 统计+总数；2) 页内行；3) 页内产品分组明细。
    说明：不显示配件；SKU 列仅显示当前登录用户所属店铺分组（或所选店铺）的平台SKU。
    """
    try:
        tid = current_user.tenant_id
        kw = keyword.strip()

        pwhere = ["p.deleted_at IS NULL", "p.tenant_id = :tid",
                  "p.product_type NOT LIKE '%accessory%'"]
        pparams: dict = {"tid": tid}
        if kw:
            pwhere.append("(p.product_code LIKE :kw OR p.name LIKE :kw OR p.id IN "
                          "(SELECT pp.product_id FROM platform_products pp "
                          "WHERE pp.tenant_id = :tid AND pp.deleted_at IS NULL AND pp.sku LIKE :kw))")
            pparams["kw"] = f"%{kw}%"

        # 数据可见范围：管理员看全部分组；非管理员仅看所属店铺分组
        is_admin, vis_group_ids = _get_visible_group_ids(db, current_user)

        # 选中分组校验：非法（分组外/不存在）按未选处理
        if group_id:
            if is_admin:
                ok = bool(db.execute(text(
                    "SELECT id FROM store_groups WHERE id = :g AND tenant_id = :t AND deleted_at IS NULL"
                ), {"g": group_id, "t": tid}).fetchone())
            else:
                ok = group_id in (vis_group_ids or [])
            if not ok:
                group_id = 0

        # 聚合过滤的分组集合：选了分组=该分组；未选=管理员全部 / 非管理员所属分组
        eff_groups = [group_id] if group_id else (None if is_admin else (vis_group_ids or []))
        gcond_a = gcond_b = gcond_c = ""
        gparams: dict = {}
        if eff_groups is not None:
            if not eff_groups:
                return {
                    "success": True,
                    "data": {"items": [], "total": 0, "page": page, "page_size": page_size,
                             "stats": {"in_stock_total": 0, "to_purchase_total": 0,
                                       "to_inbound_total": 0, "no_sku_total": 0}},
                }
            vph = ",".join([f":vg{i}" for i in range(len(eff_groups))])
            gcond_a = f" AND store_group_id IN ({vph})"
            gcond_b = f" AND ro.store_group_id IN ({vph})"
            gcond_c = f" AND poi.store_group_id IN ({vph})"
            gparams = {f"vg{i}": gid for i, gid in enumerate(eff_groups)}

        # SKU 匹配店铺集合：选了分组=该分组下店铺；未选=非管理员所属分组店铺 / 管理员全部
        sku_store_ids: set = set()
        use_all_stores = False
        if group_id:
            srows = db.execute(text("""
                SELECT id FROM stores
                WHERE group_id = :g AND tenant_id = :tid AND deleted_at IS NULL
            """), {"g": group_id, "tid": tid}).fetchall()
            sku_store_ids = {r[0] for r in srows}
        elif not is_admin and vis_group_ids:
            vph2 = ",".join([f":gs{i}" for i in range(len(vis_group_ids))])
            gsparams = {f"gs{i}": gid for i, gid in enumerate(vis_group_ids)}
            gsparams["tid"] = tid
            srows = db.execute(text(f"""
                SELECT id FROM stores
                WHERE group_id IN ({vph2}) AND tenant_id = :tid AND deleted_at IS NULL
            """), gsparams).fetchall()
            sku_store_ids = {r[0] for r in srows}
        else:
            use_all_stores = True

        # 平台SKU 映射：product_id -> 可见范围内的去重 SKU 列表
        sku_map: dict = {}
        sku_pids: set = set()
        pp_rows = db.execute(text("""
            SELECT product_id, sku, store_id FROM platform_products
            WHERE tenant_id = :tid AND deleted_at IS NULL
              AND sku IS NOT NULL AND sku != ''
        """), {"tid": tid}).fetchall()
        for pid, sku, sid_raw in pp_rows:
            sids = set(_parse_store_ids(sid_raw))
            if use_all_stores or (sids & sku_store_ids):
                sku_map.setdefault(pid, [])
                if sku not in sku_map[pid]:
                    sku_map[pid].append(sku)
                if group_id:
                    sku_pids.add(pid)

        # 选了分组：只显示与该分组相关的产品（分组内有数量，或在该分组店铺有平台SKU）
        group_sql_cond = ""
        if group_id:
            sku_part = f" OR p.id IN ({','.join(str(int(x)) for x in sku_pids)})" if sku_pids else ""
            group_sql_cond = f" AND (COALESCE(t.s, 0) + COALESCE(t.r, 0) + COALESCE(t.b, 0) > 0{sku_part})"

        issue_cond = {
            "in_stock": "COALESCE(t.s, 0) > 0",
            "to_purchase": "COALESCE(t.r, 0) > 0",
            "to_inbound": "COALESCE(t.b, 0) > 0",
            "any_pending": "(COALESCE(t.r, 0) > 0 OR COALESCE(t.b, 0) > 0)",
            # 缺平台SKU：有库存的成品且无任何非空平台SKU（配件不需要平台信息，不标识）
            "no_sku": NO_SKU_FULL.format(s="t.s", pcol="p.id", tcol="p.tenant_id"),
        }.get(issue)

        # 单一派生表：三数据源 UNION ALL 后按产品聚合（s=在库, r=补货未采购, b=采购未入库）
        # 非管理员：各数据源限定在其所属店铺分组
        union_inner = """
            SELECT product_id, SUM(current_quantity) AS s, 0 AS r, 0 AS b
            FROM inventory_batches
            WHERE tenant_id = :tid AND status = 'active'
              AND current_quantity > 0 AND deleted_at IS NULL{gcond_a}
            GROUP BY product_id
            UNION ALL
            SELECT ri.product_id, 0, SUM(ri.quantity), 0
            FROM replenishment_items ri
            JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id
            WHERE ro.deleted_at IS NULL AND ro.tenant_id = :tid
              AND ro.status IN {rs} AND ro.purchase_order_id IS NULL
              AND ri.deleted_at IS NULL{gcond_b}
            GROUP BY ri.product_id
            UNION ALL
            SELECT poi.product_id, 0, 0, SUM(GREATEST(poi.quantity - poi.received_quantity, 0))
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.purchase_order_id
            WHERE po.deleted_at IS NULL AND po.tenant_id = :tid
              AND po.status IN {ps} AND poi.deleted_at IS NULL{gcond_c}
            GROUP BY poi.product_id
        """.format(rs=REPLENISH_PENDING_STATUS, ps=PURCHASE_PENDING_STATUS,
                   gcond_a=gcond_a, gcond_b=gcond_b, gcond_c=gcond_c)
        agg_clause = ("SELECT product_id, SUM(s) AS s, SUM(r) AS r, SUM(b) AS b "
                      f"FROM ({union_inner}) u GROUP BY product_id")

        base_where = " AND ".join(pwhere)
        if issue_cond:
            base_where += f" AND {issue_cond}"

        # 1) 分页总数（含搜索/筛选条件）
        stats_row = db.execute(text(
            f"""SELECT COUNT(*) AS total
                FROM products p
                LEFT JOIN ({agg_clause}) t ON t.product_id = p.id
                WHERE {base_where}{group_sql_cond}"""
        ), {**pparams, **gparams}).fetchone()

        # 2) 全局统计卡片（不受搜索/分组筛选影响；管理员=全租户，非管理员=其可见分组总量；不含配件）
        global_stats = db.execute(text(
            f"""SELECT COALESCE(SUM(COALESCE(t.s, 0)), 0) AS in_stock_total,
                       COALESCE(SUM(COALESCE(t.r, 0)), 0) AS to_purchase_total,
                       COALESCE(SUM(COALESCE(t.b, 0)), 0) AS to_inbound_total,
                       COALESCE(SUM(CASE WHEN {NO_SKU_FULL.format(s="t.s", pcol="p.id", tcol="p.tenant_id")}
                                         THEN 1 ELSE 0 END), 0) AS no_sku_total
                FROM products p
                LEFT JOIN ({agg_clause}) t ON t.product_id = p.id
                WHERE p.deleted_at IS NULL AND p.tenant_id = :tid
                  AND p.product_type NOT LIKE '%accessory%'"""
        ), {**pparams, **gparams}).fetchone()

        # 3) 页内行（仅当前页，排序在数据库端完成）
        order_map = {
            "in_stock_qty": "in_stock_qty {o}, p.product_code ASC",
            "to_purchase_qty": "to_purchase_qty {o}, p.product_code ASC",
            "to_inbound_qty": "to_inbound_qty {o}, p.product_code ASC",
            "total_qty": "(in_stock_qty + to_purchase_qty + to_inbound_qty) {o}, p.product_code ASC",
            "product_code": "p.product_code {o}",
            "name": "p.name {o}",
        }
        if sort_by in order_map:
            o = "ASC" if sort_order == "asc" else "DESC"
            order_clause = order_map[sort_by].format(o=o)
        else:
            # 默认：有在途数据的在前，再按编码
            order_clause = "(COALESCE(t.r, 0) + COALESCE(t.b, 0)) DESC, p.product_code ASC"

        rows = db.execute(text(
            f"""SELECT p.id, p.product_code, p.name, p.product_type,
                       COALESCE(t.s, 0) AS in_stock_qty,
                       COALESCE(t.r, 0) AS to_purchase_qty,
                       COALESCE(t.b, 0) AS to_inbound_qty,
                       CASE WHEN COALESCE(t.s, 0) > 0
                            AND p.product_type LIKE '%finished%'
                            AND (SELECT COUNT(*) FROM platform_products pp
                                 WHERE pp.product_id = p.id AND pp.tenant_id = p.tenant_id
                                   AND pp.deleted_at IS NULL AND pp.sku IS NOT NULL AND pp.sku != '') = 0
                            THEN 1 ELSE 0 END AS need_sku
                FROM products p
                LEFT JOIN ({agg_clause}) t ON t.product_id = p.id
                WHERE {base_where}{group_sql_cond}
                ORDER BY {order_clause}
                LIMIT :limit OFFSET :offset"""
        ), {**pparams, **gparams, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()

        # 3) 页内产品的分组明细（按 store_group 拆分，一次 UNION 查询）
        pids = [r.id for r in rows]
        gm: dict = {}
        if pids:
            id_list = ",".join(str(int(x)) for x in pids)
            detail_sql = """
                SELECT src, product_id, COALESCE(sg.name, '未分组') AS gname, SUM(qty) AS qty
                FROM (
                    SELECT 'stock' AS src, product_id, store_group_id, SUM(current_quantity) AS qty
                    FROM inventory_batches
                    WHERE tenant_id = :tid AND status = 'active'
                      AND current_quantity > 0 AND deleted_at IS NULL
                      AND product_id IN ({ids})
                    GROUP BY product_id, store_group_id
                    UNION ALL
                    SELECT 'rep' AS src, ri.product_id, ro.store_group_id, SUM(ri.quantity)
                    FROM replenishment_items ri
                    JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id
                    WHERE ro.deleted_at IS NULL AND ro.tenant_id = :tid
                      AND ro.status IN {rs} AND ro.purchase_order_id IS NULL
                      AND ri.deleted_at IS NULL
                      AND ri.product_id IN ({ids})
                    GROUP BY ri.product_id, ro.store_group_id
                    UNION ALL
                    SELECT 'po' AS src, poi.product_id, poi.store_group_id, SUM(GREATEST(poi.quantity - poi.received_quantity, 0))
                    FROM purchase_order_items poi
                    JOIN purchase_orders po ON po.id = poi.purchase_order_id
                    WHERE po.deleted_at IS NULL AND po.tenant_id = :tid
                      AND po.status IN {ps} AND poi.deleted_at IS NULL
                      AND poi.product_id IN ({ids})
                    GROUP BY poi.product_id, poi.store_group_id
                ) t
                LEFT JOIN store_groups sg ON sg.id = t.store_group_id
                {gwhere}
                GROUP BY src, product_id, gname
                HAVING SUM(qty) > 0
            """.format(ids=id_list, rs=REPLENISH_PENDING_STATUS, ps=PURCHASE_PENDING_STATUS,
                       gwhere=("WHERE t.store_group_id IN (" + vph + ")" if not is_admin else ""))
            drows = db.execute(text(detail_sql), {"tid": tid, **gparams}).fetchall()
            for src, pid, gname, qty in drows:
                q = int(qty or 0)
                if q <= 0:
                    continue
                gm.setdefault(pid, {"stock": {}, "rep": {}, "po": {}})[src][gname] = q

        def to_groups(d: dict) -> list:
            """{分组名: 数量} -> 按 qty 降序的 [{name, qty}]"""
            pairs = sorted(d.items(), key=lambda kv: kv[1], reverse=True)
            return [{"name": n, "qty": int(q)} for n, q in pairs]

        items = []
        for row in rows:
            g = gm.get(row.id, {})
            items.append({
                "product_id": row.id,
                "product_code": row.product_code,
                "name": row.name,
                "product_type": row.product_type,
                "in_stock_qty": int(row.in_stock_qty or 0),
                "to_purchase_qty": int(row.to_purchase_qty or 0),
                "to_inbound_qty": int(row.to_inbound_qty or 0),
                # 有库存但无平台SKU的成品：需要仓库添加平台信息
                "need_sku": bool(row.need_sku),
                # 当前登录用户所属店铺分组（或所选店铺）范围内的平台SKU
                "skus": sku_map.get(row.id, []),
                "in_stock_groups": to_groups(g.get("stock", {})),
                "to_purchase_groups": to_groups(g.get("rep", {})),
                "to_inbound_groups": to_groups(g.get("po", {})),
            })

        return {
            "success": True,
            "data": {
                "items": items,
                "total": int(stats_row.total or 0),
                "page": page,
                "page_size": page_size,
                "stats": {
                    "in_stock_total": int(global_stats.in_stock_total or 0),
                    "to_purchase_total": int(global_stats.to_purchase_total or 0),
                    "to_inbound_total": int(global_stats.to_inbound_total or 0),
                    "no_sku_total": int(global_stats.no_sku_total or 0),
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
    current_user: User = Depends(PermissionChecker("base_table:view"))
):
    """某产品在各仓库的在库分布（展开行用）"""
    try:
        gcond, gp, empty = _visible_group_cond(db, current_user, "ib.store_group_id")
        if empty:
            return {"success": True, "data": []}
        rows = db.execute(text(f"""
            SELECT COALESCE(sg.name, '未分组') AS store_group_name,
                   COALESCE(ib.warehouse, '未指定仓库') AS warehouse,
                   SUM(ib.current_quantity) AS qty
            FROM inventory_batches ib
            LEFT JOIN store_groups sg ON sg.id = ib.store_group_id
            WHERE ib.product_id = :pid AND ib.tenant_id = :tid
              AND ib.status = 'active' AND ib.current_quantity > 0
              AND ib.deleted_at IS NULL{gcond}
            GROUP BY ib.store_group_id, sg.name, ib.warehouse
            ORDER BY store_group_name ASC, qty DESC
        """), {"pid": product_id, "tid": current_user.tenant_id, **gp}).fetchall()
        return {
            "success": True,
            "data": [
                {
                    "store_group_name": r.store_group_name,
                    "warehouse": r.warehouse,
                    "qty": int(r.qty or 0),
                }
                for r in rows
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取仓库分布失败: {str(e)}")


@router.get("/{product_id}/purchase-orders")
async def get_product_pending_purchase_orders(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("base_table:view"))
):
    """某产品采购未入库的采购单明细（展开行用）"""
    try:
        gcond, gp, empty = _visible_group_cond(db, current_user, "poi.store_group_id")
        if empty:
            return {"success": True, "data": []}
        rows = db.execute(text(f"""
            SELECT po.id, po.order_number, po.warehouse, po.status,
                   COALESCE(GROUP_CONCAT(DISTINCT sg.name), '未分组') AS store_group_name,
                   GROUP_CONCAT(DISTINCT NULLIF(poi.supplier, '') SEPARATOR ' / ') AS supplier,
                   SUM(GREATEST(poi.quantity - poi.received_quantity, 0)) AS pending_qty
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.purchase_order_id
                 AND po.deleted_at IS NULL AND po.tenant_id = :tid
            LEFT JOIN store_groups sg ON sg.id = poi.store_group_id
            WHERE poi.product_id = :pid AND po.status IN {PURCHASE_PENDING_STATUS}
              AND poi.deleted_at IS NULL{gcond}
            GROUP BY po.id, po.order_number, po.warehouse, po.status
            HAVING pending_qty > 0
            ORDER BY pending_qty DESC
        """), {"pid": product_id, "tid": current_user.tenant_id, **gp}).fetchall()
        return {
            "success": True,
            "data": [
                {
                    "order_id": r.id,
                    "order_number": r.order_number,
                    "store_group_name": r.store_group_name,
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
    current_user: User = Depends(PermissionChecker("base_table:view"))
):
    """某产品补货未采购的补货单明细（展开行用）"""
    try:
        gcond, gp, empty = _visible_group_cond(db, current_user, "ro.store_group_id")
        if empty:
            return {"success": True, "data": []}
        rows = db.execute(text(f"""
            SELECT ro.id, ro.order_number, ro.status,
                   COALESCE(sg.name, '未分组') AS store_group_name,
                   SUM(ri.quantity) AS pending_qty
            FROM replenishment_items ri
            JOIN replenishment_orders ro ON ro.id = ri.replenishment_order_id
                 AND ro.deleted_at IS NULL AND ro.tenant_id = :tid
            LEFT JOIN store_groups sg ON sg.id = ro.store_group_id
            WHERE ri.product_id = :pid AND ro.status IN {REPLENISH_PENDING_STATUS}
              AND ro.purchase_order_id IS NULL AND ri.deleted_at IS NULL{gcond}
            GROUP BY ro.id, ro.order_number, ro.status, sg.name
            HAVING pending_qty > 0
            ORDER BY pending_qty DESC
        """), {"pid": product_id, "tid": current_user.tenant_id, **gp}).fetchall()
        return {
            "success": True,
            "data": [
                {
                    "order_id": r.id,
                    "order_number": r.order_number,
                    "store_group_name": r.store_group_name,
                    "status": r.status,
                    "pending_qty": int(r.pending_qty or 0),
                }
                for r in rows
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取补货未采购明细失败: {str(e)}")
