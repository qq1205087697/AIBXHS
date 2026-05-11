import pandas as pd
import numpy as np
from datetime import date, datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from models.restock import InventorySnapshot, InboundShipmentDetail, ReplenishmentDecision
from database.database import engine

# Excel中文名 -> 数据库字段名 映射
FIELD_MAPPING = {
    "欧洲/北美汇总行": "summary_flag",
    "ASIN": "asin",
    "父ASIN": "parent_asin",
    "MSKU": "msku",
    "FNSKU": "fnsku",
    "SKU": "sku",
    "品名": "product_name",
    "标题": "title",
    "店铺": "account",
    "国家（地区）": "country",
    "分类": "category",
    "品牌": "brand",
    "补货状态": "replenishment_status",
    "采购计划天数": "purchase_plan_days",
    "采购交期": "purchase_lead_time",
    "质检天数": "qc_days",
    "海外仓至FBA天数": "overseas_to_fba_days",
    "安全天数": "safety_days",
    "采购频率": "purchase_frequency",
    "本地仓发货频率": "local_ship_frequency",
    "海外仓发货频率": "overseas_ship_frequency",
    "备货时长": "stock_up_duration",
    "3天销量": "sales_3d",
    "7天销量": "sales_7d",
    "14天销量": "sales_14d",
    "30天销量": "sales_30d",
    "60天销量": "sales_60d",
    "90天销量": "sales_90d",
    "3天日均": "daily_avg_3d",
    "7天日均": "daily_avg_7d",
    "14天日均": "daily_avg_14d",
    "30天日均": "daily_avg_30d",
    "60天日均": "daily_avg_60d",
    "90天日均": "daily_avg_90d",
    "可售天数(总)": "days_supply_total",
    "可售天数(FBA)": "days_supply_fba",
    "可售天数(FBA + 在途)": "days_supply_fba_inbound",
    "断货时间": "stockout_date",
    "日均销量": "daily_sales",
    "销量预测": "sales_forecast",
    "FBA库存": "fba_stock",
    "FBA在途": "fba_inbound",
    "FBA在途详情": "fba_inbound_detail",
    "可售": "fba_available",
    "待调仓": "fba_pending_transfer",
    "调仓中": "fba_in_transfer",
    "入库中": "fba_inbound_processing",
    "本地可用": "local_available",
    "总库存": "total_stock",
    "3个月库龄": "age_0_3",
    "3-6个月库龄": "age_3_6",
    "6-9个月库龄": "age_6_9",
    "9-12个月库龄": "age_9_12",
    "12个月以上库龄": "age_12_plus",
}

NUMERIC_FIELDS = [
    "purchase_plan_days", "purchase_lead_time", "qc_days", "overseas_to_fba_days",
    "safety_days", "purchase_frequency", "local_ship_frequency", "overseas_ship_frequency",
    "stock_up_duration", "sales_3d", "sales_7d", "sales_14d", "sales_30d", "sales_60d",
    "sales_90d", "daily_avg_3d", "daily_avg_7d", "daily_avg_14d", "daily_avg_30d",
    "daily_avg_60d", "daily_avg_90d", "days_supply_total", "days_supply_fba",
    "days_supply_fba_inbound", "daily_sales", "sales_forecast", "fba_stock",
    "fba_inbound", "fba_available", "fba_pending_transfer", "fba_in_transfer",
    "fba_inbound_processing", "local_available", "total_stock", "age_0_3", "age_3_6",
    "age_6_9", "age_9_12", "age_12_plus",
]

DATE_FIELDS = ["stockout_date"]
LEAD_TIME = 100


def _parse_inbound_details_fast(raw_text: str) -> list:
    """快速解析在途详情"""
    if not raw_text or pd.isna(raw_text) or not str(raw_text).strip():
        return []
    
    results = []
    header_keywords = {"货件单号", "shipment id", "shipmentid", "shipment_id", "shipment", "单号", "id"}
    
    for line in str(raw_text).strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if not parts:
            continue
        
        shipment_id = parts[0].strip()
        if not shipment_id:
            continue
        if any(kw in shipment_id.lower() for kw in header_keywords):
            continue
        if not any(c.isdigit() for c in shipment_id):
            continue
        
        quantity = None
        estimated_date = None
        logistics_method = None
        transport_method = None
        ship_date = None

        try:
            if len(parts) >= 3 and parts[2].strip():
                quantity = int(float(parts[2].strip()))
        except:
            pass
        if len(parts) >= 4 and parts[3].strip():
            logistics_method = parts[3].strip()
        if len(parts) >= 5 and parts[4].strip():
            transport_method = parts[4].strip()
        try:
            if len(parts) >= 6 and parts[5].strip():
                ship_date = datetime.strptime(parts[5].strip(), "%Y-%m-%d").date()
        except:
            pass
        try:
            if len(parts) >= 7 and parts[6].strip():
                estimated_date = datetime.strptime(parts[6].strip(), "%Y-%m-%d").date()
            elif parts[-1].strip() and len(parts[-1]) == 10:
                estimated_date = datetime.strptime(parts[-1].strip(), "%Y-%m-%d").date()
        except:
            pass

        results.append({
            "shipment_id": shipment_id,
            "quantity": quantity,
            "logistics_method": logistics_method,
            "transport_method": transport_method,
            "ship_date": ship_date,
            "estimated_available_date": estimated_date,
            "raw_text": line,
        })
    return results


def import_inventory_data(db: Session, file_path: str = None, file_content: bytes = None, filename: str = None) -> dict:
    """导入库存Excel数据 - 极速版"""
    import io
    
    # 读取Excel
    if file_content:
        df = pd.read_excel(io.BytesIO(file_content))
    elif file_path:
        df = pd.read_excel(file_path)
    else:
        raise ValueError("请提供 file_path 或 file_content")

    today = date.today()
    total_rows = len(df)
    print(f"Excel读取完成: {total_rows} 条")

    # 重命名列
    df = df.rename(columns={k: v for k, v in FIELD_MAPPING.items() if k in df.columns})

    # 数据清洗
    if "summary_flag" in df.columns:
        df["summary_flag"] = df["summary_flag"].fillna("0").apply(
            lambda x: "0" if str(x).strip() in ("", "0") else str(x).strip()
        )
    
    for col in NUMERIC_FIELDS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    
    str_cols = ["asin", "parent_asin", "msku", "fnsku", "sku", "product_name", "title", 
                "account", "country", "category", "brand", "fba_inbound_detail"]
    for col in str_cols:
        if col in df.columns:
            df[col] = df[col].fillna("").astype(str)

    df["snapshot_date"] = today
    df["tenant_id"] = 1

    # 清理旧数据
    print("清理旧数据...")
    db.execute(text("DELETE FROM replenishment_decisions"))
    db.execute(text("DELETE FROM inbound_shipment_details"))
    db.execute(text("DELETE FROM inventory_snapshots"))
    db.commit()
    print("旧数据清理完成")

    # 插入快照
    print("导入快照数据...")
    available_columns = [col for col in FIELD_MAPPING.values() if col in df.columns] + ["snapshot_date", "tenant_id"]
    df_to_insert = df[available_columns].copy()
    
    df_to_insert.to_sql(
        "inventory_snapshots",
        engine,
        if_exists="append",
        index=False,
        chunksize=10000,
        method="multi"
    )
    print(f"快照导入完成: {total_rows} 条")

    # 获取快照ID（只查ID，不加载完整对象）
    print("获取快照ID...")
    result = db.execute(text("SELECT id FROM inventory_snapshots ORDER BY id")).fetchall()
    snapshot_ids = [r[0] for r in result]
    print(f"获取到 {len(snapshot_ids)} 个ID")

    # 解析在途详情
    print("解析在途详情...")
    inbound_records = []
    for idx, row in df.iterrows():
        raw_detail = row.get("fba_inbound_detail", "")
        if raw_detail and str(raw_detail).strip():
            if idx < len(snapshot_ids):
                details = _parse_inbound_details_fast(raw_detail)
                for d in details:
                    inbound_records.append({
                        "tenant_id": 1,
                        "snapshot_id": snapshot_ids[idx],
                        "asin": row.get("asin", ""),
                        "account": row.get("account", ""),
                        "country": row.get("country", ""),
                        **d
                    })

    if inbound_records:
        inbound_df = pd.DataFrame(inbound_records)
        inbound_df.to_sql(
            "inbound_shipment_details",
            engine,
            if_exists="append",
            index=False,
            chunksize=5000,
            method="multi"
        )
    print(f"在途详情导入完成: {len(inbound_records)} 条")

    # 补货计算（DataFrame批量计算）
    print("计算补货决策...")
    calc_result = _calculate_replenishment_fast(db, df, snapshot_ids, today)

    return {
        "total_rows": total_rows,
        "imported": total_rows,
        "inbound_details": len(inbound_records),
        "snapshot_date": today.isoformat(),
        "calculation": calc_result,
    }


def _calculate_replenishment_fast(db: Session, df: pd.DataFrame, snapshot_ids: list, target_date: date) -> dict:
    """批量补货计算 - DataFrame向量化"""
    
    # 准备计算数据
    n = len(df)
    summary_flags = df["summary_flag"].fillna("0").values if "summary_flag" in df.columns else np.array(["0"] * n)
    daily_sales = df["daily_sales"].fillna(0).values if "daily_sales" in df.columns else np.zeros(n)
    fba_available = df["fba_available"].fillna(0).values if "fba_available" in df.columns else np.zeros(n)
    fba_inbound = df["fba_inbound"].fillna(0).values if "fba_inbound" in df.columns else np.zeros(n)
    local_available = df["local_available"].fillna(0).values if "local_available" in df.columns else np.zeros(n)
    total_stock = df["total_stock"].fillna(0).values if "total_stock" in df.columns else np.zeros(n)
    asins = df["asin"].fillna("").values if "asin" in df.columns else np.array([""] * n)
    skus = df["sku"].fillna("").values if "sku" in df.columns else np.array([""] * n)
    accounts = df["account"].fillna("").values if "account" in df.columns else np.array([""] * n)
    countries = df["country"].fillna("").values if "country" in df.columns else np.array([""] * n)

    # 向量化计算
    future_stock = fba_available + fba_inbound + local_available
    days_of_supply = np.where(
        (total_stock > 0) & (daily_sales > 0),
        np.minimum(total_stock / daily_sales, 365),
        365
    )
    demand = daily_sales * LEAD_TIME
    suggest_qty = np.maximum(0, demand - future_stock)
    stockout_days = np.maximum(0, LEAD_TIME - days_of_supply).astype(int)

    # 风险等级
    risk_levels = np.where(days_of_supply <= 30, "红", np.where(days_of_supply <= 60, "黄", "绿"))

    # 断货日期
    stockout_dates = []
    for d in days_of_supply:
        if d >= 365:
            stockout_dates.append("-")
        else:
            stockout_dates.append(target_date + timedelta(days=int(d)))

    # 原因
    reasons = np.where(
        days_of_supply < LEAD_TIME,
        [f"可售{round(d,1)}天，低于{LEAD_TIME}天备货周期，建议补货{int(s)}件" for d, s in zip(days_of_supply, suggest_qty)],
        [f"可售{round(d,1)}天，超过{LEAD_TIME}天备货周期，库存充足" for d in days_of_supply]
    )

    # 共享库存处理
    shared_mask = summary_flags == "共享库存"
    demand[shared_mask] = 0
    suggest_qty[shared_mask] = 0
    risk_levels[shared_mask] = "绿"
    reasons[shared_mask] = "共享库存子行，库存由汇总行统一管理"

    # 极低销量处理
    low_sales_mask = daily_sales <= 0.1
    suggest_qty[low_sales_mask] = 0
    risk_levels[low_sales_mask] = "绿"
    reasons[low_sales_mask] = "日均销量极低（≤0.1），当前库存充足，无需补货"

    # 构建批量插入SQL
    print("批量插入补货决策...")
    values = []
    for i in range(n):
        if i >= len(snapshot_ids):
            break
        sid = snapshot_ids[i]
        sf = str(summary_flags[i]) if summary_flags[i] else "0"
        stockout_date_str = "-" if stockout_dates[i] == "-" else stockout_dates[i].strftime('%Y-%m-%d')
        values.append(
            f"(1, {sid}, '{sf}', '{str(asins[i]).replace(chr(39), chr(39)+chr(39))}', "
            f"'{str(skus[i]).replace(chr(39), chr(39)+chr(39))}', "
            f"'{str(accounts[i]).replace(chr(39), chr(39)+chr(39))}', "
            f"'{str(countries[i]).replace(chr(39), chr(39)+chr(39))}', "
            f"'{target_date}', {int(future_stock[i])}, {int(demand[i])}, 0, {int(suggest_qty[i])}, "
            f"{round(days_of_supply[i], 1)}, {int(stockout_days[i])}, "
            f"'{stockout_date_str}', '{risk_levels[i]}', "
            f"'{reasons[i].replace(chr(39), chr(39)+chr(39))}')"
        )

    # 分批插入
    batch_size = 5000
    for i in range(0, len(values), batch_size):
        batch = values[i:i+batch_size]
        sql = f"""
        INSERT INTO replenishment_decisions 
        (tenant_id, snapshot_id, summary_flag, asin, sku, account, country, snapshot_date, 
         future_stock, demand, safety_stock, suggest_qty, days_of_supply, stockout_days, 
         stockout_date_calc, risk_level, reason)
        VALUES {','.join(batch)}
        """
        db.execute(text(sql))
        db.commit()
        if (i // batch_size) % 5 == 0:
            print(f"  补货决策进度: {min(i+batch_size, len(values))}/{len(values)}")

    # 统计
    red = int(np.sum(risk_levels == "红"))
    yellow = int(np.sum(risk_levels == "黄"))
    green = int(np.sum(risk_levels == "绿"))

    print(f"补货决策完成: 红{red}, 黄{yellow}, 绿{green}")

    return {
        "date": target_date.isoformat(),
        "total": n,
        "red": red,
        "yellow": yellow,
        "green": green,
    }


def calculate_replenishment(db: Session, snapshot_date: str = None) -> dict:
    """公开API：计算补货决策"""
    if snapshot_date:
        target_date = datetime.strptime(snapshot_date, "%Y-%m-%d").date()
    else:
        target_date = date.today()

    # 获取快照
    snapshots = db.query(InventorySnapshot).filter(
        InventorySnapshot.snapshot_date == target_date
    ).all()

    if not snapshots:
        return {"message": "无快照数据", "date": target_date.isoformat(), "total": 0, "red": 0, "yellow": 0, "green": 0}

    # 转为DataFrame计算
    data = [{
        "id": s.id,
        "summary_flag": s.summary_flag or "0",
        "daily_sales": s.daily_sales or 0,
        "fba_available": s.fba_available or 0,
        "fba_inbound": s.fba_inbound or 0,
        "local_available": s.local_available or 0,
        "total_stock": s.total_stock or 0,
        "asin": s.asin or "",
        "sku": s.sku or "",
        "account": s.account or "",
        "country": s.country or "",
    } for s in snapshots]

    df = pd.DataFrame(data)
    snapshot_ids = df["id"].tolist()

    # 删除旧决策
    db.query(ReplenishmentDecision).filter(
        ReplenishmentDecision.snapshot_date == target_date
    ).delete(synchronize_session=False)
    db.commit()

    return _calculate_replenishment_fast(db, df, snapshot_ids, target_date)


def get_inventory_overview(db: Session) -> dict:
    """获取库存概览"""
    latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
    if not latest:
        return {"total_sku": 0, "red_count": 0, "yellow_count": 0, "green_count": 0, 
                "snapshot_date": None, "stockout_top10": [], "overstock_top10": []}

    # 统计
    total = db.query(InventorySnapshot).filter(
        InventorySnapshot.snapshot_date == latest,
        (InventorySnapshot.summary_flag != "共享库存") | (InventorySnapshot.summary_flag.is_(None)),
    ).count()

    # 获取有效的 snapshot_ids
    valid_snap_ids = [s.id for s in db.query(InventorySnapshot.id).filter(
        InventorySnapshot.snapshot_date == latest,
        (InventorySnapshot.summary_flag != "共享库存") | (InventorySnapshot.summary_flag.is_(None)),
    ).all()]

    red = db.query(ReplenishmentDecision).filter(
        ReplenishmentDecision.snapshot_date == latest,
        ReplenishmentDecision.snapshot_id.in_(valid_snap_ids),
        ReplenishmentDecision.risk_level == "红",
    ).count()
    yellow = db.query(ReplenishmentDecision).filter(
        ReplenishmentDecision.snapshot_date == latest,
        ReplenishmentDecision.snapshot_id.in_(valid_snap_ids),
        ReplenishmentDecision.risk_level == "黄",
    ).count()
    green = db.query(ReplenishmentDecision).filter(
        ReplenishmentDecision.snapshot_date == latest,
        ReplenishmentDecision.snapshot_id.in_(valid_snap_ids),
        ReplenishmentDecision.risk_level == "绿",
    ).count()

    # TOP10
    stockout_ids = db.query(ReplenishmentDecision.snapshot_id).filter(
        ReplenishmentDecision.snapshot_date == latest,
        ReplenishmentDecision.snapshot_id.in_(valid_snap_ids),
    ).order_by(ReplenishmentDecision.days_of_supply.asc()).limit(10).all()
    snap_ids = [r[0] for r in stockout_ids]

    stockout_items = []
    if snap_ids:
        snaps = {s.id: s for s in db.query(InventorySnapshot).filter(InventorySnapshot.id.in_(snap_ids)).all()}
        decs = {d.snapshot_id: d for d in db.query(ReplenishmentDecision).filter(ReplenishmentDecision.snapshot_id.in_(snap_ids)).all()}
        for sid in snap_ids:
            if sid in snaps and sid in decs:
                s, d = snaps[sid], decs[sid]
                stockout_items.append({
                    "asin": s.asin, "product_name": s.product_name, "account": s.account,
                    "country": s.country, "days_of_supply": d.days_of_supply,
                    "fba_stock": s.fba_stock, "daily_sales": s.daily_sales,
                    "stockout_date": d.stockout_date_calc or "-",
                    "total_stock": s.total_stock, "age_0_3": s.age_0_3, "age_3_6": s.age_3_6,
                    "age_6_9": s.age_6_9, "age_9_12": s.age_9_12, "age_12_plus": s.age_12_plus,
                })

    overstock_top10 = db.query(InventorySnapshot).filter(
        InventorySnapshot.snapshot_date == latest,
        (InventorySnapshot.summary_flag != "共享库存") | (InventorySnapshot.summary_flag.is_(None)),
    ).order_by(InventorySnapshot.age_12_plus.desc()).limit(10).all()

    return {
        "snapshot_date": latest.isoformat(),
        "total_sku": total,
        "red_count": red,
        "yellow_count": yellow,
        "green_count": green,
        "stockout_top10": stockout_items,
        "overstock_top10": [{
            "asin": s.asin, "product_name": s.product_name, "account": s.account,
            "country": s.country, "total_stock": s.total_stock,
            "age_0_3": s.age_0_3, "age_3_6": s.age_3_6, "age_6_9": s.age_6_9,
            "age_9_12": s.age_9_12, "age_12_plus": s.age_12_plus,
        } for s in overstock_top10],
    }


def search_inventory(db: Session, keyword: str = None, risk_level=None,
                     replenishment_status: str = None, account: str = None,
                     country: str = None, sort_field: str = None, sort_order: str = None,
                     page: int = 1, page_size: int = 20) -> dict:
    """搜索库存"""
    latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
    if not latest:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    # 1. 先筛选出不包含共享库存的 snapshot_ids
    valid_snapshot_query = db.query(InventorySnapshot.id).filter(
        InventorySnapshot.snapshot_date == latest,
        (InventorySnapshot.summary_flag != "共享库存") | (InventorySnapshot.summary_flag.is_(None))
    )

    if keyword:
        kw = f"%{keyword}%"
        valid_snapshot_query = valid_snapshot_query.filter(
            (InventorySnapshot.asin.like(kw)) |
            (InventorySnapshot.sku.like(kw)) |
            (InventorySnapshot.product_name.like(kw)) |
            (InventorySnapshot.account.like(kw))
        )

    if account:
        valid_snapshot_query = valid_snapshot_query.filter(InventorySnapshot.account == account)
    if country:
        valid_snapshot_query = valid_snapshot_query.filter(InventorySnapshot.country == country)

    valid_snapshot_ids = [s.id for s in valid_snapshot_query.all()]
    if not valid_snapshot_ids:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    # 2. 如果有风险等级筛选，进一步筛选
    final_snapshot_ids = valid_snapshot_ids
    if risk_level:
        risk_map = {"red": "红", "yellow": "黄", "green": "绿"}
        rls = [risk_map.get(rl, rl) for rl in ([risk_level] if isinstance(risk_level, str) else risk_level)]
        matching_ids = [d.snapshot_id for d in db.query(ReplenishmentDecision.snapshot_id).filter(
            ReplenishmentDecision.snapshot_date == latest,
            ReplenishmentDecision.snapshot_id.in_(valid_snapshot_ids),
            ReplenishmentDecision.risk_level.in_(rls)
        ).all()]
        final_snapshot_ids = matching_ids if matching_ids else []

    if not final_snapshot_ids:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    # 3. 构建主查询
    query = db.query(InventorySnapshot, ReplenishmentDecision).outerjoin(
        ReplenishmentDecision,
        (ReplenishmentDecision.snapshot_id == InventorySnapshot.id) & 
        (ReplenishmentDecision.snapshot_date == latest)
    ).filter(InventorySnapshot.id.in_(final_snapshot_ids))

    if replenishment_status:
        query = query.filter(InventorySnapshot.replenishment_status == replenishment_status)

    if sort_field == 'days_of_supply':
        order_col = ReplenishmentDecision.days_of_supply.desc() if sort_order == 'desc' else ReplenishmentDecision.days_of_supply.asc()
        query = query.order_by(order_col, InventorySnapshot.asin)
    elif sort_field:
        col = getattr(InventorySnapshot, sort_field, None)
        if col is not None:
            query = query.order_by(col.desc() if sort_order == 'desc' else col.asc())
    else:
        query = query.order_by(InventorySnapshot.asin)

    total = query.count()
    results = query.offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for snap, dec in results:
        risk_map_r = {"红": "red", "黄": "yellow", "绿": "green"}
        items.append({
            "id": snap.id, "asin": snap.asin, "sku": snap.sku, "fnsku": snap.fnsku,
            "msku": snap.msku, "product_name": snap.product_name, "account": snap.account,
            "country": snap.country, "category": snap.category, "brand": snap.brand,
            "replenishment_status": snap.replenishment_status,
            "days_of_supply": dec.days_of_supply if dec else snap.days_supply_total,
            "fba_stock": snap.fba_stock, "fba_available": snap.fba_available,
            "fba_pending_transfer": snap.fba_pending_transfer, "fba_in_transfer": snap.fba_in_transfer,
            "fba_inbound_processing": snap.fba_inbound_processing, "fba_inbound": snap.fba_inbound,
            "daily_sales": snap.daily_sales, "total_stock": snap.total_stock,
            "stockout_date": dec.stockout_date_calc if dec else (snap.stockout_date.isoformat() if snap.stockout_date else "-"),
            "age_12_plus": snap.age_12_plus,
            "risk_level": risk_map_r.get(dec.risk_level, "green") if dec else "green",
            "summary_flag": snap.summary_flag,
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_stockout_top10(db: Session) -> list:
    """断货风险TOP10"""
    latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
    if not latest:
        return []

    risk_orders = db.query(ReplenishmentDecision.snapshot_id).filter(
        ReplenishmentDecision.snapshot_date == latest,
        (ReplenishmentDecision.summary_flag != "共享库存") | (ReplenishmentDecision.summary_flag.is_(None))
    ).order_by(ReplenishmentDecision.days_of_supply.asc()).limit(10).all()

    if not risk_orders:
        return []

    snap_ids = [r[0] for r in risk_orders]
    snaps = {s.id: s for s in db.query(InventorySnapshot).filter(InventorySnapshot.id.in_(snap_ids)).all()}
    decs = {d.snapshot_id: d for d in db.query(ReplenishmentDecision).filter(ReplenishmentDecision.snapshot_id.in_(snap_ids)).all()}

    result = []
    for sid in snap_ids:
        if sid in snaps and sid in decs:
            s, d = snaps[sid], decs[sid]
            result.append({
                "asin": s.asin, "product_name": s.product_name, "account": s.account,
                "country": s.country, "days_of_supply": d.days_of_supply,
                "fba_stock": s.fba_stock, "daily_sales": s.daily_sales,
                "stockout_date": d.stockout_date_calc or "-",
            })
    return result


def get_overstock_top10(db: Session) -> list:
    """冗余库存TOP10"""
    latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
    if not latest:
        return []

    items = db.query(InventorySnapshot).filter(
        InventorySnapshot.snapshot_date == latest,
        (InventorySnapshot.summary_flag != "共享库存") | (InventorySnapshot.summary_flag.is_(None))
    ).order_by(InventorySnapshot.age_12_plus.desc()).limit(10).all()

    return [{
        "asin": s.asin, "product_name": s.product_name, "account": s.account,
        "country": s.country, "total_stock": s.total_stock,
        "age_0_3": s.age_0_3, "age_3_6": s.age_3_6, "age_6_9": s.age_6_9,
        "age_9_12": s.age_9_12, "age_12_plus": s.age_12_plus,
    } for s in items]


def get_inbound_details(db: Session, asin: str, account: str = None) -> list:
    """查询在途详情"""
    latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
    if not latest:
        return []

    query = db.query(InventorySnapshot.id).filter(
        InventorySnapshot.snapshot_date == latest, InventorySnapshot.asin == asin
    )
    if account:
        query = query.filter(InventorySnapshot.account == account)
    
    snapshot_ids = [s.id for s in query.all()]
    if not snapshot_ids:
        return []

    details = db.query(InboundShipmentDetail).filter(
        InboundShipmentDetail.snapshot_id.in_(snapshot_ids)
    ).all()

    return [{
        "shipment_id": d.shipment_id, "quantity": d.quantity,
        "logistics_method": d.logistics_method, "transport_method": d.transport_method,
        "ship_date": d.ship_date.isoformat() if d.ship_date else None,
        "estimated_available_date": d.estimated_available_date.isoformat() if d.estimated_available_date else None,
        "raw_text": d.raw_text,
    } for d in details]


def get_latest_snapshot_date(db: Session) -> str:
    """获取最新快照日期"""
    latest = db.query(func.max(InventorySnapshot.snapshot_date)).scalar()
    return latest.isoformat() if latest else None
