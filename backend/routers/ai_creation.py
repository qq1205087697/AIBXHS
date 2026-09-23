from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List, Optional
import logging

from dependencies import get_current_user
from models.user import User
from services.ai_creation_service import (
    analyze_product_images,
    generate_video_concepts,
    generate_video_prompts,
    generate_voiceover_plans,
    AIAnalysisError,
)
from services.h3_video_service import (
    submit_video_task,
    list_video_tasks,
    delete_video_task,
    H3VideoError,
)
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-creation", tags=["AI 创作中心"])


class ProductProfileRequest(BaseModel):
    product_profile: dict
    market: str = "US"
    duration: int = 30
    aspect_ratio: str = "9:16"
    previous_concepts: Optional[list] = None


class GeneratePromptsRequest(BaseModel):
    product_profile: dict
    concepts: list


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}


def _validate_images(files: List[UploadFile]) -> None:
    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一张图片")
    if len(files) > 9:
        raise HTTPException(status_code=400, detail="最多上传 9 张图片")
    for file in files:
        content_type = (file.content_type or "").lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {file.filename}，请上传 JPEG/PNG/WebP/GIF/BMP 图片"
            )


@router.post("/generate-voiceover-plans")
async def generate_voiceover_plans_endpoint(
    files: List[UploadFile] = File(...),
    duration: int = Form(15),
    target_market: str = Form("美国"),
    voiceover_language: str = Form("自动"),
    aspect_ratio: str = Form("9:16"),
    product_name: str = Form(""),
    specified_types: Optional[str] = Form(None),
    style_preference: str = Form(""),
    avoid_types: Optional[str] = Form(None),
    confirmed_card: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    """
    新方案：上传 1~9 张商品参考图，一次性生成产品信息卡 + 3 套口播视频提示词方案。
    specified_types / avoid_types 为顿号或逗号分隔的类型名。
    """
    _validate_images(files)

    def _split_types(raw: Optional[str]) -> Optional[List[str]]:
        if not raw:
            return None
        items = [t.strip() for t in raw.replace("，", "、").replace(",", "、").split("、")]
        return [t for t in items if t] or None

    if not 5 <= duration <= 30:
        raise HTTPException(status_code=400, detail="视频时长仅支持 5 / 10 / 15 秒")

    logger.info(
        f"[AI创作中心] 用户 {current_user.id} 请求生成口播方案："
        f"{len(files)} 张图, 时长={duration}s, 市场={target_market}, "
        f"语言={voiceover_language}, 比例={aspect_ratio}"
    )

    try:
        result = await generate_voiceover_plans(
            files,
            duration=duration,
            target_market=target_market,
            voiceover_language=voiceover_language,
            aspect_ratio=aspect_ratio,
            product_name=product_name,
            specified_types=_split_types(specified_types),
            style_preference=style_preference,
            avoid_types=_split_types(avoid_types),
            confirmed_card=confirmed_card,
        )
    except AIAnalysisError as e:
        logger.error(f"[AI创作中心] 生成口播方案失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success": True,
        "data": result,
    }


@router.post("/generate-video")
async def generate_video_endpoint(
    files: List[UploadFile] = File(...),
    prompt: str = Form(...),
    duration: int = Form(15),
    resolution: str = Form("0.5"),
    ratio: str = Form("9:16"),
    model: str = Form("minimax-h3"),
    market: str = Form("US"),
    voiceover_language: str = Form("自动"),
    title: str = Form("视频生成任务"),
    current_user: User = Depends(get_current_user),
):
    """
    提交 MiniMax H3 视频生成任务：参考图 + 完整提示词 + 参数。
    生成需较长时间，接口立即返回任务记录，由后台轮询进度并回写状态。
    """
    _validate_images(files)
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="提示词不能为空")
    if not 5 <= duration <= 30:
        raise HTTPException(status_code=400, detail="视频时长仅支持 5 / 10 / 15 秒")

    images = [(f.filename or f"ref-{i}.jpg", await f.read()) for i, f in enumerate(files)]

    logger.info(
        f"[AI创作中心] 用户 {current_user.id} 提交视频生成：{len(images)} 张图, "
        f"时长={duration}s, 分辨率={resolution}, 比例={ratio}, 模型={model}, 市场={market}"
    )

    try:
        task = submit_video_task(
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            creator_name=current_user.username,
            title=title,
            prompt=prompt,
            images=images,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            model=model,
            market=market,
            voiceover_language=voiceover_language,
        )
    except H3VideoError as e:
        logger.error(f"[AI创作中心] 提交视频生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"success": True, "data": task}


@router.get("/video-tasks")
async def list_video_tasks_endpoint(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
):
    """视频生成任务列表（租户内共享，含状态与成片地址），用于生成历史与进度轮询"""
    return {"success": True, "data": list_video_tasks(current_user.tenant_id, limit=limit)}


@router.delete("/video-tasks/{task_id}")
async def delete_video_task_endpoint(
    task_id: int,
    current_user: User = Depends(get_current_user),
):
    """删除视频生成任务记录（租户内任意账号均可删）"""
    delete_video_task(current_user.tenant_id, task_id)
    return {"success": True}


@router.post("/analyze-product")
async def analyze_product(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    【旧方案】上传商品图片（最多 9 张），调用视觉模型分析 Amazon 产品信息。
    返回结构化的产品名称、卖点、类目、关键词等信息。
    """
    _validate_images(files)

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
        f"market={body.market}, duration={body.duration}, aspect_ratio={body.aspect_ratio}, "
        f"previous={len(body.previous_concepts) if body.previous_concepts else 0}"
    )

    try:
        concepts = await generate_video_concepts(
            body.product_profile,
            market=body.market,
            duration=body.duration,
            aspect_ratio=body.aspect_ratio,
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
