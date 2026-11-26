from sqlalchemy import Column, Integer, String, Date, DECIMAL, Index
from models.base import BaseModel


class FinanceRecord(BaseModel):
    """财务机器人流水表，记录各费用板块的收支明细（按租户隔离）"""
    __tablename__ = "finance_records"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    tenant_id = Column(Integer, nullable=False, comment="租户ID")
    category = Column(String(20), nullable=False, comment="费用板块：税务/工资/采购/服务商/物流商/收款/核查/广告费/房租物业/平台费用/其他")
    flow_type = Column(String(10), nullable=False, comment="收支类型：收入/支出")
    record_date = Column(Date, nullable=False, comment="业务发生日期")
    amount = Column(DECIMAL(14, 2), nullable=False, comment="金额")
    description = Column(String(200), nullable=True, comment="摘要说明")
    created_by = Column(String(50), nullable=True, comment="登记人")

    __table_args__ = (
        Index("idx_finance_tenant_category", "tenant_id", "category"),
        Index("idx_finance_record_date", "record_date"),
    )
