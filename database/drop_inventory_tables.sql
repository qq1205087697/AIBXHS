-- =====================================================
-- 删除库存相关表
-- =====================================================

-- 注意：删除顺序很重要，要先删除有外键约束的表

-- 删除补货决策表
DROP TABLE IF EXISTS replenishment_decisions;

-- 删除在途货件详情表
DROP TABLE IF EXISTS inbound_shipment_details;

-- 删除库存快照表
DROP TABLE IF EXISTS inventory_snapshots;

SELECT '库存相关表已删除' AS message;
