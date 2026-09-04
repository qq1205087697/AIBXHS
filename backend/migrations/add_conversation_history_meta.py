
import pymysql
from config import get_settings


def migrate():
    settings = get_settings()
    conn = pymysql.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME
    )

    try:
        with conn.cursor() as cursor:
            # 检查是否已存在 meta 列
            cursor.execute("SHOW COLUMNS FROM conversation_history LIKE 'meta'")
            if cursor.fetchone():
                print("[OK] meta 列已存在，跳过")
                return

            # 如果存在旧的 metadata 列，重命名并保留数据
            cursor.execute("SHOW COLUMNS FROM conversation_history LIKE 'metadata'")
            if cursor.fetchone():
                cursor.execute("ALTER TABLE conversation_history CHANGE COLUMN metadata meta JSON NULL COMMENT '额外元数据，如补货候选列表'")
                conn.commit()
                print("[OK] 已将 metadata 列重命名为 meta")
                return

            # 否则新增 meta 列
            cursor.execute(
                "ALTER TABLE conversation_history ADD COLUMN meta JSON NULL COMMENT '额外元数据，如补货候选列表'"
            )
            conn.commit()
            print("[OK] 已添加 meta 列到 conversation_history 表")
    except Exception as e:
        print(f"[ERR] 迁移过程出错：{e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
