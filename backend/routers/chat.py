from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, List
from database.database import get_db
from services.chat_service import process_chat, create_session_id
from dependencies import get_current_user
from models.user import User
from models.conversation import ConversationHistory

router = APIRouter(prefix="/api", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str


class ChatSessionResponse(BaseModel):
    id: int
    session_id: str
    title: str
    created_at: str


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: str


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """聊天接口"""
    try:
        session_id = request.session_id or create_session_id()
        reply = process_chat(db, current_user.id, session_id, request.message)
        
        return ChatResponse(
            reply=reply,
            session_id=session_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chat/sessions", response_model=List[ChatSessionResponse])
async def get_chat_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取用户的所有会话"""
    from sqlalchemy import func
    
    # 先获取所有唯一的会话ID
    session_ids = db.query(ConversationHistory.session_id, func.min(ConversationHistory.created_at).label("created_at")) \
                    .filter(ConversationHistory.user_id == current_user.id) \
                    .group_by(ConversationHistory.session_id) \
                    .order_by(func.min(ConversationHistory.created_at).desc()) \
                    .all()
    
    unique_sessions = []
    
    for session_result in session_ids:
        session_id = session_result.session_id
        
        # 获取这个会话的第一条用户消息作为标题
        first_user_message = db.query(ConversationHistory).filter(
            ConversationHistory.user_id == current_user.id,
            ConversationHistory.session_id == session_id,
            ConversationHistory.role == "user"
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
            created_at=session_result.created_at.isoformat() if session_result.created_at else ""
        ))
    
    return unique_sessions


@router.get("/chat/sessions/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_session_messages(session_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取指定会话的消息"""
    messages = db.query(ConversationHistory).filter(
        ConversationHistory.user_id == current_user.id,
        ConversationHistory.session_id == session_id
    ).order_by(ConversationHistory.created_at).all()
    
    return [
        ChatMessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            created_at=msg.created_at.isoformat() if msg.created_at else ""
        )
        for msg in messages
    ]
