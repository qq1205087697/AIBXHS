
import os
from dotenv import load_dotenv
import pymysql

load_dotenv()

conn = pymysql.connect(
    host=os.getenv('DB_HOST', 'localhost'),
    port=int(os.getenv('DB_PORT', 3306)),
    user=os.getenv('DB_USER', 'root'),
    password=os.getenv('DB_PASSWORD', ''),
    database=os.getenv('DB_NAME', 'bxhs_ai_assistance'),
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)

try:
    cursor = conn.cursor()
    
    # 检查 reviews 表结构
    print("=== reviews 表结构 ===")
    cursor.execute("DESCRIBE reviews")
    columns = cursor.fetchall()
    for idx, col in enumerate(columns):
        print(f"{idx}: {col['Field']} - {col['Type']}")
    
    # 检查一些示例数据
    print("\n=== 示例数据 ===")
    cursor.execute("SELECT id, asin, return_rate FROM reviews LIMIT 5")
    rows = cursor.fetchall()
    for row in rows:
        print(f"ID: {row['id']}, ASIN: {row['asin']}, return_rate: {row['return_rate']}")
        
finally:
    conn.close()

