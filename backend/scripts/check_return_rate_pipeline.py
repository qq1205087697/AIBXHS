#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
退货率字段全链路自检（只读，不写库）

覆盖：
  1. FIELD_MAPPING 的每个 value 是否都是 inventory_snapshots 的真实列（防空映射）
  2. 用真实 Excel 模拟 column rename + 清洗，确认 6 个退货率列进入 available_columns
  3. 模型属性 inventory_snapshots.return_rate_* 是否存在
  4. 只读调用 search_inventory，确认返回体含 return_rate_30d / return_rate_60d

用法：cd backend && python scripts/check_return_rate_pipeline.py [xlsx路径]
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from database.database import SessionLocal
from services.inventory_service import FIELD_MAPPING, NUMERIC_FIELDS

# 预注册全部模型：Tenant 等模型的 relationship 引用了其它类，
# 只导入 models.restock 会在 mapper 配置期报 InvalidRequestError
import importlib
import pkgutil
import models

for _m in pkgutil.iter_modules(models.__path__):
    importlib.import_module(f"models.{_m.name}")

XLSX = sys.argv[1] if len(sys.argv) > 1 else r"D:\RPA流程文件\补货建议数据\2026-09-15\结果.xlsx"
RETURN_FIELDS = [
    "return_rate_3d", "return_rate_7d", "return_rate_14d",
    "return_rate_30d", "return_rate_60d", "return_rate_90d",
]
FAILS = []


def check(label, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILS.append(label)


db = SessionLocal()
try:
    # ---- 1. 映射 vs 库表 ----
    db_cols = {r[0] for r in db.execute(text("SHOW COLUMNS FROM inventory_snapshots")).fetchall()}
    bad = sorted({v for v in FIELD_MAPPING.values() if v not in db_cols})
    check("FIELD_MAPPING 所有目标字段存在于 inventory_snapshots", not bad, f"缺失: {bad}")

    missing = [f for f in RETURN_FIELDS if f not in db_cols]
    check("6 个退货率字段已建表", not missing, f"缺失: {missing}")

    # ---- 2. 导入列选择模拟 ----
    if os.path.exists(XLSX):
        import pandas as pd
        df = pd.read_excel(XLSX, nrows=200)
        df = df.rename(columns={k: v for k, v in FIELD_MAPPING.items() if k in df.columns})
        available_columns = [c for c in FIELD_MAPPING.values() if c in df.columns] + ["snapshot_date", "tenant_id"]
        hit = [f for f in RETURN_FIELDS if f in available_columns]
        check("Excel 重命名后 6 个退货率进入 available_columns", len(hit) == 6, f"命中 {len(hit)}/6: {hit}")

        # 与毛利率同策略：不做 fillna(0) 强转
        forced_zero = [f for f in RETURN_FIELDS if f in NUMERIC_FIELDS]
        check("退货率未被加入 NUMERIC_FIELDS（与 gross_margin 一致）",
              not forced_zero and "gross_margin" not in NUMERIC_FIELDS,
              f"误加入: {forced_zero}")
        if "return_rate_30d" in df.columns:
            print(f"        抽样 return_rate_30d dtype={df['return_rate_30d'].dtype}, "
                  f"空值={int(df['return_rate_30d'].isna().sum())}/{len(df)}")
    else:
        check("样例 Excel 存在", False, XLSX)

    # ---- 3. 模型属性 ----
    from models.restock import InventorySnapshot
    missing_attr = [f for f in RETURN_FIELDS if not hasattr(InventorySnapshot, f)]
    check("InventorySnapshot 模型属性齐全", not missing_attr, f"缺失: {missing_attr}")

    # ---- 4. 查询层实读：主表 ----
    from services.inventory_service import search_inventory, get_summary_children
    res = search_inventory(db, tenant_id=1, page=1, page_size=3, sort_field="return_rate_30d", sort_order="desc")
    items = res.get("items", [])
    if items:
        keys_ok = all("return_rate_30d" in i and "return_rate_60d" in i for i in items)
        check("search_inventory 返回退货率字段", keys_ok,
              f"样例值 30d={items[0].get('return_rate_30d')}, 60d={items[0].get('return_rate_60d')}")
    else:
        check("search_inventory 有数据可验", False, "tenant_id=1 无数据")

    # ---- 5. 查询层实读：汇总行子行（首行有值、子行必须也有值） ----
    summary_asin = db.execute(text(
        "SELECT asin FROM inventory_snapshots WHERE summary_flag='是' AND deleted_at IS NULL "
        "AND asin IS NOT NULL LIMIT 1"
    )).scalar()
    if summary_asin:
        children = get_summary_children(db, tenant_id=1, asin=summary_asin)
        check("get_summary_children 有子行", bool(children), f"asin={summary_asin}, 子行数={len(children)}")
        if children:
            missing_keys = [f for f in ("return_rate_30d", "return_rate_60d")
                            if any(f not in c for c in children)]
            check("子行返回体含退货率字段", not missing_keys, f"缺失: {missing_keys}")
            rr30 = [c.get("return_rate_30d") for c in children]
            non_null = [v for v in rr30 if v is not None]
            check("子行退货率有实际落值（非 NULL）", bool(non_null),
                  f"非空 {len(non_null)}/{len(children)}，样例 30d={rr30[:3]}")
    else:
        check("库中存在汇总行可验", False, "无 summary_flag='是' 的行")
finally:
    db.close()

print("\n" + ("全部通过 ✅" if not FAILS else f"存在失败项 ❌: {FAILS}"))
sys.exit(1 if FAILS else 0)
