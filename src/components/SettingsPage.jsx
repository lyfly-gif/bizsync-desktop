import { useState, useEffect } from 'react';
import { Settings, Key, Globe, Cpu, Save, CheckCircle2, Loader2, AlertTriangle, Trash2, Eye, EyeOff } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('bizsync_api_key') || '');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [modelName, setModelName] = useState('deepseek-chat');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [fromDefault, setFromDefault] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyModified, setKeyModified] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/settings')
      .then(({ data }) => {
        setBaseUrl(data.base_url || 'https://api.deepseek.com/v1');
        setModelName(data.model_name || 'deepseek-chat');
        const key = data.api_key || '';
        setApiKey(key);
        localStorage.setItem('bizsync_api_key', key);
        setConfigured(data.configured);
        setFromDefault(data.from_default || false);
        setLoading(false);
      })
      .catch((err) => {
        console.error('加载设置失败:', err);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { base_url: baseUrl, model_name: modelName };
      if (keyModified) {
        payload.api_key = apiKey;
      }
      const { data } = await api.post('/settings', payload);
      setConfigured(data.configured);
      setFromDefault(data.from_default || false);
      setKeyModified(false);
      setSaved(true);
      localStorage.setItem('bizsync_api_key', apiKey);
      toast.success(apiKey.trim() ? '设置已保存，即刻生效' : 'API Key 已停用');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(err.response?.data?.detail || '保存失败，请确认您有管理员权限');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/settings', { api_key: '', base_url: baseUrl, model_name: modelName });
      setApiKey('');
      localStorage.removeItem('bizsync_api_key');
      setConfigured(data.configured);
      setFromDefault(data.from_default || false);
      setKeyModified(false);
      toast.success('API Key 已停用');
    } catch (err) {
      toast.error(err.response?.data?.detail || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-slate-50 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-8">
        <div className="flex items-center space-x-3 mb-8">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Settings className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">大模型 API 设置</h2>
            <p className="text-sm text-slate-500 mt-1">配置 AI 对话所需的大模型接口，支持 DeepSeek / OpenAI 兼容 API</p>
          </div>
        </div>

        {/* 配置状态提示 */}
        <div className={`mb-6 p-4 rounded-xl flex items-center justify-between ${
          fromDefault ? 'bg-emerald-50 border border-emerald-200'
            : configured ? 'bg-emerald-50 border border-emerald-200'
            : 'bg-amber-50 border border-amber-200'
        }`}>
          <div className="flex items-center space-x-3">
            {(configured || fromDefault) ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            )}
            <div>
              <p className={`text-sm font-medium ${(configured || fromDefault) ? 'text-emerald-800' : 'text-amber-800'}`}>
                {fromDefault
                  ? 'API 已就绪（使用内置默认密钥）'
                  : configured
                  ? 'API 已配置'
                  : 'API 尚未配置'}
              </p>
              <p className={`text-xs mt-0.5 ${(configured || fromDefault) ? 'text-emerald-600' : 'text-amber-600'}`}>
                {fromDefault
                  ? '当前使用内置默认密钥，AI 对话功能可正常使用。如需自己的 Key，请在下方填入。'
                  : configured
                  ? '您的 API Key 已生效，AI 对话功能可正常使用。'
                  : '请在下方填入 DeepSeek 或 OpenAI 兼容 API Key，保存后即可使用 AI 对话功能。'}
              </p>
            </div>
          </div>
          {configured && !fromDefault && (
            <button
              onClick={handleClearKey}
              disabled={saving}
              className="flex items-center space-x-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 py-1.5 px-3 rounded-lg transition-colors border border-red-200"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>停用密钥</span>
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Key className="w-4 h-4 inline mr-1.5 text-slate-400" />
              API Key
              {(configured || fromDefault) && !keyModified && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="w-3 h-3 mr-1" />{fromDefault ? '默认密钥' : '已配置'}
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                className="w-full px-3 py-2.5 pr-20 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono"
                placeholder={fromDefault ? '输入新 Key 替换默认密钥' : configured ? '密钥已配置（输入新 Key 可替换）' : 'sk-xxxxxxxxxxxxxxxx'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setKeyModified(true); }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 rounded"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              在{' '}
              <a className="text-indigo-600 underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
                platform.deepseek.com
              </a>
              {' '}获取（OpenAI 等其他兼容 API 亦可）
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Globe className="w-4 h-4 inline mr-1.5 text-slate-400" />
              API 地址
            </label>
            <input
              type="text"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
              placeholder="https://api.deepseek.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Cpu className="w-4 h-4 inline mr-1.5 text-slate-400" />
              模型名称
            </label>
            <input
              type="text"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
              placeholder="deepseek-chat"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white py-2.5 rounded-lg font-medium transition-colors text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{saving ? '保存中...' : saved ? '已保存' : '保存设置'}</span>
          </button>
        </div>

        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">隐私说明</p>
            <p>API Key 仅存储在你本机的 <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs">~/.bizsync/config.json</code> 文件中，不会上传到任何服务器。AI 对话请求直接发往你配置的 API 地址。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
