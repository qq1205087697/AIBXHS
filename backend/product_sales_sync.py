"""
商品销量数据同步模块
同步商品销量信息到数据库

使用方法:
    from product_sales_sync import sync_product_sales
    sync_product_sales(data_dict)

输入格式:
    {
        '2026-06-26': {
            '店铺A': {'SKU001': 100, 'SKU002': 50, 'SKU003': 30},
            '店铺B': {'SKU004': 80, 'SKU005': 25},
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
    from sqlalchemy import Column, Integer, String, Date, ForeignKey, DateTime, create_engine, and_
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


class ProductSales(BaseModel):
    __tablename__ = "product_sales"
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    store = Column(String(100), nullable=False, index=True)
    sku = Column(String(200), nullable=False, index=True)
    sales_count = Column(Integer, nullable=False, server_default="0")
    tenant = relationship("Tenant")


# ==================== 数据库初始化 ====================
def _init_db():
    engine = create_engine(DATABASE_URL, poolclass=QueuePool, pool_pre_ping=True, pool_size=5, max_overflow=10, echo=False)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ==================== 主函数 ====================
def sync_product_sales(data_dict):
    """同步商品销量数据到数据库"""
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
            
            for store_name, sku_data in store_data.items():
                if not isinstance(sku_data, dict):
                    print(f"店铺 {store_name} 的SKU数据格式错误，跳过")
                    continue
                
                for sku, sales_count in sku_data.items():
                    existing = db.query(ProductSales).filter(
                        and_(
                            ProductSales.tenant_id == 1,
                            ProductSales.date == record_date,
                            ProductSales.store == store_name,
                            ProductSales.sku == sku
                        )
                    ).first()
                    
                    sales_count_val = int(sales_count) if sales_count not in (None, '', 'None') else 0
                    
                    if existing:
                        existing.sales_count = sales_count_val
                        print(f"更新: {date_str} - {store_name} - {sku}")
                    else:
                        new_record = ProductSales(
                            tenant_id=1,
                            date=record_date,
                            store=store_name,
                            sku=sku,
                            sales_count=sales_count_val
                        )
                        db.add(new_record)
                        print(f"新增: {date_str} - {store_name} - {sku}")
        
        db.commit()
        print("商品销量数据同步完成！")
        return True
        
    except Exception as e:
        db.rollback()
        print(f"商品销量数据同步失败: {e}")
        return False
    finally:
        db.close()


__all__ = ['sync_product_sales']
