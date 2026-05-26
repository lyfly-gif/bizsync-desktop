import { useState, useEffect } from 'react';
import { Users, Plus } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

export default function UsersInterface() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users');
      const { data: statsData } = await api.get('/users/stats');
      setUsers(data.users.map(u => ({ ...u, stats: statsData.stats[u.id] || {} })));
    } catch (err) { toast.error('加载用户数据失败: ' + (err.response?.data?.detail || err.message)); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-slate-50">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
            <Users className="w-6 h-6 mr-2 text-indigo-600" />团队人员管理
          </h2>
        </div>
        <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition flex items-center">
          <Plus className="w-4 h-4 mr-1.5" />邀请新成员
        </button>
      </header>

      {loading ? (
        <div className="text-center text-slate-400 py-12">加载中...</div>
      ) : (
        <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">员工信息</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">角色</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">任务统计</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold ${u.role === 'admin' ? 'bg-indigo-500' : 'bg-emerald-500'} shadow-sm`}>
                        {u.name.charAt(0)}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-bold text-slate-900">{u.name}</div>
                        <div className="text-sm text-slate-500">ID: {u.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-md border ${u.role === 'admin' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                      {u.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                    <span className="mr-3">总: {u.stats.total || 0}</span>
                    <span className="mr-3 text-blue-600">进行中: {u.stats.doing || 0}</span>
                    <span className="mr-3 text-emerald-600">完成: {u.stats.done || 0}</span>
                    <span className="text-red-500">逾期: {u.stats.overdue || 0}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
