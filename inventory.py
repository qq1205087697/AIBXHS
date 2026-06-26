import pandas as pd
from sqlalchemy import create_engine, Column, String, Float, Date, Integer, UniqueConstraint
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, date

# =========================
# 数据库连接
# =========================
engine = create_engine("mysql+pymysql://root:123456@localhost:3306/inventory")
Base = declarative_base()
Session = sessionmaker(bind=engine)

# =========================
# 表结构定义
# =========================
class InventorySnapshot(Base):
    __tablename__ = 'inventory_snapshot'

    id = Column(Integer, primary_key=True, autoincrement=True)
    summary_flag = Column(String(50), comment='行类型标记：是=欧洲/北美汇总行，共享库存=共享库存子行，0=独立SKU行')
    asin = Column(String(100), comment='亚马逊标准识别码')
    parent_asin = Column(String(500), comment='父ASIN（同款产品不同颜色/尺寸的共享父级）')
    msku = Column(String(500), comment='商家SKU（卖家自定义编码）')
    fnsku = Column(String(500), comment='亚马逊物流SKU（FBA配送编码）')
    sku = Column(String(500), comment='店铺SKU（店铺级唯一标识）')
    product_name = Column(String(500), comment='商品中文品名')
    title = Column(String(1000), comment='商品英文标题（亚马逊前台展示用）')
    account = Column(String(500), comment='销售店铺/账号')
    country = Column(String(200), comment='销售国家/地区')
    category = Column(String(200), comment='商品分类')
    brand = Column(String(200), comment='品牌名称')
    fba_stock = Column(Float, comment='FBA总库存量')
    fba_available = Column(Float, comment='FBA可售库存（当前可立即售卖的数量）')
    fba_pending_transfer = Column(Float, comment='待调仓数（等待调拨转移中）')
    fba_in_transfer = Column(Float, comment='调仓中（正在转移途中）')
    fba_inbound_processing = Column(Float, comment='入库处理中（已到仓正在上架）')
    fba_inbound = Column(Float, comment='FBA在途总数（已发货尚未到仓）')
    fba_inbound_detail = Column(String(5000), comment='FBA在途详情（各批次到货时间和数量JSON）')
    local_available = Column(Float, comment='本地可用库存（海外仓/自发货可用量）')
    age_0_3 = Column(Float, comment='库龄0-3个月库存量')
    age_3_6 = Column(Float, comment='库龄3-6个月库存量')
    age_6_9 = Column(Float, comment='库龄6-9个月库存量')
    age_9_12 = Column(Float, comment='库龄9-12个月库存量')
    age_12_plus = Column(Float, comment='库龄12个月以上库存量（超期库存）')
    sales_3d = Column(Float, comment='最近3天总销量')
    sales_7d = Column(Float, comment='最近7天总销量')
    sales_14d = Column(Float, comment='最近14天总销量')
    sales_30d = Column(Float, comment='最近30天总销量')
    sales_60d = Column(Float, comment='最近60天总销量')
    sales_90d = Column(Float, comment='最近90天总销量')
    daily_sales = Column(Float, comment='日均销量（基于近30天计算）')
    snapshot_date = Column(Date, comment='快照日期（数据日期）')

class ReplenishmentDecision(Base):
    __tablename__ = "replenishment_decision"

    id = Column(Integer, primary_key=True, autoincrement=True)
    summary_flag = Column(String(50), comment='行类型标记：是=汇总行补货决策，共享库存=不参与补货，0=独立SKU补货决策')
    asin = Column(String(200), comment='亚马逊标准识别码')
    sku = Column(String(1000), comment='店铺SKU')
    account = Column(String(1000), comment='销售店铺/账号')
    country = Column(String(500), comment='销售国家/地区')
    snapshot_date = Column(Date, comment='快照日期')
    future_stock = Column(Float, comment='未来可用库存（可售+在途+本地可用）')
    demand = Column(Float, comment='补货周期内需求预测量')
    safety_stock = Column(Float, comment='安全库存量（缓冲库存）')
    suggest_qty = Column(Float, comment='建议补货数量')
    days_of_supply = Column(Float, comment='可售天数（当前库存可支撑天数）')
    stockout_days = Column(Float, comment='预计断货天数（库存耗尽后天数）')
    risk_level = Column(String(50), comment='风险等级：红=高风险需立即补货，黄=中风险需关注，绿=库存充足')
    reason = Column(String(2000), comment='补货建议原因说明')

# =========================
# 初始化表（仅创建不存在的列，不删数据）
# =========================
def init_tables():
    Base.metadata.create_all(engine)
    print("表结构初始化完成")

# =========================
# 补货计算（核心逻辑）
# =========================
def calculate_replenishment(row):
    row = clean_row(row)

    summary_flag = row.get("summary_flag", "0")
    daily_sales = row["daily_sales"]
    fba_available = row["fba_available"]
    fba_inbound = row["fba_inbound"]
    local_available = row["local_available"]

    # 未来库存（保守口径：可售 + 在途 + 本地）
    future_stock = fba_available + fba_inbound + local_available

    # 备货参数
    lead_time = 100      # 备货周期（天）：从下单到到仓
    safety_days = 0      # 安全库存天数
    low_sales_threshold = 0.1  # 极低销量阈值

    # ---- 共享库存子行：不参与补货计算 ----
    if summary_flag == "共享库存":
        return {
            "summary_flag": summary_flag,
            "future_stock": int(future_stock),
            "demand": 0,
            "safety_stock": 0,
            "suggest_qty": 0,
            "days_of_supply": 0,
            "stockout_days": 0,
            "risk_level": "绿",
            "reason": "共享库存子行，库存由汇总行统一管理，不单独建议补货",
        }

    # ---- 正常 SKU / 汇总行：进行补货计算 ----
    if daily_sales <= low_sales_threshold:
        return {
            "summary_flag": summary_flag,
            "future_stock": int(future_stock),
            "demand": 0,
            "safety_stock": 0,
            "suggest_qty": 0,
            "days_of_supply": 0,
            "stockout_days": 0,
            "risk_level": "绿",
            "reason": "日均销量极低（≤0.1），当前库存充足，无需补货",
        }

    # 可售天数
    days_of_supply = min(fba_available / daily_sales, 365)

    # 需求 = 日均销量 × 备货周期
    demand = daily_sales * lead_time
    # 安全库存 = 日均销量 × 安全天数
    safety_stock = daily_sales * safety_days
    # 建议补货量 = 需求 + 安全库存 - 未来可用
    suggest_qty = max(0, demand + safety_stock - future_stock)

    # 风险等级
    if days_of_supply <= 14:
        risk = "红"
    elif days_of_supply <= 30:
        risk = "黄"
    else:
        risk = "绿"

    # 断货天数（库存耗尽后还需多久才能到货）
    stockout_days = max(0, int(lead_time - days_of_supply))

    # 动态原因文案
    if days_of_supply < lead_time:
        reason = f"可售{round(days_of_supply,1)}天，低于{lead_time}天备货周期，建议补货{int(suggest_qty)}件"
    else:
        reason = f"可售{round(days_of_supply,1)}天，超过{lead_time}天备货周期，库存充足"

    return {
        "summary_flag": summary_flag,
        "future_stock": int(future_stock),
        "demand": int(demand),
        "safety_stock": int(safety_stock),
        "suggest_qty": int(suggest_qty),
        "days_of_supply": round(days_of_supply, 1),
        "stockout_days": stockout_days,
        "risk_level": risk,
        "reason": reason,
    }

# =========================
# 数据清洗
# =========================
def clean_row(row):
    for field in ["fba_available", "fba_inbound", "local_available"]:
        row[field] = max(row.get(field, 0), 0)

    # 日均销量不能为负
    row["daily_sales"] = max(row.get("daily_sales", 0), 0)

    return row

# =========================
# 导入库存数据（从Excel到MySQL）
# =========================
def import_inventory(force_import=False):
    today = datetime.now().date()

    session = Session()
    existing_count = session.query(InventorySnapshot).filter(
        InventorySnapshot.snapshot_date == today
    ).count()
    session.close()

    if existing_count > 0 and not force_import:
        print(f"检测到今日已存在库存数据 {existing_count} 条，跳过导入")
        print("如需重新导入，请删除旧数据或设置 force_import=True")
        return

    file_path = "补货建议.xlsx"
    df = pd.read_excel(file_path)
    print(f"Excel读取成功，共 {len(df)} 条数据")

    # 字段映射
    mapping = {
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
        "FBA库存": "fba_stock",
        "可售": "fba_available",
        "待调仓": "fba_pending_transfer",
        "调仓中": "fba_in_transfer",
        "入库中": "fba_inbound_processing",
        "FBA在途": "fba_inbound",
        "FBA在途详情": "fba_inbound_detail",
        "本地可用": "local_available",
        "3个月库龄": "age_0_3",
        "3-6个月库龄": "age_3_6",
        "6-9个月库龄": "age_6_9",
        "9-12个月库龄": "age_9_12",
        "12个月以上库龄": "age_12_plus",
        "3天销量": "sales_3d",
        "7天销量": "sales_7d",
        "14天销量": "sales_14d",
        "30天销量": "sales_30d",
        "60天销量": "sales_60d",
        "90天销量": "sales_90d",
        "日均销量": "daily_sales",
    }

    df = df.rename(columns=mapping)

    # 关键修复：NaN → "0"，共享库存 → "共享库存"，是 → "是"
    df["summary_flag"] = df["summary_flag"].apply(
        lambda x: "0" if pd.isna(x) or str(x).strip() == "" or str(x).strip() == "0" else str(x).strip()
    )

    # 数值填充
    numeric_cols = [
        "fba_stock", "fba_available", "fba_pending_transfer", "fba_in_transfer",
        "fba_inbound_processing", "fba_inbound", "local_available",
        "age_0_3", "age_3_6", "age_6_9", "age_9_12", "age_12_plus",
        "sales_3d", "sales_7d", "sales_14d", "sales_30d", "sales_60d", "sales_90d",
        "daily_sales",
    ]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # 字符串填充
    str_cols = [
        "asin", "parent_asin", "msku", "fnsku", "sku",
        "product_name", "title", "account", "country", "category", "brand",
        "fba_inbound_detail",
    ]
    for col in str_cols:
        df[col] = df[col].fillna("").astype(str)

    df["snapshot_date"] = today

    columns = list(mapping.values()) + ["snapshot_date"]
    df = df[columns]

    # 写入数据库
    session = Session()
    try:
        if existing_count > 0:
            delete_count = session.query(InventorySnapshot).filter(
                InventorySnapshot.snapshot_date == today
            ).delete()
            session.commit()
            print(f"已清空当天库存快照 {delete_count} 条")

        chunk_size = 1000
        total_inserted = 0
        for i in range(0, len(df), chunk_size):
            chunk = df[i : i + chunk_size]
            chunk.to_sql("inventory_snapshot", engine, if_exists="append", index=False)
            total_inserted += len(chunk)
            if (i // chunk_size) % 5 == 0 or total_inserted >= len(df):
                print(f"  导入进度 {total_inserted}/{len(df)}")

        # 统计分布
        dist = df["summary_flag"].value_counts()
        print(f"\n入库完成：{total_inserted} 条")
        print(f"  独立SKU: {dist.get('0', 0)} 条")
        print(f"  共享库存子行: {dist.get('共享库存', 0)} 条")
        print(f"  汇总行(欧洲/北美): {dist.get('是', 0)} 条")

    except Exception as e:
        session.rollback()
        import traceback
        print(f"库存数据导入失败：{e}")
        print(traceback.format_exc())
    finally:
        session.close()

# =========================
# 批量计算补货决策
# =========================
def run_replenishment():
    session = Session()
    today = date.today()

    try:
        session.query(ReplenishmentDecision).filter(
            ReplenishmentDecision.snapshot_date == today
        ).delete()

        rows = session.query(InventorySnapshot).filter(
            InventorySnapshot.snapshot_date == today
        ).all()

        decisions = []
        for row in rows:
            result = calculate_replenishment(row.__dict__)
            record = ReplenishmentDecision(
                summary_flag=result["summary_flag"],
                asin=row.asin,
                sku=row.sku,
                account=row.account,
                country=row.country,
                snapshot_date=row.snapshot_date,
                future_stock=result["future_stock"],
                demand=result["demand"],
                safety_stock=result["safety_stock"],
                suggest_qty=result["suggest_qty"],
                days_of_supply=result["days_of_supply"],
                stockout_days=result["stockout_days"],
                risk_level=result["risk_level"],
                reason=result["reason"],
            )
            decisions.append(record)

        session.bulk_save_objects(decisions)
        session.commit()

        # 按行类型分组统计
        red_n   = sum(1 for d in decisions if d.summary_flag == "0" and d.risk_level == "红")
        yellow_n = sum(1 for d in decisions if d.summary_flag == "0" and d.risk_level == "黄")
        green_n  = sum(1 for d in decisions if d.summary_flag == "0" and d.risk_level == "绿")

        red_s   = sum(1 for d in decisions if d.summary_flag == "是" and d.risk_level == "红")
        yellow_s = sum(1 for d in decisions if d.summary_flag == "是" and d.risk_level == "黄")
        green_s  = sum(1 for d in decisions if d.summary_flag == "是" and d.risk_level == "绿")

        skip = sum(1 for d in decisions if d.summary_flag == "共享库存")

        print(f"\n补货决策完成：{len(decisions)} 条")
        print(f"  独立SKU — 红:{red_n}  黄:{yellow_n}  绿:{green_n}")
        print(f"  汇总行   — 红:{red_s}  黄:{yellow_s}  绿:{green_s}")
        print(f"  共享库存 — 跳过:{skip}（不参与补货）")

    except Exception as e:
        session.rollback()
        print(f"补货决策计算失败：{e}")
        import traceback
        traceback.print_exc()
    finally:
        session.close()

# =========================
# 主流程
# =========================
if __name__ == "__main__":
    print("=" * 50)
    print("补货系统启动")
    print("=" * 50)

    init_tables()
    import_inventory()
    run_replenishment()

    print("=" * 50)
    print("所有流程完成！")
    print("=" * 50)
