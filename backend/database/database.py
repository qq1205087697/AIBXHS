from sqlalchemy import create_engine, text, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from config import get_settings

settings = get_settings()

# 创建数据库引擎，确保使用utf8mb4
engine = create_engine(
    settings.DATABASE_URL,
    poolclass=QueuePool,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    # 必须小于 MySQL wait_timeout（实测 300s）：否则池中连接已被服务端关闭，
    # 每次 checkout 都要 pre_ping 重连，网络抖动时会直接抛 2013/10060
    pool_recycle=280,  # ≈4.5 分钟
    echo=False
)

# 添加事件监听器，确保每次连接都设置正确的字符集
@event.listens_for(engine, "connect")
def connect(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'")
    # DDL 等待 metadata lock 的超时由 lock_wait_timeout 控制，MySQL 默认
    # 31536000s（约 1 年）。startup 里 init_db() 的 ALTER/CREATE 一旦撞上
    # 未提交事务就会永久挂起，整个服务起不来且 health 无响应。
    # 限制到 15s：超时由 init_db 的异常分支记录后继续启动，不阻断服务。
    cursor.execute("SET SESSION lock_wait_timeout = 15")
    cursor.close()

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建基类
Base = declarative_base()


def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        # 确保每个会话的字符集设置正确
        db.execute(text("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'"))
        yield db
    finally:
        db.close()


def _column_exists(conn, table: str, column: str) -> bool:
    """列是否存在（走 information_schema，不靠 ALTER 抛异常判断）"""
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_NAME = :t AND COLUMN_NAME = :c"
        ),
        {"t": table, "c": column},
    ).scalar()
    return bool(row)


def _ensure_column_type(conn, table: str, column: str, expected_type: str, ddl: str) -> None:
    """列类型不符才 ALTER，启动路径不再重复发 DDL 去抢 metadata lock。

    已符合目标时立即 commit 结束只读事务，避免连接带着未提交事务进入
    Sleep 状态长期持有 MDL 读锁（历史启动僵死的成因之一）。
    """
    try:
        cur = conn.execute(
            text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :t AND COLUMN_NAME = :c"
            ),
            {"t": table, "c": column},
        ).scalar()
        if cur and cur.strip().lower() == expected_type.lower():
            conn.commit()
            return
        if cur:
            conn.execute(text(ddl))
            conn.commit()
            print(f"列类型已调整：{table}.{column} {cur} -> {expected_type}")
    except Exception as e:  # noqa: BLE001
        print(f"列类型检查/调整失败（{table}.{column}）: {e}")


def _ensure_columns(conn, specs) -> None:
    """幂等补列。specs = [(table, column, ddl_sql), ...]

    先判定再 ALTER，把「已存在跳过 / 新增成功 / 真失败」分成三种日志。
    原实现靠 try/except 兜「列已存在」，导致任何异常（例如列补丁里
    text 被函数内 import 遮蔽引发的 UnboundLocalError）都被打印成
    「添加字段失败（可能已存在）」，真实错误被掩盖。
    """
    for table, column, ddl in specs:
        if _column_exists(conn, table, column):
            print(f"字段已存在，跳过：{table}.{column}")
            continue
        try:
            conn.execute(text(ddl))
            print(f"字段已添加：{table}.{column}")
        except Exception as e:  # noqa: BLE001
            print(f"添加 {table}.{column} 字段失败: {e}")


def init_db():
    """初始化数据库"""
    try:
        # 导入所有模型（确保所有模型都被注册）
        from models import base
        from models import tenant
        from models import user
        from models import store
        from models import product
        from models import inventory
        from models import review
        from models import conversation
        from models import department
        from models import product_selection
        from models import data_warning
        from models import product_aging_inventory
        
        from models import ad_campaign
        from models import ad_report
        from models import ad_daily
        from models import group_message
        from models import memo
        from models import task

        # 导入所有模型类
        from models.tenant import Tenant
        from models.user import User
        from models.store import Store
        from models.product import Product
        from models.product_binding import ProductBinding
        from models.inventory import InventoryRecord, InventoryAlert, InventoryAction
        from models.review import Review, ReviewAnalysis, ReviewHandling
        from models.conversation import ConversationHistory
        from models.department import Department, UserDepartment
        from models.product_selection import ProductSelection
        from models.data_warning import DataWarning
        from models.product_sales import ProductSales
        from models.product_aging_inventory import ProductAgingInventory
        from models.threshold_setting import ThresholdSetting
        from models.restock import InventorySnapshot, InboundShipmentDetail, ReplenishmentDecision
        from models.local_inventory import LocalInventory
        from models.overseas_inventory import OverseasInventory
        from models.inventory_management import PurchaseOrder, PurchaseOrderItem, InboundOrder, InboundOrderItem, OutboundOrder, OutboundOrderItem, InventoryBatch, OperationLog, StockTransferOrder, StockTransferOrderItem, Warehouse, ReplenishmentOrder, ReplenishmentItem, ShipmentOrder, ShipmentOrderItem
        from models.ad_campaign import AdCampaign, AdGroup, AdKeyword, AdTarget, AdProductAd, AdNegativeKeyword
        from models.ad_report import AdReportSnapshot, AdOptimizationRule, AdOptimizationLog
        from models.group_message import GroupMessage, GroupsFs, GroupUserPermission
        from models.memo import Memo
        from models.task import Task, TaskAssignee, TaskReply
        from models.ad_daily import (
            AdCampaignDaily, AdKeywordDaily, AdSearchTermDaily,
            AdProductDaily, AdOptimizationSuggestion, AdExecutionLog
        )
        from models.ai_video_task import AIVideoTask
        from models.ai_image_task import AIImageTask
        from models.ai_image_layout import AIImageLayout
        from models.video_binding_request import VideoBindingRequest
        from models.finance import FinanceRecord, FinanceCategory, FinanceTemplate

        # 创建所有表
        Base.metadata.create_all(bind=engine)
        
        # 检查并添加缺失的字段（幂等：已存在则跳过，不再伪造「失败」日志）
        with engine.connect() as conn:
            _ensure_columns(conn, [
                # 财务流水表：一级/二级分类关联列（迁移到 finance_categories 分类表）
                ("finance_records", "category_id",
                 "ALTER TABLE finance_records ADD COLUMN category_id INT NULL COMMENT '一级分类ID，关联 finance_categories.id'"),
                ("finance_records", "sub_category_id",
                 "ALTER TABLE finance_records ADD COLUMN sub_category_id INT NULL COMMENT '二级分类ID，关联 finance_categories.id'"),
                ("product_sales", "deleted_at",
                 "ALTER TABLE product_sales ADD COLUMN deleted_at DATETIME NULL"),
                # 差评分析表新增部门板块分类字段
                ("review_analyses", "department",
                 "ALTER TABLE review_analyses ADD COLUMN department VARCHAR(20) NULL "
                 "COMMENT '问题板块:operations/purchasing/warehouse/design'"),
                # 差评分析表新增多板块字段（逗号分隔，一条差评可属多个板块）
                ("review_analyses", "departments",
                 "ALTER TABLE review_analyses ADD COLUMN departments VARCHAR(100) NULL "
                 "COMMENT '问题板块多选，逗号分隔:operations/purchasing/warehouse/design'"),
                # A+ 版式素材：列表用缩略图（原图 1~2MB，240 张直接进列表会把首屏拖死）
                ("ai_image_layouts", "thumb_url",
                 "ALTER TABLE ai_image_layouts ADD COLUMN thumb_url VARCHAR(1000) NULL "
                 "COMMENT '列表缩略图地址（TOS，<=480px，仅展示）'"),
                # 库存快照海外仓字段（飞书多维表同步写入主行）
                ("inventory_snapshots", "overseas_inventory",
                 "ALTER TABLE inventory_snapshots ADD COLUMN overseas_inventory FLOAT NULL DEFAULT 0 "
                 "COMMENT '海外仓可售库存'"),
                ("inventory_snapshots", "overseas_max_age",
                 "ALTER TABLE inventory_snapshots ADD COLUMN overseas_max_age FLOAT NULL "
                 "COMMENT '海外仓最大库龄（天）'"),
                # 发货单表补齐 shipments 路由使用的确认流程/转出库关联列（存量库缺列导致 1054）
                ("shipment_orders", "confirmed_by",
                 "ALTER TABLE shipment_orders ADD COLUMN confirmed_by INT NULL COMMENT '确认人'"),
                ("shipment_orders", "confirmer_name",
                 "ALTER TABLE shipment_orders ADD COLUMN confirmer_name VARCHAR(100) NULL COMMENT '确认人姓名'"),
                ("shipment_orders", "confirmed_at",
                 "ALTER TABLE shipment_orders ADD COLUMN confirmed_at DATETIME NULL COMMENT '确认时间'"),
                ("shipment_orders", "outbound_order_id",
                 "ALTER TABLE shipment_orders ADD COLUMN outbound_order_id INT NULL COMMENT '关联出库单ID'"),
                # 采购明细表补齐 purchase 路由使用的列（存量库缺列导致 1054）
                ("purchase_order_items", "supplier",
                 "ALTER TABLE purchase_order_items ADD COLUMN supplier VARCHAR(100) NULL COMMENT '供应商名称'"),
                ("purchase_order_items", "parent_product_id",
                 "ALTER TABLE purchase_order_items ADD COLUMN parent_product_id INT NULL COMMENT '关联成品ID（配件行）'"),
                ("purchase_order_items", "store_group_id",
                 "ALTER TABLE purchase_order_items ADD COLUMN store_group_id INT NULL COMMENT '店铺分组ID（明细级）'"),
                ("stores", "ozon_client_id",
                 "ALTER TABLE stores ADD COLUMN ozon_client_id VARCHAR(64) NULL COMMENT 'Ozon Seller API Client-Id'"),
                ("stores", "ozon_api_key",
                 "ALTER TABLE stores ADD COLUMN ozon_api_key VARCHAR(255) NULL COMMENT 'Ozon Seller API Api-Key（不回传前端）'"),
                ("product_selections", "store_group_ids",
                 "ALTER TABLE product_selections ADD COLUMN store_group_ids TEXT NULL COMMENT '申请店铺分组ID列表(JSON数组)'"),
                ("inbound_order_items", "shelf_number",
                 "ALTER TABLE inbound_order_items ADD COLUMN shelf_number VARCHAR(50) NULL COMMENT '货架号'"),
                ("inbound_order_items", "purchase_order_item_id",
                 "ALTER TABLE inbound_order_items ADD COLUMN purchase_order_item_id INT NULL COMMENT '关联采购明细ID'"),
                ("shipment_order_items", "sku",
                 "ALTER TABLE shipment_order_items ADD COLUMN sku VARCHAR(100) NULL COMMENT 'SKU'"),
            ])
            conn.commit()
        
        print("数据库表结构创建成功")

        # 权限种子自查：AI 生图接口全部依赖 ai_image:use（由 migrations/add_ai_image_permission.py 写入）。
        # 这里只做只读检查 + 告警，不自动授权，避免动到既有权限矩阵。
        try:
            with engine.connect() as conn:
                _has_perm = conn.execute(text(
                    "SELECT COUNT(*) FROM permissions WHERE code = 'ai_image:use' AND deleted_at IS NULL"
                )).scalar()
            if not _has_perm:
                print("⚠ 未找到权限 ai_image:use，AI 生图页面会返回 403；"
                      "请在目标库执行 backend/migrations/add_ai_image_permission.py")
        except Exception as _perm_err:
            print(f"权限种子自查跳过（权限表可能尚未创建）: {_perm_err}")
        
        # 手动创建 scheduler_locks 和 product_selections 表
        # 注意：text 已在模块顶部导入；函数内再 import 会使 text 变成本地变量，
        # 导致上方列补丁在执行时抛 UnboundLocalError 而静默失效
        with engine.connect() as conn:
            # 视频生成任务表新增视频类型字段（口播带货/产品展示，如果不存在）
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN video_type VARCHAR(20) NULL COMMENT '视频类型：口播带货/产品展示' AFTER status"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 视频生成任务表新增口播语言字段（如果不存在）
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN voiceover_language VARCHAR(30) NULL COMMENT '口播语言' AFTER market"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 视频生成任务表新增租户字段（历史按租户隔离），并回填存量数据
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN tenant_id INT NOT NULL DEFAULT 0 COMMENT '租户ID' AFTER id"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 视频生成任务表新增生成者字段，并按提交用户回填
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN creator_name VARCHAR(100) NULL COMMENT '生成者用户名' AFTER user_id"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            try:
                conn.execute(text(
                    "UPDATE ai_video_tasks t JOIN users u ON t.user_id = u.id "
                    "SET t.creator_name = u.username WHERE t.creator_name IS NULL OR t.creator_name = ''"
                ))
                conn.commit()
            except Exception:
                pass  # 回填失败不影响启动
            try:
                conn.execute(text(
                    "UPDATE ai_video_tasks t JOIN users u ON t.user_id = u.id "
                    "SET t.tenant_id = u.tenant_id WHERE t.tenant_id = 0"
                ))
                conn.commit()
            except Exception:
                pass  # 回填失败不影响启动
            # 视频生成任务表新增二次优化后的 H3 结构化提示词字段
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN h3_prompt TEXT NULL COMMENT '优化后的 H3 结构化提示词' AFTER prompt"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 视频生成任务表新增开始生成时间（首次进入「生成中」时记录，耗时=完成时间-开始时间，不含排队）
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN started_at DATETIME NULL COMMENT '开始生成时间' AFTER h3_prompt_id"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 视频生成任务表新增产品编码/品名（从产品管理选图提交时记录，用于历史搜索与展示）
            try:
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN product_code VARCHAR(50) NULL COMMENT '产品编码' AFTER title"))
                conn.execute(text("ALTER TABLE ai_video_tasks ADD COLUMN product_name VARCHAR(200) NULL COMMENT '产品品名' AFTER product_code"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 产品表新增多视频字段（JSON 数组，最多 6 个）
            try:
                conn.execute(text("ALTER TABLE products ADD COLUMN videos TEXT NULL COMMENT '产品视频列表（JSON 数组，最多6个）' AFTER video_url"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 视频超分任务表（Topaz 星光 2.6）
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS video_upscale_tasks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tenant_id INT NOT NULL,
                    user_id INT NULL,
                    creator_name VARCHAR(100) NULL,
                    title VARCHAR(200) NULL,
                    source_video_url VARCHAR(1000) NOT NULL,
                    source_width INT NULL,
                    source_height INT NULL,
                    scale FLOAT NULL,
                    status VARCHAR(20) DEFAULT '排队中',
                    error_message TEXT NULL,
                    video_url VARCHAR(1000) NULL,
                    comfy_prompt_id VARCHAR(64) NULL,
                    started_at DATETIME NULL,
                    finished_at DATETIME NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    deleted_at DATETIME NULL,
                    INDEX idx_upscale_tenant (tenant_id),
                    INDEX idx_upscale_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """))
            conn.commit()
            # 媒体创作中心：需求单据表（运营提报 → 主管审核 → 美工生成 → 内容审核 → 运营确认 → 待上传 → 已上传）
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS media_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tenant_id INT NOT NULL COMMENT '租户ID',
                    no INT NOT NULL COMMENT '主单号（审核通过拆单时子单沿用）',
                    seq VARCHAR(20) NOT NULL COMMENT '单据关联号：1 / 1-1 / 1-2',
                    parent_id INT NULL COMMENT '子单的父单ID',
                    product_id INT NOT NULL COMMENT '产品ID',
                    product_code VARCHAR(100) NULL COMMENT '产品编码',
                    product_name VARCHAR(300) NULL COMMENT '产品名称',
                    product_image VARCHAR(1000) NULL COMMENT '产品主图',
                    platform VARCHAR(20) NULL COMMENT '主平台：amazon/ozon',
                    platform_items TEXT NULL COMMENT '目标平台 SKU 条目（JSON 数组）',
                    demand_types TEXT NULL COMMENT '需求类型（JSON 数组）',
                    demand_type VARCHAR(40) NULL COMMENT '拆单后的单个需求类型',
                    description TEXT NULL COMMENT '需求描述',
                    prompt TEXT NULL COMMENT '视频提示词',
                    plan TEXT NULL COMMENT 'AI生成的视频方案（JSON）',
                    ref_images TEXT NULL COMMENT '参考图地址（JSON 数组，1~9 张）',
                    ratio VARCHAR(10) DEFAULT '9:16' COMMENT '视频比例',
                    resolution VARCHAR(10) DEFAULT '0.3' COMMENT '分辨率档位',
                    duration INT DEFAULT 15 COMMENT '视频时长（5/10/15）',
                    video_type VARCHAR(20) DEFAULT '口播带货' COMMENT '视频类型：口播带货/产品展示',
                    stage VARCHAR(20) NOT NULL DEFAULT '待提交' COMMENT '流转阶段',
                    gen_status VARCHAR(20) NULL COMMENT '生成状态：生成中/失败',
                    gen_task_id INT NULL COMMENT 'AI视频任务ID',
                    gen_kind VARCHAR(10) NULL COMMENT '生成任务类型：video=AI视频/image=AI生图',
                    gen_user_id INT NULL COMMENT '触发生成的用户ID（生图排队时用于并发判断）',
                    gen_time DATETIME NULL COMMENT '生成时间',
                    media_url VARCHAR(1000) NULL COMMENT '生成成片地址',
                    hd_status VARCHAR(20) NULL COMMENT '高清状态：高清中/失败',
                    hd_task_id INT NULL COMMENT '超分任务ID',
                    hd_url VARCHAR(1000) NULL COMMENT '高清成片地址',
                    hd_time DATETIME NULL COMMENT '高清完成时间',
                    bind_status VARCHAR(20) NULL COMMENT '绑定状态：审核中/已通过/已拒绝',
                    binding_request_id INT NULL COMMENT '绑定申请ID',
                    upload_status VARCHAR(20) NULL COMMENT '上传状态',
                    upload_time DATETIME NULL COMMENT '上传时间',
                    upload_result TEXT NULL COMMENT '上传结果（JSON）',
                    submitter_id INT NULL COMMENT '提报人ID',
                    submitter_name VARCHAR(100) NULL COMMENT '提报人',
                    submit_time DATETIME NULL COMMENT '提交审核时间',
                    reviewer_id INT NULL COMMENT '审核人ID',
                    reviewer_name VARCHAR(100) NULL COMMENT '审核人',
                    reviewer_at DATETIME NULL COMMENT '最近审核时间',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    deleted_at DATETIME NULL,
                    INDEX idx_media_tenant_stage (tenant_id, stage),
                    INDEX idx_media_tenant_no (tenant_id, no),
                    INDEX idx_media_task (gen_task_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='媒体创作中心需求单据'
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS media_request_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tenant_id INT NOT NULL,
                    request_id INT NOT NULL,
                    actor_id INT NULL,
                    actor_name VARCHAR(100) NULL,
                    action VARCHAR(50) NULL,
                    note VARCHAR(1000) NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_media_log_request (request_id),
                    INDEX idx_media_log_tenant (tenant_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='媒体创作中心操作日志'
            """))
            conn.commit()
            # 已存在的 media_requests 表补 plan / 高清 / 绑定门禁字段
            _media_extra_columns = [
                ("plan", "ALTER TABLE media_requests ADD COLUMN plan TEXT NULL COMMENT 'AI生成的视频方案（JSON）' AFTER prompt"),
                ("gen_kind", "ALTER TABLE media_requests ADD COLUMN gen_kind VARCHAR(10) NULL COMMENT '生成任务类型：video=AI视频/image=AI生图' AFTER gen_task_id"),
                ("gen_user_id", "ALTER TABLE media_requests ADD COLUMN gen_user_id INT NULL COMMENT '触发生成的用户ID（生图排队时用于并发判断）' AFTER gen_kind"),
                ("hd_status", "ALTER TABLE media_requests ADD COLUMN hd_status VARCHAR(20) NULL COMMENT '高清状态：高清中/失败' AFTER media_url"),
                ("hd_task_id", "ALTER TABLE media_requests ADD COLUMN hd_task_id INT NULL COMMENT '超分任务ID' AFTER hd_status"),
                ("hd_url", "ALTER TABLE media_requests ADD COLUMN hd_url VARCHAR(1000) NULL COMMENT '高清成片地址' AFTER hd_task_id"),
                ("hd_time", "ALTER TABLE media_requests ADD COLUMN hd_time DATETIME NULL COMMENT '高清完成时间' AFTER hd_url"),
                ("bind_status", "ALTER TABLE media_requests ADD COLUMN bind_status VARCHAR(20) NULL COMMENT '绑定状态：审核中/已通过/已拒绝' AFTER hd_time"),
                ("media_type", "ALTER TABLE media_requests ADD COLUMN media_type VARCHAR(10) NULL COMMENT '成片类型：video=视频/image=图片（已有素材提报时标记）' AFTER binding_request_id"),
                ("media_style", "ALTER TABLE media_requests ADD COLUMN media_style VARCHAR(20) NULL COMMENT '图片类型：主图/附图/A+（已有素材图片提报时标记）' AFTER media_type"),
                ("binding_request_id", "ALTER TABLE media_requests ADD COLUMN binding_request_id INT NULL COMMENT '绑定申请ID' AFTER bind_status"),
            ]
            for _col, _sql in _media_extra_columns:
                try:
                    conn.execute(text(_sql))
                    conn.commit()
                except Exception:
                    pass  # 列已存在则忽略
            # 创建 scheduler_locks 表
            create_lock_table_sql = """
                CREATE TABLE IF NOT EXISTS scheduler_locks (
                    lock_key VARCHAR(100) PRIMARY KEY,
                    is_active BOOLEAN DEFAULT FALSE,
                    acquired_at DATETIME DEFAULT NULL,
                    expires_at DATETIME DEFAULT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_active (is_active),
                    INDEX idx_expires (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调度器分布式锁表';
            """
            conn.execute(text(create_lock_table_sql))

            # 创建 product_selections 表（作为备份，以防 ORM 创建失败）
            create_product_selection_table_sql = """
                CREATE TABLE IF NOT EXISTS product_selections (
                    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '选品ID',
                    tenant_id INT NOT NULL COMMENT '租户ID',
                    product_title VARCHAR(500) NOT NULL COMMENT '产品标题',
                    url VARCHAR(1000) NULL COMMENT 'URL',
                    asin VARCHAR(50) NULL COMMENT 'ASIN',
                    image_url VARCHAR(1000) NULL COMMENT '图片链接',
                    rating FLOAT NULL COMMENT '评分',
                    review_count INT NULL COMMENT '评论数',
                    keywords VARCHAR(500) NULL COMMENT '关键词',
                    price DECIMAL(12, 2) NULL COMMENT '价格',
                    commission DECIMAL(12, 2) NULL COMMENT '佣金',
                    first_leg_cost DECIMAL(12, 2) NULL COMMENT '头程',
                    last_mile_cost DECIMAL(12, 2) NULL COMMENT '尾程',
                    weight_kg FLOAT NULL COMMENT '重量(kg)',
                    cost_at_15_profit DECIMAL(12, 2) NULL COMMENT '15%毛利时成本',
                    product_type VARCHAR(100) NULL COMMENT '类型',
                    site VARCHAR(50) NULL COMMENT '站点',
                    monthly_sales INT NULL COMMENT '近一个月销量',
                    traffic_trend TEXT NULL COMMENT '流量趋势(单关键词{月:流量}或多关键词{词:{月:流量}})',
            seasonality TEXT NULL COMMENT '季节性判断',
            infringement_analysis TEXT NULL COMMENT '侵权分析',
            infringement_conclusion VARCHAR(500) NULL COMMENT '侵权分析结论',
            traffic_score_result TEXT NULL COMMENT '流量评分结果(多关键词时含最优关键词标注)',
            traffic_score FLOAT NULL COMMENT '流量评分',
            sales_score FLOAT NULL COMMENT '销量评分',
            rating_score FLOAT NULL COMMENT '星级评分',
            penalty_factor FLOAT NULL COMMENT '惩罚因子',
            composite_score FLOAT NULL COMMENT '综合评分',
                    ai_raw_response TEXT NULL COMMENT 'AI原始返回',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL COMMENT '更新时间',
                    deleted_at DATETIME NULL COMMENT '删除时间',
                    INDEX idx_tenant_id (tenant_id),
                    INDEX idx_asin (asin),
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='选品表';
            """
            conn.execute(text(create_product_selection_table_sql))
            conn.commit()
            # 为已存在的表添加 site 列（如果不存在）
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN site VARCHAR(50) NULL COMMENT '站点' AFTER product_type"))
                conn.commit()
            except Exception:
                pass  # 列已存在则忽略
            # 为已存在的表添加汇率列（如果不存在）
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN scrape_rate DECIMAL(12, 6) NULL COMMENT '抓取时汇率(1外币兑人民币)' AFTER cost_at_15_profit"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN realtime_rate DECIMAL(12, 6) NULL COMMENT '实时汇率(1外币兑人民币)' AFTER scrape_rate"))
                conn.commit()
            except Exception:
                pass
            # 为已存在的表添加类目列（如果不存在）
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN category VARCHAR(1000) NULL COMMENT '类目(JSON列表)' AFTER realtime_rate"))
                conn.commit()
            except Exception:
                pass
            # 多选店铺分组（合并为一条申请时记录全部分组，JSON数组）
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN store_group_ids TEXT NULL COMMENT '申请店铺分组ID列表(JSON数组)' AFTER store_group_id"))
                conn.commit()
            except Exception:
                pass
            # 头程改为3位小数（仅类型不符时才改，避免每次启动都申请 MDL 写锁）
            _ensure_column_type(
                conn, "product_selections", "first_leg_cost", "decimal(12,3)",
                "ALTER TABLE product_selections MODIFY COLUMN first_leg_cost DECIMAL(12, 3) NULL COMMENT '头程'",
            )

            # products 表新增无配件标记字段（如果不存在）
            try:
                conn.execute(text("ALTER TABLE products ADD COLUMN no_accessory TINYINT(1) NOT NULL DEFAULT 0 COMMENT '无配件标记(是:数据补齐不再提示未绑配件)'"))
                conn.commit()
            except Exception:
                pass

            # 页面优化机器人表品名字段（与库存快照表品名长度一致，仅类型不符时才改）
            _ensure_column_type(
                conn, "product_page_info", "product_name", "varchar(500)",
                "ALTER TABLE product_page_info MODIFY COLUMN product_name VARCHAR(500) NULL COMMENT '品名'",
            )

        print("scheduler_locks 和 product_selections 表创建成功")

        # 注意：ALTER 必须放在 SessionLocal 块外——块内未提交事务会持有表元数据锁，
        # 导致另一连接的 ALTER 等锁卡死启动流程
        try:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE currency_rates MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'"))
                conn.commit()
        except Exception:
            pass  # 已是 ON UPDATE 或执行失败不影响启动

        # 财务流水表 category 文本列放宽（分类改名后名称可能超 20 字符）
        try:
            with engine.connect() as conn:
                _ensure_column_type(conn, "finance_records", "category", "varchar(50)",
                                    "ALTER TABLE finance_records MODIFY COLUMN category VARCHAR(50) NOT NULL COMMENT '一级分类名称（冗余文本，兼容旧数据）'")
        except Exception as e:
            print(f"finance_records.category 列宽调整失败: {e}")

    except Exception as e:
        print(f"数据库初始化失败: {e}")
        raise
