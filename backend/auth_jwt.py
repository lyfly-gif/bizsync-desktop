import os
from datetime import datetime, timedelta
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

SECRET_KEY = os.getenv("BIZSYNC_JWT_SECRET", "bizsync-dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

security = HTTPBearer()


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """从 JWT Token 解析当前用户"""
    try:
        payload = decode_token(credentials.credentials)
        user_id = payload.get("user_id")
        name = payload.get("name")
        role = payload.get("role")
        if user_id is None or name is None or role is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的凭据")
        return {"id": user_id, "name": name, "role": role}
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="凭据已过期或无效")


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    """确保当前用户是管理员"""
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可操作")
    return user
