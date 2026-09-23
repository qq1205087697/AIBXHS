from sqlalchemy import Column, Integer, String, Text, DateTime
from models.base import BaseModel


class AIVideoTask(BaseModel):
    """AI 视频生成任务表（MiniMax H3）

    一条记录对应一次「立即生成」：参考图、提示词、参数、生成状态与成片地址。
    生成过程由后台线程轮询 ComfyUI 任务状态并回写本表。
    """
    __tablename__ = "ai_video_tasks"

    id = Column(Integer, primary_key=True, index=True, comment="任务ID")
    tenant_id = Column(Integer, nullable=False, default=0, index=True, comment="租户ID（历史按租户隔离）")
    user_id = Column(Integer, nullable=False, index=True, comment="提交用户ID")
    creator_name = Column(String(100), nullable=True, comment="生成者用户名")
    title = Column(String(200), nullable=True, comment="任务标题（产品名）")
    status = Column(String(20), nullable=False, default="排队中", index=True,
                    comment="状态：排队中/生成中/已完成/失败")

    # 生成参数
    market = Column(String(20), nullable=True, comment="目标市场")
    voiceover_language = Column(String(30), nullable=True, comment="口播语言")
    model = Column(String(50), nullable=True, comment="视频模型")
    resolution = Column(String(20), nullable=True, comment="分辨率档位")
    duration = Column(Integer, nullable=True, comment="视频时长（秒）")
    ratio = Column(String(20), nullable=True, comment="视频比例")
    prompt = Column(Text, nullable=True, comment="提示词")

    images = Column(Text, nullable=True, comment="参考图地址列表（JSON 数组）")
    video_url = Column(String(1000), nullable=True, comment="成片公网地址")

    h3_prompt_id = Column(String(100), nullable=True, index=True, comment="ComfyUI 任务ID")
    error_message = Column(String(1000), nullable=True, comment="失败原因")
    finished_at = Column(DateTime(timezone=True), nullable=True, comment="完成时间")