import { CheckSquare, Trash2 } from 'lucide-react';

export default function BatchToolbar({ selectedCount, onStatusChange }) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 mb-6 bg-white border border-indigo-200 shadow-lg rounded-xl p-3 flex justify-between items-center">
      <div className="flex items-center space-x-2 text-sm font-medium text-indigo-700 pl-2">
        <CheckSquare className="w-5 h-5 text-indigo-600" />
        <span>已选择 {selectedCount} 项任务</span>
      </div>
      <div className="flex space-x-2">
        <button onClick={() => onStatusChange('done')} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg text-sm font-medium transition">
          批量设为完成
        </button>
        <button onClick={() => onStatusChange('doing')} className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg text-sm font-medium transition">
          批量设为执行中
        </button>
      </div>
    </div>
  );
}
