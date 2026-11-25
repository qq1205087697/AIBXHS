from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, Optional
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy.orm import Session
from database.database import get_db
from models.finance import FinanceRecord
from dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/finance", tags=["finance"])

# 费用板块白名单（与前端板块 Tab 一致）
CATEGORIES = ["税务", "工资", "采购", "服务商", "物流商", "收款", "核查", "广告费", "房租物业", "平台费用", "其他"]
# 收支类型白名单
FLOW_TYPES = ["收入", "支出"]


def _serialize(record: FinanceRecord) -> Dict[str, Any]:
    return {
        "id": record.id,
        "category": record.category,
        "flowType": record.flow_type,
        "recordDate": record.record_date.strftime("%Y-%m-%d") if record.record_date else None,
        "amount": float(record.amount) if isinstance(record.amount, Decimal) else record.amount,
        "description": record.description or "",
        "createdBy": record.created_by or "",
        "createdAt": record.created_at.strftime("%Y-%m-%d %H:%M") if record.created_at else None,
    }


@router.get("/records")
async def list_finance_records(
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """查询财务流水（按租户隔离，支持板块/日期范围过滤）"""
    try:
        query = db.query(FinanceRecord).filter(
            FinanceRecord.tenant_id == current_user.tenant_id,
            FinanceRecord.deleted_at.is_(None),
        )
        if category:
            query = query.filter(FinanceRecord.category == category)
        if start_date:
            query = query.filter(FinanceRecord.record_date >= start_date)
        if end_date:
            query = query.filter(FinanceRecord.record_date <= end_date)
        records = query.order_by(FinanceRecord.record_date.desc(), FinanceRecord.id.desc()).all()
        return {"success": True, "data": [_serialize(r) for r in records]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询财务流水失败: {str(e)}")


@router.post("/records")
async def create_finance_record(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """登记一条财务流水（日期/金额/收支类型/板块/摘要）"""
    try:
        category = str(payload.get("category") or "").strip()
        flow_type = str(payload.get("flow_type") or "").strip()
        record_date = str(payload.get("record_date") or "").strip()
        amount = payload.get("amount")
        description = str(payload.get("description") or "").strip()

        if category not in CATEGORIES:
            raise HTTPException(status_code=400, detail=f"无效的费用板块: {category}")
        if flow_type not in FLOW_TYPES:
            raise HTTPException(status_code=400, detail=f"无效的收支类型: {flow_type}")
        try:
            parsed_date = datetime.strptime(record_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效的日期格式: {record_date}（应为 YYYY-MM-DD）")
        try:
            parsed_amount = Decimal(str(amount))
        except Exception:
            raise HTTPException(status_code=400, detail=f"无效的金额: {amount}")
        if parsed_amount <= 0:
            raise HTTPException(status_code=400, detail="金额必须大于 0")

        record = FinanceRecord(
            tenant_id=current_user.tenant_id,
            category=category,
            flow_type=flow_type,
            record_date=parsed_date,
            amount=parsed_amount,
            description=description or None,
            created_by=current_user.username,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return {"success": True, "data": _serialize(record)}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"登记财务流水失败: {str(e)}")


@router.delete("/records/{record_id}")
async def delete_finance_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删除财务流水（软删除）"""
    try:
        record = db.query(FinanceRecord).filter(
            FinanceRecord.id == record_id,
            FinanceRecord.tenant_id == current_user.tenant_id,
            FinanceRecord.deleted_at.is_(None),
        ).first()
        if not record:
            raise HTTPException(status_code=404, detail=f"记录不存在: {record_id}")
        record.deleted_at = datetime.now()
        db.commit()
        return {"success": True, "data": {"id": record_id}}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"删除财务流水失败: {str(e)}")
