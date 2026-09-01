from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List, Optional
import logging

from dependencies import get_current_user
from models.user import User
from services.ai_creation_service import (
    analyze_product_images,
    generate_video_concepts,
    generate_video_prompts,
    AIAnalysisError,
)
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-creation", tags=["AI 创作中心"])


class ProductProfileRequest(BaseModel):
    product_profile: dict
    market: str = "US"
    duration: int = 30
    previous_concepts: Optional[list] = None


class GeneratePromptsRequest(BaseModel):
    product_profile: dict
    concepts: list


@router.post("/analyze-product")
async def analyze_product(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    上传商品图片（最多 9 张），调用 GPT 视觉模型分析 Amazon 产品信息。
    返回结构化的产品名称、卖点、类目、关键词等信息。
    """
    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一张图片")

    if len(files) > 9:
        raise HTTPException(status_code=400, detail="最多上传 9 张图片")

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}
    for file in files:
        content_type = file.content_type or ""
        if content_type.lower() not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {file.filename}，请上传 JPEG/PNG/WebP/GIF/BMP 图片"
            )

    logger.info(f"[AI创作中心] 用户 {current_user.id} 上传 {len(files)} 张图片进行产品分析")

    try:
        result = await analyze_product_images(files)
    except AIAnalysisError as e:
        logger.error(f"[AI创作中心] 分析失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if not result:
        raise HTTPException(status_code=500, detail="AI 分析结果为空，请稍后重试")

    return {
        "success": True,
        "data": result,
    }


@router.post("/generate-video-concepts")
async def generate_video_concepts_endpoint(
    body: ProductProfileRequest,
    current_user: User = Depends(get_current_user),
):
    """根据产品画像生成 3 个差异化带货视频创意"""
    if not body.product_profile:
        raise HTTPException(status_code=400, detail="产品画像不能为空")

    logger.info(
        f"[AI创作中心] 用户 {current_user.id} 请求生成视频创意，"
        f"market={body.market}, duration={body.duration}, "
        f"previous={len(body.previous_concepts) if body.previous_concepts else 0}"
    )

    try:
        concepts = await generate_video_concepts(
            body.product_profile,
            market=body.market,
            duration=body.duration,
            previous_concepts=body.previous_concepts,
        )
    except AIAnalysisError as e:
        logger.error(f"[AI创作中心] 生成视频创意失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success": True,
        "data": concepts,
    }


@router.post("/generate-video-prompts")
async def generate_video_prompts_endpoint(
    body: GeneratePromptsRequest,
    current_user: User = Depends(get_current_user),
):
    """根据产品画像和 3 个视频创意生成 3 套最终视频提示词"""
    if not body.product_profile:
        raise HTTPException(status_code=400, detail="产品画像不能为空")
    if not body.concepts or len(body.concepts) != 3:
        raise HTTPException(status_code=400, detail="必须提供 3 个视频创意")

    logger.info(f"[AI创作中心] 用户 {current_user.id} 请求生成视频提示词")

    try:
        prompts = await generate_video_prompts(body.product_profile, body.concepts)
    except AIAnalysisError as e:
        logger.error(f"[AI创作中心] 生成视频提示词失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success": True,
        "data": prompts,
    }
