-- 用户角色迁移脚本
-- 1. 为 users 表添加 role_id 字段（保留原 role 字段）
ALTER TABLE users ADD COLUMN role_id INT NULL COMMENT '角色ID（新版）';

-- 2. （可选）同步现有数据（从 role 字段同步到 role_id）
UPDATE users u 
INNER JOIN roles r ON u.role = r.code AND u.tenant_id = r.tenant_id
SET u.role_id = r.id
WHERE u.role IS NOT NULL AND u.role_id IS NULL;

-- 3. （可选）添加外键约束
-- ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id);

-- 说明：
-- - 保留原 role 字段用于兼容旧版
-- - role_id 是新字段，关联 roles.id
-- - 两者同时使用，优先使用 role_id
