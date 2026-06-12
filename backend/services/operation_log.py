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
}

ACTION_LABELS = {
    "create": "创建了",
    "update": "更新了",
    "delete": "删除了",
    "confirm": "审批了",
    "cancel": "取消了",
}


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
    action_label = ACTION_LABELS.get("update", "更新了")
    write_log(db, tenant_id, user_id, username, "product", "update", "product", product_id,
              product_name, before_data=before_data, after_data=after_data,
              summary=f"{username}{action_label}产品，编码：{product_code}，名称：{product_name}")


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
