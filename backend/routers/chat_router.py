import os, sys, json, re, threading
from datetime import datetime
import pytz

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from config import Config
from main_prompts import AI_HelperPrompts
from backend.auth_jwt import get_current_user
from utils.db import execute_query
from utils.task_service import TaskService

router = APIRouter(prefix="/api", tags=["聊天"])

def _get_conf():
    return Config()

TZ = pytz.timezone('Asia/Shanghai')

DB_SCHEMA = """
-- 用户表
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '用户名',
    role ENUM('admin','user') DEFAULT 'user' COMMENT '角色',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 项目表
CREATE TABLE projects (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(300) NOT NULL COMMENT '项目标题',
    description TEXT COMMENT '项目描述',
    deadline DATETIME NOT NULL COMMENT '截止时间',
    status ENUM('Todo','Doing','Done','Blocked') DEFAULT 'Todo' COMMENT '项目状态',
    creator_id INT NOT NULL COMMENT '创建者用户ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 任务表（核心业务表）
CREATE TABLE tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(300) NOT NULL COMMENT '任务标题',
    description TEXT COMMENT '任务描述',
    assignee VARCHAR(100) NOT NULL COMMENT '负责人姓名',
    assignee_id INT COMMENT '负责人用户ID',
    deadline DATETIME NOT NULL COMMENT '截止时间',
    status ENUM('Todo','Doing','Done','Blocked','Rejected') DEFAULT 'Todo' COMMENT '任务状态',
    review_status ENUM('none','pending','approved','rejected') DEFAULT 'none' COMMENT '审核状态',
    rejection_reason TEXT COMMENT '驳回意见',
    rejected_by_task_id INT COMMENT '被哪个任务连累驳回',
    priority ENUM('High','Medium','Low') DEFAULT 'Medium' COMMENT '优先级',
    dependencies VARCHAR(500) COMMENT '前置依赖任务ID（逗号分隔）',
    parent_project_id INT COMMENT '所属项目ID',
    notified_count INT DEFAULT 0 COMMENT '已推送预警次数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 任务评论表
CREATE TABLE task_comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    task_id INT NOT NULL COMMENT '任务ID',
    user_id INT NOT NULL COMMENT '评论者用户ID',
    content TEXT NOT NULL COMMENT '评论内容',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

SQL_GEN_PROMPT = """你是一个 MySQL 查询生成器。根据数据库表结构和用户的自然语言问题，生成一条合法的 SELECT 查询语句。

## 数据库表结构
{schema}

## 当前日期
{current_date}

## 当前用户
- 用户ID: {user_id}
- 用户名: {user_name}
- 角色: {user_role}

## 用户问题
{query}

## 规则
- 只生成 SELECT 语句，禁止 INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE
- 必须包含 LIMIT 100
- 如需关联其他表，使用 LEFT JOIN
- 日期时间用 NOW() 比较
- deadline 列是 DATETIME 类型，逾期条件是 deadline < NOW() AND status != 'Done'

## 必须包含的列（固定别名，不要改）
每条 SELECT 查询必须包含以下 6 列，并使用这些精确的别名：

1. **id** — 任务ID（tasks.id AS id）
2. **title** — 任务标题（tasks.title AS title）
3. **assignee** — 负责人姓名（tasks.assignee AS assignee）
4. **deadline** — 截止时间（tasks.deadline AS deadline）
5. **priority** — 优先级（tasks.priority AS priority）
6. **status** — 任务状态（tasks.status AS status）
7. **project_title** — 所属项目名称（projects.title AS project_title）

**重要**：必须 LEFT JOIN projects ON tasks.parent_project_id = projects.id 来获取项目名称。

## 输出
只输出一行完整的 SQL 语句，不要任何解释，不要 markdown 代码块，不要换行。"""


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


COMMENT_EXTRACT_PROMPT = """根据对话历史和用户当前消息，提取评论目标和内容。

## 对话历史
{history}

## 用户当前消息
{query}

## 规则
- 提取用户要评论/催促/提醒/批评/表扬的目标人物（target_person）
- **重要**：如果用户用了"他"、"她"、"这个人"等代词，必须在对话历史中找到最近被提及的人名，代入解析。例如用户刚才在讨论张三，现在说"骂他两句"，则 target_person 应该是"张三"
- 生成一段得体的评论内容（comment），用中文，语气根据用户意图调整
- 如果用户是催促，评论语气要礼貌但直接
- 如果用户是批评（"骂他"），语气可以严厉但不人身攻击
- 如果用户是表扬，语气要鼓励

## 输出格式
严格 JSON：{{"target_person": "张三", "comment": "请尽快完成用户中心前端改版，截止日期快到了！"}}"""


def _generate_sql(query: str, user: dict, history_text: str) -> str:
    """用大模型根据自然语言生成 SQL"""
    llm = ChatOpenAI(
        model=_get_conf().model_name,
        api_key=_get_conf().api_key,
        base_url=_get_conf().base_url,
        temperature=0,
        max_tokens=1024,
    )
    now = datetime.now(TZ)
    current_date = f'{now.year}年{now.month}月{now.day}日，周{["一","二","三","四","五","六","日"][now.weekday()]}'
    prompt = SQL_GEN_PROMPT.format(
        schema=DB_SCHEMA,
        current_date=current_date,
        user_id=user["id"],
        user_name=user["name"],
        user_role=user["role"],
        query=f"对话历史:\n{history_text}\n\n当前问题: {query}",
    )
    sql = llm.invoke(prompt).content.strip()
    sql = re.sub(r'^```sql\s*|\s*```$', '', sql).strip()
    return sql


def _fix_sql(query: str, user: dict, history_text: str, failed_sql: str, error: str) -> str:
    """SQL 执行失败后，将错误信息喂给大模型自动修复"""
    llm = ChatOpenAI(
        model=_get_conf().model_name,
        api_key=_get_conf().api_key,
        base_url=_get_conf().base_url,
        temperature=0,
        max_tokens=1024,
    )
    fix_prompt = f"""下面这条 SQL 执行报错了，请根据错误信息修复它。

## 数据库表结构
{DB_SCHEMA}

## 错误的 SQL
{failed_sql}

## 错误信息
{error}

## 修复规则
- 只输出修复后的完整 SQL 语句
- 不要任何解释和 markdown 代码块"""

    fixed = llm.invoke(fix_prompt).content.strip()
    fixed = re.sub(r'^```sql\s*|\s*```$', '', fixed).strip()
    return fixed


def _validate_sql(sql: str) -> bool:
    """安全检查：只允许 SELECT 查询，禁止多语句"""
    cleaned = sql.strip().upper()
    if not cleaned.startswith("SELECT"):
        return False
    # 禁止多语句（分号后再跟其他语句）
    parts = [p.strip() for p in sql.strip().split(";") if p.strip()]
    if len(parts) > 1:
        return False
    return True


def _fmt_row(row: dict) -> dict:
    """将数据库行格式化为 JSON 安全格式"""
    result = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            result[k] = v.strftime('%Y-%m-%d %H:%M')
        elif v is None:
            result[k] = ""
        else:
            result[k] = v
    return result


MEMORY_COMPRESS_PROMPT = """将以下对话历史压缩成一份简洁的记忆大纲，保留关键信息。

## 对话历史
{history}

## 压缩规则
- 提取关键事实：用户提到的人名、项目名、任务名、重要决策
- 保留上下文关系：谁做了什么、什么状态发生了变化
- 用要点形式输出，每行一个事实
- 输出长度不超过 300 字
- 只输出大纲内容，不要任何前缀解释"""


def _fix_date(text: str, current_date: str) -> str:
    """将 LLM 生成中可能错误的日期替换为正确的当前日期"""
    import re
    # 匹配 "今天是XXXX年X月X日，星期X" 等模式
    text = re.sub(r'今天是\d{4}年\d{1,2}月\d{1,2}日[，,]?\s*星期[一二三四五六日]?', f'今天是{current_date}', text)
    # 匹配 "XXXX年X月X日，星期X" 等独立的日期（非"今天"开头）
    text = re.sub(r'\d{4}年\d{1,2}月\d{1,2}日[，,]?\s*星期[一二三四五六日]', current_date, text)
    return text


def _load_history(user_id: int) -> str:
    """从 DB 加载记忆摘要 + 最近 10 轮对话"""
    # 1. 加载记忆摘要
    summary = execute_query(
        "SELECT summary FROM memory_summaries WHERE user_id = %s", (user_id,),
    )
    summary_text = ""
    if summary:
        summary_text = f"【历史记忆大纲】\n{summary[0]['summary']}\n\n"

    # 2. 加载最近 20 条消息（10 轮）
    rows = execute_query(
        "SELECT role, content FROM conversation_messages WHERE user_id = %s ORDER BY id DESC LIMIT 20",
        (user_id,),
    )
    rows = list(reversed(rows))
    text = ""
    for r in rows:
        role = "用户" if r["role"] == "user" else "助手"
        text += f"{role}: {r['content']}\n"
    return summary_text + text


def _save_messages(user_id: int, user_msg: str, reply: str, current_date: str = ""):
    """批量保存一轮对话，并在后台触发记忆压缩"""
    if current_date:
        reply = _fix_date(reply, current_date)
    execute_query(
        "INSERT INTO conversation_messages (user_id, role, content) VALUES (%s, 'user', %s), (%s, 'assistant', %s)",
        (user_id, user_msg, user_id, reply),
        fetch=False,
    )
    # 后台异步压缩旧消息为记忆大纲
    threading.Thread(target=_compress_memory, args=(user_id,), daemon=True).start()


_compress_locks = {}
_compress_lock = threading.Lock()


def _get_compress_lock(user_id: int):
    with _compress_lock:
        if user_id not in _compress_locks:
            _compress_locks[user_id] = threading.Lock()
        return _compress_locks[user_id]


def _compress_memory(user_id: int):
    """后台异步压缩旧消息为记忆大纲（带用户级锁防竞态）"""
    user_lock = _get_compress_lock(user_id)
    if not user_lock.acquire(blocking=False):
        return  # 已有压缩任务在运行

    try:
        count_rows = execute_query(
            "SELECT COUNT(*) AS cnt FROM conversation_messages WHERE user_id = %s",
            (user_id,),
        )
        total = count_rows[0]["cnt"]

        if total <= 20:
            return

        # 获取待压缩的旧消息（保留最近 20 条）
        old_rows = execute_query(
            "SELECT id, role, content FROM conversation_messages WHERE user_id = %s ORDER BY id ASC LIMIT %s",
            (user_id, total - 20),
        )
        if not old_rows:
            return

        # 删除已压缩的旧消息
        old_ids = [r["id"] for r in old_rows]
        execute_query(
            f"DELETE FROM conversation_messages WHERE user_id = %s AND id IN ({','.join(['%s']*len(old_ids))})",
            (user_id, *old_ids),
            fetch=False,
        )
        if not old_rows:
            return

        history_text = ""
        for r in old_rows:
            role = "用户" if r["role"] == "user" else "助手"
            history_text += f"{role}: {r['content']}\n"

        llm = ChatOpenAI(
            model=_get_conf().model_name,
            api_key=_get_conf().api_key,
            base_url=_get_conf().base_url,
            temperature=0.2,
            max_tokens=512,
        )
        new_summary = llm.invoke(MEMORY_COMPRESS_PROMPT.format(history=history_text)).content.strip()

        existing = execute_query(
            "SELECT summary FROM memory_summaries WHERE user_id = %s", (user_id,),
        )
        if existing:
            new_summary = existing[0]["summary"] + "\n" + new_summary

        execute_query(
            "INSERT INTO memory_summaries (user_id, summary) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE summary = VALUES(summary)",
            (user_id, new_summary),
            fetch=False,
        )
    except Exception:
        pass
    finally:
        user_lock.release()


@router.post("/chat")
def chat(req: ChatRequest, user: dict = Depends(get_current_user)):
    """接收用户消息 → 意图识别 → 返回 LLM 回复"""
    now = datetime.now(TZ)
    current_date = f'{now.year}年{now.month}月{now.day}日，周{["一","二","三","四","五","六","日"][now.weekday()]}'

    conf = _get_conf()
    if not conf.api_key or not conf.api_key.strip():
        return {"status": "error", "message": "api_key_missing", "reply": "⚠️ 尚未配置大模型 API Key，请在「大模型 API 设置」页面填入 DeepSeek 或 OpenAI 兼容 API Key。"}

    # 从 DB 加载历史 + 请求中的历史，合并
    db_history = _load_history(user["id"])
    req_history = ""
    for h in req.history[-10:]:
        role = "用户" if h["role"] == "user" else "助手"
        req_history += f"{role}: {h['content']}\n"
    history_text = (db_history + "\n" + req_history).strip()
    if not history_text:
        history_text = "（无历史）"

    llm = ChatOpenAI(
        model=conf.model_name,
        api_key=conf.api_key,
        base_url=conf.base_url,
        temperature=0.3,
        max_tokens=512,
    )

    response = None  # 最终返回的响应

    # 意图识别
    intent_chain = AI_HelperPrompts.intent_prompt() | llm
    raw = intent_chain.invoke({
        "query": req.message,
        "conversation_history": history_text,
        "current_date": current_date,
    }).content.strip()

    raw = re.sub(r'^```json\s*|\s*```$', '', raw).strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        response = {"reply": "抱歉，我暂时无法理解你的意思，能再说一遍吗？"}
        _save_messages(user["id"], req.message, response["reply"], current_date)
        return response

    intents = result.get("intents", ["chat"])
    follow_up = result.get("follow_up_message", "")
    primary_intent = intents[0] if intents else "chat"

    # chat 意图
    if primary_intent == "chat":
        if follow_up:
            response = {"reply": follow_up, "intent": "chat"}
        else:
            fallback_chain = AI_HelperPrompts.intent_prompt() | llm
            fallback_raw = fallback_chain.invoke({
                "query": req.message,
                "conversation_history": history_text,
                "current_date": current_date,
            }).content.strip()
            try:
                fb = json.loads(re.sub(r'^```json\s*|\s*```$', '', fallback_raw).strip())
                response = {"reply": fb.get("follow_up_message", "你好！有什么可以帮你的？"), "intent": "chat"}
            except Exception:
                response = {"reply": "你好！有什么办公上的事情需要我帮忙吗？", "intent": "chat"}
        _save_messages(user["id"], req.message, response["reply"], current_date)
        return response

    # uncertain 意图
    if primary_intent == "uncertain":
        response = {"reply": follow_up or "能再说具体一点吗？你想做什么？", "intent": "uncertain"}
        _save_messages(user["id"], req.message, response["reply"], current_date)
        return response

    # ── 数据查询意图：大模型生成 SQL → 执行（错误自动重试一次） ──
    if primary_intent in ("view_tasks", "track_progress", "check_deadline"):
        try:
            sql = _generate_sql(req.message, user, history_text)
        except Exception:
            response = {"reply": "SQL 生成失败，请重试。", "intent": primary_intent}
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        if not _validate_sql(sql):
            response = {"reply": "生成的查询不合法，请换一种方式描述你的需求。", "intent": primary_intent}
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        try:
            rows = execute_query(sql)
        except Exception as e:
            try:
                sql = _fix_sql(req.message, user, history_text, sql, str(e))
                if _validate_sql(sql):
                    rows = execute_query(sql)
                else:
                    response = {"reply": f"查询失败: {e}", "intent": primary_intent}
                    _save_messages(user["id"], req.message, response["reply"], current_date)
                    return response
            except Exception as e2:
                response = {"reply": f"查询执行失败: {e2}", "intent": primary_intent}
                _save_messages(user["id"], req.message, response["reply"], current_date)
                return response

        data = [_fmt_row(r) for r in rows]
        reply = follow_up or f"查询完成，共找到 {len(data)} 条记录"

        response = {
            "reply": reply,
            "intent": primary_intent,
            "tasks": data,
            "project_title": _intent_title(primary_intent),
        }
        _save_messages(user["id"], req.message, response["reply"], current_date)
        return response

    # ── 评论意图：提取目标人和评论内容 → 查任务 → 插入评论 ──
    if primary_intent == "add_comment":
        comment_llm = ChatOpenAI(
            model=_get_conf().model_name,
            api_key=_get_conf().api_key,
            base_url=_get_conf().base_url,
            temperature=0.3,
            max_tokens=256,
        )
        raw = comment_llm.invoke(COMMENT_EXTRACT_PROMPT.format(
            query=req.message,
            history=history_text,
        )).content.strip()
        raw = re.sub(r'^```json\s*|\s*```$', '', raw).strip()
        try:
            comment_info = json.loads(raw)
            target = comment_info.get("target_person", "")
            comment_text = comment_info.get("comment", "")
        except json.JSONDecodeError:
            response = {"reply": "我没理解你想评论谁，能说具体一点吗？比如'催一下张三赶紧做XX任务'", "intent": "add_comment"}
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        if not target or not comment_text:
            response = {"reply": "请说明你想提醒谁，以及具体内容。比如'告诉李四他的接口开发要抓紧了'", "intent": "add_comment"}
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        try:
            tasks = execute_query(
                "SELECT t.id, t.title, t.deadline, t.status, t.priority, p.title AS project_title "
                "FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id "
                "WHERE t.assignee LIKE %s AND t.status != 'Done' LIMIT 10",
                (f"%{target}%",)
            )
        except Exception:
            response = {"reply": f"查询 {target} 的任务时出错，请重试。", "intent": "add_comment"}
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        if not tasks:
            response = {"reply": f"没有找到 {target} 的待处理任务，可能任务已完成或不存在。", "intent": "add_comment"}
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        if len(tasks) == 1:
            task = tasks[0]
            service = TaskService()
            try:
                cid, msg = service.add_comment(task["id"], user["id"], comment_text)
                response = {
                    "reply": f"已给 {target} 的任务「{task['title']}」添加评论：'{comment_text}'",
                    "intent": "add_comment",
                }
            finally:
                service.close()
            _save_messages(user["id"], req.message, response["reply"], current_date)
            return response

        tasks_data = [_fmt_row(t) for t in tasks]
        response = {
            "reply": f"{target} 有 {len(tasks)} 个进行中的任务，请选择要给哪个任务添加评论：",
            "intent": "add_comment",
            "tasks": tasks_data,
            "project_title": f"选择 {target} 的任务",
            "pending_comment": comment_text,
        }
        _save_messages(user["id"], req.message, response["reply"], current_date)
        return response

    # 其他意图
    intent_labels = {
        "upload_file": "你可以点击输入框旁边的 📎 按钮上传文件，我会自动提取任务。",
        "parse_document": "请上传文档（📎按钮），我会帮你解析内容。",
        "generate_minutes": "请上传会议录音转写文本，我会帮你生成纪要。",
        "decompose_task": "请上传包含行动项的文档，我会自动拆解为子任务。",
        "dispatch_task": "你可以在「项目与任务矩阵」中编辑任务的负责人来派发。",
    }
    reply = intent_labels.get(primary_intent, "你可以前往「项目与任务矩阵」页面查看和管理任务。")
    response = {"reply": reply, "intent": primary_intent}
    _save_messages(user["id"], req.message, response["reply"], current_date)
    return response


class ConfirmCommentRequest(BaseModel):
    task_id: int
    comment: str


@router.post("/chat/confirm-comment")
def confirm_comment(req: ConfirmCommentRequest, user: dict = Depends(get_current_user)):
    """确认给指定任务添加评论"""
    service = TaskService()
    try:
        cid, msg = service.add_comment(req.task_id, user["id"], req.comment)
        return {"status": "ok", "comment_id": cid, "message": msg}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        service.close()


def _intent_title(intent: str) -> str:
    return {"view_tasks": "任务查询结果", "track_progress": "任务进度", "check_deadline": "逾期任务"}.get(intent, "查询结果")
