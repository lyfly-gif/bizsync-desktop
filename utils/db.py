import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import mysql.connector

from config import Config

conf = Config()


def get_connection():
    """获取数据库连接"""
    return mysql.connector.connect(
        host=conf.host,
        user=conf.user,
        password=conf.password,
        database=conf.database,
        charset="utf8mb4"
    )


def execute_query(sql: str, params: tuple = None, fetch: bool = True):
    """执行查询并返回结果"""
    conn = get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, params or ())
        if fetch:
            results = cursor.fetchall()
            return results
        conn.commit()
        return cursor.rowcount
    finally:
        cursor.close()
        conn.close()


def execute_insert(sql: str, params: tuple) -> int:
    """执行插入并返回 lastrowid"""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        cursor.close()
        conn.close()
