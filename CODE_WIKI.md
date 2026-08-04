# 宝鑫华盛AI助手 - 跨境电商智能运营平台 · Code Wiki

## 1. 项目概述

宝鑫华盛AI助手是一个面向跨境电商卖家的智能运营平台，致力于通过AI技术提升电商团队的运营效率。项目涵盖了差评分析、库存管理、智能广告优化、仓储物流（WMS）、采购与权限管理等多个核心业务模块。

**核心功能模块：**
- **差评机器人 (Review Bot)**: 自动同步平台商品评论，利用AI分析差评的情感和核心问题，提供话术建议并支持按重要性分级（严重/中等/轻微）。
- **库存机器人 (Inventory Bot)**: 导入库存快照并支持API同步，AI计算日均销量（可配置权重公式），自动预警断货风险与冗余库存，生成补货决策。
- **广告机器人 (Ad Bot)**: 监控与分析广告活动(Campaign/AdGroup/Keyword/SearchTerm)，通过可配置规则(如ACOS过高、预算不足等)自动生成优化建议，并可生成执行日志。
- **仓储物流管理 (WMS)**: 涵盖完整的采购(Purchase)、入库(Inbound)、出库(Outbound)、挪货(Stock Transfer)、盘点(Inventory Count)与批次(Batch)管理。
- **AI聊天助手 (Chat Bot)**: 支持双模式AI对话（差评分析/库存分析），采用SSE流式响应，支持工具函数调用(Tool Calling)。
- **多租户与RBAC权限管理**: 基于租户(Tenant)进行数据隔离，支持部门-用户关联，细粒度的角色与权限(Role/Permission)控制。
- **数据看板 (Dashboard)**: 实时展现销售趋势、库存分布、预警概况及差评监控等。

---

## 2. 项目架构

项目采用前后端分离架构，前端使用 React 18 + Vite，后端使用 FastAPI + Python，通过 RESTful API 及 SSE(Server-Sent Events) 进行通信，数据库为 MySQL 8.0。

```text
┌─────────────────────────────────────────────────────────┐
│                    前端 React 18                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Ant Design│  │  Recharts │  │  SSE 流式 Chat       │  │
│  │  Pro 组件 │  │  图表库   │  │  (EventSource)       │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│                    Axios HTTP Client                    │
│         Auth Interceptor + Response Interceptor         │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP / SSE
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   后端 FastAPI                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Middleware: CORS / JWT 认证 / 权限控制           │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  Routers: auth, chat, reviews, inventory, ads,   │   │
│  │  inbound, outbound, purchase, permissions 等      │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  Services: auth, inventory(导入/计算/导出), chat, │   │
│  │  streaming, ads(规则引擎/AI分析), scheduler      │   │
│  ├──────────────────────────────────────────────────┤   │
│  │  Models: Tenant, User, Store, Product, Review,   │   │
│  │  Inventory, AdCampaign, PurchaseOrder, Batch 等   │   │
│  └──────────────────────────────────────────────────┘   │
│                       │                                 │
│                       ▼                                 │
│              MySQL 8.0 / SQLAlchemy 2.0                 │
└─────────────────────────────────────────────────────────┘
```

### 核心目录结构

```text
AIBXHS/
├── backend/                              # 后端 FastAPI 目录
│   ├── main.py                           # 应用入口，注册路由与中间件
│   ├── config.py                         # 配置管理（数据库、JWT、AI等）
│   ├── dependencies.py                   # 依赖注入（JWT认证、权限校验、DB Session）
│   ├── database/                         # 数据库连接与初始化
│   ├── models/                           # SQLAlchemy ORM 模型定义
│   ├── routers/                          # API 路由控制器
│   ├── schemas/                          # Pydantic 请求/响应数据模型
│   ├── services/                         # 核心业务逻辑与 AI 服务
│   │   ├── ad_rules/                     # 广告优化规则引擎
│   ├── scripts/                          # 数据迁移、测试与运维脚本
│   └── requirements.txt                  # 后端依赖清单
├── frontend/                             # 前端 React 目录
│   ├── index.html                        # HTML 入口
│   ├── vite.config.ts                    # Vite 构建配置
│   ├── package.json                      # 前端依赖清单
│   └── src/
│       ├── main.tsx & App.tsx            # React 入口与路由配置
│       ├── api.ts                        # Axios API 接口封装
│       ├── components/                   # 公共 UI 组件与 Layout
│       ├── contexts/                     # Auth、Theme 等全局状态
│       ├── hooks/                        # 自定义 Hooks（如 useStreamingChat）
│       └── pages/                        # 各业务功能页面
└── database/                             # 数据库 DDL 脚本与数据迁移备份
    ├── schema.sql                        # 完整表结构定义
    └── migrations/                       # 数据库版本迁移脚本
```

---

## 3. 技术栈与依赖关系

### 3.1 后端技术栈 (backend/requirements.txt)
- **Web框架**: `fastapi==0.109.0`, `uvicorn[standard]==0.27.0`
- **数据库**: `sqlalchemy==2.0.25` (ORM), `pymysql==1.1.0` (驱动)
- **数据验证与配置**: `pydantic==2.5.3`, `pydantic-settings==2.1.0`
- **认证与安全**: `python-jose[cryptography]==3.3.0` (JWT), `passlib[bcrypt]==1.7.4` (密码哈希)
- **AI大模型**: `openai==1.10.0` (AI SDK)
- **数据处理**: `pandas==2.2.0`, `openpyxl==3.1.2` (Excel处理)
- **定时任务**: `apscheduler==3.10.4`
- **网络请求**: `httpx==0.26.0`

### 3.2 前端技术栈 (frontend/package.json)
- **核心框架**: `react==18.2.0`, `react-dom==18.2.0`, `react-router-dom==6.22.0`
- **构建工具**: `vite==5.0.8`, `typescript==5.2.2`
- **UI 组件库**: `antd==5.12.0` (Ant Design)
- **图表与图标**: `recharts==2.10.3`, `lucide-react==0.300.0`
- **HTTP 客户端**: `axios==1.6.5`
- **日期处理**: `dayjs==1.11.10`

---

## 4. 数据库设计与核心模块职责

项目采用多租户(Tenant)设计，所有核心业务表均包含 `tenant_id` 字段以实现数据隔离。

### 4.1 组织架构与权限模块
- **模型**: `Tenant`, `User`, `Department`, `UserDepartment`, `Role`, `Permission`, `RolePermission`
- **职责**: 管理租户系统，处理用户的认证(JWT)和注册。基于角色的访问控制(RBAC)确保各操作员仅能访问授权的模块及数据。

### 4.2 基础资料模块 (店铺与商品)
- **模型**: `Store`, `Product`, `ProductBinding`
- **职责**: 管理多平台店铺信息及API密钥配置；管理商品基础信息(ASIN/SKU)；处理平台SKU与本地库存SKU的映射绑定。

### 4.3 仓储出入库模块 (WMS)
- **模型**: `Warehouse`, `InventoryBatch` (库存批次), `PurchaseOrder`, `InboundOrder`, `OutboundOrder`, `StockTransferOrder`, `OperationLog`
- **职责**: 实现标准化的仓储流转体系。支持采购单的生成与审批，采购入库生成批次，销售或调拨出库时按批次扣减库存，并记录所有出入库的操作日志。

### 4.4 广告机器人 (Ad Bot)
- **模型**: `AdCampaign`, `AdGroup`, `AdKeyword`, `AdTarget`, `AdProductAd`, `AdNegativeKeyword`
- **职责**: 接收和存储广告结构与表现数据。利用规则引擎(`services/ad_rules`)检测如"ACOS过高"、"预算利用率低"等问题并生成优化建议，并可执行调整竞价或预算的操作。

### 4.5 差评机器人 (Review Bot)
- **模型**: `Review`, `ReviewAnalysis`, `ReviewHandling`
- **职责**: 拉取商品评价数据，识别并过滤差评。使用 AI 分析差评情绪和主题，打标签并分级（high/medium/low），记录客服跟进处理的日志。

### 4.6 库存机器人 (Inventory Bot)
- **模型**: `InventoryRecord`, `InventoryAlert`, `InventorySnapshot`, `ReplenishmentDecision`, `LocalInventory`
- **职责**: 基于FBA库存快照，通过加权公式计算日均销量，结合安全库存参数预警断货与冗余。AI 辅助生成补货建议与数量计算。

---

## 5. 关键类与函数说明

### 5.1 后端 Services 层
- **`inventory_service.py`**:
  - `import_inventory_data()`: 极速导入 Excel 数据，通过 Pandas 清洗，根据 `business_settings` 里的公式计算日均销量，并生成 `InventorySnapshot`。
  - `get_overview()`: 汇总计算断货和冗余 Top 10 商品及库存健康度分布。
- **`chat_service.py`**:
  - `process_chat_message()`: 构建对话上下文，调用大语言模型。支持 Function Calling（如 `query_inventory_by_asin` 查库存，`get_review_analysis` 查差评），实现与业务数据的实时联动。
- **`streaming_service.py`**:
  - `generate_streaming_response()`: 采用异步生成器(async generator)，向前端返回 SSE 数据块（`start`, `content`, `done`），实现打字机效果。
- **`ad_rules/rule_engine.py`**:
  - `RuleEngine`: 广告规则引擎，循环评估所有激活的规则（如 `RuleAcosTooHigh`, `RuleCtrLow`），满足阈值时生成 `AdSuggestion`。

### 5.2 前端核心 Hooks 与 API
- **`useStreamingChat.ts`**:
  - 利用 `fetch` 和 `ReadableStream` 消费后端 SSE 接口。
  - 采用 `requestAnimationFrame` 节流渲染（~60ms），大幅降低高频消息带来的 React 渲染与 Markdown 解析性能开销。
- **`api.ts`**:
  - 统一封装 Axios 实例，内置请求拦截器自动注入 `Authorization: Bearer <token>`，响应拦截器统一处理 401 登出逻辑。

---

## 6. 项目运行方式

### 6.1 环境要求
- Python 3.10+
- Node.js 18+
- MySQL 8.0+

### 6.2 后端启动

```bash
# 1. 进入后端目录并安装依赖
cd backend
pip install -r requirements.txt

# 2. 配置环境变量（在 backend 目录下创建 .env 文件）
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/aibxhs?charset=utf8mb4
SECRET_KEY=your-secret-key-here
AI_API_KEY=your-ai-api-key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4-turbo # 或 qwen-turbo

# 3. 初始化数据库表结构 (自动执行 SQLAlchemy Base.metadata.create_all)
python -c "from database.database import init_db; init_db()"

# 4. 启动 FastAPI 服务
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 6.3 前端启动

```bash
# 1. 进入前端目录并安装依赖
cd frontend
npm install

# 2. 启动开发服务器 (Vite 默认在 5173 端口)
npm run dev

# 3. 生产环境构建
npm run build
```

> **注意**：前端的 API 请求通过 Vite 代理（在 `vite.config.ts` 中配置）转发至后端的 `http://localhost:8000`，确保前后端服务同时运行。

---
*文档生成于：2026-07-02*
