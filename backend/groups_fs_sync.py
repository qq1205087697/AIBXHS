# -*- coding: utf-8 -*-
"""
groups_fs 群表补录脚本（可重复执行）

用途：当 group_messages 通过非 ORM 方式写入（原生 SQL、第三方系统等）时，
SQLAlchemy 事件监听不会触发，groups_fs 群表不会自动补录。
本脚本扫描 group_messages，完成两件事：
  1. 补录：群名不在 groups_fs 中的 → 插入群表，group_id 由 AUTO_INCREMENT 自动生成
  2. 修正：group_messages.group_id 与 groups_fs 中同群名的 group_id 不一致的 → 以群表为准统一

用法：
    python groups_fs_sync.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database.database import SessionLocal
from sqlalchemy import text


def sync_groups_fs() -> None:
    db = SessionLocal()
    try:
        # 1. 找出消息表中群名不在群表里的记录（按最早消息时间排序）
        missing = db.execute(text(
            "SELECT m.group_name, MIN(m.received_at) AS first_at "
            "FROM group_messages m "
            "LEFT JOIN groups_fs g ON g.group_name = m.group_name "
            "WHERE g.group_id IS NULL AND m.group_name IS NOT NULL AND m.group_name <> '' "
            "GROUP BY m.group_name ORDER BY first_at, MIN(m.id)"
        )).fetchall()

        # 2. 补录（group_id 由 AUTO_INCREMENT 自动生成）
        added = 0
        for group_name, _first_at in missing:
            result = db.execute(text(
                "INSERT INTO groups_fs (group_name, created_at, updated_at) "
                "VALUES (:gname, NOW(), NOW())"
            ), {"gname": group_name})
            print(f"[补录] 群ID {result.lastrowid} ← 群名「{group_name}」")
            added += 1
        db.commit()

        # 3. 修正消息表群ID与群表不一致的记录（以群表为准）
        fixed = db.execute(text(
            "UPDATE group_messages m "
            "JOIN groups_fs g ON g.group_name = m.group_name "
            "SET m.group_id = g.group_id "
            "WHERE m.group_id <> g.group_id"
        ))
        db.commit()
        print(f"[修正] {fixed.rowcount} 条消息的 group_id 已与群表对齐")

        # 4. 汇总
        total_groups = db.execute(text("SELECT COUNT(*) FROM groups_fs")).scalar()
        total_msgs = db.execute(text("SELECT COUNT(*) FROM group_messages")).scalar()
        print(f"[完成] 补录 {added} 个群；群表现共 {total_groups} 个群，消息表现共 {total_msgs} 条")
    finally:
        db.close()


if __name__ == "__main__":
    sync_groups_fs()
