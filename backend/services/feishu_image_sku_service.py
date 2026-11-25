"""飞书多维表 - Amazon 图片上传服务

媒体任务中心的图片素材（主图/附图/A+）按 SKU 写入图片上传多维表（外部 RPA 消费）：
字段 SKU / 紫鸟账号 / 店铺名 / 站点 / 图片（附件）/ 类型。

app_token / table_id 从 .env 读取（FEISHU_IMAGE_BASE_TOKEN / FEISHU_IMAGE_TABLE_ID），
未配置时调用侧提示去 .env 填写。附件上传复用视频表服务的飞书工具函数。
"""

from datetime import datetime
from typing import Dict, List, Optional

import httpx

from config import get_settings
from services.feishu_video_sku_service import FEISHU_API_BASE, _upload_bitable_attachment, get_access_token


def feishu_image_configured() -> bool:
    """图片上传表是否已在 .env 配置（BASE_TOKEN + TABLE_ID）。"""
    s = get_settings()
    return bool(s.FEISHU_IMAGE_BASE_TOKEN and s.FEISHU_IMAGE_TABLE_ID)


def _guess_image_name(url: str, product_code: str) -> str:
    stem = (product_code or "image").strip() or "image"
    path = url.split("?")[0]
    ext = "jpg"
    last = path.rsplit("/", 1)[-1]
    if "." in last:
        ext = last.rsplit(".", 1)[-1].lower()[:5] or "jpg"
    return f"{stem}_{int(datetime.now().timestamp())}.{ext}"


async def create_sku_image_records(
    image_url: str,
    product_code: str,
    entries: List[Dict],
    image_type: str = "附图",
    request_id: Optional[int] = None,
) -> Dict:
    """把一张图片按 SKU 写入图片上传多维表记录并上传图片附件。

    request_id：媒体任务单据 ID，写入「单据ID」（文本）字段，供影刀 RPA 精确回写数据库状态。
    entries 由 _load_platform_sku_entries 提供，字段：sku / ziniao_account / store_name / site。
    返回 {"success": 成功条数, "failed": 失败条数, "errors": [明细]}。
    """
    token = await get_access_token()
    auth = {"Authorization": f"Bearer {token}"}
    s = get_settings()
    base = (
        f"{FEISHU_API_BASE}/bitable/v1/apps/{s.FEISHU_IMAGE_BASE_TOKEN}"
        f"/tables/{s.FEISHU_IMAGE_TABLE_ID}"
    )

    ok, failed, errors = 0, 0, []
    async with httpx.AsyncClient(timeout=120) as client:
        # 下载图片并上传为飞书附件（所有 SKU 记录复用同一 file_token）
        try:
            iresp = await client.get(image_url)
            iresp.raise_for_status()
            name = _guess_image_name(image_url, product_code)
            file_token = await _upload_bitable_attachment(
                client, auth, name, iresp.content, parent_node=s.FEISHU_IMAGE_BASE_TOKEN
            )
        except Exception as e:
            raise RuntimeError(f"图片下载或上传飞书附件失败：{str(e)[:160]}") from e

        for idx, e in enumerate(entries, 1):
            label = f"{name} → {e.get('sku') or f'第{idx}条'}（{e.get('site') or '-'}）"
            fields = {
                "SKU": e.get("sku") or "",
                "紫鸟账号": e.get("ziniao_account") or "",
                "店铺": e.get("store_name") or "",
                "站点": e.get("site") or "",
                "类型": image_type or "附图",
            }
            if request_id is not None:
                fields["单据ID"] = str(request_id)
            fields = {k: v for k, v in fields.items() if v not in ("", None)}
            try:
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
                if cdata.get("code") != 0:
                    failed += 1
                    errors.append(f"{label}: 建记录失败 {cdata.get('msg')}")
                    continue
                record_id = (cdata.get("data") or {}).get("record", {}).get("record_id")

                # 绑定图片附件到「图片」字段
                ures = await client.put(
                    f"{base}/records/{record_id}",
                    headers={**auth, "Content-Type": "application/json"},
                    json={"fields": {"图片": [{"file_token": file_token}]}},
                )
                udata = ures.json() if ures.status_code == 200 else {"code": -1, "msg": f"HTTP {ures.status_code}"}
                if udata.get("code") != 0:
                    failed += 1
                    errors.append(f"{label}: 图片附件绑定失败 {udata.get('msg')}")
                    continue
                ok += 1
            except Exception as e:
                failed += 1
                errors.append(f"{label}: {str(e)[:160]}")

    return {"success": ok, "failed": failed, "errors": errors}
