-- =====================================================
-- 宝鑫华盛AI助手 - 数据库表结构设计
-- MySQL 5.7+ / MySQL 8.0+
-- =====================================================

-- =====================================================
-- 一、通用基础表
-- =====================================================

-- 租户表 - 多租户架构
CREATE TABLE IF NOT EXISTS `tenants` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '租户ID',
    `name` VARCHAR(100) NOT NULL COMMENT '租户名称',
    `code` VARCHAR(50) NOT NULL COMMENT '租户编码',
    `contact_name` VARCHAR(50) DEFAULT NULL COMMENT '联系人',
    `contact_phone` VARCHAR(20) DEFAULT NULL COMMENT '联系电话',
    `contact_email` VARCHAR(100) DEFAULT NULL COMMENT '联系邮箱',
    `plan_type` ENUM('free', 'basic', 'pro', 'enterprise') DEFAULT 'basic' COMMENT '套餐类型',
    `plan_expire_at` DATETIME DEFAULT NULL COMMENT '套餐到期时间',
    `status` ENUM('active', 'suspended', 'expired') DEFAULT 'active' COMMENT '状态',
    `max_users` INT DEFAULT 10 COMMENT '最大用户数',
    `max_stores` INT DEFAULT 5 COMMENT '最大店铺数',
    `config` JSON DEFAULT NULL COMMENT '扩展配置',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tenant_code` (`code`),
    KEY `idx_status` (`status`),
    KEY `idx_plan_expire` (`plan_expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户表';

-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `username` VARCHAR(50) NOT NULL COMMENT '用户名',
    `email` VARCHAR(100) NOT NULL COMMENT '邮箱',
    `phone` VARCHAR(20) DEFAULT NULL COMMENT '手机号',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希',
    `nickname` VARCHAR(50) DEFAULT NULL COMMENT '昵称',
    `avatar` VARCHAR(255) DEFAULT NULL COMMENT '头像',
    `role` ENUM('admin', 'operator', 'viewer') DEFAULT 'operator' COMMENT '角色',
    `department` VARCHAR(50) DEFAULT NULL COMMENT '部门',
    `position` VARCHAR(50) DEFAULT NULL COMMENT '职位',
    `status` ENUM('active', 'inactive', 'suspended') DEFAULT 'active' COMMENT '状态',
    `last_login_at` DATETIME DEFAULT NULL COMMENT '最后登录时间',
    `last_login_ip` VARCHAR(45) DEFAULT NULL COMMENT '最后登录IP',
    `config` JSON DEFAULT NULL COMMENT '个性化配置',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    UNIQUE KEY `uk_email` (`email`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_status` (`status`),
    CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 店铺表
CREATE TABLE IF NOT EXISTS `stores` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '店铺ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `name` VARCHAR(100) NOT NULL COMMENT '店铺名称',
    `platform` ENUM('amazon', 'shopee', 'lazada', 'tiktok', 'other') NOT NULL COMMENT '平台',
    `platform_store_id` VARCHAR(100) DEFAULT NULL COMMENT '平台店铺ID',
    `site` VARCHAR(20) DEFAULT NULL COMMENT '站点(US/UK/CA等)',
    `marketplace_id` VARCHAR(50) DEFAULT NULL COMMENT '市场ID',
    `api_key` TEXT DEFAULT NULL COMMENT 'API密钥(加密)',
    `api_secret` TEXT DEFAULT NULL COMMENT 'API密钥(加密)',
    `api_token` TEXT DEFAULT NULL COMMENT 'API令牌(加密)',
    `status` ENUM('active', 'inactive', 'error') DEFAULT 'active' COMMENT '状态',
    `sync_status` ENUM('idle', 'syncing', 'failed') DEFAULT 'idle' COMMENT '同步状态',
    `last_synced_at` DATETIME DEFAULT NULL COMMENT '最后同步时间',
    `config` JSON DEFAULT NULL COMMENT '店铺配置',
    `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_platform` (`platform`),
    KEY `idx_status` (`status`),
    CONSTRAINT `fk_stores_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_stores_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='店铺表';

-- =====================================================
-- 二、库存机器人相关表
-- =====================================================

-- 商品表
CREATE TABLE IF NOT EXISTS `products` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '商品ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店铺ID',
    `asin` VARCHAR(50) NOT NULL COMMENT 'ASIN/商品编码',
    `sku` VARCHAR(100) DEFAULT NULL COMMENT 'SKU',
    `name` VARCHAR(255) NOT NULL COMMENT '商品名称',
    `name_en` VARCHAR(255) DEFAULT NULL COMMENT '英文名称',
    `image_url` VARCHAR(500) DEFAULT NULL COMMENT '商品图片',
    `category` VARCHAR(100) DEFAULT NULL COMMENT '商品分类',
    `brand` VARCHAR(100) DEFAULT NULL COMMENT '品牌',
    `price` DECIMAL(12,2) DEFAULT NULL COMMENT '售价',
    `cost_price` DECIMAL(12,2) DEFAULT NULL COMMENT '成本价',
    `status` ENUM('active', 'inactive', 'archived') DEFAULT 'active' COMMENT '状态',
    `is_robot_monitored` BOOLEAN DEFAULT TRUE COMMENT '是否机器人监控',
    `config` JSON DEFAULT NULL COMMENT '商品配置(安全库存等)',
    `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME DEFAULT NULL COMMENT '删除时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tenant_asin` (`tenant_id`, `asin`),
    KEY `idx_store_id` (`store_id`),
    KEY `idx_status` (`status`),
    KEY `idx_category` (`category`),
    CONSTRAINT `fk_products_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_products_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_products_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品表';

-- 库存记录表
CREATE TABLE IF NOT EXISTS `inventory_records` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店铺ID',
    `warehouse_code` VARCHAR(50) DEFAULT NULL COMMENT '仓库编码',
    `quantity` INT NOT NULL COMMENT '当前库存',
    `quantity_in_transit` INT DEFAULT 0 COMMENT '在途库存',
    `quantity_available` INT NOT NULL COMMENT '可用库存',
    `quantity_reserved` INT DEFAULT 0 COMMENT '预留库存',
    `safe_stock` INT DEFAULT 0 COMMENT '安全库存',
    `daily_sales` INT DEFAULT NULL COMMENT '日均销量',
    `days_remaining` INT GENERATED ALWAYS AS (CASE WHEN daily_sales > 0 THEN quantity_available / daily_sales ELSE NULL END) STORED COMMENT '可售天数',
    `record_date` DATE NOT NULL COMMENT '记录日期',
    `source` ENUM('manual', 'api_sync', 'import') DEFAULT 'api_sync' COMMENT '数据来源',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_product_date` (`product_id`, `record_date`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_store_id` (`store_id`),
    KEY `idx_record_date` (`record_date`),
    CONSTRAINT `fk_inventory_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_inventory_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_inventory_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存记录表';

-- 库存预警表
CREATE TABLE IF NOT EXISTS `inventory_alerts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '预警ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店铺ID',
    `alert_type` ENUM('low_stock', 'out_of_stock', 'overstock', 'price_change') NOT NULL COMMENT '预警类型',
    `severity` ENUM('info', 'warning', 'danger', 'critical') DEFAULT 'warning' COMMENT '严重程度',
    `title` VARCHAR(200) NOT NULL COMMENT '预警标题',
    `description` TEXT DEFAULT NULL COMMENT '预警描述',
    `current_stock` INT DEFAULT NULL COMMENT '当前库存',
    `safe_stock` INT DEFAULT NULL COMMENT '安全库存',
    `suggestions` JSON DEFAULT NULL COMMENT 'AI建议',
    `status` ENUM('new', 'acknowledged', 'processing', 'resolved', 'dismissed') DEFAULT 'new' COMMENT '处理状态',
    `priority` TINYINT DEFAULT 5 COMMENT '优先级(1-10)',
    `resolved_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '处理人',
    `resolved_at` DATETIME DEFAULT NULL COMMENT '处理时间',
    `resolved_note` TEXT DEFAULT NULL COMMENT '处理备注',
    `feishu_record_id` VARCHAR(100) DEFAULT NULL COMMENT '飞书记录ID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_product_id` (`product_id`),
    KEY `idx_store_id` (`store_id`),
    KEY `idx_alert_type` (`alert_type`),
    KEY `idx_status` (`status`),
    KEY `idx_created_at` (`created_at`),
    CONSTRAINT `fk_alert_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_alert_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_alert_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_alert_resolver` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存预警表';

-- 库存操作记录表
CREATE TABLE IF NOT EXISTS `inventory_actions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '操作ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店铺ID',
    `alert_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联预警ID',
    `action_type` ENUM('price_adjust', 'ad_budget', 'promotion', 'restock', 'other') NOT NULL COMMENT '操作类型',
    `action_title` VARCHAR(200) NOT NULL COMMENT '操作标题',
    `action_details` JSON DEFAULT NULL COMMENT '操作详情',
    `status` ENUM('pending', 'executing', 'success', 'failed', 'cancelled') DEFAULT 'pending' COMMENT '执行状态',
    `triggered_by` ENUM('system_auto', 'manual', 'schedule') DEFAULT 'manual' COMMENT '触发方式',
    `result` TEXT DEFAULT NULL COMMENT '执行结果',
    `error_message` TEXT DEFAULT NULL COMMENT '错误信息',
    `executed_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '执行人',
    `executed_at` DATETIME DEFAULT NULL COMMENT '执行时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_product_id` (`product_id`),
    KEY `idx_store_id` (`store_id`),
    KEY `idx_alert_id` (`alert_id`),
    KEY `idx_status` (`status`),
    KEY `idx_created_at` (`created_at`),
    CONSTRAINT `fk_action_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_action_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_action_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_action_alert` FOREIGN KEY (`alert_id`) REFERENCES `inventory_alerts` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_action_executor` FOREIGN KEY (`executed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存操作记录表';

-- =====================================================
-- 三、差评机器人相关表
-- =====================================================

-- 评论表
CREATE TABLE IF NOT EXISTS `reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '评论ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店铺ID',
    `product_id` BIGINT UNSIGNED NOT NULL COMMENT '商品ID',
    `review_id` VARCHAR(100) DEFAULT NULL COMMENT '平台评论ID',
    `reviewer_name` VARCHAR(200) DEFAULT NULL COMMENT '评论者名称',
    `rating` TINYINT UNSIGNED NOT NULL COMMENT '评分(1-5)',
    `title` VARCHAR(500) DEFAULT NULL COMMENT '评论标题',
    `content` TEXT NOT NULL COMMENT '评论内容',
    `content_translated` TEXT DEFAULT NULL COMMENT '翻译后内容',
    `is_negative` BOOLEAN GENERATED ALWAYS AS (rating <= 3) STORED COMMENT '是否差评',
    `helpful_votes` INT DEFAULT 0 COMMENT '有用数',
    `review_date` DATETIME NOT NULL COMMENT '评论时间',
    `source_url` VARCHAR(500) DEFAULT NULL COMMENT '评论链接',
    `status` ENUM('new', 'read', 'processing', 'resolved', 'dismissed') DEFAULT 'new' COMMENT '处理状态',
    `priority` TINYINT DEFAULT 5 COMMENT '优先级(1-10)',
    `tags` JSON DEFAULT NULL COMMENT '标签',
    `feishu_record_id` VARCHAR(100) DEFAULT NULL COMMENT '飞书记录ID',
    `sync_at` DATETIME DEFAULT NULL COMMENT '同步时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_platform_review_id` (`store_id`, `review_id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_store_id` (`store_id`),
    KEY `idx_product_id` (`product_id`),
    KEY `idx_rating` (`rating`),
    KEY `idx_is_negative` (`is_negative`),
    KEY `idx_status` (`status`),
    KEY `idx_review_date` (`review_date`),
    CONSTRAINT `fk_review_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_review_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_review_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评论表';

-- AI分析结果表
CREATE TABLE IF NOT EXISTS `review_analyses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '分析ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `review_id` BIGINT UNSIGNED NOT NULL COMMENT '评论ID',
    `model` VARCHAR(100) DEFAULT NULL COMMENT 'AI模型',
    `sentiment` ENUM('positive', 'neutral', 'negative') NOT NULL COMMENT '情感分析',
    `sentiment_score` DECIMAL(5,2) DEFAULT NULL COMMENT '情感分数',
    `key_points` JSON DEFAULT NULL COMMENT '核心观点',
    `topics` JSON DEFAULT NULL COMMENT '主题分类',
    `suggestions` JSON DEFAULT NULL COMMENT '处理建议',
    `summary` TEXT DEFAULT NULL COMMENT '分析摘要',
    `raw_response` TEXT DEFAULT NULL COMMENT 'AI原始响应',
    `analysis_time` INT DEFAULT NULL COMMENT '分析耗时(ms)',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_review_analysis` (`review_id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_sentiment` (`sentiment`),
    CONSTRAINT `fk_analysis_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_analysis_review` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评论AI分析表';

-- 评论处理记录表
CREATE TABLE IF NOT EXISTS `review_handlings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '处理记录ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `review_id` BIGINT UNSIGNED NOT NULL COMMENT '评论ID',
    `handler_id` BIGINT UNSIGNED NOT NULL COMMENT '处理人',
    `action` ENUM('read', 'tag', 'comment', 'reply', 'dismiss', 'other') NOT NULL COMMENT '操作类型',
    `note` TEXT DEFAULT NULL COMMENT '处理备注',
    `reply_content` TEXT DEFAULT NULL COMMENT '回复内容',
    `reply_sent` BOOLEAN DEFAULT FALSE COMMENT '回复是否已发送',
    `reply_sent_at` DATETIME DEFAULT NULL COMMENT '回复发送时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_review_id` (`review_id`),
    KEY `idx_handler_id` (`handler_id`),
    CONSTRAINT `fk_handling_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_handling_review` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_handling_handler` FOREIGN KEY (`handler_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评论处理记录表';

-- =====================================================
-- 四、通用系统表
-- =====================================================

-- 定时任务表
CREATE TABLE IF NOT EXISTS `scheduled_tasks` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务ID',
    `tenant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '租户ID(全局任务为NULL)',
    `task_name` VARCHAR(100) NOT NULL COMMENT '任务名称',
    `task_type` ENUM('inventory_check', 'review_sync', 'data_sync', 'notification', 'other') NOT NULL COMMENT '任务类型',
    `cron_expression` VARCHAR(100) NOT NULL COMMENT 'Cron表达式',
    `config` JSON DEFAULT NULL COMMENT '任务配置',
    `status` ENUM('active', 'paused', 'disabled') DEFAULT 'active' COMMENT '状态',
    `last_run_at` DATETIME DEFAULT NULL COMMENT '最后执行时间',
    `last_run_status` ENUM('success', 'failed') DEFAULT NULL COMMENT '最后执行状态',
    `last_error` TEXT DEFAULT NULL COMMENT '最后错误信息',
    `created_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_status` (`status`),
    KEY `idx_task_type` (`task_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时任务表';

-- 任务执行日志表
CREATE TABLE IF NOT EXISTS `task_execution_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志ID',
    `task_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '任务ID',
    `tenant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '租户ID',
    `task_name` VARCHAR(100) DEFAULT NULL COMMENT '任务名称',
    `task_type` VARCHAR(50) DEFAULT NULL COMMENT '任务类型',
    `status` ENUM('running', 'success', 'failed') NOT NULL COMMENT '执行状态',
    `start_time` DATETIME NOT NULL COMMENT '开始时间',
    `end_time` DATETIME DEFAULT NULL COMMENT '结束时间',
    `duration` INT DEFAULT NULL COMMENT '耗时(ms)',
    `result` JSON DEFAULT NULL COMMENT '执行结果',
    `error_message` TEXT DEFAULT NULL COMMENT '错误信息',
    `error_stack` TEXT DEFAULT NULL COMMENT '错误堆栈',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `idx_task_id` (`task_id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_status` (`status`),
    KEY `idx_start_time` (`start_time`),
    CONSTRAINT `fk_log_task` FOREIGN KEY (`task_id`) REFERENCES `scheduled_tasks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务执行日志表';

-- 操作审计日志表
CREATE TABLE IF NOT EXISTS `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志ID',
    `tenant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '租户ID',
    `user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '用户ID',
    `action` VARCHAR(100) NOT NULL COMMENT '操作行为',
    `resource_type` VARCHAR(50) DEFAULT NULL COMMENT '资源类型',
    `resource_id` VARCHAR(100) DEFAULT NULL COMMENT '资源ID',
    `old_value` JSON DEFAULT NULL COMMENT '旧值',
    `new_value` JSON DEFAULT NULL COMMENT '新值',
    `ip_address` VARCHAR(45) DEFAULT NULL COMMENT 'IP地址',
    `user_agent` TEXT DEFAULT NULL COMMENT 'User Agent',
    `request_id` VARCHAR(100) DEFAULT NULL COMMENT '请求ID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_action` (`action`),
    KEY `idx_resource` (`resource_type`, `resource_id`),
    KEY `idx_created_at` (`created_at`),
    CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作审计日志表';

-- 系统配置表
CREATE TABLE IF NOT EXISTS `system_configs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '配置ID',
    `tenant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '租户ID(全局配置为NULL)',
    `config_key` VARCHAR(100) NOT NULL COMMENT '配置键',
    `config_value` TEXT DEFAULT NULL COMMENT '配置值',
    `config_type` ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string' COMMENT '配置类型',
    `description` VARCHAR(255) DEFAULT NULL COMMENT '配置描述',
    `is_encrypted` BOOLEAN DEFAULT FALSE COMMENT '是否加密存储',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tenant_key` (`tenant_id`, `config_key`),
    KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- 通知记录表
CREATE TABLE IF NOT EXISTS `notifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知ID',
    `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
    `user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '用户ID(为空则全员)',
    `type` ENUM('alert', 'info', 'warning', 'success') NOT NULL COMMENT '通知类型',
    `title` VARCHAR(200) NOT NULL COMMENT '通知标题',
    `content` TEXT DEFAULT NULL COMMENT '通知内容',
    `data` JSON DEFAULT NULL COMMENT '附加数据',
    `link` VARCHAR(500) DEFAULT NULL COMMENT '跳转链接',
    `read_at` DATETIME DEFAULT NULL COMMENT '阅读时间',
    `is_read` BOOLEAN GENERATED ALWAYS AS (read_at IS NOT NULL) STORED COMMENT '是否已读',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_is_read` (`is_read`),
    KEY `idx_created_at` (`created_at`),
    CONSTRAINT `fk_notification_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知记录表';

-- =====================================================
-- 初始化数据
-- =====================================================

-- 插入系统默认配置
INSERT INTO `system_configs` (`tenant_id`, `config_key`, `config_value`, `config_type`, `description`) VALUES
(NULL, 'site_title', '宝鑫华盛AI助手', 'string', '网站标题'),
(NULL, 'ai_model', 'qwen-turbo', 'string', '默认AI模型'),
(NULL, 'inventory_check_cron', '0 * * * *', 'string', '库存检查Cron'),
(NULL, 'review_sync_cron', '0,30 * * * *', 'string', '评论同步Cron'),
(NULL, 'safe_stock_default', '50', 'number', '默认安全库存'),
(NULL, 'negative_rating_threshold', '3', 'number', '差评评分阈值')
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;
