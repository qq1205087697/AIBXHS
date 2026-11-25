#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
补货导入内存画像工具（只读，不写数据库、不启动导入线程）

复刻 `services/inventory_import_service._do_import` 步骤 1~6 的内存行为，
逐阶段打印进程 RSS 与 tracemalloc 峰值，用于回答：
  - 峰值内存有多大、集中在哪个阶段
  - 这些内存在任务结束后能否被回收（del + gc 后的 RSS）

用法：
    cd backend && python scripts/measure_import_memory.py [xlsx路径]
"""
import gc
import os
import sys
import time
import tracemalloc

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psutil

MB = 1024 * 1024
proc = psutil.Process()
_peak = 0.0


def rss() -> float:
    global _peak
    v = proc.memory_info().rss / MB
    _peak = max(_peak, v)
    return v


def stage(name: str, t0: float = None):
    r = rss()
    extra = f" | 本阶段耗时 {time.time() - t0:.1f}s" if t0 else ""
    print(f"  RSS {r:8.1f} MB (峰值 {_peak:8.1f} MB)  {name}{extra}", flush=True)


def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else r"D:\RPA流程文件\补货建议数据\2026-09-15\结果.xlsx"

    # 预注册全部模型（inventory_service 依赖 models）
    import importlib
    import pkgutil
    import models
    for m in pkgutil.iter_modules(models.__path__):
        importlib.import_module(f"models.{m.name}")

    from services.inventory_service import FIELD_MAPPING, LEAD_TIME, NUMERIC_FIELDS
    from utils.excel_reader import safe_read_excel
    import pandas as pd

    print(f"文件: {xlsx}")
    print(f"文件大小: {os.path.getsize(xlsx) / MB:.2f} MB")
    print(f"进程初始: {rss():.1f} MB")
    # 注意：tracemalloc 会给每次内存分配加 10~30x 开销，
    # 读取 137MB 的 sheet XML 会被拖到几十分钟，因此仅在显式开启时才启用。
    use_tracemalloc = "--tracemalloc" in sys.argv
    if use_tracemalloc:
        tracemalloc.start(10)

    # ---- 步骤1a: 读取文件到内存（对应路由层 await file.read()） ----
    t0 = time.time()
    content = open(xlsx, "rb").read()
    stage("① 文件字节读入内存 (await file.read 等价物)", t0)

    # ---- 步骤1b: openpyxl 解析 ----
    t0 = time.time()
    df = safe_read_excel(content)
    stage(f"② pd.read_excel 解析 -> DataFrame {df.shape}", t0)

    # ---- 步骤2: 重命名 + 清洗 ----
    t0 = time.time()
    df = df.rename(columns={k: v for k, v in FIELD_MAPPING.items() if k in df.columns})
    for col in NUMERIC_FIELDS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    str_cols = ["asin", "parent_asin", "msku", "fnsku", "sku", "product_name", "title",
                "account", "country", "category", "brand", "fba_inbound_detail"]
    for col in str_cols:
        if col in df.columns:
            df[col] = df[col].fillna("").astype(str)
    stage("③ 列重命名 + 数值/字符串清洗", t0)

    if {"fba_stock", "fba_inbound", "local_inventory"} <= set(df.columns):
        inspection = df["inspection_quantity"].fillna(0) if "inspection_quantity" in df.columns else 0
        df["total_stock"] = (df["fba_stock"].fillna(0) + df["fba_inbound"].fillna(0)
                             + df["local_inventory"].fillna(0) - inspection)
        stage("④ 计算 total_stock")

    # ---- 步骤3: 构造 df_to_insert（UPSERT 的输入，与 df 并存） ----
    t0 = time.time()
    from datetime import date as _date
    df["snapshot_date"] = _date.today()          # 与 _do_import 一致：先补这两列再取子集
    df["tenant_id"] = 1
    available_columns = [c for c in FIELD_MAPPING.values() if c in df.columns] + ["snapshot_date", "tenant_id"]
    df_to_insert = df[available_columns].copy()
    df_to_insert["stock_up_duration"] = LEAD_TIME
    stage(f"⑤ df_to_insert.copy() 与 df 同时驻留 ({len(available_columns)} 列)", t0)

    # ---- UPSERT 批次 SQL 字符串模拟（每批 1000 行） ----
    t0 = time.time()
    cols = list(df_to_insert.columns)
    batch = df_to_insert.iloc[0:1000]
    stmts = []
    for _, row in batch.iterrows():
        vals = ",".join(f"'{v}'" for v in row.values)
        stmts.append(f"INSERT INTO inventory_snapshots ({','.join(cols)}) VALUES ({vals})")
    stage(f"⑥ 单个批次的 INSERT 语句列表 ({len(stmts)} 条, 合计 {sum(len(s) for s in stmts)/MB:.2f} MB)", t0)
    del stmts, batch
    gc.collect()
    stage("   释放批次语句 + gc")

    # ---- 步骤5: 在途详情解析结果累积 ----
    t0 = time.time()
    inbound_records = []
    from services.inventory_service import _parse_inbound_details_fast
    for idx in range(len(df)):
        raw = df.iloc[idx].get("fba_inbound_detail", "")
        if raw and str(raw).strip() and str(raw).strip() != "nan":
            for d in _parse_inbound_details_fast(raw):
                inbound_records.append({"snapshot_id": idx, "asin": "", "account": "", "country": "", **d})
    stage(f"⑦ 在途详情解析累积 {len(inbound_records)} 条 dict", t0)

    # ---- tracemalloc 峰值定位（仅在 --tracemalloc 时可用） ----
    peak_py = 0.0
    if use_tracemalloc:
        snap = tracemalloc.take_snapshot()
        print("\ntracemalloc 峰值 Top10 分配点:")
        for stat in snap.statistics("lineno")[:10]:
            print(f"  {stat.size / MB:8.2f} MB  {stat.traceback[0].filename.split(chr(92))[-1]}:{stat.traceback[0].lineno}")
        peak_py = tracemalloc.get_traced_memory()[1] / MB
        tracemalloc.stop()

    # ---- 步骤6: 模拟任务结束，全部局部变量释放 ----
    print("\n--- 任务结束：释放全部大对象 ---")
    del inbound_records
    del df_to_insert
    del df
    content = None
    gc.collect()
    time.sleep(1)
    stage("⑧ del 全部大对象 + gc.collect() 之后")

    print(f"\n结论：RSS 峰值 {_peak:.1f} MB，释放后 {rss():.1f} MB，"
          f"未归还操作系统的部分约 {rss() - proc.memory_info().rss / MB:.1f} MB（含解释器/库常驻）")
    print(f"tracemalloc 记录的 Python 层峰值分配: {peak_py:.1f} MB")
    print("注：Windows 无 malloc_trim；Linux 上可用 ctypes 调 libc.malloc_trim(0) 强制归还空闲 arena。")


if __name__ == "__main__":
    main()
