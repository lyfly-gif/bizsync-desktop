import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import mysql.connector
from datetime import datetime
import pytz

from config import Config
from create_logger import logger
from utils.auth import get_all_users

conf = Config()
TZ = pytz.timezone('Asia/Shanghai')


class TaskService:
    """任务业务逻辑层，直接操作数据库（不通过 MCP，避免嵌套复杂度）"""

    def __init__(self):
        self.conn = mysql.connector.connect(
            host=conf.host, user=conf.user,
            password=conf.password, database=conf.database,
            charset="utf8mb4", autocommit=False,
            connection_timeout=10
        )

    def create_project_with_tasks(self, project_title: str, tasks: list[dict], creator_id: int = 1) -> int:
        """
        创建项目及其子任务，带截止时间约束校验。
        creator_id 默认为 1 (admin)，实际调用时应传当前登录用户 ID。
        """
        cursor = self.conn.cursor()

        # 1. 一次性查询所有用户名 → ID 映射（避免 N+1 查询）
        assignee_names = list({t.get("assignee", "未分配") for t in tasks})
        placeholders = ','.join(['%s'] * len(assignee_names))
        cursor.execute(
            f"SELECT name, id FROM users WHERE name IN ({placeholders})",
            assignee_names
        )
        name_to_id = {row[0]: row[1] for row in cursor.fetchall()}

        # 2. 计算项目截止时间 = 所有子任务中最晚的 deadline
        all_deadlines = []
        for t in tasks:
            dl = t.get("deadline", "")
            if dl and dl != "未指定":
                try:
                    all_deadlines.append(datetime.strptime(dl, "%Y-%m-%d %H:%M:%S"))
                except ValueError:
                    try:
                        all_deadlines.append(datetime.strptime(dl, "%Y-%m-%d"))
                    except ValueError:
                        pass

        project_deadline = max(all_deadlines) if all_deadlines else datetime.now(TZ).replace(hour=23, minute=59, second=59)

        # 3. 创建项目
        cursor.execute(
            "INSERT INTO projects (title, description, deadline, status, creator_id) VALUES (%s, %s, %s, 'Todo', %s)",
            (project_title, f"从文件导入 - 共{len(tasks)}个子任务", project_deadline.strftime('%Y-%m-%d %H:%M:%S'), creator_id)
        )
        project_id = cursor.lastrowid

        # 4. 批量构建子任务数据，executemany 一次性插入
        task_rows = []
        for t in tasks:
            title = t.get("title", "未命名任务")
            assignee = t.get("assignee", "未分配")
            dl = t.get("deadline", "")
            if not dl or dl == "未指定":
                dl = project_deadline.strftime('%Y-%m-%d %H:%M:%S')
            task_rows.append((
                title,
                t.get("description", ""),
                assignee,
                name_to_id.get(assignee),
                dl,
                t.get("priority", "Medium"),
                project_id
            ))

        cursor.executemany(
            """INSERT INTO tasks (title, description, assignee, assignee_id, deadline, status, priority, parent_project_id)
               VALUES (%s, %s, %s, %s, %s, 'Todo', %s, %s)""",
            task_rows
        )

        # 5. 处理依赖关系：将行索引映射为实际任务 ID
        row_index_to_id = {}
        cursor.execute("SELECT id FROM tasks WHERE parent_project_id = %s ORDER BY id ASC", (project_id,))
        for idx, row in enumerate(cursor.fetchall()):
            row_index_to_id[idx] = row[0]

        for t in tasks:
            dep_indices = t.get("dependencies_indices", [])
            if dep_indices:
                dep_ids = []
                for dep_idx in dep_indices:
                    if dep_idx in row_index_to_id:
                        dep_ids.append(str(row_index_to_id[dep_idx]))
                if dep_ids:
                    # 找到当前任务对应的实际 ID
                    task_idx = t.get("_row_index")
                    if task_idx is not None and task_idx in row_index_to_id:
                        actual_task_id = row_index_to_id[task_idx]
                        dep_str = ",".join(dep_ids)
                        cursor.execute(
                            "UPDATE tasks SET dependencies = %s WHERE id = %s",
                            (dep_str, actual_task_id))

        # 6. 自动将有依赖且依赖未完成的任务标记为 Blocked
        cursor.execute(
            """UPDATE tasks SET status = 'Blocked', updated_at = NOW()
               WHERE parent_project_id = %s
                 AND dependencies IS NOT NULL
                 AND dependencies != ''
                 AND status = 'Todo'""",
            (project_id,))
        blocked_count = cursor.rowcount
        if blocked_count:
            logger.info(f"项目{project_id}: {blocked_count}个有依赖的任务已标记为 Blocked")

        self.conn.commit()
        logger.info(f"项目{project_id}下发完成: {len(task_rows)}个子任务")
        return project_id

    # === 管理端查询 ===

    def get_all_projects(self) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def get_project_tasks(self, project_id: int) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM tasks WHERE parent_project_id = %s ORDER BY deadline ASC", (project_id,))
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def get_project_stats(self) -> dict:
        cursor = self.conn.cursor()
        cursor.execute(
            """SELECT COUNT(*) AS total,
                      SUM(CASE WHEN status = 'Todo' THEN 1 ELSE 0 END) AS todo,
                      SUM(CASE WHEN status = 'Doing' THEN 1 ELSE 0 END) AS doing,
                      SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
                      SUM(CASE WHEN status != 'Done' AND deadline < NOW() THEN 1 ELSE 0 END) AS overdue
               FROM projects""")
        row = cursor.fetchone()
        cursor.close()
        return {"total": int(row[0]), "todo": int(row[1]), "doing": int(row[2]), "done": int(row[3]), "overdue": int(row[4])}

    def get_user_tasks_by_admin(self, user_id: int) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            """SELECT t.*, p.title as project_title
               FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
               WHERE t.assignee_id = %s ORDER BY t.deadline ASC""",
            (user_id,))
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def get_user_stats(self, user_id: int) -> dict:
        cursor = self.conn.cursor()
        cursor.execute(
            """SELECT COUNT(*) AS total,
                      SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
                      SUM(CASE WHEN status = 'Doing' THEN 1 ELSE 0 END) AS doing,
                      SUM(CASE WHEN status != 'Done' AND deadline < NOW() THEN 1 ELSE 0 END) AS overdue
               FROM tasks WHERE assignee_id = %s""",
            (user_id,))
        row = cursor.fetchone()
        cursor.close()
        return {"total": int(row[0]), "done": int(row[1]), "doing": int(row[2]), "overdue": int(row[3])}

    def get_all_user_stats(self) -> dict:
        """批量获取所有用户的统计（一次查询），返回 {user_id: {total, done, doing, overdue}}"""
        cursor = self.conn.cursor()
        cursor.execute(
            """SELECT assignee_id,
                      COUNT(*) AS total,
                      SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS done,
                      SUM(CASE WHEN status = 'Doing' THEN 1 ELSE 0 END) AS doing,
                      SUM(CASE WHEN status != 'Done' AND deadline < NOW() THEN 1 ELSE 0 END) AS overdue
               FROM tasks WHERE assignee_id IS NOT NULL
               GROUP BY assignee_id""")
        result = {}
        for row in cursor.fetchall():
            result[row[0]] = {"total": int(row[1]), "done": int(row[2]), "doing": int(row[3]), "overdue": int(row[4])}
        cursor.close()
        return result

    def get_overdue_tasks(self, today_only: bool = False) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        if today_only:
            cursor.execute(
                """SELECT t.*, p.title as project_title
                   FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
                   WHERE t.status != 'Done' AND t.deadline < NOW() AND DATE(t.deadline) = CURDATE()
                   ORDER BY t.deadline ASC""")
        else:
            cursor.execute(
                """SELECT t.*, p.title as project_title
                   FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
                   WHERE t.status != 'Done' AND t.deadline < NOW()
                   ORDER BY t.deadline ASC""")
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def get_urgent_tasks(self, min_hours: float = 0, max_hours: float = 24) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            """SELECT t.*, p.title as project_title
               FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
               WHERE t.status IN ('Todo', 'Doing')
                 AND t.deadline BETWEEN DATE_ADD(NOW(), INTERVAL %s MINUTE)
                                    AND DATE_ADD(NOW(), INTERVAL %s MINUTE)
               ORDER BY t.deadline ASC""",
            (min_hours * 60, max_hours * 60))
        rows = cursor.fetchall()
        cursor.close()
        return rows

    # === 个人端查询 ===

    def get_my_tasks(self, user_id: int) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            """SELECT t.*, p.title as project_title
               FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
               WHERE t.assignee_id = %s ORDER BY t.deadline ASC""",
            (user_id,))
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def get_my_overdue_tasks(self, user_id: int, today_only: bool = False) -> list[dict]:
        cursor = self.conn.cursor(dictionary=True)
        if today_only:
            cursor.execute(
                """SELECT t.*, p.title as project_title
                   FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
                   WHERE t.assignee_id = %s AND t.status != 'Done' AND t.deadline < NOW() AND DATE(t.deadline) = CURDATE()
                   ORDER BY t.deadline ASC""",
                (user_id,))
        else:
            cursor.execute(
                """SELECT t.*, p.title as project_title
                   FROM tasks t LEFT JOIN projects p ON t.parent_project_id = p.id
                   WHERE t.assignee_id = %s AND t.status != 'Done' AND t.deadline < NOW()
                   ORDER BY t.deadline ASC""",
                (user_id,))
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def complete_task(self, task_id: int, user_id: int) -> tuple[bool, str]:
        """打卡完成：仅允许责任人完成未逾期且依赖已满足的任务"""
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT title, deadline, status, dependencies FROM tasks WHERE id = %s AND assignee_id = %s AND status != 'Done'",
            (task_id, user_id))
        task = cursor.fetchone()
        if not task:
            cursor.close()
            return False, "任务不存在、已完成或无权限操作。"

        # 驳回任务允许管理员手动标记完成，跳过依赖和超期检查
        if task['status'] != 'Rejected':
            # 依赖检查：有未满足的前置依赖则拒绝打卡
            if task.get('dependencies') and str(task['dependencies']).strip():
                if not self.are_dependencies_met(task_id):
                    cursor.close()
                    return False, "该任务的前置依赖尚未完成，无法打卡。"
            deadline = task['deadline']
            from datetime import datetime
            import pytz
            TZ = pytz.timezone('Asia/Shanghai')
            if deadline.tzinfo is None:
                deadline = TZ.localize(deadline)
            if deadline < datetime.now(TZ):
                cursor.close()
                return False, "该任务已逾期，无法打卡完成。请联系管理员处理。"

        cursor.execute(
            "UPDATE tasks SET status = 'Done', review_status = 'approved', rejection_reason = NULL, updated_at = NOW() WHERE id = %s AND assignee_id = %s AND status != 'Done'",
            (task_id, user_id))
        self.conn.commit()

        # 检查所属项目的所有任务是否都已完成
        cursor.execute("SELECT parent_project_id FROM tasks WHERE id = %s", (task_id,))
        row = cursor.fetchone()
        if row and row.get('parent_project_id'):
            project_id = row['parent_project_id']
            cursor.execute(
                "SELECT COUNT(*) FROM tasks WHERE parent_project_id = %s AND status != 'Done'",
                (project_id,))
            remaining = cursor.fetchone()['COUNT(*)']
            if remaining == 0:
                cursor.execute("UPDATE projects SET status = 'Done', updated_at = NOW() WHERE id = %s", (project_id,))
                self.conn.commit()
                logger.info(f"项目 {project_id} 所有任务已完成，自动标记为 Done")

        # 解封依赖此任务的其他任务（解除 Blocked 状态，让它们可以打卡）
        unblocked = []
        dependent = self.get_dependent_tasks(task_id)
        for dep_task in dependent:
            if self.are_dependencies_met(dep_task['id']):
                if dep_task['status'] == 'Blocked':
                    cursor.execute(
                        "UPDATE tasks SET status = 'Todo', updated_at = NOW() WHERE id = %s",
                        (dep_task['id'],))
                    self.conn.commit()
                    unblocked.append(dep_task['title'])
                    logger.info(f"任务 {dep_task['id']}「{dep_task['title']}」依赖已满足，Blocked → Todo")
            else:
                logger.info(f"任务 {dep_task['id']}「{dep_task['title']}」仍有未满足的依赖")

        if unblocked:
            logger.info(f"任务 {task_id} 完成，解封了 {len(unblocked)} 个依赖任务: {unblocked}")

        cursor.close()
        return True, "打卡成功！任务已完成。"

    def delete_task(self, task_id: int) -> tuple[bool, str]:
        """管理员删除任务（硬删除），同步清理其他任务中的依赖引用"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT title FROM tasks WHERE id = %s", (task_id,))
        row = cursor.fetchone()
        if not row:
            cursor.close()
            return False, "任务不存在。"
        title = row[0]

        # 清除其他任务中对该任务的依赖引用
        cursor.execute(
            "SELECT id, dependencies FROM tasks WHERE FIND_IN_SET(%s, dependencies) > 0",
            (str(task_id),))
        affected = cursor.fetchall()
        for aff_id, deps in affected:
            new_deps = ",".join([d.strip() for d in str(deps).split(',')
                                 if d.strip().isdigit() and int(d.strip()) != task_id])
            cursor.execute("UPDATE tasks SET dependencies = %s WHERE id = %s",
                           (new_deps or None, aff_id))
        if affected:
            logger.info(f"清除 {len(affected)} 个任务中对任务{task_id}的依赖引用")

        cursor.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        self.conn.commit()
        cursor.close()
        logger.info(f"管理员删除任务: {title} (ID={task_id})")
        return True, f"任务「{title}」已删除。"

    # === 项目级操作 ===

    def update_project(self, project_id: int, **kwargs) -> tuple[bool, str]:
        """动态更新 projects 表字段"""
        if not kwargs:
            return False, "无更新内容"
        allowed = {"title", "description", "deadline", "status"}
        updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not updates:
            return False, "无可更新的字段"
        cursor = self.conn.cursor()
        set_clause = ", ".join(f"{k} = %s" for k in updates)
        values = list(updates.values()) + [project_id]
        cursor.execute(f"UPDATE projects SET {set_clause}, updated_at = NOW() WHERE id = %s", values)
        self.conn.commit()
        cursor.close()
        logger.info(f"项目{project_id}已更新: {updates}")
        return True, "项目已更新。"

    def delete_project(self, project_id: int) -> tuple[bool, str]:
        """级联删除项目及其所有子任务（同一事务）"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT title FROM projects WHERE id = %s", (project_id,))
        project_row = cursor.fetchone()
        if not project_row:
            cursor.close()
            return False, "项目不存在。"
        project_title = project_row[0]

        # 获取子任务 ID 列表
        cursor.execute("SELECT id FROM tasks WHERE parent_project_id = %s", (project_id,))
        task_ids = [row[0] for row in cursor.fetchall()]

        # 清除所有与这些子任务相关的依赖引用
        for task_id in task_ids:
            cursor.execute(
                "SELECT id, dependencies FROM tasks WHERE FIND_IN_SET(%s, dependencies) > 0",
                (str(task_id),))
            for aff_id, deps in cursor.fetchall():
                new_deps = ",".join([d.strip() for d in str(deps).split(',')
                                     if d.strip().isdigit() and int(d.strip()) != task_id])
                cursor.execute("UPDATE tasks SET dependencies = %s WHERE id = %s",
                               (new_deps or None, aff_id))

        # 删除子任务
        if task_ids:
            placeholders = ",".join(["%s"] * len(task_ids))
            cursor.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", task_ids)

        # 删除项目
        cursor.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        self.conn.commit()
        cursor.close()
        logger.info(f"管理员删除项目: {project_title} (ID={project_id}), 级联删除 {len(task_ids)} 个子任务")
        return True, f"项目「{project_title}」及其 {len(task_ids)} 个子任务已删除。"

    # === 任务级操作 ===

    def update_task(self, task_id: int, **kwargs) -> tuple[bool, str]:
        """动态更新 tasks 表字段"""
        if not kwargs:
            return False, "无更新内容"
        allowed = {"title", "description", "assignee", "assignee_id", "deadline",
                    "status", "priority", "dependencies"}
        updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not updates:
            return False, "无可更新的字段"
        # 如有 assignee 变更，同步更新 assignee_id（不存在则拒绝）
        if "assignee" in updates:
            cursor = self.conn.cursor()
            cursor.execute("SELECT id FROM users WHERE name = %s", (updates["assignee"],))
            user_row = cursor.fetchone()
            cursor.close()
            if user_row:
                updates["assignee_id"] = user_row[0]
            else:
                return False, f"负责人「{updates['assignee']}」不存在，请检查后重试。"
        # 状态从 Rejected 变更 → 同时清除驳回标记
        if updates.get("status") and updates["status"] != "Rejected":
            cur = self.conn.cursor()
            cur.execute("SELECT status FROM tasks WHERE id = %s", (task_id,))
            old = cur.fetchone()
            cur.close()
            if old and old[0] == "Rejected":
                updates["review_status"] = "approved"
                updates["rejection_reason"] = None

        cursor = self.conn.cursor()
        set_clause = ", ".join(f"{k} = %s" for k in updates)
        values = list(updates.values()) + [task_id]
        cursor.execute(f"UPDATE tasks SET {set_clause}, updated_at = NOW() WHERE id = %s", values)
        self.conn.commit()
        cursor.close()

        # 状态改为 Done 时，解封依赖此任务的其他任务 + 检查项目是否完成
        if updates.get("status") == "Done":
            unblocked = []
            dependent = self.get_dependent_tasks(task_id)
            for dep_task in dependent:
                if dep_task['status'] == 'Blocked' and self.are_dependencies_met(dep_task['id']):
                    cur = self.conn.cursor()
                    cur.execute("UPDATE tasks SET status = 'Todo', updated_at = NOW() WHERE id = %s",
                                (dep_task['id'],))
                    self.conn.commit()
                    cur.close()
                    unblocked.append(dep_task['title'])
                    logger.info(f"管理员将任务{task_id}改为Done，解封依赖任务: {dep_task['id']}「{dep_task['title']}」")
            if unblocked:
                logger.info(f"任务{task_id}改为Done，共解封 {len(unblocked)} 个依赖任务: {unblocked}")

            # 检查所属项目是否所有任务都已完成
            cur = self.conn.cursor()
            cur.execute("SELECT parent_project_id FROM tasks WHERE id = %s", (task_id,))
            row = cur.fetchone()
            if row and row[0]:
                project_id = row[0]
                cur.execute(
                    "SELECT COUNT(*) FROM tasks WHERE parent_project_id = %s AND status != 'Done'",
                    (project_id,))
                remaining = cur.fetchone()[0]
                if remaining == 0:
                    cur.execute("UPDATE projects SET status = 'Done', updated_at = NOW() WHERE id = %s",
                                (project_id,))
                    self.conn.commit()
                    logger.info(f"项目 {project_id} 所有任务已完成，自动标记为 Done")
            cur.close()

        logger.info(f"任务{task_id}已更新: {updates}")
        return True, "任务已更新。"

    def add_task(self, project_id: int, title: str, assignee: str = "未分配",
                  deadline: str = None, priority: str = "Medium",
                  description: str = "", dependencies: str = None) -> tuple[int, str]:
        """向现有项目添加单个子任务，返回 (task_id, msg)"""
        cursor = self.conn.cursor()
        # 查询 assignee_id
        assignee_id = None
        if assignee and assignee != "未分配":
            cursor.execute("SELECT id FROM users WHERE name = %s", (assignee,))
            row = cursor.fetchone()
            if row:
                assignee_id = row[0]

        # 若无 deadline，默认取项目截止时间
        if not deadline:
            cursor.execute("SELECT deadline FROM projects WHERE id = %s", (project_id,))
            proj_row = cursor.fetchone()
            if proj_row:
                deadline = proj_row[0].strftime('%Y-%m-%d %H:%M:%S') if isinstance(proj_row[0], type(
                    __import__('datetime').datetime)) else str(proj_row[0])

        # 有依赖则初始状态为 Todo，稍后根据依赖是否满足决定是否 Blocked
        initial_status = 'Todo'
        cursor.execute(
            """INSERT INTO tasks (title, description, assignee, assignee_id, deadline,
               status, priority, dependencies, parent_project_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (title, description, assignee, assignee_id, deadline, initial_status, priority, dependencies, project_id))
        task_id = cursor.lastrowid

        # 有依赖且依赖未全部完成 → 自动标记为 Blocked
        if dependencies and str(dependencies).strip():
            dep_ids = self._parse_dependencies(dependencies)
            if dep_ids:
                ph = ','.join(['%s'] * len(dep_ids))
                cursor.execute(
                    f"SELECT COUNT(*) FROM tasks WHERE id IN ({ph}) AND status != 'Done'",
                    dep_ids)
                not_done = cursor.fetchone()[0]
                if not_done > 0:
                    cursor.execute(
                        "UPDATE tasks SET status = 'Blocked', updated_at = NOW() WHERE id = %s",
                        (task_id,))
                    logger.info(f"新任务{task_id}有未完成的依赖，自动标记为 Blocked")

        self.conn.commit()
        cursor.close()
        logger.info(f"向项目{project_id}添加任务: {title} (ID={task_id})")
        return task_id, f"任务「{title}」已添加。"

    # === 依赖管理 ===

    @staticmethod
    def _parse_dependencies(dep_str) -> list[int]:
        if not dep_str or not str(dep_str).strip():
            return []
        ids = []
        for s in str(dep_str).split(','):
            s = s.strip()
            if s.isdigit():
                ids.append(int(s))
        return ids

    def get_task_dependencies(self, task_id: int) -> list[dict]:
        """查询某个任务依赖的前置任务及其完成状态"""
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute("SELECT dependencies FROM tasks WHERE id = %s", (task_id,))
        row = cursor.fetchone()
        if not row or not row['dependencies']:
            cursor.close()
            return []
        dep_ids = self._parse_dependencies(row['dependencies'])
        if not dep_ids:
            cursor.close()
            return []
        placeholders = ','.join(['%s'] * len(dep_ids))
        cursor.execute(
            f"SELECT id, title, assignee, status, deadline FROM tasks WHERE id IN ({placeholders})",
            dep_ids)
        result = cursor.fetchall()
        cursor.close()
        return result

    def get_dependent_tasks(self, task_id: int) -> list[dict]:
        """查询哪些任务依赖此任务（在等它完成）"""
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, title, assignee, status, dependencies FROM tasks WHERE FIND_IN_SET(%s, dependencies) > 0",
            (str(task_id),))
        result = cursor.fetchall()
        cursor.close()
        return result

    def are_dependencies_met(self, task_id: int) -> bool:
        """检查某任务的所有前置依赖是否都已完成"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT dependencies FROM tasks WHERE id = %s", (task_id,))
        row = cursor.fetchone()
        if not row or not row[0]:
            cursor.close()
            return True
        dep_ids = self._parse_dependencies(row[0])
        if not dep_ids:
            cursor.close()
            return True
        placeholders = ','.join(['%s'] * len(dep_ids))
        cursor.execute(
            f"SELECT COUNT(*) FROM tasks WHERE id IN ({placeholders}) AND status != 'Done'",
            dep_ids)
        not_done = cursor.fetchone()[0]
        cursor.close()
        return not_done == 0

    def sync_blocked_status(self, task_id: int) -> str:
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, title, status, dependencies FROM tasks WHERE id = %s AND status != 'Done'",
            (task_id,))
        task = cursor.fetchone()
        if not task:
            cursor.close()
            return "done_or_not_found"
        has_deps = bool(task['dependencies'] and str(task['dependencies']).strip())
        if not has_deps:
            cursor.close()
            return "no_deps"
        deps_met = self.are_dependencies_met(task_id)
        if not deps_met and task['status'] != 'Blocked':
            cursor.execute("UPDATE tasks SET status = 'Blocked', updated_at = NOW() WHERE id = %s", (task_id,))
            self.conn.commit()
            cursor.close()
            logger.info(f"任务 {task_id}「{task['title']}」依赖未满足，自动标记为 Blocked")
            return "blocked"
        elif deps_met and task['status'] == 'Blocked':
            cursor.execute("UPDATE tasks SET status = 'Todo', updated_at = NOW() WHERE id = %s", (task_id,))
            self.conn.commit()
            cursor.close()
            logger.info(f"任务 {task_id}「{task['title']}」依赖已满足，自动解封为 Todo")
            return "unblocked"
        cursor.close()
        return "unchanged"

    # === 评论管理 ===

    def add_comment(self, task_id: int, user_id: int, content: str) -> tuple[int, str]:
        """添加评论，返回 (comment_id, msg)"""
        cursor = self.conn.cursor()
        cursor.execute(
            "INSERT INTO task_comments (task_id, user_id, content) VALUES (%s, %s, %s)",
            (task_id, user_id, content))
        self.conn.commit()
        cid = cursor.lastrowid
        cursor.close()
        return cid, "评论已添加。"

    def get_comments(self, task_id: int) -> list[dict]:
        """获取任务评论列表（含用户名）"""
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute(
            """SELECT c.id, c.task_id, c.user_id, u.name AS user_name, c.content, c.created_at
               FROM task_comments c JOIN users u ON c.user_id = u.id
               WHERE c.task_id = %s ORDER BY c.created_at ASC""",
            (task_id,))
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def delete_comment(self, comment_id: int, user_id: int, is_admin: bool = False) -> tuple[bool, str]:
        """删除评论：管理员可删任意评论，普通用户仅可删自己的"""
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute("SELECT user_id FROM task_comments WHERE id = %s", (comment_id,))
        row = cursor.fetchone()
        if not row:
            cursor.close()
            return False, "评论不存在。"
        if not is_admin and row['user_id'] != user_id:
            cursor.close()
            return False, "无权删除此评论。"
        cursor.execute("DELETE FROM task_comments WHERE id = %s", (comment_id,))
        self.conn.commit()
        cursor.close()
        return True, "评论已删除。"

    # === 批量操作 ===

    def batch_update_tasks(self, task_ids: list[int], **kwargs) -> tuple[int, str]:
        """批量更新任务字段，返回 (影响行数, msg)"""
        if not task_ids:
            return 0, "未选择任务。"
        allowed = {"status", "priority", "assignee", "assignee_id", "deadline"}
        updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not updates:
            return 0, "无可更新的字段。"
        if "assignee" in updates:
            cursor = self.conn.cursor()
            cursor.execute("SELECT id FROM users WHERE name = %s", (updates["assignee"],))
            user_row = cursor.fetchone()
            cursor.close()
            if user_row:
                updates["assignee_id"] = user_row[0]
            else:
                return 0, f"负责人「{updates['assignee']}」不存在。"
        cursor = self.conn.cursor()
        set_clause = ", ".join(f"{k} = %s" for k in updates)
        placeholders = ",".join(["%s"] * len(task_ids))
        values = list(updates.values()) + task_ids
        cursor.execute(
            f"UPDATE tasks SET {set_clause}, updated_at = NOW() WHERE id IN ({placeholders})",
            values)
        affected = cursor.rowcount
        self.conn.commit()
        cursor.close()

        # 状态从 Rejected 变更 → 批量清除驳回标记
        if updates.get("status") and updates["status"] != "Rejected":
            cur = self.conn.cursor()
            ph = ",".join(["%s"] * len(task_ids))
            cur.execute(
                f"UPDATE tasks SET review_status = 'approved', rejection_reason = NULL "
                f"WHERE id IN ({ph}) AND status = 'Rejected'",
                task_ids)
            cur.close()
            self.conn.commit()

        logger.info(f"批量更新 {affected} 个任务: {updates}")
        return affected, f"已更新 {affected} 个任务。"

    def batch_delete_tasks(self, task_ids: list[int]) -> tuple[int, str]:
        """批量删除任务，返回 (影响行数, msg)"""
        if not task_ids:
            return 0, "未选择任务。"
        cursor = self.conn.cursor()
        # 清除依赖引用
        for tid in task_ids:
            cursor.execute(
                "SELECT id, dependencies FROM tasks WHERE FIND_IN_SET(%s, dependencies) > 0",
                (str(tid),))
            for aff_id, deps in cursor.fetchall():
                new_deps = ",".join([d.strip() for d in str(deps).split(',')
                                     if d.strip().isdigit() and int(d.strip()) != tid])
                cursor.execute("UPDATE tasks SET dependencies = %s WHERE id = %s",
                               (new_deps or None, aff_id))
        placeholders = ",".join(["%s"] * len(task_ids))
        cursor.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", task_ids)
        affected = cursor.rowcount
        self.conn.commit()
        cursor.close()
        logger.info(f"批量删除 {affected} 个任务")
        return affected, f"已删除 {affected} 个任务。"

    def reject_task(self, task_id: int, reason: str = "") -> tuple[bool, str, list]:
        """驳回任务并级联驳回所有依赖它的任务。返回 (成功, 消息, 被影响的任务列表)"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT id, title, status FROM tasks WHERE id = %s", (task_id,))
        task = cursor.fetchone()
        if not task:
            cursor.close()
            return False, "任务不存在。", []

        affected = []

        # 1. 驳回目标任务
        cursor.execute(
            "UPDATE tasks SET status = 'Rejected', review_status = 'rejected', "
            "rejection_reason = %s, updated_at = NOW() WHERE id = %s",
            (reason, task_id),
        )
        affected.append({"id": task_id, "title": task[1], "reason": reason, "cascaded": False})
        logger.info(f"任务 {task[1]} (ID={task_id}) 被驳回，原因: {reason}")

        # 2. 查找所有依赖此任务的其他任务
        cursor.execute(
            "SELECT id, title, dependencies FROM tasks WHERE FIND_IN_SET(%s, dependencies) > 0",
            (str(task_id),),
        )
        dependent_tasks = cursor.fetchall()

        # 3. 级联驳回
        cascade_ids = []
        for dep_id, dep_title, _ in dependent_tasks:
            cascade_reason = f"因前置任务「{task[1]}」被驳回，该任务连带驳回"
            cursor.execute(
                "UPDATE tasks SET status = 'Rejected', review_status = 'rejected', "
                "rejection_reason = %s, rejected_by_task_id = %s, updated_at = NOW() WHERE id = %s",
                (cascade_reason, task_id, dep_id),
            )
            affected.append({"id": dep_id, "title": dep_title, "reason": cascade_reason, "cascaded": True})
            cascade_ids.append(dep_id)
            logger.info(f"级联驳回: 任务 {dep_title} (ID={dep_id}) 因依赖 {task[1]} 被驳回")

        self.conn.commit()
        cursor.close()
        return True, f"已驳回「{task[1]}」" + (f"，级联驳回 {len(cascade_ids)} 个依赖任务" if cascade_ids else ""), affected

    def close(self):
        self.conn.close()
