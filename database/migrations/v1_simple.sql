-- =====================================================
-- 版本 1.0 简化数据库迁移脚本
-- 功能：增加部门表、用户部门关联、通知表、重要性等级字段
-- 日期：2026-05-07
-- =====================================================

-- 设置字符集
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================
-- 1. 创建部门表（如果不存在）
-- =====================================================
CREATE TABLE IF NOT EXISTS `departments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '部门ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `name` VARCHAR(100) NOT NULL COMMENT '部门名称',
    `description` VARCHAR(500) DEFAULT NULL COMMENT '部门描述',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表';

-- =====================================================
-- 2. 创建用户部门关联表（如果不存在）
-- =====================================================
CREATE TABLE IF NOT EXISTS `user_departments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '关联ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `department_id` BIGINT UNSIGNED NOT NULL COMMENT '部门ID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_department_id` (`department_id`),
    UNIQUE KEY `uk_user_dept` (`user_id`, `department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户部门关联表';

-- =====================================================
-- 3. 店铺表增加部门字段
-- =====================================================
-- 先尝试添加字段，如果失败（已存在）则跳过
-- 注意：有些MySQL版本不支持条件ALTER，我们在Python脚本中处理错误
ALTER TABLE `stores` ADD COLUMN IF NOT EXISTS `department_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属部门ID' AFTER `created_by`;

-- 添加索引（如果不存在）
ALTER TABLE `stores` ADD INDEX IF NOT EXISTS `idx_department_id` (`department_id`);

-- =====================================================
-- 4. 评论表增加重要性等级字段
-- =====================================================
ALTER TABLE `reviews` ADD COLUMN IF NOT EXISTS `importance_level` VARCHAR(20) DEFAULT 'medium' COMMENT '重要性等级' AFTER `status`;

-- 添加索引（如果不存在）
ALTER TABLE `reviews` ADD INDEX IF NOT EXISTS `idx_importance_level` (`importance_level`);

-- =====================================================
-- 5. 创建通知表（如果不存在）
-- =====================================================
CREATE TABLE IF NOT EXISTS `notifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    `type` VARCHAR(50) DEFAULT NULL COMMENT '通知类型',
    `title` VARCHAR(255) NOT NULL COMMENT '标题',
    `content` TEXT DEFAULT NULL COMMENT '内容',
    `link` VARCHAR(255) DEFAULT NULL COMMENT '跳转链接',
    `read_at` DATETIME DEFAULT NULL COMMENT '已读时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_read_at` (`read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息通知表';

-- =====================================================
-- 迁移完成
-- =====================================================
SET FOREIGN_KEY_CHECKS = 1;

SELECT 'Migration v1 completed successfully!' AS status;
