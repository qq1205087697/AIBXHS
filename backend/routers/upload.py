"""文件上传路由（图片/视频上传到火山引擎 TOS）"""
import logging

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from pydantic import BaseModel
from dependencies import get_current_user
from models.user import User
from services import tos_service

router = APIRouter(prefix="/api/upload", tags=["upload"])
logger = logging.getLogger(__name__)

# 允许的图片/视频扩展名
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".avi", ".wmv", ".flv", ".mkv", ".webm"}

# 文件大小限制
MAX_IMAGE_SIZE = 10 * 1024 * 1024      # 10MB
MAX_VIDEO_SIZE = 200 * 1024 * 1024     # 200MB


def _get_ext(filename: str) -> str:
    import os
    _, ext = os.path.splitext(filename or "")
    return ext.lower()


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    custom_name: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    """上传图片到 TOS，返回公网访问 URL

    :param custom_name: 自定义文件名（如产品编码），不含扩展名
    """
    ext = _get_ext(file.filename or "")
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式 {ext or '未知'}，支持: {', '.join(ALLOWED_IMAGE_EXT)}"
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="图片大小不能超过 10MB")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="图片内容为空")

    try:
        url = tos_service.upload_image(
            file_bytes, file.filename or "image.jpg",
            custom_name=custom_name.strip() if custom_name else "",
        )
        return {
            "success": True,
            "message": "图片上传成功",
            "data": {
                "url": url,
                "filename": file.filename,
                "size": len(file_bytes),
            }
        }
    except RuntimeError as e:
        logger.error("图片上传失败: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("图片上传失败: %s", e)
        raise HTTPException(status_code=500, detail=f"图片上传失败: {e}")


@router.post("/video")
async def upload_video(
    file: UploadFile = File(...),
    custom_name: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    """上传视频到 TOS，返回公网访问 URL

    :param custom_name: 自定义文件名（如产品编码），不含扩展名
    """
    ext = _get_ext(file.filename or "")
    if ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的视频格式 {ext or '未知'}，支持: {', '.join(ALLOWED_VIDEO_EXT)}"
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_VIDEO_SIZE:
        raise HTTPException(status_code=400, detail="视频大小不能超过 200MB")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="视频内容为空")

    try:
        url = tos_service.upload_video(
            file_bytes, file.filename or "video.mp4",
            custom_name=custom_name.strip() if custom_name else "",
        )
        return {
            "success": True,
            "message": "视频上传成功",
            "data": {
                "url": url,
                "filename": file.filename,
                "size": len(file_bytes),
            }
        }
    except RuntimeError as e:
        logger.error("视频上传失败: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("视频上传失败: %s", e)
        raise HTTPException(status_code=500, detail=f"视频上传失败: {e}")


class DeleteFileRequest(BaseModel):
    file_url: str


@router.post("/delete")
async def delete_upload_file(
    data: DeleteFileRequest,
    current_user: User = Depends(get_current_user),
):
    """根据 URL 删除 TOS 上的文件"""
    if not data.file_url:
        raise HTTPException(status_code=400, detail="缺少文件 URL")
    success = tos_service.delete_file(data.file_url)
    if not success:
        raise HTTPException(status_code=500, detail="删除文件失败")
    return {"success": True, "message": "删除成功"}
