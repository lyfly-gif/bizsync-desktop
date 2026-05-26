import { useState, useEffect, useRef } from 'react';
import { User, Bot, Loader2, FolderKanban, ArrowRight, Settings, AlertTriangle } from 'lucide-react';
import BizSyncLogo from './BizSyncLogo';
import api from '../api/client';
import { useToast } from './Toast';
import ChatInput from './ChatInput';
import { UploadTaskCard, QueryTaskCard } from './TaskCard';
import MessageCards from './MessageCards';

let _wsIdCounter = 0;

export default function ChatInterface({ onSwitch, onGoSettings }) {
  const toast = useToast();
  const [messages, setMessages] = useState([
    {
      id: 1, role: 'assistant',
      content: '您好！基于最新的大项目需求，您可以上传文档（📎），我将自动提取核心指标并为您建立项目层级结构，随后分配子任务。',
      timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingUpload, setIsRecordingUpload] = useState(false);
  const recordModeRef = useRef('command');
  const [users, setUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [expandedDeps, setExpandedDeps] = useState({});
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const wsRef = useRef(null);
  const clientIdRef = useRef('');
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const loadUsers = async () => {
    if (usersLoaded) return;
    try { const { data } = await api.get('/users'); setUsers(data.users || []); setUsersLoaded(true); } catch {}
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping, uploading]);

  // 检查 LLM 是否已配置
  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      setLlmConfigured(data.configured);
    }).catch(() => {}).finally(() => setCheckingConfig(false));
  }, []);

  // 挂载时从服务端加载对话历史 并 预加载用户列表
  useEffect(() => {
    loadUsers();
    (async () => {
      try {
        const { data } = await api.get('/conversations');
        if (data.messages && data.messages.length > 0) {
          setMessages(prev => {
            const historyMsgs = data.messages.map((m, i) => ({
              id: Date.now() - data.messages.length + i,
              role: m.role,
              content: m.content,
              timestamp: '',
            }));
            // 保留默认欢迎消息（如果无历史）或用历史替换
            return [...historyMsgs, ...prev.filter(m => m.role === 'assistant' && m.tasks)];
          });
        }
      } catch {}
    })();
  }, []);

  const connectWS = () => {
    const cid = `client_${Date.now()}_${++_wsIdCounter}`;
    clientIdRef.current = cid;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/files/ws/upload/${cid}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        setUploadPhase(data.message);
      } else if (data.type === 'result') {
        setUploading(false);
        setUploadPhase('');
        loadUsers(); // 预加载用户列表，确保任务卡片中责任人下拉能立即显示
        const taskCard = {
          projectTitle: data.project_title || '未命名项目',
          tasks: (data.tasks || []).map((t, i) => ({ ...t, _localId: `new_${i}` })),
        };
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: 'assistant',
          content: data.message || `解析完成，共提取 ${data.tasks?.length || 0} 个任务`,
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
          taskCard,
        }]);
      } else if (data.type === 'error') {
        setUploading(false);
        setUploadPhase('');
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: 'assistant',
          content: `错误: ${data.message}`,
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
      }
    };

    ws.onerror = () => {
      setUploading(false);
      setUploadPhase('');
    };

    return ws;
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    setUploadPhase(`正在读取 ${file.name} ...`);

    const ws = connectWS();

    ws.onopen = async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('client_id', clientIdRef.current);
      try {
        await api.post('/files/upload', form);
      } catch (err) {
        setUploading(false);
        setUploadPhase('');
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: 'assistant',
          content: `上传失败: ${err.response?.data?.detail || err.message}`,
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
        ws.close();
      }
    };
  };

  // 上传文本为 .txt 文件（通过 WebSocket 管道 → AI 解析任务）
  const uploadTextAsFile = (text) => {
    const dateStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
    const blob = new Blob([text], { type: 'text/plain' });
    const file = new File([blob], `语音转录_${dateStr}.txt`, { type: 'text/plain' });

    setUploading(true);
    setUploadPhase('语音转写完成，AI 正在分析任务结构...');

    const ws = connectWS();
    ws.onopen = async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('client_id', clientIdRef.current);
      try {
        await api.post('/files/upload', form);
      } catch (err) {
        setUploading(false);
        setUploadPhase('');
        setMessages(prev => [...prev, {
          id: Date.now(), role: 'assistant',
          content: `上传失败: ${err.response?.data?.detail || err.message}`,
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
        ws.close();
      }
    };
  };

  // 共享录音启动逻辑
  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (audioChunksRef.current.length === 0) {
        setIsRecording(false);
        setIsRecordingUpload(false);
        return;
      }
      const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
      const ext = mimeType && mimeType.includes('mp4') ? 'mp4' : mimeType && mimeType.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', blob, `recording.${ext}`);

      const mode = recordModeRef.current;
      setIsTyping(true);
      try {
        const { data } = await api.post('/asr/transcribe', form);
        if (data.status === 'ok' && data.text) {
          if (mode === 'command') {
            setInputValue((prev) => prev + data.text);
          } else {
            uploadTextAsFile(data.text);
          }
        } else if (data.status === 'error') {
          setMessages((prev) => [...prev, {
            id: Date.now(), role: 'assistant',
            content: `语音转写失败: ${data.message || '未知错误'}`,
            timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
          }]);
        }
      } catch (err) {
        setMessages((prev) => [...prev, {
          id: Date.now(), role: 'assistant',
          content: `语音转写请求失败: ${err.response?.data?.detail || err.message}`,
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
      } finally {
        setIsTyping(false);
        setIsRecording(false);
        setIsRecordingUpload(false);
      }
    };

    recorder.start(250);
  };

  const handleMicClick = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (isRecordingUpload) return;
    recordModeRef.current = 'command';
    try {
      await startRecording();
      setIsRecording(true);
    } catch {
      setMessages((prev) => [...prev, {
        id: Date.now(), role: 'assistant',
        content: '麦克风权限未授权，请在浏览器设置中允许访问麦克风。',
        timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      }]);
    }
  };

  const handleRecordUploadClick = async () => {
    if (isRecordingUpload) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (isRecording) return;
    recordModeRef.current = 'upload';
    try {
      await startRecording();
      setIsRecordingUpload(true);
    } catch {
      setMessages((prev) => [...prev, {
        id: Date.now(), role: 'assistant',
        content: '麦克风权限未授权，请在浏览器设置中允许访问麦克风。',
        timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      }]);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    const userMsg = {
      id: Date.now(), role: 'user', content: inputValue,
      timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const { data } = await api.post('/chat', { message: userMsg.content, history });
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant',
        content: data.reply,
        tasks: data.tasks || undefined,
        project_title: data.project_title || undefined,
        pending_comment: data.pending_comment || undefined,
        intent: data.intent || undefined,
        timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      }]);
    } catch (err) {
      setIsTyping(false);
      const errMsg = err.response?.data?.message || '';
      const errReply = err.response?.data?.reply || '';
      if (!llmConfigured || errMsg === 'api_key_missing') {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: 'assistant',
          content: '⚠️ 尚未配置大模型 API Key，请在「大模型 API 设置」页面填入 DeepSeek 或 OpenAI 兼容 API Key。',
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
      } else if (errMsg === 'api_key_invalid' || errReply.includes('API Key')) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: 'assistant',
          content: errReply || 'API Key 无效，请检查设置页面中的密钥是否正确。',
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
      } else if (errMsg === 'quota_exhausted' || errReply.includes('额度') || errReply.includes('余额')) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: 'assistant',
          content: errReply || 'API 额度已用完或余额不足，请前往对应平台充值，或在设置中更换 Key。',
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: 'assistant',
          content: '抱歉，服务暂时不可用，请稍后重试。',
          timestamp: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        }]);
      }
    }
  };

  const handleDispatch = async (msg) => {
    const { projectTitle, tasks } = msg.taskCard;
    try {
      const payload = {
        project_title: projectTitle,
        tasks: tasks.map(({ _localId, ...t }) => ({
          ...t,
          dependencies_indices: t.dependencies_indices || [],
          dependencies: Array.isArray(t.dependencies) ? t.dependencies.join(',') : (t.dependencies || ''),
        })),
        creator_id: JSON.parse(localStorage.getItem('user') || '{}').id,
      };
      await api.post('/files/dispatch', payload);
      setMessages(prev => prev.map(m => {
        if (m.id === msg.id) return { ...m, taskCard: { ...m.taskCard, dispatched: true } };
        return m;
      }));
      setTimeout(() => onSwitch(), 800);
    } catch (err) {
      toast.error('下发失败: ' + (err.response?.data?.detail || err.message));
    }
  };

  const updateTaskCardTask = (msgId, localId, field, value) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.taskCard) return m;
      return {
        ...m,
        taskCard: {
          ...m.taskCard,
          tasks: m.taskCard.tasks.map(t => t._localId === localId ? { ...t, [field]: value } : t),
        },
      };
    }));
  };

  const toggleTaskDep = (msgId, localId, depIdx) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.taskCard) return m;
      return {
        ...m,
        taskCard: {
          ...m.taskCard,
          tasks: m.taskCard.tasks.map(t => {
            if (t._localId !== localId) return t;
            const deps = t.dependencies_indices || [];
            const updated = deps.includes(depIdx) ? deps.filter(d => d !== depIdx) : [...deps, depIdx];
            return { ...t, dependencies_indices: updated };
          }),
        },
      };
    }));
  };

  const toggleDepExpanded = (localId) => {
    setExpandedDeps(prev => ({ ...prev, [localId]: !prev[localId] }));
  };

  const updateChatQueryTask = (msgId, idx, field, value) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.tasks) return m;
      const updated = [...m.tasks];
      updated[idx] = { ...updated[idx], [field]: value, _dirty: true };
      return { ...m, tasks: updated };
    }));
  };

  const handleSaveChatTasks = async (msg) => {
    try {
      const updates = msg.tasks.filter(t => t.id && t._dirty);
      for (const t of updates) {
        await api.put(`/tasks/${t.id}`, {
          title: t.title,
          assignee: t.assignee,
          deadline: t.deadline,
          priority: t.priority,
          status: t.status,
        });
      }
      setMessages(prev => prev.map(m => {
        if (m.id !== msg.id) return m;
        return { ...m, tasks: m.tasks.map(t => ({ ...t, _dirty: false })), _saved: true };
      }));
    } catch (err) {
      toast.error('保存失败: ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <>
      <header className="h-16 border-b border-slate-200 flex items-center justify-between px-6 bg-white shadow-sm z-10 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Bot className="w-6 h-6 text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-800">AI 分析助理</h2>
        </div>
        <button onClick={onSwitch} className="flex items-center space-x-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-1.5 px-3 rounded-lg transition-colors font-medium border border-indigo-200">
          <FolderKanban className="w-4 h-4" /><span>前往项目矩阵</span>
        </button>
      </header>

      {!checkingConfig && !llmConfigured && (
        <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">尚未配置大模型 API</p>
              <p className="text-xs text-amber-600 mt-0.5">请先前往设置页填入 DeepSeek 或 OpenAI 兼容 API Key，否则无法使用 AI 对话功能。</p>
            </div>
          </div>
          <button
            onClick={onGoSettings}
            className="flex items-center space-x-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white py-2 px-4 rounded-lg transition-colors font-medium flex-shrink-0 ml-4"
          >
            <Settings className="w-4 h-4" />
            <span>前往设置</span>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 custom-scrollbar">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex-shrink-0 ${msg.role === 'user' ? 'ml-3' : 'mr-3'}`}>
                {msg.role === 'assistant'
                  ? <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200 shadow-sm"><BizSyncLogo className="w-5 h-5" /></div>
                  : <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center shadow-sm text-white"><User className="w-5 h-5" /></div>
                }
              </div>
              <div className="flex flex-col">
                <div className={`flex items-baseline ${msg.role === 'user' ? 'justify-end mr-1' : 'ml-1'} mb-1`}>
                  <span className="text-[11px] text-slate-400 font-mono">{msg.timestamp}</span>
                </div>
                <div className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`}>
                  {msg.content}

                  {msg.taskCard && !msg.taskCard.dispatched && (
                    <UploadTaskCard
                      msg={msg}
                      users={users}
                      loadUsers={loadUsers}
                      expandedDeps={expandedDeps}
                      onUpdate={updateTaskCardTask}
                      onToggleDep={toggleTaskDep}
                      onToggleExpanded={toggleDepExpanded}
                      onDispatch={handleDispatch}
                    />
                  )}

                  {msg.taskCard?.dispatched && (
                    <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                      <p className="text-emerald-700 font-medium text-sm">任务已成功下发至项目矩阵</p>
                    </div>
                  )}

                  {msg.tasks && !msg.taskCard && !msg._saved && (
                    <QueryTaskCard
                      msg={msg}
                      users={users}
                      loadUsers={loadUsers}
                      onUpdate={updateChatQueryTask}
                      onSave={handleSaveChatTasks}
                    />
                  )}

                  <MessageCards msg={msg} onSwitch={onSwitch} setMessages={setMessages} />
                </div>
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100 animate-pulse"><BizSyncLogo className="w-5 h-5" /></div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center"><Loader2 className="w-4 h-4 text-indigo-500 animate-spin mr-2" /><span className="text-sm font-medium text-slate-600">AI 思考中...</span></div>
          </div>
        )}

        {uploading && (
          <div className="flex justify-start items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center border border-indigo-100"><Loader2 className="w-5 h-5 text-indigo-400" /></div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center">
              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin mr-2" />
              <span className="text-sm font-medium text-slate-600">{uploadPhase || '处理中...'}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        inputValue={inputValue}
        setInputValue={setInputValue}
        isTyping={isTyping}
        isRecording={isRecording}
        isRecordingUpload={isRecordingUpload}
        onSend={handleSendMessage}
        onFileSelect={handleFileSelect}
        onMicClick={handleMicClick}
        onRecordUpload={handleRecordUploadClick}
      />
    </>
  );
}
