from sqlalchemy import Column, Integer, String, Float
from models.base import BaseModel


class CurrencyRate(BaseModel):
    """汇率表：存储各币种对人民币的汇率"""
    __tablename__ = "currency_rates"

    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    currency_name = Column(String(50), nullable=False, comment="币种（中文名）")
    currency_code = Column(String(10), nullable=False, unique=True, index=True, comment="币种缩写（如USD）")
    rate = Column(Float, nullable=False, comment="汇率（对人民币）")
