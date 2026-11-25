"""迁移脚本：新建产品月销量等级池表 product_sales_grades

背景：产品月销量等级体系（S/A/B/C/D/E），每月 3 号按上月销量定版。
设计文档：docs/plans/2026-11-24_产品月销量等级体系_完整实现方案.md

幂等：表已存在则跳过；建表后校验唯一索引与关键列。

用法：
    cd backend && python scripts/migrate_grade_system.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8")

from database.database import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

TABLE = "product_sales_grades"

DDL = """
CREATE TABLE IF NOT EXISTS {table} (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL DEFAULT 1,
  period VARCHAR(7) NOT NULL COMMENT '销量所属月份 YYYY-MM',
  asin VARCHAR(100) NOT NULL COMMENT 'ASIN',
  account VARCHAR(500) NOT NULL DEFAULT '' COMMENT '店铺（快照行 account 原值，父行为多店拼接串）',
  grade CHAR(1) NOT NULL COMMENT '等级 S/A/B/C/D/E（父行=合并口径）',
  monthly_sales INT NOT NULL DEFAULT 0 COMMENT '行级月销量（父行=ASIN合计）',
  sales_source VARCHAR(20) NOT NULL DEFAULT 'product_sales' COMMENT 'product_sales / fallback_30d / no_data',
  grade_rule_version VARCHAR(10) NOT NULL DEFAULT 'v1' COMMENT '规则版本号',
  prev_grade CHAR(1) NULL COMMENT '上期等级（计算时快照）',
  computed_at DATETIME NOT NULL COMMENT '本次计算时间',
  computed_by VARCHAR(50) NOT NULL DEFAULT 'scheduler' COMMENT 'scheduler / manual:用户名',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME NULL COMMENT '删除时间',
  UNIQUE KEY uk_grades_period_asin_account (tenant_id, period, asin, account),
  KEY idx_grades_asin_account (tenant_id, asin, account),
  KEY idx_grades_period_grade (tenant_id, period, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品月销量等级池（每月3号按上月销量定版）'
""".format(table=TABLE)

REQUIRED_COLS = [
    "id", "tenant_id", "period", "asin", "account", "grade", "monthly_sales",
    "sales_source", "grade_rule_version", "prev_grade", "computed_at",
    "computed_by", "created_at", "updated_at", "deleted_at",
]
REQUIRED_INDEXES = ["uk_grades_period_asin_account", "idx_grades_asin_account", "idx_grades_period_grade"]


def migrate():
    with engine.connect() as conn:
        db_now = conn.execute(text("SELECT DATABASE()")).scalar()
        print(f"[check] 当前数据库: {db_now}")
        if db_now != "bxhs_ai_assistance":
            print("[abort] 非 bxhs_ai_assistance 库，禁止执行（防误连 demo/本地库）")
            sys.exit(1)

        exists = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = :t"
        ), {"t": TABLE}).scalar()
        if exists:
            print(f"[skip] 表 {TABLE} 已存在")
        else:
            conn.execute(text(DDL))
            conn.commit()
            print(f"[ok]   已建表 {TABLE}")

        # 校验列
        cols = [r[0] for r in conn.execute(text(f"SHOW COLUMNS FROM {TABLE}")).fetchall()]
        missing = [c for c in REQUIRED_COLS if c not in cols]
        if missing:
            print(f"[fail] 缺少列: {missing}")
            sys.exit(1)

        # 校验索引
        idx_names = {r[2] for r in conn.execute(text(f"SHOW INDEX FROM {TABLE}")).fetchall()}
        miss_idx = [i for i in REQUIRED_INDEXES if i not in idx_names]
        if miss_idx:
            print(f"[fail] 缺少索引: {miss_idx}")
            sys.exit(1)

        total = conn.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar()
        print(f"[done] 校验通过，{TABLE} 列 {len(cols)} 个、索引齐备，当前 {total} 行")


if __name__ == "__main__":
    migrate()
