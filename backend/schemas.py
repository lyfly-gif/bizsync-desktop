from pydantic import BaseModel
from typing import Optional


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: dict


class UserCreate(BaseModel):
    name: str
    password: str
    role: str = "user"


class UserResponse(BaseModel):
    id: int
    name: str
    role: str


class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = None
    deadline: Optional[str] = None
    status: str = "Todo"


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    deadline: Optional[str] = None
    status: Optional[str] = None


class TaskCreate(BaseModel):
    project_id: int
    title: str
    assignee: str = "未分配"
    deadline: Optional[str] = None
    priority: str = "Medium"
    description: Optional[str] = None
    dependencies: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    assignee: Optional[str] = None
    assignee_id: Optional[int] = None
    deadline: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    dependencies: Optional[str] = None


class TaskComplete(BaseModel):
    user_id: int


class BatchUpdate(BaseModel):
    task_ids: list[int]
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee: Optional[str] = None


class BatchDelete(BaseModel):
    task_ids: list[int]


class CommentCreate(BaseModel):
    user_id: int
    content: str


class TaskReject(BaseModel):
    reason: str = ""


class TaskListDispatch(BaseModel):
    project_title: str
    tasks: list[dict]
    creator_id: int = 1
