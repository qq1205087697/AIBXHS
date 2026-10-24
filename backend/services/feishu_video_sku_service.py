# -*- coding: utf-8 -*-
"""
AI视频首绑SKU上传飞书多维表服务

产品首条视频绑定后，可将视频直传至该产品 AMAZON 平台各 SKU 对应的多维表记录：
- 表字段：ASIN / 紫鸟登录账号 / 紫鸟启动名 / 站点 / 视频附件 / 填报人 / 填报日期
- 紫鸟启动名由 ZINIAO_ACCOUNT_MAP（启动名→登录账号 JSON）按登录账号反查（取第一个命中项，与站点无关）
- 多维表 app_token / table_id 从 .env 读取（FEISHU_VIDEO_BASE_TOKEN / FEISHU_VIDEO_TABLE_ID），
  未配置时功能自动停用
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Optional

import httpx

from config import get_settings
from services.feishu_service import FEISHU_API_BASE, get_access_token

settings = get_settings()
logger = logging.getLogger(__name__)

# 应用机器人 open_id 缓存（填报人未显式配置时自动取机器人身份，仅探测一次）
_bot_open_id: Optional[str] = None
_bot_checked = False


def is_configured() -> bool:
    """飞书视频上传表是否已配置（未配置时首绑弹窗与接口均自动停用）"""
    return bool(settings.FEISHU_VIDEO_BASE_TOKEN and settings.FEISHU_VIDEO_TABLE_ID)


def load_ziniao_account_map() -> Dict[str, str]:
    """加载紫鸟启动名→登录账号映射（JSON 配置），非法配置时返回空并记日志"""
    raw = (settings.ZINIAO_ACCOUNT_MAP or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if str(k).strip() and str(v).strip()}
    except Exception:
        pass
    logger.warning("ZINIAO_ACCOUNT_MAP 配置不是合法 JSON，紫鸟启动名映射停用")
    return {}


def resolve_start_name(ziniao_account: str) -> str:
    """按映射顺序取该紫鸟登录账号命中的第一个启动名（启动名与站点无关），未命中返回空"""
    if not ziniao_account:
        return ""
    for start_name, account in load_ziniao_account_map().items():
        if account == ziniao_account:
            return start_name
    return ""


async def _get_reporter_open_id(token: str) -> str:
    """填报人优先取 .env 配置的 open_id，否则探测应用机器人自身 open_id（仅一次）"""
    global _bot_open_id, _bot_checked
    if settings.FEISHU_VIDEO_REPORTER_OPEN_ID:
        return settings.FEISHU_VIDEO_REPORTER_OPEN_ID
    if _bot_checked:
        return _bot_open_id or ""
    _bot_checked = True
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{FEISHU_API_BASE}/bot/v3/info",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            oid = ((data.get("bot") or {}) .get("open_id")) if isinstance(data.get("bot"), dict) else None
            if oid:
                _bot_open_id = oid
                logger.info("填报人自动取应用机器人 open_id: %s", oid)
    except Exception as e:
        logger.warning("获取应用机器人 open_id 失败，填报人将留空: %s", e)
    return _bot_open_id or ""


def _guess_video_name(url: str, product_code: str, sku: str) -> str:
    """附件文件名：产品编码_SKU.mp4（从 URL 取扩展名，失败回退 .mp4）"""
    ext = ".mp4"
    path = url.split("?")[0]
    if "." in path.rsplit("/", 1)[-1]:
        suffix = path.rsplit(".", 1)[-1].lower()
        if 1 <= len(suffix) <= 5:
            ext = f".{suffix}"
    prefix = "_".join(p for p in [product_code.strip(), sku.strip()] if p) or "video"
    safe = "".join(c for c in prefix if c not in '\\/:*?"<>|，；; ')[:80] or "video"
    return f"{safe}{ext}"


async def _upload_bitable_attachment(client: "httpx.AsyncClient", auth: dict, name: str, content: bytes) -> str:
    """上传附件到多维表格（新版 media 分片 API），返回 file_token。

    上传点：parent_type=bitable_file，parent_node=多维表 app_token（实测验证）。
    流程：upload_prepare（4MB/片）→ upload_part（seq 从 0）→ upload_finish 拿 file_token。
    """
    size = len(content)
    prep = await client.post(
        f"{FEISHU_API_BASE}/drive/v1/medias/upload_prepare",
        headers={**auth, "Content-Type": "application/json; charset=utf-8"},
        json={
            "file_name": name,
            "parent_type": "bitable_file",
            "parent_node": settings.FEISHU_VIDEO_BASE_TOKEN,
            "size": size,
        },
        timeout=60,
    )
    if prep.status_code != 200:
        raise RuntimeError(f"分片准备 HTTP {prep.status_code}: {prep.text[:120]}")
    pdata = prep.json()
    if pdata.get("code") != 0:
        raise RuntimeError(f"分片准备失败 {pdata.get('msg')}")
    p = pdata.get("data") or {}
    upload_id = p.get("upload_id")
    if not upload_id:
        raise RuntimeError("分片准备未返回 upload_id")
    block_num = int(p.get("block_num") or 1)
    block_size = int(p.get("block_size") or 4194304)

    for seq in range(block_num):
        chunk = content[seq * block_size:(seq + 1) * block_size]
        up = await client.post(
            f"{FEISHU_API_BASE}/drive/v1/medias/upload_part",
            headers=auth,
            data={"upload_id": upload_id, "seq": str(seq), "size": str(len(chunk))},
            files={"file": ("part", chunk, "application/octet-stream")},
            timeout=600,
        )
        if up.status_code != 200:
            raise RuntimeError(f"分片{seq + 1}/{block_num}上传 HTTP {up.status_code}: {up.text[:120]}")
        udata = up.json()
        if udata.get("code") != 0:
            raise RuntimeError(f"分片{seq + 1}/{block_num}上传失败 {udata.get('msg')}")

    fin = await client.post(
        f"{FEISHU_API_BASE}/drive/v1/medias/upload_finish",
        headers={**auth, "Content-Type": "application/json; charset=utf-8"},
        json={"upload_id": upload_id, "block_num": block_num},
        timeout=60,
    )
    if fin.status_code != 200:
        raise RuntimeError(f"分片完成 HTTP {fin.status_code}: {fin.text[:120]}")
    fdata = fin.json()
    if fdata.get("code") != 0:
        raise RuntimeError(f"分片完成失败 {fdata.get('msg')}")
    ft = (fdata.get("data") or {}).get("file_token")
    if not ft:
        raise RuntimeError("分片上传未返回 file_token")
    return ft


async def create_sku_video_records(
    video_urls: List[str], product_code: str, entries: List[Dict[str, str]]
) -> Dict:
    """把一个或多个视频逐条写入多维表 SKU 记录并上传视频附件。

    记录数 = 视频数 × SKU 条目数；多视频时附件名追加序号（产品编码_SKU_1.mp4）
    video_urls 每项为视频地址；entries 每项字段：sku / asin / site / ziniao_account / ziniao_start_name
    返回 {"success": 成功数, "failed": 失败数, "errors": [失败说明]}
    """
    token = await get_access_token()
    auth = {"Authorization": f"Bearer {token}"}
    base = (
        f"{FEISHU_API_BASE}/bitable/v1/apps/{settings.FEISHU_VIDEO_BASE_TOKEN}"
        f"/tables/{settings.FEISHU_VIDEO_TABLE_ID}"
    )
    reporter = await _get_reporter_open_id(token)
    today_ms = int(datetime.now().timestamp() * 1000)

    ok, failed, errors = 0, 0, []
    async with httpx.AsyncClient(timeout=120) as client:
        # 每个视频只下载一次（TOS/CDN 公共读地址），复用给全部 SKU 记录
        videos: List[Dict] = []
        for vi, url in enumerate(video_urls, 1):
            try:
                vresp = await client.get(url, timeout=600)
                vresp.raise_for_status()
                name = _guess_video_name(url, product_code, entries[0].get("sku", "") if entries else "")
                if len(video_urls) > 1:
                    stem, ext = name.rsplit(".", 1)
                    name = f"{stem}_{vi}.{ext}"
                videos.append({"name": name, "bytes": vresp.content})
            except Exception as e:
                raise RuntimeError(f"视频下载失败: {e}") from e

        # 每个视频只上传一次拿 file_token，全部 SKU 记录复用绑定（实测飞书允许跨记录复用），
        # 避免 N 条记录重复分片上传导致接口响应极慢
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
                label = f"{video['name']} → {e.get('sku') or f'第{idx}条'}（{e.get('site') or '-'}）"
                fields = {
                    "ASIN": e.get("asin") or "",
                    "紫鸟登录账号": e.get("ziniao_account") or "",
                    "站点": e.get("site") or "",
                    "填报日期": today_ms,
                }
                if e.get("ziniao_start_name"):
                    fields["紫鸟启动名"] = e["ziniao_start_name"]
                if reporter:
                    fields["填报人"] = [{"id": reporter}]
                fields = {k: v for k, v in fields.items() if v not in ("", None)}

                try:
                    # 1. 建记录；带填报人创建失败时降级重试（人员字段无权限等情况）
                    cres = await client.post(
                        f"{base}/records",
                        headers={**auth, "Content-Type": "application/json"},
                        json={"fields": fields},
                    )
                    if cres.status_code != 200:
                        failed += 1
                        errors.append(f"{label}: 建记录 HTTP {cres.status_code}: {cres.text[:120]}")
                        continue
                    cdata = cres.json()
                    if cdata.get("code") != 0 and reporter:
                        fields.pop("填报人", None)
                        cres = await client.post(
                            f"{base}/records",
                            headers={**auth, "Content-Type": "application/json"},
                            json={"fields": fields},
                        )
                        cdata = cres.json() if cres.status_code == 200 else {"code": -1, "msg": f"HTTP {cres.status_code}"}
                    if cdata.get("code") != 0:
                        failed += 1
                        errors.append(f"{label}: 建记录失败 {cdata.get('msg')}")
                        continue
                    record_id = (cdata.get("data") or {}).get("record", {}).get("record_id")

                    # 2. 绑定附件到「视频附件」字段（复用 file_token；更新记录必须用 PUT，PATCH 会 404）
                    presp = await client.put(
                        f"{base}/records/{record_id}",
                        headers={**auth, "Content-Type": "application/json"},
                        json={"fields": {"视频附件": [{"file_token": ft}]}},
                    )
                    if presp.status_code != 200:
                        failed += 1
                        errors.append(f"{label}: 视频附件绑定 HTTP {presp.status_code}: {presp.text[:120]}")
                        continue
                    pdata = presp.json()
                    if pdata.get("code") != 0:
                        failed += 1
                        errors.append(f"{label}: 视频附件绑定失败 {pdata.get('msg')}")
                        continue
                    ok += 1
                except Exception as e:
                    failed += 1
                    errors.append(f"{label}: {e}")

    return {"success": ok, "failed": failed, "errors": errors}
