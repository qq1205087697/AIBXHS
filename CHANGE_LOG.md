# 项目变更日志 (CHANGE LOG)

记录所有针对此项目的开发操作、代码修改、文档更新等。

---

## 2026-08-07

### [文档] 重写 CODE_WIKI.md 为结构化完整版（以真实代码为准）
- **操作**：基于三个 Explore 代理对 backend/frontend/database 的真实代码交叉核对，全面重写 CODE_WIKI.md
- **执行详情**：
  - 修正过时技术栈：README 写 Node.js/Express/MongoDB 实为 FastAPI/MySQL；统一端口为前端 3000 / 后端 8002（旧文档 5173/8000 有误）
  - 补全后端 33 router、22 service、19 model 文件/52 表、7 条广告规则、RBAC 鉴权链、7 个定时任务
  - 补全前端 Provider/路由/api.ts（31 模块）、22 页面、6 套主题、useStreamingChat 死代码说明
  - 补全数据库多租户隔离策略、软删除、无 Alembic 迁移方式、`schema.sql` 已过时说明
  - 新增「已知问题与技术债」13 项（含 `AI_SEMAPHORE` 未定义、`.env` 明文凭据、`store_groups` 无 DDL、`AdRetention` 调用缺失方法等）
  - 新增顶层脚本（inventory.py 原型 / _reset_ids.py 高危 / _verify_gross_margin.py）与 Excel 数据资产说明
- **涉及文件**：`CODE_WIKI.md`（重写）

## 2026-05-26

### [文档] 创建项目 Code Wiki 与操作日志
- **操作**：创建项目整体 Code Wiki 文档与操作日志规范
- **执行详情**：完成项目架构分析，重写 CODE_WIKI.md，创建 CHANGE_LOG.md
- **涉及文件**：
  - `CODE_WIKI.md`（重写）
  - `CHANGE_LOG.md`（新建）
  - `.trae/specs/generate-code-wiki/spec.md`（新建）
  - `.trae/specs/generate-code-wiki/tasks.md`（新建）
  - `.trae/specs/generate-code-wiki/checklist.md`（新建）

### [前端] 库存机器人页面日均销量显示优化
- **操作**：日均销量统一保留两位小数
- **执行详情**：
  - 库存表格「日均销量」列改为 `val.toFixed(2)` 显示两位小数
  - 断货风险 TOP10 面板中「日均销量」改为 `item.daily_sales.toFixed(2)` 显示两位小数
  - 在途详情弹窗「预计可售时间」改为根据「预计到港时间+7天」计算显示（仅前端计算，不改后端数据）
  - 预计到港时间为 `-` 时，预计可售时间也显示 `-`
- **涉及文件**：
  - `frontend/src/pages/InventoryBot.tsx`（日均销量列 render、断货TOP10 render、在途列 render）

### [后端] 日均销量精度统一处理
- **操作**：在后端 search_inventory() 统一 round(daily_sales, 2)，导出路径自动继承
- **执行详情**：
  - 后端 `backend/services/inventory_service.py` 中 `search_inventory()` 返回前对 `daily_sales` 执行 `round(val, 2)`
  - 导出函数 `export_inventory_to_excel()` 通过 `search_inventory()` 获取数据，自动获得四舍五入值
  - 前端 `.toFixed(2)` 保留不动，确保 JavaScript 中尾零正确显示（"2.50" 不显示为 "2.5"）
  - 最终效果：API返回、前端表格、TOP10面板、Excel导出，所有展示路径日均销量均为两位小数
- **涉及文件**：
  - `backend/services/inventory_service.py`（search_inventory 中 daily_sales 增加 round）

### [后端] 库存导入改为 UPSERT 方案（替代 DELETE ALL）
- **操作**：将库存导入从 DELETE ALL + INSERT ALL 改为逐行 UPSERT
- **执行详情**：
  - 删除 `_do_import()` 和 `import_inventory_data()` 中的 3 条全表 DELETE 语句
  - 新增步骤2：建立**全量**现有数据索引（不限日期）`{(asin, account, country) → id}` 和 `{(summary_flag, asin) → id}`
  - 新增步骤3 UPSERT 逻辑：按行类型匹配
    - `"0"` 和 `"共享库存"` 行 → 按 `(asin, account, country)` 匹配
    - `"是"` 汇总行 → 按 `(summary_flag, asin)` 匹配
    - 匹配到则 UPDATE（snapshot_id 不变），未匹配则 INSERT
  - 新增孤儿清理：全量索引对比当日导入数据 → 旧日期数据自动被清除
  - 空库/无数据时：索引为空 → 所有行走 INSERT，行为与原一致
- **涉及文件**：
  - `backend/services/inventory_import_service.py`（_do_import 全部重写）
  - `backend/services/inventory_service.py`（import_inventory_data 全部重写）