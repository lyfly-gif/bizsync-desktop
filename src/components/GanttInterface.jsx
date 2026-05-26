import { useState, useEffect } from 'react';
import { BarChartHorizontal, FolderKanban, Lock } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

function parseDepIds(deps) {
  if (!deps) return [];
  if (Array.isArray(deps)) return deps.map(Number);
  if (typeof deps === 'string') return deps.split(',').filter(Boolean).map(s => parseInt(s.trim()));
  return [];
}

function getBlockedStatus(task, allTasks) {
  if (task.status === 'Done') return false;
  const depIds = parseDepIds(task.dependencies);
  if (depIds.length === 0) return false;
  return depIds.some(depId => {
    const dep = allTasks.find(t => t.id === depId);
    return dep && dep.status !== 'Done';
  });
}

function getTaskBarStyle(task, totalDays) {
  const statusColors = {
    'Done':    { bar: 'bg-emerald-500 border-emerald-600', text: '已交付' },
    'Doing':   { bar: 'bg-blue-500 border-blue-600', text: '执行中' },
    'Todo':    { bar: 'bg-slate-400 border-slate-500', text: '待处理' },
    'Blocked': { bar: 'bg-orange-400 border-orange-500', text: '阻塞' },
    'Rejected':{ bar: 'bg-red-400 border-red-500', text: '已驳回' },
  };
  const colors = statusColors[task.status] || { bar: 'bg-slate-300 border-slate-400', text: task.status };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 2);

  if (!task.deadline) {
    return { position: 'pending', label: '待定' };
  }

  const deadline = new Date(task.deadline);
  deadline.setHours(0, 0, 0, 0);

  const dayOffset = Math.floor((deadline - startDate) / (1000 * 60 * 60 * 24));

  if (dayOffset < 0) {
    const leftPct = 0;
    const widthPct = 100 / totalDays;
    return { position: 'overdue', label: colors.text, colors, leftPct, widthPct };
  }
  if (dayOffset >= totalDays) {
    return { position: 'future', label: '待定', dayOffset };
  }

  const leftPct = dayOffset * (100 / totalDays);
  const widthPct = 100 / totalDays;

  return { position: 'in-range', label: colors.text, colors, leftPct, widthPct, dayOffset };
}

export default function GanttInterface() {
  const toast = useToast();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: pData } = await api.get('/projects');
        const all = await Promise.all(pData.projects.map(async (p) => {
          const { data: tData } = await api.get(`/projects/${p.id}/tasks`);
          return { ...p, tasks: tData.tasks };
        }));
        setProjects(all);
      } catch (err) { toast.error('加载甘特图数据失败: ' + (err.response?.data?.detail || err.message)); }
      finally { setLoading(false); }
    })();
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = 10;
  const days = Array.from({length: totalDays}, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i - 2);
    return d;
  });

  const todayColIndex = 2; // 今日在第 3 列（index 2）

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-white custom-scrollbar">
      <header className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center">
          <BarChartHorizontal className="w-6 h-6 mr-2 text-indigo-600" />全局甘特图视角
        </h2>
      </header>
      {loading ? (
        <div className="text-center text-slate-400 py-12">加载中...</div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
          <div className="min-w-[800px]">
            {/* 表头：日期行 */}
            <div className="flex border-b border-slate-200 bg-slate-100/50">
              <div className="w-64 flex-shrink-0 p-4 font-semibold text-sm text-slate-700 border-r border-slate-200">项目 / 任务层级</div>
              <div className="flex-1 flex">
                {days.map((d, i) => (
                  <div key={i} className={`flex-1 p-2 text-center text-xs font-medium border-r border-slate-200 ${i === todayColIndex ? 'bg-blue-50/50 text-blue-600 font-bold' : 'text-slate-500'}`}>
                    {d.getMonth()+1}/{d.getDate()}{i === todayColIndex && <><br/>今日</>}
                  </div>
                ))}
              </div>
              {/* 待定区域表头 */}
              <div className="w-20 flex-shrink-0 p-2 text-center text-xs font-medium text-slate-400 border-r border-slate-200 bg-slate-50">待定</div>
            </div>

            <div className="divide-y divide-slate-200">
              {projects.map(project => {
                const doneCount = project.tasks.filter(t => t.status === 'Done').length;
                const totalCount = project.tasks.length;
                const progress = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;
                const barColor = progress === 100 ? 'bg-emerald-500' : progress > 0 ? 'bg-indigo-500' : 'bg-slate-300';
                const bgColor = progress === 100 ? 'bg-emerald-100 border-emerald-300' : progress > 0 ? 'bg-indigo-100 border-indigo-300' : 'bg-slate-100 border-slate-200';
                return (
                <div key={project.id}>
                  {/* 项目行 */}
                  <div className="flex bg-white hover:bg-slate-50 transition-colors">
                    <div className="w-64 flex-shrink-0 p-4 border-r border-slate-200 flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-800 flex items-center truncate">
                        <FolderKanban className="w-4 h-4 mr-2 text-indigo-500 flex-shrink-0" />
                        <span className="truncate">{project.title}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 ml-2 flex-shrink-0">{doneCount}/{totalCount}</span>
                    </div>
                    <div className="flex-1 relative flex items-center">
                      <div className="absolute inset-0 flex">{days.map((_, i) => <div key={i} className="flex-1 border-r border-slate-100"></div>)}</div>
                      <div className={`relative h-6 border rounded-md shadow-sm ml-[10%] w-[60%] flex items-center px-2 overflow-hidden z-10 ${bgColor}`}>
                        <div className={`absolute left-0 top-0 bottom-0 opacity-30 ${barColor}`} style={{ width: `${progress}%` }}></div>
                        <span className="text-xs font-bold text-slate-700 relative z-10">{progress}%</span>
                      </div>
                    </div>
                    {/* 待定区域占位 */}
                    <div className="w-20 flex-shrink-0 border-r border-slate-200"></div>
                  </div>

                  {/* 任务行 */}
                  {project.tasks.map(task => {
                    const isBlocked = getBlockedStatus(task, project.tasks);
                    const barStyle = getTaskBarStyle(task, totalDays);

                    return (
                      <div key={task.id} className="flex bg-white hover:bg-slate-50 transition-colors">
                        {/* 任务名称 */}
                        <div className="w-64 flex-shrink-0 py-3 pr-4 pl-10 border-r border-slate-200 flex items-center">
                          {isBlocked ? <Lock className="w-3 h-3 text-orange-400 mr-2 flex-shrink-0" /> : <div className="w-2 h-2 rounded-full bg-slate-300 mr-2 flex-shrink-0"></div>}
                          <span className="text-xs text-slate-600 truncate">{task.title}</span>
                        </div>

                        {/* 日期列区域 */}
                        <div className="flex-1 relative flex items-center py-2">
                          <div className="absolute inset-0 flex">{days.map((_, i) => <div key={i} className="flex-1 border-r border-slate-100"></div>)}</div>

                          {barStyle.position === 'overdue' && (
                            <>
                              {/* 红色超期指示线 + 当前日期定位条 */}
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 z-10 rounded-r"></div>
                              <div className={`relative h-5 rounded-md shadow-sm z-10 border text-[10px] text-white flex items-center justify-center font-bold ${barStyle.colors.bar}`}
                                style={{ marginLeft: `${barStyle.leftPct}%`, width: `${barStyle.widthPct}%` }}>
                                {barStyle.label}
                              </div>
                            </>
                          )}

                          {barStyle.position === 'in-range' && (
                            <div className={`relative h-5 rounded-md shadow-sm z-10 border text-[10px] text-white flex items-center justify-center font-bold ${barStyle.colors.bar}`}
                              style={{ marginLeft: `${barStyle.leftPct}%`, width: `${barStyle.widthPct}%` }}>
                              {barStyle.label}
                            </div>
                          )}

                          {barStyle.position === 'future' && (
                            /* 占位不渲染，统一在右侧待定列显示 */
                            null
                          )}
                        </div>

                        {/* 待定列 */}
                        <div className="w-20 flex-shrink-0 py-2 flex items-center justify-center border-r border-slate-200 bg-slate-50">
                          {barStyle.position === 'pending' && (
                            <div className="h-5 rounded-md shadow-sm bg-slate-200 border border-slate-300 text-[10px] text-slate-500 flex items-center justify-center font-bold px-2">
                              待定
                            </div>
                          )}
                          {barStyle.position === 'future' && (
                            <div className="h-5 rounded-md shadow-sm bg-slate-100 border border-slate-200 text-[10px] text-slate-400 flex items-center justify-center font-bold px-2">
                              远期
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
