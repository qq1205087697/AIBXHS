"""
仓储占比预警查询模块

根据输入的店铺名称，查找近30天仓储占比超过阈值的记录。
返回字典：{日期: 仓储占比}，无异常则返回空字典。

使用方法:
    from check_storage_ratio import check_storage_ratio
    result = check_storage_ratio('A加')
    print(result)
"""

import sys
from datetime import datetime, timedelta

if sys.platform == 'win32':
    try:
        import io
        if hasattr(sys.stdout, 'buffer'):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    except Exception:
        pass

try:
    from sqlalchemy import create_engine, text
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

# ==================== 阈值配置 ====================
STORAGE_RATIO_THRESHOLD = 0.02  # 仓储占比预警阈值


def check_storage_ratio(store_name, days=30, threshold=None):
    """
    查找指定店铺近N天仓储占比超过阈值的记录。

    Args:
        store_name: 店铺名称
        days: 查找天数，默认30天
        threshold: 仓储占比阈值，默认使用全局配置 STORAGE_RATIO_THRESHOLD

    Returns:
        dict: {日期: 仓储占比} 超过阈值的记录，无异常时返回空字典
    """
    if threshold is None:
        threshold = STORAGE_RATIO_THRESHOLD

    # 计算日期范围
    today = datetime.now().date()
    start_date = today - timedelta(days=days)

    result = {}

    try:
        engine = create_engine(
            DATABASE_URL,
            poolclass=QueuePool,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_timeout=30,
            pool_recycle=1800,
            echo=False
        )

        with engine.connect() as conn:
            sql = text("""
                SELECT date, storage_ratio
                FROM data_warnings
                WHERE store = :store
                  AND date >= :start_date
                  AND date <= :end_date
                  AND storage_ratio IS NOT NULL
                  AND storage_ratio > :threshold
                ORDER BY date
            """)

            rows = conn.execute(sql, {
                "store": store_name,
                "start_date": start_date,
                "end_date": today,
                "threshold": threshold
            }).fetchall()

            if not rows:
                print(f"店铺 [{store_name}] 在近{days}天内无仓储占比超过 {threshold} 的记录")
                return {}

            for row in rows:
                date_str = row[0].strftime("%Y-%m-%d") if hasattr(row[0], 'strftime') else str(row[0])
                storage_ratio = float(row[1])
                result[date_str] = storage_ratio

            print(f"店铺 [{store_name}] 在近{days}天内仓储占比超过 {threshold} 的记录共 {len(result)} 条")
            return result

    except Exception as e:
        print(f"查询失败: {e}")
        return {}


if __name__ == "__main__":
    # 示例：查询指定店铺
    if len(sys.argv) > 1:
        store = sys.argv[1]
    else:
        store = input("请输入店铺名称: ").strip()

    if not store:
        print("店铺名称不能为空")
        sys.exit(1)

    print(f"\n正在查询店铺 [{store}] 近30天仓储占比（阈值: {STORAGE_RATIO_THRESHOLD}）...\n")

    data = check_storage_ratio(store)

    if data:
        print("\n=== 仓储占比预警记录 ===")
        for date_str, ratio in data.items():
            print(f"  {date_str}: {ratio:.4f} ({ratio*100:.2f}%)")
    else:
        print("无超过阈值的记录")

    print(f"\n结果字典: {data}")