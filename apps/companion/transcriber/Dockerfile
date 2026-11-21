FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    WHISPER_MODEL=large-v3 \
    WHISPER_COMPUTE_TYPE=int8_float16 \
    IDLE_UNLOAD_SECONDS=900

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    faster-whisper==1.2.1

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8787
CMD ["python3", "/app/server.py"]
