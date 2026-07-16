from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote
import io
import logging
import pandas as pd
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font

logger = logging.getLogger(__name__)

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create

router = APIRouter(prefix="/api/replenishment-orders", tags=["replenishment_orders"])


# ============ Excel 模板/解析辅助函数（内联，不修改 excel_helper.py） ============

def set_auto_column_width(worksheet):
    """设置工作表列宽自适应"""
    for column_cells in worksheet.columns:
        length = 0
        column = column_cells[0].column_letter
        for cell in column_cells:
            try:
                if len(str(cell.value)) > length:
                    length = len(str(cell.value))
            except:
                pass
        adjusted_width = min(max(length + 2, 10), 50)  # 最小10，最大50
        worksheet.column_dimensions[column].width = adjusted_width


def set_required_header_style(worksheet):
    """设置表头样式 - 所有表头非粗体，必填项*号为红色"""
    for col in worksheet.columns:
        header_cell = col[0]
        header_cell.font = Font(bold=False)

    try:
        from openpyxl.cell.rich_text import TextBlock, CellRichText
        from openpyxl.cell.text import InlineFont
        from openpyxl.styles.colors import Color

        red_inline_font = InlineFont()
        red_inline_font.color = Color(rgb="FFFF0000")
        red_inline_font.bold = False

        black_inline_font = InlineFont()
        black_inline_font.bold = False

        for col in worksheet.columns:
            header_cell = col[0]
            if header_cell.value and isinstance(header_cell.value, str):
                value = header_cell.value
                if value.startswith("*"):
                    header_cell.value = CellRichText(
                        TextBlock(red_inline_font, "*"),
                        TextBlock(black_inline_font, value[1:])
                    )
    except Exception:
        pass


def create_replenishment_excel_template() -> io.BytesIO:
    """创建补货申请Excel模板"""
    data = {
        "产品编码/SKU": ["", "1001", "SKU-001"],
        "补货数量": [0, 50, 100],
        "备注": ["", "样例备注1", "样例备注2"]
    }
    df = pd.DataFrame(data)

    required_cols = ["产品编码/SKU", "补货数量"]

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='补货模板')
        worksheet = writer.sheets['补货模板']

        for cell in worksheet[1]:
            if cell.value in required_cols:
                cell.value = f"*{cell.value}"

        set_auto_column_width(worksheet)
        set_required_header_style(worksheet)

    output.seek(0)
    return output


def parse_replenishment_excel(file_bytes: bytes, db: Session, tenant_id: int) -> List[dict]:
    """解析补货申请Excel，匹配产品返回预览数据"""
    df = pd.read_excel(io.BytesIO(file_bytes))
    df.columns = df.columns.str.strip()

    col_mapping = {
        "产品编码/SKU": "sku",
        "产品编码/SKU（必填）": "sku",
        "*产品编码/SKU": "sku",
        "产品编码": "sku",
        "*产品编码": "sku",
        "SKU": "sku",
        "补货数量": "quantity",
        "补货数量（必填）": "quantity",
        "*补货数量": "quantity",
        "备注": "notes",
        "备注（选填）": "notes",
    }
    df = df.rename(columns={k: v for k, v in col_mapping.items() if k in df.columns})

    required_cols = ["sku", "quantity"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"缺少必需列: {col}")

    # 一次性查询所有产品到内存，避免逐行查询导致连接超时
    all_products = db.execute(text("""
        SELECT id, product_code, name, purchase_price
        FROM products
        WHERE tenant_id = :tid AND deleted_at IS NULL
        ORDER BY product_code
    """), {"tid": tenant_id}).fetchall()

    product_code_map = {}
    for p in all_products:
        code = str(p[1]).strip().lower()
        product_code_map[code] = (p[0], p[2], p[3])

    # 平台SKU -> product_id 映射
    platform_skus = db.execute(text("""
        SELECT pp.sku, pp.product_id
        FROM platform_products pp
        JOIN products p ON p.id = pp.product_id
        WHERE p.tenant_id = :tid AND pp.deleted_at IS NULL AND p.deleted_at IS NULL
    """), {"tid": tenant_id}).fetchall()
    platform_sku_map = {str(s[0]).strip().lower(): s[1] for s in platform_skus if s[0]}

    items = []
    for idx, row in df.iterrows():
        sku = str(row["sku"]).strip() if pd.notna(row["sku"]) else ""
        quantity = int(row["quantity"]) if pd.notna(row["quantity"]) else 0

        if not sku or sku == "nan":
            raise ValueError(f"第 {idx + 2} 行: 产品编码/SKU不能为空")
        if quantity <= 0:
            raise ValueError(f"第 {idx + 2} 行: 补货数量必须大于0")

        # 先按产品编码匹配，再按平台SKU匹配
        product_id = None
        product_name = ""
        val_lower = sku.lower()

        if val_lower in product_code_map:
            pid, pname, pprice = product_code_map[val_lower]
            product_id = pid
            product_name = pname or ""
        elif val_lower in platform_sku_map:
            pid = platform_sku_map[val_lower]
            product_id = pid
            for p in all_products:
                if p[0] == pid:
                    product_name = p[2] or ""
                    break

        if not product_id:
            raise ValueError(f"第 {idx + 2} 行: 产品编码/SKU '{sku}' 不存在")

        notes = str(row.get("notes", "")).strip() if pd.notna(row.get("notes")) else ""

        items.append({
            "product_id": product_id,
            "product_code": sku,
            "product_name": product_name,
            "quantity": quantity,
            "notes": notes,
        })

    # 查询这些产品绑定的配件（成品→配件）
    product_ids = list(set(item["product_id"] for item in items))
    bindings_map = {}
    if product_ids:
        pids_tuple = tuple(product_ids)
        bindings = db.execute(text("""
            SELECT pb.finished_product_id, p.id AS accessory_product_id, p.product_code, p.name, p.purchase_price, pb.quantity
            FROM product_bindings pb
            JOIN products p ON p.id = pb.accessory_product_id
            WHERE pb.finished_product_id IN :fids AND pb.deleted_at IS NULL AND p.deleted_at IS NULL
        """), {"fids": pids_tuple}).fetchall()
        for b in bindings:
            bindings_map.setdefault(b[0], []).append({
                "accessory_product_id": b[1],
                "code": b[2], "name": b[3], "unit_price": float(b[4]) if b[4] else 0.0, "qty": int(b[5])
            })

    for item in items:
        item["bindings"] = bindings_map.get(item["product_id"], [])

    return items


# ============ Pydantic Schema ============

class ReplenishmentItemCreate(BaseModel):
    product_id: int
    quantity: int
    notes: Optional[str] = None
    parent_product_id: Optional[int] = None


class ReplenishmentOrderCreate(BaseModel):
    order_number: Optional[str] = None
    store_group_id: Optional[int] = None
    notes: Optional[str] = None
    items: List[ReplenishmentItemCreate]


class ReplenishmentItemUpdate(BaseModel):
    product_id: int
    quantity: int
    notes: Optional[str] = None
    parent_product_id: Optional[int] = None


class ReplenishmentOrderUpdate(BaseModel):
    store_group_id: Optional[int] = None
    notes: Optional[str] = None
    items: Optional[List[ReplenishmentItemUpdate]] = None


class BatchConvertRequest(BaseModel):
    ids: List[int]
    notes: Optional[str] = None


def ensure_parent_product_id_column(db: Session):
    """确保补货明细保留配件来源成品，避免转采购时同配件被错误合并。"""
    try:
        db.execute(text("""
            ALTER TABLE replenishment_items
            ADD COLUMN parent_product_id INT NULL
            COMMENT '配件来源的成品ID，成品行为空'
            AFTER product_id
        """))
    except Exception:
        pass
    supplier: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None


# ============ 路由 ============

@router.get("/")
async def get_replenishment_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    store_group_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:view"))
):
    try:
        where_conditions = ["ro.tenant_id = :tenant_id", "ro.deleted_at IS NULL"]
        params = {"tenant_id": current_user.tenant_id}

        if status:
            where_conditions.append("ro.status = :status")
            params["status"] = status
        if store_group_id:
            where_conditions.append("ro.store_group_id = :store_group_id")
            params["store_group_id"] = store_group_id
        if search:
            where_conditions.append("ro.order_number LIKE :search")
            params["search"] = f"%{search}%"

        where_clause = " AND ".join(where_conditions)

        total = db.execute(text(f"SELECT COUNT(*) FROM replenishment_orders ro WHERE {where_clause}"), params).scalar() or 0

        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        rows = db.execute(text(f"""
            SELECT ro.id, ro.order_number, ro.store_group_id, ro.platform, ro.status, ro.notes,
                   ro.created_by, ro.purchase_order_id, ro.created_at, ro.updated_at,
                   ro.approved_by, ro.approved_at,
                   po.order_number AS purchase_order_number,
                   sg.name AS store_group_name
            FROM replenishment_orders ro
            LEFT JOIN purchase_orders po ON po.id = ro.purchase_order_id
            LEFT JOIN store_groups sg ON sg.id = ro.store_group_id AND sg.deleted_at IS NULL
            WHERE {where_clause}
            ORDER BY ro.created_at DESC
            LIMIT :limit OFFSET :offset
        """), params).fetchall()

        # 收集用户ID并批量查询（包括创建人和审批人）
        user_ids = set()
        for row in rows:
            if row[6]:  # created_by
                user_ids.add(row[6])
            if row[10]:  # approved_by
                user_ids.add(row[10])

        user_map = {}
        if user_ids:
            if len(user_ids) == 1:
                user_id = next(iter(user_ids))
                user_rows = db.execute(text(
                    "SELECT id, nickname, username FROM users WHERE id = :id"
                ), {"id": user_id}).fetchall()
            else:
                placeholders = ', '.join(f':id{i}' for i in range(len(user_ids)))
                user_id_list = list(user_ids)
                user_params = {f'id{i}': user_id_list[i] for i in range(len(user_id_list))}
                user_rows = db.execute(text(
                    f"SELECT id, nickname, username FROM users WHERE id IN ({placeholders})"
                ), user_params).fetchall()
            for ur in user_rows:
                user_map[ur[0]] = ur[1] or ur[2] or ''

        orders = []
        for row in rows:
            item_count = db.execute(text("""
                SELECT COUNT(*) FROM replenishment_items
                WHERE replenishment_order_id = :oid AND deleted_at IS NULL
            """), {"oid": row[0]}).scalar() or 0

            orders.append({
                "id": row[0],
                "order_number": row[1],
                "store_group_id": row[2],
                "store_group_name": row[13] or "",
                "platform": row[3] or "",
                "status": str(row[4]).lower() if row[4] else "pending",
                "notes": row[5] or "",
                "created_by": row[6],
                "purchase_order_id": row[7],
                "created_at": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else "",
                "updated_at": row[9].strftime("%Y-%m-%d %H:%M:%S") if row[9] else "",
                "approved_by": row[10],
                "approver_name": user_map.get(row[10], ""),
                "approved_at": row[11].strftime("%Y-%m-%d %H:%M:%S") if row[11] else "",
                "creator_name": user_map.get(row[6], ""),
                "item_count": item_count,
                "purchase_order_number": row[12] or "",
            })

        return {"success": True, "data": orders, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取补货申请列表失败: {str(e)}")


@router.post("/")
async def create_replenishment_order(
    data: ReplenishmentOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:create"))
):
    try:
        ensure_parent_product_id_column(db)
        if not data.items:
            raise HTTPException(status_code=400, detail="请至少添加一条补货明细")

        # 验证 store_group_id 是否存在
        store_group_name = ""
        if data.store_group_id:
            group = db.execute(text("""
                SELECT id, name FROM store_groups
                WHERE id = :gid AND tenant_id = :tid AND deleted_at IS NULL
            """), {"gid": data.store_group_id, "tid": current_user.tenant_id}).fetchone()
            if not group:
                raise HTTPException(status_code=400, detail=f"店铺分组ID {data.store_group_id} 不存在")
            store_group_name = group[1]

        # 自动生成单号：RP + 时间戳
        order_number = data.order_number or f"RP{datetime.now().strftime('%Y%m%d%H%M%S%f')}"

        db.execute(text("""
            INSERT INTO replenishment_orders (tenant_id, order_number, store_group_id, status, notes,
                created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :store_group_id, 'pending', :notes,
                :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "order_number": order_number,
            "store_group_id": data.store_group_id,
            "notes": data.notes,
            "created_by": current_user.id,
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        })
        order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        for item in data.items:
            db.execute(text("""
                INSERT INTO replenishment_items (tenant_id, replenishment_order_id, product_id, parent_product_id, quantity,
                    notes, created_at, updated_at)
                VALUES (:tenant_id, :replenishment_order_id, :product_id, :parent_product_id, :quantity,
                    :notes, :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "replenishment_order_id": order_id,
                "product_id": item.product_id,
                "parent_product_id": item.parent_product_id,
                "quantity": item.quantity,
                "notes": item.notes,
                "created_at": datetime.now(),
                "updated_at": datetime.now(),
            })

        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "replenishment", order_id, order_number,
                         {"单号": order_number, "店铺分组": store_group_name, "明细数量": len(data.items)})
        db.commit()

        return {"success": True, "message": "补货申请创建成功", "data": {"id": order_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"创建补货申请失败: {str(e)}")


@router.get("/template/download")
async def download_replenishment_template(
    current_user: User = Depends(PermissionChecker("replenishment:view"))
):
    """下载补货申请Excel模板"""
    try:
        file_stream = create_replenishment_excel_template()
        filename = f"补货申请模板_{datetime.now().strftime('%Y%m%d')}.xlsx"
        encoded_filename = quote(filename)
        return StreamingResponse(
            file_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={encoded_filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载模板失败: {str(e)}")


@router.post("/upload/preview")
async def upload_replenishment_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:create"))
):
    """上传补货申请Excel预览"""
    try:
        if not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="请上传Excel文件 (.xlsx/.xls)")

        file_bytes = await file.read()
        items = parse_replenishment_excel(file_bytes, db, current_user.tenant_id)

        return {"success": True, "data": items}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"{str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析Excel失败: {str(e)}")


@router.post("/batch-convert")
async def batch_convert_to_purchase_order(
    data: BatchConvertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:convert"))
):
    """批量将补货申请转为采购单，同店铺分组的补货单合并为同一张采购单"""
    try:
        ensure_parent_product_id_column(db)
        if not data.ids:
            raise HTTPException(status_code=400, detail="请至少选择一条补货申请")

        logger.info(f"开始批量转采购单，补货单IDs: {data.ids}")

        # 1. 查询所有选中的补货单（状态必须是 pending 且未关联采购单）
        ids_placeholders = ', '.join(f':id{i}' for i in range(len(data.ids)))
        order_params = {f'id{i}': data.ids[i] for i in range(len(data.ids))}
        order_params["tenant_id"] = current_user.tenant_id

        orders = db.execute(text(f"""
            SELECT ro.id, ro.order_number, ro.store_group_id, sg.name AS store_group_name
            FROM replenishment_orders ro
            LEFT JOIN store_groups sg ON sg.id = ro.store_group_id AND sg.deleted_at IS NULL
            WHERE ro.id IN ({ids_placeholders}) AND ro.tenant_id = :tenant_id
              AND ro.deleted_at IS NULL AND ro.status = 'approved' AND ro.purchase_order_id IS NULL
            ORDER BY ro.created_at ASC
        """), order_params).fetchall()

        if not orders:
            raise HTTPException(status_code=400, detail="未找到可转换的补货申请（需为已审批且未关联采购单）")

        # 2. 店铺分组分组
        group_groups = {}  # store_group_id -> [(id, order_number, group_name), ...]
        for o in orders:
            group_id = o[2] or 0
            group_name = o[3] or "未分组"
            if group_id not in group_groups:
                group_groups[group_id] = []
            group_groups[group_id].append((o[0], o[1], group_name))

        group_summary = ', '.join(f'{k or "未分组"}: {len(v)}条' for k, v in group_groups.items())
        logger.info(f"按店铺分组分组: {group_summary}")

        # 自动选择最新创建的活跃仓库
        warehouse = None
        latest_wh = db.execute(text("""
            SELECT name FROM warehouses
            WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'active'
            ORDER BY created_at DESC LIMIT 1
        """), {"tid": current_user.tenant_id}).fetchone()
        if latest_wh:
            warehouse = latest_wh[0]

        # 3. 按店铺分组分组创建采购单
        created_po_numbers = []
        now = datetime.now()
        po_seq = 0

        for store_group_id, group_orders in group_groups.items():
            group_order_ids = [o[0] for o in group_orders]
            group_name = group_orders[0][2] if group_orders else "未分组"

            # 查询该组补货单的明细
            oi_placeholders = ', '.join(f':oid{i}' for i in range(len(group_order_ids)))
            item_params = {f'oid{i}': group_order_ids[i] for i in range(len(group_order_ids))}

            items = db.execute(text(f"""
                SELECT ri.product_id, ri.parent_product_id, ri.quantity
                FROM replenishment_items ri
                WHERE ri.replenishment_order_id IN ({oi_placeholders}) AND ri.deleted_at IS NULL
            """), item_params).fetchall()

            if not items:
                continue

            # 按产品ID汇总数量
            product_agg = {}
            for item in items:
                pid = item[0]
                parent_product_id = item[1]
                qty = int(item[2])
                agg_key = (pid, parent_product_id)
                if agg_key in product_agg:
                    product_agg[agg_key]["quantity"] += qty
                else:
                    product_agg[agg_key] = {
                        "product_id": pid,
                        "parent_product_id": parent_product_id,
                        "quantity": qty,
                    }

            # 查询产品采购价
            all_pids = list({agg["product_id"] for agg in product_agg.values()})
            price_map = {}
            if all_pids:
                pid_placeholders = ', '.join(f':pid{i}' for i in range(len(all_pids)))
                pid_params = {f'pid{i}': all_pids[i] for i in range(len(all_pids))}
                price_rows = db.execute(text(f"""
                    SELECT id, purchase_price FROM products WHERE id IN ({pid_placeholders})
                """), pid_params).fetchall()
                for pr in price_rows:
                    price_map[pr[0]] = float(pr[1]) if pr[1] else 0.0

            total_amount = sum(
                agg["quantity"] * price_map.get(agg["product_id"], 0.0)
                for agg in product_agg.values()
            )

            # 创建采购单（供应商等字段已移至明细表）
            po_seq += 1
            po_number = f"PO{now.strftime('%Y%m%d%H%M%S')}{po_seq:02d}"
            db.execute(text("""
                INSERT INTO purchase_orders (tenant_id, order_number, warehouse, store_group_id,
                    total_amount, status, notes, created_by, created_at, updated_at)
                VALUES (:tenant_id, :order_number, :warehouse, :store_group_id,
                    :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "order_number": po_number,
                "warehouse": warehouse,
                "store_group_id": store_group_id if store_group_id != 0 else None,
                "total_amount": total_amount,
                "notes": data.notes,
                "created_by": current_user.id,
                "created_at": now,
                "updated_at": now,
            })
            po_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

            logger.info(f"采购单已创建，ID: {po_id}，单号: {po_number}，店铺分组: {group_name}")

            # 创建采购单明细（供应商字段设置为空，后续在采购单页面编辑）
            for agg in product_agg.values():
                pid = agg["product_id"]
                unit_price = price_map.get(pid, 0.0)
                total_price = agg["quantity"] * unit_price
                db.execute(text("""
                    INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_price,
                        total_price, supplier, notes, created_at, updated_at)
                    VALUES (:purchase_order_id, :product_id, :quantity, :unit_price, :total_price, :supplier, :notes, :created_at, :updated_at)
                """), {
                    "purchase_order_id": po_id,
                    "product_id": pid,
                    "quantity": agg["quantity"],
                    "unit_price": unit_price,
                    "total_price": total_price,
                    "supplier": "",  # 供应商字段设置为空，后续在采购单页面编辑
                    "notes": "",  # 备注
                    "created_at": now,
                    "updated_at": now,
                })

            # 更新补货单关联采购单ID
            for order_id, _, _ in group_orders:
                db.execute(text("""
                    UPDATE replenishment_orders
                    SET purchase_order_id = :po_id, updated_at = :updated_at
                    WHERE id = :id
                """), {
                    "po_id": po_id,
                    "updated_at": now,
                    "id": order_id,
                })

            created_po_numbers.append(po_number)
            logger.info(f"已关联 {len(group_orders)} 条补货单到采购单 {po_number}")

        db.commit()

        return {
            "success": True,
            "message": f"已将 {len(orders)} 条补货申请转为 {len(created_po_numbers)} 张采购单",
            "data": {
                "purchase_order_numbers": created_po_numbers,
                "converted_count": len(orders),
                "po_count": len(created_po_numbers),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量转采购单失败: {str(e)}")


@router.get("/{order_id}")
async def get_replenishment_order_detail(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:view"))
):
    try:
        row = db.execute(text("""
            SELECT ro.id, ro.order_number, ro.store_group_id, ro.platform, ro.status, ro.notes, ro.created_by,
                   ro.purchase_order_id, ro.created_at, ro.updated_at,
                   sg.name AS store_group_name
            FROM replenishment_orders ro
            LEFT JOIN store_groups sg ON sg.id = ro.store_group_id AND sg.deleted_at IS NULL
            WHERE ro.id = :id AND ro.tenant_id = :tid AND ro.deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="补货申请不存在")

        ensure_parent_product_id_column(db)
        items = db.execute(text("""
            SELECT ri.id, ri.product_id, ri.parent_product_id, p.product_code, p.name, ri.quantity, ri.notes
            FROM replenishment_items ri
            LEFT JOIN products p ON p.id = ri.product_id
            WHERE ri.replenishment_order_id = :oid AND ri.deleted_at IS NULL
        """), {"oid": order_id}).fetchall()

        order_items = []
        for item in items:
            order_items.append({
                "id": item[0],
                "product_id": item[1],
                "parent_product_id": item[2],
                "product_code": item[3] or "",
                "product_name": item[4] or f"product#{item[1]}",
                "quantity": int(item[5]),
                "notes": item[6] or "",
            })

        return {
            "success": True,
            "data": {
                "id": row[0],
                "order_number": row[1],
                "store_group_id": row[2],
                "store_group_name": row[10] or "",
                "platform": row[3] or "",
                "status": str(row[4]).lower() if row[4] else "pending",
                "notes": row[5] or "",
                "created_by": row[6],
                "purchase_order_id": row[7],
                "created_at": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else "",
                "updated_at": row[9].strftime("%Y-%m-%d %H:%M:%S") if row[9] else "",
                "items": order_items,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取补货申请详情失败: {str(e)}")


@router.put("/{order_id}")
async def update_replenishment_order(
    order_id: int,
    data: ReplenishmentOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:edit"))
):
    try:
        row = db.execute(text("""
            SELECT id, order_number, status FROM replenishment_orders
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="补货申请不存在")
        if row[2] != "pending":
            raise HTTPException(status_code=400, detail="只能修改待处理状态的补货申请")

        ensure_parent_product_id_column(db)
        updates = []
        params = {"id": order_id}
        for field in ["store_group_id", "notes"]:
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field} = :{field}")
                params[field] = val

        # 如果有items，先软删除旧的items再插入新的
        if data.items is not None:
            if len(data.items) == 0:
                raise HTTPException(status_code=400, detail="请至少添加一条补货明细")
            db.execute(text(
                "UPDATE replenishment_items SET deleted_at = NOW() WHERE replenishment_order_id = :oid"
            ), {"oid": order_id})
            for item in data.items:
                db.execute(text("""
                    INSERT INTO replenishment_items (tenant_id, replenishment_order_id, product_id, parent_product_id, quantity,
                        notes, created_at, updated_at)
                    VALUES (:tenant_id, :replenishment_order_id, :product_id, :parent_product_id, :quantity,
                        :notes, :created_at, :updated_at)
                """), {
                    "tenant_id": current_user.tenant_id,
                    "replenishment_order_id": order_id,
                    "product_id": item.product_id,
                    "parent_product_id": item.parent_product_id,
                    "quantity": item.quantity,
                    "notes": item.notes,
                    "created_at": datetime.now(),
                    "updated_at": datetime.now(),
                })

        if updates:
            updates.append("updated_at = NOW()")
            db.execute(text(f"UPDATE replenishment_orders SET {', '.join(updates)} WHERE id = :id"), params)

        db.commit()

        return {"success": True, "message": "补货申请更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新补货申请失败: {str(e)}")


@router.delete("/{order_id}")
async def delete_replenishment_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:delete"))
):
    try:
        row = db.execute(text("""
            SELECT id, order_number FROM replenishment_orders
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="补货申请不存在")

        db.execute(text("UPDATE replenishment_orders SET deleted_at = NOW() WHERE id = :id"), {"id": order_id})
        db.execute(text(
            "UPDATE replenishment_items SET deleted_at = NOW() WHERE replenishment_order_id = :oid"
        ), {"oid": order_id})
        db.commit()

        return {"success": True, "message": "补货申请已删除"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除补货申请失败: {str(e)}")


@router.post("/batch-delete")
async def batch_delete_replenishment_orders(
    data: BatchConvertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:delete"))
):
    """批量删除补货申请"""
    try:
        if not data.ids:
            raise HTTPException(status_code=400, detail="请选择要删除的补货单")

        # Soft delete the orders and their items
        order_placeholders = ', '.join([f':id{i}' for i in range(len(data.ids))])
        order_params = {**{f'id{i}': data.ids[i] for i in range(len(data.ids))}, "tid": current_user.tenant_id}

        db.execute(text(f"""
            UPDATE replenishment_orders SET deleted_at = NOW()
            WHERE id IN ({order_placeholders}) AND tenant_id = :tid AND deleted_at IS NULL
        """), order_params)

        item_placeholders = ', '.join([f':oid{i}' for i in range(len(data.ids))])
        item_params = {**{f'oid{i}': data.ids[i] for i in range(len(data.ids))}}

        db.execute(text(f"""
            UPDATE replenishment_items SET deleted_at = NOW()
            WHERE replenishment_order_id IN ({item_placeholders}) AND deleted_at IS NULL
        """), item_params)

        db.commit()
        return {"success": True, "message": f"成功删除 {len(data.ids)} 条补货单"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量删除失败: {str(e)}")


@router.post("/{order_id}/approve")
async def approve_replenishment_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:approve"))
):
    """审批补货单"""
    try:
        row = db.execute(text("""
            SELECT id, order_number, status FROM replenishment_orders
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="补货申请不存在")
        if row[2] != "pending":
            raise HTTPException(status_code=400, detail=f"当前状态为'{row[2]}'，只能审批待审批状态的补货单")

        db.execute(text("""
            UPDATE replenishment_orders
            SET status = 'approved', approved_by = :approved_by, approved_at = :approved_at, updated_at = :updated_at
            WHERE id = :id
        """), {
            "id": order_id,
            "approved_by": current_user.id,
            "approved_at": datetime.now(),
            "updated_at": datetime.now(),
        })
        db.commit()

        log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                         "replenishment", order_id, row[1],
                         {"操作": "审批", "状态": "pending → approved"})
        db.commit()

        return {"success": True, "message": "补货单审批成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"审批补货单失败: {str(e)}")


@router.post("/{order_id}/cancel-approval")
async def cancel_replenishment_approval(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """管理员取消补货单审批"""
    try:
        # 检查用户是否是管理员
        await check_permission("admin", current_user, db)

        row = db.execute(text("""
            SELECT id, order_number, status FROM replenishment_orders
            WHERE id = :id AND tenant_id = :tid AND deleted_at IS NULL
        """), {"id": order_id, "tid": current_user.tenant_id}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="补货申请不存在")

        current_status = row[2]
        if current_status != "approved":
            raise HTTPException(status_code=400, detail="只有已审批状态的补货单才能取消审批")

        # 取消审批：状态改为 pending，清除审批人和审批时间
        db.execute(text("""
            UPDATE replenishment_orders
            SET status = 'pending', approved_by = NULL, approved_at = NULL, updated_at = NOW()
            WHERE id = :id
        """), {"id": order_id})
        db.commit()

        return {"success": True, "message": "取消审批成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"取消审批失败: {str(e)}")
