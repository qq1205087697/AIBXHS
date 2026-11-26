"""一次性迁移：把历史低分产品统计 CSV/JSON 导入数据库（按租户隔离）

背景：低分产品统计已从「接口读根目录 CSV/JSON」改为「按 tenant_id 读写数据库」。
真实数据在切换到数据库前仍停留在 low_star_listings.csv / low_star_summary.json，
本脚本把这两份文件导入 low_star_listings / low_star_snapshots，迁移完成后
接口与定时任务均不再依赖这两个文件。

在 backend 目录执行：
    python migrations/import_low_star_to_db.py              # 默认写入租户 1
    python migrations/import_low_star_to_db.py --tenant 1   # 指定租户
    python migrations/import_low_star_to_db.py --dir /path/to/project
"""
import argparse
import csv
import json
import os
import sys
from datetime import datetime

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def load_rows(csv_path):
    rows = []
    # 历史文件带 BOM，用 utf-8-sig 读取
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        for item in csv.DictReader(f):
            rows.append({
                "sid": item.get("sid"),
                "store_name": item.get("店铺名"),
                "seller_sku": item.get("seller_sku"),
                "asin": item.get("asin"),
                "last_star": item.get("last_star"),
                "price": item.get("price"),
                "currency_code": item.get("currency_code"),
                "status": item.get("status"),
                "item_name": item.get("item_name"),
            })
    return rows


def load_summary(json_path):
    with open(json_path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def migrate(tenant_id, source_dir):
    from database.database import SessionLocal, init_db
    from services.low_star_service import sync_low_star_snapshot

    csv_path = os.path.join(source_dir, "low_star_listings.csv")
    json_path = os.path.join(source_dir, "low_star_summary.json")
    if not os.path.exists(csv_path):
        print(f"[ERR] 未找到低分明细文件: {csv_path}")
        return 1

    rows = load_rows(csv_path)
    summary = load_summary(json_path) if os.path.exists(json_path) else {}
    print(f"[INFO] 读取明细 {len(rows)} 条，来源 {csv_path}")

    init_db()  # 确保 low_star_listings / low_star_snapshots 表已创建

    db = SessionLocal()
    try:
        saved = sync_low_star_snapshot(
            db,
            tenant_id=tenant_id,
            rows=rows,
            generated_at=_parse_dt(summary.get("统计时间")) or datetime.now(),
            threshold=str(summary.get("阈值") or "last_star <= 3"),
            scanned_total=summary.get("扫描listing总数"),
        )
    finally:
        db.close()
    print(f"[DONE] 租户 {tenant_id} 写入 {saved} 条低分 Listing，"
          f"统计时间 {summary.get('统计时间')}，扫描总数 {summary.get('扫描listing总数')}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="导入历史低分产品统计 CSV/JSON 到数据库")
    parser.add_argument("--tenant", type=int, default=int(os.getenv("LOW_STAR_TENANT_ID", "1")),
                        help="目标租户 ID，默认 1（也支持环境变量 LOW_STAR_TENANT_ID）")
    parser.add_argument("--dir", default=os.path.dirname(BACKEND_DIR),
                        help="low_star_listings.csv / low_star_summary.json 所在目录，默认项目根目录")
    args = parser.parse_args()
    sys.exit(migrate(args.tenant, args.dir))
