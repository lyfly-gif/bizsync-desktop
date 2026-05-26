import { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((message, type) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const error = useCallback((msg) => add(msg, 'error'), [add]);
  const success = useCallback((msg) => add(msg, 'success'), [add]);
  const info = useCallback((msg) => add(msg, 'info'), [add]);

  const icon = (type) => {
    if (type === 'error') return <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" />;
    if (type === 'success') return <CheckCircle className="w-4 h-4 flex-shrink-0 text-emerald-500" />;
    return <Info className="w-4 h-4 flex-shrink-0 text-blue-500" />;
  };

  const style = (type) => {
    if (type === 'error') return 'bg-red-50 border-red-200 text-red-800';
    if (type === 'success') return 'bg-emerald-50 border-emerald-200 text-emerald-800';
    return 'bg-blue-50 border-blue-200 text-blue-800';
  };

  return (
    <ToastContext.Provider value={{ error, success, info }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto animate-toast-in flex items-center gap-2 px-4 py-3 rounded-lg border shadow-lg text-sm font-medium ${style(t.type)}`}>
            {icon(t.type)}
            <span className="flex-1 break-words">{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="flex-shrink-0 opacity-40 hover:opacity-100 transition">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
