"""
数据预警同步模块
同步数据预警信息到数据库

使用方法:
    from data_warning_simple import sync_data
    sync_data(data_dict)

输入格式:
    {
        '2026-06-26': {
            'A加': {'订单量': '39', '广告占比': '0.0864', 'ACOS': None, 'GMV': '2792.06', 'FBA总库存': None, '货值¥': 0, '仓储占比': '0.0161', '毛利润': '574.95', '毛利率': '0.2381'},
            'A欧': {'订单量': '0', '广告占比': '0', 'ACOS': None, 'GMV': '0', 'FBA总库存': None, '货值¥': 0, '仓储占比': '0', '毛利润': '-0.47', '毛利率': '0'},
            '店铺3': {...}
        },
        '日期2': {...}
    }
"""

import sys
from datetime import datetime

if sys.platform == 'win32':
    try:
        import io
        if hasattr(sys.stdout, 'buffer'):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    except Exception:
        pass

try:
    from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, create_engine, and_
    from sqlalchemy.orm import relationship, sessionmaker
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy.sql import func
    from sqlalchemy.pool import QueuePool
    import urllib.parse
except ImportError:
    print("请先安装依赖: pip install sqlalchemy pymysql")
    raise


# ==================== 数据库配置 ====================
DB_USER = "bxhs_ai_assistance"
DB_PASSWORD = "bxhsaiRoot@123"
DB_HOST = "115.190.250.14"
DB_PORT = 3306
DB_NAME = "bxhs_ai_assistance"

encoded_password = urllib.parse.quote_plus(DB_PASSWORD)
DATABASE_URL = f"mysql+pymysql://{DB_USER}:{encoded_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"


# ==================== 模型定义 ====================
Base = declarative_base()


class BaseModel(Base):
    __abstract__ = True
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=True)


class DataWarning(BaseModel):
    __tablename__ = "data_warnings"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    store = Column(String(100), nullable=False, index=True)
    order_count = Column(Integer, nullable=False)
    ad_ratio = Column(Float, nullable=False)
    acos = Column(Float, nullable=False)
    cargo_value = Column(Float, nullable=False)
    gmv = Column(Float, nullable=False)
    storage_ratio = Column(Float, nullable=True)
    gross_profit = Column(Float, nullable=True)
    gross_margin = Column(Float, nullable=True)
    fba_total_stock = Column(Integer, nullable=True)
    tenant = relationship("Tenant")


# ==================== 数据库初始化 ====================
def _init_db():
    engine = create_engine(DATABASE_URL, poolclass=QueuePool, pool_pre_ping=True, pool_size=5, max_overflow=10, echo=False)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ==================== 主函数 ====================
def sync_data(data_dict):
    """同步数据预警信息到数据库"""
    SessionLocal = _init_db()
    db = SessionLocal()
    
    try:
        tenant = db.query(Tenant).filter(Tenant.id == 1).first()
        if not tenant:
            tenant = Tenant(id=1, name="Default Tenant")
            db.add(tenant)
            db.commit()
        
        for date_str, store_data in data_dict.items():
            try:
                record_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                print(f"日期格式错误: {date_str}，跳过")
                continue
            
            for store_name, record in store_data.items():
                existing = db.query(DataWarning).filter(
                    and_(
                        DataWarning.tenant_id == 1,
                        DataWarning.date == record_date,
                        DataWarning.store == store_name
                    )
                ).first()
                
                def get_int(key, default=0):
                    val = record.get(key)
                    return int(val) if val not in (None, '', 'None') else default
                
                def get_float(key, default=0.0):
                    val = record.get(key)
                    return float(val) if val not in (None, '', 'None') else default
                
                def get_float_null(key):
                    val = record.get(key)
                    return float(val) if val not in (None, '', 'None') else None
                
                def get_int_null(key):
                    val = record.get(key)
                    return int(val) if val not in (None, '', 'None') else None
                
                order_count = get_int('订单量')
                ad_ratio = get_float('广告占比')
                acos = get_float('ACOS')
                cargo_value = get_float('货值¥')
                gmv = get_float('GMV')
                storage_ratio = get_float_null('仓储占比')
                gross_profit = get_float_null('毛利润')
                gross_margin = get_float_null('毛利率')
                fba_total_stock = get_int_null('FBA总库存')
                
                if existing:
                    existing.order_count = order_count
                    existing.ad_ratio = ad_ratio
                    existing.acos = acos
                    existing.cargo_value = cargo_value
                    existing.gmv = gmv
                    existing.storage_ratio = storage_ratio
                    existing.gross_profit = gross_profit
                    existing.gross_margin = gross_margin
                    existing.fba_total_stock = fba_total_stock
                    print(f"更新: {date_str} - {store_name}")
                else:
                    new_record = DataWarning(
                        tenant_id=1,
                        date=record_date,
                        store=store_name,
                        order_count=order_count,
                        ad_ratio=ad_ratio,
                        acos=acos,
                        cargo_value=cargo_value,
                        gmv=gmv,
                        storage_ratio=storage_ratio,
                        gross_profit=gross_profit,
                        gross_margin=gross_margin,
                        fba_total_stock=fba_total_stock
                    )
                    db.add(new_record)
                    print(f"新增: {date_str} - {store_name}")
        
        db.commit()
        print("数据同步完成！")
        
    except Exception as e:
        db.rollback()
        print(f"数据同步失败: {e}")
        raise
    finally:
        db.close()


__all__ = ['sync_data']
