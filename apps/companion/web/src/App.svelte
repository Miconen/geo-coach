<script lang="ts">
  import { onMount } from "svelte";
  import {
    DEFAULT_THEME_ID,
    THEMES,
    THEME_STORAGE_KEY,
    resolveThemeId,
    type ThemeId,
  } from "@geo-coach/shared";

  type TranscriptKind = "live" | "retranscribe";
  type RecordingStatus =
    | { state: "recording"; chunksQueued: number; chunksDone: number; error: string | null }
    | {
        state: "transcribing";
        kind: TranscriptKind;
        chunksQueued: number;
        chunksDone: number;
        error: string | null;
      }
    | { state: "uploading"; kind: TranscriptKind; pendingUploads: number }
    | { state: "done"; kind: TranscriptKind };
  type TranscriberHealth = "ready" | "loading" | "idle" | "offline";

  interface LocalState {
    companionVersion: string;
    latestCompanionVersion: string | null;
    updateAvailable: boolean;
    updateRequired: boolean;
    serverUrl: string;
    hasToken: boolean;
    hasNcfa: boolean;
    selectedDuoId: string | null;
    duos: Array<{ id: string; name: string; geoguessrTeamId: string; hotwords: string[] }>;
    recording: { recordingId: string; duoId: string; startedAt: string; audioMs: number } | null;
    transcriber: TranscriberHealth;
    transcribing: boolean;
    uploadOk: boolean;
    pendingOutbox: number;
    transcriptionLagSec: number;
    geoguessrAuthPaused: boolean;
    geoguessrWarning: string | null;
    syncProgress: {
      phase: "feed" | "games" | "replays";
      feedPages: number;
      newGames: number;
      gamesDone: number;
      replaysDone: number;
      replaysTotal: number;
    } | null;
    notice: string | null;
    diskBytes: number;
    recordings: Array<{
      id: string;
      startedAt: string;
      stoppedAt: string | null;
      audioFormat: string;
      durationMs: number;
      bytes: number;
      status: RecordingStatus | null;
    }>;
  }

  // Server-side speech threshold (SPEECH_RMS_THRESHOLD): quieter audio counts as silence for auto-stop
  const SPEECH_RMS = 0.012;
  const METER_FLOOR_DB = -60;
  const MIC_DEVICE_STORAGE_KEY = "geo-coach.companion.micDeviceId";

  function rmsToMeter(rms: number): number {
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
  }
  const speechMark = rmsToMeter(SPEECH_RMS);

  function formatClock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  function formatLag(sec: number): string {
    return sec < 60 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`;
  }

  const transcriberLabels: Record<TranscriberHealth, { text: string; tone: string; title: string }> = {
    ready: { text: "Whisper ready", tone: "ok", title: "Model is loaded on the GPU" },
    loading: {
      text: "Whisper loading model…",
      tone: "warn",
      title: "Loading the model onto the GPU; this can take a few minutes after a long idle",
    },
    idle: { text: "Whisper asleep", tone: "idle", title: "Model unloaded after idling; it loads again when needed" },
    offline: { text: "Whisper offline", tone: "danger", title: "Can't reach the Transcriber container" },
  };

  function describeStatus(s: RecordingStatus): { text: string; tone: string } {
    switch (s.state) {
      case "recording":
        return { text: "● Recording", tone: "ok" };
      case "transcribing": {
        if (s.error) return { text: `Retrying: ${s.error}`, tone: "warn" };
        const verb = s.kind === "retranscribe" ? "Re-transcribing" : "Transcribing";
        return {
          text: s.chunksQueued > 1 ? `${verb} ${s.chunksDone}/${s.chunksQueued}` : `${verb}…`,
          tone: "busy",
        };
      }
      case "uploading":
        return { text: `Uploading (${s.pendingUploads} left)`, tone: "busy" };
      case "done":
        return { text: s.kind === "retranscribe" ? "Re-transcribed ✓" : "Transcribed ✓", tone: "ok" };
    }
  }

  function micErrorMessage(err: unknown): string {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError") return "Microphone access was blocked. Allow it in the browser's site settings.";
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "That microphone isn't available. Pick another one or use the system default.";
    }
    return `Couldn't open the microphone: ${err instanceof Error ? err.message : String(err)}`;
  }

  const darkThemes = THEMES.filter((t) => t.appearance === "dark");
  const lightThemes = THEMES.filter((t) => t.appearance === "light");

  let themeId = $state<ThemeId>(DEFAULT_THEME_ID);
  const activeTheme = $derived(THEMES.find((t) => t.id === themeId) ?? THEMES[0]!);

  function applyTheme(id: ThemeId, persist = true) {
    themeId = id;
    document.documentElement.dataset.theme = id;
    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, id);
      } catch {
        // ignore storage errors
      }
    }
  }

  let state = $state<LocalState | null>(null);
  let serverUrl = $state("http://localhost:5173");
  // Set while the Server URL box has unsaved edits, so the 10 s state poll doesn't overwrite them
  let serverUrlEdited = $state(false);
  let companionToken = $state("");
  let ncfaCookie = $state("");
  let selectedDuoId = $state("");
  let isCapturing = $state(false);
  let reconnectedNotice = $state(false);
  let statusMessage = $state("");
  let retransSince = $state("");
  let cleanupDays = $state(90);

  let ws: WebSocket | null = null;
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let bufferedFrames: ArrayBuffer[] = [];
  let bufferStartedAtMs: number | null = null;
  let lastRecordingId: string | null = null;
  let reconnectTimer: number | null = null;

  let nowMs = $state(Date.now());
  let captureStartedAtMs = $state<number | null>(null);

  // Mic level meter, shared by the mic test and a running Recording
  let micLevel = $state(0);
  let micSilent = $state(false);
  let micClipping = $state(false);
  let stopMeter: (() => void) | null = null;

  let micDevices = $state<MediaDeviceInfo[]>([]);
  let micDeviceId = $state("");

  let testing = $state(false);
  let testCtx: AudioContext | null = null;
  let testStream: MediaStream | null = null;
  let clipState = $state<"idle" | "recording" | "ready">("idle");
  let clipCountdown = $state(0);
  let clipUrl = $state<string | null>(null);

  const visibleRecordings = $derived(
    // Hide Recordings that never got audio (e.g. a page closed right after Start)
    (state?.recordings ?? []).filter((r) => r.bytes > 0 || r.durationMs > 0 || r.status?.state === "recording"),
  );
  const liveStatus = $derived.by(() => {
    const id = state?.recording?.recordingId;
    const s = id ? state?.recordings.find((r) => r.id === id)?.status : null;
    return s?.state === "recording" ? s : null;
  });

  function micConstraints(): MediaTrackConstraints {
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
    };
  }

  async function refreshMicDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // The browser's own "default"/"communications" entries duplicate our System default option
      micDevices = all.filter(
        (d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications",
      );
    } catch {
      micDevices = [];
    }
  }

  function selectMic(id: string) {
    micDeviceId = id;
    try {
      localStorage.setItem(MIC_DEVICE_STORAGE_KEY, id);
    } catch {
      // ignore storage errors
    }
    if (testing) {
      void stopMicTest().then(startMicTest);
    }
  }

  function startMeter(ctx: AudioContext, source: MediaStreamAudioSourceNode) {
    stopMeter?.();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let lastSoundAt = performance.now();
    let lastClipAt = -Infinity;
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (const v of buf) {
        sum += v * v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Fast attack, smooth release so the bar is readable
      micLevel = Math.max(rmsToMeter(rms), micLevel * 0.9);
      const t = performance.now();
      if (rms >= SPEECH_RMS) lastSoundAt = t;
      if (peak >= 0.98) lastClipAt = t;
      micSilent = t - lastSoundAt > 4_000;
      micClipping = t - lastClipAt < 1_500;
      raf = requestAnimationFrame(tick);
    };
    tick();
    stopMeter = () => {
      cancelAnimationFrame(raf);
      analyser.disconnect();
      micLevel = 0;
      micSilent = false;
      micClipping = false;
      stopMeter = null;
    };
  }

  async function startMicTest() {
    statusMessage = "";
    void fetch("/local/warm", { method: "POST" }).catch(() => {});
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    } catch (err) {
      statusMessage = micErrorMessage(err);
      return;
    }
    void refreshMicDevices();
    testCtx = new AudioContext();
    startMeter(testCtx, testCtx.createMediaStreamSource(testStream));
    testing = true;
    void poll();
  }

  async function stopMicTest() {
    stopMeter?.();
    testStream?.getTracks().forEach((t) => t.stop());
    testStream = null;
    await testCtx?.close();
    testCtx = null;
    testing = false;
    if (clipState === "recording") clipState = "idle";
  }

  function recordTestClip() {
    if (!testStream) return;
    const recorder = new MediaRecorder(testStream);
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => parts.push(e.data);
    recorder.onstop = () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
      clipUrl = URL.createObjectURL(new Blob(parts, { type: recorder.mimeType }));
      clipState = "ready";
    };
    recorder.start();
    clipState = "recording";
    clipCountdown = 5;
    const timer = window.setInterval(() => {
      clipCountdown -= 1;
      if (clipCountdown <= 0) {
        window.clearInterval(timer);
        if (recorder.state !== "inactive") recorder.stop();
      }
    }, 1_000);
  }

  // Poll fast while something is moving, slowly otherwise
  let pollTimer = 0;
  function isBusy(): boolean {
    return (
      isCapturing ||
      Boolean(state?.transcribing) ||
      state?.transcriber === "loading" ||
      (state?.recordings ?? []).some(
        (r) => r.status?.state === "transcribing" || r.status?.state === "uploading",
      )
    );
  }
  async function poll() {
    window.clearTimeout(pollTimer);
    try {
      await loadState();
    } catch {
      // Companion restarting; try again next tick
    }
    pollTimer = window.setTimeout(poll, isBusy() ? 2_000 : 10_000);
  }

  async function loadState() {
    const res = await fetch("/local/state");
    if (!res.ok) return;
    const data = (await res.json()) as LocalState;
    state = data;
    if (!serverUrlEdited) serverUrl = data.serverUrl;
    if (!selectedDuoId && data.selectedDuoId) selectedDuoId = data.selectedDuoId;
  }

  function connectWebSocket(isReconnect: boolean) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws/audio`);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      ws = socket;
      if (isCapturing) {
        socket.send(
          JSON.stringify({
            type: "start",
            duoId: selectedDuoId,
            continuedFromRecordingId: isReconnect ? lastRecordingId : null,
            clockAnchorMs: isReconnect ? (bufferStartedAtMs ?? Date.now()) : Date.now(),
          }),
        );
      }
    };

    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        type: string;
        recordingId?: string;
        notice?: string;
        message?: string;
      };
      if (msg.type === "started" && msg.recordingId) {
        lastRecordingId = msg.recordingId;
        if (isReconnect) reconnectedNotice = true;
        // Flush any PCM frames buffered during disconnect
        for (const frame of bufferedFrames) {
          socket.send(frame);
        }
        bufferedFrames = [];
        bufferStartedAtMs = null;
        void loadState();
      } else if (msg.type === "autoStopped") {
        statusMessage = msg.notice ?? "Auto-stopped after silence.";
        void stopCapture(false);
      } else if (msg.type === "error") {
        statusMessage = msg.message ?? "Companion error";
      }
    };

    socket.onclose = () => {
      ws = null;
      if (isCapturing) {
        if (bufferStartedAtMs === null) bufferStartedAtMs = Date.now();
        reconnectTimer = window.setTimeout(() => connectWebSocket(true), 2000);
      }
    };
  }

  async function startCapture() {
    if (!selectedDuoId) {
      statusMessage = "Select a Duo before starting.";
      return;
    }
    statusMessage = "";
    reconnectedNotice = false;
    if (testing) await stopMicTest();
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    } catch (err) {
      statusMessage = micErrorMessage(err);
      return;
    }
    void refreshMicDevices();
    audioCtx = new AudioContext();
    await audioCtx.audioWorklet.addModule("/pcm-processor.js");
    const source = audioCtx.createMediaStreamSource(mediaStream);
    startMeter(audioCtx, source);
    const worklet = new AudioWorkletNode(audioCtx, "pcm16-processor");
    worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(ev.data);
      } else if (isCapturing) {
        bufferedFrames.push(ev.data);
      }
    };
    source.connect(worklet);
    isCapturing = true;
    captureStartedAtMs = Date.now();
    connectWebSocket(false);
    void poll();
  }

  async function stopCapture(sendStop: boolean = true) {
    isCapturing = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sendStop && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    ws?.close();
    ws = null;
    stopMeter?.();
    captureStartedAtMs = null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    await audioCtx?.close();
    audioCtx = null;
    bufferedFrames = [];
    await loadState();
  }

  async function saveSettings(e: Event) {
    e.preventDefault();
    await fetch("/local/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl,
        companionToken: companionToken || undefined,
        ncfaCookie: ncfaCookie || undefined,
        selectedDuoId: selectedDuoId || undefined,
      }),
    });
    companionToken = "";
    ncfaCookie = "";
    serverUrlEdited = false;
    statusMessage = "Settings saved locally.";
    await loadState();
  }

  function describeSync(p: NonNullable<LocalState["syncProgress"]>): string {
    if (p.phase === "feed") {
      return `Reading GeoGuessr feed: page ${p.feedPages}, ${p.newGames} new Game(s) so far`;
    }
    if (p.phase === "games") return `Fetching Games: ${p.gamesDone}/${p.newGames}`;
    return `Fetching replays: ${p.replaysDone}/${p.replaysTotal}`;
  }

  interface SyncScan {
    feedPages: number;
    teamDuelsSeen: number;
    alreadyStored: number;
    notThisDuo: number;
    unfinished: number;
    stoppedEarly: boolean;
  }

  function describeSyncResult(games: number, replays: number, scan: SyncScan | undefined): string {
    const head = `Synced ${games} Game(s), ${replays} replay(s).`;
    if (!scan) return head;
    const pages = `${scan.feedPages} feed page(s)`;
    if (scan.teamDuelsSeen === 0) return `${head} No team duels on the ${pages} read.`;
    const parts = [
      scan.alreadyStored > 0 && `${scan.alreadyStored} already stored`,
      scan.notThisDuo > 0 && `${scan.notThisDuo} not this Duo's (other partner or unrated)`,
      scan.unfinished > 0 && `${scan.unfinished} still being played`,
    ].filter(Boolean);
    const end = scan.stoppedEarly
      ? "Stopped at a page with nothing new."
      : "Reached the end of the feed.";
    const replayNote = games === 0 ? " Replays are only fetched for new Games." : "";
    return `${head} Read ${pages}: ${scan.teamDuelsSeen} team duel(s)${parts.length ? `, ${parts.join(", ")}` : ""}. ${end}${replayNote}`;
  }

  async function syncNow(includeOlderReplays: boolean) {
    statusMessage = "Syncing GeoGuessr...";
    // Refresh faster while syncing so the progress line moves
    const progressTimer = window.setInterval(() => void loadState(), 1_000);
    const res = await fetch("/local/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeOlderReplays }),
    }).finally(() => window.clearInterval(progressTimer));
    const data = await res.json();
    statusMessage = data.warning
      ? data.warning
      : describeSyncResult(data.gamesUploaded ?? 0, data.replaysUploaded ?? 0, data.scan);
    await loadState();
  }

  async function retranscribe(recordingId?: string) {
    const res = await fetch("/local/retranscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recordingId ? { recordingId } : { sinceIso: retransSince }),
    });
    const data = (await res.json()) as { queued?: number };
    const queued = data.queued ?? 0;
    statusMessage =
      queued > 0
        ? `Re-transcribing ${queued} Recording(s). Progress shows on each row below.`
        : "No Recordings with local audio matched.";
    await poll();
  }

  async function cleanupAudio() {
    const res = await fetch("/local/cleanup-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ olderThanDays: cleanupDays }),
    });
    const data = await res.json();
    statusMessage = `Deleted ${data.deletedFiles} file(s), freed ${(data.freedBytes / 1048576).toFixed(1)} MB.`;
    await loadState();
  }

  onMount(() => {
    try {
      applyTheme(
        resolveThemeId(
          localStorage.getItem(THEME_STORAGE_KEY) ?? document.documentElement.dataset.theme,
        ),
        false,
      );
    } catch {
      applyTheme(resolveThemeId(document.documentElement.dataset.theme), false);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        applyTheme(resolveThemeId(e.newValue), false);
      }
    };
    window.addEventListener("storage", onStorage);

    try {
      micDeviceId = localStorage.getItem(MIC_DEVICE_STORAGE_KEY) ?? "";
    } catch {
      micDeviceId = "";
    }
    void refreshMicDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshMicDevices);

    // Start loading Whisper now, so the model is ready by the time Recording starts
    void fetch("/local/warm", { method: "POST" }).catch(() => {});

    void poll();
    const clock = window.setInterval(() => (nowMs = Date.now()), 1_000);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isCapturing) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearTimeout(pollTimer);
      clearInterval(clock);
      navigator.mediaDevices?.removeEventListener("devicechange", refreshMicDevices);
      void stopMicTest();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });
</script>

<main class="page">
  <header class="header">
    <div>
      <h1>geo-coach Companion</h1>
      <div class="subtitle">
        v{state?.companionVersion ?? "..."} · Audio stays on this PC · Use headphones
      </div>
    </div>
    <div class="header-controls">
      <label class="theme-picker" title="Color theme">
        <span
          class="theme-swatch"
          style="background: {activeTheme.swatches.accent}"
          aria-hidden="true"
        ></span>
        <select
          aria-label="Color theme"
          value={themeId}
          onchange={(e) => applyTheme(resolveThemeId(e.currentTarget.value))}
        >
          <optgroup label="Dark themes">
            {#each darkThemes as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </optgroup>
          <optgroup label="Light themes">
            {#each lightThemes as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </optgroup>
        </select>
      </label>

      {#if state}
        {@const t = transcriberLabels[state.transcriber]}
        <span class="status-pill tone-{t.tone}" title={t.title}>{t.text}</span>
      {/if}
      {#if isCapturing}
        <span class="status-pill tone-ok">● Recording</span>
      {:else}
        <span class="status-pill tone-idle">Idle</span>
      {/if}
    </div>
  </header>

  {#if state?.updateAvailable || state?.updateRequired}
    <div class="banner banner-warn">
      <strong>Update available ({state.latestCompanionVersion}):</strong>
      Run <code>./update.sh</code> (or <code>./update.ps1</code>) between Sessions.
      {#if state.updateRequired}
        Uploads are paused until updated; local Recording continues safely.
      {/if}
    </div>
  {/if}

  {#if reconnectedNotice}
    <div class="banner banner-info">
      Reconnected seamlessly — buffered audio was forwarded into the same Session.
    </div>
  {/if}

  {#if state?.geoguessrAuthPaused}
    <div class="banner banner-danger">
      {state.geoguessrWarning ?? "GeoGuessr polling paused (update _ncfa cookie)."}
    </div>
  {/if}

  {#if statusMessage}
    <p class="banner banner-neutral">{statusMessage}</p>
  {/if}
  {#if state?.syncProgress}
    <p class="banner banner-neutral">{describeSync(state.syncProgress)}</p>
  {/if}

  <section class="card">
    <div class="row">
      <label class="field-inline">
        Duo:
        <select bind:value={selectedDuoId} disabled={isCapturing}>
          {#each state?.duos ?? [] as duo}
            <option value={duo.id}>{duo.name}</option>
          {/each}
        </select>
      </label>

      <label class="field-inline">
        Mic:
        <select
          class="mic-select"
          value={micDeviceId}
          disabled={isCapturing}
          onchange={(e) => selectMic(e.currentTarget.value)}
        >
          <option value="">System default</option>
          {#each micDevices as d, i}
            <option value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
          {/each}
        </select>
      </label>

      {#if !isCapturing}
        <button onclick={startCapture} class="btn-primary">Start Recording</button>
        {#if testing}
          <button onclick={stopMicTest}>Stop mic test</button>
        {:else}
          <button onclick={startMicTest}>Test mic</button>
        {/if}
      {:else}
        <button onclick={() => stopCapture(true)} class="btn-danger">Stop Recording</button>
      {/if}
    </div>

    {#if isCapturing || testing}
      <div class="live-panel">
        {#if isCapturing}
          <div class="live-head">
            <span class="rec-dot" aria-hidden="true"></span>
            <span class="elapsed">{formatClock(nowMs - (captureStartedAtMs ?? nowMs))}</span>
            <span class="muted">recording · {formatClock(state?.recording?.audioMs ?? 0)} of audio saved</span>
          </div>
        {/if}

        <div class="meter" role="meter" aria-label="Mic level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(micLevel * 100)}>
          <div class="meter-fill" class:clipping={micClipping} style="width: {micLevel * 100}%"></div>
          <div class="meter-mark" style="left: {speechMark * 100}%" title="Below this line counts as silence"></div>
        </div>
        <div class="meter-legend">
          {#if micClipping}
            <span class="tone-text-danger">Clipping: lower the mic gain</span>
          {:else if micSilent}
            <span class="tone-text-warn">No speech picked up for a few seconds. Check the mic or pick another one.</span>
          {:else}
            <span class="muted">Speak normally: the bar should pass the line.</span>
          {/if}
        </div>

        {#if isCapturing}
          <div class="live-stats">
            {#if state?.transcriber === "loading"}
              <span class="tone-text-warn">Whisper is loading the model. Chunks wait in the queue; audio is safe on disk.</span>
            {:else if state?.transcriber === "offline"}
              <span class="tone-text-danger">Whisper is offline. Chunks wait in the queue; audio is safe on disk.</span>
            {:else if !liveStatus || liveStatus.chunksQueued === 0}
              <span class="muted">The first chunk goes to Whisper after a pause in speech, or after 30 s.</span>
            {:else}
              <span>
                Transcribed {liveStatus.chunksDone}/{liveStatus.chunksQueued} chunk(s) ·
                {#if (state?.transcriptionLagSec ?? 0) > 10}
                  <span class="tone-text-warn">{formatLag(state?.transcriptionLagSec ?? 0)} behind</span>
                {:else}
                  keeping up
                {/if}
              </span>
            {/if}
            {#if liveStatus?.error}
              <span class="tone-text-warn">Last chunk failed ({liveStatus.error}); retrying.</span>
            {/if}
          </div>
        {:else}
          <div class="row clip-row">
            {#if clipState === "recording"}
              <button disabled>Recording… {clipCountdown}</button>
            {:else}
              <button onclick={recordTestClip}>Record 5 s and play back</button>
            {/if}
            {#if clipUrl && clipState === "ready"}
              <!-- svelte-ignore a11y_media_has_caption -->
              <audio src={clipUrl} controls autoplay></audio>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="row sync-row">
      <button onclick={() => syncNow(false)}>Sync GeoGuessr now</button>
      <button onclick={() => syncNow(true)}>Backfill older replays</button>
    </div>

    <div class="meta">
      Uploads waiting: {state?.pendingOutbox ?? 0} · Upload status: {state?.uploadOk ? "OK" : "Retrying"} · Local audio: {((state?.diskBytes ?? 0) / 1048576).toFixed(1)} MB
    </div>
  </section>

  <section class="card">
    <h2>Local Settings (kept only in Companion volume)</h2>
    <form onsubmit={saveSettings} class="form-grid">
      <!-- Secrets use plain text fields: browsers ignore autocomplete="off" on
           password fields and autofilled the saved _ncfa into both. -->
      <label class="field">
        Server URL
        <input
          class="input-full"
          bind:value={serverUrl}
          oninput={() => (serverUrlEdited = true)}
        />
      </label>
      <label class="field">
        Companion token ({state?.hasToken ? "configured" : "not set"})
        <input
          class="input-full"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={companionToken}
          placeholder="Paste new gc_cmp_... token"
        />
      </label>
      <label class="field">
        GeoGuessr _ncfa cookie ({state?.hasNcfa ? "configured" : "optional"})
        <input
          class="input-full"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={ncfaCookie}
          placeholder="Paste _ncfa value"
        />
      </label>
      <button type="submit" class="btn-primary btn-fit">Save Settings</button>
    </form>
  </section>

  <section class="card">
    <h2>Local Recordings & Re-transcription</h2>
    <div class="row" style="margin-bottom: 12px;">
      <input type="datetime-local" bind:value={retransSince} />
      <button onclick={() => retranscribe()}>Re-transcribe all since date</button>
      <span class="cleanup-group">
        Delete audio older than
        <input class="input-days" type="number" bind:value={cleanupDays} />
        days
        <button onclick={cleanupAudio}>Delete</button>
      </span>
    </div>

    <ul class="recordings-list">
      {#each visibleRecordings as rec (rec.id)}
        {@const busy = rec.status?.state === "transcribing" || rec.status?.state === "recording"}
        <li class="recording-item">
          <span>
            {new Date(rec.startedAt).toLocaleString()} · {formatClock(rec.durationMs)} · {rec.audioFormat} ({(rec.bytes / 1048576).toFixed(1)} MB)
          </span>
          <span class="recording-actions">
            {#if rec.status}
              {@const d = describeStatus(rec.status)}
              <span class="status-pill tone-{d.tone}">{d.text}</span>
            {/if}
            <button onclick={() => retranscribe(rec.id)} disabled={isCapturing || busy || rec.audioFormat === "deleted"}>
              Re-transcribe
            </button>
          </span>
        </li>
      {:else}
        <li class="muted">No local Recordings yet.</li>
      {/each}
    </ul>
  </section>
</main>
