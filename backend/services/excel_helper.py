import io
from typing import List, Dict, Any, Optional
from datetime import datetime
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import text
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font


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
    # 设置所有表头为非粗体
    for col in worksheet.columns:
        header_cell = col[0]
        header_cell.font = Font(bold=False)
    
    # 尝试使用富文本仅将*号设为红色
    try:
        from openpyxl.cell.rich_text import TextBlock, CellRichText
        from openpyxl.cell.text import InlineFont
        from openpyxl.styles.colors import Color
        
        # 创建红色InlineFont
        red_inline_font = InlineFont()
        red_inline_font.color = Color(rgb="FFFF0000")
        red_inline_font.bold = False
        
        # 创建黑色InlineFont
        black_inline_font = InlineFont()
        black_inline_font.bold = False
        
        for col in worksheet.columns:
            header_cell = col[0]
            if header_cell.value and isinstance(header_cell.value, str):
                value = header_cell.value
                if value.startswith("*"):
                    # 构建富文本：*号红色，其余黑色，都非粗体
                    header_cell.value = CellRichText(
                        TextBlock(red_inline_font, "*"),
                        TextBlock(black_inline_font, value[1:])
                    )
    except Exception as e:
        # 如果富文本不可用，就保持原样（带*号的非粗体黑色文本）
        pass


def create_inbound_excel_template() -> io.BytesIO:
    """创建入库单Excel模板"""
    data = {
        "产品编码": ["", "1001", "1002"],
        "入库数量": [0, 50, 100],
        "货架号": ["", "SHELF-A1", "SHELF-B2"],
        "备注": ["", "样例备注1", "样例备注2"]
    }
    df = pd.DataFrame(data)
    
    # 标记哪些是必填列
    required_cols = ["产品编码", "入库数量"]
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='入库模板')
        worksheet = writer.sheets['入库模板']
        
        # 先给必填列表头添加*号
        for cell in worksheet[1]:
            if cell.value in required_cols:
                cell.value = f"*{cell.value}"
        
        set_auto_column_width(worksheet)
        set_required_header_style(worksheet)
    
    output.seek(0)
    return output


def parse_inbound_excel(file_bytes: bytes, db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """解析入库单Excel"""
    df = pd.read_excel(io.BytesIO(file_bytes))
    df.columns = df.columns.str.strip()
    
    # 映射列名（支持新旧三种格式）
    col_mapping = {
        "产品编码": "product_code",
        "产品编码（必填）": "product_code",
        "*产品编码": "product_code",
        "入库数量": "quantity",
        "入库数量（必填）": "quantity",
        "*入库数量": "quantity",
        "货架号": "shelf_number",
        "货架号（选填）": "shelf_number",
        "备注": "notes",
        "备注（选填）": "notes"
    }
    df = df.rename(columns={k: v for k, v in col_mapping.items() if k in df.columns})
    
    # 验证必需列
    required_cols = ["product_code", "quantity"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"缺少必需列: {col}")
    
    # 查询所有产品，用于错误提示
    all_products = db.execute(text("""
        SELECT product_code, name 
        FROM products 
        WHERE tenant_id = :tid AND deleted_at IS NULL
        ORDER BY product_code
    """), {"tid": tenant_id}).fetchall()
    
    product_list_str = ""
    if all_products:
        product_list_str = "\n\n系统中存在的产品编码：\n" + "\n".join([
            f"  • {code} - {name}" 
            for code, name in all_products
        ])
    
    items = []
    for idx, row in df.iterrows():
        product_code = str(row["product_code"]).strip() if pd.notna(row["product_code"]) else ""
        quantity = int(row["quantity"]) if pd.notna(row["quantity"]) else 0
        
        if not product_code or product_code == "nan":
            raise ValueError(f"第 {idx + 2} 行: 产品编码不能为空")
        
        if quantity <= 0:
            raise ValueError(f"第 {idx + 2} 行: 入库数量必须大于0")
        
        # 查询产品
        product = db.execute(text("""
            SELECT id, name, purchase_price 
            FROM products 
            WHERE tenant_id = :tid AND product_code = :code AND deleted_at IS NULL
        """), {"tid": tenant_id, "code": product_code}).fetchone()
        
        if not product:
            raise ValueError(f"第 {idx + 2} 行: 产品编码 '{product_code}' 不存在{product_list_str}")
        
        items.append({
            "product_id": product[0],
            "quantity": quantity,
            "unit_price": float(product[2]) if product[2] else 0,
            "shelf_number": str(row.get("shelf_number", "")).strip() if pd.notna(row.get("shelf_number")) else "",
            "notes": str(row.get("notes", "")).strip() if pd.notna(row.get("notes")) else ""
        })
    return items


def create_purchase_excel_template() -> io.BytesIO:
    """创建采购单Excel模板"""
    data = {
        "产品编码": ["", "1001", "1002"],
        "SKU": ["", "SKU-001", "SKU-002"],
        "品名": ["", "产品A", "产品B"],
        "采购链接": ["", "https://...", "https://..."],
        "产品图": ["", "https://...", "https://..."],
        "收货仓库": ["", "主仓库", "分仓A"],
        "采购数量": [0, 50, 100],
        "备注": ["", "样例备注1", "样例备注2"]
    }
    df = pd.DataFrame(data)
    
    # 标记哪些是必填列
    required_cols = ["产品编码", "采购数量"]
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='采购模板')
        worksheet = writer.sheets['采购模板']
        
        # 先给必填列表头添加*号
        for cell in worksheet[1]:
            if cell.value in required_cols:
                cell.value = f"*{cell.value}"
        
        set_auto_column_width(worksheet)
        set_required_header_style(worksheet)
    
    output.seek(0)
    return output


def parse_purchase_excel(file_bytes: bytes, db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """解析采购单Excel"""
    df = pd.read_excel(io.BytesIO(file_bytes))
    df.columns = df.columns.str.strip()
    
    # 映射列名（支持新旧三种格式）
    col_mapping = {
        "产品编码": "product_code",
        "产品编码（必填）": "product_code",
        "*产品编码": "product_code",
        "SKU": "sku",
        "SKU（选填）": "sku",
        "品名": "name",
        "品名（选填）": "name",
        "采购链接": "purchase_link",
        "采购链接（选填）": "purchase_link",
        "产品图": "product_image",
        "产品图（选填）": "product_image",
        "收货仓库": "warehouse",
        "收货仓库（选填）": "warehouse",
        "采购数量": "quantity",
        "采购数量（必填）": "quantity",
        "*采购数量": "quantity",
        "备注": "notes",
        "备注（选填）": "notes"
    }
    df = df.rename(columns={k: v for k, v in col_mapping.items() if k in df.columns})
    
    # 验证必需列
    required_cols = ["product_code", "quantity"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"缺少必需列: {col}")
    
    items = []
    for idx, row in df.iterrows():
        product_code = str(row["product_code"]).strip() if pd.notna(row["product_code"]) else ""
        quantity = int(row["quantity"]) if pd.notna(row["quantity"]) else 0
        
        if not product_code or product_code == "nan":
            raise ValueError(f"第 {idx + 2} 行: 产品编码不能为空")
        
        if quantity <= 0:
            raise ValueError(f"第 {idx + 2} 行: 采购数量必须大于0")
        
        # 查询产品
        product = db.execute(text("""
            SELECT id, name, purchase_price 
            FROM products 
            WHERE tenant_id = :tid AND product_code = :code AND deleted_at IS NULL
        """), {"tid": tenant_id, "code": product_code}).fetchone()
        
        if not product:
            raise ValueError(f"第 {idx + 2} 行: 产品编码 {product_code} 不存在")
        
        items.append({
            "product_id": product[0],
            "quantity": quantity,
            "unit_price": float(product[2]) if product[2] else 0,
            "warehouse": str(row.get("warehouse", "")).strip() if pd.notna(row.get("warehouse")) else "",
            "notes": str(row.get("notes", "")).strip() if pd.notna(row.get("notes")) else ""
        })
    return items


def create_outbound_excel_template() -> io.BytesIO:
    """创建出库单Excel模板"""
    data = {
        "产品编码/SKU": ["", "SKU-001", "SKU-002"],
        "品名": ["", "产品A", "产品B"],
        "出货箱数": [0, 5, 10],
        "备注": ["", "样例备注1", "样例备注2"]
    }
    df = pd.DataFrame(data)
    
    # 标记哪些是必填列
    required_cols = ["产品编码/SKU", "出货箱数"]
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='出库模板')
        worksheet = writer.sheets['出库模板']
        
        # 先给必填列表头添加*号
        for cell in worksheet[1]:
            if cell.value in required_cols:
                cell.value = f"*{cell.value}"
        
        set_auto_column_width(worksheet)
        set_required_header_style(worksheet)
    
    output.seek(0)
    return output


def create_product_excel_template() -> io.BytesIO:
    """创建产品导入Excel模板（含产品和平台商品两个页签）"""
    # 产品数据页签
    product_data = {
        "产品编码": ["P001", "P002"],
        "产品名称": ["示例产品A", "示例产品B"],
        "英文名称": ["Product A", "Product B"],
        "产品类型": ["成品", "配件"],
        "产品属性": ["通货", "定制品"],
        "分类": ["电子产品", "配件类"],
        "品牌": ["品牌A", "品牌B"],
        "采购价": [50.00, 25.50],
        "建议售价": [99.00, 49.00],
        "主图URL": ["https://", "https://"],
        "重量(kg)": [0.5, 0.2],
        "长(cm)": [20.0, 15.0],
        "宽(cm)": [10.0, 8.0],
        "高(cm)": [5.0, 3.0],
        "状态": ["启用", "启用"],
    }
    df_products = pd.DataFrame(product_data)
    
    # 平台商品页签
    platform_data = {
        "产品编码": ["P001", "P001", "P001"],
        "平台": ["Amazon", "Shopify", "Amazon"],
        "店铺名称": ["美国店铺", "独立站", "美国店铺 | 独立站"],
        "站点": ["US", "主站", "US | 主站"],
        "平台商品ID": ["", "", ""],
        "ASIN": ["B001234567", "", ""],
        "SPU": ["", "SPU-001", ""],
        "SKU": ["SKU-P001-AMZ", "SKU-P001-SPF", "SKU-AMZ-SPF"],
        "标题": ["示例标题A - Amazon", "示例标题A - Shopify", "多店铺示例"],
        "英文标题": ["Example Title A - Amazon", "Example Title A - Shopify", "Multi-store Example"],
        "图片URL": ["https://", "https://", "https://"],
        "币种": ["USD", "USD", "USD"],
        "售价": [19.99, 29.99, 19.99],
        "成本价": [12.00, 15.00, 12.00],
        "状态": ["启用", "启用", "启用"],
    }
    df_platform = pd.DataFrame(platform_data)
    
    # 标记必填列
    product_required_cols = ["产品编码", "产品名称"]
    platform_required_cols = ["产品编码", "平台", "店铺名称"]
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_products.to_excel(writer, index=False, sheet_name='产品')
        df_platform.to_excel(writer, index=False, sheet_name='平台商品')
        
        # 处理产品页签
        product_ws = writer.sheets['产品']
        for cell in product_ws[1]:
            if cell.value in product_required_cols:
                cell.value = f"*{cell.value}"
        
        # 处理平台商品页签
        platform_ws = writer.sheets['平台商品']
        for cell in platform_ws[1]:
            if cell.value in platform_required_cols:
                cell.value = f"*{cell.value}"
        
        # 设置两个页签的列宽和样式
        set_auto_column_width(product_ws)
        set_auto_column_width(platform_ws)
        set_required_header_style(product_ws)
        set_required_header_style(platform_ws)
    
    output.seek(0)
    return output


def parse_product_excel(file_bytes: bytes, db: Session, tenant_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """解析产品导入Excel（支持多页签）"""
    excel_file = pd.ExcelFile(io.BytesIO(file_bytes))
    
    products = []
    platform_products = []
    
    # 解析产品页签
    if "产品" in excel_file.sheet_names or "产品导入模板" in excel_file.sheet_names:
        sheet_name = "产品" if "产品" in excel_file.sheet_names else "产品导入模板"
        df = pd.read_excel(excel_file, sheet_name=sheet_name)
        df.columns = df.columns.str.strip()
        
        # 映射列名（支持新旧三种格式）
        col_mapping = {
            "产品编码": "product_code",
            "产品编码（必填）": "product_code",
            "*产品编码": "product_code",
            "产品名称": "name",
            "产品名称（必填）": "name",
            "*产品名称": "name",
            "英文名称": "name_en",
            "英文名称（选填）": "name_en",
            "产品类型": "product_type",
            "产品类型（选填）": "product_type",
            "产品属性": "product_attribute",
            "产品属性（选填）": "product_attribute",
            "分类": "category",
            "分类（选填）": "category",
            "品牌": "brand",
            "品牌（选填）": "brand",
            "采购价": "purchase_price",
            "采购价（选填）": "purchase_price",
            "建议售价": "sale_price",
            "建议售价（选填）": "sale_price",
            "主图URL": "main_image",
            "主图URL（选填）": "main_image",
            "重量(kg)": "weight",
            "重量(kg)（选填）": "weight",
            "长(cm)": "length",
            "长(cm)（选填）": "length",
            "宽(cm)": "width",
            "宽(cm)（选填）": "width",
            "高(cm)": "height",
            "高(cm)（选填）": "height",
            "状态": "status",
            "状态（选填）": "status",
        }
        df = df.rename(columns={k: v for k, v in col_mapping.items() if k in df.columns})
        
        if "product_code" not in df.columns or "name" not in df.columns:
            raise ValueError("缺少必需列: 产品编码、产品名称")
        
        status_map = {"启用": "active", "停用": "inactive", "归档": "archived"}
        type_map = {"成品": "finished", "配件": "accessory"}
        attr_map = {"通货": "general", "定制品": "custom"}
        
        for idx, row in df.iterrows():
            product_code = str(row["product_code"]).strip() if pd.notna(row["product_code"]) else ""
            name = str(row["name"]).strip() if pd.notna(row["name"]) else ""
            
            if not product_code or product_code == "nan":
                raise ValueError(f"产品页签第 {idx + 2} 行: 产品编码不能为空")
            if not name or name == "nan":
                raise ValueError(f"产品页签第 {idx + 2} 行: 产品名称不能为空")
            
            if product_code in [item.get("product_code") for item in products]:
                raise ValueError(f"产品页签第 {idx + 2} 行: 产品编码 '{product_code}' 重复")
            
            row_data = {"product_code": product_code, "name": name}
            
            for field in ["name_en", "category", "brand", "main_image"]:
                val = row.get(field)
                row_data[field] = str(val).strip() if pd.notna(val) and str(val).strip() != "nan" else None
            
            product_type_str = row.get("product_type")
            if pd.notna(product_type_str) and str(product_type_str).strip() != "nan":
                types = [t.strip() for t in str(product_type_str).split(",")]
                row_data["product_type"] = [type_map.get(t, t) for t in types]
            else:
                row_data["product_type"] = None
            
            attr_val = row.get("product_attribute")
            if pd.notna(attr_val) and str(attr_val).strip() != "nan":
                row_data["product_attribute"] = attr_map.get(str(attr_val).strip(), str(attr_val).strip())
            else:
                row_data["product_attribute"] = None
            
            for field in ["purchase_price", "sale_price", "weight", "length", "width", "height"]:
                val = row.get(field)
                try:
                    row_data[field] = float(val) if pd.notna(val) and str(val).strip() not in ("", "nan") else None
                except (ValueError, TypeError):
                    row_data[field] = None
            
            status_val = row.get("status")
            if pd.notna(status_val) and str(status_val).strip() != "nan":
                row_data["status"] = status_map.get(str(status_val).strip(), "active")
            else:
                row_data["status"] = "active"
            
            products.append(row_data)
    
    # 解析平台商品页签
    if "平台商品" in excel_file.sheet_names:
        df = pd.read_excel(excel_file, sheet_name="平台商品")
        df.columns = df.columns.str.strip()
        
        # 映射列名
        col_mapping = {
            "产品编码": "product_code",
            "产品编码（必填）": "product_code",
            "*产品编码": "product_code",
            "平台": "platform",
            "平台（必填）": "platform",
            "*平台": "platform",
            "店铺名称": "store_name",
            "店铺名称（必填）": "store_name",
            "*店铺名称": "store_name",
            "站点": "store_site",
            "站点（选填）": "store_site",
            "*站点": "store_site",
            "平台商品ID": "platform_product_id",
            "ASIN": "asin",
            "SPU": "spu",
            "SKU": "sku",
            "标题": "title",
            "英文标题": "title_en",
            "图片URL": "image_url",
            "币种": "currency",
            "售价": "price",
            "成本价": "cost_price",
            "状态": "status",
        }
        df = df.rename(columns={k: v for k, v in col_mapping.items() if k in df.columns})
        
        # 检查必需列
        required_cols = ["product_code", "platform", "store_name"]
        for col in required_cols:
            if col not in df.columns:
                raise ValueError(f"平台商品页签缺少必需列: {col}")
        
        status_map = {"启用": "active", "停用": "inactive", "归档": "archived"}
        valid_platforms = {"amazon", "ebay", "walmart", "shopify", "shopee", "lazada", "tiktok", "other"}
        platform_aliases = {
            "amazon": "amazon",
            "amazon": "amazon",
            "ebay": "ebay",
            "walmart": "walmart",
            "shopify": "shopify",
            "shopee": "shopee",
            "lazada": "lazada",
            "tiktok": "tiktok",
            "tiktok shop": "tiktok",
            "other": "other",
        }
        
        for idx, row in df.iterrows():
            product_code = str(row["product_code"]).strip() if pd.notna(row["product_code"]) else ""
            platform = str(row["platform"]).strip().lower() if pd.notna(row["platform"]) else ""
            store_name = str(row["store_name"]).strip() if pd.notna(row["store_name"]) else ""
            store_site = str(row["store_site"]).strip() if pd.notna(row.get("store_site")) and str(row.get("store_site")) != "nan" else None
            
            if not product_code or product_code == "nan":
                raise ValueError(f"平台商品页签第 {idx + 2} 行: 产品编码不能为空")
            if not platform or platform == "nan":
                raise ValueError(f"平台商品页签第 {idx + 2} 行: 平台不能为空")
            
            # 验证平台
            normalized_platform = platform_aliases.get(platform, platform)
            if normalized_platform not in valid_platforms:
                raise ValueError(f"平台商品页签第 {idx + 2} 行: 平台 '{platform}' 无效，有效平台: {', '.join(valid_platforms)}")
            platform = normalized_platform
            
            if not store_name or store_name == "nan":
                raise ValueError(f"平台商品页签第 {idx + 2} 行: 店铺名称不能为空")
            
            store_names = [s.strip() for s in store_name.split("|") if s.strip()]
            store_sites = [s.strip() for s in (store_site or "").split("|") if s.strip()] if store_site else []
            if not store_sites:
                store_sites = [None] * len(store_names)
            if len(store_names) != len(store_sites):
                raise ValueError(f"平台商品页签第 {idx + 2} 行: 店铺名称和站点的数量不一致 ({len(store_names)} vs {len(store_sites)})")
            
            row_data = {
                "product_code": product_code,
                "platform": platform,
                "store_name": store_name,
                "store_site": store_site,
                "store_names": store_names,
                "store_sites": store_sites,
            }
            
            for field in ["platform_product_id", "asin", "spu", "sku", "title", "title_en", "image_url", "currency"]:
                val = row.get(field)
                row_data[field] = str(val).strip() if pd.notna(val) and str(val).strip() != "nan" else None
            
            for field in ["price", "cost_price"]:
                val = row.get(field)
                try:
                    row_data[field] = float(val) if pd.notna(val) and str(val).strip() not in ("", "nan") else None
                except (ValueError, TypeError):
                    row_data[field] = None
            
            status_val = row.get("status")
            if pd.notna(status_val) and str(status_val).strip() != "nan":
                row_data["status"] = status_map.get(str(status_val).strip(), "active")
            else:
                row_data["status"] = "active"
            
            platform_products.append(row_data)
    
    return {
        "products": products,
        "platform_products": platform_products
    }


def parse_outbound_excel(file_bytes: bytes, db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """解析出库单Excel"""
    df = pd.read_excel(io.BytesIO(file_bytes))
    df.columns = df.columns.str.strip()
    
    # 映射列名（同时支持新旧三种格式）
    col_mapping = {
        "产品编码/SKU": "sku",
        "产品编码/SKU（必填）": "sku",
        "*产品编码/SKU": "sku",
        "SKU": "sku",
        "品名": "product_name",
        "品名（选填）": "product_name",
        "出货箱数": "quantity",
        "出货箱数（必填）": "quantity",
        "*出货箱数": "quantity",
        "产品编码": "sku",
        "出库数量": "quantity",
        "备注": "notes",
        "备注（选填）": "notes"
    }
    df = df.rename(columns={k: v for k, v in col_mapping.items() if k in df.columns})
    
    # 验证必需列
    required_cols = ["sku", "quantity"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"缺少必需列: {col}")
    
    # 查询所有产品和平台产品，用于错误提示和匹配
    all_products = db.execute(text("""
        SELECT p.id, p.product_code, p.name 
        FROM products p
        WHERE p.tenant_id = :tid AND p.deleted_at IS NULL
        ORDER BY p.product_code
    """), {"tid": tenant_id}).fetchall()
    
    all_platform_products = db.execute(text("""
        SELECT pp.sku, pp.product_id
        FROM platform_products pp
        WHERE pp.tenant_id = :tid AND pp.deleted_at IS NULL
    """), {"tid": tenant_id}).fetchall()
    
    # 构建产品匹配字典
    product_code_map = {p[1]: (p[0], p[2]) for p in all_products}  # product_code -> (product_id, name)
    platform_sku_map = {pp[0]: pp[1] for pp in all_platform_products if pp[0]}  # platform_sku -> product_id
    
    # 构建错误提示信息
    product_list_str = ""
    if all_products:
        product_list_str = "\n\n系统中存在的产品编码/平台SKU：\n" + "\n".join([
            f"  • {code} - {name}" 
            for _, code, name in all_products
        ])
    
    items = []
    for idx, row in df.iterrows():
        sku = str(row["sku"]).strip() if pd.notna(row["sku"]) else ""
        quantity = int(row["quantity"]) if pd.notna(row["quantity"]) else 0
        
        if not sku or sku == "nan":
            raise ValueError(f"第 {idx + 2} 行: 产品编码/SKU不能为空")
        
        if quantity <= 0:
            raise ValueError(f"第 {idx + 2} 行: 出库数量必须大于0")
        
        product_id = None
        product_name = ""
        purchase_price = None
        
        # 首先尝试通过产品编码匹配
        if sku in product_code_map:
            product_id, product_name = product_code_map[sku]
            # 获取产品价格
            product = db.execute(text("""
                SELECT purchase_price 
                FROM products 
                WHERE id = :pid AND deleted_at IS NULL
            """), {"pid": product_id}).fetchone()
            if product:
                purchase_price = product[0]
        
        # 如果产品编码没匹配到，尝试通过平台SKU匹配
        elif sku in platform_sku_map:
            product_id = platform_sku_map[sku]
            # 获取产品信息
            product = db.execute(text("""
                SELECT id, name, purchase_price 
                FROM products 
                WHERE id = :pid AND deleted_at IS NULL
            """), {"pid": product_id}).fetchone()
            if product:
                product_name = product[1]
                purchase_price = product[2]
        
        # 如果都没匹配到，报错
        if product_id is None:
            raise ValueError(f"第 {idx + 2} 行: SKU/产品编码 '{sku}' 不存在{product_list_str}")
        
        items.append({
            "product_id": product_id,
            "quantity": quantity,
            "unit_price": float(purchase_price) if purchase_price else 0,
            "notes": str(row.get("notes", "")).strip() if pd.notna(row.get("notes")) else ""
        })
    return items
