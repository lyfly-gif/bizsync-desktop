import json
import os

# 自动加载 .env 文件
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
except ImportError:
    pass

# 项目根目录
project_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def _load_user_settings():
    path = os.path.expanduser("~/.bizsync/config.json")
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


#定义配置文件
class Config:
    def __init__(self):
        user = _load_user_settings()

        # 大模型配置
        # user_set_key: 用户是否主动保存过设置（含主动清空）
        #   - false/不存在 → 首次使用，用 .env 默认值
        #   - true → 尊重用户选择，api_key 为空就是真的无 Key
        if user.get("user_set_key"):
            self.api_key = user.get("api_key", "")
        else:
            self.api_key = user.get("api_key") or os.getenv("AI_HELPER_API_KEY", "")

        self.base_url = user.get("base_url") or os.getenv("AI_HELPER_BASE_URL", "https://api.deepseek.com/v1")
        self.model_name = user.get("model_name") or os.getenv("AI_HELPER_MODEL", "deepseek-chat")

        # ASR 语音识别配置（阿里云 DashScope / OpenAI Whisper API 兼容格式）
        self.asr_api_key = os.getenv("AI_HELPER_ASR_API_KEY", "")
        self.asr_api_base = os.getenv("AI_HELPER_ASR_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")

        # 数据库配置
        self.host = os.getenv("AI_HELPER_DB_HOST", "localhost")
        self.user = os.getenv("AI_HELPER_DB_USER", "root")
        self.password = os.getenv("AI_HELPER_DB_PASSWORD", "")
        self.database = os.getenv("AI_HELPER_DB_NAME", "bizsync")

        # 日志配置
        self.log_file = os.path.join(project_root, 'AI_Helper', 'logs/app.log')


if __name__ == '__main__':
    print(Config().log_file)
