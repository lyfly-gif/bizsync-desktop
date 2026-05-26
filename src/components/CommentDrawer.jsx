import { useState } from 'react';
import { X, MessageCircle, Send } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

export default function CommentDrawer({ task, currentUser, onClose, onCommentAdded }) {
  const toast = useToast();
  const [text, setText] = useState('');

  const handleAdd = async () => {
    if (!text.trim()) return;
    try {
      await api.post(`/tasks/${task.id}/comments`, { user_id: currentUser.id, content: text });
      onCommentAdded(task.id);
      setText('');
    } catch (err) {
      toast.error('评论失败: ' + (err.response?.data?.detail || err.message));
    }
  };

  const comments = task.comments || [];

  return (
    <div className="w-80 border-l border-slate-200 bg-white flex flex-col shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.05)] z-20 absolute right-0 top-0 bottom-0">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center">
          <MessageCircle className="w-4 h-4 mr-2 text-indigo-500" />任务讨论 ({comments.length})
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 bg-white p-1 rounded-md shadow-sm border border-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 border-b border-slate-100 bg-white">
        <p className="text-sm font-medium text-slate-800 line-clamp-2">{task.title}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {comments.length === 0 ? (
          <div className="text-center text-slate-400 text-sm mt-10">暂无讨论记录</div>
        ) : (
          comments.map(c => (
            <div key={c.id} className={`flex flex-col ${c.user_name === currentUser.name ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] text-slate-400 mb-1">{c.user_name} · {c.created_at?.slice(0, 16)}</span>
              <div className={`px-3 py-2 rounded-xl text-sm max-w-[90%] shadow-sm ${c.user_name === currentUser.name ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'}`}>
                {c.content}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex items-center space-x-2">
          <input type="text" placeholder="输入评论..." value={text}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-slate-50"
            onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          <button onClick={handleAdd} className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition flex-shrink-0 shadow-sm">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
