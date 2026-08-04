from sqlalchemy import Column, Integer, String, BigInteger, DECIMAL, Date, ForeignKey, Text
from sqlalchemy.orm import relationship
from models.base import BaseModel
import enum


class MatchType(str, enum.Enum):
    EXACT = "exact"
    PHRASE = "phrase"
    BROAD = "broad"


class AdCampaign(BaseModel):
    __tablename__ = "ad_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    campaign_id = Column(BigInteger, nullable=False, comment="Amazon Campaign ID")
    name = Column(String(255), nullable=False, comment="活动名称")
    budget = Column(DECIMAL(12, 2), comment="日预算")
    budget_type = Column(String(20), default="daily", comment="daily/lifetime")
    targeting_type = Column(String(20), comment="AUTO/MANUAL")
    state = Column(String(20), default="enabled", comment="enabled/paused/archived")
    start_date = Column(Date)
    end_date = Column(Date)
    portfolio_id = Column(BigInteger)


class AdGroup(BaseModel):
    __tablename__ = "ad_groups"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), nullable=False, index=True)
    ad_group_id = Column(BigInteger, nullable=False, comment="Amazon AdGroup ID")
    name = Column(String(255), nullable=False)
    state = Column(String(20), default="enabled")
    default_bid = Column(DECIMAL(12, 2))


class AdKeyword(BaseModel):
    __tablename__ = "ad_keywords"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), nullable=False, index=True)
    ad_group_id = Column(Integer, ForeignKey("ad_groups.id"), nullable=False, index=True)
    keyword_id = Column(BigInteger, nullable=False, comment="Amazon Keyword ID")
    keyword_text = Column(String(500), nullable=False)
    match_type = Column(String(20), comment="exact/phrase/broad")
    bid = Column(DECIMAL(12, 2))
    state = Column(String(20), default="enabled")


class AdTarget(BaseModel):
    __tablename__ = "ad_targets"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), nullable=False, index=True)
    ad_group_id = Column(Integer, ForeignKey("ad_groups.id"), nullable=False, index=True)
    target_id = Column(BigInteger, nullable=False, comment="Amazon Target ID")
    expression_type = Column(String(50), comment="asinSameAs/category")
    expression_value = Column(String(500))
    bid = Column(DECIMAL(12, 2))
    state = Column(String(20), default="enabled")


class AdProductAd(BaseModel):
    __tablename__ = "ad_product_ads"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), nullable=False, index=True)
    ad_group_id = Column(Integer, ForeignKey("ad_groups.id"), nullable=False, index=True)
    ad_id = Column(BigInteger, nullable=False, comment="Amazon Ad ID")
    asin = Column(String(50))
    sku = Column(String(100))
    state = Column(String(20), default="enabled")


class AdNegativeKeyword(BaseModel):
    __tablename__ = "ad_negative_keywords"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("ad_campaigns.id"), nullable=True, index=True)
    ad_group_id = Column(Integer, ForeignKey("ad_groups.id"), nullable=True, index=True)
    keyword_id = Column(BigInteger, nullable=False, comment="Amazon NegativeKeyword ID")
    keyword_text = Column(String(500), nullable=False)
    match_type = Column(String(30), comment="negativeExact/negativePhrase")
    state = Column(String(20), default="enabled")