from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import bcrypt
import mysql.connector

from config import Config

conf = Config()


def hash_password(password: str) -> str:
    """使用 bcrypt 哈希密码"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    """验证密码"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def authenticate_user(username: str, password: str) -> dict | None:
    """查询 users 表验证密码，返回用户字典或 None"""
    try:
        conn = mysql.connector.connect(
            host=conf.host, user=conf.user,
            password=conf.password, database=conf.database
        )
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, name, password_hash, role FROM users WHERE name = %s", (username,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if user and verify_password(password, user['password_hash']):
            return {"id": user['id'], "name": user['name'], "role": user['role']}
        return None
    except Exception as e:
        print(f"认证错误: {e}")
        return None


def get_all_users() -> list[dict]:
    """获取所有用户列表（供管理员查看）"""
    try:
        conn = mysql.connector.connect(
            host=conf.host, user=conf.user,
            password=conf.password, database=conf.database
        )
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, name, role FROM users ORDER BY id")
        users = cursor.fetchall()
        cursor.close()
        conn.close()
        return users
    except Exception as e:
        print(f"获取用户列表错误: {e}")
        return []


def create_user(name: str, password: str, role: str = "user") -> tuple[bool, str]:
    """管理员创建新用户"""
    if not name or not password:
        return False, "用户名和密码不能为空"
    try:
        conn = mysql.connector.connect(
            host=conf.host, user=conf.user,
            password=conf.password, database=conf.database
        )
        cursor = conn.cursor()
        password_hash = hash_password(password)
        cursor.execute(
            "INSERT INTO users (name, password_hash, role) VALUES (%s, %s, %s)",
            (name, password_hash, role)
        )
        conn.commit()
        cursor.close()
        conn.close()
        return True, f"用户 {name} 创建成功"
    except mysql.connector.IntegrityError:
        return False, f"用户名 {name} 已存在"
    except Exception as e:
        return False, f"创建失败: {e}"


def delete_user(user_id: int) -> tuple[bool, str]:
    """管理员删除用户（不能删除自己）"""
    try:
        conn = mysql.connector.connect(
            host=conf.host, user=conf.user,
            password=conf.password, database=conf.database
        )
        cursor = conn.cursor()
        # 先检查
        cursor.execute("SELECT name FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
        if not row:
            cursor.close()
            conn.close()
            return False, "用户不存在"
        name = row[0]
        # 将关联任务置为未分配
        cursor.execute("UPDATE tasks SET assignee_id = NULL WHERE assignee_id = %s", (user_id,))
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return True, f"用户 {name} 已删除"
    except Exception as e:
        return False, f"删除失败: {e}"
