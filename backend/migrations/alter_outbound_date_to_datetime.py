from sqlalchemy import text
from database.database import engine
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def upgrade():
    try:
        with engine.connect() as conn:
            # 先检查当前字段类型
            result = conn.execute(text("""
                SHOW COLUMNS FROM outbound_orders LIKE 'outbound_date'
            """)).fetchone()
            
            if result:
                current_type = result[1]
                print(f"当前字段类型: {current_type}")
                
                # 修改字段类型为 DATETIME
                conn.execute(text("""
                    ALTER TABLE outbound_orders 
                    MODIFY COLUMN outbound_date DATETIME NULL COMMENT '出库日期'
                """))
                conn.commit()
                print("outbound_date 字段已成功修改为 DATETIME 类型")
            else:
                print("未找到 outbound_date 字段")
    except Exception as e:
        print(f"修改失败: {e}")
        raise

if __name__ == "__main__":
    upgrade()
