
#!/usr/bin/env python3
"""测试数据库连接"""
import sys
from sqlalchemy import text

# 添加项目路径
sys.path.insert(0, '.')

from database.database import SessionLocal, engine, get_settings

settings = get_settings()

print("=" * 60)
print("数据库连接测试")
print("=" * 60)
print(f"数据库配置:")
print(f"  主机: {settings.DB_HOST}:{settings.DB_PORT}")
print(f"  用户: {settings.DB_USER}")
print(f"  库名: {settings.DB_NAME}")
print("-" * 60)

try:
    # 测试1: 尝试连接
    print("1. 测试数据库引擎连接...")
    with engine.connect() as conn:
        print("   ✓ 连接成功!")
        
        # 测试2: 执行简单查询
        print("2. 执行简单查询...")
        result = conn.execute(text("SELECT VERSION()"))
        version = result.fetchone()[0]
        print(f"   ✓ MySQL 版本: {version}")
        
        # 测试3: 检查表是否存在
        print("3. 检查数据库表...")
        result = conn.execute(text("SHOW TABLES"))
        tables = [row[0] for row in result]
        print(f"   ✓ 找到 {len(tables)} 个表: {', '.join(tables[:5]) if len(tables) > 5 else ', '.join(tables)}")
        
        if len(tables) > 0:
            # 测试4: 检查用户表
            if 'users' in tables:
                print("4. 检查用户表...")
                result = conn.execute(text("SELECT COUNT(*) FROM users"))
                user_count = result.fetchone()[0]
                print(f"   ✓ 用户表中共有 {user_count} 个用户")
            
            # 测试5: 检查库存表
            if 'inventory_snapshots' in tables:
                print("5. 检查库存快照表...")
                result = conn.execute(text("SELECT COUNT(*) FROM inventory_snapshots"))
                snap_count = result.fetchone()[0]
                print(f"   ✓ 库存快照表中共有 {snap_count} 条记录")
            
            # 测试6: 检查补货决策表
            if 'replenishment_decisions' in tables:
                print("6. 检查补货决策表...")
                result = conn.execute(text("SELECT COUNT(*) FROM replenishment_decisions"))
                dec_count = result.fetchone()[0]
                print(f"   ✓ 补货决策表中共有 {dec_count} 条记录")

    print("-" * 60)
    print("✅ 数据库连接测试全部通过!")
    print("=" * 60)

except Exception as e:
    print(f"❌ 数据库连接失败: {e}")
    print("=" * 60)
    import traceback
    traceback.print_exc()
    sys.exit(1)
