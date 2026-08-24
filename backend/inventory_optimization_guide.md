# 库存功能优化建议文档

## 一、项目概述

本项目（宝鑫华盛AI助手）是一个面向亚马逊卖家的库存管理与智能运营平台，支持多店铺、多仓库的库存监控与补货决策。

## 二、现有功能分析

### 2.1 数据模型现状

| 表名 | 用途 | 字段数 | 状态 |
|------|------|--------|------|
| `inventory_records` | 基础库存记录 | 15 | ⚠️ 存在但未充分使用 |
| `inventory_alerts` | 库存预警 | 20 | ⚠️ 存在但未充分使用 |
| `inventory_actions` | 操作记录 | 18 | ⚠️ 存在但未充分使用 |
| `inventory_snapshots` | 每日库存快照 | 45 | ✅ 核心表 |
| `replenishment_decisions` | 补货决策 | 18 | ✅ 核心表 |
| `inbound_shipment_details` | 在途货件 | 12 | ✅ 核心表 |
| `local_inventories` | 本地仓库存 | 10 | ✅ 已实现 |

### 2.2 API接口现状

```
库存相关API:
├── /inventory/alerts          [GET]  获取库存预警
├── /inventory/execute         [POST] 执行库存操作
├── /local-inventory/import    [POST] 导入本地仓库存
├── /local-inventory/summary   [GET]  本地仓汇总
├── /local-inventory/list      [GET]  本地仓列表
├── /local-inventory/clear     [DELETE] 清空本地仓
└── /restock/*                 [多方法] 补货管理完整API
```

### 2.3 核心业务流程

```
领星数据 → Excel导入 → 库存快照 → 补货计算 → 决策建议
                                    ↓
                            风险等级(红/黄/绿)
                                    ↓
                            断货TOP10 / 冗余TOP10
```

## 三、功能完善建议

### 3.1 库存预警自动化 ⚡ 高优先级

**问题**: `inventory_alerts` 表存在但未自动生成预警记录

**建议实现**:

1. **新增调度任务** `scheduler.py`
```python
@scheduler.scheduled_job("0 8 * * *")  # 每天早8点
def generate_inventory_alerts():
    """自动生成库存预警"""
    # 1. 查询低于安全库存的商品
    # 2. 查询可售天数≤7天的商品（断货风险）
    # 3. 查询12个月以上库龄≥100件的商品（冗余风险）
    # 4. 创建预警记录
```

2. **预警规则配置**
```python
ALERT_RULES = {
    "low_stock": {"threshold": "safe_stock", "severity": "warning"},
    "out_of_stock_risk": {"days_remaining": 7, "severity": "danger"},
    "overstock": {"age_12_plus": 100, "severity": "info"},
    "price_change": {"threshold_pct": 10, "severity": "warning"},
}
```

3. **预警通知集成**
```python
async def send_alert_notification(alert: InventoryAlert):
    """发送预警通知"""
    # 飞书webhook通知
    # 邮件通知（可选）
    # 应用内通知
```

### 3.2 库存变动管理 ⚡ 高优先级

**问题**: 缺少出入库、调拨、盘点功能

**建议新增表**:

```sql
-- 库存变动记录表
CREATE TABLE inventory_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    transaction_type ENUM('inbound', 'outbound', 'transfer', 'adjustment', 'count') NOT NULL,
    warehouse_code VARCHAR(50),  -- 仓库编码
    asin VARCHAR(100),
    sku VARCHAR(500),
    quantity INT NOT NULL,  -- 正数入库，负数出库
    reference_no VARCHAR(100),  -- 关联单号（采购单号、出库单号等）
    operator_id BIGINT,  -- 操作人
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant_asin (tenant_id, asin),
    INDEX idx_created_at (created_at)
);
```

**API接口建议**:
```
POST /inventory/transactions/inbound    # 入库操作
POST /inventory/transactions/outbound   # 出库操作
POST /inventory/transactions/transfer   # 调拨操作
POST /inventory/transactions/adjustment # 盘点调整
GET  /inventory/transactions            # 变动记录查询
```

### 3.3 补货决策增强 ⚡ 中优先级

**现状**:
- ✅ 风险等级计算（红/黄/绿）
- ✅ 补货数量建议
- ✅ 断货时间预测

**建议增强**:

1. **采购参数配置**
```sql
-- 采购配置表
CREATE TABLE purchase_configs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    supplier_name VARCHAR(100),
    supplier_lead_time INT,  -- 供应商交期(天)
    moq INT,  -- 最小起订量
    unit_cost DECIMAL(12,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

2. **采购建议生成**
```python
def generate_purchase_orders():
    """生成采购建议"""
    decisions = get_pending_replenishment()
    for d in decisions:
        supplier = get_best_supplier(d.asin)
        order_qty = max(d.suggest_qty, supplier.moq)
        create_purchase_suggestion(d, supplier, order_qty)
```

3. **补货建议审批**
```python
# 新增状态字段
class DecisionStatus(str, Enum):
    PENDING = "pending"      # 待审核
    APPROVED = "approved"     # 已审核
    ORDERED = "ordered"      # 已下单
    CANCELLED = "cancelled"  # 已取消
```

### 3.4 库存分析报表 ⚡ 中优先级

**建议新增报表**:

1. **库存周转率报表**
```python
def calculate_inventory_turnover(warehouse_code, start_date, end_date):
    """
    库存周转率 = 销售成本 / 平均库存
    周转天数 = 365 / 周转率
    """
```

2. **库龄分析报表**
```python
def get_inventory_age_analysis():
    """按库龄区间统计库存"""
    return {
        "0-30天": {"quantity": 100, "value": 50000},
        "30-90天": {"quantity": 200, "value": 80000},
        "90-180天": {"quantity": 150, "value": 45000},
        "180-365天": {"quantity": 80, "value": 20000},
        "365天以上": {"quantity": 30, "value": 5000},
    }
```

3. **呆滞库存分析**
```python
def get_dead_stock_report():
    """
    判定条件：
    - 90天内无销量
    - 库存数量 > 日均销量 * 180
    """
```

### 3.5 前端界面完善 ⚡ 中优先级

**需要完善的页面**:

1. **库存仪表盘**
   - 风险等级分布饼图
   - 库存趋势折线图
   - 断货预警列表
   - 待补货建议列表

2. **库存明细页**
   - 支持多条件筛选
   - 支持批量操作
   - 显示库存趋势
   - 显示在途货件

3. **补货建议页**
   - 按风险等级分组
   - 支持批量审核
   - 支持手动调整
   - 显示历史采纳率

4. **本地仓管理**
   - 库存导入
   - 库存查询
   - 变动记录

## 四、技术债务与优化

### 4.1 代码质量

**问题**:
- 部分硬编码 `tenant_id = 1`
- 缺少参数校验
- 缺少事务管理

**建议**:
```python
# 使用依赖注入获取租户ID
def get_inventory_list(
    db: Session,
    tenant_id: int = Depends(get_tenant_id),  # 从token解析
    ...
):
```

### 4.2 性能优化

**问题**:
- 大数据量导入可能超时
- 批量查询未分页

**建议**:
```python
# 1. 使用异步导入
@router.post("/import")
async def import_inventory(file: UploadFile):
    # 立即返回任务ID，异步处理
    task_id = await queue_import_task(file)
    return {"task_id": task_id, "status": "processing"}

# 2. 查询分页优化
query = db.query(InventorySnapshot).options(
    joinedload(InventorySnapshot.product),
    joinedload(InventorySnapshot.store)
)
```

### 4.3 监控与日志

**建议新增**:
```python
import logging
logger = logging.getLogger(__name__)

def import_inventory(...):
    logger.info(f"开始导入库存数据，文件名: {filename}")
    try:
        ...
        logger.info(f"导入成功，共 {total} 条记录")
    except Exception as e:
        logger.error(f"导入失败: {str(e)}", exc_info=True)
        raise
```

## 五、实施计划

### Phase 1: 核心功能完善（1-2周）
1. [ ] 库存预警自动生成
2. [ ] 预警通知集成（飞书）
3. [ ] 库存变动记录
4. [ ] 基础API完善

### Phase 2: 业务功能增强（2-3周）
1. [ ] 采购配置管理
2. [ ] 采购建议生成
3. [ ] 补货审批流程
4. [ ] 前端页面完善

### Phase 3: 分析报表（1-2周）
1. [ ] 库存周转率报表
2. [ ] 库龄分析报表
3. [ ] 呆滞库存分析
4. [ ] 数据可视化

## 六、总结

现有库存系统已经具备良好的数据模型和核心功能基础，主要完善方向：

1. **自动化**: 实现预警自动生成和通知
2. **完整性**: 新增库存变动管理
3. **智能化**: 增强补货决策逻辑
4. **可视化**: 完善分析报表和前端界面

建议按优先级分阶段实施，Phase 1聚焦核心痛点解决。
