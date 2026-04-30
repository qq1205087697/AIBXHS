# 宝鑫华盛AI助手

基于 AI 的跨境电商智能运营平台，提供库存管理、差评监控、智能调价等功能。

## 🚀 功能特性

### 1. 数据接入层
- 私有数据源对接
- 数据清洗与入库

### 2. AI 决策层
- 支持豆包、Qwen、Llama 等通用大模型
- 业务规则微调与提示词工程
- 否词、调价、差评分析、库存预警、竞品监控

### 3. 智能执行层
- 定时任务自动触发
- 亚马逊 API 自动调用
- 操作可回溯、可中断、防误操作

### 4. SaaS 商用层
- 多租户、账号权限隔离
- 店铺管理、计费套餐
- 后台控制台 + 数据看板

## 🤖 核心机器人

### 供应链先知 - 库存机器人
- 全天候库存监控
- 断货预警与调价/降广告建议
- 冗余预警与智能清仓促销策略

### 品牌声誉哨兵 - 差评机器人
- 全 ASIN 评论实时追踪
- 新增差评及时锁定预警
- AI 自动翻译并提炼核心诉求

## 🛠️ 技术栈

### 前端
- React 18 + TypeScript
- Vite
- Ant Design
- Recharts
- React Router

### 后端
- Node.js + Express
- TypeScript
- MongoDB
- node-cron

## 📦 项目结构

```
cross-border-ecommerce-ai/
├── frontend/           # 前端项目
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── main.tsx
│   └── package.json
├── backend/            # 后端项目
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   └── index.ts
│   └── package.json
└── package.json
```

## 🏃 快速开始

### 安装依赖

```bash
npm run install:all
```

### 开发模式

```bash
npm run dev
```

分别启动前端和后端：

```bash
# 启动后端 (端口 8000)
npm run dev:backend

# 启动前端 (端口 3000)
npm run dev:frontend
```

### 构建项目

```bash
npm run build
```

## 📊 页面预览

- `/` - 数据看板
- `/inventory` - 库存机器人
- `/review` - 差评机器人

## 🔧 配置

在 `backend/.env` 中配置：

```env
PORT=8000
MONGODB_URI=mongodb://localhost:27017/cross_border_ecommerce
OPENAI_API_KEY=your_api_key
AMAZON_ACCESS_KEY=your_amazon_access_key
AMAZON_SECRET_KEY=your_amazon_secret_key
```

## 📝 License

MIT
