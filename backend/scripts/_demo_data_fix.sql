-- 补充 demo 租户 (tenant_id=6) 的库存演示数据
-- 解决问题: AI助手返回0条记录 + 库存机器人在途详情为空

-- ============ 1. 更新 inventory_snapshots, 给商品设置真实的 daily_sales / fba_stock / stockout_date ============
UPDATE inventory_snapshots SET daily_sales=8.0,  sales_30d=240.0, daily_avg_30d=8.0,  fba_stock=3,  total_stock=3,  stockout_date='2026-08-12' WHERE id=50851 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=15.5, sales_30d=465.0, daily_avg_30d=15.5, fba_stock=5,  fba_inbound=10, total_stock=15, stockout_date='2026-08-05' WHERE id=50852 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=2.0,  sales_30d=60.0,  daily_avg_30d=2.0,  fba_stock=1,  total_stock=1,  stockout_date='2026-08-20' WHERE id=50853 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=12.0, sales_30d=360.0, daily_avg_30d=12.0, fba_stock=2,  total_stock=7,  stockout_date='2026-08-10' WHERE id=50854 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=20.0, sales_30d=600.0, daily_avg_30d=20.0, fba_stock=26, total_stock=36, stockout_date='2026-08-15' WHERE id=50855 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=6.0,  sales_30d=180.0, daily_avg_30d=6.0,  fba_stock=15, fba_inbound=20, total_stock=45, stockout_date='2026-09-10' WHERE id=50856 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=18.0, sales_30d=540.0, daily_avg_30d=18.0, fba_stock=8,  total_stock=8,  stockout_date='2026-08-08' WHERE id=50857 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=0.5,  sales_30d=15.0,  daily_avg_30d=0.5,  fba_stock=50, fba_inbound=30, total_stock=100, stockout_date=NULL       WHERE id=50858 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=3.0,  sales_30d=90.0,  daily_avg_30d=3.0,  fba_stock=30, total_stock=40, stockout_date='2026-09-25' WHERE id=50859 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=25.0, sales_30d=750.0, daily_avg_30d=25.0, fba_stock=2,  total_stock=2,  stockout_date='2026-08-03' WHERE id=50860 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=4.0,  sales_30d=120.0, daily_avg_30d=4.0,  fba_stock=20, fba_inbound=15, total_stock=40, stockout_date='2026-09-20' WHERE id=50861 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=10.0, sales_30d=300.0, daily_avg_30d=10.0, fba_stock=80, fba_inbound=50, total_stock=160, stockout_date=NULL     WHERE id=50862 AND tenant_id=6;
UPDATE inventory_snapshots SET daily_sales=0.05, sales_30d=1.5,   daily_avg_30d=0.05, fba_stock=4,  total_stock=6,  stockout_date=NULL       WHERE id=50863 AND tenant_id=6;

-- ============ 2. 更新 replenishment_decisions, 按业务规则重设风险等级 / 建议补货量 / 断货时间 ============
-- 规则: daily_sales<=0.1 => risk_level='绿', suggest_qty=0
--       days_of_supply<=15 => risk_level='红'
--       15<days_of_supply<=30 => risk_level='黄'
--       days_of_supply>30 => risk_level='绿'
--       suggest_qty 取 50 的倍数 (向上取整, 0 不变)
UPDATE replenishment_decisions SET days_of_supply=0.4,  suggest_qty=400, risk_level='红', stockout_date_calc='2026-08-12', reason='FBA库存仅3件, 日均销量8件, 预计0.4天后断货, 急需补货'   WHERE id=100510 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=0.3,  suggest_qty=800, risk_level='红', stockout_date_calc='2026-08-05', reason='FBA库存仅5件, 日均销量15.5件, 预计0.3天后断货, 急需补货'  WHERE id=100511 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=0.5,  suggest_qty=150, risk_level='红', stockout_date_calc='2026-08-20', reason='FBA库存仅1件, 日均销量2件, 预计0.5天后断货, 急需补货'   WHERE id=100512 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=0.2,  suggest_qty=600, risk_level='红', stockout_date_calc='2026-08-10', reason='FBA库存仅2件, 日均销量12件, 预计0.2天后断货, 急需补货'   WHERE id=100513 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=1.3,  suggest_qty=1000, risk_level='红', stockout_date_calc='2026-08-15', reason='FBA库存26件, 日均销量20件, 预计1.3天后断货, 急需补货'  WHERE id=100514 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=2.5,  suggest_qty=300, risk_level='红', stockout_date_calc='2026-09-10', reason='FBA库存15件+在途20件, 日均销量6件, 预计2.5天后断货' WHERE id=100515 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=0.4,  suggest_qty=900, risk_level='红', stockout_date_calc='2026-08-08', reason='FBA库存仅8件, 日均销量18件, 预计0.4天后断货, 急需补货' WHERE id=100516 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=100,  suggest_qty=0,   risk_level='绿', stockout_date_calc='-',           reason='日均销量0.5件, FBA库存50件+在途30件, 库存充足'         WHERE id=100517 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=10.0, suggest_qty=150, risk_level='黄', stockout_date_calc='2026-09-25', reason='FBA库存30件, 日均销量3件, 预计10天后断货, 建议补货'    WHERE id=100518 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=0.1,  suggest_qty=1300, risk_level='红', stockout_date_calc='2026-08-03', reason='FBA库存仅2件, 日均销量25件, 预计0.1天后断货, 急需补货' WHERE id=100519 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=5.0,  suggest_qty=200, risk_level='黄', stockout_date_calc='2026-09-20', reason='FBA库存20件+在途15件, 日均销量4件, 预计5天后断货'      WHERE id=100520 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=8.0,  suggest_qty=500, risk_level='黄', stockout_date_calc='2026-11-15', reason='FBA库存80件+在途50件, 日均销量10件, 库存可支撑8天'    WHERE id=100521 AND tenant_id=6;
UPDATE replenishment_decisions SET days_of_supply=365,  suggest_qty=0,   risk_level='绿', stockout_date_calc='-',           reason='日均销量极低(<=0.1), 当前库存充足, 无需补货'            WHERE id=100522 AND tenant_id=6;

-- ============ 3. 插入 inbound_shipment_details, 让"在途详情"有数据展示 ============
INSERT INTO inbound_shipment_details
    (tenant_id, snapshot_id, asin, account, country, shipment_id, quantity, logistics_method, transport_method, ship_date, estimated_available_date, estimated_arrival_date, raw_text, created_at, updated_at)
VALUES
    (6, 50852, 'D6B0FCXPJZS2', 'TechGuard-UK', 'UK', 'FBA15P0L2KUK', 10, '海运', '海运', '2026-07-10', '2026-08-20', '2026-08-15', 'FBA15P0L2KUK | 10 | 海运 | 2026-07-10 | 预计到港: 2026-08-15 | 预计可售: 2026-08-20', NOW(), NOW()),
    (6, 50856, 'D6B0FCXPJZS6', 'TechGuard-UK', 'UK', 'FBA15P0L3KUK', 20, '空运', '空运', '2026-07-20', '2026-08-15', '2026-08-10', 'FBA15P0L3KUK | 20 | 空运 | 2026-07-20 | 预计到港: 2026-08-10 | 预计可售: 2026-08-15', NOW(), NOW()),
    (6, 50858, 'D6B0FCXPJZS8', 'TechGuard-US', 'US', 'FBA15P0L4KUS', 30, '海运', '海运', '2026-07-05', '2026-08-25', '2026-08-20', 'FBA15P0L4KUS | 30 | 海运 | 2026-07-05 | 预计到港: 2026-08-20 | 预计可售: 2026-08-25', NOW(), NOW()),
    (6, 50861, 'D6B0FCXPJZ11', 'TechGuard-UK', 'UK', 'FBA15P0L5KUK', 15, '海运', '海运', '2026-07-15', '2026-08-30', '2026-08-25', 'FBA15P0L5KUK | 15 | 海运 | 2026-07-15 | 预计到港: 2026-08-25 | 预计可售: 2026-08-30', NOW(), NOW()),
    (6, 50862, 'D6B0FCXPJZ12', 'TechGuard-US', 'US', 'FBA15P0L6KUS', 50, '空运', '空运', '2026-07-22', '2026-08-18', '2026-08-12', 'FBA15P0L6KUS | 50 | 空运 | 2026-07-22 | 预计到港: 2026-08-12 | 预计可售: 2026-08-18', NOW(), NOW());
