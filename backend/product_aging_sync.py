﻿"""
商品超库龄库存同步模块

根据店铺名、日期和SKU库龄数据，同步到 product_aging_inventory 表。
如果同一条数据（店铺+日期+SKU）已存在则跳过，不存在则新增。

使用方法:
    from product_aging_sync import sync_product_aging_inventory
    sync_product_aging_inventory(
        store='A加',
        date_str='2026-08-25',
        sku_data={
            'SKU001': [10, 5, 3, 1],
            'SKU002': [20, 15, 8, 4],
        }
    )

参数说明:
    store:      店铺名称 (str)
    date_str:   日期字符串，格式 'YYYY-MM-DD' (str)
    sku_data:   字典，键为SKU，值为长度为4的列表
                [库龄181-270, 库龄271-365, 库龄366-455, 库龄456以上]
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
    from sqlalchemy import Column, Integer, String, Date, DateTime, create_engine, and_
    from sqlalchemy.orm import sessionmaker
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


class ProductAgingInventory(BaseModel):
    __tablename__ = "product_aging_inventory"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, index=True)
    store = Column(String(100), nullable=False, index=True)
    sku = Column(String(200), nullable=False, index=True)
    aging_181_270 = Column(Integer, nullable=True, default=0)
    aging_271_365 = Column(Integer, nullable=True, default=0)
    aging_366_455 = Column(Integer, nullable=True, default=0)
    aging_456_plus = Column(Integer, nullable=True, default=0)


# ==================== 数据库初始化 ====================
def _init_db():
    engine = create_engine(DATABASE_URL, poolclass=QueuePool, pool_pre_ping=True,
                           pool_size=5, max_overflow=10, echo=False)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ==================== 主函数 ====================
def sync_product_aging_inventory(store, date_str, sku_data):
    """
    同步商品超库龄库存数据到数据库。

    Args:
        store:     店铺名称 (str)
        date_str:  日期字符串 'YYYY-MM-DD' (str)
        sku_data:  SKU库龄数据字典 {sku: [181-270, 271-365, 366-455, 456+]}

    Returns:
        dict: {'inserted': N, 'skipped': M, 'failed': K}
    """
    SessionLocal = _init_db()
    db = SessionLocal()

    inserted = 0
    skipped = 0
    failed = 0

    try:
        # 解析日期
        try:
            record_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            print(f"日期格式错误: {date_str}，应为 'YYYY-MM-DD'")
            return {"inserted": 0, "skipped": 0, "failed": 0}

        if not isinstance(sku_data, dict):
            print(f"SKU数据格式错误，应为字典，实际: {type(sku_data)}")
            return {"inserted": 0, "skipped": 0, "failed": 0}

        for sku, aging_list in sku_data.items():
            try:
                # 校验列表长度
                if not isinstance(aging_list, (list, tuple)) or len(aging_list) < 4:
                    print(f"SKU {sku} 的库龄数据格式错误，需要长度为4的列表，跳过")
                    failed += 1
                    continue

                # 提取四个库龄段数量
                age_181_270 = int(aging_list[0]) if aging_list[0] not in (None, '', 'None') else 0
                age_271_365 = int(aging_list[1]) if aging_list[1] not in (None, '', 'None') else 0
                age_366_455 = int(aging_list[2]) if aging_list[2] not in (None, '', 'None') else 0
                age_456_plus = int(aging_list[3]) if aging_list[3] not in (None, '', 'None') else 0

                # 查找是否已存在（按店铺+日期+SKU判断）
                existing = db.query(ProductAgingInventory).filter(
                    and_(
                        ProductAgingInventory.date == record_date,
                        ProductAgingInventory.store == store,
                        ProductAgingInventory.sku == sku
                    )
                ).first()

                if existing:
                    # 已存在则跳过
                    print(f"跳过（已存在）: {date_str} - {store} - {sku}")
                    skipped += 1
                else:
                    # 不存在则新增
                    new_record = ProductAgingInventory(
                        date=record_date,
                        store=store,
                        sku=sku,
                        aging_181_270=age_181_270,
                        aging_271_365=age_271_365,
                        aging_366_455=age_366_455,
                        aging_456_plus=age_456_plus
                    )
                    db.add(new_record)
                    print(f"新增: {date_str} - {store} - {sku} | "
                          f"[181-270]:{age_181_270} [271-365]:{age_271_365} "
                          f"[366-455]:{age_366_455} [456+]:{age_456_plus}")
                    inserted += 1

            except Exception as e:
                print(f"处理 SKU {sku} 时出错: {e}")
                failed += 1
                continue

        db.commit()
        print(f"\n超库龄库存同步完成！新增: {inserted}, 跳过: {skipped}, 失败: {failed}")
        return {"inserted": inserted, "skipped": skipped, "failed": failed}

    except Exception as e:
        db.rollback()
        print(f"超库龄库存同步失败: {e}")
        return {"inserted": 0, "skipped": 0, "failed": len(sku_data)}
    finally:
        db.close()


if __name__ == "__main__":
    # 示例用法
    demo_data = {
        'SKU001': [10, 5, 3, 1],
        'SKU002': [20, 15, 8, 4],
        'SKU003': [0, 2, 0, 0],
    }

    result = sync_product_aging_inventory(
        store='A加',
        date_str='2026-08-25',
        sku_data=demo_data
    )
    print(f"\n执行结果: {result}")


__all__ = ['sync_product_aging_inventory']
