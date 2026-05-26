import { MessageSquare, FolderKanban, BarChartHorizontal, Users, LogOut, Settings } from 'lucide-react';
import BizSyncLogo from './BizSyncLogo';

export default function Sidebar({ role, currentUser, activeTab, onTabChange, onLogout }) {
  const tabs = [
    { id: 'chat', icon: MessageSquare, label: 'AI 智能分析助理', section: '智能协作区' },
    { id: 'projects', icon: FolderKanban, label: role === 'admin' ? '全局项目与任务' : '我的任务清单', section: '项目与任务视图' },
    { id: 'gantt', icon: BarChartHorizontal, label: '全局甘特图', section: null },
    { id: 'settings', icon: Settings, label: '大模型 API 设置', section: '系统设置' },
  ];

  const adminTabs = [
    { id: 'users', icon: Users, label: '团队人员管理', section: '系统管理' },
  ];

  const allTabs = role === 'admin' ? [...tabs, ...adminTabs] : tabs;

  let lastSection = '';
  return (
    <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col flex-shrink-0">
      <div className="p-4 flex items-center space-x-2.5 border-b border-slate-800">
        <div className="p-1.5 bg-indigo-500/30 rounded-lg">
          <BizSyncLogo className="w-5 h-5" />
        </div>
        <span className="text-lg font-bold text-white tracking-wide">BizSync</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {allTabs.map((tab) => {
          const showSection = tab.section && tab.section !== lastSection;
          if (tab.section) lastSection = tab.section;
          return (
            <div key={tab.id}>
              {showSection && (
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2 mt-3">{tab.section}</div>
              )}
              <button
                onClick={() => onTabChange(tab.id)}
                className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white font-medium shadow-md'
                    : 'hover:bg-slate-800 text-slate-400'
                }`}
              >
                <tab.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center space-x-2.5 mb-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${currentUser?.role === 'admin' ? 'bg-indigo-500' : 'bg-emerald-500'}`}>
            {currentUser?.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{currentUser?.name || '用户'}</div>
            <div className="text-xs text-slate-500 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1"></span> 在线
            </div>
          </div>
        </div>
        <button onClick={onLogout} className="w-full flex items-center justify-center space-x-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 py-2 rounded-lg transition-colors text-sm">
          <LogOut className="w-4 h-4" /><span>退出登录</span>
        </button>
      </div>
    </aside>
  );
}
