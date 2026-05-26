import { Link, CheckSquare, ArrowRight } from 'lucide-react';

export function UploadTaskCard({ msg, users, loadUsers, expandedDeps, onUpdate, onToggleDep, onToggleExpanded, onDispatch }) {
  return (
    <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
      <h4 className="font-bold text-slate-800 mb-3 flex items-center">
        <CheckSquare className="w-4 h-4 mr-2 text-indigo-600" />
        {msg.taskCard.projectTitle}
      </h4>
      <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
        {msg.taskCard.tasks.map((t) => {
          const deps = t.dependencies_indices || [];
          const showDeps = expandedDeps[t._localId];
          const otherTasks = msg.taskCard.tasks.filter(ot => ot._localId !== t._localId);
          return (
          <div key={t._localId} className="bg-white border border-slate-200 rounded-lg p-3 text-xs">
            <div className="grid grid-cols-12 gap-2 items-center">
              <input
                className="col-span-4 border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none"
                value={t.title || ''}
                onChange={e => onUpdate(msg.id, t._localId, 'title', e.target.value)}
                placeholder="任务名"
              />
              <select
                className="col-span-2 border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white text-xs"
                value={t.assignee || ''}
                onChange={e => onUpdate(msg.id, t._localId, 'assignee', e.target.value)}
                onFocus={loadUsers}
              >
                <option value="">未分配</option>
                {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
              <input
                type="datetime-local"
                className="col-span-2 border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none text-[11px]"
                value={String(t.deadline || '').replace(' ', 'T').substring(0, 16)}
                onChange={e => onUpdate(msg.id, t._localId, 'deadline', e.target.value ? e.target.value.replace('T', ' ') + ':00' : '')}
              />
              <select
                className="col-span-2 border border-slate-300 rounded px-1 py-1.5 text-[11px] focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                value={t.priority || 'Medium'}
                onChange={e => onUpdate(msg.id, t._localId, 'priority', e.target.value)}
              >
                <option value="Low">低</option>
                <option value="Medium">中</option>
                <option value="High">高</option>
                <option value="Urgent">紧急</option>
              </select>
              <button
                onClick={() => onToggleExpanded(t._localId)}
                className={`col-span-2 flex items-center justify-center gap-1 border rounded px-1 py-1.5 text-[11px] transition ${
                  deps.length > 0
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-indigo-600'
                }`}
                title="前置依赖"
              >
                <Link className="w-3 h-3" />
                {deps.length > 0 && <span>{deps.length}</span>}
              </button>
            </div>

            {showDeps && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <p className="text-[11px] text-slate-400 mb-1.5">选择前置依赖（可多选）:</p>
                <div className="flex flex-wrap gap-1">
                  {otherTasks.map((ot) => {
                    const otIdx = msg.taskCard.tasks.findIndex(tt => tt._localId === ot._localId);
                    const selected = deps.includes(otIdx);
                    return (
                      <button key={ot._localId}
                        onClick={() => onToggleDep(msg.id, t._localId, otIdx)}
                        className={`text-[11px] px-2 py-1 rounded border transition-all truncate max-w-[200px] ${
                          selected
                            ? 'bg-indigo-100 border-indigo-400 text-indigo-700 font-medium'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}>
                        {ot.title || '未命名任务'}
                      </button>
                    );
                  })}
                  {otherTasks.length === 0 && (
                    <span className="text-[11px] text-slate-400">无其他任务可选</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )})}
      </div>
      <button
        onClick={() => onDispatch(msg)}
        className="w-full bg-indigo-600 text-white px-4 py-2.5 rounded-lg hover:bg-indigo-700 transition shadow-sm text-sm font-medium flex items-center justify-center"
      >
        确认并下发任务 <ArrowRight className="w-4 h-4 ml-1.5" />
      </button>
    </div>
  );
}

export function QueryTaskCard({ msg, users, loadUsers, onUpdate, onSave }) {
  const groups = {};
  msg.tasks.forEach((t, i) => {
    const proj = t.project_title || '未归类任务';
    if (!groups[proj]) groups[proj] = [];
    groups[proj].push({ ...t, _idx: i });
  });

  return (
    <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm">
      <h4 className="font-bold text-slate-800 mb-3 flex items-center">
        <CheckSquare className="w-4 h-4 mr-2 text-indigo-600" />
        {msg.project_title || '查询结果'}（{msg.tasks.length} 个任务 / {Object.keys(groups).length} 个项目）
      </h4>
      <div className="space-y-4 mb-4 max-h-96 overflow-y-auto">
        {Object.entries(groups).map(([projName, projTasks]) => (
          <div key={projName}>
            <div className="flex items-center mb-2">
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5">
                {projName}
              </span>
              <span className="text-xs text-slate-400 ml-2">{projTasks.length} 个子任务</span>
            </div>
            <div className="space-y-2">
              {projTasks.map((t) => (
                <div key={t.id || t._idx} className="bg-white border border-slate-200 rounded-lg p-3 text-xs">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <input
                      className="col-span-4 border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none"
                      value={t.title || ''}
                      onChange={e => onUpdate(msg.id, t._idx, 'title', e.target.value)}
                      placeholder="任务名"
                    />
                    <select
                      className="col-span-2 border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none bg-white text-xs"
                      value={t.assignee || ''}
                      onChange={e => onUpdate(msg.id, t._idx, 'assignee', e.target.value)}
                      onFocus={loadUsers}
                    >
                      <option value="">未分配</option>
                      {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                    </select>
                    <input
                      type="datetime-local"
                      className="col-span-2 border border-slate-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none text-[11px]"
                      value={String(t.deadline || '').replace(' ', 'T').substring(0, 16)}
                      onChange={e => onUpdate(msg.id, t._idx, 'deadline', e.target.value ? e.target.value.replace('T', ' ') + ':00' : '')}
                    />
                    <select
                      className="col-span-2 border border-slate-300 rounded px-1 py-1.5 text-[11px] focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                      value={t.priority || 'Medium'}
                      onChange={e => onUpdate(msg.id, t._idx, 'priority', e.target.value)}
                    >
                      <option value="Low">低</option>
                      <option value="Medium">中</option>
                      <option value="High">高</option>
                      <option value="Urgent">紧急</option>
                    </select>
                    <select
                      className="col-span-2 border border-slate-300 rounded px-1 py-1.5 text-[11px] focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                      value={t.status || 'Todo'}
                      onChange={e => onUpdate(msg.id, t._idx, 'status', e.target.value)}
                    >
                      <option value="Todo">待办</option>
                      <option value="Doing">进行中</option>
                      <option value="Done">已完成</option>
                      <option value="Blocked">阻塞</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => onSave(msg)}
        className="w-full bg-indigo-600 text-white px-4 py-2.5 rounded-lg hover:bg-indigo-700 transition shadow-sm text-sm font-medium flex items-center justify-center"
      >
        保存修改 <ArrowRight className="w-4 h-4 ml-1.5" />
      </button>
    </div>
  );
}
