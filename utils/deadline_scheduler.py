import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import mysql.connector
from datetime import datetime
import schedule
import time
import pytz

from config import Config
from create_logger import logger

conf = Config()

TZ = pytz.timezone('Asia/Shanghai')

# MySQL 配置
db_config = {
    "host": conf.host,
    "user": conf.user,
    "password": conf.password,
    "database": conf.database,
    "charset": "utf8mb4"
}


# 连接数据库
def connect_db():
    return mysql.connector.connect(**db_config)


# 查询所有管理员
def get_admin_users(cursor):
    cursor.execute("SELECT id, name FROM users WHERE role = 'admin'")
    return cursor.fetchall()


# 查询所有即将逾期或已逾期的任务
def check_deadlines(cursor):
    current_time = datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S')
    # 查询未完成且截止时间在未来3天内或已逾期的任务
    sql = """
    SELECT id, title, assignee, assignee_id, deadline, status, notified_count
    FROM tasks
    WHERE status IN ('Todo', 'Doing')
      AND deadline <= DATE_ADD(%s, INTERVAL 3 DAY)
    ORDER BY deadline ASC
    """
    cursor.execute(sql, (current_time,))
    return cursor.fetchall()


# 记录通知到数据库
def save_notification(cursor, task_id, receiver, channel, urgency, message):
    sql = "INSERT INTO notifications (task_id, receiver, channel, urgency, message, send_status) VALUES (%s, %s, %s, %s, %s, 'success')"
    cursor.execute(sql, (task_id, receiver, channel, urgency, message))


def classify_urgency(remaining_seconds: float) -> tuple[str, str, str]:
    """
    根据剩余时间分级，返回 (urgency_db, icon, label)
    urgency_db: critical / high / medium / low / info
    """
    if remaining_seconds < 0:
        return "critical", "🔴", "已逾期"
    elif remaining_seconds <= 600:          # ≤ 10 分钟
        return "critical", "🔴", "即将超时"
    elif remaining_seconds <= 3600:         # ≤ 1 小时
        return "high", "🟠", "1小时内到期"
    elif remaining_seconds <= 10800:        # ≤ 3 小时
        return "medium", "🟡", "3小时内到期"
    elif remaining_seconds <= 86400:        # ≤ 24 小时
        return "low", "🔵", "24小时内到期"
    else:
        return "info", "⚪", "3天内到期"


# 检查并推送逾期预警
def check_and_notify():
    logger.info("=== 开始执行倒计时检查任务 ===")
    conn = None
    cursor = None

    try:
        conn = connect_db()
        cursor = conn.cursor()
        tasks = check_deadlines(cursor)
        admins = get_admin_users(cursor)
        current_time = datetime.now(TZ)

        logger.info(f"检测到 {len(tasks)} 个待检查任务，{len(admins)} 个管理员")

        for task in tasks:
            task_id, title, assignee, assignee_id, deadline, status, notified_count = task

            # 确保 deadline 有时区信息
            if deadline.tzinfo is None:
                deadline = TZ.localize(deadline)

            remaining_seconds = (deadline - current_time).total_seconds()
            urgency_db, icon, label = classify_urgency(remaining_seconds)

            # 构建分级提醒消息
            if remaining_seconds < 0:
                hours = abs(int(remaining_seconds / 3600))
                mins = abs(int(remaining_seconds / 60)) % 60
                if hours > 0:
                    message = f"{icon} 【逾期】任务「{title}」已逾期 {hours}小时{mins}分钟，请立即处理！"
                else:
                    message = f"{icon} 【逾期】任务「{title}」已逾期 {mins}分钟，请立即处理！"
            elif remaining_seconds <= 600:
                mins = int(remaining_seconds / 60)
                message = f"{icon} 【紧急】任务「{title}」仅剩 {mins}分钟到期，截止时间 {deadline.strftime('%H:%M')}！"
            elif remaining_seconds <= 3600:
                hours = int(remaining_seconds / 3600)
                mins = int((remaining_seconds % 3600) / 60)
                message = f"{icon} 【重要】任务「{title}」将在 {hours}小时{mins}分钟后到期。"
            elif remaining_seconds <= 10800:
                hours = int(remaining_seconds / 3600)
                message = f"{icon} 【提醒】任务「{title}」将在约 {hours}小时后到期。"
            elif remaining_seconds <= 86400:
                hours = int(remaining_seconds / 3600)
                message = f"{icon} 【通知】任务「{title}」将在 {hours}小时后到期。"
            else:
                days = int(remaining_seconds / 86400)
                message = f"{icon} 【预告】任务「{title}」将在约 {days}天后到期。"

            logger.info(f"[{label}] [{assignee}] {title} - 剩余 {int(remaining_seconds/60)}分钟")

            # 推送给责任人
            save_notification(cursor, task_id, assignee, "dingtalk", urgency_db, message)
            logger.info(f"  通知责任人: {assignee} ({urgency_db})")

            # 推送给所有管理员
            for admin_id, admin_name in admins:
                save_notification(cursor, task_id, admin_name, "dingtalk", urgency_db, message)
            logger.info(f"  通知 {len(admins)} 个管理员: {[a[1] for a in admins]}")

        conn.commit()
    except Exception as e:
        logger.error(f"倒计时检查出错: {e}", exc_info=True)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    logger.info("=== 倒计时检查任务完成 ===")


# 设置定时任务，每30分钟检查一次
def setup_scheduler():
    schedule.every(30).minutes.do(check_and_notify)

    logger.info("倒计时调度器已启动，每30分钟检查一次任务截止时间")
    print("倒计时调度器已启动，每30分钟检查一次...")

    fail_count = 0
    max_fails = 10
    while True:
        try:
            schedule.run_pending()
            fail_count = 0  # 成功执行，重置计数器
        except Exception as e:
            fail_count += 1
            logger.error(f"调度器执行异常 (第{fail_count}次): {e}", exc_info=True)
            if fail_count >= max_fails:
                logger.critical(f"调度器连续失败 {max_fails} 次，退出")
                break
            time.sleep(30)  # 异常后短暂等待再重试
        time.sleep(60)


if __name__ == '__main__':
    # todo: 1.测试数据库连接
    # conn = connect_db()
    # print(conn.is_connected())
    # print('数据库连接成功')
    # conn.close()

    # todo: 2.测试检查逾期任务
    # conn = connect_db()
    # cursor = conn.cursor()
    # tasks = check_deadlines(cursor)
    # for t in tasks:
    #     print(t)
    # cursor.close()
    # conn.close()

    # todo: 3.启动定时任务
    setup_scheduler()
