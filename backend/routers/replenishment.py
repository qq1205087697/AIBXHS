from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime
from urllib.parse import quote
import io
import json
import logging
import pandas as pd
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

logger = logging.getLogger(__name__)

from database.database import get_db
from dependencies import get_current_user, PermissionChecker
from models.user import User
from services.operation_log import log_order_create
from utils.order_number import generate_replenishment_order_number

router = APIRouter(prefix="/api/replenishment-orders", tags=["replenishment_orders"])


def is_admin_user(user: User, db: Session) -> bool:
    """判断用户是否是管理员（通过 role_id）"""
    if not user.role_id:
        return False
    role = db.execute(text("""
        SELECT code FROM roles WHERE id = :role_id AND deleted_at IS NULL
    """), {"role_id": user.role_id}).fetchone()
    return role and role[0] == "admin"


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


def create_replenishment_excel_template(group_names: Optional[list] = None) -> io.BytesIO:
    """创建补货申请Excel模板

    - 店铺分组：下拉选项（数据来源为系统内全部分组），必填
    - 产品编码/SKU：选填（与品名至少填一项）
    - 品名：选填（与产品编码/SKU至少填一项）
    """
    data = {
        "店铺分组": ["", "A美", "B欧"],
        "产品编码/SKU": ["", "1001", ""],
        "品名": ["", "样例产品A", "样例产品B"],
        "补货数量": [0, 50, 100],
        "备注": ["", "样例备注1", "SKU为空时按品名匹配"]
    }
    df = pd.DataFrame(data)

    required_cols = ["店铺分组", "补货数量"]

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='补货模板')
        worksheet = writer.sheets['补货模板']

        for cell in worksheet[1]:
            if cell.value in required_cols:
                cell.value = f"*{cell.value}"

        set_auto_column_width(worksheet)
        set_required_header_style(worksheet)

        # 店铺分组下拉选项：写入隐藏工作表 + 命名区域（兼容任意数量/长度的分组名）
        names = [str(n).strip() for n in (group_names or []) if str(n).strip()]
        if names:
            wb = writer.book
            ws_opt = wb.create_sheet("分组选项")
            for i, name in enumerate(names, 1):
                ws_opt.cell(row=i, column=1, value=name)
            ws_opt.sheet_state = 'hidden'
            ref = f"分组选项!$A$1:$A${len(names)}"
            defined = DefinedName("StoreGroups", attr_text=ref)
            try:
                wb.defined_names["StoreGroups"] = defined
            except TypeError:
                wb.defined_names.append(defined)
            dv = DataValidation(type="list", formula1="StoreGroups", allow_blank=True)
            dv.error = "请从下拉列表中选择店铺分组"
            dv.errorTitle = "输入无效"
            ws = writer.sheets['补货模板']
            ws.add_data_validation(dv)
            dv.add("A2:A1000")

    output.seek(0)
    return output


def parse_replenishment_excel(file_bytes: bytes, db: Session, tenant_id: int, name_overrides: Optional[dict] = None) -> dict:
    """解析补货申请Excel，匹配产品返回预览数据。按店铺分组聚合，每组返回一个对象。

    匹配顺序：产品编码 → 平台SKU → 品名（精确匹配）。
    name_overrides: {行号: 品名} 覆盖（缺失信息弹窗中用户编辑并创建产品后，Excel中仍是旧品名，重新解析时用编辑后的品名匹配）。
    返回: {groups, errors, pending_platform_skus, new_products}
    - pending_platform_skus: 品名匹配成功但SKU缺平台商品的行（可直接导入，弹窗引导补建平台信息）
    - new_products: 全新品待创建行（品名可空，弹窗中补填后创建）
    """
    df = pd.read_excel(io.BytesIO(file_bytes))
    df.columns = df.columns.str.strip()

    col_mapping = {
        "店铺分组": "store_group",
        "店铺分组（选填）": "store_group",
        "*店铺分组": "store_group",
        "产品编码/SKU": "sku",
        "产品编码/SKU（必填）": "sku",
        "*产品编码/SKU": "sku",
        "产品编码": "sku",
        "*产品编码": "sku",
        "SKU": "sku",
        "品名": "product_name",
        "产品名称": "product_name",
        "品名（选填）": "product_name",
        "产品名称（选填）": "product_name",
        "*品名": "product_name",
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
        product_code_map[code] = (p[0], p[1], p[2], p[3])

    # 品名 -> 产品列表映射（同名产品可能有多个，需报错提示）
    product_name_map = {}
    for p in all_products:
        pname = str(p[2]).strip().lower() if p[2] else ""
        if pname:
            product_name_map.setdefault(pname, []).append(p)

    # 平台SKU -> product_id 映射
    platform_skus = db.execute(text("""
        SELECT pp.sku, pp.product_id, pp.store_id
        FROM platform_products pp
        JOIN products p ON p.id = pp.product_id
        WHERE p.tenant_id = :tid AND pp.deleted_at IS NULL AND p.deleted_at IS NULL
    """), {"tid": tenant_id}).fetchall()
    platform_sku_map = {str(s[0]).strip().lower(): s[1] for s in platform_skus if s[0]}
    # 每个产品已有的平台SKU集合（用于检查平台信息完整性：编码命中但缺平台记录时提示补建）
    product_platform_skus = {}
    for s in platform_skus:
        if s[0]:
            product_platform_skus.setdefault(s[1], set()).add(str(s[0]).strip().lower())
    # 产品 -> 已覆盖平台商品的店铺集合（store_id 为 JSON 数组，如 '[55]'）
    product_platform_store_map = {}
    for s in platform_skus:
        try:
            sids = json.loads(s[2]) if s[2] else []
        except (json.JSONDecodeError, TypeError):
            sids = []
        store_set = product_platform_store_map.setdefault(s[1], set())
        for sid in sids:
            try:
                store_set.add(int(sid))
            except (ValueError, TypeError):
                continue

    # 店铺分组 -> 分组下店铺集合
    group_stores_map = {}
    for s in db.execute(text("""
        SELECT group_id, id FROM stores
        WHERE tenant_id = :tid AND deleted_at IS NULL AND group_id IS NOT NULL
    """), {"tid": tenant_id}).fetchall():
        group_stores_map.setdefault(s[0], set()).add(s[1])

    # 查询店铺分组列表，用于名称→ID映射
    store_groups = db.execute(text("""
        SELECT id, name FROM store_groups WHERE tenant_id = :tid AND deleted_at IS NULL
    """), {"tid": tenant_id}).fetchall()
    group_name_to_id = {str(g[1]).strip().lower(): (g[0], g[1]) for g in store_groups}

    items = []
    row_errors = []
    pending_platform_skus = []
    new_products = []
    for idx, row in df.iterrows():
        row_no = idx + 2
        sku = str(row["sku"]).strip() if pd.notna(row["sku"]) else ""
        if sku == "nan":
            sku = ""
        quantity = int(row["quantity"]) if pd.notna(row["quantity"]) else 0

        # 品名列（选填）
        product_name_from_row = ""
        if "product_name" in df.columns:
            pn_val = row.get("product_name")
            product_name_from_row = str(pn_val).strip() if pd.notna(pn_val) else ""
        if product_name_from_row == "nan":
            product_name_from_row = ""
        # 品名覆盖：缺失信息弹窗中用户编辑品名并创建产品后，Excel中仍是旧品名，重新解析时用编辑后的品名
        override_name = (name_overrides or {}).get(str(row_no))
        if override_name and str(override_name).strip():
            product_name_from_row = str(override_name).strip()

        notes = str(row.get("notes", "")).strip() if pd.notna(row.get("notes")) else ""

        # 店铺分组原始值（用于空行判断）
        sg_raw = ""
        if "store_group" in df.columns:
            sg_raw = str(row["store_group"]).strip() if pd.notna(row.get("store_group")) else ""
            if sg_raw == "nan":
                sg_raw = ""

        # 纯空行（Excel 尾部带格式的空行）直接跳过，不报错
        if not sku and not product_name_from_row and quantity <= 0 and not notes and not sg_raw:
            continue

        # 收集该行所有错误，最后一次性抛出，避免用户每次只能看到一条
        errs = []
        if quantity <= 0:
            errs.append("补货数量必须大于0")
        if not sku and not product_name_from_row:
            errs.append("产品编码/SKU与品名不能同时为空，至少填写一项")
        if not sg_raw:
            errs.append("店铺分组不能为空")

        # 先按产品编码匹配，再按平台SKU匹配，最后按品名匹配（SKU为空时仍可按品名匹配）
        product_id = None
        product_name = ""
        product_code = ""  # 预览中显示产品真实编码

        # 品名匹配成功（缺平台SKU候选）/ 全新品待创建
        pending_entry = None
        new_entry = None
        # 平台信息完整性待检查的产品ID（延后到分组解析后统一判断）
        platform_check_pid = None

        val_lower = sku.lower()
        name_key = product_name_from_row.lower()
        name_hits = product_name_map.get(name_key) if name_key else None

        # 匹配优先级：品名（用户明确指定，唯一命中时优先）> 产品编码 > 平台SKU
        if name_hits and len(name_hits) == 1:
            p = name_hits[0]
            product_id = p[0]
            product_code = p[1] or ""
            product_name = p[2] or ""
            # 冲突校验：SKU/编码已绑定其他产品时，说明行数据自相矛盾，报错让用户修正
            conflict_desc = ""
            if sku:
                if val_lower in product_code_map and product_code_map[val_lower][0] != product_id:
                    cp = next((x for x in all_products if x[0] == product_code_map[val_lower][0]), None)
                    conflict_desc = f"产品编码 '{sku}' 已属于产品 [{cp[1] if cp else ''} {cp[2] if cp else ''}]"
                elif val_lower in platform_sku_map and platform_sku_map[val_lower] != product_id:
                    cp = next((x for x in all_products if x[0] == platform_sku_map[val_lower]), None)
                    conflict_desc = f"SKU '{sku}' 已绑定产品 [{cp[1] if cp else ''} {cp[2] if cp else ''}]"
            if conflict_desc:
                errs.append(
                    f"{conflict_desc}，与品名 '{product_name_from_row}' 对应的产品 [{p[1] or ''} {product_name}] 不一致，请检查后修改"
                )
            # 平台信息完整性检查：仅当该SKU不在产品的平台SKU集合中时触发；
            # 填的是产品编码时延后按分组覆盖判断，填的是其他未知SKU时提示补建（SKU为空时不提示）
            elif sku and val_lower not in product_platform_skus.get(product_id, set()):
                if val_lower == str(p[1] or "").strip().lower():
                    platform_check_pid = product_id
                else:
                    pending_entry = {
                        "row_no": row_no,
                        "product_id": product_id,
                        "product_code": p[1] or "",
                        "product_name": product_name,
                        "sku": sku,
                        "store_group_id": None,
                        "store_group_name": "",
                    }

        if not product_id:
            if sku and val_lower in product_code_map:
                pid, pcode, pname, pprice = product_code_map[val_lower]
                product_id = pid
                product_code = pcode or ""
                product_name = pname or ""
                # 平台信息完整性检查：延后到分组解析后统一判断
                if val_lower not in product_platform_skus.get(pid, set()):
                    platform_check_pid = pid
            elif sku and val_lower in platform_sku_map:
                pid = platform_sku_map[val_lower]
                product_id = pid
                for p in all_products:
                    if p[0] == pid:
                        product_code = p[1] or ""
                        product_name = p[2] or ""
                        break

        if not product_id:
            # 完全未匹配
            if name_hits:
                # 品名命中多个且SKU也无法唯一匹配
                codes = ", ".join(str(h[1]) for h in name_hits)
                errs.append(f"品名 '{product_name_from_row}' 匹配到多个产品（编码：{codes}），请改填产品编码")
            elif not sku:
                # SKU为空且品名未命中：进入待创建列表（弹窗中补填SKU和品名）
                new_entry = {
                    "row_no": row_no,
                    "sku": "",
                    "name": product_name_from_row,
                    "quantity": quantity,
                    "store_group_id": None,
                    "store_group_name": "",
                }
            else:
                # SKU非空且完全未命中：全新品待创建
                new_entry = {
                    "row_no": row_no,
                    "sku": sku,
                    "name": product_name_from_row,
                    "quantity": quantity,
                    "store_group_id": None,
                    "store_group_name": "",
                }

        # 解析店铺分组
        store_group_name = ""
        store_group_id = None
        if sg_raw:
            matched = group_name_to_id.get(sg_raw.lower())
            if matched:
                store_group_id = matched[0]
                store_group_name = matched[1]  # 使用数据库中的准确名称
            else:
                errs.append(f"店铺分组 '{sg_raw}' 不存在")

        if errs:
            row_errors.append(f"第 {row_no} 行: " + "；".join(errs))
            continue

        # 延后的平台信息完整性检查（按产品编码匹配的行）：
        # 产品在目标分组店铺上已有平台商品时直接导入；未覆盖时提示补建
        if platform_check_pid:
            owned_stores = product_platform_store_map.get(platform_check_pid, set())
            if store_group_id:
                covered = bool(group_stores_map.get(store_group_id, set()) & owned_stores)
            else:
                covered = bool(owned_stores)
            if not covered:
                pending_entry = {
                    "row_no": row_no,
                    "product_id": platform_check_pid,
                    "product_code": product_code,
                    "product_name": product_name,
                    "sku": sku,
                    # 填的是产品编码：前端允许编辑实际平台SKU（默认填产品编码）
                    "sku_is_code": True,
                    "store_group_id": None,
                    "store_group_name": "",
                }

        if pending_entry:
            pending_entry["store_group_id"] = store_group_id
            pending_entry["store_group_name"] = store_group_name
            pending_platform_skus.append(pending_entry)
            continue  # 缺平台信息的行必须补建平台SKU（重新解析）后才能导入，不进入预览

        if new_entry:
            new_entry["store_group_id"] = store_group_id
            new_entry["store_group_name"] = store_group_name
            new_products.append(new_entry)
            continue  # 新品未创建，不进入预览

        items.append({
            "product_id": product_id,
            "product_code": product_code,
            "sku": sku,
            "product_name": product_name,
            "quantity": quantity,
            "notes": notes,
            "store_group_id": store_group_id,
            "store_group_name": store_group_name,
        })

    if row_errors:
        raise ValueError("\n".join(row_errors))

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

    # 按店铺分组聚合：相同分组的明细放在一起
    grouped = {}
    for item in items:
        gkey = item["store_group_name"] or "未分组"
        if gkey not in grouped:
            grouped[gkey] = {
                "store_group_id": item["store_group_id"],
                "store_group_name": item["store_group_name"],
                "items": [],
            }
        grouped[gkey]["items"].append(item)

    return {
        "groups": list(grouped.values()),
        "errors": "\n".join(row_errors) if row_errors else None,
        "pending_platform_skus": pending_platform_skus,
        "new_products": new_products,
    }


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


class BatchApproveRequest(BaseModel):
    ids: List[int]


class BatchImportGroup(BaseModel):
    store_group_id: Optional[int] = None
    store_group_name: Optional[str] = None
    items: List[ReplenishmentItemCreate]


class BatchImportRequest(BaseModel):
    groups: List[BatchImportGroup]


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

        # 自动生成单号：RO + 时间戳
        order_number = data.order_number or generate_replenishment_order_number()

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
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:view"))
):
    """下载补货申请Excel模板（店铺分组列为下拉选项，选项为系统内全部分组）"""
    try:
        groups = db.execute(text("""
            SELECT name FROM store_groups
            WHERE tenant_id = :tid AND deleted_at IS NULL
            ORDER BY name
        """), {"tid": current_user.tenant_id}).fetchall()
        group_names = [g[0] for g in groups if g[0]]
        file_stream = create_replenishment_excel_template(group_names)
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
    name_overrides: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:create"))
):
    """上传补货申请Excel预览

    name_overrides: JSON字符串 {"行号": "品名"}，缺失信息弹窗创建产品后重新解析时传入编辑后的品名。
    """
    try:
        if not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="请上传Excel文件 (.xlsx/.xls)")

        file_bytes = await file.read()
        overrides = {}
        if name_overrides:
            try:
                raw = json.loads(name_overrides)
                if isinstance(raw, dict):
                    overrides = raw
            except Exception:
                overrides = {}
        result = parse_replenishment_excel(file_bytes, db, current_user.tenant_id, name_overrides=overrides)

        return {
            "success": True,
            "data": result["groups"],
            "errors": result["errors"],
            "pending_platform_skus": result["pending_platform_skus"],
            "new_products": result["new_products"],
        }
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
    """批量将补货申请转为一张采购单，保留每个明细的店铺分组"""
    try:
        ensure_parent_product_id_column(db)
        if not data.ids:
            raise HTTPException(status_code=400, detail="请至少选择一条补货申请")

        logger.info(f"开始批量转采购单，补货单IDs: {data.ids}")

        # 1. 查询所有选中的补货单（状态必须是 approved 且未关联采购单）
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

        order_id_to_group = {o[0]: (o[2], o[3]) for o in orders}
        order_ids = [o[0] for o in orders]

        # 2. 查询所有补货单明细，保留店铺分组
        oi_placeholders = ', '.join(f':oid{i}' for i in range(len(order_ids)))
        item_params = {f'oid{i}': order_ids[i] for i in range(len(order_ids))}

        items = db.execute(text(f"""
            SELECT ri.replenishment_order_id, ri.product_id, ri.parent_product_id, ri.quantity
            FROM replenishment_items ri
            WHERE ri.replenishment_order_id IN ({oi_placeholders}) AND ri.deleted_at IS NULL
        """), item_params).fetchall()

        if not items:
            raise HTTPException(status_code=400, detail="选中的补货单没有明细")

        # 过滤孤立配件：配件的 parent_product_id 必须在同一张补货单的成品行中存在
        finished_product_ids_by_order = {}
        for item in items:
            order_id, pid, parent_product_id = item[0], item[1], item[2]
            if order_id not in finished_product_ids_by_order:
                finished_product_ids_by_order[order_id] = set()
            if parent_product_id is None:
                finished_product_ids_by_order[order_id].add(pid)

        items = [
            item for item in items
            if item[2] is None or item[2] in finished_product_ids_by_order.get(item[0], set())
        ]

        # 按（产品、父产品、店铺分组）汇总数量
        product_agg = {}
        for item in items:
            order_id = item[0]
            pid = item[1]
            parent_product_id = item[2]
            qty = int(item[3])
            group_id, group_name = order_id_to_group.get(order_id, (None, None))
            agg_key = (pid, parent_product_id, group_id)
            if agg_key in product_agg:
                product_agg[agg_key]["quantity"] += qty
            else:
                product_agg[agg_key] = {
                    "product_id": pid,
                    "parent_product_id": parent_product_id,
                    "store_group_id": group_id,
                    "store_group_name": group_name or "未分组",
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

        # 自动选择最新创建的活跃仓库
        warehouse = None
        latest_wh = db.execute(text("""
            SELECT name FROM warehouses
            WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'active'
            ORDER BY created_at DESC LIMIT 1
        """), {"tid": current_user.tenant_id}).fetchone()
        if latest_wh:
            warehouse = latest_wh[0]

        # 3. 创建一张采购单
        now = datetime.now()
        po_number = f"PO{now.strftime('%Y%m%d%H%M%S')}01"
        db.execute(text("""
            INSERT INTO purchase_orders (tenant_id, order_number, warehouse, store_group_id,
                total_amount, status, notes, created_by, created_at, updated_at)
            VALUES (:tenant_id, :order_number, :warehouse, NULL,
                :total_amount, 'draft', :notes, :created_by, :created_at, :updated_at)
        """), {
            "tenant_id": current_user.tenant_id,
            "order_number": po_number,
            "warehouse": warehouse,
            "total_amount": total_amount,
            "notes": data.notes,
            "created_by": current_user.id,
            "created_at": now,
            "updated_at": now,
        })
        po_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

        logger.info(f"采购单已创建，ID: {po_id}，单号: {po_number}")

        # 创建采购单明细，保留店铺分组
        for agg in product_agg.values():
            pid = agg["product_id"]
            parent_product_id = agg["parent_product_id"]
            unit_price = price_map.get(pid, 0.0)
            total_price = agg["quantity"] * unit_price
            db.execute(text("""
                INSERT INTO purchase_order_items (purchase_order_id, product_id, parent_product_id, store_group_id, quantity, unit_price,
                    total_price, supplier, notes, created_at, updated_at)
                VALUES (:purchase_order_id, :product_id, :parent_product_id, :store_group_id, :quantity, :unit_price, :total_price, :supplier, :notes, :created_at, :updated_at)
            """), {
                "purchase_order_id": po_id,
                "product_id": pid,
                "parent_product_id": parent_product_id,
                "store_group_id": agg["store_group_id"],
                "quantity": agg["quantity"],
                "unit_price": unit_price,
                "total_price": total_price,
                "supplier": "",
                "notes": "",
                "created_at": now,
                "updated_at": now,
            })

        # 更新补货单关联采购单ID
        for order_id in order_ids:
            db.execute(text("""
                UPDATE replenishment_orders
                SET purchase_order_id = :po_id, updated_at = :updated_at
                WHERE id = :id
            """), {
                "po_id": po_id,
                "updated_at": now,
                "id": order_id,
            })

        db.commit()

        return {
            "success": True,
            "message": f"已将 {len(orders)} 条补货申请转为 1 张采购单",
            "data": {
                "purchase_order_numbers": [po_number],
                "converted_count": len(orders),
                "po_count": 1,
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


@router.post("/batch-import")
async def batch_import_replenishment_orders(
    data: BatchImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:create"))
):
    """批量导入补货单：按店铺分组创建多张补货单"""
    try:
        ensure_parent_product_id_column(db)
        if not data.groups:
            raise HTTPException(status_code=400, detail="无导入数据")

        now = datetime.now()
        created_orders = []

        for group in data.groups:
            if not group.items:
                continue

            # 验证 store_group_id
            store_group_name = group.store_group_name or ""
            if group.store_group_id:
                sg = db.execute(text("""
                    SELECT name FROM store_groups
                    WHERE id = :gid AND tenant_id = :tid AND deleted_at IS NULL
                """), {"gid": group.store_group_id, "tid": current_user.tenant_id}).fetchone()
                if sg:
                    store_group_name = sg[0]

            order_number = generate_replenishment_order_number()

            db.execute(text("""
                INSERT INTO replenishment_orders (tenant_id, order_number, store_group_id, status, notes,
                    created_by, created_at, updated_at)
                VALUES (:tenant_id, :order_number, :store_group_id, 'pending', :notes,
                    :created_by, :created_at, :updated_at)
            """), {
                "tenant_id": current_user.tenant_id,
                "order_number": order_number,
                "store_group_id": group.store_group_id,
                "notes": "",
                "created_by": current_user.id,
                "created_at": now,
                "updated_at": now,
            })
            order_id = db.execute(text("SELECT LAST_INSERT_ID()")).scalar()

            for item in group.items:
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
                    "created_at": now,
                    "updated_at": now,
                })

            log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                             "replenishment", order_id, order_number,
                             {"操作": "导入", "店铺分组": store_group_name, "明细数量": len(group.items)})

            created_orders.append({
                "id": order_id,
                "order_number": order_number,
                "store_group_id": group.store_group_id,
                "store_group_name": store_group_name,
                "item_count": len(group.items),
            })

        db.commit()

        return {
            "success": True,
            "message": f"成功导入 {len(created_orders)} 张补货单",
            "data": created_orders,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量导入补货单失败: {str(e)}")


@router.post("/batch-approve")
async def batch_approve_replenishment_orders(
    data: BatchApproveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(PermissionChecker("replenishment:approve"))
):
    """批量审批补货单"""
    try:
        if not data.ids:
            raise HTTPException(status_code=400, detail="请选择要审批的补货单")

        ids_placeholders = ', '.join(f':id{i}' for i in range(len(data.ids)))
        params = {f'id{i}': data.ids[i] for i in range(len(data.ids))}
        params["tenant_id"] = current_user.tenant_id

        rows = db.execute(text(f"""
            SELECT id, order_number, status FROM replenishment_orders
            WHERE id IN ({ids_placeholders}) AND tenant_id = :tenant_id AND deleted_at IS NULL
        """), params).fetchall()

        if not rows:
            raise HTTPException(status_code=400, detail="未找到可审批的补货单")

        invalid = [row[1] for row in rows if row[2] != "pending"]
        if invalid:
            raise HTTPException(status_code=400, detail=f"以下补货单不是待审批状态，无法审批: {', '.join(invalid)}")

        now = datetime.now()
        for row in rows:
            db.execute(text("""
                UPDATE replenishment_orders
                SET status = 'approved', approved_by = :approved_by, approved_at = :approved_at, updated_at = :updated_at
                WHERE id = :id
            """), {
                "id": row[0],
                "approved_by": current_user.id,
                "approved_at": now,
                "updated_at": now,
            })
            log_order_create(db, current_user.tenant_id, current_user.id, current_user.nickname or current_user.username,
                             "replenishment", row[0], row[1],
                             {"操作": "审批", "状态": "pending → approved"})

        db.commit()
        return {"success": True, "message": f"成功审批 {len(rows)} 条补货单"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"批量审批补货单失败: {str(e)}")


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
        if not is_admin_user(current_user, db):
            raise HTTPException(status_code=403, detail="只有管理员可以取消审批")

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
