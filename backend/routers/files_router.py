import os, sys, tempfile, json, asyncio
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Depends
from langchain_openai import ChatOpenAI
from config import Config

from utils.task_service import TaskService
from utils.auth import get_all_users
from main_prompts import AI_HelperPrompts
from backend.auth_jwt import get_current_user
from backend.schemas import TaskListDispatch
from backend.routers.asr_router import transcribe_audio

router = APIRouter(prefix="/api/files", tags=["文件上传"])

def _get_conf():
    return Config()

# WebSocket 连接池: client_id → WebSocket
_ws_connections: dict[str, WebSocket] = {}


@router.websocket("/ws/upload/{client_id}")
async def ws_upload(client_id: str, ws: WebSocket):
    """WebSocket 连接：接收文件处理进度推送"""
    await ws.accept()
    _ws_connections[client_id] = ws
    try:
        while True:
            await ws.receive_text()  # 保持连接
    except WebSocketDisconnect:
        pass
    finally:
        _ws_connections.pop(client_id, None)


async def _push_progress(client_id: str, msg: dict):
    """向指定客户端推送进度消息"""
    ws = _ws_connections.get(client_id)
    if ws:
        try:
            await ws.send_json(msg)
        except Exception:
            _ws_connections.pop(client_id, None)


def _extract_file_content(file_bytes: bytes, filename: str) -> tuple[str, str]:
    """返回 (content, file_type)，复用 2_FileUpload.py 逻辑"""
    fn = filename.lower()

    if fn.endswith('.txt'):
        return file_bytes.decode('utf-8', errors='ignore'), 'txt'
    elif fn.endswith('.docx'):
        import docx
        with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            doc = docx.Document(tmp_path)
            return '\n'.join([p.text for p in doc.paragraphs]), 'docx'
        finally:
            os.unlink(tmp_path)
    elif fn.endswith('.pdf'):
        try:
            import pdfplumber
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name
            try:
                text = ''
                with pdfplumber.open(tmp_path) as pdf:
                    for page in pdf.pages:
                        t = page.extract_text()
                        if t:
                            text += t + '\n'
                return text, 'pdf'
            finally:
                os.unlink(tmp_path)
        except Exception:
            import PyPDF2
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name
            try:
                reader = PyPDF2.PdfReader(tmp_path)
                text = '\n'.join([page.extract_text() or '' for page in reader.pages])
                return text, 'pdf'
            finally:
                os.unlink(tmp_path)
    elif fn.endswith(('.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.caf')):
        return None, 'audio'
    elif fn.endswith(('.jpg', '.jpeg', '.png', '.bmp')):
        suffix = os.path.splitext(fn)[1]
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            try:
                from paddleocr import PaddleOCR
                ocr = PaddleOCR(lang='ch')
                results = ocr.ocr(tmp_path)
                if results and results[0]:
                    lines = [r[1][0] for r in results[0] if r and len(r) >= 2]
                    content = "\n".join(lines)
                else:
                    content = ""
            except ImportError:
                content = "[PaddleOCR 未安装，无法识别图片文字]"
            return content, 'image'
        finally:
            os.unlink(tmp_path)
    else:
        return file_bytes.decode('utf-8', errors='ignore'), 'unknown'


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    client_id: str = Form(""),
    user: dict = Depends(get_current_user),
):
    """上传文件 → 提取文本 → LLM 解析 → 通过 WebSocket 推送结果"""
    if not client_id:
        return {"status": "error", "message": "缺少 client_id"}

    try:
        file_bytes = await file.read()

        # 阶段 1: 提取文本
        await _push_progress(client_id, {"type": "progress", "phase": "extracting", "message": f"正在读取 {file.filename} ..."})

        content, file_type = _extract_file_content(file_bytes, file.filename)

        if file_type == 'audio':
            await _push_progress(client_id, {"type": "progress", "phase": "extracting", "message": "正在语音转写..."})
            content = transcribe_audio(file_bytes, file.filename)
            file_type = 'txt'
            if not content or not content.strip():
                await _push_progress(client_id, {"type": "error", "message": f"语音转写失败，未能从 {file.filename} 中提取文本。"})
                return {"status": "error", "message": "转写失败"}
            await _push_progress(client_id, {
                "type": "progress", "phase": "extracting",
                "message": f"语音转写完成，{len(content)} 字符"
            })

        if not content or not content.strip():
            await _push_progress(client_id, {"type": "error", "message": f"未能从 {file.filename} 中提取到文本内容。"})
            return {"status": "error", "message": "内容为空"}

        await _push_progress(client_id, {
            "type": "progress", "phase": "extracting",
            "message": f"文本提取完成，{len(content)} 字符 ({file_type})"
        })

        # 阶段 2: LLM 解析
        await _push_progress(client_id, {"type": "progress", "phase": "parsing", "message": "AI 正在分析任务结构..."})

        from datetime import datetime
        import pytz
        import re

        TZ = pytz.timezone('Asia/Shanghai')
        current_date = datetime.now(TZ).strftime('%Y-%m-%d')

        llm = ChatOpenAI(
            model=_get_conf().model_name,
            api_key=_get_conf().api_key,
            base_url=_get_conf().base_url,
            temperature=0.1,
            max_tokens=2048,
        )

        chain = AI_HelperPrompts.extract_tasks_from_content_prompt() | llm
        users = get_all_users()
        user_names = [u["name"] for u in users]

        response_text = chain.invoke({
            "content": content,
            "user_list": ", ".join(user_names),
            "current_date": current_date
        }).content.strip()

        response_text = re.sub(r'^```json\s*|\s*```$', '', response_text).strip()

        try:
            result = json.loads(response_text)
            tasks = result.get("tasks", []) if isinstance(result, dict) else []
            project_title = result.get("project_title", "未命名项目") if isinstance(result, dict) else "未命名项目"
        except json.JSONDecodeError:
            await _push_progress(client_id, {"type": "error", "message": "AI 返回格式异常，请重试"})
            return {"status": "error", "message": "格式异常"}

        # 标准化
        for t in tasks:
            if "priority" not in t: t["priority"] = "Medium"
            if "description" not in t: t["description"] = ""
            if "assignee" not in t: t["assignee"] = "未分配"

        # 兜底：AI 未分配时，按顺序轮流分配给可用人员
        if user_names and all(t.get("assignee") in (None, "", "未分配") for t in tasks):
            import itertools
            for i, t in enumerate(tasks):
                t["assignee"] = user_names[i % len(user_names)]

        await _push_progress(client_id, {
            "type": "result",
            "phase": "done",
            "project_title": project_title,
            "tasks": tasks,
            "message": f"解析完成，共提取 {len(tasks)} 个任务"
        })

        return {"status": "ok", "task_count": len(tasks)}

    except Exception as e:
        await _push_progress(client_id, {"type": "error", "message": str(e)})
        return {"status": "error", "message": str(e)}


@router.post("/dispatch")
def dispatch_tasks(req: TaskListDispatch, user: dict = Depends(get_current_user)):
    """确认下发：将编辑后的任务清单写入数据库。员工上传的任务自动标记待审核。"""
    service = TaskService()
    try:
        pid = service.create_project_with_tasks(req.project_title, req.tasks, req.creator_id)
        # 非管理员上传的任务，全部标记为待审核
        if user.get("role") != "admin":
            from utils.db import execute_query
            execute_query(
                "UPDATE tasks SET review_status = 'pending' WHERE parent_project_id = %s AND review_status = 'none'",
                (pid,),
                fetch=False,
            )
        return {"project_id": pid, "message": f"项目创建成功，共 {len(req.tasks)} 个任务"}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        service.close()
