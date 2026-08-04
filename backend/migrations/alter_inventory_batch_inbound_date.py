"""
Alter inventory_batches.inbound_date column from DATE to DATETIME
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database.database import engine
from sqlalchemy import text

def migrate():
    try:
        with engine.connect() as conn:
            print("Altering inventory_batches.inbound_date from DATE to DATETIME...")
            conn.execute(text("""
                ALTER TABLE inventory_batches 
                MODIFY COLUMN inbound_date DATETIME DEFAULT NULL COMMENT '入库日期'
            """))
            conn.commit()
            print("Successfully altered inventory_batches.inbound_date to DATETIME")
            
    except Exception as e:
        print(f"Migration failed: {str(e)}")
        raise

if __name__ == "__main__":
    migrate()
