import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends, HTTPException
from utils.task_service import TaskService
from backend.auth_jwt import get_current_user, get_admin_user
from backend.schemas import CommentCreate

router = APIRouter(prefix="/api", tags=["评论"])


@router.get("/tasks/{task_id}/comments")
def get_comments(task_id: int, user: dict = Depends(get_current_user)):
    service = TaskService()
    try:
        return {"comments": service.get_comments(task_id)}
    finally:
        service.close()


@router.post("/tasks/{task_id}/comments")
def add_comment(task_id: int, req: CommentCreate, user: dict = Depends(get_current_user)):
    service = TaskService()
    try:
        cid, msg = service.add_comment(task_id, req.user_id, req.content)
        return {"comment_id": cid, "message": msg}
    finally:
        service.close()


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: dict = Depends(get_current_user)):
    service = TaskService()
    try:
        is_admin = user["role"] == "admin"
        ok, msg = service.delete_comment(comment_id, user["id"], is_admin)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"message": msg}
    finally:
        service.close()
