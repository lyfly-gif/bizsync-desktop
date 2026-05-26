import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.routers import auth_router, users_router, projects_router, tasks_router, comments_router, files_router, chat_router, conversations_router, settings_router

try:
    from backend.routers import asr_router
    HAS_ASR = True
except ImportError:
    HAS_ASR = False
    print("ASR module not available — voice features disabled")

app = FastAPI(title="BizSync API", version="2.0")


@app.on_event("startup")
def preload_asr_model():
    """后台预加载 ASR 模型，避免首次调用等待"""
    import threading

    def _load():
        from backend.routers.asr_router import _load_asr_model

        _load_asr_model()

    threading.Thread(target=_load, daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(projects_router.router)
app.include_router(tasks_router.router)
app.include_router(comments_router.router)
app.include_router(files_router.router)
app.include_router(chat_router.router)
if HAS_ASR:
    app.include_router(asr_router.router)
app.include_router(conversations_router.router)
app.include_router(settings_router.router)


# 全局异常处理：捕获 LLM API 错误并返回友好提示
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    msg = str(exc).lower()

    # 额度/余额耗尽
    if any(kw in msg for kw in ["insufficient balance", "not enough balance", "balance insufficient",
                                  "exceeded your current quota", "insufficient_quota",
                                  "billing", "payment required", "quota exceeded",
                                  "账户余额不足", "余额不足", "额度已用完"]):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=402, content={
            "status": "error",
            "message": "quota_exhausted",
            "reply": "API 额度已用完或账户余额不足，请前往对应大模型平台充值，或在大模型 API 设置中更换有效的 API Key。",
        })

    # API Key 无效
    if any(kw in msg for kw in ["401", "unauthorized", "invalid api key", "incorrect api key",
                                  "authentication", "auth", "api key not valid"]):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={
            "status": "error",
            "message": "api_key_invalid",
            "reply": "API Key 无效或被拒，请前往「大模型 API 设置」页面检查并更新您的 API Key。",
        })

    # 其他异常
    traceback.print_exc()
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={
        "status": "error",
        "message": str(exc),
    })


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0"}


# 生产环境：serve React 静态文件
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """Serve React SPA — 回退到 index.html"""
        file_path = os.path.join(frontend_dist, full_path) if full_path else os.path.join(frontend_dist, "index.html")
        if not os.path.exists(file_path):
            from fastapi.responses import FileResponse
            return FileResponse(os.path.join(frontend_dist, "index.html"))
        from fastapi.responses import FileResponse
        return FileResponse(file_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8009, reload=True)
