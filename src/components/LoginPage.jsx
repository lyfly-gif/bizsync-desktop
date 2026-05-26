import { useState } from 'react';
import { Building2, User, Lock, ArrowRight, AlertTriangle } from 'lucide-react';
import BizSyncLogo from './BizSyncLogo';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const { login, loading } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg("请输入账号和密码");
      return;
    }
    try {
      await login(username, password);
      onLogin();
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || "登录失败，请重试");
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:flex lg:w-5/12 bg-indigo-900 text-white flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-10">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-400 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-[-20%] w-full h-1/2 bg-indigo-500 rounded-tr-full blur-3xl"></div>
        </div>
        <div className="z-10 mt-8">
          <div className="flex items-center space-x-3 mb-10">
            <div className="p-2 bg-indigo-500/30 rounded-lg backdrop-blur-sm border border-indigo-400/30">
              <BizSyncLogo className="w-8 h-8" />
            </div>
            <span className="text-3xl font-bold tracking-tight">BizSync</span>
          </div>
          <h1 className="text-4xl font-extrabold leading-tight mb-6">
            基于多 Agent 协作的<br/><span className="text-blue-300">企业级智能办公助手</span>
          </h1>
          <p className="text-indigo-200 text-lg max-w-md leading-relaxed mb-12">
            告别"开会无定论、会后无跟进"。通过 AI 驱动的会议纪要、智能派单与全透明督办，让企业协同效率提升 10 倍。
          </p>
        </div>
        <div className="z-10 text-sm text-indigo-400">&copy; 2026 BizSync AI Workspace.</div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center bg-white p-8 sm:p-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-slate-900 mb-2">欢迎回来</h2>
            <p className="text-slate-500">请选择您的角色并登录系统</p>
          </div>
          <div className="flex p-1 bg-slate-100 rounded-lg mb-8">
            <button type="button" onClick={() => setRole('admin')} className={`flex-1 flex items-center justify-center space-x-2 py-2.5 text-sm font-medium rounded-md transition-all ${role === 'admin' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
              <Building2 className="w-4 h-4" /><span>PM / 管理员</span>
            </button>
            <button type="button" onClick={() => setRole('user')} className={`flex-1 flex items-center justify-center space-x-2 py-2.5 text-sm font-medium rounded-md transition-all ${role === 'user' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
              <User className="w-4 h-4" /><span>执行人员</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">企业账号</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><User className="h-5 w-5 text-slate-400" /></div>
                <input type="text" required className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 outline-none"
                  placeholder={role === 'admin' ? "pm@company.com" : "employee@company.com"}
                  value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">密码</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Lock className="h-5 w-5 text-slate-400" /></div>
                <input type="password" required className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-600 outline-none"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            {errorMsg && <div className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg border border-red-100 flex items-center"><AlertTriangle className="w-4 h-4 mr-2" />{errorMsg}</div>}
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-medium transition-colors">
              <span>{loading ? '登录中...' : '进入工作台'}</span><ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
