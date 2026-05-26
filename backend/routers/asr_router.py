import os, sys, tempfile, subprocess, threading

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import APIRouter, UploadFile, File, Depends
from backend.auth_jwt import get_current_user

router = APIRouter(prefix="/api/asr", tags=["语音转写"])

_asr_model = None
_asr_lock = threading.Lock()


def _load_asr_model():
    global _asr_model
    if _asr_model is not None:
        return _asr_model
    with _asr_lock:
        if _asr_model is not None:
            return _asr_model
        from funasr import AutoModel

        model_dir = os.path.join(os.path.dirname(__file__), "..", "..", "AI_Helper", "models", "SenseVoiceSmall")
        model_dir = os.path.abspath(model_dir)
        _asr_model = AutoModel(model=model_dir, device="cpu", disable_pbar=True)
    return _asr_model


FFMPEG_BIN = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "bin", "ffmpeg"))


def transcribe_audio(file_bytes: bytes, filename: str) -> str:
    """转写音频文件为文本（使用本地 SenseVoice 模型）"""
    suffix = os.path.splitext(filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    wav_path = tmp_path + ".wav"
    try:
        # 优先 ffmpeg（支持 WebM/Opus 等所有常见格式），失败则回退 afconvert
        converted = False
        if os.path.exists(FFMPEG_BIN):
            try:
                subprocess.run(
                    [FFMPEG_BIN, "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", wav_path],
                    check=True, capture_output=True, timeout=30,
                )
                converted = True
            except Exception:
                pass

        if not converted:
            subprocess.run(
                ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", tmp_path, wav_path],
                check=True, capture_output=True,
            )

        import soundfile as sf

        audio, sr = sf.read(wav_path)
        model = _load_asr_model()
        result = model.generate(input=audio)
        text = result[0]["text"] if result else ""
        # 去除 SenseVoice 内部标记 如 <|zh|><|EMO_UNKNOWN|><|Speech|>
        import re
        text = re.sub(r'<\|[^|]+\|>', '', text).strip()
        return text
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if os.path.exists(wav_path):
            os.unlink(wav_path)


@router.post("/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """接收音频文件，返回转写文本"""
    try:
        file_bytes = await file.read()
        text = transcribe_audio(file_bytes, file.filename or "audio.wav")
        return {"text": text, "status": "ok"}
    except Exception as e:
        return {"text": "", "status": "error", "message": str(e)}
