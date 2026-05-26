import { useState, useEffect, useCallback } from 'react';
import { Plus, FolderKanban, Lock, CheckCircle2, Loader2, Link, User, FileText, Edit, MessageCircle, Filter, XCircle, AlertTriangle, X, Upload } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';
import BatchToolbar from './BatchToolbar';
import EditTaskModal from './EditTaskModal';
import CommentDrawer from './CommentDrawer';
import DynamicCountdown from './DynamicCountdown';
import NewProjectModal from './NewProjectModal';

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

export default function ProjectsInterface() {
  const toast = useToast();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const role = user.role || 'user';

  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [commentTask, setCommentTask] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [rejectingTask, setRejectingTask] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [taskFiles, setTaskFiles] = useState({});
  const [uploadingTaskId, setUploadingTaskId] = useState(null);
  const [filterUser, setFilterUser] = useState('all');
  const [showNewProject, setShowNewProject] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const { data: pData } = await api.get('/projects');
      const all = await Promise.all(pData.projects.map(async (p) => {
        const { data: tData } = await api.get(`/projects/${p.id}/tasks`);
        return { ...p, tasks: tData.tasks };
      }));

      // 并行加载所有任务的附件
      const allTaskIds = all.flatMap(p => p.tasks.map(t => t.id));
      const fileMap = {};
      if (allTaskIds.length > 0) {
        const fileResults = await Promise.all(allTaskIds.map(tid =>
          api.get(`/tasks/${tid}/files`).then(({ data }) => ({ tid, files: data.files })).catch(() => ({ tid, files: [] }))
        ));
        fileResults.forEach(({ tid, files }) => { if (files.length > 0) fileMap[tid] = files; });
      }

      setProjects(all);
      setTaskFiles(fileMap);

      if (role === 'admin') {
        const { data: uData } = await api.get('/users');
        setUsers(uData.users || []);
      }
    } catch (err) { toast.error('加载项目数据失败: ' + (err.response?.data?.detail || err.message)); }
    finally { setLoading(false); }
  }, [role, toast]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleDeleteFile = async (taskId, fileId) => {
    try {
      await api.delete(`/tasks/${taskId}/files/${fileId}`);
      setTaskFiles(prev => ({
        ...prev,
        [taskId]: (prev[taskId] || []).filter(f => f.id !== fileId),
      }));
    } catch (err) {
      toast.error('删除失败: ' + (err.response?.data?.detail || err.message));
    }
  };

  const displayProjects = (() => {
    let filtered = projects;
    if (role !== 'admin') {
      filtered = projects.map(p => ({
        ...p,
        tasks: p.tasks.filter(t => t.assignee === user.name)
      })).filter(p => p.tasks.length > 0);
    } else if (filterUser !== 'all') {
      filtered = projects.map(p => ({
        ...p,
        tasks: p.tasks.filter(t => t.assignee === filterUser)
      })).filter(p => p.tasks.length > 0);
    }
    return filtered;
  })();

  const handleToggleDone = async (task) => {
    const isBlocked = getBlockedStatus(task, task._allTasks || []);
    if (isBlocked) return;
    try {
      const newStatus = task.status === 'Done' ? 'Todo' : 'Done';
      // 驳回任务用 update 端点（更可靠），普通任务用 complete 端点
      if (task.status === 'Rejected') {
        await api.put(`/tasks/${task.id}`, { status: newStatus });
      } else {
        await api.put(`/tasks/${task.id}/complete`, { user_id: task.assignee_id || user.id });
      }
      setProjects(prev => prev.map(p => ({
        ...p,
        tasks: p.tasks.map(t => t.id === task.id ? {
          ...t,
          status: newStatus,
          review_status: task.status === 'Rejected' ? 'approved' : (task.status === 'Done' ? 'none' : t.review_status),
          rejection_reason: task.status === 'Rejected' ? null : t.rejection_reason,
        } : t)
      })));
    } catch (err) { toast.error('操作失败: ' + (err.response?.data?.detail || err.message)); }
  };

  const handleBatchStatus = async (newStatus) => {
    try {
      await api.post('/tasks/batch-update', { task_ids: selectedTaskIds, status: newStatus === 'done' ? 'Done' : 'Doing' });
      setProjects(prev => prev.map(p => ({
        ...p,
        tasks: p.tasks.map(t => selectedTaskIds.includes(t.id) ? {
          ...t,
          status: newStatus === 'done' ? 'Done' : 'Doing',
          review_status: t.status === 'Rejected' ? 'approved' : t.review_status,
          rejection_reason: t.status === 'Rejected' ? null : t.rejection_reason,
        } : t)
      })));
      setSelectedTaskIds([]);
    } catch (err) { toast.error('批量操作失败: ' + (err.response?.data?.detail || err.message)); }
  };

  const handleSaveTask = async (edited) => {
    try {
      await api.put(`/tasks/${edited.id}`, {
        title: edited.title,
        assignee: edited.assignee,
        deadline: edited.deadline,
        priority: edited.priority || 'Medium',
        status: edited.status,
        description: edited.description || '',
        dependencies: Array.isArray(edited.dependencies) ? edited.dependencies.join(',') : String(edited.dependencies || ''),
      });
      const cleaned = edited.status !== 'Rejected'
        ? { ...edited, review_status: edited.status === 'Done' ? 'approved' : (edited.review_status || 'none'), rejection_reason: null }
        : edited;
      setProjects(prev => prev.map(p => ({
        ...p,
        tasks: p.tasks.map(t => t.id === edited.id ? cleaned : t)
      })));
      setEditingTask(null);
    } catch (err) { toast.error('保存失败: ' + (err.response?.data?.detail || err.message)); }
  };

  const handleReject = async () => {
    if (!rejectingTask) return;
    try {
      const { data } = await api.post(`/tasks/${rejectingTask.id}/reject`, { reason: rejectReason });
      toast.success(data.message);
      setRejectingTask(null);
      setRejectReason('');
      fetchProjects();
    } catch (err) { toast.error('驳回失败: ' + (err.response?.data?.detail || err.message)); }
  };

  const handleFileUpload = async (taskId, file) => {
    setUploadingTaskId(taskId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post(`/tasks/${taskId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setTaskFiles(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), { filename: file.name, id: Date.now() }] }));
      if (data.message) toast.success(data.message);
      fetchProjects();
    } catch (err) {
      toast.error('上传失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setUploadingTaskId(null);
    }
  };

  const handleCommentAdded = async (taskId) => {
    const { data } = await api.get(`/tasks/${taskId}/comments`);
    setCommentTask(prev => prev ? { ...prev, comments: data.comments } : null);
    setProjects(prev => prev.map(p => ({
      ...p,
      tasks: p.tasks.map(t => t.id === taskId ? { ...t, comments: data.comments } : t)
    })));
  };

  const toggleSelect = (id) => {
    setSelectedTaskIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAll = (e, tasks) => {
    const ids = tasks.map(t => t.id);
    setSelectedTaskIds(prev => e.target.checked ? [...new Set([...prev, ...ids])] : prev.filter(x => !ids.includes(x)));
  };

  if (loading) return <div className="text-center text-slate-400 py-12">加载中...</div>;

  return (
    <div className="flex flex-1 overflow-hidden relative">
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar">
        <header className="mb-8 flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">项目与任务矩阵</h2>
            <p className="text-sm text-slate-500 mt-1">大项目到子任务的精细化管理，包含前置依赖与动态死线督办。</p>
          </div>
          <div className="flex items-center gap-3">
            {role === 'admin' && (
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-600 outline-none">
                  <option value="all">全部人员</option>
                  {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
            )}
            {role === 'admin' && (
              <button onClick={() => setShowNewProject(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition flex items-center">
                <Plus className="w-4 h-4 mr-1.5" /> 新建大项目
              </button>
            )}
          </div>
        </header>

        <BatchToolbar selectedCount={selectedTaskIds.length} onStatusChange={handleBatchStatus} />

        <div className="space-y-8 pb-10">
          {displayProjects.map(project => {
            const allTasks = project.tasks;
            const progress = allTasks.length > 0 ? Math.round(allTasks.filter(t => t.status === 'Done').length / allTasks.length * 100) : 0;
            const tasksWithContext = allTasks.map(t => ({ ...t, _allTasks: allTasks }));
            return (
              <div key={project.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-slate-50/80 border-b border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center border border-indigo-200 text-indigo-600 shadow-sm">
                      <FolderKanban className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">{project.title}</h3>
                      <div className="flex items-center text-xs text-slate-500 mt-1 space-x-4">
                        <span>包含 {allTasks.length} 个子任务</span>
                        <div className="flex items-center w-32">
                          <div className="w-full bg-slate-200 rounded-full h-1.5 mr-2">
                            <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${progress}%` }}></div>
                          </div>
                          <span>{progress}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {role === 'admin' && (
                    <label className="flex items-center space-x-2 text-sm text-slate-600 mt-4 md:mt-0 cursor-pointer">
                      <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                        onChange={(e) => handleSelectAll(e, allTasks)}
                        checked={allTasks.length > 0 && allTasks.every(t => selectedTaskIds.includes(t.id))} />
                      <span>全选本项目任务</span>
                    </label>
                  )}
                </div>

                <div className="divide-y divide-slate-100">
                  {tasksWithContext.map(task => {
                    const isSelected = selectedTaskIds.includes(task.id);
                    const isBlocked = getBlockedStatus(task, allTasks);

                    return (
                      <div key={task.id} className={`p-4 sm:p-5 flex items-start space-x-4 transition-colors ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}>
                        {role === 'admin' && (
                          <div className="pt-1.5">
                            <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                              checked={isSelected} onChange={() => toggleSelect(task.id)} />
                          </div>
                        )}

                        <div className="pt-0.5">
                          <button
                            onClick={() => role === 'admin' ? handleToggleDone(task) : null}
                            disabled={isBlocked || role !== 'admin'}
                            className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                              task.status === 'Done'
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : task.status === 'Rejected' && role === 'admin'
                                  ? 'bg-red-100 border-red-300 text-red-400 hover:bg-emerald-100 hover:border-emerald-400'
                                  : task.status === 'Rejected'
                                    ? 'bg-red-100 border-red-300 text-red-400 cursor-not-allowed'
                                    : isBlocked
                                    ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                    : role !== 'admin'
                                      ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                                      : 'bg-white border-slate-300 hover:border-indigo-500 text-transparent hover:text-indigo-200'
                            }`}
                            title={task.status === 'Rejected' ? '已驳回' : isBlocked ? '前置任务未完成，已被阻塞' : role !== 'admin' ? '需管理员审批' : '点击切换完成状态'}
                          >
                            {isBlocked ? <Lock className="w-3.5 h-3.5" /> : task.status === 'Rejected' ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center space-x-2">
                              {task.status === 'Rejected' ? (
                                <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded font-medium border border-red-200 flex items-center"><XCircle className="w-3 h-3 mr-1" /> 已驳回</span>
                              ) : task.status === 'Done' ? (
                                <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded font-medium border border-emerald-200">已完成</span>
                              ) : isBlocked ? (
                                <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded font-medium border border-orange-200 flex items-center"><Lock className="w-3 h-3 mr-1" /> 被阻塞</span>
                              ) : task.status === 'Doing' ? (
                                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded font-medium border border-blue-200">执行中</span>
                              ) : (
                                <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded font-medium border border-slate-200">待处理</span>
                              )}
                              {task.review_status === 'pending' && task.status !== 'Rejected' && (
                                <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded font-medium border border-yellow-200 flex items-center"><AlertTriangle className="w-3 h-3 mr-1" /> 待审核</span>
                              )}
                              <h4 className={`font-semibold text-base ${task.status === 'Done' ? 'text-slate-500 line-through' : task.status === 'Rejected' ? 'text-red-700' : 'text-slate-800'}`}>{task.title}</h4>
                            </div>
                            <div className="flex items-center space-x-2">
                              {role === 'admin' && (
                                <button onClick={() => setEditingTask({ task, allTasks })}
                                  className="flex items-center space-x-1 text-slate-400 hover:text-indigo-600 transition-colors text-sm bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm">
                                  <Edit className="w-4 h-4" />
                                </button>
                              )}
                              {role === 'admin' && task.status !== 'Done' && task.status !== 'Rejected' && (
                                <button onClick={() => { setRejectingTask(task); setRejectReason(''); }}
                                  className="flex items-center space-x-1 text-slate-400 hover:text-red-600 transition-colors text-sm bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm"
                                  title="驳回任务">
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                              {/* 上传文件按钮 */}
                              <label
                                className={`flex items-center space-x-1 text-sm bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm cursor-pointer transition-colors ${
                                  uploadingTaskId === task.id
                                    ? 'text-indigo-400 animate-pulse'
                                    : 'text-slate-400 hover:text-emerald-600'
                                }`}
                                title="上传工作文件">
                                {uploadingTaskId === task.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Upload className="w-4 h-4" />
                                )}
                                <input type="file" className="hidden"
                                  onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFileUpload(task.id, file);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button onClick={() => setCommentTask(task)}
                                className="flex items-center space-x-1 text-slate-400 hover:text-indigo-600 transition-colors text-sm bg-white border border-slate-200 px-2.5 py-1 rounded-md shadow-sm">
                                <MessageCircle className="w-4 h-4" />
                                <span>{(task.comments || []).length}</span>
                              </button>
                            </div>
                          </div>

                          {/* 驳回信息 */}
                          {task.status === 'Rejected' && task.rejection_reason && (
                            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 text-xs">
                              <p className="text-red-700 flex items-start">
                                <AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0" />
                                <span>
                                  {task.rejected_by_task_id ? (
                                    <>因前置任务被驳回，该任务连带驳回</>
                                  ) : (
                                    <>驳回意见: {task.rejection_reason}</>
                                  )}
                                </span>
                              </p>
                            </div>
                          )}

                          {/* 已上传文件列表 */}
                          {taskFiles[task.id]?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {taskFiles[task.id].map(f => (
                                <span key={f.id} className="inline-flex items-center bg-slate-100 border border-slate-200 rounded-md px-2 py-1 text-[11px] text-slate-600 group hover:border-indigo-300 transition-colors">
                                  <FileText className="w-3 h-3 mr-1 text-slate-400" />
                                  <button
                                    onClick={() => {
                                      const token = localStorage.getItem('token');
                                      window.open(`/api/tasks/${task.id}/files/${f.id}/download?token=${encodeURIComponent(token)}`, '_blank');
                                    }}
                                    className="text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                                    title="点击查看文件"
                                  >
                                    {f.filename}
                                  </button>
                                  <button onClick={() => handleDeleteFile(task.id, f.id)}
                                    className="ml-1.5 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="删除此文件">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-y-2 text-xs text-slate-500 mt-2">
                            <span className="flex items-center mr-4 bg-slate-100 px-2 py-1 rounded-md text-slate-700">
                              <User className="w-3.5 h-3.5 mr-1" /> {task.assignee}
                            </span>
                            {task.source && (
                              <span className="flex items-center mr-4">
                                <FileText className="w-3.5 h-3.5 mr-1 text-slate-400" /> 来源: {task.source}
                              </span>
                            )}
                          </div>

                          {(() => {
                                const depIds = parseDepIds(task.dependencies);
                                if (depIds.length === 0) return null;
                                return (
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-slate-400 font-medium flex items-center">
                                      <Link className="w-3.5 h-3.5 mr-1" />前置任务:
                                    </span>
                                    {depIds.map(depId => {
                                      const dep = allTasks.find(t => t.id === depId);
                                      if (!dep) return null;
                                      const done = dep.status === 'Done';
                                      return (
                                        <div key={depId} className={`text-[11px] px-2 py-1 rounded flex items-center border ${done ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700 font-medium'}`}>
                                          {done ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Loader2 className="w-3 h-3 mr-1 animate-spin-slow" />}
                                          <span className="truncate max-w-[150px]">{dep.title}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                        </div>

                        <div className="hidden sm:flex flex-col items-end flex-shrink-0 ml-4">
                          <span className="text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Deadline</span>
                          <DynamicCountdown targetDateIso={task.deadline} forceDone={task.status === 'Done'} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {commentTask && (
        <CommentDrawer task={commentTask} currentUser={user} onClose={() => setCommentTask(null)} onCommentAdded={handleCommentAdded} />
      )}

      {editingTask && (
        <EditTaskModal task={editingTask.task} allTasks={editingTask.allTasks} onClose={() => setEditingTask(null)} onSave={handleSaveTask} />
      )}

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={fetchProjects} />
      )}

      {/* 驳回弹窗 */}
      {rejectingTask && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setRejectingTask(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-red-50">
              <h3 className="text-lg font-bold text-red-800 flex items-center">
                <XCircle className="w-5 h-5 mr-2" />驳回任务
              </h3>
              <button onClick={() => setRejectingTask(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">驳回「<strong>{rejectingTask.title}</strong>」</p>
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start">
                <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                驳回后将自动级联驳回所有依赖此任务的其他任务。
              </p>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">驳回意见</label>
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder="填写驳回原因..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-600 outline-none resize-none h-24" />
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 bg-slate-50 flex justify-end space-x-3">
              <button onClick={() => setRejectingTask(null)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition">取消</button>
              <button onClick={handleReject}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition shadow-sm">确认驳回</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
