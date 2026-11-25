from sqlalchemy import Column, Integer, String, DateTime, Text, UniqueConstraint, Index
from models.base import BaseModel


class Task(BaseModel):
    """任务主表（首页任务板块）"""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True, comment="任务ID")
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")
    subject = Column(String(100), nullable=False, comment="任务主题")
    body = Column(Text, nullable=True, comment="任务详情内容")
    publisher_id = Column(Integer, nullable=True, comment="发布人ID（关联 users.id）")
    publisher_name = Column(String(50), nullable=True, comment="发布人姓名快照")
    deadline = Column(DateTime, nullable=True, comment="截止时间")
    priority = Column(String(10), nullable=False, default="普通", comment="优先级：紧急/重要/普通")
    platforms = Column(String(500), nullable=True, comment="负责平台JSON数组（如 [\"amazon\"]）")

    __table_args__ = (
        Index("idx_tasks_publisher", "tenant_id", "publisher_id", "deleted_at"),
        Index("idx_tasks_deadline", "deadline"),
    )


class TaskAssignee(BaseModel):
    """任务接收人关系表（状态跟人走，每人独立）"""
    __tablename__ = "task_assignees"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")
    task_id = Column(Integer, nullable=False, comment="任务ID（关联 tasks.id）")
    user_id = Column(Integer, nullable=False, comment="接收人用户ID（关联 users.id）")
    user_name = Column(String(50), nullable=True, comment="接收人姓名快照")
    status = Column(String(10), nullable=False, default="未开始", comment="状态：未开始/进行中/已完成")
    completed_at = Column(DateTime, nullable=True, comment="完成时间")

    __table_args__ = (
        UniqueConstraint("task_id", "user_id", name="uk_task_user"),
        Index("idx_task_assignees_user", "tenant_id", "user_id", "status", "deleted_at"),
    )


class TaskReply(BaseModel):
    """任务回复表（沟通记录，与状态无关）"""
    __tablename__ = "task_replies"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, nullable=False, index=True, comment="租户ID")
    task_id = Column(Integer, nullable=False, comment="任务ID（关联 tasks.id）")
    sender_id = Column(Integer, nullable=True, comment="回复人ID（关联 users.id）")
    sender_name = Column(String(50), nullable=True, comment="回复人姓名快照")
    content = Column(String(500), nullable=False, comment="回复内容")

    __table_args__ = (
        Index("idx_task_replies_task", "tenant_id", "task_id", "deleted_at"),
    )
