#!/usr/bin/env python3
"""
简单测试通知功能
"""
import sys
import os
import pymysql

env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'backend', '.env')
config = {}
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                config[key.strip()] = value.strip()

print("Database check...")
try:
    conn = pymysql.connect(
        host=config.get('DB_HOST', 'localhost'),
        port=int(config.get('DB_PORT', '3306')),
        user=config.get('DB_USER', 'root'),
        password=config.get('DB_PASSWORD', ''),
        database=config.get('DB_NAME', 'baoxinhuasheng'),
        charset='utf8mb4'
    )
    
    cursor = conn.cursor()
    
    print("Tables created successfully!")
    
    # Get users
    cursor.execute("SELECT id, username FROM users LIMIT 3")
    users = cursor.fetchall()
    print(f"Users: {users}")
    
    # Create test notifications
    print("Creating test notifications...")
    for user in users:
        user_id = user[0]
        username = user[1]
        cursor.execute("""
            INSERT INTO notifications 
            (tenant_id, user_id, type, title, content, link, created_at, updated_at)
            VALUES 
            (1, %s, 'warning', 'Test Notification - Bad Review', 
            'This is a test notification! The notification system is working.', '/review', NOW(), NOW())
        """, (user_id,))
        print(f"Notification created for {username}")
    
    conn.commit()
    
    # Show notifications
    print("\nCreated notifications:")
    cursor.execute("""
        SELECT n.id, u.username, n.title, n.created_at
        FROM notifications n
        JOIN users u ON n.user_id = u.id
        ORDER BY n.created_at DESC
        LIMIT 5
    """)
    notifications = cursor.fetchall()
    for n in notifications:
        print(f"ID: {n[0]}, User: {n[1]}, Title: {n[2]}, Time: {n[3]}")
    
    print("\nALL DONE! Refresh the webpage to see notifications.")
    
except Exception as e:
    print(f"Error: {e}")
finally:
    if 'cursor' in locals():
        cursor.close()
    if 'conn' in locals():
        conn.close()
