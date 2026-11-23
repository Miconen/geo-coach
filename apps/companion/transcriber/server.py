import gc
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3")
FALLBACK_MODEL = os.environ.get("WHISPER_FALLBACK_MODEL", "large-v3-turbo")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float16")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
IDLE_UNLOAD_SECONDS = int(os.environ.get("IDLE_UNLOAD_SECONDS", "900"))
PORT = int(os.environ.get("TRANSCRIBER_PORT", "8787"))

model_lock = threading.Lock()
loaded_model = None
loaded_model_name = None
last_used_at = 0.0
# Set while a cold load runs (reading ~3 GB onto the GPU can take minutes); /healthz reads it without the lock
model_loading = False


def ensure_model():
    global loaded_model, loaded_model_name, last_used_at, model_loading
    with model_lock:
        last_used_at = time.monotonic()
        if loaded_model is not None:
            return loaded_model, loaded_model_name
        model_loading = True
        try:
            loaded_model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
            loaded_model_name = MODEL_NAME
        except Exception:
            loaded_model = WhisperModel(FALLBACK_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
            loaded_model_name = FALLBACK_MODEL
        finally:
            model_loading = False
        return loaded_model, loaded_model_name


def unload_if_idle():
    global loaded_model, loaded_model_name
    while True:
        time.sleep(30)
        with model_lock:
            if loaded_model is not None and (time.monotonic() - last_used_at) >= IDLE_UNLOAD_SECONDS:
                loaded_model = None
                loaded_model_name = None
                gc.collect()


class TranscriberHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            self._send_json(
                200, {"ok": True, "loadedModel": loaded_model_name, "loading": model_loading}
            )
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        global loaded_model, loaded_model_name
        if self.path == "/load":
            _, name = ensure_model()
            self._send_json(200, {"ok": True, "model": name})
            return

        if self.path == "/unload":
            with model_lock:
                loaded_model = None
                loaded_model_name = None
                gc.collect()
            self._send_json(200, {"ok": True})
            return

        if self.path == "/transcribe":
            length = int(self.headers.get("Content-Length", "0"))
            raw_bytes = self.rfile.read(length)
            hotwords = (self.headers.get("X-Hotwords") or "").strip()

            model, name = ensure_model()
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_path = tmp.name

            try:
                # Wrap raw 16 kHz mono s16le PCM into a minimal WAV header if not already FLAC/WAV
                if raw_bytes[:4] in (b"fLaC", b"RIFF"):
                    with open(tmp_path, "wb") as f:
                        f.write(raw_bytes)
                else:
                    import wave

                    with wave.open(tmp_path, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(16000)
                        wf.writeframes(raw_bytes)

                kwargs = {
                    "language": "en",
                    "beam_size": 5,
                    "vad_filter": True,
                    "word_timestamps": True,
                }
                if hotwords:
                    kwargs["hotwords"] = hotwords

                with model_lock:
                    segments_iter, _ = model.transcribe(tmp_path, **kwargs)
                    segments = []
                    for seg in segments_iter:
                        words = []
                        if seg.words:
                            for w in seg.words:
                                words.append(
                                    {
                                        "word": w.word,
                                        "start_ms": int(round(w.start * 1000)),
                                        "end_ms": int(round(w.end * 1000)),
                                        "probability": float(w.probability),
                                    }
                                )
                        segments.append(
                            {
                                "text": seg.text.strip(),
                                "start_ms": int(round(seg.start * 1000)),
                                "end_ms": int(round(seg.end * 1000)),
                                "avg_logprob": float(seg.avg_logprob),
                                "no_speech_prob": float(seg.no_speech_prob),
                                "words": words,
                            }
                        )

                self._send_json(200, {"model": name, "segments": segments})
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            return

        self._send_json(404, {"error": "not found"})


if __name__ == "__main__":
    threading.Thread(target=unload_if_idle, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), TranscriberHandler)
    print(f"faster-whisper transcriber listening on :{PORT} (model={MODEL_NAME})")
    server.serve_forever()
