"""
Alter inbound_date column from DATE to DATETIME
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database.database import engine
from sqlalchemy import text

def migrate():
    try:
        with engine.connect() as conn:
            print("Altering inbound_orders.inbound_date from DATE to DATETIME...")
            conn.execute(text("""
                ALTER TABLE inbound_orders 
                MODIFY COLUMN inbound_date DATETIME DEFAULT NULL COMMENT '入库日期'
            """))
            conn.commit()
            print("Successfully altered inbound_orders.inbound_date to DATETIME")
            
            # Optional: Update existing records to have correct time
            print("\nUpdating existing records to preserve time...")
            conn.execute(text("""
                UPDATE inbound_orders 
                SET inbound_date = created_at 
                WHERE inbound_date IS NOT NULL
            """))
            conn.commit()
            print("Updated existing records")
            
    except Exception as e:
        print(f"Migration failed: {str(e)}")
        raise

if __name__ == "__main__":
    migrate()
