import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

export default function NewProjectModal({ onClose, onCreated }) {
  const toast = useToast();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [projectTitle, setProjectTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [users, setUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // 默认空任务行
  const emptyTask = () => ({ title: '', assignee: '', deadline: '', priority: 'Medium' });
  const [tasks, setTasks] = useState([emptyTask()]);

  // 懒加载用户列表
  const loadUsers = async () => {
    if (usersLoaded) return;
    try {
      const { data } = await api.get('/users');
      setUsers(data.users || []);
      setUsersLoaded(true);
    } catch {}
  };

  const addRow = () => setTasks(prev => [...prev, emptyTask()]);
  const removeRow = (i) => setTasks(prev => prev.filter((_, idx) => idx !== i));
  const updateTask = (i, field, value) => {
    setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  };

  const handleSubmit = async () => {
    if (!projectTitle.trim()) return toast.info('请输入项目标题');
    const validTasks = tasks.filter(t => t.title.trim());
    if (validTasks.length === 0) return toast.info('请至少添加一个任务');

    setSaving(true);
    try {
      await api.post('/projects', {
        project_title: projectTitle,
        tasks: validTasks.map(t => ({
          title: t.title,
          assignee: t.assignee || '未分配',
          deadline: t.deadline || undefined,
          priority: t.priority || 'Medium',
        })),
        creator_id: user.id,
      });
      onCreated();
      onClose();
    } catch (err) {
      toast.error('创建失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">新建大项目</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(85vh-140px)]">
          {/* 项目基本信息 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">项目标题 *</label>
              <input type="text" value={projectTitle} onChange={e => setProjectTitle(e.target.value)}
                placeholder="如：Q3 产品迭代规划"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">项目截止时间</label>
              <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">项目描述</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="简述项目目标、范围等"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-600 outline-none resize-none h-16" />
          </div>

          {/* 任务表格 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-700">子任务列表</label>
              <button onClick={addRow}
                className="flex items-center text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                <Plus className="w-3.5 h-3.5 mr-1" /> 添加任务
              </button>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 w-[30%]">任务名</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 w-[18%]">责任人</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 w-[22%]">截止时间</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 w-[18%]">优先级</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-slate-500 w-[12%]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tasks.map((t, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <input type="text" value={t.title} onChange={e => updateTask(i, 'title', e.target.value)}
                          placeholder="输入任务名称"
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-indigo-600 outline-none" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={t.assignee} onChange={e => updateTask(i, 'assignee', e.target.value)}
                          onFocus={loadUsers}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white focus:ring-1 focus:ring-indigo-600 outline-none">
                          <option value="">未分配</option>
                          {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="datetime-local" value={t.deadline} onChange={e => updateTask(i, 'deadline', e.target.value)}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-indigo-600 outline-none" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={t.priority} onChange={e => updateTask(i, 'priority', e.target.value)}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white focus:ring-1 focus:ring-indigo-600 outline-none">
                          <option value="High">高</option>
                          <option value="Medium">中</option>
                          <option value="Low">低</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeRow(i)}
                          className="text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50 flex justify-end space-x-3">
          <button onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition">取消</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition shadow-sm disabled:opacity-50">
            {saving ? '创建中...' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  );
}
