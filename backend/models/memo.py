from sqlalchemy import Column, Integer, String, DateTime, Index
from models.base import BaseModel


class Memo(BaseModel):
    """备忘录表，记录首页备忘录事项（按用户隔离）"""
    __tablename__ = "memos"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    user_id = Column(Integer, nullable=False, comment="用户ID（关联 users.id）")
    content = Column(String(500), nullable=False, comment="备忘录内容")
    record_time = Column(DateTime, nullable=False, comment="内容记录时间")
    level = Column(String(10), nullable=False, default="普通", comment="紧急程度：紧急/重要/普通")
    done = Column(Integer, nullable=False, default=0, comment="完成情况：0-未完成 / 1-已完成")

    __table_args__ = (
        Index("idx_memos_user", "user_id"),
        Index("idx_memos_record_time", "record_time"),
    )
