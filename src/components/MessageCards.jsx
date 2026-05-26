import { useState } from 'react';
import { MessageSquare, ArrowRight } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

export default function MessageCards({ msg, onSwitch, setMessages }) {
  const toast = useToast();

  if (msg.pending_comment && msg.tasks) {
    return (
      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
        <h4 className="font-bold text-slate-800 mb-2 flex items-center">
          <MessageSquare className="w-4 h-4 mr-2 text-amber-600" />
          {msg.project_title || '选择任务'}
        </h4>
        <p className="text-xs text-slate-500 mb-3">评论内容："{msg.pending_comment}"</p>
        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
          {msg.tasks.map((t, i) => (
            <div key={t.id || i} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
              <div className="text-xs">
                <span className="font-medium text-slate-800">{t.title || ''}</span>
                <span className="text-slate-400 ml-2">[{t.project_title || ''}]</span>
              </div>
              <button
                onClick={async () => {
                  try {
                    await api.post('/chat/confirm-comment', { task_id: t.id, comment: msg.pending_comment });
                    setMessages(prev => prev.map(m => m.id !== msg.id ? m : { ...m, pending_comment: undefined, _comment_done: true, _comment_task: t.title }));
                  } catch (err) {
                    toast.error('评论失败: ' + (err.response?.data?.detail || err.message));
                  }
                }}
                className="text-xs bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600 transition"
              >
                选这个
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (msg._comment_done) {
    return (
      <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
        <p className="text-emerald-700 font-medium text-sm">已给「{msg._comment_task}」添加评论</p>
      </div>
    );
  }

  if (msg._saved) {
    return (
      <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
        <p className="text-emerald-700 font-medium text-sm">修改已保存</p>
      </div>
    );
  }

  if (msg.hasTaskCard && !msg.taskCard) {
    return (
      <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm text-center">
        <p className="text-slate-600 mb-3 font-medium">任务提取已完成，点击下方按钮跳转至项目矩阵进行指派与修改。</p>
        <button onClick={onSwitch} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition shadow-sm text-sm flex items-center justify-center w-full">
          进入项目矩阵面板 <ArrowRight className="w-4 h-4 ml-1.5" />
        </button>
      </div>
    );
  }

  return null;
}
