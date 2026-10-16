from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List
import json
import logging

from pydantic import BaseModel

from dependencies import get_current_user
from models.user import User
from services.ai_image_service import (
    submit_image_task,
    list_image_tasks,
    delete_image_task,
    GEN_TYPES,
    ASPECT_RATIO_MAP,
    APLUS_SPECS,
    MAIN_GEN_TYPES,
    BRAND_OPTIONS,
    AIImageError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-image", tags=["AI 生图"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}


class ImageTaskOptionsResponse(BaseModel):
    generation_types: dict
    aspect_ratios: dict


@router.get("/options", response_model=ImageTaskOptionsResponse)
async def get_options(current_user: User = Depends(get_current_user)):
    """生成类型与比例选项（供前端渲染多选/下拉）"""
    return {
        "generation_types": {k: v for k, v in GEN_TYPES.items()},
        "aspect_ratios": {k: v for k, v in ASPECT_RATIO_MAP.items()},
        # v2 分组选项
        "aplus_types": {k: {"label": v["label"], "gen_ratio": v["gen_ratio"],
                             "target_size": list(v["target_size"])}
                         for k, v in APLUS_SPECS.items()},
        "main_types": {k: v for k, v in MAIN_GEN_TYPES.items()},
        "brand_options": BRAND_OPTIONS,
    }


def _validate_images(files: List[UploadFile]) -> List[tuple]:
    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一张参考图")
    if len(files) > 5:
        raise HTTPException(status_code=400, detail="最多上传 5 张参考图")
    result = []
    for file in files:
        content_type = (file.content_type or "").lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {file.filename}，请上传 JPEG/PNG/WebP/GIF/BMP 图片",
            )
        content = file.file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"图片过大: {file.filename}（限 10M）")
        result.append((file.filename or "image.jpg", content))
    return result


@router.post("/tasks")
async def create_image_task(
    files: List[UploadFile] = File(..., description="参考图，1~5 张"),
    title: str = Form("", description="任务标题（产品名）"),
    generation_types: str = Form("[]", description='v1 兼容：生成类型 JSON 数组'),
    aspect_ratio: str = Form("1:1"),
    image_count: int = Form(1, ge=1, le=4),
    # ===== v2 分组参数 =====
    aplus_type: str = Form("", description="A+ 类型（单选）：aplus_advanced/aplus_normal/aplus_mobile，空=未选"),
    main_types: str = Form("[]", description='主副图类型 JSON 数组，如 ["selling_point","white_background"]'),
    main_aspect_ratio: str = Form("1:1", description="主副图生成比例"),
    brand_settings: str = Form("", description='品牌自定义设置 JSON（主色/字体/自定义文本/国家/语言/平台）'),
    product_info: str = Form("", description="商品信息（卖点/材质/场景等）"),
    prompt: str = Form("", description="附加提示词"),
    product_code: str = Form(""),
    product_name: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    """提交商品套图生成任务：落库后立即返回，生成在后台进行"""
    try:
        types = json.loads(generation_types)
        if not isinstance(types, list):
            raise ValueError
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="generation_types 必须是 JSON 数组")
    try:
        main_type_list = json.loads(main_types)
        if not isinstance(main_type_list, (list, dict)):
            raise ValueError
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="main_types 必须是 JSON 数组或对象")
    brand: dict = {}
    if brand_settings:
        try:
            brand = json.loads(brand_settings)
            if not isinstance(brand, dict):
                raise ValueError
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="brand_settings 必须是 JSON 对象")

    images = _validate_images(files)
    try:
        task = submit_image_task(
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            creator_name=current_user.username or "",
            title=title or product_name or "商品套图",
            generation_types=types,
            aspect_ratio=aspect_ratio,
            image_count=image_count,
            product_info=product_info,
            prompt=prompt,
            images=images,
            product_code=product_code,
            product_name=product_name,
            aplus_type=aplus_type or None,
            main_types=main_type_list,
            main_aspect_ratio=main_aspect_ratio,
            brand_settings=brand or None,
        )
    except AIImageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[AI生图] 提交任务异常")
        raise HTTPException(status_code=500, detail=f"提交任务失败: {e}")
    return task


@router.get("/tasks")
async def list_tasks(
    page: int = 1,
    page_size: int = 10,
    keyword: str = "",
    current_user: User = Depends(get_current_user),
):
    """套图生成任务列表（分页，按时间倒序）"""
    return list_image_tasks(
        current_user.tenant_id, page=page, page_size=page_size, keyword=keyword
    )


@router.delete("/tasks/{task_id}")
async def remove_task(task_id: int, current_user: User = Depends(get_current_user)):
    """删除任务记录（软删除，不影响已生成的图片）"""
    delete_image_task(current_user.tenant_id, task_id)
    return {"success": True}
