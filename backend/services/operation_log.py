import json
from datetime import datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import text


def convert_for_json(obj):
    """递归转换对象为可JSON序列化的类型"""
    if isinstance(obj, dict):
        return {k: convert_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_for_json(item) for item in obj]
    elif isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    else:
        return obj


MODULE_LABELS = {
    "inbound": "入库",
    "outbound": "出库",
    "purchase": "采购",
    "stock_transfer": "挪货",
    "product": "产品",
    "replenishment": "补货",
    "shipment": "发货",
}

ACTION_LABELS = {
    "create": "创建了",
    "update": "更新了",
    "delete": "删除了",
    "confirm": "审批了",
    "cancel": "取消了",
}


PRODUCT_FIELD_LABELS = {
    "product_code": "产品编码",
    "name": "产品名称",
    "name_en": "英文名称",
    "product_type": "产品类型",
    "product_attribute": "产品属性",
    "category": "分类",
    "brand": "品牌",
    "supplier": "供应商",
    "purchase_price": "采购价",
    "sale_price": "建议售价",
    "main_image": "主图",
    "video_url": "产品视频",
    "weight": "重量",
    "length": "长",
    "width": "宽",
    "height": "高",
    "status": "状态",
    "is_robot_monitored": "差评监控",
    "local_quantity": "本地库存",
    "local_warehouse": "本地仓库",
    "local_inbound_date": "本地入库日期",
    "local_stock_age": "本地库龄",
}


def format_field_change(field: str, old_val, new_val) -> str:
    """格式化单个字段变更为中文摘要"""
    label = PRODUCT_FIELD_LABELS.get(field, field)

    def fmt(val):
        if val is None or val == "":
            return "空"
        if field in ("main_image", "video_url"):
            # 图片/视频字段只显示是否有值
            return "有"
        if isinstance(val, bool):
            return "是" if val else "否"
        if isinstance(val, float):
            return f"{val:.2f}"
        return str(val)

    old_str = fmt(old_val)
    new_str = fmt(new_val)
    return f"{label}：{old_str} -> {new_str}"


def build_update_summary(username: str, product_code: str, product_name: str,
                         before_data: dict, after_data: dict) -> str:
    """根据 before/after 数据生成包含字段级变更的摘要"""
    changed = []
    all_keys = set(before_data.keys()) | set(after_data.keys())
    for key in sorted(all_keys):
        old_val = before_data.get(key)
        new_val = after_data.get(key)
        # 统一 None 与空字符串视为相同
        old_norm = old_val if old_val is not None else ""
        new_norm = new_val if new_val is not None else ""
        if old_norm != new_norm:
            changed.append(format_field_change(key, old_val, new_val))

    base = f"{username}更新了产品，编码：{product_code}，名称：{product_name}"
    if changed:
        return base + "，变更字段：" + "；".join(changed)
    return base


def write_log(
    db: Session,
    tenant_id: int,
    user_id: int | None,
    username: str | None,
    module: str,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    target_name: str | None = None,
    before_data: dict | None = None,
    after_data: dict | None = None,
    summary: str | None = None,
    ip_address: str | None = None,
    commit: bool = False,
):
    # 转换数据为可JSON序列化的类型
    converted_before = convert_for_json(before_data) if before_data else None
    converted_after = convert_for_json(after_data) if after_data else None
    
    db.execute(text("""
        INSERT INTO operation_logs (tenant_id, user_id, username, module, action, target_type, target_id, target_name, before_data, after_data, summary, ip_address, created_at)
        VALUES (:tenant_id, :user_id, :username, :module, :action, :target_type, :target_id, :target_name, :before_data, :after_data, :summary, :ip_address, :created_at)
    """), {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "username": username,
        "module": module,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "target_name": target_name,
        "before_data": json.dumps(converted_before, ensure_ascii=False) if converted_before else None,
        "after_data": json.dumps(converted_after, ensure_ascii=False) if converted_after else None,
        "summary": summary,
        "ip_address": ip_address,
        "created_at": datetime.now(),
    })
    if commit:
        db.commit()


def log_order_create(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                      module: str, order_id: int, order_number: str, after_data: dict):
    module_label = MODULE_LABELS.get(module, module)
    action_label = ACTION_LABELS.get("create", "创建了")
    write_log(db, tenant_id, user_id, username, module, "create", "order", order_id,
              order_number, after_data=after_data,
              summary=f"{username}{action_label}{module_label}单，单号：{order_number}")


def log_order_update(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                      module: str, order_id: int, order_number: str, before_data: dict, after_data: dict):
    module_label = MODULE_LABELS.get(module, module)
    action_label = ACTION_LABELS.get("update", "更新了")
    write_log(db, tenant_id, user_id, username, module, "update", "order", order_id,
              order_number, before_data=before_data, after_data=after_data,
              summary=f"{username}{action_label}{module_label}单，单号：{order_number}")


def log_order_confirm(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                     module: str, order_id: int, order_number: str, before_data: dict, after_data: dict):
    module_label = MODULE_LABELS.get(module, module)
    action_label = ACTION_LABELS.get("confirm", "审批了")
    write_log(db, tenant_id, user_id, username, module, "confirm", "order", order_id,
              order_number, before_data=before_data, after_data=after_data,
              summary=f"{username}{action_label}{module_label}单，单号：{order_number}")


def log_order_delete(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                      module: str, order_id: int, order_number: str, before_data: dict):
    module_label = MODULE_LABELS.get(module, module)
    action_label = ACTION_LABELS.get("delete", "删除了")
    write_log(db, tenant_id, user_id, username, module, "delete", "order", order_id,
              order_number, before_data=before_data,
              summary=f"{username}{action_label}{module_label}单，单号：{order_number}")


def log_order_cancel(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                     module: str, order_id: int, order_number: str, before_data: dict):
    module_label = MODULE_LABELS.get(module, module)
    action_label = ACTION_LABELS.get("cancel", "取消了")
    write_log(db, tenant_id, user_id, username, module, "cancel", "order", order_id,
              order_number, before_data=before_data,
              summary=f"{username}{action_label}{module_label}单，单号：{order_number}")


def log_product_create(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                      product_id: int, product_code: str, product_name: str, after_data: dict):
    action_label = ACTION_LABELS.get("create", "创建了")
    write_log(db, tenant_id, user_id, username, "product", "create", "product", product_id,
              product_name, after_data=after_data,
              summary=f"{username}{action_label}产品，编码：{product_code}，名称：{product_name}")


def log_product_update(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                      product_id: int, product_code: str, product_name: str,
                      before_data: dict, after_data: dict):
    summary = build_update_summary(username or "", product_code, product_name, before_data, after_data)
    write_log(db, tenant_id, user_id, username, "product", "update", "product", product_id,
              product_name, before_data=before_data, after_data=after_data,
              summary=summary)


def log_product_delete(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                      product_id: int, product_code: str, product_name: str, before_data: dict):
    action_label = ACTION_LABELS.get("delete", "删除了")
    write_log(db, tenant_id, user_id, username, "product", "delete", "product", product_id,
              product_name, before_data=before_data,
              summary=f"{username}{action_label}产品，编码：{product_code}，名称：{product_name}")


def log_platform_product_create(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                                product_id: int, product_name: str, platform: str, sku: str, after_data: dict):
    action_label = ACTION_LABELS.get("create", "创建了")
    write_log(db, tenant_id, user_id, username, "product", "create", "platform_product", product_id,
              f"{product_name} - {platform}", after_data=after_data,
              summary=f"{username}{action_label}{platform}平台商品，产品：{product_name}，SKU：{sku}")


def log_platform_product_update(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                                product_id: int, product_name: str, platform: str, sku: str,
                                before_data: dict, after_data: dict):
    action_label = ACTION_LABELS.get("update", "更新了")
    write_log(db, tenant_id, user_id, username, "product", "update", "platform_product", product_id,
              f"{product_name} - {platform}", before_data=before_data, after_data=after_data,
              summary=f"{username}{action_label}{platform}平台商品，产品：{product_name}，SKU：{sku}")


def log_platform_product_delete(db: Session, tenant_id: int, user_id: int | None, username: str | None,
                                product_id: int, product_name: str, platform: str, sku: str, before_data: dict):
    action_label = ACTION_LABELS.get("delete", "删除了")
    write_log(db, tenant_id, user_id, username, "product", "delete", "platform_product", product_id,
              f"{product_name} - {platform}", before_data=before_data,
              summary=f"{username}{action_label}{platform}平台商品，产品：{product_name}，SKU：{sku}")
