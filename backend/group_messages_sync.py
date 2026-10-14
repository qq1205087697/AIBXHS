# -*- coding: utf-8 -*-
"""
群消息（Group Messages）一次性同步脚本

用法：
    python group_messages_sync.py "[[message_body, group_name, sender_name, message_id, received_at], ...]"
    python group_messages_sync.py "C:\\path\\to\\rows.json"   # 也支持传入 JSON 文件路径

传参格式：JSON/Python 列表，每行为 [消息主体, 群名, 发送人名称, 消息ID, 接收时间]
    received_at 支持：毫秒时间戳（如 1790063786844）或 'YYYY-MM-DD HH:MM[:SS]' 字符串
    传参无群ID，由模型事件监听按群名自动分配数字编号；groups_fs 群表自动补录

逻辑：
    1. 逐行判断 message_id 是否已存在于 group_messages 表
    2. 已存在 → 跳过
    3. 不存在 → 插入 group_messages
"""
import os
import sys
import io
import ast
from datetime import datetime, timezone, timedelta

if sys.stdout and hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 导入全部模型，注册完整 mapper（部分模型存在 relationship 交叉引用，需全部加载）
for _m in ["base", "tenant", "user", "store", "product", "inventory", "review",
           "conversation", "department", "product_selection", "data_warning",
           "product_aging_inventory", "product_sales", "product_binding",
           "ad_campaign", "ad_report", "ad_daily", "threshold_setting",
           "restock", "local_inventory", "inventory_management", "permission",
           "group_message", "product_buybox", "product_shipment_notice"]:
    __import__(f"models.{_m}")

from database.database import SessionLocal
from models.group_message import GroupMessage

CN_TZ = timezone(timedelta(hours=8))  # 北京时间


def parse_received_at(value):
    """接收时间解析：毫秒时间戳或 'YYYY-MM-DD HH:MM[:SS]' 字符串"""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=CN_TZ).replace(tzinfo=None)
    s = str(value).strip()
    if s.isdigit():
        return datetime.fromtimestamp(int(s) / 1000, tz=CN_TZ).replace(tzinfo=None)
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    raise ValueError(f'无法解析接收时间: {value}')


def message_exists(db, message_id):
    """判断相同消息ID的记录是否已存在"""
    return db.query(GroupMessage).filter(GroupMessage.message_id == message_id).first() is not None


def sync(rows):
    if not rows:
        print('传参为空，nothing to sync')
        return

    inserted, skipped = 0, 0
    db = SessionLocal()
    try:
        for idx, row in enumerate(rows, 1):
            if len(row) < 5:
                print(f'[跳过] 第{idx}行字段不足5个: {row}')
                skipped += 1
                continue
            message_body, group_name, sender_name, message_id, received_at = row[:5]
            message_body = '' if message_body is None else str(message_body)
            group_name = '' if group_name is None else str(group_name).strip()
            sender_name = '' if sender_name is None else str(sender_name).strip()
            message_id = '' if message_id is None else str(message_id).strip()

            if not message_id:
                print(f'[跳过] 第{idx}行消息ID为空: {row}')
                skipped += 1
                continue

            if message_exists(db, message_id):
                print(f'[跳过] 已存在: {message_id}')
                skipped += 1
                continue

            received_dt = parse_received_at(received_at)
            db.add(GroupMessage(
                group_name=group_name,   # group_id 由事件监听按群名自动分配数字编号
                message_body=message_body,
                message_id=message_id,
                sender_name=sender_name,
                received_at=received_dt,
            ))
            db.commit()
            print(f'[新增] {received_dt.strftime("%Y-%m-%d %H:%M")} | {group_name} | {sender_name} | {message_id}')
            inserted += 1
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f'\n同步完成：新增 {inserted} 条，跳过 {skipped} 条，共接收 {len(rows)} 行')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python group_messages_sync.py "[[消息主体, 群名, 发送人名称, 消息ID, 接收时间], ...]"')
        sys.exit(1)

    raw = sys.argv[1]
    # 支持传入文件路径（避免命令行长度限制）
    if os.path.isfile(raw):
        with open(raw, 'r', encoding='utf-8') as f:
            raw = f.read()

    try:
        data = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        import json
        data = json.loads(raw)

    if not isinstance(data, list):
        print('传参格式错误：应为 [[消息主体, 群名, 发送人名称, 消息ID, 接收时间], ...] 列表')
        sys.exit(1)

    sync(data)
