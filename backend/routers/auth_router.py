import os, sys, logging
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends, HTTPException
from utils.auth import authenticate_user, get_all_users, create_user, delete_user
from backend.auth_jwt import create_access_token, get_current_user, get_admin_user
from backend.schemas import LoginRequest, UserCreate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login")
def login(req: LoginRequest):
    try:
        user = authenticate_user(req.username, req.password)
    except Exception as e:
        logger.exception("登录验证失败")
        raise HTTPException(status_code=500, detail="服务器内部错误，请稍后重试")

    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_access_token({"user_id": user["id"], "name": user["name"], "role": user["role"]})
    return {"token": token, "user": user}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": user}
