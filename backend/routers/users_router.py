import os, sys, logging
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends, HTTPException
from utils.auth import get_all_users, create_user, delete_user
from utils.task_service import TaskService
from backend.auth_jwt import get_current_user, get_admin_user
from backend.schemas import UserCreate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["用户管理"])


@router.get("")
def list_users(user: dict = Depends(get_current_user)):
    try:
        return {"users": get_all_users()}
    except Exception as e:
        logger.exception("获取用户列表失败")
        raise HTTPException(status_code=500, detail="获取用户列表失败")


@router.get("/stats")
def all_user_stats(user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        return {"stats": service.get_all_user_stats()}
    except Exception as e:
        logger.exception("获取用户统计失败")
        raise HTTPException(status_code=500, detail="获取用户统计失败")
    finally:
        service.close()


@router.get("/{user_id}/stats")
def user_stats(user_id: int, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        return {"stats": service.get_user_stats(user_id)}
    except Exception as e:
        logger.exception("获取用户统计失败")
        raise HTTPException(status_code=500, detail="获取用户统计失败")
    finally:
        service.close()


@router.post("")
def add_user(req: UserCreate, user: dict = Depends(get_admin_user)):
    try:
        success, msg = create_user(req.name, req.password, req.role)
    except Exception as e:
        logger.exception("创建用户失败")
        raise HTTPException(status_code=500, detail="创建用户失败，请稍后重试")

    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}


@router.delete("/{user_id}")
def remove_user(user_id: int, user: dict = Depends(get_admin_user)):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="不能删除自己")
    try:
        success, msg = delete_user(user_id)
    except Exception as e:
        logger.exception("删除用户失败")
        raise HTTPException(status_code=500, detail="删除用户失败，请稍后重试")

    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}
