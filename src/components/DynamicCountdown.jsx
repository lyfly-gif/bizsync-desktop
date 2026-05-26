import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function DynamicCountdown({ targetDateIso, forceDone = false }) {
  const [timeLeft, setTimeLeft] = useState('');
  const [status, setStatus] = useState('normal');
  const requestRef = useRef();

  const calculateTime = useCallback(() => {
    if (forceDone) {
      setTimeLeft("已完成");
      setStatus('normal');
      return;
    }
    const total = Date.parse(targetDateIso) - Date.parse(new Date());
    if (total <= 0) {
      setTimeLeft("已逾期");
      setStatus('danger');
      return;
    }
    const days = Math.floor(total / (1000 * 60 * 60 * 24));
    const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((total / 1000 / 60) % 60);
    const seconds = Math.floor((total / 1000) % 60);

    let formatStr = '';
    if (days > 0) formatStr += `${days}天 `;
    formatStr += `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    setTimeLeft(formatStr);

    if (days === 0 && hours < 24 && hours >= 4) setStatus('warning');
    else if (days === 0 && hours < 4) setStatus('danger');
    else setStatus('normal');
  }, [targetDateIso, forceDone]);

  useEffect(() => {
    const updateTimer = () => {
      calculateTime();
      requestRef.current = requestAnimationFrame(updateTimer);
    };
    requestRef.current = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(requestRef.current);
  }, [calculateTime]);

  if (forceDone) {
    return (
      <div className="flex items-center px-2 py-1 rounded-md text-[11px] font-mono border bg-slate-50 text-slate-400 border-slate-200">
        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 已交付
      </div>
    );
  }

  const styles = {
    normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]',
    danger: 'bg-red-50 text-red-600 border-red-400 animate-pulse font-bold shadow-[0_0_15px_rgba(239,68,68,0.4)]'
  };

  const icons = {
    normal: <Clock className="w-3.5 h-3.5 mr-1" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 mr-1" />,
    danger: <AlertTriangle className="w-3.5 h-3.5 mr-1 text-red-600" />
  };

  return (
    <div className={`flex items-center px-2 py-1 rounded-md text-[11px] font-mono border transition-all duration-300 ${styles[status]}`}>
      {icons[status]}<span>{timeLeft}</span>
    </div>
  );
}
