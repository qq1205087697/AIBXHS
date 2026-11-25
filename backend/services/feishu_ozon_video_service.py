# -*- coding: utf-8 -*-
"""
Ozon 视频上传飞书留痕服务

每次 Ozon SKU 视频提交，按「视频 × SKU」写入独立留痕表（复用 FEISHU_VIDEO_BASE_TOKEN，
表 ID 从 FEISHU_OZON_VIDEO_TABLE_ID 读取，未配置时留痕自动跳过不影响上传）。

表字段：产品编码 / 产品名称 / 店铺名称 / 店铺ID / 站点 / Ozon SKU / Ozon商品ID /
视频名称 / 视频链接 / 视频附件 / 批次号 / 任务ID / 任务状态 / 错误信息 / 提交人 / 提交时间 / 完成时间
"""

import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

import httpx

from config import get_settings
from services.feishu_service import FEISHU_API_BASE, get_access_token
from services.feishu_video_sku_service import (
    _get_reporter_open_id,
    _guess_video_name,
    _upload_bitable_attachment,
)
from services.ozon_video_service import _ozon_video_name

settings = get_settings()
logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """Ozon 留痕表是否已配置（未配置时留痕自动跳过，不影响 Ozon 上传本身）"""
    return bool(settings.FEISHU_VIDEO_BASE_TOKEN and settings.FEISHU_OZON_VIDEO_TABLE_ID)


def new_batch_no() -> str:
    """一次提交一个批次号，用于聚合本次上传的全部留痕记录"""
    return uuid.uuid4().hex[:16].upper()


def _base() -> str:
    return (
        f"{FEISHU_API_BASE}/bitable/v1/apps/{settings.FEISHU_VIDEO_BASE_TOKEN}"
        f"/tables/{settings.FEISHU_OZON_VIDEO_TABLE_ID}"
    )


async def create_ozon_upload_records(
    video_urls: List[str],
    product_code: str,
    product_name: str,
    entries: List[Dict],
    task_map: Dict[int, int],
    batch_no: str,
) -> Dict:
    """把 Ozon 上传结果按 视频×SKU 逐条写入留痕表。

    video_urls: 提交给 Ozon 的视频公网链接
    entries:    [{sku(offer_id), store_id, store_name, site, ozon_product_id}]
    task_map:   {store_id: task_id}（同一店铺所有 offer_id 合并为一次提交）
    返回 {"success", "failed", "errors", "batch_no"}
    """
    token = await get_access_token()
    auth = {"Authorization": f"Bearer {token}"}
    reporter = await _get_reporter_open_id(token)
    today_ms = int(datetime.now().timestamp() * 1000)

    ok, failed, errors = 0, 0, []
    async with httpx.AsyncClient(timeout=120) as client:
        # 每个视频只下载一次并上传飞书附件拿 file_token，全部 SKU 记录复用
        videos: List[Dict] = []
        for vi, url in enumerate(video_urls, 1):
            try:
                vresp = await client.get(url, timeout=600)
                vresp.raise_for_status()
                sku0 = entries[0].get("sku", "") if entries else ""
                name = _guess_video_name(url, product_code, sku0)
                if len(video_urls) > 1:
                    stem, ext = name.rsplit(".", 1)
                    name = f"{stem}_{vi}.{ext}"
                videos.append({
                    "name": name,
                    "bytes": vresp.content,
                    "url": url,
                    "ozon_name": _ozon_video_name(product_code, vi),
                })
            except Exception as e:
                raise RuntimeError(f"视频下载失败: {e}") from e

        for video in videos:
            try:
                video["file_token"] = await _upload_bitable_attachment(
                    client, auth, video["name"], video["bytes"]
                )
            except Exception as ue:
                raise RuntimeError(f"视频 {video['name']} 上传飞书失败: {ue}") from ue

        for video in videos:
            ft = video["file_token"]
            for idx, e in enumerate(entries, 1):
                label = f"{video['name']} → {e.get('sku') or f'第{idx}条'}（{e.get('store_name') or '-'}）"
                fields: Dict = {
                    "产品编码": product_code or "",
                    "产品名称": product_name or "",
                    "店铺名称": e.get("store_name") or "",
                    "站点": e.get("site") or "",
                    "Ozon SKU": e.get("sku") or "",
                    "视频名称": video.get("ozon_name") or video["name"],
                    "视频链接": video.get("url") or "",
                    "批次号": batch_no,
                    "任务ID": str(task_map.get(e.get("store_id"), "")),
                    "任务状态": "已提交",
                    "提交时间": today_ms,
                }
                if e.get("store_id"):
                    fields["店铺ID"] = int(e["store_id"])
                if e.get("ozon_product_id"):
                    fields["Ozon商品ID"] = str(e["ozon_product_id"])
                if reporter:
                    fields["提交人"] = [{"id": reporter}]
                fields = {k: v for k, v in fields.items() if v not in ("", None)}

                try:
                    cres = await client.post(
                        f"{_base()}/records",
                        headers={**auth, "Content-Type": "application/json"},
                        json={"fields": fields},
                    )
                    # 带填报人创建失败时降级重试（人员字段无权限等情况）
                    cdata = cres.json() if cres.status_code == 200 else {"code": -1, "msg": f"HTTP {cres.status_code}"}
                    if cdata.get("code") != 0 and reporter and "提交人" in fields:
                        fields.pop("提交人", None)
                        cres = await client.post(
                            f"{_base()}/records",
                            headers={**auth, "Content-Type": "application/json"},
                            json={"fields": fields},
                        )
                        cdata = cres.json() if cres.status_code == 200 else {"code": -1, "msg": f"HTTP {cres.status_code}"}
                    if cdata.get("code") != 0:
                        failed += 1
                        errors.append(f"{label}: 建记录失败 {cdata.get('msg')}")
                        continue
                    record_id = (cdata.get("data") or {}).get("record", {}).get("record_id")

                    # 绑定视频附件（更新记录必须用 PUT，PATCH 会 404）
                    presp = await client.put(
                        f"{_base()}/records/{record_id}",
                        headers={**auth, "Content-Type": "application/json"},
                        json={"fields": {"视频附件": [{"file_token": ft}]}},
                    )
                    pdata = presp.json() if presp.status_code == 200 else {"code": -1, "msg": f"HTTP {presp.status_code}"}
                    if pdata.get("code") != 0:
                        failed += 1
                        errors.append(f"{label}: 绑定附件失败 {pdata.get('msg')}")
                        continue
                    ok += 1
                except Exception as ex:
                    failed += 1
                    errors.append(f"{label}: {ex}")

    if failed:
        logger.warning("Ozon 视频留痕部分失败 batch=%s: %s", batch_no, "; ".join(errors[:5]))
    return {"success": ok, "failed": failed, "errors": errors, "batch_no": batch_no}


async def update_status_by_task(batch_no: str, task_id: int, status_text: str, error_text: str) -> Dict:
    """按批次号+任务ID 找到留痕记录并回写任务状态/错误信息/完成时间"""
    token = await get_access_token()
    auth = {"Authorization": f"Bearer {token}"}
    now_ms = int(datetime.now().timestamp() * 1000)

    async with httpx.AsyncClient(timeout=60) as client:
        sresp = await client.post(
            f"{_base()}/records/search",
            headers={**auth, "Content-Type": "application/json"},
            json={
                "filter": {
                    "conjunction": "and",
                    "conditions": [
                        {"field_name": "批次号", "operator": "is", "value": [batch_no]},
                        {"field_name": "任务ID", "operator": "is", "value": [str(task_id)]},
                    ],
                }
            },
        )
        sdata = sresp.json() if sresp.status_code == 200 else {"code": -1, "msg": f"HTTP {sresp.status_code}"}
        if sdata.get("code") != 0:
            return {"updated": 0, "error": f"查询留痕记录失败 {sdata.get('msg')}"}
        record_ids = [it.get("record_id") for it in (sdata.get("data") or {}).get("items") or [] if it.get("record_id")]

        updated = 0
        for rid in record_ids:
            fields: Dict = {"任务状态": status_text, "完成时间": now_ms}
            if error_text:
                fields["错误信息"] = error_text
            uresp = await client.put(
                f"{_base()}/records/{rid}",
                headers={**auth, "Content-Type": "application/json"},
                json={"fields": fields},
            )
            udata = uresp.json() if uresp.status_code == 200 else {"code": -1}
            if udata.get("code") == 0:
                updated += 1
    return {"updated": updated, "error": None if updated == len(record_ids) else "部分记录回写失败"}


async def get_reporter_open_id() -> Optional[str]:
    """暴露填报人 open_id 给路由层复用（不直接调用则返回 None）"""
    token = await get_access_token()
    return await _get_reporter_open_id(token)
