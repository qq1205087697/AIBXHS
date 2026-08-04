import httpx
import time
from typing import List, Dict, Any, Optional
from config import get_settings

settings = get_settings()

FEISHU_API_BASE = "https://open.feishu.cn/open-apis"

# 缓存token
_access_token: str = ""
_token_expire_time: float = 0


async def get_access_token() -> str:
    """获取飞书访问令牌"""
    global _access_token, _token_expire_time
    
    # 如果token未过期，直接返回
    if _access_token and time.time() < _token_expire_time:
        return _access_token
    
    if not settings.FEISHU_APP_ID or not settings.FEISHU_APP_SECRET:
        raise ValueError("飞书App ID或App Secret未配置")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{FEISHU_API_BASE}/auth/v3/tenant_access_token/internal",
            json={
                "app_id": settings.FEISHU_APP_ID,
                "app_secret": settings.FEISHU_APP_SECRET,
            }
        )
        
        data = response.json()
        if data.get("code") == 0:
            _access_token = data["tenant_access_token"]
            # token有效期提前5分钟过期
            _token_expire_time = time.time() + (data["expire"] - 300)
            return _access_token
        else:
            raise Exception(f"获取token失败: {data.get('msg')}")


async def fetch_inventory_from_feishu() -> List[Dict[str, Any]]:
    """从飞书多维表获取库存数据"""
    try:
        if not settings.FEISHU_INVENTORY_BASE_TOKEN or not settings.FEISHU_INVENTORY_TABLE_ID:
            print("飞书库存表配置未设置，使用模拟数据")
            return get_mock_inventory_data()
        
        token = await get_access_token()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{FEISHU_API_BASE}/bitable/v1/apps/{settings.FEISHU_INVENTORY_BASE_TOKEN}/tables/{settings.FEISHU_INVENTORY_TABLE_ID}/records/search",
                json={
                    "filter": {
                        "conjunction": "and",
                        "conditions": []
                    },
                    "page_size": 500
                },
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                }
            )
            
            data = response.json()
            if data.get("code") == 0:
                records = data.get("data", {}).get("items", [])
                
                # 转换飞书数据格式为应用需要的格式
                return [
                    {
                        "id": record["record_id"],
                        "asin": record["fields"].get("ASIN") or record["fields"].get("asin", ""),
                        "name": record["fields"].get("商品名称") or record["fields"].get("name", ""),
                        "currentStock": int(record["fields"].get("当前库存") or record["fields"].get("currentStock", 0)),
                        "safetyStock": int(record["fields"].get("安全库存") or record["fields"].get("safetyStock", 0)),
                        "daysRemaining": int(record["fields"].get("可售天数") or record["fields"].get("daysRemaining", 0)),
                        "status": record["fields"].get("状态") or record["fields"].get("status", "normal"),
                        "category": record["fields"].get("预警类型") or record["fields"].get("category", "normal"),
                        "suggestion": record["fields"].get("AI建议") or record["fields"].get("suggestion", "")
                    }
                    for record in records
                ]
            else:
                raise Exception(f"获取库存数据失败: {data.get('msg')}")
                
    except Exception as e:
        print(f"从飞书获取库存数据失败: {e}")
        print("使用模拟数据作为fallback")
        return get_mock_inventory_data()


async def fetch_reviews_from_feishu() -> List[Dict[str, Any]]:
    """从飞书多维表获取差评数据"""
    try:
        if not settings.FEISHU_REVIEW_BASE_TOKEN or not settings.FEISHU_REVIEW_TABLE_ID:
            print("飞书差评表配置未设置，使用模拟数据")
            return get_mock_review_data()
        
        token = await get_access_token()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{FEISHU_API_BASE}/bitable/v1/apps/{settings.FEISHU_REVIEW_BASE_TOKEN}/tables/{settings.FEISHU_REVIEW_TABLE_ID}/records/search",
                json={
                    "filter": {
                        "conjunction": "and",
                        "conditions": []
                    },
                    "page_size": 500
                },
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                }
            )
            
            data = response.json()
            if data.get("code") == 0:
                records = data.get("data", {}).get("items", [])
                
                return [
                    {
                        "id": record["record_id"],
                        "asin": record["fields"].get("ASIN") or record["fields"].get("asin", ""),
                        "productName": record["fields"].get("商品名称") or record["fields"].get("productName", ""),
                        "rating": int(record["fields"].get("评分") or record["fields"].get("rating", 5)),
                        "originalText": record["fields"].get("原文") or record["fields"].get("originalText", ""),
                        "translatedText": record["fields"].get("翻译") or record["fields"].get("translatedText", ""),
                        "keyPoints": record["fields"].get("核心诉求", "").split(",") if record["fields"].get("核心诉求") else record["fields"].get("keyPoints", []),
                        "date": record["fields"].get("评论日期") or record["fields"].get("date", ""),
                        "status": record["fields"].get("处理状态") or record["fields"].get("status", "new"),
                        "author": record["fields"].get("评论者") or record["fields"].get("author", "Anonymous")
                    }
                    for record in records
                ]
            else:
                raise Exception(f"获取差评数据失败: {data.get('msg')}")
                
    except Exception as e:
        print(f"从飞书获取差评数据失败: {e}")
        print("使用模拟数据作为fallback")
        return get_mock_review_data()


async def update_feishu_record(
    base_token: str,
    table_id: str,
    record_id: str,
    fields: Dict[str, Any]
) -> Dict[str, Any]:
    """更新飞书多维表中的记录"""
    try:
        token = await get_access_token()
        
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{FEISHU_API_BASE}/bitable/v1/apps/{base_token}/tables/{table_id}/records/{record_id}",
                json={"fields": fields},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                }
            )
            
            data = response.json()
            if data.get("code") == 0:
                return data.get("data", {})
            else:
                raise Exception(f"更新记录失败: {data.get('msg')}")
                
    except Exception as e:
        print(f"更新飞书记录失败: {e}")
        raise


def get_mock_inventory_data() -> List[Dict[str, Any]]:
    """模拟库存数据"""
    return [
        {
            "id": "1",
            "asin": "B08XQH7X1Y",
            "name": "无线蓝牙耳机 Pro Max",
            "currentStock": 12,
            "safetyStock": 50,
            "daysRemaining": 5,
            "status": "danger",
            "category": "out_of_stock",
            "suggestion": "建议立即补货，并临时提高售价20%，同时降低广告预算30%以减少订单量。"
        },
        {
            "id": "2",
            "asin": "B09G1V8K2P",
            "name": "手机壳套装 透明款",
            "currentStock": 580,
            "safetyStock": 200,
            "daysRemaining": 90,
            "status": "warning",
            "category": "overstock",
            "suggestion": "库存积压严重！建议：1. 打8折促销；2. 绑定爆款做买一送一；3. 报名LD秒杀活动。"
        },
        {
            "id": "3",
            "asin": "B08Y1Z2X3W",
            "name": "智能运动手环 黑色",
            "currentStock": 42,
            "safetyStock": 100,
            "daysRemaining": 8,
            "status": "danger",
            "category": "out_of_stock",
            "suggestion": "库存即将告罄！建议紧急空运补货，并适当提价15%。"
        },
    ]


def get_mock_review_data() -> List[Dict[str, Any]]:
    """模拟差评数据"""
    return [
        {
            "id": "1",
            "asin": "B08XQH7X1Y",
            "productName": "无线蓝牙耳机 Pro Max",
            "rating": 2,
            "originalText": "The sound quality is good but the battery life is terrible. Only lasts 2 hours when fully charged.",
            "translatedText": "音质不错，但电池续航太差了。充满电后只能用2小时。",
            "keyPoints": ["电池续航问题", "需要改进电池容量", "音质满意"],
            "date": "2026-04-22 14:30:00",
            "status": "new",
            "author": "John Smith"
        },
        {
            "id": "2",
            "asin": "B09G1V8K2P",
            "productName": "手机壳套装 透明款",
            "rating": 1,
            "originalText": "Terrible product! It broke after 3 days. The material is very cheap.",
            "translatedText": "糟糕的产品！3天后就坏了。材质非常廉价。",
            "keyPoints": ["材质质量差", "易损坏", "需要更换供应商"],
            "date": "2026-04-21 09:15:00",
            "status": "processing",
            "author": "Maria Garcia"
        },
        {
            "id": "3",
            "asin": "B08Y1Z2X3W",
            "productName": "智能运动手环 黑色",
            "rating": 3,
            "originalText": "The bracelet is okay, but the heart rate monitor is not accurate.",
            "translatedText": "手环还可以，但心率监测不准确。",
            "keyPoints": ["心率监测不准确", "需要校准算法"],
            "date": "2026-04-20 18:45:00",
            "status": "resolved",
            "author": "Tom Brown"
        },
    ]
