from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.database import get_db
from dependencies import get_current_user
from models.memo import Memo
from models.user import User

router = APIRouter(prefix="/memos", tags=["memos"])

MEMO_LEVELS = ("紧急", "重要", "普通")


def _serialize(m: Memo) -> dict:
    return {
        "id": m.id,
        "content": m.content,
        "record_time": m.record_time.strftime("%Y-%m-%d %H:%M:%S") if m.record_time else "",
        "record_date": m.record_time.strftime("%Y-%m-%d") if m.record_time else "",
        "level": m.level if m.level in MEMO_LEVELS else "普通",
        "done": 1 if m.done else 0,
    }


@router.get("")
async def list_memos(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """当前登录用户的备忘录列表（未完成置顶，其余按记录时间倒序）"""
    rows = (
        db.query(Memo)
        .filter(Memo.user_id == current_user.id, Memo.deleted_at.is_(None))
        .order_by(Memo.done.asc(), Memo.record_time.desc(), Memo.id.desc())
        .all()
    )
    return {"success": True, "data": [_serialize(r) for r in rows]}


class MemoCreateItem(BaseModel):
    content: str
    level: Optional[str] = "普通"
    record_time: str  # YYYY-MM-DD（事项所属日期）


class MemoCreatePayload(BaseModel):
    items: List[MemoCreateItem]


@router.post("")
async def create_memos(payload: MemoCreatePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """批量新增备忘录（支持弹窗多行一次提交）"""
    now = datetime.now()
    created = []
    for item in payload.items:
        text = (item.content or "").strip()
        if not text:
            continue
        try:
            rec_dt = datetime.strptime(item.record_time, "%Y-%m-%d")
        except (ValueError, TypeError):
            rec_dt = now
        level = item.level if item.level in MEMO_LEVELS else "普通"
        m = Memo(user_id=current_user.id, content=text[:500], record_time=rec_dt, level=level, done=0)
        db.add(m)
        created.append(m)
    if created:
        db.commit()
        for m in created:
            db.refresh(m)
    return {"success": True, "created": len(created), "data": [_serialize(m) for m in created]}


@router.put("/{memo_id}/toggle")
async def toggle_memo(memo_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """切换完成/未完成状态"""
    m = (
        db.query(Memo)
        .filter(Memo.user_id == current_user.id, Memo.id == memo_id, Memo.deleted_at.is_(None))
        .first()
    )
    if not m:
        return {"success": False, "message": "备忘录不存在"}
    m.done = 0 if m.done else 1
    m.updated_at = datetime.now()
    db.commit()
    db.refresh(m)
    return {"success": True, "data": _serialize(m)}


@router.delete("/{memo_id}")
async def delete_memo(memo_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """软删除备忘录"""
    m = (
        db.query(Memo)
        .filter(Memo.user_id == current_user.id, Memo.id == memo_id, Memo.deleted_at.is_(None))
        .first()
    )
    if not m:
        return {"success": False, "message": "备忘录不存在"}
    m.deleted_at = datetime.now()
    m.updated_at = datetime.now()
    db.commit()
    return {"success": True}
