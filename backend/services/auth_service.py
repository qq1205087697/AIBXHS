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
    """根据用户名或邮箱获取用户"""
    user = db.query(User).filter(User.username == username).first()
    if user:
        return user
    # 如果没有找到用户，尝试通过邮箱查找
    return db.query(User).filter(User.email == username).first()


def authenticate_user(db: Session, username_or_email: str, password: str) -> Optional[User]:
    """认证用户（支持用户名或邮箱）"""
    user = get_user(db, username_or_email)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user(
    db: Session,
    username: str,
    email: str,
    password: str,
    nickname: Optional[str] = None,
    company_name: Optional[str] = None,
    company_code: Optional[str] = None
) -> User:
    """创建用户（支持公司选择）"""
    from models.tenant import Tenant
    import uuid, random, string

    if company_code:
        company_code = company_code.strip()
        # 查找已有公司
        tenant = db.query(Tenant).filter(Tenant.code == company_code, Tenant.deleted_at.is_(None)).first()
        if tenant:
            # 公司已存在，加入该公司
            pass
        else:
            # 公司不存在，自动创建
            company_name = (company_name or company_code).strip()
            tenant = Tenant(
                name=company_name,
                code=company_code,
                is_personal=0
            )
            db.add(tenant)
            db.commit()
            db.refresh(tenant)
    else:
        # 未填公司编号，自动创建个人公司
        tenant = Tenant(
            name=f"{username}的个人公司",
            code=f"personal-{uuid.uuid4().hex[:8]}",
            is_personal=1
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
