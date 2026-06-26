from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from models.base import BaseModel


class Department(BaseModel):
    """部门模型"""
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True, comment="部门ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="部门名称")
    description = Column(String(500), nullable=True, comment="部门描述")

    tenant = relationship("Tenant", back_populates="departments")
    users = relationship("UserDepartment", back_populates="department")


class UserDepartment(BaseModel):
    """用户-部门关联模型"""
    __tablename__ = "user_departments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)

    user = relationship("User", back_populates="departments")
    department = relationship("Department", back_populates="users")