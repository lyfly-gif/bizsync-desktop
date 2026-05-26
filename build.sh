#!/bin/bash
# ============================================================
# BizSync Desktop — 本地构建脚本
# macOS 版本，Windows 需在对应环境下运行
# ============================================================
set -e

echo "=== 1. 构建 Python 后端 (PyInstaller) ==="
pip install --upgrade pip
pip install -r requirements-ci.txt pyinstaller

# 确定平台分隔符
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    SEP=";"
    EXE_NAME="bizsync-backend.exe"
else
    SEP=":"
    EXE_NAME="bizsync-backend"
fi

pyinstaller --onefile \
    --name "$EXE_NAME" \
    --add-data "backend${SEP}backend" \
    --add-data "utils${SEP}utils" \
    --add-data "config.py${SEP}." \
    --add-data "main_prompts.py${SEP}." \
    --add-data "create_logger.py${SEP}." \
    --hidden-import=uvicorn \
    --hidden-import=uvicorn.loops.auto \
    --hidden-import=uvicorn.protocols.http.auto \
    --hidden-import=fastapi \
    --hidden-import=mysql.connector \
    --hidden-import=langgraph \
    --hidden-import=langchain_openai \
    --hidden-import=langchain_core \
    --hidden-import=bcrypt \
    --hidden-import=pydantic \
    --hidden-import=pydantic.deprecated.decorator \
    --hidden-import=aiofiles \
    --hidden-import=python_multipart \
    --hidden-import=jose \
    --hidden-import=dotenv \
    --hidden-import=pytz \
    --hidden-import=schedule \
    --hidden-import=jinja2 \
    --hidden-import=websockets \
    --hidden-import=docx \
    --hidden-import=PyPDF2 \
    --hidden-import=pdfplumber \
    --hidden-import=openai \
    --collect-submodules=uvicorn \
    --collect-submodules=fastapi \
    backend/entry.py

echo "=== 2. 复制后端二进制到项目根目录 ==="
cp "dist/$EXE_NAME" .

echo "=== 3. 构建前端 ==="
npm ci
npm run build

echo "=== 4. 构建 Tauri 桌面应用 ==="
cd src-tauri
cargo tauri build
cd ..

echo "=== 构建完成 ==="
echo "产物位置："
echo "  macOS: src-tauri/target/release/bundle/dmg/*.dmg"
echo "  Windows: src-tauri/target/release/bundle/nsis/*.exe"
