"""
迁移脚本：标签系统 5 张新表 + replenishment_decisions 加 2 列（force_replenish / filter_status）

依据：《系统设计》v1.0 §4.2.1~§4.2.6（.workbuddy/output/delivery/系统设计.md）
幂等：表/列已存在则跳过，可重复执行。

注意（项目铁律）：
- 独立脚本必须自行加载全部 models（models/__init__.py 导出不全，
  ProductSelection 等类用字符串 relationship，mapper 需全部类已注册）。
- 数据库以 config.get_settings().DATABASE_URL 为准（DEMO_MODE 控制连演示库）。

用法：
    cd backend && python scripts/migrate_tag_system.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 项目铁律：动态导入全部 models，避免 ORM mapper 注册不全
import models
import pkgutil


def _load_all_models():
    import importlib
    for _, name, _ in pkgutil.iter_modules(models.__path__):
        try:
            importlib.import_module(f"models.{name}")
        except Exception as e:
            print(f"[warn] 导入 models.{name} 失败: {e}")


_load_all_models()

from config import get_settings  # noqa: E402
from database.database import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

CREATE_TABLES = {
    "product_tags": """
        CREATE TABLE `product_tags` (
          `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
          `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户隔离',
          `asin` VARCHAR(100) NOT NULL COMMENT '产品 ASIN',
          `sku` VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'SKU（空串=产品级）',
          `tag_type` VARCHAR(30) NOT NULL COMMENT '标签类型：holiday/force_replenish',
          `tag_value` VARCHAR(20) NOT NULL DEFAULT '' COMMENT '节日名（K6 枚举）；强制补货时为 1',
          `source` VARCHAR(10) NOT NULL DEFAULT 'manual' COMMENT '来源：auto/manual/import',
          `locked` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '人工锁定（K5：自动打标不可覆盖）',
          `active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '生效中',
          `match_basis` VARCHAR(500) DEFAULT NULL COMMENT '自动打标依据词（JSON）',
          `reason` VARCHAR(200) DEFAULT NULL COMMENT '人工理由',
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          `deleted_at` DATETIME DEFAULT NULL COMMENT '软删除',
          PRIMARY KEY (`id`),
          UNIQUE KEY `uk_tag` (`tenant_id`, `asin`, `sku`, `tag_type`),
          KEY `idx_tenant_active` (`tenant_id`, `tag_type`, `active`),
          KEY `idx_asin` (`asin`)
        ) COMMENT='产品维度标签真源（跨快照持久，K4）'
    """,
    "holiday_lexicon": """
        CREATE TABLE `holiday_lexicon` (
          `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
          `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户隔离',
          `holiday_name` VARCHAR(20) NOT NULL COMMENT '节日名（K6 枚举）',
          `keyword` VARCHAR(100) NOT NULL COMMENT '匹配关键词',
          `match_type` VARCHAR(10) NOT NULL DEFAULT 'contains' COMMENT '匹配方式：contains/exact',
          `site` VARCHAR(10) NOT NULL DEFAULT 'ALL' COMMENT '生效站点：ALL/US/UK',
          `window_start` DATE DEFAULT NULL COMMENT '节日窗口起始（空=全年）',
          `window_end` DATE DEFAULT NULL COMMENT '节日窗口截止',
          `status` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '启用：1/停用：0',
          `remark` VARCHAR(200) DEFAULT NULL COMMENT '备注',
          `created_by` VARCHAR(64) DEFAULT NULL COMMENT '创建人',
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          `deleted_at` DATETIME DEFAULT NULL COMMENT '软删除',
          PRIMARY KEY (`id`),
          UNIQUE KEY `uk_lexicon` (`tenant_id`, `holiday_name`, `keyword`),
          KEY `idx_status` (`tenant_id`, `status`)
        ) COMMENT='节日词库（打标规则配置，变更即生效）'
    """,
    "tag_audit_logs": """
        CREATE TABLE `tag_audit_logs` (
          `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
          `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户隔离',
          `event_id` VARCHAR(64) NOT NULL COMMENT '事件唯一标识（UUID，兼作幂等键）',
          `trace_id` VARCHAR(64) DEFAULT NULL COMMENT '链路追踪 ID',
          `asin` VARCHAR(100) NOT NULL COMMENT '目标产品',
          `sku` VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'SKU',
          `tag_type` VARCHAR(30) NOT NULL COMMENT '标签类型：holiday/force_replenish',
          `action` VARCHAR(20) NOT NULL COMMENT '动作：set/clear/unlock/auto_set/auto_clear',
          `old_value` VARCHAR(20) DEFAULT NULL COMMENT '变更前值',
          `new_value` VARCHAR(20) DEFAULT NULL COMMENT '变更后值',
          `source` VARCHAR(10) NOT NULL DEFAULT 'manual' COMMENT '来源：auto/manual/import',
          `operator` VARCHAR(64) NOT NULL COMMENT '操作人（auto 时为 system）',
          `reason` VARCHAR(200) DEFAULT NULL COMMENT '理由或自动依据摘要',
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件时间',
          PRIMARY KEY (`id`),
          UNIQUE KEY `uk_event` (`event_id`),
          KEY `idx_audit_query` (`tenant_id`, `asin`, `created_at`),
          KEY `idx_operator_time` (`tenant_id`, `operator`, `created_at`)
        ) COMMENT='标签变更审计流水（追加只写，V4 100% 覆盖）'
    """,
    "startop_word_data": """
        CREATE TABLE `startop_word_data` (
          `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
          `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户隔离',
          `site` VARCHAR(10) NOT NULL COMMENT '站点：US/UK',
          `store_id` VARCHAR(64) NOT NULL COMMENT '星拓店铺标识',
          `profile_id` VARCHAR(64) NOT NULL COMMENT '星拓 profileId',
          `word_type` VARCHAR(20) NOT NULL COMMENT '词类型：search_term/traffic_term',
          `keyword` VARCHAR(200) NOT NULL COMMENT '关键词文本',
          `asin` VARCHAR(100) NOT NULL COMMENT '归因 ASIN',
          `stat_date` DATE NOT NULL COMMENT '数据日期',
          `data_source` VARCHAR(10) NOT NULL DEFAULT 'mcp' COMMENT '来源：mcp/report',
          `raw_extra` TEXT DEFAULT NULL COMMENT '原始行冗余字段（曝光/点击/转化）',
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          PRIMARY KEY (`id`),
          UNIQUE KEY `uk_word` (`tenant_id`, `profile_id`, `asin`, `word_type`, `keyword`, `stat_date`),
          KEY `idx_window` (`tenant_id`, `stat_date`, `asin`),
          KEY `idx_profile_date` (`profile_id`, `stat_date`)
        ) COMMENT='星拓词数据落地表（出单词/流量词）'
    """,
    "startop_pull_logs": """
        CREATE TABLE `startop_pull_logs` (
          `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
          `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户隔离',
          `pull_date` DATE NOT NULL COMMENT '拉取批次日期',
          `tool` VARCHAR(50) NOT NULL COMMENT '工具名',
          `target_scope` VARCHAR(200) DEFAULT NULL COMMENT '目标范围（店铺或文件）',
          `page_num` INT DEFAULT NULL COMMENT '分页页码',
          `page_size` INT DEFAULT NULL COMMENT '分页大小',
          `status` VARCHAR(30) NOT NULL COMMENT '状态：SUCCESS/PARTIAL/FAILED/FAILED_FALLBACK_READY',
          `rows_parsed` INT NOT NULL DEFAULT 0 COMMENT '解析成功行数',
          `retry_count` INT NOT NULL DEFAULT 0 COMMENT '已重试次数',
          `duration_ms` INT DEFAULT NULL COMMENT '耗时毫秒',
          `error_msg` VARCHAR(1000) DEFAULT NULL COMMENT '失败原因',
          `fallback_ready` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '兜底通道就绪标记',
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件时间',
          PRIMARY KEY (`id`),
          KEY `idx_pull_date` (`tenant_id`, `pull_date`, `status`),
          KEY `idx_scope` (`pull_date`, `target_scope`)
        ) COMMENT='星拓拉取流水（失败告警与兜底切换依据）'
    """,
}

# replenishment_decisions 新增列（§4.2.6）
NEW_COLUMNS = [
    ("force_replenish", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '强制补货标识（override 生效）'"),
    ("filter_status", "VARCHAR(30) NOT NULL DEFAULT 'KEEP' COMMENT '展示口径：KEEP/DISCONTINUED/NEG_MARGIN_EXCLUDED/HOLIDAY_EXCLUDED'"),
]

NEW_INDEX = ("idx_filter_status", "replenishment_decisions",
             "`tenant_id`, `snapshot_date`, `filter_status`")

# K6 冻结枚举预置词库节日名（仅节日名占位条目，keyword 由运营维护；空关键词不预置，仅校验枚举用）
K6_HOLIDAY_NAMES = ["万圣节", "感恩节黑五", "圣诞节", "情人节", "复活节", "独立日",
                    "母亲节", "父亲节", "返校季", "PrimeDay", "其他"]


def migrate():
    with engine.connect() as conn:
        print(f"目标库: {get_settings().DATABASE_URL.split('@')[-1]}")

        # 1. 建表（幂等）
        for name, ddl in CREATE_TABLES.items():
            exists = conn.execute(text(f"SHOW TABLES LIKE '{name}'")).fetchall()
            if exists:
                print(f"[skip] 表 {name} 已存在")
                continue
            conn.execute(text(ddl))
            conn.commit()
            print(f"[ok]   建表 {name}")

        # 2. replenishment_decisions 加列（幂等）
        for col_name, col_def in NEW_COLUMNS:
            exists = conn.execute(
                text(f"SHOW COLUMNS FROM replenishment_decisions LIKE '{col_name}'")
            ).fetchall()
            if exists:
                print(f"[skip] replenishment_decisions.{col_name} 已存在: {exists[0][1]}")
                continue
            conn.execute(text(
                f"ALTER TABLE replenishment_decisions ADD COLUMN {col_name} {col_def}"
            ))
            conn.commit()
            print(f"[ok]   新增 replenishment_decisions.{col_name}")

        # 3. 过滤索引（幂等）
        idx_name, idx_table, idx_cols = NEW_INDEX
        exists = conn.execute(
            text(f"SHOW INDEX FROM {idx_table} WHERE Key_name = '{idx_name}'")
        ).fetchall()
        if exists:
            print(f"[skip] 索引 {idx_name} 已存在")
        else:
            conn.execute(text(
                f"ALTER TABLE {idx_table} ADD KEY `{idx_name}` ({idx_cols})"
            ))
            conn.commit()
            print(f"[ok]   新增索引 {idx_table}.{idx_name} ({idx_cols})")

        # 4. 校验
        print("\n校验结果:")
        tables = conn.execute(text("SHOW TABLES")).fetchall()
        table_names = {t[0] for t in tables}
        for name in CREATE_TABLES:
            status = "OK" if name in table_names else "MISSING"
            print(f"  表 {name}: {status}")
        cols = conn.execute(text("SHOW COLUMNS FROM replenishment_decisions")).fetchall()
        col_map = {c[0]: c[1] for c in cols}
        for col_name, _ in NEW_COLUMNS:
            print(f"  replenishment_decisions.{col_name}: {col_map.get(col_name, 'NOT FOUND')}")

        missing = [n for n in CREATE_TABLES if n not in table_names]
        missing += [c for c, _ in NEW_COLUMNS if c not in col_map]
        if missing:
            raise RuntimeError(f"迁移失败，缺失: {missing}")
        print("\n迁移完成。")


if __name__ == "__main__":
    migrate()
