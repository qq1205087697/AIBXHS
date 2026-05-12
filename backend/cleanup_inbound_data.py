
#!/usr/bin/env python3
"""
清理在途货件表中的表头数据
"""
import sys
from sqlalchemy import text

# 添加项目路径
sys.path.insert(0, '.')

from database.database import SessionLocal, engine


def cleanup_inbound_data():
    """清理在途货件表中的表头数据"""
    db = SessionLocal()
    try:
        print("开始清理在途货件表中的表头数据...")
        
        # 表头关键词
        header_keywords = ["货件单号", "shipment id", "shipmentid", "shipment_id", "货件id", "shipment", "单号"]
        
        # 查询并统计
        all_count = db.execute(text("SELECT COUNT(*) FROM inbound_shipment_details")).scalar()
        
        # 删除表头数据
        delete_count = 0
        for keyword in header_keywords:
            result = db.execute(
                text("DELETE FROM inbound_shipment_details WHERE LOWER(shipment_id) LIKE :keyword"),
                {"keyword": f"%{keyword.lower()}%"}
            )
            delete_count += result.rowcount
            db.commit()
        
        # 检查第一列包含关键词但没有数字的
        # 这里我们用简单的判断
        result = db.execute(text("""
            DELETE FROM inbound_shipment_details 
            WHERE 
                (shipment_id LIKE '%货件%' OR shipment_id LIKE '%单号%' OR shipment_id LIKE '%shipment%' OR shipment_id LIKE '%id%')
                AND shipment_id NOT REGEXP '[0-9]'
        """))
        delete_count += result.rowcount
        db.commit()
        
        remaining_count = db.execute(text("SELECT COUNT(*) FROM inbound_shipment_details")).scalar()
        
        print(f"✅ 清理完成！")
        print(f"   原总记录数: {all_count}")
        print(f"   删除了: {delete_count} 条")
        print(f"   剩余记录数: {remaining_count}")
        
    except Exception as e:
        print(f"❌ 清理失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    cleanup_inbound_data()
