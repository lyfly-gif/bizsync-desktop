import { useRef } from 'react';
import { Send, Paperclip, Mic, FileAudio, Square } from 'lucide-react';

export default function ChatInput({
  inputValue, setInputValue, isTyping,
  isRecording, isRecordingUpload,
  onSend, onFileSelect, onMicClick, onRecordUpload,
}) {
  const fileInputRef = useRef(null);

  return (
    <div className="p-4 bg-white border-t border-slate-200 flex-shrink-0">
      <div className="max-w-4xl mx-auto relative rounded-2xl shadow-sm border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-indigo-600 transition-all">
        <textarea
          rows={1}
          className="w-full pl-4 pr-32 py-4 bg-transparent outline-none resize-none text-slate-800 placeholder-slate-400"
          placeholder="上传新项目文档，或描述需求..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          style={{ minHeight: '60px' }}
        />
        <div className="absolute right-2 bottom-2.5 flex space-x-1">
          <input type="file" ref={fileInputRef} className="hidden" onChange={onFileSelect} accept=".txt,.docx,.pdf,.jpg,.jpeg,.png,.bmp,.mp3,.wav,.m4a,.flac,.ogg,.webm,.mp4,.caf" />
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-indigo-600 bg-slate-50 rounded-lg" title="上传文件"><Paperclip className="w-5 h-5" /></button>
          <button onClick={onMicClick} disabled={isRecordingUpload} className={`p-2 rounded-lg ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-indigo-600 bg-slate-50'} ${isRecordingUpload ? 'opacity-30 cursor-not-allowed' : ''}`} title={isRecording ? '停止录音' : '语音命令（转文字后追加到输入框）'}>{isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
          <button onClick={onRecordUpload} disabled={isRecording} className={`p-2 rounded-lg ${isRecordingUpload ? 'bg-amber-500 text-white animate-pulse' : 'text-slate-400 hover:text-amber-600 bg-slate-50'} ${isRecording ? 'opacity-30 cursor-not-allowed' : ''}`} title={isRecordingUpload ? '停止录音' : '录音转文件（转文字后生成 txt 由 AI 解析）'}>{isRecordingUpload ? <Square className="w-5 h-5" /> : <FileAudio className="w-5 h-5" />}</button>
          <button onClick={onSend} disabled={!inputValue.trim() || isTyping} className={`p-2 ml-1 rounded-lg ${inputValue.trim() && !isTyping ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}><Send className="w-5 h-5" /></button>
        </div>
      </div>
    </div>
  );
}
