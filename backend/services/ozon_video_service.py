# -*- coding: utf-8 -*-
"""
Ozon Seller API 商品视频服务

通过 POST /v1/product/attributes/update 局部更新商品卡片的视频复杂属性：
- complex_id=100001 的复杂属性组：id=21841 视频链接、id=21837 视频名称
- 接口只要求公网可访问的 MP4/MOV 链接、时长 8 秒–5 分钟、每个商品最多 5 个视频
- 提交为异步任务，返回 task_id，用 POST /v1/product/import/info 查询处理结果
- 注意：attributes/update 为覆盖语义，提交的 values 会作为该属性完整值
"""

import json
import logging
from typing import Dict, List, Tuple

import httpx

logger = logging.getLogger(__name__)

OZON_API_BASE = "https://api-seller.ozon.ru"
VIDEO_COMPLEX_ID = 100001
VIDEO_URL_ATTR_ID = 21841
VIDEO_NAME_ATTR_ID = 21837
MAX_OZON_VIDEOS = 5
ALLOWED_VIDEO_EXTS = (".mp4", ".mov")


def validate_video_urls(video_urls: List[str]) -> List[str]:
    """Ozon 视频链接基础校验，返回错误说明列表（空列表表示通过）"""
    errors: List[str] = []
    if not video_urls:
        return ["至少选择一个视频"]
    if len(video_urls) > MAX_OZON_VIDEOS:
        errors.append(f"Ozon 每个商品最多上传 {MAX_OZON_VIDEOS} 个视频")
    for i, url in enumerate(video_urls, 1):
        u = (url or "").strip()
        if not u.lower().startswith(("http://", "https://")):
            errors.append(f"视频{i}：链接必须为 http(s) 公网地址")
            continue
        path = u.split("?")[0].lower()
        if not path.endswith(ALLOWED_VIDEO_EXTS):
            errors.append(f"视频{i}：Ozon 仅支持 MP4/MOV 链接")
    return errors


def _headers(client_id: str, api_key: str) -> Dict[str, str]:
    return {
        "Client-Id": str(client_id or "").strip(),
        "Api-Key": (api_key or "").strip(),
        "Content-Type": "application/json",
    }


def _ozon_video_name(product_code: str, index: int) -> str:
    """提交给属性 21837 的视频名称：产品编码_序号，过滤文件名非法字符"""
    prefix = (product_code or "video").strip()
    safe = "".join(c for c in prefix if c not in '\\/:*?"<>|，；; ')[:60] or "video"
    return f"{safe}_{index}"


async def update_product_videos(
    client_id: str, api_key: str, offer_ids: List[str], video_urls: List[str], product_code: str
) -> Dict:
    """把视频列表写入 Ozon 商品卡片（按 offer_id 局部更新视频复杂属性）。

    返回 {"task_id": 任务号, "offer_ids": 本次更新的商品货号列表}
    失败抛 RuntimeError，错误信息含 Ozon 原始响应片段
    """
    body = {
        "items": [
            {
                "offer_id": oid,
                "attributes": [
                    {
                        "complex_id": VIDEO_COMPLEX_ID,
                        "id": VIDEO_URL_ATTR_ID,
                        "values": [{"value": u.strip()} for u in video_urls],
                    },
                    {
                        "complex_id": VIDEO_COMPLEX_ID,
                        "id": VIDEO_NAME_ATTR_ID,
                        "values": [
                            {"value": _ozon_video_name(product_code, i)}
                            for i in range(1, len(video_urls) + 1)
                        ],
                    },
                ],
            }
            for oid in offer_ids
        ]
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OZON_API_BASE}/v1/product/attributes/update",
            headers=_headers(client_id, api_key),
            json=body,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Ozon API HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    task_id = data.get("task_id") or (data.get("data") or {}).get("task_id")
    if not task_id:
        raise RuntimeError(f"Ozon 未返回 task_id: {json.dumps(data, ensure_ascii=False)[:200]}")
    return {"task_id": int(task_id), "offer_ids": list(offer_ids)}


async def get_import_status(client_id: str, api_key: str, task_id: int) -> List[Dict]:
    """查询 Ozon 商品导入/更新任务处理结果，返回 result.items 原始列表"""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OZON_API_BASE}/v1/product/import/info",
            headers=_headers(client_id, api_key),
            json={"task_id": int(task_id)},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Ozon API HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    result = data.get("result") or (data.get("data") or {}).get("result") or {}
    return result.get("items") or []


def summarize_import_items(items: List[Dict]) -> Tuple[str, str]:
    """把 import/info 的 items 摘要为（任务状态, 错误信息）。

    有 errors → 失败；全部状态为成功类 → 成功；其余 → 处理中
    """
    statuses = [str(it.get("status") or "").lower() for it in items]
    errs: List[str] = []
    for it in items:
        for e in it.get("errors") or []:
            text = e if isinstance(e, str) else json.dumps(e, ensure_ascii=False)
            errs.append(f"{it.get('offer_id', '')}: {text}")
    if errs:
        return "失败", "\n".join(errs)[:2000]
    ok_states = {"ok", "imported", "success", "updated", "sent"}
    if statuses and all(s in ok_states for s in statuses):
        return "成功", ""
    return "处理中", ""
