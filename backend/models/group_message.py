from sqlalchemy import Column, Integer, String, Text, DateTime, Index, event, text
from models.base import BaseModel


class GroupMessage(BaseModel):
    """群消息表，记录群聊消息"""
    __tablename__ = "group_messages"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    group_id = Column(Integer, nullable=False, comment="群ID（数字编号，按群名自动分配）")
    group_name = Column(String(255), nullable=True, comment="群名")
    message_body = Column(Text, nullable=True, comment="消息主体")
    message_id = Column(String(64), nullable=False, comment="消息ID")
    sender_name = Column(String(255), nullable=True, comment="发送人名称")
    received_at = Column(DateTime, nullable=False, comment="接收时间（精确到时分）")

    __table_args__ = (
        Index("idx_group_messages_message_id", "message_id"),
        Index("idx_group_messages_group_id", "group_id"),
        Index("idx_group_messages_received_at", "received_at"),
    )


class GroupsFs(BaseModel):
    """群表，记录群基础信息"""
    __tablename__ = "groups_fs"

    group_id = Column(Integer, primary_key=True, autoincrement=True, comment="群ID（自增主键）")
    group_name = Column(String(255), nullable=True, comment="群名")


@event.listens_for(GroupMessage, "before_insert")
def assign_numeric_group_id(mapper, connection, target):
    """群消息新增前，按群名关联群表：
    groups_fs 中已存在该群名 → 复用其自增群ID；
    不存在 → 插入群表由 AUTO_INCREMENT 生成新群ID，消息使用该ID"""
    group_name = (target.group_name or "").strip()
    row = connection.execute(
        text("SELECT group_id FROM groups_fs WHERE group_name = :gname LIMIT 1"),
        {"gname": group_name},
    ).fetchone()
    if row:
        target.group_id = row[0]
        return
    connection.execute(
        text(
            "INSERT INTO groups_fs (group_name, created_at, updated_at) "
            "VALUES (:gname, NOW(), NOW())"
        ),
        {"gname": group_name},
    )
    target.group_id = connection.execute(text("SELECT LAST_INSERT_ID()")).scalar()


class GroupUserPermission(BaseModel):
    """用户-群权限关系表，记录用户可见群及操作权限"""
    __tablename__ = "group_user_permissions"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    group_id = Column(Integer, nullable=False, index=True, comment="群ID（关联 groups_fs.group_id）")
    user_id = Column(Integer, nullable=False, index=True, comment="用户ID（关联 users.id）")
    permission = Column(String(16), nullable=False, comment="权限：manage-管理 / edit-编辑 / read-阅读")

    __table_args__ = (
        Index("uk_group_user", "group_id", "user_id", unique=True),
    )
