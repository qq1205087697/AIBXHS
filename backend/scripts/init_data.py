#!/usr/bin/env python3
"""数据初始化脚本"""
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.database import SessionLocal, init_db
from models.tenant import Tenant, PlanType, TenantStatus
from models.user import User, UserRole, UserStatus
from models.store import Store, Platform, StoreStatus, SyncStatus
from models.product import Product, ProductStatus
from models.inventory import InventoryRecord, InventoryAlert, InventoryAction, \
    InventorySource, AlertType, AlertSeverity, AlertStatus, \
    ActionType, ActionStatus, TriggeredBy
from models.review import Review, ReviewStatus, Sentiment, ReviewAnalysis, ReviewHandling, HandlingAction
from datetime import datetime, date, timedelta
import json

def init_sample_data():
    """初始化示例数据"""
    db = SessionLocal()
    try:
        print("开始初始化示例数据...")
        
        # 检查是否已有数据
        existing_tenant = db.query(Tenant).first()
        if existing_tenant:
            print("数据库中已有数据，跳过初始化")
            return
        
        # 1. 创建租户
        print("创建租户...")
        tenant = Tenant(
            name="宝鑫华盛",
            code="baoxin",
            contact_name="张三",
            contact_phone="13800138000",
            contact_email="zhangsan@baoxinhuasheng.com",
            plan_type=PlanType.PRO,
            status=TenantStatus.ACTIVE,
            max_users=20,
            max_stores=10
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        
        # 2. 创建用户
        print("创建用户...")
        user = User(
            tenant_id=tenant.id,
            username="admin",
            email="admin@baoxinhuasheng.com",
            password_hash="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",  # admin123
            nickname="管理员",
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        
        # 3. 创建店铺
        print("创建店铺...")
        store = Store(
            tenant_id=tenant.id,
            name="宝鑫华盛美国站",
            platform=Platform.AMAZON,
            site="US",
            marketplace_id="ATVPDKIKX0DER",
            status=StoreStatus.ACTIVE,
            sync_status=SyncStatus.IDLE,
            created_by=user.id
        )
        db.add(store)
        db.commit()
        db.refresh(store)
        
        # 4. 创建商品
        print("创建商品...")
        products = [
            Product(
                tenant_id=tenant.id,
                store_id=store.id,
                asin="B08XQH7X1Y",
                sku="BTH-001",
                name="无线蓝牙耳机 Pro Max",
                name_en="Wireless Bluetooth Earbuds Pro Max",
                price=199.99,
                cost_price=89.99,
                category="Electronics",
                brand="Baoxin",
                status=ProductStatus.ACTIVE,
                created_by=user.id
            ),
            Product(
                tenant_id=tenant.id,
                store_id=store.id,
                asin="B09G1V8K2P",
                sku="PHC-002",
                name="手机壳套装 透明款",
                name_en="Phone Case Set Transparent",
                price=29.99,
                cost_price=9.99,
                category="Accessories",
                brand="Baoxin",
                status=ProductStatus.ACTIVE,
                created_by=user.id
            ),
            Product(
                tenant_id=tenant.id,
                store_id=store.id,
                asin="B08Y1Z2X3W",
                sku="FHB-003",
                name="智能运动手环 黑色",
                name_en="Smart Fitness Band Black",
                price=79.99,
                cost_price=29.99,
                category="Wearables",
                brand="Baoxin",
                status=ProductStatus.ACTIVE,
                created_by=user.id
            )
        ]
        for product in products:
            db.add(product)
        db.commit()
        for product in products:
            db.refresh(product)
        
        # 5. 创建库存记录和预警
        print("创建库存数据...")
        for i, product in enumerate(products):
            # 库存记录
            inventory_record = InventoryRecord(
                tenant_id=tenant.id,
                product_id=product.id,
                store_id=store.id,
                quantity=12 if i == 0 else 580 if i == 1 else 42,
                quantity_available=12 if i == 0 else 580 if i == 1 else 42,
                safe_stock=50 if i == 0 else 200 if i == 1 else 100,
                daily_sales=2 if i == 0 else 6 if i == 1 else 5,
                days_remaining=5 if i == 0 else 90 if i == 1 else 8,
                record_date=date.today(),
                source=InventorySource.API_SYNC
            )
            db.add(inventory_record)
            
            # 库存预警
            if i == 0:
                # 断货预警
                alert = InventoryAlert(
                    tenant_id=tenant.id,
                    product_id=product.id,
                    store_id=store.id,
                    alert_type=AlertType.LOW_STOCK,
                    severity=AlertSeverity.DANGER,
                    title="库存告急",
                    description="无线蓝牙耳机 Pro Max 库存即将告罄",
                    current_stock=12,
                    safe_stock=50,
                    suggestions={
                        "suggestion": "建议立即补货，并临时提高售价20%，同时降低广告预算30%以减少订单量。",
                        "daysRemaining": 5
                    },
                    status=AlertStatus.NEW,
                    priority=9
                )
            elif i == 1:
                # 冗余预警
                alert = InventoryAlert(
                    tenant_id=tenant.id,
                    product_id=product.id,
                    store_id=store.id,
                    alert_type=AlertType.OVERSTOCK,
                    severity=AlertSeverity.WARNING,
                    title="库存积压",
                    description="手机壳套装 透明款 库存积压严重",
                    current_stock=580,
                    safe_stock=200,
                    suggestions={
                        "suggestion": "库存积压严重！建议：1. 打8折促销；2. 绑定爆款做买一送一；3. 报名LD秒杀活动。",
                        "daysRemaining": 90
                    },
                    status=AlertStatus.NEW,
                    priority=7
                )
            else:
                # 断货预警
                alert = InventoryAlert(
                    tenant_id=tenant.id,
                    product_id=product.id,
                    store_id=store.id,
                    alert_type=AlertType.LOW_STOCK,
                    severity=AlertSeverity.DANGER,
                    title="库存告急",
                    description="智能运动手环 黑色 库存即将告罄",
                    current_stock=42,
                    safe_stock=100,
                    suggestions={
                        "suggestion": "库存即将告罄！建议紧急空运补货，并适当提价15%。",
                        "daysRemaining": 8
                    },
                    status=AlertStatus.NEW,
                    priority=8
                )
            db.add(alert)
        
        # 6. 创建差评和分析
        print("创建差评数据...")
        reviews = [
            Review(
                tenant_id=tenant.id,
                store_id=store.id,
                product_id=products[0].id,
                review_id="R123456",
                reviewer_name="John Smith",
                rating=2,
                title="Battery life is terrible",
                content="The sound quality is good but the battery life is terrible. Only lasts 2 hours when fully charged.",
                content_translated="音质不错，但电池续航太差了。充满电后只能用2小时。",
                is_negative=True,
                helpful_votes=5,
                review_date=datetime.now() - timedelta(days=1),
                source_url="https://www.amazon.com/review/R123456",
                status=ReviewStatus.NEW
            ),
            Review(
                tenant_id=tenant.id,
                store_id=store.id,
                product_id=products[1].id,
                review_id="R789012",
                reviewer_name="Maria Garcia",
                rating=1,
                title="Terrible product",
                content="Terrible product! It broke after 3 days. The material is very cheap.",
                content_translated="糟糕的产品！3天后就坏了。材质非常廉价。",
                is_negative=True,
                helpful_votes=8,
                review_date=datetime.now() - timedelta(days=2),
                source_url="https://www.amazon.com/review/R789012",
                status=ReviewStatus.PROCESSING
            ),
            Review(
                tenant_id=tenant.id,
                store_id=store.id,
                product_id=products[2].id,
                review_id="R345678",
                reviewer_name="Tom Brown",
                rating=3,
                title="Heart rate monitor not accurate",
                content="The bracelet is okay, but the heart rate monitor is not accurate.",
                content_translated="手环还可以，但心率监测不准确。",
                is_negative=True,
                helpful_votes=3,
                review_date=datetime.now() - timedelta(days=3),
                source_url="https://www.amazon.com/review/R345678",
                status=ReviewStatus.RESOLVED
            )
        ]
        
        for review in reviews:
            db.add(review)
        db.commit()
        for review in reviews:
            db.refresh(review)
        
        # 创建评论分析
        for i, review in enumerate(reviews):
            analysis = ReviewAnalysis(
                tenant_id=tenant.id,
                review_id=review.id,
                model="gpt-4",
                sentiment=Sentiment.NEGATIVE,
                sentiment_score=2 if i == 0 else 1 if i == 1 else 3,
                key_points=["电池续航问题", "需要改进电池容量", "音质满意"] if i == 0 else 
                          ["材质质量差", "易损坏", "需要更换供应商"] if i == 1 else 
                          ["心率监测不准确", "需要校准算法"],
                topics=["质量问题", "电池问题"] if i == 0 else 
                       ["质量问题", "材质问题"] if i == 1 else 
                       ["功能问题", "准确性问题"],
                suggestions=["检查电池供应商", "优化电池管理"] if i == 0 else 
                           ["更换材质供应商", "加强质量检测"] if i == 1 else 
                           ["校准算法", "更新固件"],
                summary="用户反映电池续航问题严重，建议立即改进电池容量和管理系统。" if i == 0 else 
                       "用户反映产品质量差，3天就损坏，建议更换材质供应商。" if i == 1 else 
                       "用户反映心率监测不准确，建议校准算法并更新固件。"
            )
            db.add(analysis)
        
        # 7. 创建处理记录
        print("创建处理记录...")
        for i, review in enumerate(reviews):
            if i == 1:  # 第二个差评正在处理中
                handling = ReviewHandling(
                    tenant_id=tenant.id,
                    review_id=review.id,
                    handler_id=user.id,
                    action=HandlingAction.OTHER,
                    note="正在联系用户处理退款"
                )
                db.add(handling)
            elif i == 2:  # 第三个差评已解决
                handling = ReviewHandling(
                    tenant_id=tenant.id,
                    review_id=review.id,
                    handler_id=user.id,
                    action=HandlingAction.REPLY,
                    note="已联系用户并提供了优惠券",
                    reply_content="We apologize for the inconvenience. We've updated the firmware to improve heart rate accuracy.",
                    reply_sent=True,
                    reply_sent_at=datetime.now() - timedelta(days=1)
                )
                db.add(handling)
        
        db.commit()
        print("示例数据初始化完成！")
        
    except Exception as e:
        print(f"初始化数据失败: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    # 初始化数据库
    init_db()
    # 初始化示例数据
    init_sample_data()
