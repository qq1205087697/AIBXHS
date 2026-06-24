#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.database import engine
from sqlalchemy import text

TABLES = ["inventory_snapshots", "replenishment_decisions"]

with engine.connect() as conn:
    for table in TABLES:
        result = conn.execute(text("""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = :table_name
            AND COLUMN_NAME = 'is_holiday'
        """), {"table_name": table}).fetchall()

        if not result:
            conn.execute(text(f"""
                ALTER TABLE {table}
                ADD COLUMN is_holiday TINYINT(1) DEFAULT 0 COMMENT '节日产品标记'
            """))
            conn.commit()
            print(f"Field added: {table}.is_holiday")
        else:
            print(f"Field already exists: {table}.is_holiday")
