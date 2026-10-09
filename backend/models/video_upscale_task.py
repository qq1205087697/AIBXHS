from sqlalchemy import Column, Integer, String, DateTime, Text, Float
from models.base import BaseModel


class VideoUpscaleTask(BaseModel):
    """视频超分（Topaz 星光 2.6）任务"""
    __tablename__ = "video_upscale_tasks"

    id = Column(Integer, primary_key=True, index=True, comment="任务ID")
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")
    user_id = Column(Integer, nullable=True, comment="提交人ID")
    creator_name = Column(String(100), nullable=True, comment="提交人用户名")
    title = Column(String(200), nullable=True, comment="任务标题")
    source_video_url = Column(String(1000), nullable=False, comment="源视频公网地址（TOS）")
    source_width = Column(Integer, nullable=True, comment="源视频宽度")
    source_height = Column(Integer, nullable=True, comment="源视频高度")
    scale = Column(Float, nullable=True, comment="放大倍数")
    status = Column(String(20), default="排队中", index=True, comment="状态：排队中/处理中/已完成/失败")
    error_message = Column(Text, nullable=True, comment="失败原因")
    video_url = Column(String(1000), nullable=True, comment="超分结果视频（TOS）")
    comfy_prompt_id = Column(String(64), nullable=True, comment="ComfyUI 任务ID")
    started_at = Column(DateTime, nullable=True, comment="开始处理时间（首次进入处理中）")
    finished_at = Column(DateTime, nullable=True, comment="完成/失败时间")
