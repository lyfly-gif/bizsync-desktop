import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import streamlit as st
import uuid
import json
from datetime import datetime
from utils.auth import authenticate_user

st.set_page_config(page_title="AI Helper - 企业级智能办公助手", layout="wide", page_icon="🏢")

AUTH_FILE = os.path.join(os.path.dirname(__file__), ".auth_tokens.json")


def _load_tokens() -> dict:
    if os.path.exists(AUTH_FILE):
        try:
            with open(AUTH_FILE) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_tokens(tokens: dict):
    with open(AUTH_FILE, "w") as f:
        json.dump(tokens, f)


def _store_token(token: str, user: dict):
    tokens = _load_tokens()
    tokens[token] = {"id": user["id"], "name": user["name"], "role": user["role"],
                     "login_at": datetime.now().isoformat()}
    if len(tokens) > 20:
        items = sorted(tokens.items(), key=lambda x: x[1].get("login_at", ""), reverse=True)
        tokens = dict(items[:20])
    _save_tokens(tokens)


def _remove_token(token: str):
    tokens = _load_tokens()
    tokens.pop(token, None)
    _save_tokens(tokens)


# 初始化认证状态——完全不依赖 query_params
if "authenticated" not in st.session_state:
    st.session_state.authenticated = False
    st.session_state.user = None


if not st.session_state.authenticated:
    st.markdown("""
    <style>
    [data-testid="stSidebar"] { display: none; }
    .login-card { max-width: 400px; margin: 80px auto; padding: 40px;
        background: linear-gradient(135deg, #1a3a5c 0%, #234b6e 100%);
        border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .login-card h2 { color: #fff; text-align: center; margin-bottom: 30px; }
    </style>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div class="login-card">
        <h2>AI Helper<br>企业级智能办公助手</h2>
    </div>
    """, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 1, 1])
    with col2:
        with st.form("login_form"):
            username = st.text_input("用户名", placeholder="请输入用户名")
            password = st.text_input("密码", type="password", placeholder="请输入密码")
            submitted = st.form_submit_button("登 录", type="primary", use_container_width=True)

            if submitted:
                if not username or not password:
                    st.error("请输入用户名和密码")
                else:
                    user = authenticate_user(username, password)
                    if user:
                        token = uuid.uuid4().hex
                        st.session_state.authenticated = True
                        st.session_state.user = user
                        _store_token(token, user)
                        st.rerun()
                    else:
                        st.error("用户名或密码错误")

        st.markdown("""
        <div style="text-align:center; color:#888; margin-top:20px; font-size:13px;">
        测试账号：admin / admin123（管理员）<br>
        张三 / zs123（用户）| 李四 / ls123（用户）
        </div>
        """, unsafe_allow_html=True)

else:
    user = st.session_state.user
    role = user["role"]

    if role == "admin":
        pages = [
            st.Page("pages/1_Conversation.py", title="智能对话", icon="💬"),
            st.Page("pages/2_FileUpload.py", title="文件上传", icon="📁"),
            st.Page("pages/3_TaskBoard.py", title="任务看板", icon="📊"),
            st.Page("pages/5_UserManagement.py", title="用户管理", icon="👥"),
        ]
    else:
        pages = [
            st.Page("pages/1_Conversation.py", title="智能对话", icon="💬"),
            st.Page("pages/4_MyTasks.py", title="我的任务", icon="📋"),
        ]

    nav = st.navigation(pages)

    st.sidebar.markdown(f"### {'🔧' if role == 'admin' else '👤'} {user['name']}")
    st.sidebar.markdown(f"角色：{'管理员' if role == 'admin' else '普通用户'}")

    if st.sidebar.button("退出登录", use_container_width=True):
        st.session_state.clear()
        st.rerun()

    nav.run()
