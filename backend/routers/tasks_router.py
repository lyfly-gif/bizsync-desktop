import os, sys, uuid
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from utils.task_service import TaskService
from backend.auth_jwt import get_current_user, get_admin_user
from backend.schemas import TaskUpdate, TaskComplete, BatchUpdate, BatchDelete, TaskReject

router = APIRouter(prefix="/api/tasks", tags=["任务管理"])


@router.get("")
def list_tasks(
    user_id: int = Query(None),
    overdue: bool = Query(False),
    urgent_min: float = Query(None),
    urgent_max: float = Query(None),
    user: dict = Depends(get_current_user),
):
    service = TaskService()
    try:
        if user["role"] == "admin" and user_id:
            tasks = service.get_user_tasks_by_admin(user_id)
        elif overdue:
            tasks = service.get_overdue_tasks()
        elif urgent_min is not None and urgent_max is not None:
            tasks = service.get_urgent_tasks(urgent_min, urgent_max)
        else:
            tasks = service.get_my_tasks(user["id"])
        return {"tasks": tasks}
    finally:
        service.close()


@router.put("/{task_id}")
def update_task(task_id: int, req: TaskUpdate, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        kwargs = {k: v for k, v in req.dict(exclude_none=True).items()}
        ok, msg = service.update_task(task_id, **kwargs)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"message": msg}
    finally:
        service.close()


@router.put("/{task_id}/complete")
def complete_task(task_id: int, req: TaskComplete, user: dict = Depends(get_current_user)):
    """管理员审批通过任务（员工不能自行打卡完成）"""
    service = TaskService()
    try:
        # 员工不能直接完成——需管理员审批
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="只有管理员可以审批通过任务，请上传文件提交审核。")
        ok, msg = service.complete_task(task_id, req.user_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        # 同时标记审核通过
        from utils.db import execute_query
        execute_query(
            "UPDATE tasks SET review_status = 'approved' WHERE id = %s",
            (task_id,),
            fetch=False,
        )
        return {"message": msg}
    finally:
        service.close()


@router.delete("/{task_id}")
def delete_task(task_id: int, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        ok, msg = service.delete_task(task_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"message": msg}
    finally:
        service.close()


@router.get("/{task_id}/dependencies")
def get_dependencies(task_id: int, user: dict = Depends(get_current_user)):
    service = TaskService()
    try:
        deps = service.get_task_dependencies(task_id)
        return {"dependencies": deps}
    finally:
        service.close()


UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/{task_id}/upload")
async def upload_task_file(task_id: int, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """给任务上传附件（员工提交工作文件 → 自动标记待审核）"""
    from utils.db import execute_query

    # 检查任务是否存在
    task = execute_query("SELECT id, title, status FROM tasks WHERE id = %s", (task_id,))
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 保存文件
    ext = os.path.splitext(file.filename or "file")[1]
    saved_name = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, saved_name)
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # 记录文件
    execute_query(
        "INSERT INTO task_files (task_id, filename, filepath, uploaded_by) VALUES (%s, %s, %s, %s)",
        (task_id, file.filename or saved_name, filepath, user["id"]),
        fetch=False,
    )

    # 驳回任务重新上传文件 → 状态重置为 Todo + 待审核
    if task[0].get("status") == "Rejected" if isinstance(task[0], dict) else task[0][2] == "Rejected":
        execute_query(
            "UPDATE tasks SET status = 'Todo', review_status = 'pending', rejection_reason = NULL WHERE id = %s",
            (task_id,),
            fetch=False,
        )
    # 非管理员上传 → 标记待审核
    elif user.get("role") != "admin":
        execute_query(
            "UPDATE tasks SET review_status = 'pending' WHERE id = %s AND review_status = 'none'",
            (task_id,),
            fetch=False,
        )

    return {"status": "ok", "filename": file.filename, "message": "文件已上传，等待管理员审核"}


@router.get("/{task_id}/files")
def get_task_files(task_id: int, user: dict = Depends(get_current_user)):
    """查看任务已上传的文件列表"""
    from utils.db import execute_query
    rows = execute_query(
        "SELECT id, filename, uploaded_by, created_at FROM task_files WHERE task_id = %s ORDER BY id DESC",
        (task_id,),
    )
    return {"files": [{"id": r["id"], "filename": r["filename"], "uploaded_by": r["uploaded_by"], "created_at": r["created_at"].strftime("%Y-%m-%d %H:%M") if r["created_at"] else ""} for r in rows]}


@router.get("/{task_id}/files/{file_id}/download")
def download_task_file(task_id: int, file_id: int, token: str = Query(None)):
    """下载/预览任务附件（支持 token 查询参数或 Header 认证）"""
    from utils.db import execute_query
    from fastapi.responses import FileResponse
    from backend.auth_jwt import decode_token

    if token:
        try:
            payload = decode_token(token)
        except Exception:
            raise HTTPException(status_code=401, detail="无效的认证令牌")
    else:
        raise HTTPException(status_code=401, detail="请提供认证令牌")

    f = execute_query(
        "SELECT id, filename, filepath FROM task_files WHERE id = %s AND task_id = %s",
        (file_id, task_id),
    )
    if not f:
        raise HTTPException(status_code=404, detail="文件不存在")
    filepath = f[0]["filepath"]
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件已被删除")
    return FileResponse(filepath, filename=f[0]["filename"])


@router.delete("/{task_id}/files/{file_id}")
def delete_task_file(task_id: int, file_id: int, user: dict = Depends(get_current_user)):
    """删除任务附件（上传者本人或管理员可删）"""
    from utils.db import execute_query
    f = execute_query(
        "SELECT id, filename, filepath, uploaded_by FROM task_files WHERE id = %s AND task_id = %s",
        (file_id, task_id),
    )
    if not f:
        raise HTTPException(status_code=404, detail="文件不存在")
    if user.get("role") != "admin" and f[0]["uploaded_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="只能删除自己上传的文件")
    if os.path.exists(f[0]["filepath"]):
        os.remove(f[0]["filepath"])
    execute_query("DELETE FROM task_files WHERE id = %s", (file_id,), fetch=False)
    return {"status": "ok", "message": f"文件「{f[0]['filename']}」已删除"}


@router.post("/batch-update")
def batch_update(req: BatchUpdate, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        kwargs = {k: v for k, v in req.dict(exclude_none=True, exclude={"task_ids"}).items()}
        count, msg = service.batch_update_tasks(req.task_ids, **kwargs)
        return {"affected": count, "message": msg}
    finally:
        service.close()


@router.post("/{task_id}/reject")
def reject_task(task_id: int, req: TaskReject, user: dict = Depends(get_admin_user)):
    """管理员驳回任务，自动级联驳回依赖该任务的后续任务"""
    service = TaskService()
    try:
        ok, msg, affected = service.reject_task(task_id, req.reason)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"message": msg, "affected": affected}
    finally:
        service.close()


@router.post("/batch-delete")
def batch_delete(req: BatchDelete, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        count, msg = service.batch_delete_tasks(req.task_ids)
        return {"affected": count, "message": msg}
    finally:
        service.close()
