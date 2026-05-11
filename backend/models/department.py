from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from models.base import BaseModel


class Department(BaseModel):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True, comment="部门ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    name = Column(String(100), nullable=False, comment="部门名称")
    description = Column(String(500), nullable=True, comment="部门描述")

    tenant = relationship("Tenant", back_populates="departments")
    members = relationship("UserDepartment", back_populates="department", cascade="all, delete-orphan")


class UserDepartment(BaseModel):
    __tablename__ = "user_departments"

    id = Column(Integer, primary_key=True, index=True, comment="关联ID")
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True, comment="租户ID")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True, comment="用户ID")
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False, index=True, comment="部门ID")

    department = relationship("Department", back_populates="members")
    user = relationship("User", back_populates="departments")
