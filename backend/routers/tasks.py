from datetime import datetime
from typing import List, Optional

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.database import get_db, engine
from dependencies import get_current_user
from models.task import Task, TaskAssignee, TaskReply
from models.user import User

router = APIRouter(prefix="/tasks", tags=["tasks"])

TASK_STATUSES = ("未开始", "进行中", "已完成")
TASK_PRIORITIES = ("紧急", "重要", "普通")


def _ensure_platforms_column():
    """tasks 表增加 platforms 列（幂等：已存在则跳过）"""
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN platforms VARCHAR(500) NULL "
                "COMMENT '负责平台JSON数组（如 [\\\"amazon\\\"]）'"
            ))
            conn.commit()
    except Exception:
        # 列已存在或其他冲突时忽略
        pass


_ensure_platforms_column()


def _display_name(u: User) -> str:
    return (u.nickname or u.username or "").strip() or str(u.username)


def _parse_deadline(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _aggregate_status(statuses: List[str]) -> str:
    """多人任务的汇总状态：全部完成→已完成，有人进行中→进行中，否则未开始"""
    if statuses and all(s == "已完成" for s in statuses):
        return "已完成"
    if any(s == "进行中" for s in statuses):
        return "进行中"
    return "未开始"


def _parse_platforms(raw: Optional[str]) -> List[str]:
    """解析 platforms JSON 字符串为平台数组"""
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (ValueError, TypeError):
        return []


def _serialize(t: Task, assignees: List[TaskAssignee], replies: List[TaskReply],
               current_user: User, is_publisher: bool) -> dict:
    me_row = next((a for a in assignees if a.user_id == current_user.id), None)
    # 展示状态：接收人用自己行上的状态；发布人（非接收人）用全员汇总状态
    status = me_row.status if me_row else _aggregate_status([a.status for a in assignees])
    return {
        "id": t.id,
        "subject": t.subject,
        "body": t.body or "",
        "platforms": _parse_platforms(t.platforms),
        "publisher_id": t.publisher_id,
        "assigner": t.publisher_name or "未知",
        "deadline": t.deadline.strftime("%Y-%m-%d %H:%M") if t.deadline else "",
        "priority": t.priority if t.priority in TASK_PRIORITIES else "普通",
        "status": status if status in TASK_STATUSES else "未开始",
        "created_at": t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
        "is_publisher": is_publisher,
        "is_assignee": bool(me_row),
        "assignees": [
            {
                "user_id": a.user_id,
                "user_name": a.user_name or "",
                "status": a.status if a.status in TASK_STATUSES else "未开始",
                "completed_at": a.completed_at.strftime("%Y-%m-%d %H:%M") if a.completed_at else "",
            }
            for a in assignees
        ],
        "replies": [
            {
                "content": r.content,
                "sender_name": r.sender_name or "",
                "time": r.created_at.strftime("%m-%d %H:%M") if r.created_at else "",
            }
            for r in replies
        ],
    }


@router.get("")
async def list_tasks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """我的任务列表：我接收的任务 + 我派发的任务（含接收人状态与回复记录）"""
    my_rows = (
        db.query(TaskAssignee)
        .filter(
            TaskAssignee.tenant_id == current_user.tenant_id,
            TaskAssignee.user_id == current_user.id,
            TaskAssignee.deleted_at.is_(None),
        )
        .all()
    )
    my_task_ids = [r.task_id for r in my_rows]
    cond = [Task.publisher_id == current_user.id]
    if my_task_ids:
        cond.append(Task.id.in_(my_task_ids))
    tasks = (
        db.query(Task)
        .filter(
            Task.tenant_id == current_user.tenant_id,
            Task.deleted_at.is_(None),
            or_(*cond),
        )
        .order_by(Task.deadline.asc(), Task.id.desc())
        .all()
    )
    ids = [t.id for t in tasks]
    assignees = (
        db.query(TaskAssignee)
        .filter(
            TaskAssignee.tenant_id == current_user.tenant_id,
            TaskAssignee.task_id.in_(ids),
            TaskAssignee.deleted_at.is_(None),
        )
        .all()
        if ids else []
    )
    replies = (
        db.query(TaskReply)
        .filter(
            TaskReply.tenant_id == current_user.tenant_id,
            TaskReply.task_id.in_(ids),
            TaskReply.deleted_at.is_(None),
        )
        .order_by(TaskReply.id.asc())
        .all()
        if ids else []
    )
    assignee_map: dict = {}
    for a in assignees:
        assignee_map.setdefault(a.task_id, []).append(a)
    reply_map: dict = {}
    for r in replies:
        reply_map.setdefault(r.task_id, []).append(r)
    data = [
        _serialize(t, assignee_map.get(t.id, []), reply_map.get(t.id, []),
                   current_user, t.publisher_id == current_user.id)
        for t in tasks
    ]
    return {"success": True, "data": data}


@router.get("/published")
async def list_published_tasks(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """我派发的任务列表（发布任务页面用：含全部接收人状态与回复记录）"""
    tasks = (
        db.query(Task)
        .filter(
            Task.tenant_id == current_user.tenant_id,
            Task.publisher_id == current_user.id,
            Task.deleted_at.is_(None),
        )
        .order_by(Task.id.desc())
        .all()
    )
    ids = [t.id for t in tasks]
    assignees = (
        db.query(TaskAssignee)
        .filter(
            TaskAssignee.tenant_id == current_user.tenant_id,
            TaskAssignee.task_id.in_(ids),
            TaskAssignee.deleted_at.is_(None),
        )
        .all()
        if ids else []
    )
    replies = (
        db.query(TaskReply)
        .filter(
            TaskReply.tenant_id == current_user.tenant_id,
            TaskReply.task_id.in_(ids),
            TaskReply.deleted_at.is_(None),
        )
        .order_by(TaskReply.id.asc())
        .all()
        if ids else []
    )
    assignee_map: dict = {}
    for a in assignees:
        assignee_map.setdefault(a.task_id, []).append(a)
    reply_map: dict = {}
    for r in replies:
        reply_map.setdefault(r.task_id, []).append(r)
    data = [
        _serialize(t, assignee_map.get(t.id, []), reply_map.get(t.id, []), current_user, True)
        for t in tasks
    ]
    return {"success": True, "data": data}


@router.get("/users")
async def list_tenant_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """同租户在职用户列表（派发任务时选择接收人）"""
    users = (
        db.query(User)
        .filter(
            User.tenant_id == current_user.tenant_id,
            User.status == "active",
            User.deleted_at.is_(None),
        )
        .order_by(User.id.asc())
        .all()
    )
    return {"success": True, "data": [{"id": u.id, "name": _display_name(u), "username": u.username} for u in users]}


class TaskCreatePayload(BaseModel):
    subject: str
    body: Optional[str] = ""
    deadline: Optional[str] = None
    priority: Optional[str] = "普通"
    platforms: Optional[List[str]] = None
    assignee_ids: List[int] = []


@router.post("")
async def create_task(payload: TaskCreatePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """派发任务（可多接收人，姓名写入快照）"""
    subject = (payload.subject or "").strip()
    if not subject:
        return {"success": False, "message": "请填写任务主题"}
    priority = payload.priority if payload.priority in TASK_PRIORITIES else "普通"
    # 接收人必须为同租户在职用户，去重（允许派发给发布人自己）
    unique_ids = []
    for uid in payload.assignee_ids:
        if uid and uid not in unique_ids:
            unique_ids.append(uid)
    assignee_users = []
    if unique_ids:
        assignee_users = (
            db.query(User)
            .filter(
                User.tenant_id == current_user.tenant_id,
                User.status == "active",
                User.deleted_at.is_(None),
                User.id.in_(unique_ids),
            )
            .all()
        )
        if not assignee_users:
            return {"success": False, "message": "接收人不存在或不可用，请重新选择"}
    t = Task(
        tenant_id=current_user.tenant_id,
        subject=subject[:100],
        body=(payload.body or "").strip() or None,
        publisher_id=current_user.id,
        publisher_name=_display_name(current_user)[:50],
        deadline=_parse_deadline(payload.deadline),
        priority=priority,
        platforms=json.dumps([p for p in (payload.platforms or []) if p], ensure_ascii=False)
        if payload.platforms else None,
    )
    db.add(t)
    db.flush()
    for u in assignee_users:
        db.add(TaskAssignee(
            tenant_id=current_user.tenant_id,
            task_id=t.id,
            user_id=u.id,
            user_name=_display_name(u)[:50],
            status="未开始",
        ))
    db.commit()
    db.refresh(t)
    rows = db.query(TaskAssignee).filter(TaskAssignee.task_id == t.id, TaskAssignee.deleted_at.is_(None)).all()
    return {"success": True, "data": _serialize(t, rows, [], current_user, True)}


@router.put("/{task_id}/status")
async def update_my_status(task_id: int, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """更新我在该任务上的状态（状态跟人走，每人独立）"""
    status = payload.get("status")
    if status not in TASK_STATUSES:
        return {"success": False, "message": "无效的任务状态"}
    row = (
        db.query(TaskAssignee)
        .filter(
            TaskAssignee.task_id == task_id,
            TaskAssignee.user_id == current_user.id,
            TaskAssignee.deleted_at.is_(None),
        )
        .first()
    )
    if not row:
        return {"success": False, "message": "你不是该任务的接收人，无法更新状态"}
    row.status = status
    row.completed_at = datetime.now() if status == "已完成" else None
    row.updated_at = datetime.now()
    db.commit()
    return {"success": True, "data": {"task_id": task_id, "status": status}}


class ReplyCreatePayload(BaseModel):
    content: str


@router.post("/{task_id}/replies")
async def create_reply(task_id: int, payload: ReplyCreatePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """任务回复（沟通记录，与状态无关）"""
    content = (payload.content or "").strip()
    if not content:
        return {"success": False, "message": "回复内容不能为空"}
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.tenant_id == current_user.tenant_id, Task.deleted_at.is_(None))
        .first()
    )
    if not task:
        return {"success": False, "message": "任务不存在"}
    r = TaskReply(
        tenant_id=current_user.tenant_id,
        task_id=task_id,
        sender_id=current_user.id,
        sender_name=_display_name(current_user)[:50],
        content=content[:500],
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"success": True, "data": {
        "content": r.content,
        "sender_name": r.sender_name,
        "time": r.created_at.strftime("%m-%d %H:%M") if r.created_at else "",
    }}


class TaskUpdatePayload(BaseModel):
    subject: str
    body: Optional[str] = ""
    deadline: Optional[str] = None
    priority: Optional[str] = "普通"
    platforms: Optional[List[str]] = None
    assignee_ids: List[int] = []


@router.put("/{task_id}")
async def update_task(task_id: int, payload: TaskUpdatePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """编辑任务（仅发布人可改：标题/描述/平台/负责人/优先级/截止时间，原有接收人状态保留）"""
    subject = (payload.subject or "").strip()
    if not subject:
        return {"success": False, "message": "请填写任务主题"}
    t = (
        db.query(Task)
        .filter(Task.id == task_id, Task.tenant_id == current_user.tenant_id, Task.deleted_at.is_(None))
        .first()
    )
    if not t:
        return {"success": False, "message": "任务不存在"}
    if t.publisher_id != current_user.id:
        return {"success": False, "message": "只有任务发布人可以编辑该任务"}
    priority = payload.priority if payload.priority in TASK_PRIORITIES else "普通"

    # 接收人去重（允许发布人自己），校验同租户在职
    unique_ids = []
    for uid in payload.assignee_ids:
        if uid and uid not in unique_ids:
            unique_ids.append(uid)
    assignee_users = []
    if unique_ids:
        assignee_users = (
            db.query(User)
            .filter(
                User.tenant_id == current_user.tenant_id,
                User.status == "active",
                User.deleted_at.is_(None),
                User.id.in_(unique_ids),
            )
            .all()
        )
        if not assignee_users:
            return {"success": False, "message": "接收人不存在或不可用，请重新选择"}

    now = datetime.now()
    t.subject = subject[:100]
    t.body = (payload.body or "").strip() or None
    t.deadline = _parse_deadline(payload.deadline)
    t.priority = priority
    if payload.platforms is not None:
        t.platforms = json.dumps([p for p in payload.platforms if p], ensure_ascii=False) or None
    t.updated_at = now

    # 重建接收人关系：移除的软删，新增的插入（未开始），保留的原状态不动
    old_rows = (
        db.query(TaskAssignee)
        .filter(TaskAssignee.task_id == t.id, TaskAssignee.deleted_at.is_(None))
        .all()
    )
    old_map = {r.user_id: r for r in old_rows}
    new_ids = {u.id for u in assignee_users}
    for uid, row in old_map.items():
        if uid not in new_ids:
            row.deleted_at = now
            row.updated_at = now
    for u in assignee_users:
        if u.id in old_map:
            old_map[u.id].user_name = _display_name(u)[:50]
            old_map[u.id].updated_at = now
        else:
            db.add(TaskAssignee(
                tenant_id=current_user.tenant_id,
                task_id=t.id,
                user_id=u.id,
                user_name=_display_name(u)[:50],
                status="未开始",
            ))
    db.commit()
    db.refresh(t)
    rows = db.query(TaskAssignee).filter(TaskAssignee.task_id == t.id, TaskAssignee.deleted_at.is_(None)).all()
    return {"success": True, "data": _serialize(t, rows, [], current_user, True)}


@router.delete("/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """删除任务（仅发布人可删，三表联动软删）"""
    t = (
        db.query(Task)
        .filter(Task.id == task_id, Task.tenant_id == current_user.tenant_id, Task.deleted_at.is_(None))
        .first()
    )
    if not t:
        return {"success": False, "message": "任务不存在"}
    if t.publisher_id != current_user.id:
        return {"success": False, "message": "只有任务发布人可以删除该任务"}
    now = datetime.now()
    t.deleted_at = now
    t.updated_at = now
    for row in db.query(TaskAssignee).filter(TaskAssignee.task_id == t.id, TaskAssignee.deleted_at.is_(None)).all():
        row.deleted_at = now
        row.updated_at = now
    for row in db.query(TaskReply).filter(TaskReply.task_id == t.id, TaskReply.deleted_at.is_(None)).all():
        row.deleted_at = now
        row.updated_at = now
    db.commit()
    return {"success": True}
