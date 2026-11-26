# Local Whisper on WSL2 Docker with 8 GB VRAM

Research for [#3](https://github.com/Miconen/geo-coach/issues/3). Checked 2026-11-21.

## Question

What is the best way to run local Whisper transcription in the **Companion** (Docker, CUDA, WSL2 on Windows, weakest GPU 8 GB VRAM, GeoGuessr open in a browser at the same time) for English gaming chatter full of place names? Compare faster-whisper / speaches, the whisper.cpp server, WhisperX and others on: VRAM fit, speed, timestamps, vocabulary steering, chunked or near-real-time input, and how easy the image is to update.

## Recommendation

**Build the Companion's transcriber on [faster-whisper](https://github.com/SYSTRAN/faster-whisper), inside a small image we own, based on an official `nvidia/cuda:12.x-cudnn9-runtime` image. Use `large-v3-turbo` (or `distil-large-v3.5`) with `compute_type="int8_float16"`, VAD on, `word_timestamps=True`, and a place-name `hotwords`/`initial_prompt`.** Send it chunks of a few seconds to tens of seconds, cut at VAD pauses, not a token-by-token stream.

**Fallback: the official `ghcr.io/ggml-org/whisper.cpp:main-cuda` image running `whisper-server`.** It is the easiest thing to update (just `docker pull`), and it has prompt, VAD and word timestamps. Its catch is that we do not control the image and get fewer tuning options.

Do not use **speaches** (it looks unmaintained, see below) or **WhisperX** (it adds weight we don't need for one speaker per stream).

Why:

- Each Companion transcribes **one speaker on one mic**. WhisperX's selling points (pyannote diarization, wav2vec2 forced alignment) mostly don't apply, and they cost extra VRAM and dependencies.
- An image we own, with pinned `faster-whisper` and a pinned base image, updates in one step: tag a release, CI builds it, players run `docker compose pull`. We don't depend on a third-party image that may stop being published, which is what happened to speaches.

## VRAM: what fits next to a running game

| Model | Source figure | Note |
|---|---|---|
| OpenAI `turbo` (large-v3-turbo, 809 M params) | ~6 GB VRAM, ~8x the speed of `large` (PyTorch reference impl.) [openai/whisper] | The reference PyTorch figure. Too tight on 8 GB next to a game. |
| OpenAI `medium` / `medium.en` | ~5 GB, ~2x | Slower than turbo and not more accurate. |
| faster-whisper `large-v2`, beam 5, **fp16** | **4525 MB**, 1m03s on RTX 3070 Ti for their 13-min benchmark | [faster-whisper README] |
| faster-whisper `large-v2`, beam 5, **int8** | **2926 MB**, 59s | [faster-whisper README] |
| faster-whisper batched (batch 8) | 4500–6090 MB, 16–17s | More throughput than we need. |
| whisper.cpp `large` (ggml) | ~3.9 GB memory; `medium` ~2.1 GB | [whisper.cpp README]. Quantized (Q5_0 etc.) is smaller. |
| WhisperX `large-v2` beam 5 | "<8GB" | [whisperX README]. Plus the alignment model. |

Reasoning (an inference, **not measured**): large-v3-turbo has the same encoder as large-v3 but only 4 decoder layers, so in int8 in faster-whisper it should need **well under the 2.9 GB** that large-v2 int8 needs. That leaves about 5 GB for the browser game and Windows. GeoGuessr in Chrome is a light GPU load. **This still needs measuring on the 8 GB card** (`nvidia-smi` on the Windows side while a game runs).

WSL2 caveats from NVIDIA's [CUDA on WSL guide]: install only the Windows driver (never a Linux driver inside WSL); unified memory and pinned memory are limited; Docker GPU selection supports only `--gpus all`; `nvidia-smi` inside WSL can't show per-process usage. Docker Desktop supports `--gpus` only with the WSL2 backend [Docker GPU docs]. **Unverified:** what happens when WDDM oversubscribes VRAM (it may spill to shared system memory and slow down instead of failing with OOM). Don't count on it.

## Speed

- faster-whisper large-v2 on a 3070 Ti: about 13x real time unbatched, about 45x batched (their 13-minute benchmark file) [faster-whisper README]. Turbo is faster still. One player's chatter is a small load. Speed is not the bottleneck at any reasonable model size.
- distil-large-v3.5 is English-only, 756 M params, and "~1.5x faster than large-v3-turbo". Short-form OOD WER is 7.08% vs turbo 7.30%. Long-form WER is 11.39% vs turbo 10.25% [distil-large-v3.5 model card]. Both are reasonable; **we would need to test which handles place names better.**
- WhisperX claims "70x realtime" with large-v2 batched [whisperX README].

## Feature comparison

| | faster-whisper (own image) | whisper.cpp `whisper-server` | speaches | WhisperX |
|---|---|---|---|---|
| Word timestamps | Yes, `word_timestamps=True` (cross-attention + DTW) | Yes: `verbose_json` segments carry `words[]`; `-dtw <preset>` (incl. large-v3-turbo) for better token times | Yes, `timestamp_granularities[]=word` (OpenAI-style) | Yes, the best ones (wav2vec2 forced alignment) |
| Vocabulary steering | `initial_prompt` **and** `hotwords` | `prompt` and `carry_initial_prompt` | `prompt` and `hotwords` form fields | Via faster-whisper backend options (not prominent in README; **unverified** on CLI) |
| VAD | Silero, built in, `vad_filter` | `--vad` with a VAD model | Yes (faster-whisper) | Yes |
| Near-real-time | Our own chunking loop | `whisper-stream` example (mic, 0.5 s step) is separate from the server; the server takes files | SSE streaming, Realtime API, WebSocket | Batch/file oriented; no streaming |
| Docker image | We build it (`nvidia/cuda:12.x-cudnn9-runtime` per README) | Official `ghcr.io/ggml-org/whisper.cpp:main-cuda` | `ghcr.io/speaches-ai/speaches:*-cuda` | None official |
| Maintenance (2026-11) | Active; last commit 2026-11-12, v1.2.1 2025-10-31 | Very active; v1.9.5 2026-10-06, builds daily | **Stalled**: last image `0.9.0-rc.3` ~Dec 2025, last main commit 2026-04-18, only bot PRs since | Active; v3.8.6 2026-05 |

Sources: faster-whisper `transcribe.py` and `utils.py` (model aliases incl. `turbo`, `distil-large-v3.5`); whisper.cpp `examples/server/README.md` and `server.cpp`; speaches `src/speaches/routers/stt.py`, `compose.cuda.yaml`, the GHCR package page and commit history; whisperX README.

### Place names

Whisper's `prompt` (and faster-whisper's `hotwords`) biases decoding toward the words given. For us that's a fixed list of country, region and meta terms ("Bulgaria, bollard, Cyrillic, Mongolia, Sri Lanka, …"), plus maybe recent Learnings. The prompt window is limited to 224 tokens (Whisper design, half the 448-token context; **not re-checked in this pass**), so keep the list short and rotate it. Prompting can also cause hallucinated prompt text on silence; VAD reduces this. **How much the prompt helps on our real audio is unverified. Run a prototype on a recorded Session.**

### Chunked / near-real-time

None of the candidates is truly streaming. Whisper works on windows of up to 30 s. What we can do in practice:

1. The Companion records continuously to disk (the audio is kept anyway, per the glossary).
2. A VAD cuts it into Utterance-sized chunks (pauses of about 0.5–1 s, max about 30 s).
3. Each chunk goes to the model with its wall-clock offset, so Utterance timestamps are absolute.

This gives a few seconds of latency, which is plenty, since Learnings are processed afterwards anyway. Because the Transcript can be redone (glossary), the same code can run again over the stored audio with a bigger model or a better prompt.

## Trade-offs

- **Own faster-whisper image**: Pros: full control of model, prompt and VAD; we pin versions; one Python process; the best documented VRAM numbers; `hotwords`. Cons: we maintain a Dockerfile and CI; CTranslate2 needs CUDA 12 + cuDNN 9 that matches the base image (README).
- **whisper.cpp server**: Pros: zero build, official CUDA image, low memory, quantized models, very active. Cons: `main-cuda` is a moving tag (pin a digest or release tag); no `hotwords`; the server is file-based HTTP; the README warns not to expose it.
- **speaches**: Pros: OpenAI-compatible, has streaming. Cons: no image for about 11 months, and the core has stalled. That conflicts with "easy updates". Reconsider only if it revives.
- **WhisperX**: Pros: the best word alignment, diarization. Cons: no official image, more VRAM and dependencies, diarization is pointless with one mic per player.
- Others not looked at in depth: NVIDIA Parakeet/NeMo (speaches had a `feat/parakeet-support` branch) and the HF Transformers pipeline. Out of scope here. Parakeet is English-strong but not Whisper and has no prompt support (**unverified**).

## Open / unverified

1. Real VRAM of turbo / distil-large-v3.5 in `int8_float16` on the weakest 8 GB card with GeoGuessr running.
2. How much prompt or hotwords actually improves place-name recall on our audio. Needs a prototype with a recorded Session.
3. WDDM VRAM oversubscription behaviour under WSL2.
4. Whether distil-large-v3.5 or turbo does better on short, noisy gaming chatter.

## Sources

- [faster-whisper README](https://github.com/SYSTRAN/faster-whisper) and [`transcribe.py`](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py), [`utils.py`](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py)
- [openai/whisper README](https://github.com/openai/whisper), the model table
- [whisper.cpp README](https://github.com/ggml-org/whisper.cpp), [server README](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md), [`server.cpp`](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/server.cpp)
- [speaches README](https://github.com/speaches-ai/speaches), [`compose.cuda.yaml`](https://github.com/speaches-ai/speaches/blob/master/compose.cuda.yaml), [GHCR package](https://github.com/speaches-ai/speaches/pkgs/container/speaches)
- [whisperX README](https://github.com/m-bain/whisperX)
- [distil-large-v3.5 model card](https://huggingface.co/distil-whisper/distil-large-v3.5)
- [NVIDIA CUDA on WSL user guide](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)
- [Docker Desktop GPU support](https://docs.docker.com/desktop/features/gpu/)
