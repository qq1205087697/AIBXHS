# 库存筛选逻辑修复建议

## 问题1：店铺筛选逻辑错误

### 当前代码（inventory_service.py:681-691）
```python
if account:
    if isinstance(account, list) and len(account) > 0:
        account_conditions = [
            InventorySnapshot.account.like(f"{a}-%") for a in account
        ]
        valid_snapshot_query = valid_snapshot_query.filter(or_(*account_conditions))
    elif isinstance(account, str):
        valid_snapshot_query = valid_snapshot_query.filter(InventorySnapshot.account.like(f"{account}-%"))
```

### 问题
- `account` 参数值已经是 "JeVenis-US"（包含站点）
- 但代码又加了 `-%`，变成 "JeVenis-US-%"
- 而数据库中 `InventorySnapshot.account` 就是 "JeVenis-US"
- 导致匹配失败

### 修复方案
```python
if account:
    if isinstance(account, list) and len(account) > 0:
        # account 已经是完整的 "店铺-国家" 格式，直接精确匹配
        valid_snapshot_query = valid_snapshot_query.filter(
            InventorySnapshot.account.in_(account)
        )
    elif isinstance(account, str):
        valid_snapshot_query = valid_snapshot_query.filter(InventorySnapshot.account == account)
```

## 问题2：店铺和国家筛选的关联

### 当前逻辑
- 店铺筛选：基于 `inventory_name`（如 "JeVenis-US"）
- 国家筛选：基于 `country` 字段（如 "美国"）

### 潜在问题
如果用户同时选择：
- 店铺："JeVenis-US"（美国站点）
- 国家："英国"

这会产生矛盾，但当前代码不会报错，只是返回空结果。

### 建议
1. 前端限制：选择店铺后，自动过滤国家选项
2. 或者后端优化：当店铺已包含国家信息时，忽略国家筛选

## 修复代码

```python
# backend/services/inventory_service.py
# 修改 search_inventory 函数中的 account 筛选逻辑

if account:
    if isinstance(account, list) and len(account) > 0:
        # account 已经是完整的 "店铺-国家" 格式
        valid_snapshot_query = valid_snapshot_query.filter(
            InventorySnapshot.account.in_(account)
        )
    elif isinstance(account, str):
        valid_snapshot_query = valid_snapshot_query.filter(InventorySnapshot.account == account)
```

## 验证步骤

1. 导入库存数据，确保 `account` 字段值为 "JeVenis-US" 格式
2. 调用 /filter-options，获取店铺列表
3. 选择店铺 "云南金顺公司 (JeVenis-US)"
4. 验证返回结果中 `account` 都是 "JeVenis-US"
