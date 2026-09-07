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
    pool_recycle=1800,  # 30分钟
    echo=False
)

# 添加事件监听器，确保每次连接都设置正确的字符集
@event.listens_for(engine, "connect")
def connect(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'")
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
        
        from models import ad_campaign
        from models import ad_report
        from models import ad_daily

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
        from models.threshold_setting import ThresholdSetting
        from models.restock import InventorySnapshot, InboundShipmentDetail, ReplenishmentDecision
        from models.local_inventory import LocalInventory
        from models.inventory_management import PurchaseOrder, PurchaseOrderItem, InboundOrder, InboundOrderItem, OutboundOrder, OutboundOrderItem, InventoryBatch, OperationLog, StockTransferOrder, StockTransferOrderItem, Warehouse, ReplenishmentOrder, ReplenishmentItem, ShipmentOrder, ShipmentOrderItem
        from models.ad_campaign import AdCampaign, AdGroup, AdKeyword, AdTarget, AdProductAd, AdNegativeKeyword
        from models.ad_report import AdReportSnapshot, AdOptimizationRule, AdOptimizationLog
        from models.ad_daily import (
            AdCampaignDaily, AdKeywordDaily, AdSearchTermDaily,
            AdProductDaily, AdOptimizationSuggestion, AdExecutionLog
        )
        
        # 创建所有表
        Base.metadata.create_all(bind=engine)
        
        # 检查并添加缺失的字段
        with engine.connect() as conn:
            tables_to_check = ['product_sales']
            for table in tables_to_check:
                try:
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN deleted_at DATETIME NULL'))
                except Exception as e:
                    print(f"添加 {table}.deleted_at 字段失败（可能已存在）: {e}")
            # 差评分析表新增部门板块分类字段
            try:
                conn.execute(text("ALTER TABLE review_analyses ADD COLUMN department VARCHAR(20) NULL COMMENT '问题板块:operations/purchasing/warehouse/design'"))
            except Exception as e:
                print(f"添加 review_analyses.department 字段失败（可能已存在）: {e}")
            conn.commit()
        
        print("数据库表结构创建成功")
        
        # 手动创建 scheduler_locks 和 product_selections 表
        from sqlalchemy import text
        with engine.connect() as conn:
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
                    traffic_trend VARCHAR(200) NULL COMMENT '流量趋势',
            seasonality TEXT NULL COMMENT '季节性判断',
            infringement_analysis TEXT NULL COMMENT '侵权分析',
            infringement_conclusion VARCHAR(500) NULL COMMENT '侵权分析结论',
            traffic_score_result VARCHAR(500) NULL COMMENT '流量评分结果',
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
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN scrape_rate DECIMAL(12, 6) NULL COMMENT '抓取时汇率(1人民币兑外币)' AFTER cost_at_15_profit"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN realtime_rate DECIMAL(12, 6) NULL COMMENT '实时汇率(1人民币兑外币)' AFTER scrape_rate"))
                conn.commit()
            except Exception:
                pass
            # 为已存在的表添加类目列（如果不存在）
            try:
                conn.execute(text("ALTER TABLE product_selections ADD COLUMN category VARCHAR(1000) NULL COMMENT '类目(JSON列表)' AFTER realtime_rate"))
                conn.commit()
            except Exception:
                pass
            # 头程改为3位小数（如果需要）
            try:
                conn.execute(text("ALTER TABLE product_selections MODIFY COLUMN first_leg_cost DECIMAL(12, 3) NULL COMMENT '头程'"))
                conn.commit()
            except Exception:
                pass

            # products 表新增无配件标记字段（如果不存在）
            try:
                conn.execute(text("ALTER TABLE products ADD COLUMN no_accessory TINYINT(1) NOT NULL DEFAULT 0 COMMENT '无配件标记(是:数据补齐不再提示未绑配件)'"))
                conn.commit()
            except Exception:
                pass
        print("scheduler_locks 和 product_selections 表创建成功")
        
    except Exception as e:
        print(f"数据库初始化失败: {e}")
        raise
