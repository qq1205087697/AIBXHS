from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
from concurrent.futures import ThreadPoolExecutor
from database.database import SessionLocal, get_db
from services.chat_service import process_chat, create_session_id, save_message, get_conversation_history
from services.streaming_service import StreamingService
from dependencies import get_current_user
from models.user import User
from models.conversation import ConversationHistory
from schemas.chat_schemas import (
    ChatRequest, ChatResponse, ChatSearchRequest, ChatExportRequest,
    ChatSessionResponse, ChatMessageResponse
)
import json
import asyncio
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])

# ============================================================
# 专用 AI 线程池 + 信号量
# - 线程池大小 10：允许最多 10 个 AI 请求并行执行
# - 信号量大小 5 ：同时调用 OpenAI API 的并发数不超过 5
#   （避免 API 限流 429 + 控制数据库连接消耗）
# ============================================================
AI_THREAD_POOL = ThreadPoolExecutor(max_workers=10, thread_name_prefix="ai_worker")

# 初始化流式服务
streaming_service = StreamingService()


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    request: ChatRequest,
    current_user: User = Depends(get_current_user)
):
    """标准聊天接口（非流式）- 专用线程池 + 信号量控制并发"""
    logger.info(f"[CHAT] 收到聊天请求: user_id={current_user.id}, message={request.message}, chat_type={request.chat_type}")
    try:
        session_id = request.session_id or create_session_id()

        def _run_with_semaphore():
            """在信号量保护下执行，防止 AI 并发过高"""
            db = SessionLocal()
            try:
                return process_chat(
                    db, current_user.id, session_id,
                    request.message,
                    request.chat_type
                )
            finally:
                db.close()

        reply = await asyncio.get_event_loop().run_in_executor(
            AI_THREAD_POOL, _run_with_semaphore
        )

        logger.info(f"[CHAT] 处理完成: session_id={session_id}")
        return ChatResponse(
            reply=reply,
            session_id=session_id
        )
    except Exception as e:
        logger.error(f"[CHAT] 错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
async def chat_stream_endpoint(
    request: ChatRequest,
    current_user: User = Depends(get_current_user)
):
    """流式聊天接口 - SSE - 按需创建 DB 连接，分段释放避免长连接占用"""

    session_id = request.session_id or create_session_id()

    def event_generator():
        """流式生成器：每次 DB 操作按需创建连接，用完即释放"""
        # 阶段1：保存用户消息 + 获取历史（短连接）
        AI_SEMAPHORE.acquire()
        try:
            db = SessionLocal()
            try:
                save_message(db, current_user.id, session_id, "user", request.message, chat_type=request.chat_type)
                history = get_conversation_history(db, current_user.id, session_id, limit=10)
            finally:
                db.close()

            # 阶段2：流式生成响应
            for chunk in streaming_service.stream_chat_response_lightweight(
                user_id=current_user.id,
                session_id=session_id,
                user_message=request.message,
                chat_type=request.chat_type,
                history=history
            ):
                yield chunk
        finally:
            AI_SEMAPHORE.release()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/chat/search")
async def search_chat_sessions(
    request: ChatSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """搜索对话历史"""
    from sqlalchemy import or_, func

    query = db.query(ConversationHistory).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.is_deleted == False,
        or_(
            ConversationHistory.content.ilike(f"%{request.query}%"),
            ConversationHistory.session_id.in_(
                db.query(ConversationHistory.session_id)
                .filter(
                    ConversationHistory.user_id == current_user.id,
                    ConversationHistory.role == "user",
                    ConversationHistory.is_deleted == False,
                    ConversationHistory.content.ilike(f"%{request.query}%")
                )
                .distinct()
            )
        )
    )

    if request.chat_type:
        query = query.filter(ConversationHistory.chat_type == request.chat_type)

    # 按会话分组，获取最新的匹配记录
    results = query.order_by(ConversationHistory.created_at.desc()).limit(request.limit).all()

    # 获取唯一的会话ID
    session_ids = list(set([r.session_id for r in results]))

    # 构建响应
    sessions = []
    for sid in session_ids[:request.limit]:
        first_msg = db.query(ConversationHistory).filter(
            ConversationHistory.user_id == current_user.id,
            ConversationHistory.session_id == sid,
            ConversationHistory.role == "user"
        ).order_by(ConversationHistory.created_at).first()

        msg_count = db.query(ConversationHistory).filter(
            ConversationHistory.user_id == current_user.id,
            ConversationHistory.session_id == sid
        ).count()

        sessions.append({
            "session_id": sid,
            "title": first_msg.content[:30] + "..." if first_msg and len(first_msg.content) > 30 else (first_msg.content if first_msg else "新会话"),
            "created_at": first_msg.created_at.isoformat() if first_msg else "",
            "message_count": msg_count
        })

    return sessions


@router.post("/chat/export")
async def export_chat_session(
    request: ChatExportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导出对话记录"""
    from fastapi.responses import PlainTextResponse

    messages = db.query(ConversationHistory).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.session_id == request.session_id,
        ConversationHistory.is_deleted == False
    ).order_by(ConversationHistory.created_at).all()

    if not messages:
        raise HTTPException(status_code=404, detail="会话不存在或为空")

    if request.format == "json":
        content = json.dumps([{
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat()
        } for m in messages], ensure_ascii=False, indent=2)
        return PlainTextResponse(content, media_type="application/json")

    elif request.format == "markdown":
        lines = ["# 对话记录\n"]
        for m in messages:
            role_name = "AI" if m.role == "assistant" else "用户"
            lines.append(f"## {role_name} - {m.created_at.strftime('%Y-%m-%d %H:%M')}\n")
            lines.append(f"{m.content}\n")
        return PlainTextResponse("\n".join(lines), media_type="text/markdown")

    else:  # txt
        lines = ["对话记录\n", "=" * 50 + "\n"]
        for m in messages:
            role_name = "AI" if m.role == "assistant" else "用户"
            lines.append(f"[{m.created_at.strftime('%Y-%m-%d %H:%M')}] {role_name}:\n")
            lines.append(f"{m.content}\n\n")
        return PlainTextResponse("\n".join(lines), media_type="text/plain")


@router.get("/chat/sessions", response_model=List[ChatSessionResponse])
async def get_chat_sessions(
    chat_type: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户的所有会话，可按chat_type过滤"""
    from sqlalchemy import func

    # 构建基础查询（排除已删除的）
    base_query = db.query(
        ConversationHistory.session_id,
        func.min(ConversationHistory.created_at).label("created_at")
    ).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.is_deleted == False
    )

    # 如果指定了chat_type，添加过滤条件
    if chat_type:
        base_query = base_query.filter(ConversationHistory.chat_type == chat_type)

    session_ids = base_query.group_by(
        ConversationHistory.session_id
    ).order_by(func.min(ConversationHistory.created_at).desc()).all()

    unique_sessions = []

    for session_result in session_ids:
        session_id = session_result.session_id

        # 获取这个会话的第一条用户消息作为标题（排除已删除的）
        first_user_message = db.query(ConversationHistory).filter(
            ConversationHistory.user_id == current_user.id,
            ConversationHistory.session_id == session_id,
            ConversationHistory.role == "user",
            ConversationHistory.is_deleted == False
        ).order_by(ConversationHistory.created_at).first()

        # 使用第一条用户消息作为标题，截取前30字符
        title = "新会话"
        if first_user_message and first_user_message.content:
            title = first_user_message.content[:30]
            if len(first_user_message.content) > 30:
                title += "..."

        unique_sessions.append(ChatSessionResponse(
            id=first_user_message.id if first_user_message else 0,
            session_id=session_id,
            title=title,
            created_at=session_result.created_at.isoformat() if session_result.created_at else "",
            message_count=0
        ))

    return unique_sessions


@router.get("/chat/sessions/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定会话的消息（限制最近100条，排除已删除的）"""
    messages = db.query(ConversationHistory).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.session_id == session_id,
        ConversationHistory.is_deleted == False
    ).order_by(ConversationHistory.created_at.desc()).limit(100).all()
    # 按时间正序返回
    messages.reverse()

    return [
        ChatMessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            created_at=msg.created_at.isoformat() if msg.created_at else "",
            function_name=msg.function_name
        )
        for msg in messages
    ]


@router.delete("/chat/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """软删除指定会话及其所有消息"""
    from sqlalchemy import func

    # 检查会话是否存在且属于当前用户
    exists = db.query(ConversationHistory).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.session_id == session_id,
        ConversationHistory.is_deleted == False
    ).first()

    if not exists:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 软删除该会话的所有消息
    db.query(ConversationHistory).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.session_id == session_id
    ).update({"is_deleted": True}, synchronize_session=False)

    db.commit()
    return {"message": "会话已删除"}
