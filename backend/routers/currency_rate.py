from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database.database import get_db
from dependencies import get_current_user
from models.currency_rate import CurrencyRate
from models.user import User

router = APIRouter(prefix="/currency-rates", tags=["currency-rates"])


@router.get("/")
async def list_currency_rates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """汇率列表：币种名/缩写/对人民币汇率，供数据驾驶舱币种筛选与金额换算"""
    rows = (
        db.query(CurrencyRate)
        .filter(CurrencyRate.deleted_at.is_(None))
        .order_by(CurrencyRate.id)
        .all()
    )
    return {
        "success": True,
        "data": [
            {
                "currency_name": r.currency_name,
                "currency_code": r.currency_code,
                "rate": r.rate,
            }
            for r in rows
        ],
    }
