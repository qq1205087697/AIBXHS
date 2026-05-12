# 宝鑫华盛AI助手 - Code Wiki

## 目录
1. [项目概述](#项目概述)
2. [项目架构](#项目架构)
3. [技术栈](#技术栈)
4. [数据库设计](#数据库设计)
5. [核心模块说明](#核心模块说明)
6. [API接口文档](#api接口文档)
7. [前端架构](#前端架构)
8. [项目运行方式](#项目运行方式)
9. [开发指南](#开发指南)

---

## 项目概述

### 项目简介
**项目名称**: 宝鑫华盛AI助手  
**项目类型**: 跨境电商智能运营平台  

### 核心功能
1. **库存机器人**
   - 全天候库存监控
   - 断货预警与补货建议
   - 冗余库存智能分析
   - 补货决策算法

2. **差评机器人**
   - 全ASIN评论实时追踪
   - 新增差评及时锁定预警
   - AI自动翻译并提炼核心诉求

3. **多租户架构**
   - 账号权限隔离
   - 店铺管理
   - 计费套餐

### 项目目标
为跨境电商卖家提供智能化的库存管理和差评监控解决方案，通过AI技术提升运营效率，降低断货风险和差评影响。

---

## 项目架构

### 整体架构图
```
┌─────────────────────────────────────────────────────────────┐
│                         前端层                                │
│  React 18 + TypeScript + Ant Design + Vite                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────┐  │
│  │ 登录/注册  │ │  数据看板  │ │ 库存机器人 │ │ 聊天   │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/HTTPS + JWT
                              │
┌─────────────────────────────────────────────────────────────┐
│                        后端层 (FastAPI)                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              API 路由层 (Routers)                    │    │
│  │  auth.py  inventory.py  restock.py  chat.py ...     │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              业务逻辑层 (Services)                   │    │
│  │  inventory_service.py  auth_service.py  ...         │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              数据模型层 (Models)                     │    │
│  │  User, Tenant, Store, Product, Inventory, ...       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ SQLAlchemy ORM
                              │
┌─────────────────────────────────────────────────────────────┐
│                      数据库层 (MySQL)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ tenants  │ │  users   │ │  stores  │ │products  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────┐    │
│  │inventory_snapshot│ │replenishment_deci│ │reviews   │    │
│  └──────────────────┘ └──────────────────┘ └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
AIBXHS/
├── backend/                              # 后端服务
│   ├── __pycache__/
│   ├── database/
│   │   ├── __init__.py
│   │   └── database.py                   # 数据库连接与初始化
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py                       # 基础模型类
│   │   ├── tenant.py                     # 租户模型
│   │   ├── user.py                       # 用户模型
│   │   ├── store.py                      # 店铺模型
│   │   ├── product.py                    # 商品模型
│   │   ├── inventory.py                  # 库存相关模型
│   │   ├── restock.py                    # 补货相关模型
│   │   ├── review.py                     # 评论相关模型
│   │   └── conversation.py               # 对话历史模型
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── auth.py                       # 认证相关接口
│   │   ├── chat.py                       # 聊天机器人接口
│   │   ├── dashboard.py                  # 仪表盘接口
│   │   ├── inventory.py                  # 库存机器人接口
│   │   ├── restock.py                    # 补货管理接口
│   │   └── reviews.py                    # 差评机器人接口
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py               # 认证服务
│   │   ├── chat_service.py               # 聊天服务
│   │   ├── feishu_service.py             # 飞书集成服务
│   │   ├── inventory_service.py          # 库存服务（核心）
│   │   ├── scheduler.py                  # 定时任务调度
│   │   └── translate_service.py          # 翻译服务
│   ├── scripts/
│   │   └── init_data.py                  # 初始化数据脚本
│   ├── static/                           # 静态文件目录
│   ├── .env.example                      # 环境变量示例
│   ├── config.py                         # 配置管理
│   ├── dependencies.py                   # 依赖注入（认证等）
│   ├── main.py                           # FastAPI主入口
│   ├── main_debug.py                     # 调试版本
│   ├── main_simple.py                    # 简化版本
│   └── requirements.txt                  # Python依赖
├── frontend/                             # 前端项目
│   ├── .next/
│   ├── src/
│   │   ├── components/                   # 组件
│   │   │   ├── Layout/
│   │   │   │   └── MainLayout.tsx
│   │   │   ├── ThemeSwitcher/
│   │   │   │   └── index.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── contexts/                     # React上下文
│   │   │   ├── AuthContext.tsx           # 认证上下文
│   │   │   └── ThemeContext.tsx          # 主题上下文
│   │   ├── pages/                        # 页面组件
│   │   │   ├── ChatBot.tsx               # 聊天机器人页面
│   │   │   ├── Dashboard.tsx             # 数据看板页面
│   │   │   ├── InventoryBot.tsx          # 库存机器人页面
│   │   │   ├── Login.tsx                 # 登录页面
│   │   │   └── Register.tsx              # 注册页面
│   │   ├── App.tsx                       # 应用入口
│   │   ├── api.ts                        # API接口定义
│   │   ├── main.tsx                      # React渲染入口
│   │   └── index.css                     # 全局样式
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── database/
│   ├── schema.sql                        # 数据库表结构SQL
│   └── drop_inventory_tables.sql
├── inventory.py
├── test_import.py
├── README.md
├── package.json
├── package-lock.json
└── CODE_WIKI.md                          # 本文档
```

---

## 技术栈

### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.9+ | 开发语言 |
| FastAPI | >=0.115.0 | Web框架 |
| Uvicorn | >=0.32.0 | ASGI服务器 |
| SQLAlchemy | >=2.0.35 | ORM框架 |
| PyMySQL | >=1.1.0 | MySQL驱动 |
| Pydantic | >=2.9.0 | 数据验证 |
| Pydantic Settings | >=2.6.0 | 配置管理 |
| python-jose | >=3.3.0 | JWT处理 |
| passlib | >=1.7.4 | 密码哈希 |
| APScheduler | >=3.10.4 | 定时任务调度 |
| OpenAI SDK | >=1.50.0 | AI模型集成 |
| python-multipart | >=0.0.9 | 文件上传处理 |
| Pandas | - | 数据处理 |

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^18.2.0 | UI框架 |
| TypeScript | ^5.2.2 | 类型系统 |
| Vite | ^5.0.8 | 构建工具 |
| Ant Design | ^5.12.0 | UI组件库 |
| React Router | ^6.22.0 | 路由管理 |
| Axios | ^1.6.5 | HTTP客户端 |
| Recharts | ^2.10.3 | 数据可视化 |
| Lucide React | ^0.300.0 | 图标库 |
| Day.js | ^1.11.10 | 日期处理 |

---

## 数据库设计

### 数据库表关系图

```
tenants (租户)
  ├── users (用户)
  └── stores (店铺)
       └── products (商品)
            ├── inventory_records (库存记录)
            ├── inventory_alerts (库存预警)
            ├── inventory_actions (库存操作记录)
            └── reviews (评论)
                 ├── review_analyses (评论分析)
                 └── review_handlings (评论处理记录)

inventory_snapshots (库存快照)
  ├── inbound_shipment_details (在途货件详情)
  └── replenishment_decisions (补货决策)
```

### 核心数据表详解

#### 1. 租户表 (tenants)

**表名**: `tenants`  
**用途**: 多租户架构的核心表，存储租户信息

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 租户ID | Primary Key, Index |
| name | String(100) | 租户名称 | Not Null |
| code | String(50) | 租户编码 | Unique, Index, Not Null |
| status | String(20) | 状态 | Default: 'active' |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `users`: 一对多，一个租户有多个用户
- `stores`: 一对多，一个租户有多个店铺
- `products`: 一对多，一个租户有多个商品
- `reviews`: 一对多，一个租户有多条评论

---

#### 2. 用户表 (users)

**表名**: `users`  
**用途**: 存储系统用户信息

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 用户ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| username | String(100) | 用户名 | Not Null |
| email | String(255) | 邮箱 | Nullable |
| password_hash | String(255) | 密码哈希 | Not Null |
| nickname | String(100) | 昵称 | Nullable |
| role | String(20) | 角色 | Default: 'operator' |
| status | String(20) | 状态 | Default: 'active', Index |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `tenant`: 多对一，属于一个租户
- `conversation_history`: 一对多，一个用户有多条对话历史

---

#### 3. 店铺表 (stores)

**表名**: `stores`  
**用途**: 存储电商平台店铺信息

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 店铺ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| name | String(100) | 店铺名称 | Not Null |
| platform | Enum | 电商平台 | (amazon/shopee/lazada/tiktok/other), Index, Not Null |
| platform_store_id | String(100) | 平台店铺ID | Nullable |
| site | String(20) | 站点(US/UK/CA等) | Nullable |
| marketplace_id | String(50) | 市场ID | Nullable |
| api_key | String(500) | API密钥(加密) | Nullable |
| api_secret | String(500) | API密钥(加密) | Nullable |
| api_token | String(500) | API令牌(加密) | Nullable |
| status | Enum | 状态 | (active/inactive/error), Default: active, Index |
| sync_status | Enum | 同步状态 | (idle/syncing/failed), Default: idle |
| last_synced_at | DateTime | 最后同步时间 | Nullable |
| config | JSON | 店铺配置 | Nullable |
| created_by | Integer | 创建人 | Foreign Key (users.id), Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `tenant`: 多对一，属于一个租户
- `products`: 一对多，一个店铺有多个商品
- `reviews`: 一对多，一个店铺有多条评论

---

#### 4. 商品表 (products)

**表名**: `products`  
**用途**: 存储商品信息

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 商品ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| store_id | Integer | 店铺ID | Foreign Key (stores.id), Index, Not Null |
| asin | String(50) | ASIN/商品编码 | Not Null |
| sku | String(100) | SKU | Nullable |
| name | String(255) | 商品名称 | Not Null |
| name_en | String(255) | 英文名称 | Nullable |
| image_url | String(500) | 商品图片 | Nullable |
| category | String(100) | 商品分类 | Index, Nullable |
| brand | String(100) | 品牌 | Nullable |
| price | Decimal(12,2) | 售价 | Nullable |
| cost_price | Decimal(12,2) | 成本价 | Nullable |
| status | Enum | 状态 | (active/inactive/archived), Default: active, Index |
| is_robot_monitored | Boolean | 是否机器人监控 | Default: True |
| config | JSON | 商品配置(安全库存等) | Nullable |
| created_by | Integer | 创建人 | Foreign Key (users.id), Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `tenant`: 多对一，属于一个租户
- `store`: 多对一，属于一个店铺
- `inventory_records`: 一对多，一个商品有多条库存记录
- `inventory_alerts`: 一对多，一个商品有多条库存预警
- `inventory_actions`: 一对多，一个商品有多条库存操作记录

---

#### 5. 库存记录表 (inventory_records)

**表名**: `inventory_records`  
**用途**: 存储库存变更历史记录

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 记录ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| product_id | Integer | 商品ID | Foreign Key (products.id), Index, Not Null |
| store_id | Integer | 店铺ID | Foreign Key (stores.id), Index, Not Null |
| warehouse_code | String(50) | 仓库编码 | Nullable |
| quantity | Integer | 当前库存 | Not Null |
| quantity_in_transit | Integer | 在途库存 | Default: 0 |
| quantity_available | Integer | 可用库存 | Not Null |
| quantity_reserved | Integer | 预留库存 | Default: 0 |
| safe_stock | Integer | 安全库存 | Default: 0 |
| daily_sales | Integer | 日均销量 | Nullable |
| days_remaining | Integer | 可售天数 | Nullable |
| record_date | Date | 记录日期 | Index, Not Null |
| source | Enum | 数据来源 | (manual/api_sync/import), Default: api_sync |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `product`: 多对一，属于一个商品

---

#### 6. 库存预警表 (inventory_alerts)

**表名**: `inventory_alerts`  
**用途**: 存储库存预警信息

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 预警ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| product_id | Integer | 商品ID | Foreign Key (products.id), Index, Not Null |
| store_id | Integer | 店铺ID | Foreign Key (stores.id), Index, Not Null |
| alert_type | Enum | 预警类型 | (low_stock/out_of_stock/overstock/price_change), Index, Not Null |
| severity | Enum | 严重程度 | (info/warning/danger/critical), Default: warning |
| title | String(200) | 预警标题 | Not Null |
| description | String(1000) | 预警描述 | Nullable |
| current_stock | Integer | 当前库存 | Nullable |
| safe_stock | Integer | 安全库存 | Nullable |
| suggestions | JSON | AI建议 | Nullable |
| status | Enum | 处理状态 | (new/acknowledged/processing/resolved/dismissed), Default: new, Index |
| priority | Integer | 优先级(1-10) | Default: 5 |
| resolved_by | Integer | 处理人 | Foreign Key (users.id), Nullable |
| resolved_at | DateTime | 处理时间 | Nullable |
| resolved_note | String(1000) | 处理备注 | Nullable |
| feishu_record_id | String(100) | 飞书记录ID | Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `product`: 多对一，属于一个商品
- `actions`: 一对多，一条预警有多条操作记录

---

#### 7. 库存操作记录表 (inventory_actions)

**表名**: `inventory_actions`  
**用途**: 存储库存操作历史

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 操作ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| product_id | Integer | 商品ID | Foreign Key (products.id), Index, Not Null |
| store_id | Integer | 店铺ID | Foreign Key (stores.id), Index, Not Null |
| alert_id | Integer | 关联预警ID | Foreign Key (inventory_alerts.id), Index, Nullable |
| action_type | Enum | 操作类型 | (price_adjust/ad_budget/promotion/restock/other), Not Null |
| action_title | String(200) | 操作标题 | Not Null |
| action_details | JSON | 操作详情 | Nullable |
| status | Enum | 执行状态 | (pending/executing/success/failed/cancelled), Default: pending, Index |
| triggered_by | Enum | 触发方式 | (system_auto/manual/schedule), Default: manual |
| result | String(1000) | 执行结果 | Nullable |
| error_message | String(1000) | 错误信息 | Nullable |
| executed_by | Integer | 执行人 | Foreign Key (users.id), Nullable |
| executed_at | DateTime | 执行时间 | Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `product`: 多对一，属于一个商品
- `alert`: 多对一，属于一条预警

---

#### 8. 库存快照表 (inventory_snapshots)

**表名**: `inventory_snapshots`  
**用途**: 存储库存快照数据（从Excel导入）

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 主键ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Default: 1, Index |
| snapshot_date | Date | 快照日期 | Index, Not Null |
| summary_flag | String(10) | 欧洲/北美汇总行标记 | Default: '0' |
| asin | String(100) | ASIN | Index |
| parent_asin | String(1000) | 父ASIN | |
| msku | String(2000) | MSKU | |
| fnsku | String(1000) | FNSKU | |
| sku | String(500) | SKU | Index |
| product_name | String(500) | 品名 | |
| title | String(1000) | 标题 | |
| account | String(500) | 店铺 | Index |
| country | String(200) | 国家/地区 | Index |
| category | String(200) | 分类 | |
| brand | String(200) | 品牌 | |
| replenishment_status | String(50) | 补货状态 | |
| purchase_plan_days | Integer | 采购计划天数 | |
| purchase_lead_time | Integer | 采购交期 | |
| qc_days | Integer | 质检天数 | |
| overseas_to_fba_days | Integer | 海外仓至FBA天数 | |
| safety_days | Integer | 安全天数 | |
| purchase_frequency | Integer | 采购频率 | |
| local_ship_frequency | Integer | 本地仓发货频率 | |
| overseas_ship_frequency | Integer | 海外仓发货频率 | |
| stock_up_duration | Integer | 备货时长 | |
| sales_3d | Float | 3天销量 | |
| sales_7d | Float | 7天销量 | |
| sales_14d | Float | 14天销量 | |
| sales_30d | Float | 30天销量 | |
| sales_60d | Float | 60天销量 | |
| sales_90d | Float | 90天销量 | |
| daily_avg_3d | Float | 3天日均销量 | |
| daily_avg_7d | Float | 7天日均销量 | |
| daily_avg_14d | Float | 14天日均销量 | |
| daily_avg_30d | Float | 30天日均销量 | |
| daily_avg_60d | Float | 60天日均销量 | |
| daily_avg_90d | Float | 90天日均销量 | |
| days_supply_total | Float | 可售天数(总) | |
| days_supply_fba | Float | 可售天数(FBA) | |
| days_supply_fba_inbound | Float | 可售天数(FBA+在途) | |
| stockout_date | Date | 断货时间 | Nullable |
| daily_sales | Float | 日均销量 | |
| sales_forecast | Float | 销量预测 | |
| fba_stock | Float | FBA库存 | |
| fba_inbound | Float | FBA在途 | |
| fba_inbound_detail | Text | 原始在途详情文本 | |
| fba_available | Float | 可售 | |
| fba_pending_transfer | Float | 待调仓 | |
| fba_in_transfer | Float | 调仓中 | |
| fba_inbound_processing | Float | 入库中 | |
| local_available | Float | 本地可用 | |
| total_stock | Float | 总库存 | |
| age_0_3 | Float | 0-3个月库龄 | |
| age_3_6 | Float | 3-6个月库龄 | |
| age_6_9 | Float | 6-9个月库龄 | |
| age_9_12 | Float | 9-12个月库龄 | |
| age_12_plus | Float | 12个月以上库龄 | |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `inbound_shipment_details`: 一对多，一个快照有多条在途货件详情
- `replenishment_decisions`: 一对多，一个快照有多条补货决策

---

#### 9. 在途货件详情表 (inbound_shipment_details)

**表名**: `inbound_shipment_details`  
**用途**: 存储在途货件详细信息

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 主键ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Default: 1, Index |
| snapshot_id | Integer | 关联快照ID | Foreign Key (inventory_snapshots.id), Index |
| asin | String(100) | ASIN | Index |
| account | String(500) | 店铺 | Index |
| country | String(200) | 国家/地区 | |
| shipment_id | String(100) | 货件单号 | |
| quantity | Integer | 数量 | |
| logistics_method | String(100) | 物流方式 | |
| transport_method | String(100) | 运输方式 | |
| ship_date | Date | 发货时间 | Nullable |
| estimated_available_date | Date | 预计可售时间 | Nullable |
| raw_text | Text | 原始行文本 | |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `inventory_snapshot`: 多对一，属于一个库存快照

---

#### 10. 补货决策表 (replenishment_decisions)

**表名**: `replenishment_decisions`  
**用途**: 存储补货决策计算结果

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 主键ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Default: 1, Index |
| snapshot_id | Integer | 关联快照ID | Foreign Key (inventory_snapshots.id), Index |
| summary_flag | String(10) | 欧洲/北美汇总行标记 | Default: '0' |
| asin | String(100) | ASIN | Index |
| sku | String(500) | SKU | Index |
| account | String(500) | 店铺 | Index |
| country | String(200) | 国家/地区 | Index |
| snapshot_date | Date | 快照日期 | Index, Not Null |
| future_stock | Float | 未来可用库存 | |
| demand | Float | 补货周期内需求预测量 | |
| safety_stock | Float | 安全库存量 | |
| suggest_qty | Float | 建议补货数量 | |
| days_of_supply | Float | 可售天数 | |
| stockout_days | Float | 预计断货天数 | |
| stockout_date_calc | String(20) | 断货时间(计算得出) | |
| risk_level | String(10) | 风险等级: 红/黄/绿 | |
| reason | String(1000) | 补货建议原因说明 | |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `inventory_snapshot`: 多对一，属于一个库存快照

---

#### 11. 评论表 (reviews)

**表名**: `reviews`  
**用途**: 存储商品评论

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 评论ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| store_id | Integer | 店铺ID | Foreign Key (stores.id), Index, Not Null |
| asin | String(20) | 产品ASIN | Index, Nullable |
| reviewer_name | String(200) | 买家名字 | Nullable |
| rating | SmallInteger | 星级评分(1-5) | Index, Not Null |
| title | String(500) | 评论标题 | Nullable |
| content | Text | 评论原文 | Not Null |
| translated_title | String(500) | 翻译后的标题 | Nullable |
| translated_content | Text | 翻译后的内容 | Nullable |
| review_date | DateTime | 评论日期 | Index, Not Null |
| crawled_at | DateTime | 抓取日期 | Nullable |
| account | String(100) | 账号 | Nullable |
| site | String(50) | 站点 | Nullable |
| return_rate | Float | 退货率 | Nullable |
| status | Enum | 处理状态 | (new/read/processing/resolved/dismissed), Default: new, Index |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `tenant`: 多对一，属于一个租户
- `store`: 多对一，属于一个店铺
- `analysis`: 一对一，一条评论有一条分析
- `handlings`: 一对多，一条评论有多条处理记录

---

#### 12. 评论分析表 (review_analyses)

**表名**: `review_analyses`  
**用途**: 存储AI对评论的分析结果

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 分析ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| review_id | Integer | 评论ID | Foreign Key (reviews.id), Unique, Not Null |
| model | String(100) | AI模型 | Nullable |
| sentiment | Enum | 情感分析 | (positive/neutral/negative), Index, Not Null |
| sentiment_score | Integer | 情感分数 | Nullable |
| key_points | JSON | 核心观点 | Nullable |
| topics | JSON | 主题分类 | Nullable |
| suggestions | JSON | 处理建议 | Nullable |
| summary | Text | 分析摘要 | Nullable |
| raw_response | Text | AI原始响应 | Nullable |
| analysis_time | Integer | 分析耗时(ms) | Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `review`: 一对一，属于一条评论

---

#### 13. 评论处理记录表 (review_handlings)

**表名**: `review_handlings`  
**用途**: 存储评论处理历史

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 处理记录ID | Primary Key, Index |
| tenant_id | Integer | 租户ID | Foreign Key (tenants.id), Index, Not Null |
| review_id | Integer | 评论ID | Foreign Key (reviews.id), Index, Not Null |
| handler_id | Integer | 处理人 | Foreign Key (users.id), Index, Not Null |
| action | Enum | 操作类型 | (read/tag/comment/reply/dismiss/other), Not Null |
| note | Text | 处理备注 | Nullable |
| reply_content | Text | 回复内容 | Nullable |
| reply_sent | Boolean | 回复是否已发送 | Default: False |
| reply_sent_at | DateTime | 回复发送时间 | Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `review`: 多对一，属于一条评论

---

#### 14. 对话历史表 (conversation_history)

**表名**: `conversation_history`  
**用途**: 存储聊天机器人对话历史

| 字段名 | 类型 | 说明 | 约束 |
|--------|------|------|------|
| id | Integer | 记录ID | Primary Key, Index |
| user_id | Integer | 用户ID | Foreign Key (users.id), Index, Not Null |
| session_id | String(64) | 会话ID | Index, Not Null |
| role | String(20) | 角色 | Not Null |
| content | Text | 内容 | Not Null |
| function_name | String(100) | 函数名称 | Nullable |
| created_at | DateTime | 创建时间 | |
| updated_at | DateTime | 更新时间 | |
| deleted_at | DateTime | 删除时间 | Nullable |

**关联关系**:
- `user`: 多对一，属于一个用户

---

## 核心模块说明

### 1. 库存服务 (`backend/services/inventory_service.py`)

这是项目的核心业务模块，负责库存数据处理、补货计算等核心功能。

#### 主要常量和配置

```python
FIELD_MAPPING = {
    "欧洲/北美汇总行": "summary_flag",
    "ASIN": "asin",
    "父ASIN": "parent_asin",
    "MSKU": "msku",
    "FNSKU": "fnsku",
    "SKU": "sku",
    "品名": "product_name",
    "标题": "title",
    "店铺": "account",
    "国家（地区）": "country",
    # ... 更多字段映射
}

NUMERIC_FIELDS = [
    "purchase_plan_days", "purchase_lead_time", "qc_days", 
    # ... 数值字段列表
]

LEAD_TIME = 100  # 备货周期(天)
```

#### 核心函数说明

##### `import_inventory_data(db: Session, file_path: str = None, file_content: bytes = None, filename: str = None) -> dict`

**功能**: 导入库存Excel数据

**参数**:
- `db`: 数据库会话
- `file_path`: Excel文件路径（可选）
- `file_content`: Excel文件内容字节流（可选）
- `filename`: 文件名（可选）

**返回**: 导入结果字典

**处理流程**:
1. 读取Excel文件
2. 列名映射（中文列名 -> 数据库字段名）
3. 数据清洗和类型转换
4. 删除当天旧数据
5. 批量插入库存快照
6. 解析在途详情并插入
7. 自动触发补货计算

**位置**: [inventory_service.py:251-390](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L251-L390)

---

##### `calculate_replenishment_single(row: dict, snapshot_date: date = None) -> dict`

**功能**: 计算单个SKU的补货决策

**参数**:
- `row`: 单行库存数据字典
- `snapshot_date`: 快照日期（可选）

**返回**: 补货决策结果字典

**补货决策算法**:
```
风险等级判定:
- 红: 可售天数 ≤ 14天
- 黄: 14天 < 可售天数 ≤ 30天
- 绿: 可售天数 > 30天

建议补货数量公式:
未来库存 = FBA可用 + FBA在途 + 本地可用
需求 = 日均销量 × LEAD_TIME (100天)
安全库存 = 日均销量 × 安全天数 (0)
建议补货量 = max(0, 需求 + 安全库存 - 未来库存)

注意:
- 共享库存子行不参与补货计算
- 日均销量极低(≤0.1)的SKU不建议补货
```

**位置**: [inventory_service.py:154-248](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L154-L248)

---

##### `_calculate_replenishment_internal(db: Session, df: pd.DataFrame, target_date: date) -> dict`

**功能**: 内部批量计算补货决策

**参数**:
- `db`: 数据库会话
- `df`: Pandas DataFrame（库存数据）
- `target_date`: 目标日期

**返回**: 计算结果统计

**处理流程**:
1. 删除当天旧的补货决策
2. 遍历快照数据，对每条记录调用 `calculate_replenishment_single`
3. 批量插入补货决策
4. 统计各风险等级的SKU数量

**位置**: [inventory_service.py:393-467](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L393-L467)

---

##### `calculate_replenishment(db: Session, snapshot_date: str = None) -> dict`

**功能**: 公开API - 计算补货决策

**参数**:
- `db`: 数据库会话
- `snapshot_date`: 快照日期字符串（格式：YYYY-MM-DD，可选）

**返回**: 计算结果统计

**位置**: [inventory_service.py:470-537](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L470-L537)

---

##### `get_inventory_overview(db: Session) -> dict`

**功能**: 获取库存概览统计

**参数**:
- `db`: 数据库会话

**返回**: 包含以下信息的字典:
- `total_sku`: 总SKU数
- `red_count`: 断货风险SKU数
- `yellow_count`: 库存预警SKU数
- `green_count`: 库存正常SKU数
- `snapshot_date`: 最新快照日期
- `stockout_top10`: 断货风险TOP10
- `overstock_top10`: 冗余库存TOP10

**位置**: [inventory_service.py:540-661](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L540-L661)

---

##### `search_inventory(db: Session, keyword: str = None, risk_level = None, ...) -> dict`

**功能**: 搜索库存数据

**参数**:
- `db`: 数据库会话
- `keyword`: 搜索关键词（ASIN/SKU/品名/店铺/国家）
- `risk_level`: 风险等级过滤（red/yellow/green）
- `replenishment_status`: 补货状态过滤
- `account`: 店铺过滤
- `country`: 国家过滤
- `sort_field`: 排序字段
- `sort_order`: 排序方向（asc/desc）
- `page`: 页码
- `page_size`: 每页数量

**返回**: 搜索结果字典，包含分页信息

**位置**: [inventory_service.py:664-794](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L664-L794)

---

##### `get_stockout_top10(db: Session) -> list`

**功能**: 获取断货风险TOP10

**参数**:
- `db`: 数据库会话

**返回**: 断货风险最高的10个SKU列表（按可售天数升序）

**位置**: [inventory_service.py:797-846](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L797-L846)

---

##### `get_overstock_top10(db: Session) -> list`

**功能**: 获取冗余库存TOP10

**参数**:
- `db`: 数据库会话

**返回**: 冗余库存最高的10个SKU列表（按12月以上库龄降序）

**位置**: [inventory_service.py:849-871](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L849-L871)

---

##### `get_inbound_details(db: Session, asin: str, account: str = None) -> list`

**功能**: 查询指定ASIN的在途货件详情

**参数**:
- `db`: 数据库会话
- `asin`: ASIN编码
- `account`: 店铺（可选）

**返回**: 在途货件详情列表

**位置**: [inventory_service.py:874-903](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L874-L903)

---

##### `_parse_inbound_details(raw_text: str) -> list`

**功能**: 解析在途详情文本

**参数**:
- `raw_text`: 原始在途详情文本

**返回**: 解析后的在途货件列表

**文本格式示例**:
```
货件单号|数量|物流方式|运输方式|发货时间|预计可售时间
FBA12345|100|海运|快船|2024-01-01|2024-03-15
```

**位置**: [inventory_service.py:85-139](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/inventory_service.py#L85-L139)

---

### 2. 认证服务 (`backend/services/auth_service.py`)

负责用户认证、密码处理、JWT令牌生成等。

#### 核心函数

##### `verify_password(plain_password: str, hashed_password: str) -> bool`

**功能**: 验证密码

**参数**:
- `plain_password`: 明文密码
- `hashed_password`: 哈希后的密码

**返回**: 验证是否成功

**位置**: [auth_service.py:15-17](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/auth_service.py#L15-L17)

---

##### `get_password_hash(password: str) -> str`

**功能**: 生成密码哈希

**参数**:
- `password`: 明文密码

**返回**: 哈希后的密码

**说明**: 使用 pbkdf2_sha256 算法，密码长度限制为72字节

**位置**: [auth_service.py:20-24](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/auth_service.py#L20-L24)

---

##### `create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str`

**功能**: 创建JWT访问令牌

**参数**:
- `data`: 要编码到令牌中的数据
- `expires_delta`: 过期时间（可选，默认使用配置中的过期时间）

**返回**: JWT令牌字符串

**位置**: [auth_service.py:27-36](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/auth_service.py#L27-L36)

---

##### `authenticate_user(db: Session, username: str, password: str) -> Optional[User]`

**功能**: 认证用户

**参数**:
- `db`: 数据库会话
- `username`: 用户名
- `password`: 密码

**返回**: 认证成功返回User对象，失败返回None

**位置**: [auth_service.py:44-51](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/auth_service.py#L44-L51)

---

##### `create_user(db: Session, username: str, email: str, password: str, nickname: Optional[str] = None) -> User`

**功能**: 创建新用户

**参数**:
- `db`: 数据库会话
- `username`: 用户名
- `email`: 邮箱
- `password`: 密码
- `nickname`: 昵称（可选）

**返回**: 创建的User对象

**说明**: 创建用户时会自动创建一个默认租户

**位置**: [auth_service.py:54-79](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/auth_service.py#L54-L79)

---

### 3. 定时任务调度 (`backend/services/scheduler.py`)

使用 APScheduler 管理定时任务。

**预定义任务框架**:
1. `check_inventory_job`: 每小时执行库存检查
2. `check_reviews_job`: 每30分钟执行差评监控
3. `send_daily_report_job`: 每天早9点发送日报

**位置**: [scheduler.py](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/services/scheduler.py)

---

### 4. 数据库模块 (`backend/database/database.py`)

负责数据库连接、会话管理和表初始化。

#### 核心组件

##### `engine`

SQLAlchemy引擎，使用连接池配置：
- `pool_size`: 10
- `max_overflow`: 20
- `pool_timeout`: 30秒
- `pool_recycle`: 1800秒（30分钟）

**位置**: [database.py:10-19](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/database/database.py#L10-L19)

---

##### `SessionLocal`

会话工厂，用于创建数据库会话。

**位置**: [database.py:29](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/database/database.py#L29)

---

##### `get_db()`

FastAPI依赖注入函数，用于获取数据库会话。

**位置**: [database.py:35-43](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/database/database.py#L35-L43)

---

##### `init_db()`

初始化数据库，创建所有表。

**位置**: [database.py:46-75](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/database/database.py#L46-L75)

---

### 5. 配置管理 (`backend/config.py`)

使用 Pydantic Settings 管理配置，支持从环境变量和 `.env` 文件加载。

#### 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 8000 |
| DB_HOST | 数据库主机 | localhost |
| DB_PORT | 数据库端口 | 3306 |
| DB_USER | 数据库用户 | root |
| DB_PASSWORD | 数据库密码 | Root@123456 |
| DB_NAME | 数据库名 | baoxinhuasheng |
| FEISHU_APP_ID | 飞书App ID | |
| FEISHU_APP_SECRET | 飞书App Secret | |
| FEISHU_INVENTORY_BASE_TOKEN | 飞书多维表格Token（库存） | |
| FEISHU_INVENTORY_TABLE_ID | 飞书表格ID（库存） | |
| FEISHU_REVIEW_BASE_TOKEN | 飞书多维表格Token（评论） | |
| FEISHU_REVIEW_TABLE_ID | 飞书表格ID（评论） | |
| OPENAI_API_KEY | OpenAI API Key | |
| OPENAI_API_BASE | OpenAI API Base | https://yunwu.ai/v1 |
| OPENAI_MODEL | OpenAI Model | deepseek-v4-flash |
| SECRET_KEY | JWT密钥 | your-secret-key... |
| ALGORITHM | JWT算法 | HS256 |
| ACCESS_TOKEN_EXPIRE_MINUTES | 令牌过期时间(分钟) | 10080 (7天) |

**位置**: [config.py](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/config.py)

---

### 6. 依赖注入 (`backend/dependencies.py`)

#### `get_current_user()`

获取当前认证用户的依赖注入函数。

**功能**:
- 从Authorization header获取Bearer token
- 验证JWT token
- 从token中提取username
- 从数据库查询用户

**位置**: [dependencies.py:15-36](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/dependencies.py#L15-L36)

---

### 7. FastAPI 主应用 (`backend/main.py`)

#### 应用配置

- **标题**: 宝鑫华盛AI助手
- **CORS**: 允许所有来源（开发环境）
- **默认端口**: 8002

#### 启动事件 (`startup_event`)

1. 初始化数据库表
2. 启动定时任务调度器

#### 关闭事件 (`shutdown_event`)

清理资源。

#### 注册的路由

| 路由前缀 | 模块 | 说明 |
|----------|------|------|
| /api/auth | auth.py | 认证相关 |
| /api/chat | chat.py | 聊天机器人 |
| /api/dashboard | dashboard.py | 数据看板 |
| /api/inventory | inventory.py | 库存管理 |
| /api/restock | restock.py | 补货管理 |
| /api/reviews | reviews.py | 评论管理 |

**位置**: [main.py](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/main.py)

---

## API接口文档

### 认证相关 (`backend/routers/auth.py`)

#### POST `/api/auth/register`

**功能**: 用户注册

**请求体**:
```json
{
  "username": "string",
  "email": "user@example.com",
  "password": "string",
  "nickname": "string"
}
```

**响应**:
```json
{
  "access_token": "string",
  "token_type": "bearer"
}
```

**位置**: [auth.py:36-52](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/auth.py#L36-L52)

---

#### POST `/api/auth/login`

**功能**: 用户登录

**请求体**:
```json
{
  "username": "string",
  "password": "string"
}
```

**响应**:
```json
{
  "access_token": "string",
  "token_type": "bearer"
}
```

**位置**: [auth.py:55-66](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/auth.py#L55-L66)

---

#### GET `/api/auth/me`

**功能**: 获取当前用户信息

**需要认证**: 是

**响应**:
```json
{
  "id": 1,
  "username": "string",
  "email": "user@example.com",
  "nickname": "string"
}
```

**位置**: [auth.py:69-79](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/auth.py#L69-L79)

---

### 补货管理 (`backend/routers/restock.py`)

#### POST `/api/restock/import`

**功能**: 导入库存Excel数据

**参数**:
- `file`: 文件上传（FormData）
- `file_path`: 文件路径（Query，可选）

**响应**:
```json
{
  "success": true,
  "data": {
    "total_rows": 100,
    "imported": 100,
    "inbound_details": 50,
    "snapshot_date": "2024-01-15",
    "calculation": {...}
  }
}
```

**位置**: [restock.py:18-49](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L18-L49)

---

#### POST `/api/restock/calculate`

**功能**: 触发补货决策计算

**参数**:
- `snapshot_date`: 快照日期（Query，可选，格式：YYYY-MM-DD）

**响应**:
```json
{
  "success": true,
  "data": {
    "date": "2024-01-15",
    "total": 100,
    "red": 10,
    "yellow": 20,
    "green": 70
  }
}
```

**位置**: [restock.py:53-70](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L53-L70)

---

#### GET `/api/restock/overview`

**功能**: 获取库存概览统计

**响应**:
```json
{
  "success": true,
  "data": {
    "total_sku": 100,
    "red_count": 10,
    "yellow_count": 20,
    "green_count": 70,
    "snapshot_date": "2024-01-15",
    "stockout_top10": [...],
    "overstock_top10": [...]
  }
}
```

**位置**: [restock.py:74-89](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L74-L89)

---

#### GET `/api/restock/search`

**功能**: 搜索库存数据

**参数**:
- `keyword`: 搜索关键词（Query，可选）
- `risk_level`: 风险等级（Query，可选，可多选）
- `replenishment_status`: 补货状态（Query，可选）
- `account`: 店铺（Query，可选）
- `country`: 国家（Query，可选）
- `sort_field`: 排序字段（Query，可选）
- `sort_order`: 排序方向（Query，可选：asc/desc）
- `page`: 页码（Query，默认：1）
- `page_size`: 每页数量（Query，默认：20）

**响应**:
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "page_size": 20
  }
}
```

**位置**: [restock.py:93-131](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L93-L131)

---

#### GET `/api/restock/stockout-top10`

**功能**: 获取断货风险TOP10

**响应**:
```json
{
  "success": true,
  "data": [...]
}
```

**位置**: [restock.py:135-149](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L135-L149)

---

#### GET `/api/restock/overstock-top10`

**功能**: 获取冗余库存TOP10

**响应**:
```json
{
  "success": true,
  "data": [...]
}
```

**位置**: [restock.py:153-167](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L153-L167)

---

#### GET `/api/restock/inbound-details`

**功能**: 查询在途货件详情

**参数**:
- `asin`: ASIN（Query，必填）
- `account`: 店铺（Query，可选）

**响应**:
```json
{
  "success": true,
  "data": [...]
}
```

**位置**: [restock.py:171-190](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L171-L190)

---

#### GET `/api/restock/latest-date`

**功能**: 获取最新快照日期

**响应**:
```json
{
  "success": true,
  "data": {
    "snapshot_date": "2024-01-15"
  }
}
```

**位置**: [restock.py:194-210](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/backend/routers/restock.py#L194-L210)

---

### 其他路由

- **inventory.py**: 库存预警相关接口
- **reviews.py**: 评论管理相关接口
- **dashboard.py**: 数据看板接口
- **chat.py**: 聊天机器人接口

---

## 前端架构

### 前端项目结构

```
frontend/src/
├── components/
│   ├── Layout/
│   │   └── MainLayout.tsx       # 主布局组件
│   ├── ThemeSwitcher/
│   │   └── index.tsx            # 主题切换组件
│   └── ProtectedRoute.tsx       # 路由保护组件
├── contexts/
│   ├── AuthContext.tsx          # 认证上下文
│   └── ThemeContext.tsx         # 主题上下文
├── pages/
│   ├── Login.tsx                # 登录页
│   ├── Register.tsx             # 注册页
│   ├── Dashboard.tsx            # 数据看板页
│   ├── InventoryBot.tsx         # 库存机器人页（核心）
│   ├── ReviewBot.tsx            # 差评机器人页
│   └── ChatBot.tsx              # 聊天机器人页
├── api.ts                       # API请求封装
├── App.tsx                      # 应用入口
├── main.tsx                     # React渲染入口
└── index.css                    # 全局样式
```

---

### 核心页面：库存机器人 (`frontend/src/pages/InventoryBot.tsx`)

#### 主要功能模块

1. **统计概览卡片**
   - 总SKU数
   - 断货风险SKU数
   - 库存预警SKU数
   - 库存正常SKU数

2. **搜索与筛选栏**
   - 关键词搜索（ASIN/SKU/品名/店铺/国家）
   - 风险等级筛选
   - 店铺筛选
   - 国家筛选

3. **断货风险TOP10**
   - 可折叠展示详细信息
   - 显示可售天数、日均销量等

4. **冗余库存TOP10**
   - 可折叠展示详细信息
   - 显示库龄分布

5. **库存数据明细表格**
   - 支持排序
   - 支持风险等级筛选
   - 分页
   - 风险等级颜色标识
   - 查看在途详情按钮

6. **在途货件详情弹窗**

#### 主要状态

| 状态 | 类型 | 说明 |
|------|------|------|
| overviewData | OverviewData \| null | 概览数据 |
| inventoryList | InventoryItem[] | 库存列表 |
| searchText | string | 搜索关键词 |
| riskFilter | string \| undefined | 风险等级筛选 |
| accountFilter | string \| undefined | 店铺筛选 |
| countryFilter | string \| undefined | 国家筛选 |
| pagination | TablePaginationConfig | 分页配置 |
| sortField | string \| undefined | 排序字段 |
| sortOrder | string \| undefined | 排序方向 |
| tableRiskFilter | string[] \| undefined | 表格风险等级筛选 |
| inboundModalVisible | boolean | 在途详情弹窗可见性 |
| inboundDetails | InboundDetail[] | 在途详情数据 |
| inboundAsin | string | 当前查看的ASIN |

#### 主要函数

| 函数 | 说明 |
|------|------|
| fetchOverview | 获取概览数据 |
| fetchInventoryList | 获取库存列表 |
| handleSearch | 处理搜索 |
| handleRiskFilterChange | 处理风险等级筛选 |
| handleAccountFilterChange | 处理店铺筛选 |
| handleCountryFilterChange | 处理国家筛选 |
| handleTableChange | 处理表格变化（分页、排序、筛选） |
| handleImportData | 重新计算补货决策 |
| handleViewInbound | 查看在途详情 |

#### TypeScript 接口

主要接口定义在 [InventoryBot.tsx:34-99](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/frontend/src/pages/InventoryBot.tsx#L34-L99)

**位置**: [InventoryBot.tsx](file:///c:/Users/Administrator/Desktop/Python/AI/AIBXHS/AIBXHS/frontend/src/pages/InventoryBot.tsx)

---

### API 封装 (`frontend/src/api.ts`)

封装了所有后端API请求，使用 Axios。

主要API方法:
- `inventoryApi.getOverview()` - 获取概览
- `inventoryApi.search(params)` - 搜索库存
- `inventoryApi.getStockoutTop10()` - 获取断货TOP10
- `inventoryApi.getOverstockTop10()` - 获取冗余TOP10
- `inventoryApi.getInboundDetails(asin, account)` - 获取在途详情
- `inventoryApi.calculate()` - 触发计算
- `authApi.login()`, `authApi.register()`, `authApi.getMe()` - 认证相关

---

### React 上下文

#### AuthContext (`frontend/src/contexts/AuthContext.tsx`)

管理用户认证状态，包括:
- 当前用户信息
- 登录/登出方法
- Token 管理

#### ThemeContext (`frontend/src/contexts/ThemeContext.tsx`)

管理主题切换（浅色/深色）。

---

## 项目运行方式

### 1. 环境准备

#### 系统要求
- Python 3.9+
- Node.js 16+
- MySQL 5.7+ 或 8.0+

#### 后端环境配置

1. 创建数据库
```sql
CREATE DATABASE baoxinhuasheng CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. 创建 `.env` 文件（参考 `.env.example`）
```bash
cd backend
cp .env.example .env
```

3. 编辑 `.env` 文件，配置数据库连接等信息
```env
# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=baoxinhuasheng

# 飞书配置（可选）
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_INVENTORY_BASE_TOKEN=
FEISHU_INVENTORY_TABLE_ID=
FEISHU_REVIEW_BASE_TOKEN=
FEISHU_REVIEW_TABLE_ID=

# OpenAI配置
OPENAI_API_KEY=your_api_key
OPENAI_API_BASE=https://yunwu.ai/v1
OPENAI_MODEL=deepseek-v4-flash

# JWT密钥（生产环境请修改）
SECRET_KEY=your-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

#### 前端环境配置

前端配置在 `frontend/src/api.ts` 中修改 `BASE_URL`。

---

### 2. 安装依赖

#### 后端依赖
```bash
cd backend
pip install -r requirements.txt
```

#### 前端依赖
```bash
cd frontend
npm install
```

---

### 3. 启动服务

#### 启动后端服务

```bash
cd backend

# 方式1: 使用Python直接运行
python main.py

# 方式2: 使用uvicorn
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

后端服务默认运行在: `http://localhost:8002`  
API文档地址: `http://localhost:8002/docs`

#### 启动前端服务

```bash
cd frontend
npm run dev
```

前端服务默认运行在: `http://localhost:5173`

---

### 4. 开发流程

1. 确保MySQL数据库已启动
2. 创建数据库 `baoxinhuasheng`
3. 配置后端 `.env` 文件
4. 启动后端服务（会自动创建表结构）
5. 启动前端服务
6. 访问前端页面，注册账号
7. 登录系统，开始使用

---

### 5. 库存数据导入流程

1. 准备Excel文件（列名需与 `FIELD_MAPPING` 匹配）
2. 通过API `/api/restock/import` 上传文件
3. 系统自动解析并导入库存快照
4. 自动触发补货决策计算
5. 在前端查看导入结果和统计

---

## 开发指南

### 添加新的API路由

1. 在 `backend/routers/` 创建新路由文件
2. 在 `backend/main.py` 中注册路由: `app.include_router(new_router)`

### 添加新的数据模型

1. 在 `backend/models/` 创建新模型文件，继承 `BaseModel`
2. 在 `database/database.py` 的 `init_db()` 函数中导入模型
3. 模型会在启动时自动创建表

### 前端添加新页面

1. 在 `frontend/src/pages/` 创建新页面组件
2. 在 `App.tsx` 中添加路由配置

---

## 注意事项

1. **库存导入**: 目前库存数据通过Excel导入，Excel列名需与 `FIELD_MAPPING` 匹配
2. **租户ID**: 当前代码中部分地方硬编码 `tenant_id=1`，实际使用需改为动态获取
3. **LEAD_TIME**: 补货计算中的备货周期固定为100天，可根据实际业务调整
4. **定时任务**: 目前定时任务仅定义了框架，具体业务逻辑待实现
5. **数据库字符集**: 确保数据库使用 `utf8mb4` 字符集以支持emoji等特殊字符

---

## 后续开发建议

1. 完善库存检查定时任务的业务逻辑
2. 实现差评监控和AI分析功能
3. 完善飞书集成（预警推送）
4. 添加操作审计日志
5. 实现多租户数据隔离（当前硬编码为1）
6. 添加单元测试和集成测试
7. 完善前端用户权限管理
8. 添加数据导出功能
9. 实现库存预测和优化建议
10. 添加更多电商平台集成