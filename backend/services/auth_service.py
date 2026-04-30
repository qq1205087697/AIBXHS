from datetime import datetime, timedelta
from typing import Optional
from passlib.context import CryptContext
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from models.user import User
from config import get_settings

settings = get_settings()

# 密码加密上下文 - 使用 pbkdf2_sha256 替代 bcrypt，避免 bcrypt 的环境问题
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """哈希密码"""
    # bcrypt 限制密码长度不能超过72字节
    password = password[:72]
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """创建访问令牌"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def get_user(db: Session, username: str) -> Optional[User]:
    """根据用户名获取用户"""
    return db.query(User).filter(User.username == username).first()


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    """认证用户"""
    user = get_user(db, username)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user(db: Session, username: str, email: str, password: str, nickname: Optional[str] = None) -> User:
    """创建用户"""
    from models.tenant import Tenant
    import uuid
    
    # 首先创建一个默认租户
    tenant = Tenant(
        name=f"{username}'s Tenant",
        code=f"tenant-{uuid.uuid4().hex[:8]}"
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    
    hashed_password = get_password_hash(password)
    user = User(
        tenant_id=tenant.id,
        username=username,
        email=email,
        password_hash=hashed_password,
        nickname=nickname or username
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
