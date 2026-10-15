"""迁移「审批视频绑定」权限（ai_video:approve）到所有已初始化权限的租户：
1. permissions 表插入该权限（缺失时）
2. 授予各租户 admin 角色（role_permissions 带 tenant_id）

在 backend 目录执行：python migrations/add_video_binding_approve_permission.py
"""
import pymysql

from config import get_settings

PERM = {"name": "审批视频绑定", "code": "ai_video:approve", "type": "function",
        "module": "媒体创作中心", "sort_order": 72}


def migrate():
    settings = get_settings()
    conn = pymysql.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        charset="utf8mb4",
    )

    added_perms = 0
    added_grants = 0

    try:
        with conn.cursor() as cursor:
            # 1. 找出所有已初始化权限的租户
            cursor.execute("SELECT DISTINCT tenant_id FROM permissions WHERE deleted_at IS NULL")
            tenant_ids = [row[0] for row in cursor.fetchall()]
            print(f"[INFO] 已初始化权限的租户: {tenant_ids}")

            for tid in tenant_ids:
                # 2. 权限缺失时插入
                cursor.execute(
                    "SELECT id FROM permissions WHERE tenant_id = %s AND code = %s AND deleted_at IS NULL",
                    (tid, PERM["code"]),
                )
                row = cursor.fetchone()
                if row:
                    perm_id = row[0]
                    print(f"[SKIP] 租户 {tid} 已存在权限 {PERM['code']}")
                else:
                    cursor.execute(
                        "INSERT INTO permissions (tenant_id, name, code, type, module, sort_order, created_at, updated_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())",
                        (tid, PERM["name"], PERM["code"], PERM["type"], PERM["module"], PERM["sort_order"]),
                    )
                    perm_id = cursor.lastrowid
                    added_perms += 1
                    print(f"[OK] 租户 {tid} 新增权限 {PERM['code']}")

                # 3. 授予 admin 角色
                cursor.execute(
                    "SELECT id FROM roles WHERE tenant_id = %s AND code = 'admin' AND deleted_at IS NULL",
                    (tid,),
                )
                role_row = cursor.fetchone()
                if not role_row:
                    print(f"[WARN] 租户 {tid} 无 admin 角色，跳过授权")
                    continue
                cursor.execute(
                    "SELECT id FROM role_permissions WHERE tenant_id = %s AND role_id = %s AND permission_id = %s",
                    (tid, role_row[0], perm_id),
                )
                if cursor.fetchone():
                    continue
                cursor.execute(
                    "INSERT INTO role_permissions (tenant_id, role_id, permission_id, created_at, updated_at) "
                    "VALUES (%s, %s, %s, NOW(), NOW())",
                    (tid, role_row[0], perm_id),
                )
                added_grants += 1
                print(f"[OK] 租户 {tid} 已授予 admin 角色")

        conn.commit()
        print(f"[DONE] 迁移完成：新增权限 {added_perms} 个，新增授权 {added_grants} 条")
    except Exception as e:
        conn.rollback()
        print(f"[ERR] 迁移过程出错：{e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
