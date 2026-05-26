import { useState, useEffect } from 'react';
import { X, Edit, Link, CheckSquare } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

function toArray(deps) {
  if (!deps) return [];
  if (Array.isArray(deps)) return deps;
  if (typeof deps === 'string') return deps.split(',').filter(Boolean).map(s => parseInt(s.trim()));
  return [];
}

export default function EditTaskModal({ task, allTasks, onClose, onSave }) {
  const toast = useToast();
  const [edited, setEdited] = useState({ ...task, dependencies: toArray(task.dependencies) });
  const [users, setUsers] = useState([]);
  const availableDeps = allTasks.filter(t => t.id !== task.id);

  useEffect(() => {
    api.get('/users').then(({ data }) => setUsers(data.users || [])).catch((err) => { toast.error('加载用户列表失败'); console.error(err); });
  }, []);

  const toggleDep = (depId) => {
    setEdited(prev => ({
      ...prev,
      dependencies: prev.dependencies.includes(depId)
        ? prev.dependencies.filter(id => id !== depId)
        : [...prev.dependencies, depId]
    }));
  };

  const handleSave = () => {
    onSave(edited);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800 flex items-center">
            <Edit className="w-5 h-5 mr-2 text-indigo-600" />编辑任务参数
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">任务名称</label>
            <input type="text" value={edited.title} onChange={e => setEdited({...edited, title: e.target.value})}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">责任人</label>
              <select value={edited.assignee || ''} onChange={e => setEdited({...edited, assignee: e.target.value})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none bg-white">
                <option value="">未分配</option>
                {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">状态</label>
              <select value={edited.status} onChange={e => setEdited({...edited, status: e.target.value})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none bg-white">
                <option value="Todo">待处理</option>
                <option value="Doing">执行中</option>
                <option value="Done">已完成</option>
                <option value="Blocked">被阻塞</option>
                <option value="Rejected">已驳回</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">截止时间</label>
            <input
              type="datetime-local"
              value={String(edited.deadline || '').replace(' ', 'T').substring(0, 16)}
              onChange={e => setEdited({...edited, deadline: e.target.value ? e.target.value.replace('T', ' ') + ':00' : ''})}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center">
              <Link className="w-4 h-4 mr-1 text-slate-500" />前置依赖配置（多选）
            </label>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto p-1">
              {availableDeps.map(dep => {
                const isSelected = edited.dependencies.includes(dep.id);
                return (
                  <button key={dep.id} onClick={() => toggleDep(dep.id)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm flex items-center transition-all ${
                      isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-medium shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center mr-3 flex-shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                      {isSelected && <CheckSquare className="w-3 h-3 text-white" />}
                    </div>
                    <span className="truncate">{dep.title}</span>
                  </button>
                );
              })}
              {availableDeps.length === 0 && <div className="text-sm text-slate-400 py-2">无可用的前置任务</div>}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition">取消</button>
          <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition shadow-sm">保存修改</button>
        </div>
      </div>
    </div>
  );
}
