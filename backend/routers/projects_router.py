import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends, HTTPException
from utils.task_service import TaskService
from backend.auth_jwt import get_current_user, get_admin_user
from backend.schemas import ProjectCreate, ProjectUpdate, TaskCreate, TaskListDispatch

router = APIRouter(prefix="/api/projects", tags=["项目管理"])


@router.get("")
def list_projects(user: dict = Depends(get_current_user)):
    service = TaskService()
    try:
        return {"projects": service.get_all_projects()}
    finally:
        service.close()


@router.get("/stats")
def project_stats(user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        return {"stats": service.get_project_stats()}
    finally:
        service.close()


@router.post("")
def create_project(req: TaskListDispatch, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        pid = service.create_project_with_tasks(req.project_title, req.tasks, req.creator_id)
        return {"project_id": pid, "message": f"项目创建成功，共 {len(req.tasks)} 个任务"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        service.close()


@router.put("/{project_id}")
def update_project(project_id: int, req: ProjectUpdate, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        kwargs = {k: v for k, v in req.dict(exclude_none=True).items()}
        ok, msg = service.update_project(project_id, **kwargs)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"message": msg}
    finally:
        service.close()


@router.delete("/{project_id}")
def delete_project(project_id: int, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        ok, msg = service.delete_project(project_id)
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"message": msg}
    finally:
        service.close()


@router.get("/{project_id}/tasks")
def get_project_tasks(project_id: int, user: dict = Depends(get_current_user)):
    service = TaskService()
    try:
        tasks = service.get_project_tasks(project_id)
        # 补充依赖任务的标题和状态
        all_ids = set()
        dep_map = {}
        for t in tasks:
            ds = str(t.get('dependencies') or '')
            if ds.strip():
                ids = [int(s) for s in ds.split(',') if s.strip().isdigit()]
                dep_map[t['id']] = ids
                all_ids.update(ids)
        dep_info = {}
        if all_ids:
            cursor = service.conn.cursor(dictionary=True)
            from mysql.connector import ProgrammingError
            try:
                ph = ','.join(['%s'] * len(all_ids))
                cursor.execute(f"SELECT id, title, status FROM tasks WHERE id IN ({ph})", tuple(all_ids))
                for row in cursor.fetchall():
                    dep_info[row['id']] = {"title": row['title'], "status": row['status']}
            except ProgrammingError:
                pass
            finally:
                cursor.close()
        for t in tasks:
            t['dependencies_detail'] = [dep_info.get(did) for did in dep_map.get(t['id'], []) if dep_info.get(did)]
        return {"tasks": tasks}
    finally:
        service.close()


@router.post("/{project_id}/tasks")
def add_task(project_id: int, req: TaskCreate, user: dict = Depends(get_admin_user)):
    service = TaskService()
    try:
        tid, msg = service.add_task(
            project_id, req.title, req.assignee,
            req.deadline, req.priority, req.description or "",
            req.dependencies
        )
        if not tid:
            raise HTTPException(status_code=400, detail=msg)
        return {"task_id": tid, "message": msg}
    finally:
        service.close()
