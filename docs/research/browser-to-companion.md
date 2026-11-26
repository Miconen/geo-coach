# Browser mic to localhost Companion

Research for ticket #4. Researched 2026-11-21.

**Question.** How can a page served over https from the Duo's geo-coach subdomain hand the player's mic audio to the Companion listening on localhost (Docker under WSL2 on Windows)? What do Chrome and Firefox allow (mixed content, Private/Local Network Access, loopback, CORS, fetch vs WebSocket)? Should the Companion serve the recording page itself? Which capture format and chunk size suit Whisper, and how do we get accurate wall-clock timestamps per chunk so Utterances line up with Round timings?

## Answer in short

- Both options work in late 2026, but **the simplest robust option is for the Companion to serve the recording page itself at `http://127.0.0.1:<port>`**. That page is a secure context (mic allowed), talks to its own origin (no CORS, no mixed content, no Local Network Access prompt), and only needs ordinary CORS from the public geo-coach backend if it talks to it at all.
- The alternative, the hosted https page streaming to `http://127.0.0.1:<port>`, is allowed: loopback is not mixed content. But since Chrome 142/145/147 and Firefox 151 it **triggers a one-time per-origin "apps and services on this device" (`loopback-network`) permission prompt**, plus CORS handling and Origin checks on the Companion. Workable, with more moving parts and more browser policy to keep up with.
- Capture with an **AudioWorklet at the AudioContext's native rate, downsampled in the worklet to 16 kHz mono 16-bit PCM**, sent as ~1 s binary chunks over a WebSocket and written to WAV/FLAC by the Companion. Whisper consumes 16 kHz mono natively. MediaRecorder (Opus/WebM) is a fallback with weaker timing.
- **Timestamps:** anchor once with `performance.timeOrigin + performance.now()` and derive each chunk's start from its sample count (`currentFrame`). Re-anchor periodically. Separately measure the PC clock's offset against the geo-coach server, because Windows clocks can be seconds off from GeoGuessr's server time.

## 1. Can an https page reach `http://localhost`?

### Mixed content: loopback is exempt

- Secure Contexts defines origins whose host is in `127.0.0.0/8` or `::1/128`, or is `localhost` / `*.localhost`, as **"Potentially Trustworthy"** (the `localhost` case is conditional on the UA following "let localhost be localhost" name resolution). [Secure Contexts, §3.1 "Is origin potentially trustworthy?"](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy)
- Mixed Content only applies to URLs that are *not* potentially trustworthy, so `http://127.0.0.1:…` from an https page is not mixed content. MDN: "content accessed from loopback addresses such as `http://127.0.0.1/` or `http://localhost/`" is "considered to be from secure origins, just like HTTPS origins." [MDN, Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)
- Prefer the literal **`127.0.0.1`** over `localhost`. It is unambiguous for the "potentially trustworthy" check and avoids `localhost` resolving to `::1` on Windows while the WSL/Docker port forward is IPv4-only. (The IPv6 forwarding behaviour is *unverified* for our exact setup; see §4.)

### Local Network Access (formerly Private Network Access)

PNA is gone; the replacement is **Local Network Access (LNA)**, a permission model rather than a preflight model.

- **Spec:** WICG Local Network Access, Draft CG Report dated 2026-08-07. Three address spaces: `loopback` (127.0.0.0/8, ::1) ⊂ `local` (RFC1918, link-local, ULA) ⊂ `public`. Requests from a less private to a more private space need a permission. There are two permissions, **`local-network`** and **`loopback-network`**; the old `local-network-access` name is kept as an alias in Chromium. `fetch()` gets a `targetAddressSpace` option (`"public" | "local" | "loopback"`). WebSocket and WebTransport are covered through the Fetch integration. The capability "must only be allowed from secure contexts." [WICG LNA spec](https://wicg.github.io/local-network-access/)
- **Chrome timeline**, from first-party announcements:
  - LNA prompt for fetch, subresources and subframes launched in **Chrome 142**. Opt-in testing was in 138. [Chrome blog: New permission prompt for Local Network Access](https://developer.chrome.com/blog/local-network-access)
  - Split into `local-network` and `loopback-network` targeted **Chrome 145**. [Intent to Ship: LNA split permissions](https://groups.google.com/a/chromium.org/g/blink-dev/c/Zl3P6NHhMBw)
  - LNA for **WebSockets** targeted **Chrome 147**, delayed from 144. Existing enterprise policies apply: `LocalNetworkAccessAllowedForUrls`, `LocalNetworkAccessBlockedForUrls`, `LocalNetworkAccessRestrictionsTemporaryOptOut`. The thread notes that WebSocket has **no `targetAddressSpace` equivalent**, so the browser decides from the URL syntactically. A literal `127.0.0.1` is therefore what you want. [Intent to Ship: LNA for WebSockets](https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups)
  - Current Chrome guidance: serve from https, declare `targetAddressSpace: 'loopback'` on fetches, delegate to iframes with `allow="local-network; loopback-network"`, and **do not rely on the deprecated PNA preflight headers** (`Access-Control-Request-Private-Network` / `Access-Control-Allow-Private-Network`). [Chrome modern-web-guidance: Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)
- **Firefox timeline:** LNA restrictions came on by default for ETP-Strict users from Firefox 147. **Firefox 151** started a gradual rollout to all users: "Firefox requires websites to request permission before connecting to devices on your local network or to apps and services on your device." [Firefox 151 release notes](https://www.firefox.com/en-US/firefox/151.0/releasenotes/). Firefox 153 beta notes say it is now on by default for all users. That comes from search-result snippets of the beta notes and the Mozilla SUMO article (which did not load), so treat it as **partly unverified**.
- **Loopback → loopback is never gated.** A page served *from* `http://127.0.0.1` talking to `127.0.0.1` raises no LNA prompt, and requests from loopback to public are not restricted either. [Chrome blog](https://developer.chrome.com/blog/local-network-access) ("serving your web app from `http://localhost` … will **not** trigger LNA checks")

### CORS and WebSocket specifics (hosted-page option)

- `fetch('http://127.0.0.1:PORT/…', { targetAddressSpace: 'loopback' })` from `https://<duo>.geo-coach…` is cross-origin. The Companion must answer CORS preflights (`OPTIONS`) and send `Access-Control-Allow-Origin: https://<duo-subdomain>` (an exact origin, not `*`, if credentials are used). This is standard Fetch CORS; no PNA headers are needed any more.
- WebSockets are not subject to CORS. The Companion **must check the `Origin` header** itself and reject anything but the Duo's origin, otherwise any site the player has granted `loopback-network` (or any non-browser local process) could feed it audio. Pairing with a token that the Companion shows and the page sends is cheap extra defence.
- Expect one permission prompt per browser profile per origin. A user who clicks "Block" silently breaks recording, so the page needs a clear failure state.

## 2. Should the Companion serve the recording page itself?

**Recommendation: yes, at least for v1.**

| | Companion-served page (`http://127.0.0.1:PORT`) | Hosted page → localhost |
|---|---|---|
| `getUserMedia` | Allowed (loopback is a secure context) | Allowed (https) |
| LNA prompt | None | `loopback-network` prompt in Chrome and Firefox |
| CORS / mixed content | Same origin, nothing to do | CORS on Companion, `targetAddressSpace`, Origin checks |
| Browser-policy churn | Minimal (loopback is the most privileged space) | Has changed three times in 2025-2026 |
| Talking to geo-coach backend | Ordinary CORS from backend allowing `http://127.0.0.1:PORT` (loopback → public isn't LNA-gated) | Same-origin |
| UX | Player opens a local URL (Companion can print or open it) | Player stays on the Duo site |
| Version skew | Page ships with the Companion image, so it always matches the Companion's protocol | Page and Companion can drift apart |

Caveats: mic permission is granted per origin, so a fixed port keeps the grant sticky. Any other local software can also reach that port; publish with `-p 127.0.0.1:PORT:PORT` so it is not exposed to the LAN. Docker's own docs warn that publishing is "insecure by default" and binds `0.0.0.0` unless you say otherwise. [Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)

The hosted-page option stays possible later, for example to fold recording into the main web UI. The same WebSocket protocol works for both.

## 3. Capture format, chunk size, Whisper

### What Whisper wants

OpenAI Whisper hard-codes `SAMPLE_RATE = 16000`, works on 30 s windows (`CHUNK_LENGTH = 30`), and `load_audio` decodes anything to mono 16 kHz via ffmpeg. [openai/whisper `audio.py`](https://github.com/openai/whisper/blob/main/whisper/audio.py). faster-whisper and whisper.cpp also expect 16 kHz mono (*not re-verified here*). So **16 kHz mono PCM is the native format**. Anything else is decoded and resampled first.

### Option A, recommended: AudioWorklet → 16 kHz Int16 PCM

- Web Audio: the worklet sees 128-frame render quanta by default. `AudioWorkletGlobalScope` exposes `currentFrame`, `currentTime` and `sampleRate`, and `AudioContext.getOutputTimestamp()` relates `contextTime` to `performance.now()` time. [Web Audio API 1.1 ED, 2026-11-17](https://webaudio.github.io/web-audio-api/)
- **Don't create `new AudioContext({ sampleRate: 16000 })` and connect the mic to it.** Firefox still does not support connecting a MediaStream source to an AudioContext whose rate differs from the device rate (Bugzilla [1725336](https://bugzilla.mozilla.org/show_bug.cgi?id=1725336), referenced from the still-open [1388586](https://bugzilla.mozilla.org/show_bug.cgi?id=1388586)). Run the context at its default rate (usually 48 kHz) and **downsample to 16 kHz inside the worklet**: low-pass, then decimate. 48 → 16 is an integer factor of 3.
- Batch to **~1 s chunks** (16,000 samples = 32 KB Int16) and post them to the main thread, then send them as binary WebSocket frames. One second is a good trade-off: little loss if the tab dies, negligible overhead over loopback, and well below Whisper's 30 s window. Bandwidth is about 115 MB/hour per player before compression. Fine locally; the Companion can store FLAC (lossless, roughly half the size) or Opus for archive.
- Each frame carries a small header: `seq`, `startFrame` (in 16 kHz samples since capture start), and the anchor (below). Gaps from a dropped tab or a re-opened page show up as discontinuities in `seq` or `startFrame`, and the Companion records them instead of silently stitching.

### Option B, fallback: MediaRecorder

- `start(timeslice)` emits a blob after *at least* `timeslice` ms "or some minimum time slice imposed by the UA, whichever is greater". `BlobEvent.timecode` is relative to the first blob, and "the individual Blobs need not be playable": only the concatenation is. `isTypeSupported` is now marked deprecated in favour of `MediaCapabilities.encodingInfo()`. [MediaStream Recording ED, 2026-03-16](https://w3c.github.io/mediacapture-record/)
- So the Companion would append chunks to one WebM/Ogg Opus file per recording and decode with ffmpeg. The output is compact (Opus at ~24-32 kbps is fine for speech), but timing is coarser, chunk boundaries are opaque, and a crash mid-file can leave the container unfinalized. Container support differs by browser: Chrome commonly produces `audio/webm;codecs=opus`, Firefox `audio/ogg;codecs=opus` or WebM (*not re-verified against current versions*).

### getUserMedia constraints

`echoCancellation`, `noiseSuppression` and `autoGainControl` default to on in browsers. Echo cancellation only cancels audio the *browser* plays, not the Discord call, so **players should use headphones**, otherwise the partner's voice ends up in both Transcripts. Whether to switch off noise suppression or AGC for Whisper quality is a tuning question for a prototype.

## 4. Docker under WSL2: reaching it as `127.0.0.1` from Windows

- In WSL's default NAT mode, apps listening inside the distro are reachable from Windows browsers at `localhost` ("just like you normally would"). Mirrored mode (Windows 11 22H2+, `networkingMode=mirrored`) shares interfaces, so `127.0.0.1` works both ways. Mirrored mode does not support `::1` for Windows→Linux, and the Hyper-V firewall may need an inbound rule. [Microsoft Learn: Accessing network applications with WSL](https://learn.microsoft.com/en-us/windows/wsl/networking) (updated 2026-06-02)
- Docker: `-p 127.0.0.1:PORT:PORT` restricts the published port to the Docker host. [Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)
- **Unverified, prototype needed:** with Docker Engine inside a WSL distro (not Docker Desktop) and NAT mode, check that a port published on the distro's `127.0.0.1` is forwarded to Windows `127.0.0.1` (WSL's localhost relay), and whether Windows `localhost` → `::1` reaches it. Docker Desktop's WSL2 backend publishes ports onto the Windows host directly. Its docs page was not checked here.

## 5. Wall-clock timestamps that line up with Rounds

There are two separate problems: (a) mapping audio samples to the PC's clock precisely, and (b) mapping the PC's clock to GeoGuessr's clock.

**(a) Samples → PC clock.**
- On the first worklet chunk, record the anchor `wallStart = performance.timeOrigin + performance.now()`, captured on the main thread when the first chunk arrives and corrected by the chunk's duration. You can refine it with `getOutputTimestamp()`, which pairs `contextTime` with `performanceTime`. [Web Audio API](https://webaudio.github.io/web-audio-api/)
- Each chunk's time is `wallStart + startFrame / 16000`. Deriving from sample counts gives **no per-chunk jitter**. Message and timer jitter of tens of ms would otherwise build up.
- Audio hardware clocks drift by a few ppm from the system clock, roughly 10-40 ms per hour. **Re-anchor every few minutes:** send `(currentFrame, performance.timeOrigin + performance.now())` pairs and let the Companion fit or correct the drift.
- Input latency (mic → worklet) is typically tens of ms and is ignored. It is far below Round-level precision.

**(b) PC clock → GeoGuessr time.**
- Windows' clock can be off by seconds. `performance.timeOrigin` is derived from it. Round start and end times from GeoGuessr come from *their* servers (*assumption: they are UTC server timestamps; confirm in the GeoGuessr data ticket*).
- Have the page measure the offset against the geo-coach backend, NTP-style: take the midpoint of the request's round trip against the server's reported time, over a few samples. Store it with the recording. The backend's clock is NTP-synced, so this bounds error to about ±RTT/2 plus GeoGuessr's own clock error.
- **Don't rely on the container's clock.** The WSL2 VM clock has a known history of drifting after host sleep or hibernate (*from community reports, not verified against a primary source*). Browser-side timestamps plus the server offset avoid that dependency. The Companion should still log its own receive time per chunk as a sanity check.

Required precision is modest: Rounds last tens of seconds to minutes, so ±0.5 s is plenty. The scheme above should land well within ±100 ms after offset correction.

## Unverified / open

- Exact stable milestones where Chrome's WebSocket LNA (147) and split permissions (145) actually shipped. The sources are Intent-to-Ship threads, not stable release notes.
- Firefox "on for all users" status after 151 (beta-notes snippet only; the SUMO article failed to load).
- WSL NAT localhost relay for ports Docker Engine binds to the distro's `127.0.0.1`, and `::1` behaviour.
- Whether Windows shares the mic between Discord and the browser without issues (expected yes; shared-mode WASAPI).
- Timing of a background tab: AudioWorklet runs on the audio thread and should not be throttled, but main-thread forwarding in a hidden tab should be checked in the prototype.

## Sources

- W3C Secure Contexts: https://w3c.github.io/webappsec-secure-contexts/
- W3C Mixed Content: https://w3c.github.io/webappsec-mixed-content/
- MDN Mixed content: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content
- WICG Local Network Access: https://wicg.github.io/local-network-access/
- Chrome blog, LNA prompt: https://developer.chrome.com/blog/local-network-access
- Chrome guidance, LNA: https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
- blink-dev Intent to Ship, LNA split permissions: https://groups.google.com/a/chromium.org/g/blink-dev/c/Zl3P6NHhMBw
- blink-dev Intent to Ship, LNA for WebSockets: https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups
- Firefox 151 release notes: https://www.firefox.com/en-US/firefox/151.0/releasenotes/
- W3C MediaStream Recording: https://w3c.github.io/mediacapture-record/
- W3C Web Audio API: https://webaudio.github.io/web-audio-api/
- Mozilla Bugzilla 1388586 / 1725336: https://bugzilla.mozilla.org/show_bug.cgi?id=1388586
- openai/whisper audio.py: https://github.com/openai/whisper/blob/main/whisper/audio.py
- Microsoft Learn, WSL networking: https://learn.microsoft.com/en-us/windows/wsl/networking
- Docker, port publishing: https://docs.docker.com/engine/network/port-publishing/
