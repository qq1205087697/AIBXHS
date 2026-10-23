"""行政机器人待办事项模型（admin_robot_items）

行政人力资源官思维导图落地：按 分类/分组/事项 三级组织，
每个租户首次访问时自动播种初始目录，可自定义增删改状态与负责人。
"""
from sqlalchemy import Column, String, Text, Integer

from models.base import BaseModel


class AdminRobotItem(BaseModel):
    __tablename__ = "admin_robot_items"
    __table_args__ = ({"comment": "行政机器人待办事项表"},)

    id = Column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    tenant_id = Column(Integer, nullable=False, default=1, comment="租户ID")
    category = Column(String(100), nullable=False, comment="一级分类（招聘/入职/内部需求/制度/离职）")
    item_group = Column(String(100), default="", comment="二级分组（如 入职资料/规章制度）")
    title = Column(String(255), nullable=False, comment="事项标题")
    note = Column(Text, comment="说明/备注（思维导图中的联动提示）")
    assignee = Column(String(100), comment="负责人")
    status = Column(String(20), default="未开始", comment="状态：未开始/进行中/已完成")
    sort = Column(Integer, default=0, comment="排序")
