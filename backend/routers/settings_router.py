import json, os
from fastapi import APIRouter, Request
from backend.auth_jwt import get_current_user, get_admin_user
from fastapi import Depends

router = APIRouter(prefix="/api", tags=["设置"])

SETTINGS_DIR = os.path.expanduser("~/.bizsync")
SETTINGS_FILE = os.path.join(SETTINGS_DIR, "config.json")


def _load_settings() -> dict:
    if not os.path.exists(SETTINGS_FILE):
        return {"api_key": "", "base_url": "https://api.deepseek.com/v1", "model_name": "deepseek-chat"}
    with open(SETTINGS_FILE, "r") as f:
        return json.load(f)


def _save_settings(data: dict):
    os.makedirs(SETTINGS_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@router.get("/settings")
def get_settings(user: dict = Depends(get_current_user)):
    s = _load_settings()
    key = s.get("api_key", "")
    user_set = s.get("user_set_key", False)

    from config import Config
    if user_set:
        # 用户主动配置过：完全尊重用户选择
        configured = bool(key)
        from_default = False
    else:
        # 用户从未配置：使用 .env 默认值
        configured = bool(key or Config().api_key)
        from_default = bool(Config().api_key)

    return {"configured": configured, "from_default": from_default, **s}


@router.post("/settings")
async def update_settings(request: Request, user: dict = Depends(get_admin_user)):
    body = await request.json()
    current = _load_settings()

    # 用户主动保存，标记为已配置
    current["user_set_key"] = True

    if "api_key" in body:
        current["api_key"] = body["api_key"]
    if body.get("base_url"):
        current["base_url"] = body["base_url"]
    if body.get("model_name"):
        current["model_name"] = body["model_name"]

    _save_settings(current)

    configured = bool(current.get("api_key", ""))
    return {"status": "ok", "configured": configured, "from_default": False}
