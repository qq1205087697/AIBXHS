-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: localhost    Database: baoxinhuasheng
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `conversation_history`
--

DROP TABLE IF EXISTS `conversation_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversation_history` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `user_id` int NOT NULL,
  `session_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID',
  `role` enum('USER','ASSISTANT','SYSTEM','FUNCTION') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '内容',
  `function_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '函数名称',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_conversation_history_session_id` (`session_id`),
  KEY `ix_conversation_history_id` (`id`),
  KEY `idx_conversation_user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `conversation_history`
--

LOCK TABLES `conversation_history` WRITE;
/*!40000 ALTER TABLE `conversation_history` DISABLE KEYS */;
INSERT INTO `conversation_history` VALUES (30,3,'20d87434-e07c-44c4-9cbd-d063860364fd','USER','分析最近的差评核心问题',NULL,'2026-04-28 14:26:17','2026-04-28 14:26:17',NULL),(31,3,'3b787484-bfa7-4b89-85e9-dfa79d9af452','USER','分析最近的差评核心问题',NULL,'2026-04-28 14:29:31','2026-04-28 14:29:31',NULL),(32,3,'32dae578-e428-4494-926d-fdeaca9e5086','USER','分析最近的差评核心问题',NULL,'2026-04-28 14:31:15','2026-04-28 14:31:15',NULL),(33,3,'32dae578-e428-4494-926d-fdeaca9e5086','ASSISTANT','由于您没有提供具体的差评内容，我无法直接分析核心问题。请提供以下信息：\n\n1. **产品类型**（例如：蓝牙耳机、厨房工具、服饰等）\n2. **差评原文**（尽量完整，包括标题和内容）\n3. **站点**（如美国、英国、德国等）\n\n如果您能提供具体差评，我将用Markdown格式为您：\n- 提炼**核心诉求**（质量、尺寸、功能、物流等）\n- 分析**痛点根源**（设计缺陷、描述不符、包装不足等）\n- 给出**可执行改进建议**（产品调整、包装优化、Listing修改等）\n\n请补充信息，谢谢！',NULL,'2026-04-28 14:31:37','2026-04-28 14:31:37',NULL),(34,3,'32dae578-e428-4494-926d-fdeaca9e5086','USER','帮我看看这周的差评',NULL,'2026-04-28 14:32:04','2026-04-28 14:32:04',NULL),(35,3,'32dae578-e428-4494-926d-fdeaca9e5086','ASSISTANT','感谢您希望我分析“这周的差评”。不过，目前我还没有收到任何具体的差评内容。为了给您提供准确、有价值的分析，请您**直接粘贴本周出现的差评原文**（包括标题、评价星数、详细内容，以及产品类型和站点）。\n\n如果您不方便提供原文，也可以描述一下差评**集中反馈的问题**（例如：尺寸偏小、电池不耐用、包装破损、颜色与图片不一致等）。\n\n作为参考，我为您提供一个**差评分析模板**，您可以对照看看是否有匹配的痛点：\n\n---\n\n## 常见差评分类与核心痛点（自查清单）\n\n- **产品质量问题**\n  - 功能故障/不工作（如电子设备无法开机、连接不稳定）\n  - 材料脆弱/易损坏（如塑料件断裂、布料脱线）\n  - 使用寿命短（如电池续航远低于描述）\n\n- **产品与描述不符**\n  - 尺寸/颜色/材质与图片或文字说明有差异\n  - 功能缺失（如宣称防水但不防水）\n  - 配件不齐或与描述不符\n\n- **包装与物流问题**\n  - 包装简陋导致产品受损（如液体泄漏、屏幕碎裂）\n  - 物流速度慢/送达时间超出预期\n  - 包装内缺少说明书或安装工具\n\n- **使用体验不佳**\n  - 操作复杂/安装困难\n  - 清洁困难（如缝隙易积垢）\n  - 噪声大/发热严重/有异味\n\n- **客服与售后问题**\n  - 客户对退款/换货流程不满\n  - 客服响应慢或态度差\n  - 未按承诺提供保修或配件更换\n\n---\n\n请您提供具体差评，我将为您：\n1. ✅ 提炼**核心诉求**（画关键词）\n2. 🔍 分析**痛点根源**（设计缺陷？描述误导？包装不足？）\n3. 🛠 给出**三项针对性改进建议**（产品、包装、运营/Listing优化）\n\n期待您补充信息！',NULL,'2026-04-28 14:32:17','2026-04-28 14:32:17',NULL),(36,3,'c143ceba-9974-4a6e-81a6-b0d0b7d7da8e','USER','帮我看看这周的差评',NULL,'2026-04-28 14:35:11','2026-04-28 14:35:11',NULL),(37,3,'c143ceba-9974-4a6e-81a6-b0d0b7d7da8e','ASSISTANT','## 差评分析请求\n\n您好！感谢您让我协助分析本周的差评。我理解您希望快速了解差评中的核心问题，并得到可落地的改进建议。\n\n**不过，目前我还没有看到任何差评的具体内容。** 要开展有效分析，我需要您提供差评文本（例如客户评论的原文或截图中的文字）。您可以：\n\n- 复制粘贴差评内容（中英文均可）\n- 描述差评中客户抱怨的关键点（如“产品尺寸不对”、“包装破损”、“功能故障”等）\n- 如果有多条差评，可以逐条提供或汇总列表\n\n收到差评后，我会按照以下流程处理：\n\n1. **理解差评**：定位客户不满的核心点（质量、物流、使用体验、描述不符等）\n2. **提炼核心诉求**：概括客户真正期望的改善方向（如“希望材质更坚固”、“希望包装有保护措施”）\n3. **提出改进建议**：从 **产品**（材质、设计、工艺）、**包装**（防护、标识、环保）、**运营**（Listing优化、客服话术、发货流程）三个维度给出具体、可执行的建议\n\n**请提供差评内容，我将立即为您生成定制分析报告。**',NULL,'2026-04-28 14:35:25','2026-04-28 14:35:25',NULL),(38,3,'dd635495-3c80-4f8f-b03a-2dd5304ee43e','USER','帮我看看店铺所有差评',NULL,'2026-04-28 14:36:17','2026-04-28 14:36:17',NULL),(39,3,'dd635495-3c80-4f8f-b03a-2dd5304ee43e','ASSISTANT','# 您好！我来帮您分析店铺差评\n\n我完全理解您希望系统梳理所有差评，找到问题根源并优化产品与运营。但由于**我无法直接访问您的亚马逊店铺或卖家后台**，请您先按以下步骤获取差评内容，然后粘贴给我，我会逐条分析核心诉求并给出具体的改进建议（产品、包装、运营三个维度）。\n\n---\n\n## 🔍 如何获取差评内容\n\n请通过以下渠道导出或复制差评文本：\n\n- **卖家中心商品评论**：  \n  路径：品牌 → 商品评论 → 筛选 1‑3 星评论，复制标题和内容。\n- **买家反馈（Feedback）**：  \n  路径：订单 → 反馈 → 查看负面反馈，注意区分店铺反馈与商品评论。\n- **第三方工具导出**：  \n  如 Helium 10、Keepa、Sellerboard 等，可批量导出评论 CSV。\n\n如果您有多个 ASIN，建议按 ASIN 分类整理；英文评论请保留原文（我会一并分析）。\n\n---\n\n## 📊 我如何分析每条差评\n\n拿到差评后，我会从三个核心层面进行拆解：\n\n| 层面 | 分析重点 |\n|------|----------|\n| **产品** | 功能缺陷、材质/做工问题、尺寸不符、使用寿命、使用效果未达预期 |\n| **包装** | 运输破损、包装内缺少配件、包装信息不清晰（无说明书/图示错误） |\n| **运营** | 夸大宣传（图片/描述与实物不符）、Listing 误导、客服响应不及时、退货流程复杂 |\n\n最终输出的建议会**具体可执行**，例如：更换电池供应商、增加泡沫隔板、修改主图角度的措辞、更新 Q&A 等。\n\n---\n\n## 📝 举例说明（假设差评）\n\n> “收到后第一次用就没电了，充了一晚上也只用了半小时，说明书完全看不懂。”\n\n- **核心诉求**：电池续航严重不足，充电指示不明确，说明书易用性差。\n- **产品建议**：更换高容量电芯或优化电源管理电路；增加电量指示灯。\n- **包装建议**：在包内附一张快速启动卡（图文步骤），说明书用对比色标出重点。\n- **运营建议**：Listing 中明确标注“首次使用请充满4小时”，减少误解。\n\n---\n\n## ➡️ 下一步\n\n请直接在此粘贴您的一条或多条差评（中英文均可）。如果数量较多，建议先发最近 10 条，我会优先处理，并告诉您哪些是高频共性问题。\n\n我会立刻按照上述框架为您输出分析。期待您的差评内容！',NULL,'2026-04-28 14:36:45','2026-04-28 14:36:45',NULL),(40,3,'1904ad0f-018b-491a-93c2-5cd0c714995e','USER','看看所有差评',NULL,'2026-04-28 14:39:54','2026-04-28 14:39:54',NULL),(41,3,'1904ad0f-018b-491a-93c2-5cd0c714995e','ASSISTANT','## 差评分析\n\n在 2026-01-28 至 2026-04-28 期间，共收到 **3 条差评**（评分 1‑3 星），涉及 3 款产品。以下逐条列出差评内容，提炼核心诉求，并给出具体改进建议。\n\n### 📋 差评列表\n\n| 产品 ID | 评分 | 标题 / 摘要 | 日期 |\n|--------|------|------------|------|\n| 1 | ⭐⭐ | Battery life is terrible – 音质不错，但电池仅续航 2 小时 | 2026-04-22 |\n| 2 | ⭐ | Terrible product – 使用 3 天后损坏，材质廉价 | 2026-04-21 |\n| 3 | ⭐⭐⭐ | Heart rate monitor not accurate – 手环整体尚可，但心率监测不准 | 2026-04-20 |\n\n### 🔍 核心诉求分析\n\n1. **产品 1（耳机/音响类）**：电池续航严重不足（标称或未达标），用户期望在音质好的前提下能维持更长时间使用。\n2. **产品 2（未知，可能是日用品/小型电子）**：质量低劣，短期内即损坏，材料质感差，用户对可靠性极度不满。\n3. **产品 3（运动手环）**：心率监测功能精度不达标，用户对健康数据的准确性有较高要求。\n\n**共性**：均为 **功能性能未达到用户预期**，尤其是基础体验（续航、耐用性、准确性）存在明显短板。\n\n### 💡 改进建议\n\n#### 针对产品 1（电池续航）\n\n- **硬件优化**：提升电池容量或选用更高能量密度的电池；加强电源管理芯片设计，降低待机与运行功耗。\n- **软件/固件**：通过固件更新优化功耗策略（如自动休眠、自适应音量）；在配套 App 中增加“省电模式”选项。\n- **包装/说明**：在包装或说明书上用醒目字体标注实际续航时间（例如“约 2 小时”），避免用户期望过高。\n\n#### 针对产品 2（产品质量）\n\n- **质检升级**：增加出货前全检或抽检比例，重点检查易损部位（如接口、外壳结合处）；采用更耐用的 ABS/PC 混合材料或金属加固件。\n- **供应商管理**：更换或审核原材料供应商，确保来料质量符合标准；建立售后追踪机制，对早期损坏案例进行 root cause 分析。\n- **包装保护**：增加缓冲材料（如珍珠棉、泡沫模具），防止运输冲击导致损坏。\n\n#### 针对产品 3（心率监测不准）\n\n- **传感器选型**：采用更高精度的 PPG 传感器模块，或增加算法校准传感器（如光电二极管数量、发光波长优化）。\n- **算法优化**：升级心率算法，引入运动干扰滤波、异常值剔除机制；可通过固件 OTA 推送改进。\n- **用户引导**：在 App 或说明书中明确佩戴方式（松紧度、位置），并提示在剧烈运动时可能存在误差，降低预期。\n\n#### 运营 / 客服层面（通用建议）\n\n- **主动收集反馈**：对 3 星及以下评价进行回访，了解具体问题，提供补发、折扣或换货，争取修改/删除差评。\n- **产品迭代**：将用户提及的痛点纳入下一代产品开发优先级，例如产品 1 推出大电池版本，产品 2 推出加强版，产品 3 更新固件并宣传精准度升级。\n- **描述修正**：检查所有在售 listing，确保功能和性能描述不过于夸张，避免因预期不符产生差评。\n\n---\n\n如果用户需要针对某个具体产品进一步深挖，或需要更多数据支撑（如退货率、客服反馈），请随时告知。',NULL,'2026-04-28 14:40:16','2026-04-28 14:40:16',NULL),(42,3,'1904ad0f-018b-491a-93c2-5cd0c714995e','USER','只看这周的',NULL,'2026-04-28 14:46:15','2026-04-28 14:46:15',NULL),(43,3,'1904ad0f-018b-491a-93c2-5cd0c714995e','ASSISTANT','## “这周”差评情况\n\n根据您的要求，我将时间段调整为 **2026‑04‑27 至 2026‑04‑28**（本周一至今天，因为当前是 2026‑04‑28，本周数据仅包含这两天）。\n\n对比现有差评数据（最近三条日期分别为 2026‑04‑22、2026‑04‑21、2026‑04‑20），**这周没有收到任何新差评**。以下是具体排查：\n\n| 产品 ID | 评分 | 日期 | 是否在本周 |\n|--------|------|------|------------|\n| 1 | ⭐⭐ | 2026‑04‑22 | ❌ |\n| 2 | ⭐ | 2026‑04‑21 | ❌ |\n| 3 | ⭐⭐⭐ | 2026‑04‑20 | ❌ |\n\n### 📌 说明\n- 本周（2026‑04‑27 至 2026‑04‑28）未产生 1‑3 星评价。\n- 若您需要查看其他时间段的差评（如“上周”“本月”），或希望分析总体差评趋势，请随时告知。\n\n如果您怀疑系统漏抓了差评，建议：\n1. 在卖家后台核对“评价”页，确认是否超过 48 小时未同步；\n2. 检查是否有被系统屏蔽的虚假刷评或自动翻译不完整的评价；\n3. 如果确实无差评，则说明近期产品和服务表现稳定，但仍可主动监控高评分 3 星评价（易转为差评）并提前干预。\n\n是否需要我进一步查看 **上周（2026‑04‑20 ~ 2026‑04‑26）** 的差评详情，或对已有差评进行更深入的分析？',NULL,'2026-04-28 14:46:28','2026-04-28 14:46:28',NULL),(44,3,'1904ad0f-018b-491a-93c2-5cd0c714995e','USER','7天内',NULL,'2026-04-28 14:47:03','2026-04-28 14:47:03',NULL),(45,3,'1904ad0f-018b-491a-93c2-5cd0c714995e','ASSISTANT','## 📅 7天内（2026-04-22 ~ 2026-04-28）差评分析\n\n根据差评数据，此时间段内仅收到 **1 条差评**（评分 ≤ 3 星），详情如下：\n\n| 产品 ID | 评分 | 标题 | 日期 |\n|--------|------|------|------|\n| 1 | ⭐⭐ | **Battery life is terrible** – 音质不错，但电池只能续航 2 小时 | 2026-04-22 |\n\n### 🔍 核心诉求分析\n\n- **核心痛点**：电池续航严重低于用户预期。用户明确提到“音质不错”，说明对产品其他性能基本满意，但 **基础续航能力**（2 小时）无法满足日常使用需求（通常无线耳机/音箱需≥5‑8 小时）。\n- **潜在影响**：此类差评会直接影响产品星级，并可能让潜在买家认为“续航是硬伤”，降低购买意愿。\n\n### 💡 改进建议\n\n#### 针对产品 1（推测为蓝牙耳机/便携音箱）\n\n**1. 硬件优化（下一代或现有批次改进）**\n- **电池升级**：选用更大容量电芯（如从 50mAh 提升至 80‑100mAh），或采用更高效的锂聚合物电池。\n- **电源管理芯片**：选用低功耗蓝牙 SoC（如 QCC 系列，支持 aptX Adaptive 低功耗模式）。\n- **充电方案**：支持快充（充电 10 分钟使用 1 小时），缓解续航焦虑。\n\n**2. 固件 / 软件层面（可 OTA）**\n- **增加省电模式**：在配套 App 中加入“低功耗模式”，限制音量上限或关闭部分音效算法。\n- **自适应省电**：当检测到长时间无播放活动时，自动进入深度休眠，减少待机耗电。\n\n**3. 包装 / 描述修正**\n- **明确标注续航时间**：在产品主图、标题、详情页及包装上使用醒目字体标注实际续航（例如“约 2 小时连续播放”），避免用户产生过高预期。\n- **增加使用提示**：在说明书或 App 引导中提示“限制音量在 70% 以下可延长使用时间”等。\n\n**4. 售后服务与挽回**\n- **主动联系该用户**：提供歉意并赠送充电仓、延长保修或换新，争取修改差评。\n- **收集更多反馈**：对同一批次用户进行邮件回访，确认是否为电池批次不良，及时召回。\n\n### 📊 其他说明\n\n- 其余两条差评（2026-04-21、2026-04-20）已超出 7 天范围，如需针对它们进行单独分析，请告知。\n- 鉴于本周（2026-04-27 ~ 2026-04-28）尚未新增差评，说明近期产品质量和体验相对稳定。但仍建议 **持续监控此款产品的电池相关 3 星及 2 星评价**，预防问题扩散。\n\n如果需要我进一步分析产品 1 的 **评论量趋势**、**同类产品竞品对比**，或协助起草客户回复话术，请随时说明。',NULL,'2026-04-28 14:47:21','2026-04-28 14:47:21',NULL),(46,3,'c54fce1d-5c65-4a5d-94bd-f06d14ae497b','USER','最近一年的差评主要是哪些asin',NULL,'2026-04-28 15:15:45','2026-04-28 15:15:45',NULL),(47,3,'c54fce1d-5c65-4a5d-94bd-f06d14ae497b','ASSISTANT','## 关于 ASIN 的分析\n\n您询问“最近一年的差评主要是哪些 ASIN”，但提供的 3 条差评数据中 **`asin` 字段均为空**，因此无法直接定位到具体的商品编码。若需准确判断，请补充完整的 ASIN 信息。\n\n不过，从差评内容可以推测涉及的产品类型：\n1. **电池续航问题** → 类似蓝牙耳机、无线音箱等便携音频设备  \n2. **使用数天后损坏** → 材质廉价，可能为低价电子产品或日用快消品  \n3. **心率监测不准** → 智能手环/手表类可穿戴设备  \n\n如需进一步分析，建议提供每条差评对应的真实 ASIN，以便统计哪些商品集中收到差评。\n\n---\n\n## 差评核心诉求分析\n\n基于 3 条差评内容，提炼出以下核心诉求：\n\n### 1. 电池续航严重不足（差评 1）\n- **差评标题**：Battery life is terrible  \n- **内容关键句**：_Only lasts 2 hours when fully charged_  \n- **诉求点**：宣传或预期续航与实际严重不符，用户在音质尚可的前提下仍给出 2 星，说明续航是首要痛点。\n\n### 2. 产品耐用性差、材质低劣（差评 2）\n- **差评标题**：Terrible product  \n- **内容关键句**：_broke after 3 days, material is very cheap_  \n- **诉求点**：开箱后短时间内即损坏，且用户明确指材质廉价，对产品质量和可靠性极度不满。\n\n### 3. 核心功能（心率监测）不准确（差评 3）\n- **差评标题**：Heart rate monitor not accurate  \n- **内容关键句**：_heart rate monitor is not accurate_  \n- **诉求点**：主要卖点（心率）失效，导致用户仅评 3 星，表明对该功能的不信任，且可能影响整体使用价值。\n\n---\n\n## 产品、包装或运营改进建议\n\n### 🔹 针对电池续航问题\n- **产品**：  \n  - 重新标定真实续航时间，或在说明书、商品页明确“正常使用下 2 小时”（若为真实数据），避免夸大宣传。  \n  - 优化电池容量或电源管理芯片，如增加电池体积、采用低功耗蓝牙协议。  \n  - 加入低电量提醒或自动关机功能，提升用户体验。\n- **包装**：在包装显著位置印上实际续航时长（含测试条件），并附上快速充电说明。\n- **运营**：主动联系差评用户提供补偿（如赠送充电仓或延长质保），同时修改 Listing 中不实续航描述。\n\n### 🔹 针对耐用性差、材质廉价\n- **产品**：  \n  - 替换关键结构件为更耐用的材料（如加厚塑料或金属），提升抗跌落、抗弯折能力。  \n  - 增加老化测试、跌落测试标准，确保产品至少能承受正常使用 1 个月以上。  \n  - 考虑加固易损部位（如转轴、卡扣）。\n- **包装**：加入防震泡沫或固定支架，减少运输中的冲击；包装内附“使用与保养小贴士”，避免因操作不当导致损坏。\n- **运营**：  \n  - 对该差评回复并提供免费换新，展现售后诚意。  \n  - 将差评作为质检反馈批次，排查同一批次或供应商的来料问题。\n\n### 🔹 针对心率监测不准确\n- **产品**：  \n  - 检查并升级心率传感器模组，或改进算法（如增加 PPG 信号滤波、校准机制）。  \n  - 在说明书中明确心率的实测条件（如佩戴位置、静止/运动状态），避免用户误解。  \n  - 增加提示：若发现数据异常，建议用专业设备比对，并开放手动校准功能。\n- **包装**：附一张“准确使用指南”卡片，图文并茂说明最佳佩戴位置和注意事项。\n- **运营**：  \n  - 主动跟进该差评用户，提供固件更新帮助（若有 OTA 功能）或一对一指导。  \n  - 在商品 Q&A 或详情页加入心率准确性的常见问题说明，降低后续类似差评率。  \n\n---\n\n以上建议结合了差评中的具体诉求与当前日期（2026-04-28），请根据实际供应链能力与产品迭代计划选择性落地。如需进一步分析或需要补充 ASIN 数据的处理方案，请随时告知。',NULL,'2026-04-28 15:16:21','2026-04-28 15:16:21',NULL);
/*!40000 ALTER TABLE `conversation_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `departments`
--

DROP TABLE IF EXISTS `departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departments` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '部门ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '部门名称',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '部门描述',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_departments_id` (`id`),
  KEY `ix_departments_tenant_id` (`tenant_id`),
  CONSTRAINT `departments_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `departments`
--

LOCK TABLES `departments` WRITE;
/*!40000 ALTER TABLE `departments` DISABLE KEYS */;
/*!40000 ALTER TABLE `departments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inbound_orders`
--

DROP TABLE IF EXISTS `inbound_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inbound_orders` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '入库订单ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `order_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '入库单号',
  `purchase_order_id` int DEFAULT NULL COMMENT '关联采购单ID',
  `inbound_type` enum('PURCHASE','RETURN','TRANSFER','ADJUSTMENT','OTHER') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '入库类型',
  `warehouse` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收货仓库',
  `handler` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '经办人',
  `inbound_date` date DEFAULT NULL COMMENT '入库日期',
  `total_quantity` int NOT NULL COMMENT '入库总数量',
  `total_amount` decimal(12,2) DEFAULT NULL COMMENT '入库总金额',
  `status` enum('DRAFT','CONFIRMED','CANCELLED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `notes` text COLLATE utf8mb4_unicode_ci COMMENT '备注',
  `created_by` int DEFAULT NULL COMMENT '创建人',
  `confirmed_by` int DEFAULT NULL COMMENT '确认人',
  `confirmed_at` datetime DEFAULT NULL COMMENT '确认时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `confirmed_by` (`confirmed_by`),
  KEY `ix_inbound_orders_purchase_order_id` (`purchase_order_id`),
  KEY `ix_inbound_orders_tenant_id` (`tenant_id`),
  KEY `ix_inbound_orders_id` (`id`),
  CONSTRAINT `inbound_orders_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `inbound_orders_ibfk_2` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `inbound_orders_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `inbound_orders_ibfk_4` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inbound_orders`
--

LOCK TABLES `inbound_orders` WRITE;
/*!40000 ALTER TABLE `inbound_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `inbound_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory_actions`
--

DROP TABLE IF EXISTS `inventory_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_actions` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '操作ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `product_id` int NOT NULL COMMENT '商品ID',
  `store_id` int NOT NULL COMMENT '店铺ID',
  `alert_id` int DEFAULT NULL COMMENT '关联预警ID',
  `action_type` enum('PRICE_ADJUST','AD_BUDGET','PROMOTION','RESTOCK','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型',
  `action_title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作标题',
  `action_details` json DEFAULT NULL COMMENT '操作详情',
  `status` enum('PENDING','EXECUTING','SUCCESS','FAILED','CANCELLED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行状态',
  `triggered_by` enum('SYSTEM_AUTO','MANUAL','SCHEDULE') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '触发方式',
  `result` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行结果',
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '错误信息',
  `executed_by` int DEFAULT NULL COMMENT '执行人',
  `executed_at` datetime DEFAULT NULL COMMENT '执行时间',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `executed_by` (`executed_by`),
  KEY `ix_inventory_actions_id` (`id`),
  KEY `ix_inventory_actions_store_id` (`store_id`),
  KEY `ix_inventory_actions_status` (`status`),
  KEY `ix_inventory_actions_tenant_id` (`tenant_id`),
  KEY `ix_inventory_actions_alert_id` (`alert_id`),
  KEY `ix_inventory_actions_product_id` (`product_id`),
  CONSTRAINT `inventory_actions_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `inventory_actions_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `inventory_actions_ibfk_3` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`),
  CONSTRAINT `inventory_actions_ibfk_4` FOREIGN KEY (`alert_id`) REFERENCES `inventory_alerts` (`id`),
  CONSTRAINT `inventory_actions_ibfk_5` FOREIGN KEY (`executed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory_actions`
--

LOCK TABLES `inventory_actions` WRITE;
/*!40000 ALTER TABLE `inventory_actions` DISABLE KEYS */;
/*!40000 ALTER TABLE `inventory_actions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory_alerts`
--

DROP TABLE IF EXISTS `inventory_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_alerts` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '预警ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `product_id` int NOT NULL COMMENT '商品ID',
  `store_id` int NOT NULL COMMENT '店铺ID',
  `alert_type` enum('LOW_STOCK','OUT_OF_STOCK','OVERSTOCK','PRICE_CHANGE') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '预警类型',
  `severity` enum('INFO','WARNING','DANGER','CRITICAL') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '严重程度',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '预警标题',
  `description` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '预警描述',
  `current_stock` int DEFAULT NULL COMMENT '当前库存',
  `safe_stock` int DEFAULT NULL COMMENT '安全库存',
  `suggestions` json DEFAULT NULL COMMENT 'AI建议',
  `status` enum('NEW','ACKNOWLEDGED','PROCESSING','RESOLVED','DISMISSED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '处理状态',
  `priority` int DEFAULT NULL COMMENT '优先级(1-10)',
  `resolved_by` int DEFAULT NULL COMMENT '处理人',
  `resolved_at` datetime DEFAULT NULL COMMENT '处理时间',
  `resolved_note` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '处理备注',
  `feishu_record_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '飞书记录ID',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `resolved_by` (`resolved_by`),
  KEY `ix_inventory_alerts_status` (`status`),
  KEY `ix_inventory_alerts_alert_type` (`alert_type`),
  KEY `ix_inventory_alerts_product_id` (`product_id`),
  KEY `ix_inventory_alerts_tenant_id` (`tenant_id`),
  KEY `ix_inventory_alerts_store_id` (`store_id`),
  KEY `ix_inventory_alerts_id` (`id`),
  CONSTRAINT `inventory_alerts_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `inventory_alerts_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `inventory_alerts_ibfk_3` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`),
  CONSTRAINT `inventory_alerts_ibfk_4` FOREIGN KEY (`resolved_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory_alerts`
--

LOCK TABLES `inventory_alerts` WRITE;
/*!40000 ALTER TABLE `inventory_alerts` DISABLE KEYS */;
INSERT INTO `inventory_alerts` VALUES (1,1,1,1,'LOW_STOCK','DANGER','库存告急','无线蓝牙耳机 Pro Max 库存即将告罄',12,50,'{\"suggestion\": \"建议立即补货，并临时提高售价20%，同时降低广告预算30%以减少订单量。\", \"daysRemaining\": 5}','NEW',9,NULL,NULL,NULL,NULL,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(2,1,2,1,'OVERSTOCK','WARNING','库存积压','手机壳套装 透明款 库存积压严重',580,200,'{\"suggestion\": \"库存积压严重！建议：1. 打8折促销；2. 绑定爆款做买一送一；3. 报名LD秒杀活动。\", \"daysRemaining\": 90}','NEW',7,NULL,NULL,NULL,NULL,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(3,1,3,1,'LOW_STOCK','DANGER','库存告急','智能运动手环 黑色 库存即将告罄',42,100,'{\"suggestion\": \"库存即将告罄！建议紧急空运补货，并适当提价15%。\", \"daysRemaining\": 8}','NEW',8,NULL,NULL,NULL,NULL,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL);
/*!40000 ALTER TABLE `inventory_alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory_records`
--

DROP TABLE IF EXISTS `inventory_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_records` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `product_id` int NOT NULL COMMENT '商品ID',
  `store_id` int NOT NULL COMMENT '店铺ID',
  `warehouse_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '仓库编码',
  `quantity` int NOT NULL COMMENT '当前库存',
  `quantity_in_transit` int DEFAULT NULL COMMENT '在途库存',
  `quantity_available` int NOT NULL COMMENT '可用库存',
  `quantity_reserved` int DEFAULT NULL COMMENT '预留库存',
  `safe_stock` int DEFAULT NULL COMMENT '安全库存',
  `daily_sales` int DEFAULT NULL COMMENT '日均销量',
  `days_remaining` int DEFAULT NULL COMMENT '可售天数',
  `record_date` date NOT NULL COMMENT '记录日期',
  `source` enum('MANUAL','API_SYNC','IMPORT') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '数据来源',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_inventory_records_store_id` (`store_id`),
  KEY `ix_inventory_records_tenant_id` (`tenant_id`),
  KEY `ix_inventory_records_product_id` (`product_id`),
  KEY `ix_inventory_records_id` (`id`),
  KEY `ix_inventory_records_record_date` (`record_date`),
  CONSTRAINT `inventory_records_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `inventory_records_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `inventory_records_ibfk_3` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory_records`
--

LOCK TABLES `inventory_records` WRITE;
/*!40000 ALTER TABLE `inventory_records` DISABLE KEYS */;
INSERT INTO `inventory_records` VALUES (1,1,1,1,NULL,12,0,12,0,50,2,5,'2026-04-23','API_SYNC','2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(2,1,2,1,NULL,580,0,580,0,200,6,90,'2026-04-23','API_SYNC','2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(3,1,3,1,NULL,42,0,42,0,100,5,8,'2026-04-23','API_SYNC','2026-04-23 18:28:22','2026-04-23 18:28:22',NULL);
/*!40000 ALTER TABLE `inventory_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `operation_logs`
--

DROP TABLE IF EXISTS `operation_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `operation_logs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `user_id` int DEFAULT NULL COMMENT '操作用户ID',
  `username` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作用户名',
  `module` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作模块',
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型',
  `target_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标类型',
  `target_id` int DEFAULT NULL COMMENT '目标ID',
  `target_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标名称',
  `before_data` json DEFAULT NULL COMMENT '操作前数据',
  `after_data` json DEFAULT NULL COMMENT '操作后数据',
  `summary` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作摘要',
  `ip_address` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'IP地址',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `ix_operation_logs_tenant_id` (`tenant_id`),
  KEY `ix_operation_logs_id` (`id`),
  CONSTRAINT `operation_logs_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `operation_logs_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `operation_logs`
--

LOCK TABLES `operation_logs` WRITE;
/*!40000 ALTER TABLE `operation_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `operation_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `outbound_orders`
--

DROP TABLE IF EXISTS `outbound_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outbound_orders` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '出库订单ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `order_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '出库单号',
  `outbound_type` enum('SALE','RETURN_SUPPLIER','TRANSFER','SCRAP','ADJUSTMENT','OTHER') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '出库类型',
  `warehouse` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发货仓库',
  `handler` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '经办人',
  `outbound_date` date DEFAULT NULL COMMENT '出库日期',
  `total_quantity` int NOT NULL COMMENT '出库总数量',
  `total_amount` decimal(12,2) DEFAULT NULL COMMENT '出库总金额',
  `status` enum('DRAFT','CONFIRMED','CANCELLED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `notes` text COLLATE utf8mb4_unicode_ci COMMENT '备注',
  `created_by` int DEFAULT NULL COMMENT '创建人',
  `confirmed_by` int DEFAULT NULL COMMENT '确认人',
  `confirmed_at` datetime DEFAULT NULL COMMENT '确认时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `confirmed_by` (`confirmed_by`),
  KEY `ix_outbound_orders_id` (`id`),
  KEY `ix_outbound_orders_tenant_id` (`tenant_id`),
  CONSTRAINT `outbound_orders_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `outbound_orders_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `outbound_orders_ibfk_3` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `outbound_orders`
--

LOCK TABLES `outbound_orders` WRITE;
/*!40000 ALTER TABLE `outbound_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `outbound_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '商品ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `store_id` int NOT NULL COMMENT '店铺ID',
  `asin` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ASIN/商品编码',
  `sku` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SKU',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品名称',
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '英文名称',
  `image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品图片',
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品分类',
  `brand` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '品牌',
  `price` decimal(12,2) DEFAULT NULL COMMENT '售价',
  `cost_price` decimal(12,2) DEFAULT NULL COMMENT '成本价',
  `status` enum('ACTIVE','INACTIVE','ARCHIVED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `is_robot_monitored` tinyint(1) DEFAULT NULL COMMENT '是否机器人监控',
  `config` json DEFAULT NULL COMMENT '商品配置(安全库存等)',
  `created_by` int DEFAULT NULL COMMENT '创建人',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `ix_products_store_id` (`store_id`),
  KEY `ix_products_status` (`status`),
  KEY `ix_products_category` (`category`),
  KEY `ix_products_tenant_id` (`tenant_id`),
  KEY `ix_products_id` (`id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`),
  CONSTRAINT `products_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (1,1,1,'B08XQH7X1Y','BTH-001','无线蓝牙耳机 Pro Max','Wireless Bluetooth Earbuds Pro Max',NULL,'Electronics','Baoxin',199.99,89.99,'ACTIVE',1,NULL,1,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(2,1,1,'B09G1V8K2P','PHC-002','手机壳套装 透明款','Phone Case Set Transparent',NULL,'Accessories','Baoxin',29.99,9.99,'ACTIVE',1,NULL,1,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(3,1,1,'B08Y1Z2X3W','FHB-003','智能运动手环 黑色','Smart Fitness Band Black',NULL,'Wearables','Baoxin',79.99,29.99,'ACTIVE',1,NULL,1,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL);
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_order_items`
--

DROP TABLE IF EXISTS `purchase_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_order_items` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '采购明细ID',
  `purchase_order_id` int NOT NULL COMMENT '采购订单ID',
  `product_id` int NOT NULL COMMENT '商品ID',
  `quantity` int NOT NULL COMMENT '采购数量',
  `received_quantity` int NOT NULL COMMENT '已收货数量',
  `unit_price` decimal(12,2) DEFAULT NULL COMMENT '采购单价',
  `total_price` decimal(12,2) DEFAULT NULL COMMENT '小计金额',
  `notes` text COLLATE utf8mb4_unicode_ci COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_purchase_order_items_purchase_order_id` (`purchase_order_id`),
  KEY `ix_purchase_order_items_product_id` (`product_id`),
  KEY `ix_purchase_order_items_id` (`id`),
  CONSTRAINT `purchase_order_items_ibfk_1` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `purchase_order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_order_items`
--

LOCK TABLES `purchase_order_items` WRITE;
/*!40000 ALTER TABLE `purchase_order_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `purchase_order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_orders`
--

DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '采购订单ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `order_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '采购单号',
  `supplier` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '供应商',
  `contact_person` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系人',
  `contact_phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `expected_date` date DEFAULT NULL COMMENT '预计到货日期',
  `total_amount` decimal(12,2) DEFAULT NULL COMMENT '总金额',
  `status` enum('DRAFT','PENDING','APPROVED','ORDERED','PARTIAL_RECEIVED','COMPLETED','CANCELLED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `notes` text COLLATE utf8mb4_unicode_ci COMMENT '备注',
  `created_by` int DEFAULT NULL COMMENT '创建人',
  `approved_by` int DEFAULT NULL COMMENT '审批人',
  `approved_at` datetime DEFAULT NULL COMMENT '审批时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `approved_by` (`approved_by`),
  KEY `ix_purchase_orders_tenant_id` (`tenant_id`),
  KEY `ix_purchase_orders_id` (`id`),
  CONSTRAINT `purchase_orders_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `purchase_orders_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `purchase_orders_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_orders`
--

LOCK TABLES `purchase_orders` WRITE;
/*!40000 ALTER TABLE `purchase_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `purchase_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `review_analyses`
--

DROP TABLE IF EXISTS `review_analyses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `review_analyses` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '分析ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `review_id` int NOT NULL COMMENT '评论ID',
  `model` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI模型',
  `sentiment` enum('POSITIVE','NEUTRAL','NEGATIVE') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '情感分析',
  `sentiment_score` int DEFAULT NULL COMMENT '情感分数',
  `key_points` json DEFAULT NULL COMMENT '核心观点',
  `topics` json DEFAULT NULL COMMENT '主题分类',
  `suggestions` json DEFAULT NULL COMMENT '处理建议',
  `summary` text COLLATE utf8mb4_unicode_ci COMMENT '分析摘要',
  `raw_response` text COLLATE utf8mb4_unicode_ci COMMENT 'AI原始响应',
  `analysis_time` int DEFAULT NULL COMMENT '分析耗时(ms)',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `review_id` (`review_id`),
  KEY `ix_review_analyses_sentiment` (`sentiment`),
  KEY `ix_review_analyses_tenant_id` (`tenant_id`),
  KEY `ix_review_analyses_id` (`id`),
  CONSTRAINT `review_analyses_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `review_analyses_ibfk_2` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `review_analyses`
--

LOCK TABLES `review_analyses` WRITE;
/*!40000 ALTER TABLE `review_analyses` DISABLE KEYS */;
/*!40000 ALTER TABLE `review_analyses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `review_handlings`
--

DROP TABLE IF EXISTS `review_handlings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `review_handlings` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '处理记录ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `review_id` int NOT NULL COMMENT '评论ID',
  `handler_id` int NOT NULL COMMENT '处理人',
  `action` enum('READ','TAG','COMMENT','REPLY','DISMISS','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型',
  `note` text COLLATE utf8mb4_unicode_ci COMMENT '处理备注',
  `reply_content` text COLLATE utf8mb4_unicode_ci COMMENT '回复内容',
  `reply_sent` tinyint(1) DEFAULT NULL COMMENT '回复是否已发送',
  `reply_sent_at` datetime DEFAULT NULL COMMENT '回复发送时间',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_review_handlings_review_id` (`review_id`),
  KEY `ix_review_handlings_id` (`id`),
  KEY `ix_review_handlings_handler_id` (`handler_id`),
  KEY `ix_review_handlings_tenant_id` (`tenant_id`),
  CONSTRAINT `review_handlings_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `review_handlings_ibfk_2` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`),
  CONSTRAINT `review_handlings_ibfk_3` FOREIGN KEY (`handler_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `review_handlings`
--

LOCK TABLES `review_handlings` WRITE;
/*!40000 ALTER TABLE `review_handlings` DISABLE KEYS */;
/*!40000 ALTER TABLE `review_handlings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reviews`
--

DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reviews` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '评论ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `store_id` int NOT NULL COMMENT '店铺ID',
  `product_id` int NOT NULL COMMENT '商品ID',
  `reviewer_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '评论者名称',
  `rating` smallint NOT NULL COMMENT '评分(1-5)',
  `title` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '评论标题',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论内容',
  `translated_title` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '翻译后的标题',
  `translated_content` text COLLATE utf8mb4_unicode_ci COMMENT '翻译后的内容',
  `review_date` datetime NOT NULL COMMENT '评论时间',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  `asin` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '产品ASIN',
  `crawled_at` datetime DEFAULT NULL COMMENT '抓取日期',
  `account` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号',
  `site` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '站点',
  `return_rate` float DEFAULT NULL COMMENT '退货率',
  `status` enum('new','read','processing','resolved','dismissed') COLLATE utf8mb4_unicode_ci DEFAULT 'new' COMMENT '处理状态',
  PRIMARY KEY (`id`),
  KEY `ix_reviews_id` (`id`),
  KEY `ix_reviews_tenant_id` (`tenant_id`),
  KEY `ix_reviews_review_date` (`review_date`),
  KEY `ix_reviews_product_id` (`product_id`),
  KEY `ix_reviews_rating` (`rating`),
  KEY `ix_reviews_store_id` (`store_id`),
  KEY `idx_reviews_status` (`status`),
  CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `reviews_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`),
  CONSTRAINT `reviews_ibfk_3` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reviews`
--

LOCK TABLES `reviews` WRITE;
/*!40000 ALTER TABLE `reviews` DISABLE KEYS */;
INSERT INTO `reviews` VALUES (1,1,1,1,'John Smith',2,'Battery life is terrible','The sound quality is good but the battery life is terrible. Only lasts 2 hours when fully charged.',NULL,NULL,'2026-04-22 18:28:22','2026-04-23 18:28:22','2026-04-27 18:00:06',NULL,NULL,NULL,NULL,NULL,NULL,'new'),(2,1,1,2,'Maria Garcia',1,'Terrible product','Terrible product! It broke after 3 days. The material is very cheap.',NULL,NULL,'2026-04-21 18:28:22','2026-04-23 18:28:22','2026-04-23 18:28:22',NULL,NULL,NULL,NULL,NULL,NULL,'new'),(3,1,1,3,'Tom Brown',3,'Heart rate monitor not accurate','The bracelet is okay, but the heart rate monitor is not accurate.',NULL,NULL,'2026-04-20 18:28:22','2026-04-23 18:28:22','2026-04-23 18:28:22',NULL,NULL,NULL,NULL,NULL,NULL,'new');
/*!40000 ALTER TABLE `reviews` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `stores`
--

DROP TABLE IF EXISTS `stores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stores` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '店铺ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '店铺名称',
  `platform` enum('AMAZON','SHOPEE','LAZADA','TIKTOK','OTHER') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '平台',
  `platform_store_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台店铺ID',
  `site` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '站点(US/UK/CA等)',
  `marketplace_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '市场ID',
  `api_key` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API密钥(加密)',
  `api_secret` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API密钥(加密)',
  `api_token` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API令牌(加密)',
  `status` enum('ACTIVE','INACTIVE','ERROR') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `sync_status` enum('IDLE','SYNCING','FAILED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '同步状态',
  `last_synced_at` datetime DEFAULT NULL COMMENT '最后同步时间',
  `config` json DEFAULT NULL COMMENT '店铺配置',
  `created_by` int DEFAULT NULL COMMENT '创建人',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `ix_stores_tenant_id` (`tenant_id`),
  KEY `ix_stores_platform` (`platform`),
  KEY `ix_stores_status` (`status`),
  KEY `ix_stores_id` (`id`),
  CONSTRAINT `stores_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `stores_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `stores`
--

LOCK TABLES `stores` WRITE;
/*!40000 ALTER TABLE `stores` DISABLE KEYS */;
INSERT INTO `stores` VALUES (1,1,'宝鑫华盛美国站','AMAZON',NULL,'US','ATVPDKIKX0DER',NULL,NULL,NULL,'ACTIVE','IDLE',NULL,NULL,1,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL);
/*!40000 ALTER TABLE `stores` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tenants`
--

DROP TABLE IF EXISTS `tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '租户ID',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '租户名称',
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '租户编码',
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系人',
  `contact_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `contact_email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系邮箱',
  `plan_type` enum('FREE','BASIC','PRO','ENTERPRISE') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '套餐类型',
  `plan_expire_at` datetime DEFAULT NULL COMMENT '套餐到期时间',
  `status` enum('ACTIVE','SUSPENDED','EXPIRED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `max_users` int DEFAULT NULL COMMENT '最大用户数',
  `max_stores` int DEFAULT NULL COMMENT '最大店铺数',
  `config` json DEFAULT NULL COMMENT '扩展配置',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_tenants_code` (`code`),
  KEY `ix_tenants_id` (`id`),
  KEY `ix_tenants_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tenants`
--

LOCK TABLES `tenants` WRITE;
/*!40000 ALTER TABLE `tenants` DISABLE KEYS */;
INSERT INTO `tenants` VALUES (1,'宝鑫华盛','baoxin','张三','13800138000','zhangsan@baoxinhuasheng.com','PRO',NULL,'ACTIVE',20,10,NULL,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(3,'kayn\'s Tenant','tenant-cacdb502',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 10:31:48','2026-04-28 10:31:48',NULL),(4,'kayn\'s Tenant','tenant-7872456c',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 11:02:29','2026-04-28 11:02:29',NULL),(5,'1\'s Tenant','tenant-8705f2ce',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 11:04:49','2026-04-28 11:04:49',NULL),(6,'testuser\'s Tenant','tenant-4e7592ae',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 11:12:58','2026-04-28 11:12:58',NULL),(7,'testuser\'s Tenant','tenant-f8c09ded',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 11:13:40','2026-04-28 11:13:40',NULL),(8,'testuser2\'s Tenant','tenant-640b9685',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 11:14:14','2026-04-28 11:14:14',NULL),(9,'1\'s Tenant','tenant-e48a1a84',NULL,NULL,NULL,'BASIC',NULL,'ACTIVE',10,5,NULL,'2026-04-28 11:14:33','2026-04-28 11:14:33',NULL);
/*!40000 ALTER TABLE `tenants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_departments`
--

DROP TABLE IF EXISTS `user_departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_departments` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '关联ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `user_id` int NOT NULL COMMENT '用户ID',
  `department_id` int NOT NULL COMMENT '部门ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `ix_user_departments_id` (`id`),
  KEY `ix_user_departments_tenant_id` (`tenant_id`),
  KEY `ix_user_departments_department_id` (`department_id`),
  KEY `ix_user_departments_user_id` (`user_id`),
  CONSTRAINT `user_departments_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `user_departments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `user_departments_ibfk_3` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_departments`
--

LOCK TABLES `user_departments` WRITE;
/*!40000 ALTER TABLE `user_departments` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_departments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `tenant_id` int NOT NULL COMMENT '租户ID',
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户名',
  `email` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邮箱',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手机号',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '密码哈希',
  `nickname` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '昵称',
  `avatar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像',
  `role` enum('ADMIN','OPERATOR','VIEWER') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '角色',
  `department` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '部门',
  `position` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '职位',
  `status` enum('ACTIVE','INACTIVE','SUSPENDED') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态',
  `last_login_at` datetime DEFAULT NULL COMMENT '最后登录时间',
  `last_login_ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后登录IP',
  `config` json DEFAULT NULL COMMENT '个性化配置',
  `created_at` datetime NOT NULL DEFAULT (now()) COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT (now()) COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `ix_users_id` (`id`),
  KEY `ix_users_status` (`status`),
  KEY `ix_users_tenant_id` (`tenant_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,1,'admin','admin@baoxinhuasheng.com',NULL,'$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW','管理员',NULL,'ADMIN',NULL,NULL,'ACTIVE',NULL,NULL,NULL,'2026-04-23 18:28:22','2026-04-23 18:28:22',NULL),(2,8,'testuser2','test2@example.com',NULL,'$pbkdf2-sha256$29000$CGEsRai11hrDOAdAiPHeWw$TpDs3jkkrprlFzt4JrppwW2drrdWEVpxdkbeB88T2K4','testuser2',NULL,'OPERATOR',NULL,NULL,'ACTIVE',NULL,NULL,NULL,'2026-04-28 11:14:14','2026-04-28 11:14:14',NULL),(3,9,'1','123@qq.com',NULL,'$pbkdf2-sha256$29000$Usr5X.sdQ.jd2/t/790bAw$fFYuC7mkoHWvWzngGVf5e8pfOuk97vFTB3iouz8EiAA','1',NULL,'OPERATOR',NULL,NULL,'ACTIVE',NULL,NULL,NULL,'2026-04-28 11:14:33','2026-04-28 11:14:33',NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-18 15:32:03
