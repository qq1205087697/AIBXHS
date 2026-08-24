# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, '.')
from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    # check emails table
    result = db.execute(text("SHOW TABLES LIKE '%email%'")).fetchall()
    print("Email tables:", result)
    
    # check purchase_orders
    result2 = db.execute(text('DESCRIBE purchase_orders')).fetchall()
    print('=== purchase_orders ===')
    for r in result2: print(f'  {r[0]}: {r[1]} nullable={r[2]}')
    
    # check inbound_orders
    result3 = db.execute(text('DESCRIBE inbound_orders')).fetchall()
    print('=== inbound_orders ===')
    for r in result3: print(f'  {r[0]}: {r[1]} nullable={r[2]}')
    
    # check replenishment_orders
    result4 = db.execute(text('DESCRIBE replenishment_orders')).fetchall()
    print('=== replenishment_orders ===')
    for r in result4: print(f'  {r[0]}: {r[1]} nullable={r[2]}')
    
    # check shipment_orders
    result5 = db.execute(text('DESCRIBE shipment_orders')).fetchall()
    print('=== shipment_orders ===')
    for r in result5: print(f'  {r[0]}: {r[1]} nullable={r[2]}')
    
finally:
    db.close()
