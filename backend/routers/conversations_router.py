import os, sys, logging
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.auth_jwt import get_current_user
from utils.db import execute_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["对话记忆"])


class SaveMessage(BaseModel):
    role: str
    content: str


class SaveMessagesRequest(BaseModel):
    messages: list[SaveMessage]


@router.post("/conversations")
def save_messages(req: SaveMessagesRequest, user: dict = Depends(get_current_user)):
    """批量保存对话消息"""
    try:
        for msg in req.messages:
            execute_query(
                "INSERT INTO conversation_messages (user_id, role, content) VALUES (%s, %s, %s)",
                (user["id"], msg.role, msg.content),
                fetch=False,
            )
        return {"status": "ok", "saved": len(req.messages)}
    except Exception as e:
        logger.exception("保存对话消息失败")
        raise HTTPException(status_code=500, detail="保存对话记录失败，请稍后重试")


@router.get("/conversations")
def load_messages(user: dict = Depends(get_current_user)):
    """加载当前用户的对话历史"""
    try:
        rows = execute_query(
            "SELECT role, content FROM conversation_messages WHERE user_id = %s ORDER BY id ASC",
            (user["id"],),
        )
        return {"messages": [{"role": r["role"], "content": r["content"]} for r in rows]}
    except Exception as e:
        logger.exception("加载对话历史失败")
        raise HTTPException(status_code=500, detail="加载对话记录失败，请稍后重试")


@router.delete("/conversations")
def clear_messages(user: dict = Depends(get_current_user)):
    """清空当前用户的对话记忆和摘要"""
    try:
        execute_query(
            "DELETE FROM conversation_messages WHERE user_id = %s",
            (user["id"],),
            fetch=False,
        )
        execute_query(
            "DELETE FROM memory_summaries WHERE user_id = %s",
            (user["id"],),
            fetch=False,
        )
        return {"status": "ok"}
    except Exception as e:
        logger.exception("清空对话记忆失败")
        raise HTTPException(status_code=500, detail="清空对话记录失败，请稍后重试")
