import json
import asyncio
import threading
from typing import AsyncGenerator, Optional
from datetime import datetime
from queue import Queue, Empty
from openai import OpenAI
from sqlalchemy.orm import Session
from config import get_settings
from services.chat_service import (
    query_inventory_status, query_negative_reviews,
    analyze_and_save_single_review, get_review_analysis,
    save_message, get_conversation_history, find_product,
    create_purchase_order, create_inbound_order
)
from models.user import User
import logging

logger = logging.getLogger(__name__)
settings = get_settings()


class StreamingService:
    """流式响应服务"""

    def __init__(self):
        self.client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            max_retries=3,
            timeout=120.0,
        ) if settings.OPENAI_API_KEY else None

    def stream_chat_response(
        self,
        db: Session,
        user_id: int,
        session_id: str,
        user_message: str,
        chat_type: str = "review"
    ):
        """
        生成流式聊天响应（同步版本）

        Yields:
            SSE格式的数据字符串
        """
        if not self.client:
            yield self._format_sse("error", "OpenAI API Key 未配置")
            return

        try:
            # 保存用户消息
            save_message(db, user_id, session_id, "user", user_message, chat_type=chat_type)

            # 获取对话历史
            history = get_conversation_history(db, user_id, session_id, limit=10)

            # 根据类型选择系统提示词
            system_prompt = self._get_system_prompt(chat_type)

            # 构建消息列表
            messages = [{"role": "system", "content": system_prompt}]
            messages.extend(history)
            messages.append({"role": "user", "content": user_message})

            # 获取工具定义
            tools = self._get_tools(chat_type)

            if tools:
                # 首先进行工具调用判断（非流式）
                try:
                    tool_response = self.client.chat.completions.create(
                        model=settings.OPENAI_MODEL,
                        messages=messages,
                        tools=tools,
                        tool_choice="auto",
                        timeout=120
                    )

                    assistant_message = tool_response.choices[0].message

                    if assistant_message.tool_calls:
                        # 处理工具调用
                        for chunk in self._handle_tool_calls_sync(
                            db, user_id, session_id, user_message,
                            messages, assistant_message, chat_type
                        ):
                            yield chunk
                        return
                except Exception as e:
                    logger.error(f"工具调用失败: {e}")
                    # 429限流或连接错误时，降级为普通流式回复
                    if "429" in str(e) or "Connection error" in str(e):
                        logger.info("工具调用因限流/连接失败，降级为普通流式回复")
                    else:
                        yield self._format_sse("error", f"处理请求失败: {str(e)}")
                        return

            # 直接流式生成回复
            for chunk in self._generate_streaming_response_sync(
                db, user_id, session_id, messages, chat_type
            ):
                yield chunk

        except Exception as e:
            logger.error(f"流式响应错误: {e}")
            yield self._format_sse("error", str(e))

    def _generate_streaming_response_sync(
        self,
        db: Session,
        user_id: int,
        session_id: str,
        messages: list,
        chat_type: str
    ):
        """同步流式生成回复"""
        try:
            # 发送开始标记
            yield self._format_sse("start", "")

            # 创建流式请求
            stream = self.client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages,
                stream=True,
                temperature=0.7,
                timeout=300
            )

            full_content = ""

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_content += content
                    yield self._format_sse("content", content)

            # 保存完整回复
            if full_content:
                save_message(db, user_id, session_id, "assistant", full_content, chat_type=chat_type)

            # 发送结束标记
            yield self._format_sse("done", "", {"session_id": session_id})

        except Exception as e:
            logger.error(f"流式生成错误: {e}")
            yield self._format_sse("error", f"生成回复失败: {str(e)}")

    def _handle_tool_calls_sync(
        self,
        db: Session,
        user_id: int,
        session_id: str,
        user_message: str,
        messages: list,
        assistant_message,
        chat_type: str
    ):
        """同步处理工具调用"""
        # 获取用户信息和租户ID
        user = db.query(User).filter(User.id == user_id).first()
        tenant_id = user.tenant_id if user else 0
        
        for tool_call in assistant_message.tool_calls:
            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            yield self._format_sse("thinking", "正在分析您的问题...")

            # 执行工具调用
            if function_name == "query_inventory_status":
                result = self._execute_inventory_query(db, arguments)
            elif function_name == "parse_date_range":
                result = self._execute_review_query(db, arguments)
            elif function_name == "query_reviews":
                result = self._execute_unified_review_query(db, arguments)
            elif function_name == "find_product":
                result = self._execute_find_product(db, arguments, tenant_id)
            elif function_name == "create_purchase_order":
                result = self._execute_create_purchase_order(db, arguments, tenant_id, user_id)
            elif function_name == "create_inbound_order":
                result = self._execute_create_inbound_order(db, arguments, tenant_id, user_id)
            else:
                result = {"error": "未知工具"}

            yield self._format_sse("thinking", f"查询完成，正在生成回复...")

            # 添加工具调用结果到消息
            messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": function_name,
                        "arguments": tool_call.function.arguments
                    }
                }]
            })
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False)
            })

            # 流式生成最终回复
            for chunk in self._generate_streaming_response_sync(
                db, user_id, session_id, messages, chat_type
            ):
                yield chunk

    def _execute_inventory_query(self, db: Session, arguments: dict) -> dict:
        """执行库存查询"""
        query_type = arguments.get("query_type", "all")
        risk_level = arguments.get("risk_level")
        limit = arguments.get("limit", 10)

        try:
            items = query_inventory_status(db, query_type, risk_level, limit)
            return {"items": items, "count": len(items)}
        except Exception as e:
            logger.error(f"库存查询失败: {e}")
            return {"error": str(e), "items": [], "count": 0}

    def _execute_review_query(self, db: Session, arguments: dict) -> dict:
        """执行差评查询"""
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")

        if not start_date or not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

        try:
            reviews = query_negative_reviews(db, start_date, end_date)

            # 自动分析评论
            analyzed_reviews = []
            for review in reviews[:10]:  # 限制分析数量
                analysis = get_review_analysis(db, review["id"])
                if not analysis:
                    analysis = analyze_and_save_single_review(db, review)

                analyzed_reviews.append({
                    "product_name": review.get("product_name", review["asin"]),
                    "rating": review["rating"],
                    "analysis": analysis
                })

            return {"reviews": analyzed_reviews, "count": len(reviews)}
        except Exception as e:
            logger.error(f"差评查询失败: {e}")
            return {"error": str(e), "reviews": [], "count": 0}

    def _execute_unified_review_query(self, db: Session, arguments: dict) -> dict:
        """执行统一模式的差评查询"""
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")
        asin = arguments.get("asin")

        if not start_date or not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

        try:
            reviews = query_negative_reviews(db, start_date, end_date, asin)

            analyzed_reviews = []
            for review in reviews[:10]:
                product_name = review.get("product_name", review["asin"])
                analysis = get_review_analysis(db, review["id"])
                if not analysis:
                    analysis = analyze_and_save_single_review(db, review)

                analyzed_reviews.append({
                    "product_name": product_name,
                    "rating": review["rating"],
                    "title": review.get("title", "") or "",
                    "content_preview": review["content"][:150] + ("..." if len(review["content"]) > 150 else ""),
                    "key_issues": analysis["key_points"] if analysis else [],
                    "summary": analysis["summary"] if analysis else ""
                })

            return {"reviews": analyzed_reviews, "count": len(reviews)}
        except Exception as e:
            logger.error(f"统一模式差评查询失败: {e}")
            return {"error": str(e), "reviews": [], "count": 0}

    def _get_system_prompt(self, chat_type: str) -> str:
        """获取系统提示词"""
        current_date = datetime.now().strftime("%Y-%m-%d")

        if chat_type == "unified":
            return f"""你是专业的跨境电商AI分析助手，代号"坦克引擎"。当前日期: {current_date}。

你的能力包含三大领域：

【库存分析】
- 查询库存状态、断货风险商品、补货建议
- 分析库存健康度，给出补货优先级建议
- 当用户问：断货、补货、库存、可售天数、FBA库存等 → 调用 query_inventory_status

【采购单管理】
- 可以帮用户创建采购单
- 创建采购单前必须先调用 find_product 找到产品ID
- 创建采购单调用 create_purchase_order

【入库单管理】
- 可以帮用户创建入库单
- 创建入库单前必须先调用 find_product 找到产品ID
- 创建入库单调用 create_inbound_order

【差评分析】  
- 查询指定日期范围内的差评数据
- 分析差评趋势、核心问题、改进建议
- 当用户问：差评、评论、退货率、客户反馈等 → 调用 query_reviews

【产品查找】
- 使用 find_product 工具查找产品信息（通过名称、编码、ASIN等）
- 所有需要产品ID的操作必须先调用 find_product

【重要规则】
- 根据用户问题准确判断该用哪个工具，不要用错数据源
- 断货风险/库存问题 → 必须用库存数据，不要用差评数据
- 差评/评论问题 → 必须用差评数据，不要用库存数据
- 创建采购单/入库单 → 必须先调用 find_product 查找产品ID
- 使用商品的【真实名称】来引用产品，不要只使用ASIN
- 回复要简洁专业，突出关键数据和建议"""
        elif chat_type == "inventory":
            return f"""你是专业的跨境电商库存分析助手。当前日期: {current_date}。

你的能力：
- 查询库存状态、断货风险商品、补货建议
- 分析库存健康度，给出补货优先级建议

重要规则：
- 使用商品的【真实名称】来引用产品，不要只使用ASIN
- 回复要简洁专业，突出关键数据和建议
- 优先展示风险等级和建议补货数量"""
        else:
            return f"""你是专业的跨境电商差评分析助手。当前日期: {current_date}。

任务：
1. 解析用户提到的日期范围
2. 查询该日期范围内的差评
3. 用中文进行分析回复

重要规则：
- 绝对不要在回复中使用数字ID或ASIN编号来标识产品
- 必须使用商品的【真实名称】来引用产品"""

    def _get_tools(self, chat_type: str) -> list:
        """获取工具定义"""
        if chat_type == "unified":
            return [{
                "type": "function",
                "function": {
                    "name": "query_inventory_status",
                    "description": "查询库存状态。当用户问断货风险、补货、库存相关问题时调用此工具。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query_type": {
                                "type": "string",
                                "enum": ["stockout_risk", "need_restock", "low_stock", "all"]
                            },
                            "risk_level": {"type": "string", "enum": ["red", "yellow", "green"]},
                            "limit": {"type": "integer", "default": 10}
                        },
                        "required": ["query_type"]
                    }
                }
            }, {
                "type": "function",
                "function": {
                    "name": "find_product",
                    "description": "查找产品信息，可通过产品名称、编码、ASIN等搜索。在创建采购单或入库单前，必须先调用此工具找到产品ID。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "search_keyword": {
                                "type": "string",
                                "description": "搜索关键词：可输入产品名称、编码、ASIN、SKU等"
                            },
                            "limit": {
                                "type": "integer",
                                "description": "返回数量限制，默认10条",
                                "default": 10
                            }
                        },
                        "required": ["search_keyword"]
                    }
                }
            }, {
                "type": "function",
                "function": {
                    "name": "create_purchase_order",
                    "description": "创建采购单。使用此工具前必须先调用 find_product 获取产品ID。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "order_number": {"type": "string", "description": "采购单号"},
                            "supplier": {"type": "string", "description": "供应商名称"},
                            "warehouse": {"type": "string", "description": "仓库名称"},
                            "expected_date": {"type": "string", "description": "预计到货日期，格式 YYYY-MM-DD"},
                            "notes": {"type": "string", "description": "备注信息"},
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "product_id": {"type": "integer", "description": "产品ID，必须通过find_product工具获取"},
                                        "quantity": {"type": "integer", "description": "采购数量"},
                                        "unit_price": {"type": "number", "description": "单价"},
                                        "notes": {"type": "string", "description": "备注"}
                                    },
                                    "required": ["product_id", "quantity"]
                                },
                                "description": "采购明细列表"
                            }
                        },
                        "required": ["order_number", "items"]
                    }
                }
            }, {
                "type": "function",
                "function": {
                    "name": "create_inbound_order",
                    "description": "创建入库单。使用此工具前必须先调用 find_product 获取产品ID。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "order_number": {"type": "string", "description": "入库单号"},
                            "inbound_type": {
                                "type": "string",
                                "enum": ["purchase", "return", "transfer", "other"],
                                "description": "入库类型：purchase=采购入库，return=退货入库，transfer=调拨入库，other=其他",
                                "default": "purchase"
                            },
                            "purchase_order_id": {"type": "integer", "description": "关联的采购单ID（可选）"},
                            "warehouse": {"type": "string", "description": "仓库名称"},
                            "handler": {"type": "string", "description": "经办人"},
                            "inbound_date": {"type": "string", "description": "入库日期，格式 YYYY-MM-DD"},
                            "notes": {"type": "string", "description": "备注信息"},
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "product_id": {"type": "integer", "description": "产品ID，必须通过find_product工具获取"},
                                        "quantity": {"type": "integer", "description": "入库数量"},
                                        "unit_price": {"type": "number", "description": "单价"},
                                        "batch_number": {"type": "string", "description": "批次号"},
                                        "production_date": {"type": "string", "description": "生产日期，格式 YYYY-MM-DD"},
                                        "expiry_date": {"type": "string", "description": "过期日期，格式 YYYY-MM-DD"},
                                        "warehouse": {"type": "string", "description": "仓库（可选，如与主单不同时填写）"},
                                        "shelf_number": {"type": "string", "description": "货架号"},
                                        "notes": {"type": "string", "description": "备注"}
                                    },
                                    "required": ["product_id", "quantity"]
                                },
                                "description": "入库明细列表"
                            }
                        },
                        "required": ["order_number", "items"]
                    }
                }
            }, {
                "type": "function",
                "function": {
                    "name": "query_reviews",
                    "description": "查询差评数据。当用户问差评、评论分析、客户反馈、退货率等问题时调用此工具。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "start_date": {"type": "string", "description": "开始日期 YYYY-MM-DD"},
                            "end_date": {"type": "string", "description": "结束日期 YYYY-MM-DD"},
                            "asin": {"type": "string", "description": "指定ASIN"},
                            "date_description": {"type": "string", "description": "日期描述"}
                        },
                        "required": ["start_date", "end_date"]
                    }
                }
            }]
        elif chat_type == "inventory":
            return [{
                "type": "function",
                "function": {
                    "name": "query_inventory_status",
                    "description": "查询库存状态",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query_type": {
                                "type": "string",
                                "enum": ["stockout_risk", "need_restock", "low_stock", "all"]
                            },
                            "risk_level": {"type": "string", "enum": ["red", "yellow", "green"]},
                            "limit": {"type": "integer", "default": 10}
                        },
                        "required": ["query_type"]
                    }
                }
            }]
        else:
            return [{
                "type": "function",
                "function": {
                    "name": "parse_date_range",
                    "description": "解析日期范围",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "start_date": {"type": "string"},
                            "end_date": {"type": "string"},
                            "date_description": {"type": "string"}
                        },
                        "required": ["start_date", "end_date"]
                    }
                }
            }]

    def _format_sse(self, event_type: str, data: str, extra: dict = None) -> str:
        """格式化SSE消息"""
        payload = {"type": event_type, "content": data}
        if extra:
            payload.update(extra)
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


    def _execute_find_product(self, db: Session, arguments: dict, tenant_id: int) -> dict:
        """执行产品查找"""
        search_keyword = arguments.get("search_keyword")
        limit = arguments.get("limit", 10)
        
        try:
            products = find_product(db, search_keyword, tenant_id, limit)
            return {"products": products, "count": len(products)}
        except Exception as e:
            logger.error(f"产品查找失败: {e}")
            return {"error": str(e), "products": [], "count": 0}
    
    def _execute_create_purchase_order(self, db: Session, arguments: dict, tenant_id: int, user_id: int) -> dict:
        """执行创建采购单"""
        order_number = arguments.get("order_number")
        supplier = arguments.get("supplier")
        warehouse = arguments.get("warehouse")
        expected_date = arguments.get("expected_date")
        notes = arguments.get("notes")
        items = arguments.get("items", [])
        
        try:
            result = create_purchase_order(db, tenant_id, user_id, order_number, supplier, warehouse, expected_date, notes, items)
            return result
        except Exception as e:
            logger.error(f"创建采购单失败: {e}")
            return {"success": False, "message": str(e)}
    
    def _execute_create_inbound_order(self, db: Session, arguments: dict, tenant_id: int, user_id: int) -> dict:
        """执行创建入库单"""
        order_number = arguments.get("order_number")
        inbound_type = arguments.get("inbound_type", "purchase")
        purchase_order_id = arguments.get("purchase_order_id")
        warehouse = arguments.get("warehouse")
        handler = arguments.get("handler")
        inbound_date = arguments.get("inbound_date")
        notes = arguments.get("notes")
        items = arguments.get("items", [])
        
        try:
            result = create_inbound_order(db, tenant_id, user_id, order_number, inbound_type, purchase_order_id, warehouse, handler, inbound_date, notes, items)
            return result
        except Exception as e:
            logger.error(f"创建入库单失败: {e}")
            return {"success": False, "message": str(e)}


# 添加缺失的导入
from datetime import timedelta
